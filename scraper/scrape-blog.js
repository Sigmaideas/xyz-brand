/**
 * 네이버 블로그 '엑스와이지' 언급 포스트 수집
 *
 * 수집 경로가 두 가지고, 가능한 쪽을 자동으로 고른다:
 *   1) 네이버 검색 API — 앱에 '검색' API 가 등록돼 있을 때. HTML 변경에 안 깨지고 빠르다.
 *   2) 통합검색 블로그 탭 (Playwright) — 위가 401 이거나 키가 없을 때의 대체 경로.
 *      검색 결과 HTML 은 클래스명이 난독화돼 있어 바뀌기 쉬우므로,
 *      상대적으로 안정적인 data-template-id 속성과 blog.naver.com URL 패턴으로만 뽑는다.
 *
 * 포스트는 시간이 지나면 검색 결과에서 밀려나므로 URL 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/blog.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 *
 * '3일 전' 같은 상대 표기는 수집 시점에 절대 날짜로 바꿔 저장한다 — 그대로 두면 의미가 변한다.
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { chromium } = require('playwright');
const { isBrandMention, naverKeys } = require('./relevance');

const OUT_PATH = path.join(__dirname, '..', 'data', 'blog.json');
const SEARCH_URL = 'https://search.naver.com/search.naver';
const HEADLESS = process.env.HEADLESS !== 'false';
const PAGES_PER_QUERY = 4; // 한 페이지 30건 → 쿼리당 최대 120건
const PAGE_SIZE = 30;

// 표기 흔들림 커버. 결과는 포스트 URL 기준으로 합쳐진다.
// 'XYZ 로보틱스' 는 넣지 않는다 — 동명의 중국 물류로봇 회사 글만 잔뜩 걸린다
const QUERIES = ['엑스와이지', '엑스와이지 로봇', '엑스와이지 XYZ', '엑스와이지 바리스브루'];

// 공식 채널은 따로 구분한다 — 자사 홍보글과 외부 언급을 섞으면 지표가 왜곡된다
const OFFICIAL_BLOG_IDS = ['xyz_inc', 'lounge_lab'];

// 동명이인 제외·맥락 판정 규칙은 scraper/relevance.js 한 곳에 모아 뒀다.
// 공식 블로그 글은 맥락 조건을 면제한다(웰컴키트·행사 공지처럼 앵커가 없는 글이 있다).
const isRelevant = (p) =>
  isBrandMention(p, { requireAnchor: true, exempt: OFFICIAL_BLOG_IDS.includes(p.bloggerId) });

const API_URL = 'https://openapi.naver.com/v1/search/blog.json';
const API_DISPLAY = 100;
const API_PAGES = 3;

const stripTags = (s) =>
  String(s || '').replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

const log = (...a) => console.log(`[blog ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// KST 기준 YYYY-MM-DD
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const shiftDays = (days) =>
  new Date(Date.now() + 9 * 3600 * 1000 - days * 86400 * 1000).toISOString().slice(0, 10);

// 네이버는 '2026.03.10.' 같은 절대 표기와 '3일 전' 같은 상대 표기를 섞어 쓴다.
// 상대 표기는 수집 시점 기준으로 절대 날짜로 환산한다(근사값이라도 월별 집계엔 충분).
function parseDate(raw) {
  const s = String(raw || '').trim();
  const abs = s.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (abs) {
    const [, y, m, d] = abs;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  if (/^(오늘|방금 전|\d+\s*(분|시간)\s*전)$/.test(s)) return kstToday();
  if (/^어제$/.test(s)) return shiftDays(1);
  const rel = s.match(/^(\d+)\s*(일|주|개월|년)\s*전$/);
  if (rel) {
    const n = Number(rel[1]);
    const per = { 일: 1, 주: 7, 개월: 30, 년: 365 }[rel[2]];
    return shiftDays(n * per);
  }
  return null;
}

// 검색 결과 한 페이지에서 포스트를 뽑는다. 브라우저 컨텍스트에서 실행되는 함수라
// 바깥 스코프를 참조하지 않는다.
function extractItems() {
  const POST_RE = /^https:\/\/blog\.naver\.com\/([^/?#]+)\/(\d+)/;
  const clean = (s) => String(s || '').replace(/새 창 열림/g, ' ').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll('[data-template-id="ugcItem"]')]
    .map((el) => {
      const anchors = [...el.querySelectorAll('a[href]')];
      const postAnchors = anchors.filter((a) => POST_RE.test(a.href));
      if (!postAnchors.length) return null;
      const m = postAnchors[0].href.match(POST_RE);
      // 첫 앵커가 제목, 두 번째가 본문 미리보기 (썸네일만 있는 경우 본문은 비어 있다)
      const texts = postAnchors.map((a) => clean(a.innerText)).filter(Boolean);
      // 작성자 블록은 잎 노드 순서가 [블로그명, 작성일] 로 고정돼 있다.
      // 스크린리더용 문구는 이름·날짜와 섞이므로 먼저 걷어낸다
      const source = el.querySelector('[data-template-id="articleSource"]');
      const leaves = [...(source?.querySelectorAll('*') || [])]
        .filter((n) => !n.childElementCount)
        .map((n) => n.textContent.trim())
        .filter((t) => t && t !== '새 창 열림' && t !== 'Keep에 저장');
      return {
        link: `https://blog.naver.com/${m[1]}/${m[2]}`,
        bloggerId: m[1],
        title: texts[0] || '',
        description: texts[1] || '',
        blogger: leaves[0] || m[1],
        rawDate: leaves[1] || '',
      };
    })
    .filter((x) => x && x.title);
}

/** 네이버 검색 API 경로. postdate(YYYYMMDD) 를 주므로 날짜 환산이 필요 없다. */
async function collectApi(query, id, secret) {
  const out = [];
  for (let i = 0; i < API_PAGES; i++) {
    const start = i * API_DISPLAY + 1;
    if (start > 1000) break; // API 상한
    const url = `${API_URL}?query=${encodeURIComponent(query)}&display=${API_DISPLAY}&start=${start}&sort=date`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
    const items = (await res.json()).items || [];
    for (const it of items) {
      // bloggerlink 는 'blog.naver.com/{id}' 형태 — 없으면 포스트 링크에서 뽑는다
      const m = String(it.bloggerlink || it.link || '').match(/blog\.naver\.com\/([^/?#]+)/);
      const bloggerId = m ? m[1] : '';
      const d = String(it.postdate || '');
      out.push({
        title: stripTags(it.title),
        description: stripTags(it.description),
        link: it.link,
        blogger: stripTags(it.bloggername) || bloggerId,
        bloggerId,
        date: d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null,
        official: OFFICIAL_BLOG_IDS.includes(bloggerId),
      });
    }
    if (items.length < API_DISPLAY) break;
    await sleep(200);
  }
  log(`'${query}' → ${out.length}건 (API)`);
  return out;
}

async function collect(page, query) {
  const out = [];
  for (let i = 0; i < PAGES_PER_QUERY; i++) {
    const start = i * PAGE_SIZE + 1;
    // nso=so:dd → 최신순. 관련도순이면 오래된 글이 위로 올라와 신규 수집이 안 된다
    const url = `${SEARCH_URL}?ssc=tab.blog.all&query=${encodeURIComponent(query)}&nso=so%3Add%2Cp%3Aall&start=${start}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('[data-template-id="ugcItem"]', { timeout: 12000 });
    } catch {
      break; // 결과 없음 = 마지막 페이지
    }
    const items = await page.evaluate(extractItems);
    if (!items.length) break;
    out.push(...items);
    if (items.length < PAGE_SIZE) break;
    await sleep(700);
  }
  const posts = out.map((p) => ({
    title: p.title,
    description: p.description,
    link: p.link,
    blogger: p.blogger || p.bloggerId,
    bloggerId: p.bloggerId,
    date: parseDate(p.rawDate),
    official: OFFICIAL_BLOG_IDS.includes(p.bloggerId),
  }));
  log(`'${query}' → ${posts.length}건`);
  return posts;
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { posts: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const byLink = new Map(prev.map((p) => [p.link, p]));
  let added = 0;
  for (const p of fresh) {
    const hit = byLink.get(p.link);
    if (!hit) {
      byLink.set(p.link, { ...p, firstSeenAt: runIso });
      added++;
      continue;
    }
    // 이미 있으면 빈 칸만 보강한다. date 는 먼저 잡은 값이 실제 작성일에 가깝다
    // (상대 표기를 뒤늦게 다시 환산하면 날짜가 뒤로 밀린다)
    if (!hit.description && p.description) hit.description = p.description;
    if (!hit.date && p.date) hit.date = p.date;
  }
  return { merged: [...byLink.values()], added };
}

/** Playwright 대체 경로 — 브라우저는 이 경로를 탈 때만 띄운다 */
async function collectViaBrowser() {
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ko-KR',
  });
  const out = [];
  try {
    for (const q of QUERIES) {
      try {
        out.push(...(await collect(page, q)));
      } catch (e) {
        log(`'${q}' 실패: ${e.message}`);
      }
      await sleep(900);
    }
  } finally {
    await browser.close();
  }
  return out;
}

/** API 를 먼저 시도하고, 못 쓰면 통합검색 화면으로 내려간다 */
async function collectAll() {
  const keys = naverKeys();
  if (keys.reason) {
    log(`검색 API 미사용(${keys.reason}) — 통합검색 화면으로 수집`);
    return collectViaBrowser();
  }
  try {
    const out = [];
    for (const q of QUERIES) {
      out.push(...(await collectApi(q, keys.id, keys.secret)));
      await sleep(200);
    }
    return out;
  } catch (e) {
    // 앱에 '검색' API 미등록이면 401 — 대체 경로가 있으므로 실패로 보지 않는다
    log(`검색 API 사용 불가(${e.message}) — 통합검색 화면으로 대체`);
    return collectViaBrowser();
  }
}

async function main() {
  const fresh = await collectAll();

  if (!fresh.length) {
    log('수집된 포스트 없음 — 기존 파일 유지');
    return;
  }

  const relevant = fresh.filter(isRelevant);
  log(`관련 포스트 ${relevant.length}건 / 검색 결과 ${fresh.length}건 (무관 ${fresh.length - relevant.length}건 제외)`);

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.posts || [], relevant, runIso);

  // 관련성 판정은 매번 다시 돌린다 — 규칙을 고치면 기존 누적분도 함께 정리된다
  const posts = merged
    .filter(isRelevant)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const officialCount = posts.filter((p) => p.official).length;
  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    totalPosts: posts.length,
    officialPosts: officialCount,
    externalPosts: posts.length - officialCount,
    bloggerCount: new Set(posts.map((p) => p.bloggerId)).size,
    posts,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${posts.length}건 (신규 +${added}건 · 공식 ${officialCount} / 외부 ${out.externalPosts}) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('블로그 수집 오류:', err.message);
  process.exit(0); // 비차단
});
