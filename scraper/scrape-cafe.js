/**
 * 네이버 카페 '엑스와이지' 언급글 수집
 *
 * 카페는 블로그보다 홍보성 글이 적어서 외부 언급 지표로 더 정직하다.
 * 대신 노이즈(동명이인·잡담)가 많아 관련성 판정은 블로그와 같은 강도로 건다.
 *
 * ⚠️ 작성일 주의 — 카페글 검색 API 는 날짜를 주지 않는다.
 *    (블로그 API 의 postdate 에 해당하는 필드가 응답에 없다)
 *    그래서 '처음 수집된 날' 을 date 로 쓴다. 즉 카페 화면의 월별 그래프는
 *    '작성 추이' 가 아니라 '발견 추이' 다. 하루 2회 수집이므로 새 글은 하루 안에
 *    잡히지만, 수집을 시작하기 전에 쓰인 오래된 글은 전부 수집 시작일로 몰린다.
 *
 * 글은 시간이 지나면 검색 결과에서 밀려나므로 URL 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/cafe.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 *
 * 필요: 환경변수 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (앱에 '검색' API 등록 필요)
 * 없거나 스코프 미등록이면 조용히 스킵(파이프라인 비차단)
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { isBrandMention, naverKeys } = require('./relevance');

const OUT_PATH = path.join(__dirname, '..', 'data', 'cafe.json');
const API_URL = 'https://openapi.naver.com/v1/search/cafearticle.json';
const DISPLAY = 100;
const MAX_START = 1000; // API 상한 (start + display <= 1000)
const PAGES_PER_QUERY = 3;

// 표기 흔들림 커버. 결과는 글 URL 기준으로 합쳐진다.
const QUERIES = ['엑스와이지', '엑스와이지 로봇', '엑스와이지 바리스브루', '라운지엑스 로봇'];

const log = (...a) => console.log(`[cafe ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 네이버 검색 API 는 매칭 구간을 <b> 로 감싸 돌려준다. 엔티티도 함께 푼다.
const stripTags = (s) =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();

async function collect(query, id, secret) {
  const out = [];
  for (let page = 0; page < PAGES_PER_QUERY; page++) {
    const start = page * DISPLAY + 1;
    if (start + DISPLAY > MAX_START + DISPLAY) break;

    const url = `${API_URL}?query=${encodeURIComponent(query)}&display=${DISPLAY}&start=${start}&sort=date`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t.slice(0, 160)}`);
    }
    const json = await res.json();
    const items = json.items || [];
    for (const it of items) {
      out.push({
        title: stripTags(it.title),
        description: stripTags(it.description),
        link: it.link,
        cafe: stripTags(it.cafename) || '이름 없는 카페',
        cafeUrl: it.cafeurl || '',
      });
    }
    if (items.length < DISPLAY) break; // 마지막 페이지
    await sleep(200);
  }
  return out;
}

async function readExisting() {
  try {
    return JSON.parse(await fs.readFile(OUT_PATH, 'utf8'));
  } catch {
    return { posts: [] };
  }
}

async function main() {
  const keys = naverKeys();
  if (keys.reason) {
    log(`카페 수집 스킵 — ${keys.reason}`);
    return;
  }

  const fresh = [];
  for (const q of QUERIES) {
    try {
      const got = await collect(q, keys.id, keys.secret);
      fresh.push(...got);
      log(`'${q}' ${got.length}건`);
    } catch (e) {
      // 앱에 '검색' API 가 등록 안 된 흔한 케이스 — 한 번 나면 나머지 쿼리도 같으니 중단
      log(`'${q}' 스킵: ${e.message}`);
      break;
    }
    await sleep(200);
  }

  if (fresh.length === 0) {
    log('수집된 글 없음 — 기존 파일 유지');
    return;
  }

  const existing = await readExisting();
  const byLink = new Map((existing.posts || []).map((p) => [p.link, p]));
  const today = kstToday();
  let added = 0;

  for (const p of fresh) {
    if (!p.link || byLink.has(p.link)) continue;
    byLink.set(p.link, {
      ...p,
      // 카페 API 는 작성일을 주지 않는다 — 발견일로 대신한다(파일 상단 주석 참고)
      date: today,
      dateBasis: 'discovered',
      firstSeenAt: new Date().toISOString(),
    });
    added++;
  }

  // 관련성 판정은 매번 다시 돌린다 — 규칙을 고치면 과거에 잘못 들어온 것도 함께 정리된다
  const posts = [...byLink.values()]
    .filter((p) => isBrandMention(p, { requireAnchor: true }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const out = {
    lastScrapedAt: new Date().toISOString(),
    queries: QUERIES,
    // 화면에서 '작성 추이가 아니다' 를 밝히기 위해 데이터에도 남긴다
    dateBasis: 'discovered',
    totalPosts: posts.length,
    cafeCount: new Set(posts.map((p) => p.cafe)).size,
    posts,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${posts.length}건 (신규 +${added}건 · 카페 ${out.cafeCount}곳) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('카페 수집 오류:', err.message);
  process.exit(0); // 비차단
});
