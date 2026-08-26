/**
 * '엑스와이지(XYZ)' 기사 수집
 *
 * 수집원 2개를 합쳐서 사용:
 *  1) 구글 뉴스 RSS — 인증 불필요, <source> 로 언론사명까지 제공. 기본 수집원.
 *  2) 네이버 뉴스 검색 API — 키가 있고 앱에 '검색' API 가 등록돼 있을 때만 동작.
 *     (데이터랩 키만 등록된 상태면 401 "Scope Status Invalid" 가 나므로 조용히 건너뛴다)
 *
 * 기사는 시간이 지나면 검색 결과에서 밀려나므로 제목 기준 dedup 으로 누적한다.
 * 공개 정보라 캐시 대신 data/news.json 을 커밋해 그 파일 자체를 누적 저장소로 쓴다.
 *
 * 대상은 운영사 '엑스와이지' 다 — 매장 브랜드 '라운지엑스' 는 별도 대시보드에서 본다.
 * 기사마다 region('kr' = 국내 / 'overseas' = 해외)을 붙여두고,
 * 월별·언론사별·주제어 집계는 대시보드가 선택된 region 으로 직접 계산한다
 * (토글 즉시 반응 + 집계 기준이 한 군데에만 존재).
 */
require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { isBrandMention, isIntlBrandMention, naverKeys } = require('./relevance');

const OUT_PATH = path.join(__dirname, '..', 'data', 'news.json');
const GOOGLE_RSS = 'https://news.google.com/rss/search';
const NAVER_API = 'https://openapi.naver.com/v1/search/news.json';
const NAVER_DISPLAY = 100;
const NAVER_MAX_START = 1000; // API 상한 (start + display <= 1000)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// 표기 흔들림을 커버. 결과는 제목 기준으로 합쳐진다.
// 구 사명 '라운지랩' 은 제외 — 걸리는 기사가 전부 2019~2022년이라 현재 상황과 무관하다
const QUERIES = ['엑스와이지', '엑스와이지 로봇', '엑스와이지 XYZ', '엑스와이지 피지컬AI'];

// 해외 보도는 국문 검색에 거의 안 걸린다.
// 로케일을 바꿔 따로 훑는다 (구글 뉴스는 hl/gl/ceid 로 언어권이 갈린다)
const INTL_QUERIES = [
  { q: 'XYZ Inc Korea robot', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'XYZ robotics Korea barista', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { q: 'XYZ 韓国 ロボット スタートアップ', hl: 'ja', gl: 'JP', ceid: 'JP:ja' },
];

// '엑스와이지' / 'XYZ' 는 동명이 유난히 많다. 실제로 걸려 나오는 것들:
//   엑스와이지 스튜디오(연예기획사) · XYZ로보틱스(중국 물류로봇) · W.XYZ(워커힐 멤버십)
// → 표기가 있어도 아래 동명들에 걸리면 버린다.
// 동명이인 제외·맥락 판정 규칙은 scraper/relevance.js 한 곳에 모아 뒀다.
// 뉴스는 언론사 편집을 거쳐 이미 걸러진 상태라 맥락 단어까지는 요구하지 않는다.
const isBrand = (a) => isBrandMention(a, { requireAnchor: false });
const isOverseasRelevant = (a) => isIntlBrandMention(a);

// region('kr' | 'overseas') 판정. 브랜드와 무관하면 null → 저장에서 제외
function classify(a) {
  if (a.region === 'overseas') return isOverseasRelevant(a) ? { region: 'overseas' } : null;
  return isBrand(a) ? { region: 'kr' } : null;
}

// 네이버 API 는 언론사명을 주지 않아 originallink 도메인으로 판별한다
const PRESS_BY_DOMAIN = {
  'chosun.com': '조선일보', 'biz.chosun.com': '조선비즈', 'donga.com': '동아일보',
  'joongang.co.kr': '중앙일보', 'joins.com': '중앙일보', 'hani.co.kr': '한겨레',
  'khan.co.kr': '경향신문', 'seoul.co.kr': '서울신문', 'hankookilbo.com': '한국일보',
  'mk.co.kr': '매일경제', 'hankyung.com': '한국경제', 'sedaily.com': '서울경제',
  'edaily.co.kr': '이데일리', 'fnnews.com': '파이낸셜뉴스', 'mt.co.kr': '머니투데이',
  'asiae.co.kr': '아시아경제', 'heraldcorp.com': '헤럴드경제', 'etnews.com': '전자신문',
  'zdnet.co.kr': '지디넷코리아', 'dt.co.kr': '디지털타임스', 'inews24.com': '아이뉴스24',
  'bloter.net': '블로터', 'venturesquare.net': '벤처스퀘어', 'platum.kr': '플래텀',
  'thebell.co.kr': '더벨', 'newspim.com': '뉴스핌', 'newsis.com': '뉴시스',
  'yna.co.kr': '연합뉴스', 'news1.kr': '뉴스1', 'ajunews.com': '아주경제',
  'kmib.co.kr': '국민일보', 'segye.com': '세계일보', 'munhwa.com': '문화일보',
  'ohmynews.com': '오마이뉴스', 'nocutnews.co.kr': 'CBS노컷뉴스', 'sbs.co.kr': 'SBS',
  'kbs.co.kr': 'KBS', 'imbc.com': 'MBC', 'ytn.co.kr': 'YTN', 'jtbc.co.kr': 'JTBC',
  'mbn.co.kr': 'MBN', 'wowtv.co.kr': '한국경제TV', 'businesspost.co.kr': '비즈니스포스트',
  'theguru.co.kr': '더구루', 'startupn.kr': '스타트업엔', 'techm.kr': '테크M',
  'dailian.co.kr': '데일리안', 'ddaily.co.kr': '디지털데일리', 'newsway.co.kr': '뉴스웨이',
  'kukinews.com': '쿠키뉴스', 'wikitree.co.kr': '위키트리', 'insight.co.kr': '인사이트',
  'tf.co.kr': '더팩트', 'g-enews.com': '글로벌이코노믹', 'ilyosisa.co.kr': '일요시사',
};

const log = (...a) => console.log(`[news ${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

const unwrapCdata = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();

// pubDate → KST 기준 YYYY-MM-DD
function kstDate(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return null;
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// dedup 키: 같은 기사가 수집원마다 다른 URL 로 오므로 링크가 아니라 제목으로 묶는다.
// \W 를 쓰면 한글까지 지워져 제목이 통째로 빈 문자열이 되므로 유니코드 속성으로 문자·숫자만 남긴다
const titleKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function pressFromDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (PRESS_BY_DOMAIN[host]) return PRESS_BY_DOMAIN[host];
    const parts = host.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const base = parts.slice(i).join('.');
      if (PRESS_BY_DOMAIN[base]) return PRESS_BY_DOMAIN[base];
    }
    return host;
  } catch {
    return '기타';
  }
}

// ── 구글 뉴스 RSS ────────────────────────────────────────────
async function collectGoogle(query, locale = { hl: 'ko', gl: 'KR', ceid: 'KR:ko' }, region = 'kr') {
  const url = `${GOOGLE_RSS}?q=${encodeURIComponent(query)}&hl=${locale.hl}&gl=${locale.gl}&ceid=${locale.ceid}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`구글 뉴스 RSS ${res.status}`);
  const xml = await res.text();
  const items = xml.split('<item>').slice(1);
  const out = [];
  for (const raw of items) {
    const pick = (re) => decodeEntities(unwrapCdata((raw.match(re) || [])[1] || ''));
    const rawTitle = pick(/<title>([\s\S]*?)<\/title>/);
    const press = pick(/<source[^>]*>([\s\S]*?)<\/source>/);
    // 구글 뉴스 제목은 "기사 제목 - 언론사" 형식이라 꼬리를 떼어낸다
    const title = press && rawTitle.endsWith(` - ${press}`)
      ? rawTitle.slice(0, -(press.length + 3)).trim()
      : rawTitle;
    if (!title) continue;
    out.push({
      title,
      description: '',
      link: pick(/<link>([\s\S]*?)<\/link>/),
      press: press || '기타',
      date: kstDate(pick(/<pubDate>([\s\S]*?)<\/pubDate>/)),
      source: 'google',
      region,
    });
  }
  log(`구글 뉴스[${locale.hl}] '${query}' → ${out.length}건`);
  return out;
}

// ── 네이버 뉴스 검색 API (선택) ──────────────────────────────
async function collectNaver(query, id, secret) {
  const out = [];
  for (let start = 1; start + NAVER_DISPLAY - 1 <= NAVER_MAX_START; start += NAVER_DISPLAY) {
    const url = `${NAVER_API}?query=${encodeURIComponent(query)}&display=${NAVER_DISPLAY}&start=${start}&sort=date`;
    const res = await fetch(url, {
      headers: { 'X-Naver-Client-Id': id, 'X-Naver-Client-Secret': secret },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`${res.status} ${t.slice(0, 120)}`);
    }
    const json = await res.json();
    const batch = json.items || [];
    for (const it of batch) {
      const link = it.originallink || it.link;
      const title = decodeEntities(it.title);
      if (!title || !link) continue;
      out.push({
        title,
        description: decodeEntities(it.description),
        link,
        press: pressFromDomain(link),
        date: kstDate(it.pubDate),
        source: 'naver',
        region: 'kr',
      });
    }
    if (batch.length < NAVER_DISPLAY) break;
    await sleep(120);
  }
  log(`네이버 뉴스 '${query}' → ${out.length}건`);
  return out;
}

async function loadExisting() {
  try { return JSON.parse(await fs.readFile(OUT_PATH, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return { articles: [] }; throw e; }
}

function dedupe(prev, fresh, runIso) {
  const byKey = new Map(prev.map((a) => [titleKey(a.title), a]));
  let added = 0;
  for (const a of fresh) {
    const key = titleKey(a.title);
    if (!key) continue;
    const hit = byKey.get(key);
    if (!hit) {
      byKey.set(key, { ...a, firstSeenAt: runIso });
      added++;
      continue;
    }
    // 이미 있는 기사면 더 나은 정보로 보강 — 네이버 쪽 요약과 원문 링크가 더 유용하다
    if (!hit.description && a.description) hit.description = a.description;
    if (hit.source === 'google' && a.source === 'naver') {
      hit.link = a.link;
      hit.press = a.press;
      hit.source = 'naver';
    }
    if (!hit.date && a.date) hit.date = a.date;
  }
  return { merged: [...byKey.values()], added };
}

// ── 기사 썸네일 ────────────────────────────────────────────
//
// 구글 뉴스 RSS 링크(news.google.com/rss/articles/CBMi...)는 원문 URL 을 감춘 토큰이고,
// 그 페이지의 og:image 는 전 기사가 똑같은 구글 뉴스 앱 아이콘이다 — 기사 사진이 아니다.
// 토큰은 JS 로만 원문으로 튕기므로 실제 브라우저로 따라가서 원문의 og:image 를 읽는다.
//
// 기사 1건당 3~6초. 매 회차 전체를 훑으면 워크플로우 20분 예산을 넘기므로
// image 필드가 아직 없는 기사만, 회차당 THUMB_LIMIT 건까지만 처리한다.
// 사진을 못 찾은 기사는 image: null 로 남겨 다음 회차에 다시 시도하지 않는다.
const THUMB_LIMIT = Number(process.env.THUMB_LIMIT || 40);
const THUMB_CONCURRENCY = 3;

async function resolveThumb(ctx, article) {
  const page = await ctx.newPage();
  try {
    await page.goto(article.link, { waitUntil: 'domcontentloaded', timeout: 25000 });
    if (new URL(page.url()).host.includes('news.google.com')) {
      await page.waitForURL((u) => !u.host.includes('news.google.com'), { timeout: 15000 });
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    }
    const raw = await page.evaluate(() => {
      const meta = (sel) => document.querySelector(sel)?.content?.trim() || '';
      return meta('meta[property="og:image"]')
        || meta('meta[name="twitter:image"]')
        || meta('meta[property="twitter:image"]')
        || meta('meta[name="twitter:image:src"]');
    });
    if (!raw) return null;
    // 상대경로로 넣는 언론사가 있어 원문 URL 기준으로 절대경로화한다
    const abs = new URL(raw, page.url());
    return abs.protocol === 'https:' || abs.protocol === 'http:' ? abs.href : null;
  } catch (e) {
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function attachThumbnails(articles) {
  const todo = articles.filter((a) => a.image === undefined && a.link).slice(0, THUMB_LIMIT);
  const pending = articles.filter((a) => a.image === undefined && a.link).length;
  if (todo.length === 0) {
    log('썸네일: 새로 받을 기사 없음');
    return;
  }

  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    log('썸네일: playwright 없음 — 건너뜀');
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ userAgent: UA });
  // 메타태그만 필요하다. 이미지·폰트·미디어는 받지 않는다 (기사당 수 MB 절약)
  await ctx.route('**/*', (route) => {
    const t = route.request().resourceType();
    return t === 'image' || t === 'font' || t === 'media' ? route.abort() : route.continue();
  });

  let found = 0;
  const queue = [...todo];
  const workers = Array.from({ length: THUMB_CONCURRENCY }, async () => {
    while (queue.length) {
      const a = queue.shift();
      a.image = await resolveThumb(ctx, a);
      if (a.image) found++;
    }
  });
  await Promise.all(workers);
  await browser.close().catch(() => {});

  const rest = Math.max(0, pending - todo.length);
  log(`썸네일: ${todo.length}건 시도 → ${found}건 확보${rest ? ` (남은 ${rest}건은 다음 회차)` : ''}`);
}

async function main() {
  const fresh = [];

  for (const q of QUERIES) {
    try {
      fresh.push(...(await collectGoogle(q)));
    } catch (e) {
      log(`구글 뉴스 '${q}' 실패: ${e.message}`);
    }
    await sleep(300);
  }

  for (const { q, ...locale } of INTL_QUERIES) {
    try {
      fresh.push(...(await collectGoogle(q, locale, 'overseas')));
    } catch (e) {
      log(`해외 뉴스 '${q}' 실패: ${e.message}`);
    }
    await sleep(300);
  }

  const keys = naverKeys();
  if (keys.reason) {
    log(`네이버 뉴스 건너뜀 — ${keys.reason} (구글 뉴스만 수집)`);
  } else {
    const { id, secret } = keys;
    for (const q of QUERIES) {
      try {
        fresh.push(...(await collectNaver(q, id, secret)));
      } catch (e) {
        // 앱에 '검색' API 가 등록 안 된 흔한 케이스 — 구글 결과는 살리고 넘어간다
        log(`네이버 뉴스 '${q}' 스킵: ${e.message}`);
        break;
      }
      await sleep(200);
    }
  }

  if (fresh.length === 0) {
    log('수집된 기사 없음 — 기존 파일 유지');
    return;
  }

  const relevant = fresh.filter((a) => classify(a));
  log(`관련 기사 ${relevant.length}건 / 검색 결과 ${fresh.length}건 (무관 ${fresh.length - relevant.length}건 제외)`);

  const existing = await loadExisting();
  const runIso = new Date().toISOString();
  const { merged, added } = dedupe(existing.articles || [], relevant, runIso);

  // region 은 제목·요약에서 매번 다시 계산한다 — 판정 규칙을 고쳐도 기존 누적분이 알아서 갱신됨
  // (지난 규칙으로 저장된 운영사 기사도 이 단계에서 함께 걸러진다)
  const articles = merged
    .map((a) => {
      const c = classify(a);
      if (!c) return null;
      const { scope, ...rest } = a; // 더 이상 쓰지 않는 필드 제거
      return { ...rest, ...c };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  // 최신 기사부터 채운다 — 목록 상단이 먼저 채워져야 눈에 보인다
  await attachThumbnails(articles);

  const krCount = articles.filter((a) => a.region === 'kr').length;
  const overseasCount = articles.length - krCount;
  const out = {
    lastScrapedAt: runIso,
    queries: QUERIES,
    intlQueries: INTL_QUERIES.map((x) => x.q),
    totalArticles: articles.length,
    krArticles: krCount,
    overseasArticles: overseasCount,
    articles,
  };
  await fs.mkdir(path.dirname(OUT_PATH), { recursive: true });
  await fs.writeFile(OUT_PATH, JSON.stringify(out, null, 2), 'utf8');
  log(`저장 완료: 누적 ${articles.length}건 (신규 +${added}건 · 국내 ${krCount} / 해외 ${overseasCount}) → ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('뉴스 수집 오류:', err.message);
  process.exit(0); // 비차단
});
