/**
 * YouTube '엑스와이지' 언급 영상 수집
 *
 * 로봇 바리스타는 영상으로 퍼지는 제품이라 텍스트 언급만 보면 실제 확산을 놓친다.
 * 블로그·뉴스와 달리 조회수라는 정량 지표가 붙는 게 이 수집원의 핵심 가치다.
 *
 * 조회수는 계속 변하므로 기존 영상도 매번 최신 통계로 갱신한다.
 * (videos.list 는 50개당 1유닛이라 전량 갱신해도 비용이 거의 없다)
 *
 * 쿼터: search.list 100유닛 × 쿼리 수 + videos.list ≈ 1일 900유닛 미만.
 *       무료 한도가 10,000유닛/일 이라 하루 2회 수집으로 충분히 여유가 있다.
 *
 * 필요: 환경변수 YOUTUBE_API_KEY
 * 없으면 조용히 스킵(파이프라인 비차단)
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { isBrandMention, isIntlBrandMention, badKeyChars } = require('./relevance');

const OUT_PATH = path.join(__dirname, '..', 'data', 'youtube.json');
const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
const VIDEOS_URL = 'https://www.googleapis.com/youtube/v3/videos';
const MAX_RESULTS = 50; // search.list 상한
const STATS_BATCH = 50; // videos.list 는 한 번에 50개까지

const QUERIES = ['엑스와이지 로봇', '엑스와이지 바리스브루', '라운지엑스 로봇카페', '엑스와이지 피지컬AI'];
// 해외 쿼리. 'XYZ robot' 두 개만 돌렸을 때 외신 보도가 통째로 안 잡혔다 — 해외에서는
// 회사명보다 제품명(DEUX·Baris Brew)으로 불린다. 제품명을 쿼리에 넣어야 잡힌다.
const INTL_QUERIES = [
  'XYZ robot barista', 'Korea robot cafe XYZ',
  'XYZ DEUX robot', 'DEUX dual arm robot', 'XYZ physical AI robot', 'Baris Brew robot cafe',
];

// 공식 채널 — 자사 영상과 외부 언급을 섞으면 지표가 왜곡된다.
// 영문 영상도 올리지만 자사 발행분이므로 해외(외부 반응)로 세지 않는다.
const OFFICIAL_CHANNEL_IDS = ['UCIieByJcSRGv9tJQaLMM0wg']; // XYZ(엑스와이지)

const log = (...a) => console.log(`[youtube ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decodeEntities = (s) =>
  String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

async function callApi(url, params, key) {
  const qs = new URLSearchParams({ ...params, key }).toString();
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) {
    const t = await res.text();
    // 쿼터 초과(403 quotaExceeded)는 다음 실행에서 자연히 풀리므로 메시지만 남긴다
    throw new Error(`${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

// 국내/해외는 쿼리가 아니라 내용으로 가른다. 제품명 쿼리('Baris Brew')에는 한국어 영상이
// 대량으로 딸려 오는데, 쿼리 출처로 가르면 그게 전부 해외 탭에 쌓인다.
// 한글이 있거나 공식 채널이면 국내로 본다.
const HANGUL = /[가-힣]/;
const regionOf = (v) =>
  HANGUL.test(`${v.title} ${v.description}`) || OFFICIAL_CHANNEL_IDS.includes(v.channelId)
    ? 'kr'
    : 'overseas';

async function search(query, key, order = 'date') {
  const json = await callApi(
    SEARCH_URL,
    { part: 'snippet', q: query, type: 'video', maxResults: String(MAX_RESULTS), order },
    key
  );
  return (json.items || [])
    .filter((it) => it.id?.videoId)
    .map((it) => ({
      videoId: it.id.videoId,
      title: decodeEntities(it.snippet.title),
      description: decodeEntities(it.snippet.description),
      link: `https://www.youtube.com/watch?v=${it.id.videoId}`,
      channel: decodeEntities(it.snippet.channelTitle),
      channelId: it.snippet.channelId,
      date: (it.snippet.publishedAt || '').slice(0, 10),
      image: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
    }))
    .map((v) => ({ ...v, region: regionOf(v) }));
}

/** 영상 통계(조회수·좋아요·댓글)를 50개씩 끊어 조회 */
async function fetchStats(videoIds, key) {
  const stats = new Map();
  for (let i = 0; i < videoIds.length; i += STATS_BATCH) {
    const batch = videoIds.slice(i, i + STATS_BATCH);
    const json = await callApi(VIDEOS_URL, { part: 'statistics', id: batch.join(',') }, key);
    for (const it of json.items || []) {
      const s = it.statistics || {};
      stats.set(it.id, {
        views: Number(s.viewCount || 0),
        likes: Number(s.likeCount || 0),
        comments: Number(s.commentCount || 0),
      });
    }
    await sleep(150);
  }
  return stats;
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
  } catch {
    return { videos: [] };
  }
}

async function main() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    log('YOUTUBE_API_KEY 없음 — 유튜브 수집 스킵');
    return;
  }
  const bad = badKeyChars('YOUTUBE_API_KEY', key);
  if (bad) {
    log(`유튜브 수집 스킵 — ${bad}`);
    return;
  }

  // 해외 쿼리만 relevance 정렬을 한 번 더 돈다. order=date 는 최신 50건만 주는데
  // 해외 보도는 발행량이 적어 과거 건이 그 창 밖으로 밀려난다(외신 5건 중 3건을 그렇게
  // 놓쳤다). 국내는 발행량이 많아 최신순만으로 충분하므로 쿼터를 더 쓰지 않는다.
  const fresh = [];
  for (const [queries, orders] of [[QUERIES, ['date']], [INTL_QUERIES, ['date', 'relevance']]]) {
    for (const q of queries) {
      try {
        const got = [];
        for (const o of orders) got.push(...(await search(q, key, o)));
        fresh.push(...got);
        log(`'${q}' ${got.length}건`);
      } catch (e) {
        log(`'${q}' 스킵: ${e.message}`);
        // 쿼터 초과면 이후 쿼리도 전부 실패한다 — 지금까지 모은 것만 반영하고 나간다
        if (/quota/i.test(e.message)) { log('쿼터 소진 — 남은 쿼리 중단'); break; }
      }
      await sleep(200);
    }
  }

  const existing = await readExisting();
  const byId = new Map((existing.videos || []).map((v) => [v.videoId, v]));
  const addedIds = new Set();

  for (const v of fresh) {
    if (byId.has(v.videoId)) {
      // 제목·설명은 수정될 수 있으니 최신값으로 덮되, 최초 발견 시각은 지킨다
      const prev = byId.get(v.videoId);
      byId.set(v.videoId, { ...prev, ...v, firstSeenAt: prev.firstSeenAt });
      continue;
    }
    byId.set(v.videoId, { ...v, firstSeenAt: new Date().toISOString() });
    addedIds.add(v.videoId);
  }

  // 조회수는 계속 오르므로 누적분 전체를 갱신한다
  if (byId.size) {
    try {
      const stats = await fetchStats([...byId.keys()], key);
      for (const [id, s] of stats) {
        if (byId.has(id)) byId.set(id, { ...byId.get(id), ...s });
      }
      log(`통계 갱신 ${stats.size}건`);
    } catch (e) {
      log(`통계 갱신 실패(기존 값 유지): ${e.message}`);
    }
  }

  if (byId.size === 0) {
    log('수집된 영상 없음 — 기존 파일 유지');
    return;
  }

  // 관련성 판정은 매번 다시 돌린다 — 규칙을 고치면 과거에 잘못 들어온 것도 함께 정리된다
  // region 도 매번 다시 매긴다. 판정 기준을 고치면 이전 회차에 잘못 분류된 누적분도
  // 다음 실행에서 함께 정리된다 — 관련성 판정과 같은 원칙.
  const videos = [...byId.values()]
    .map((v) => ({ ...v, region: regionOf(v), official: OFFICIAL_CHANNEL_IDS.includes(v.channelId) }))
    .filter((v) =>
      v.region === 'overseas'
        ? isIntlBrandMention(v, { strict: true })
        : isBrandMention(v, { requireAnchor: true, exempt: v.official })
    )
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const kr = videos.filter((v) => v.region !== 'overseas');
  const out = {
    lastScrapedAt: new Date().toISOString(),
    queries: QUERIES,
    intlQueries: INTL_QUERIES,
    totalVideos: videos.length,
    krVideos: kr.length,
    overseasVideos: videos.length - kr.length,
    channelCount: new Set(videos.map((v) => v.channel)).size,
    totalViews: videos.reduce((s, v) => s + (v.views || 0), 0),
    videos,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  // 신규 건수는 관련성 필터를 통과한 것만 센다. 검색 결과에는 동명이인이 대량으로
  // 섞여 들어와서(1회차 86건 중 13건만 생존) 필터 이전 수를 찍으면 로그가 거짓말을 한다.
  const addedKept = videos.filter((v) => addedIds.has(v.videoId)).length;
  log(
    `저장 완료: 누적 ${videos.length}건 (신규 +${addedKept}건 · 무관 제외 ${byId.size - videos.length}건 · ` +
      `국내 ${out.krVideos} / 해외 ${out.overseasVideos}) ` +
      `· 총 조회수 ${out.totalViews.toLocaleString()} → ${OUT_PATH}`
  );
}

main().catch((err) => {
  console.error('유튜브 수집 오류:', err.message);
  process.exit(0); // 비차단
});
