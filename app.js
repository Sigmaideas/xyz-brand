// 마지막 색은 '기타' 묶음(회색)과 구분되도록 골랐다
const PALETTE = ['#4263eb', '#1f2329', '#7950f2', '#f59f00', '#2f9e44', '#e8590c', '#15aabf', '#e64980', '#5c7cfa', '#868e96'];
const FONT = 'Pretendard, sans-serif';

const BREAKDOWN_TOP_N = 9; // 나머지는 '기타' 로 묶음 — 조각이 많아지면 도넛이 읽히지 않음
const RECENT_LIMIT = 120;
const TOPIC_TOP_N = 12;

let currentSource = 'blog';
let blogData = null;
let newsData = null;
let cafeData = null;
let youtubeData = null;
let trendChart = null;

const SOURCE_PAGE_TITLE = {
  blog: '네이버 블로그 모니터링',
  trend: '엑스와이지 검색어 트렌드',
  news: '엑스와이지 뉴스 모니터링',
  cafe: '네이버 카페 모니터링',
  youtube: '엑스와이지 유튜브 모니터링',
};

const $ = (s) => document.querySelector(s);
const fmtDateTime = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '-');
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function kpiCard({ icon, label, value, sub, accent, valueClass }) {
  return `
    <div class="kpi-card${accent ? ' accent' : ''}">
      <div class="kpi-icon"><i data-lucide="${icon}"></i></div>
      <span class="kpi-label">${label}</span>
      <span class="kpi-value${valueClass ? ' ' + valueClass : ''}">${value}</span>
      <span class="kpi-sub">${sub}</span>
    </div>`;
}

const VIEWS = ['blog', 'trend', 'news', 'cafe', 'youtube'];
function toggleView(view) {
  for (const v of VIEWS) $(`#${v}View`).hidden = v !== view;
}

// ── 공통 집계 ────────────────────────────────────────────────
// 블로그 포스트와 뉴스 기사는 형태가 같다(제목·본문·작성처·날짜).
// 집계와 차트를 한 벌만 두고 작성처 키만 바꿔 쓴다.
function aggregate(items, { sourceKey, topicGroups }) {
  const dated = items.filter((x) => x.date);

  const monthlyByYear = {};
  for (const x of dated) {
    const [y, m] = x.date.split('-');
    if (!monthlyByYear[y]) monthlyByYear[y] = Array.from({ length: 12 }, () => 0);
    monthlyByYear[y][Number(m) - 1]++;
  }

  const sourceCount = new Map();
  for (const x of items) sourceCount.set(x[sourceKey], (sourceCount.get(x[sourceKey]) || 0) + 1);

  const topics = topicGroups.map((g) => ({ word: g.label, count: 0 }));
  for (const x of items) {
    const text = `${x.title} ${x.description || ''}`.toLowerCase();
    topicGroups.forEach((g, i) => {
      if (g.terms.some((t) => text.includes(t))) topics[i].count++;
    });
  }

  const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const sorted = [...dated].sort((a, b) => b.date.localeCompare(a.date));

  return {
    total: items.length,
    monthlyActivity: dated.filter((x) => x.date >= cutoff).length,
    sourceCount: sourceCount.size,
    latestDate: sorted[0]?.date || null,
    monthlyByYear,
    availableYears: Object.keys(monthlyByYear).map(Number).sort((a, b) => b - a),
    breakdown: [...sourceCount.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
    topicFrequency: topics.filter((t) => t.count > 0).sort((a, b) => b.count - a.count).slice(0, TOPIC_TOP_N),
    recent: sorted.slice(0, RECENT_LIMIT),
  };
}

// ── 공통 차트 ────────────────────────────────────────────────
const TOOLTIP = {
  backgroundColor: '#1f2329',
  padding: 10,
  titleFont: { family: FONT, size: 12, weight: '600' },
  bodyFont: { family: FONT, size: 12 },
};
const AXIS_CAT = { grid: { display: false }, ticks: { color: '#9a9fa8', font: { family: FONT, size: 11 } }, border: { color: '#ececf1' } };
const AXIS_NUM = { beginAtZero: true, ticks: { color: '#9a9fa8', font: { family: FONT, size: 11 }, precision: 0 }, grid: { color: '#f0f0f4' }, border: { display: false } };

const emptyMonths = () => Array.from({ length: 12 }, () => 0);

function monthlyBarChart(canvas, months, unit) {
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
      datasets: [{ data: months, backgroundColor: '#4263eb', borderRadius: 6, borderSkipped: false, maxBarThickness: 40 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: (c) => `${c.parsed.y.toLocaleString()}${unit}` } },
      },
      scales: { x: AXIS_CAT, y: AXIS_NUM },
    },
  });
}

function breakdownDoughnut(canvas, all, unit, restUnit) {
  const top = all.slice(0, BREAKDOWN_TOP_N);
  const restCount = all.slice(BREAKDOWN_TOP_N).reduce((sum, p) => sum + p.count, 0);
  const hasRest = restCount > 0;
  const items = hasRest ? [...top, { name: `기타 ${all.length - BREAKDOWN_TOP_N}${restUnit}`, count: restCount }] : top;
  if (!items.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return null;
  }
  // '기타'는 팔레트를 이어 쓰면 앞쪽 항목 색과 겹쳐 보인다 → 회색 고정
  const colors = items.map((_, i) => (hasRest && i === items.length - 1 ? '#c1c5cd' : PALETTE[i % PALETTE.length]));
  const total = items.reduce((sum, p) => sum + p.count, 0);
  return new Chart(canvas, {
    type: 'doughnut',
    data: { labels: items.map((p) => p.name), datasets: [{ data: items.map((p) => p.count), backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { color: '#495057', boxWidth: 10, boxHeight: 10, padding: 12, usePointStyle: true, pointStyle: 'circle', font: { family: FONT, size: 12, weight: '500' } },
        },
        tooltip: { ...TOOLTIP, callbacks: { label: (c) => `${c.label}: ${c.parsed.toLocaleString()}${unit} (${((c.parsed / total) * 100).toFixed(1)}%)` } },
      },
    },
  });
}

function topicsBarChart(canvas, items, mentionLabel) {
  if (!items.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return null;
  }
  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: items.map((t) => t.word),
      datasets: [{ data: items.map((t) => t.count), backgroundColor: '#4263eb', borderRadius: 6, borderSkipped: false, barThickness: 'flex', maxBarThickness: 22 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP, callbacks: { label: (c) => `${c.parsed.x.toLocaleString()}${mentionLabel}` } },
      },
      scales: {
        x: AXIS_NUM,
        y: { ticks: { color: '#495057', font: { family: FONT, size: 12, weight: '500' } }, grid: { display: false }, border: { color: '#ececf1' } },
      },
    },
  });
}

// 수집 시점이 아니라 작성일 기준으로 월을 나눈다 — 같은 날 여러 건이 흔해서 날짜만으로는 덩어리가 커진다
function renderItemList(container, items, { emptyMsg, sourceKey, badge, extra }) {
  if (!items.length) {
    container.innerHTML = `<p class="empty-msg">${emptyMsg}</p>`;
    return;
  }
  let html = '';
  let lastMonth = null;
  for (const x of items) {
    const month = (x.date || '').slice(0, 7);
    if (month && month !== lastMonth) {
      lastMonth = month;
      const [y, m] = month.split('-');
      html += `<div class="news-month">${y}년 ${Number(m)}월</div>`;
    }
    html += `
      <a class="news-item" href="${escapeHtml(x.link)}" target="_blank" rel="noopener noreferrer">
        ${x.image ? `<img class="news-thumb" src="${escapeHtml(x.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ''}
        <div class="news-item-main">
          <span class="news-title">${(badge && badge(x)) || ''}${escapeHtml(x.title)}</span>
          <span class="news-desc">${escapeHtml(x.description || '')}</span>
        </div>
        <div class="news-item-meta">
          <span class="news-press">${escapeHtml(x[sourceKey])}</span>
          <span class="news-date">${escapeHtml(x.date || '-')}</span>
          ${extra ? `<span class="news-extra">${extra(x)}</span>` : ''}
        </div>
      </a>`;
  }
  container.innerHTML = html;
  // 언론사 CDN 이 핫링크를 막거나 사진이 내려가면 깨진 아이콘이 남는다 — 통째로 뺀다
  for (const img of container.querySelectorAll('.news-thumb')) {
    img.addEventListener('error', () => img.remove(), { once: true });
  }
}

function setupYearSelector(select, agg, selected, onChange) {
  const years = agg.availableYears.length ? agg.availableYears : [new Date().getFullYear()];
  const year = selected && years.includes(selected) ? selected : years[0];
  select.innerHTML = years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}년</option>`).join('');
  select.onchange = () => onChange(Number(select.value));
  return year;
}

// ── 네이버 블로그 ────────────────────────────────────────────
// 공식 채널(자사 블로그)과 외부 언급은 성격이 달라 탭으로 나눈다.
// 외부 언급 추이가 실제 브랜드 확산 지표이고, 공식은 발행량 관리용이다.
const BLOG_TOPIC_GROUPS = [
  { label: '로봇·로보틱스', terms: ['로봇', '로보틱스'] },
  { label: '피지컬 AI', terms: ['피지컬 ai', '피지컬ai', '브레인엑스', 'brainx'] },
  { label: '카페·바리스브루', terms: ['카페', '바리스브루', '커피', '바리스타'] },
  { label: '라운지엑스', terms: ['라운지엑스', "lounge'x", 'loungex'] },
  { label: '투자·시리즈', terms: ['투자', '시리즈', '유치'] },
  { label: '채용·조직', terms: ['채용', '공고', '입사', '동료'] },
  { label: '협업·파트너십', terms: ['협력', '협약', 'mou', '파트너', '맞손'] },
  { label: '물류·빌딩', terms: ['물류', '빌딩', 'rbms', '창고'] },
  { label: '전시·행사', terms: ['전시', '엑스포', '박람회', '세미나', '컨퍼런스'] },
  { label: '무인·자동화', terms: ['무인', '자동화', '키오스크'] },
];

let blogScope = 'all';
let blogAgg = null;
let blogSelectedYear = null;
let blogMonthlyChart = null;
let blogAuthorsChart = null;
let blogTopicsChart = null;

async function loadBlog() {
  toggleView('blog');
  const res = await fetch('data/blog.json', { cache: 'no-store' });
  if (!res.ok) {
    blogData = null;
    $('#lastUpdated').textContent = '-';
    $('#blogKpiRow').innerHTML = '';
    $('#blogScopeTabs').innerHTML = '';
    $('#blogList').innerHTML = '<p class="empty-msg">블로그 데이터가 아직 없습니다. 데이터 갱신 후 표시됩니다.</p>';
    return;
  }
  blogData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(blogData.lastScrapedAt);
  renderBlogScopeTabs();
  renderBlog();
}

function blogPosts() {
  const all = blogData.posts || [];
  if (blogScope === 'official') return all.filter((p) => p.official);
  if (blogScope === 'external') return all.filter((p) => !p.official);
  return all;
}

function renderBlogScopeTabs() {
  const total = blogData.totalPosts ?? 0;
  const official = blogData.officialPosts ?? 0;
  const external = blogData.externalPosts ?? 0;
  $('#blogScopeTabs').innerHTML = [
    { key: 'all', label: `전체 ${total}건` },
    { key: 'external', label: `외부 언급 ${external}건` },
    { key: 'official', label: `공식 블로그 ${official}건` },
  ]
    .map((t) => `<button class="scope-tab${blogScope === t.key ? ' active' : ''}" data-scope="${t.key}">${t.label}</button>`)
    .join('');
  $('#blogScopeHint').textContent = {
    all: '공식·외부를 합친 전체 언급량',
    external: '자사 블로그를 뺀 순수 외부 언급 — 브랜드 확산 지표',
    official: '엑스와이지·라운지랩 공식 블로그 발행량',
  }[blogScope];
  $('#blogScopeTabs').querySelectorAll('.scope-tab').forEach((btn) => {
    btn.onclick = () => {
      if (blogScope === btn.dataset.scope) return;
      blogScope = btn.dataset.scope;
      blogSelectedYear = null; // 탭마다 포스트가 있는 연도가 다르다
      renderBlogScopeTabs();
      renderBlog();
    };
  });
}

function renderBlog() {
  blogAgg = aggregate(blogPosts(), { sourceKey: 'blogger', topicGroups: BLOG_TOPIC_GROUPS });
  const d = blogAgg;
  const scopeSub = { all: '공식 + 외부', external: '외부 블로거 작성', official: '자사 발행' }[blogScope];
  $('#blogKpiRow').innerHTML = [
    kpiCard({ icon: 'file-text', label: '총 포스트 수', value: d.total.toLocaleString(), sub: scopeSub }),
    kpiCard({ icon: 'users', label: '작성 블로거', value: d.sourceCount.toLocaleString(), sub: '명' }),
    kpiCard({ icon: 'calendar', label: '최신 포스트', value: d.latestDate || '-', sub: '가장 최근 작성일', valueClass: 'kpi-date' }),
    kpiCard({ icon: 'activity', label: '월간 발행량', value: d.monthlyActivity.toLocaleString(), sub: '최근 30일 포스트', accent: true }),
  ].join('');
  if (window.lucide) window.lucide.createIcons();

  const redrawMonthly = (y) => {
    if (blogMonthlyChart) blogMonthlyChart.destroy();
    blogMonthlyChart = monthlyBarChart($('#blogMonthly'), d.monthlyByYear[y] || emptyMonths(), '건');
  };
  blogSelectedYear = setupYearSelector($('#blogYearSelect'), d, blogSelectedYear, (y) => {
    blogSelectedYear = y;
    redrawMonthly(y);
  });
  redrawMonthly(blogSelectedYear);

  if (blogAuthorsChart) blogAuthorsChart.destroy();
  blogAuthorsChart = breakdownDoughnut($('#blogAuthors'), d.breakdown, '건', '명');
  if (blogTopicsChart) blogTopicsChart.destroy();
  blogTopicsChart = topicsBarChart($('#blogTopics'), d.topicFrequency, '개 포스트에서 언급');

  renderItemList($('#blogList'), d.recent, {
    emptyMsg: '수집된 포스트가 없습니다.',
    sourceKey: 'blogger',
    badge: (p) => (p.official ? '<span class="tag-official">공식</span>' : ''),
  });
}

// ── 검색어 트렌드 ────────────────────────────────────────────
async function loadTrend() {
  toggleView('trend');
  let trend = null;
  try {
    const res = await fetch('data/trend.json', { cache: 'no-store' });
    if (res.ok) trend = await res.json();
  } catch {
    trend = null;
  }
  if (!trend?.groups?.length || !trend.groups[0].data?.length) {
    $('#lastUpdated').textContent = '-';
    $('#trendKpiRow').innerHTML = '';
    $('#trendCard').hidden = true;
    $('#trendNote').innerHTML =
      '<p class="empty-msg">검색어 트렌드 데이터가 아직 없습니다.<br>' +
      '네이버 데이터랩 API 키(NAVER_CLIENT_ID / NAVER_CLIENT_SECRET)가 설정돼야 수집됩니다.</p>';
    return;
  }
  $('#lastUpdated').textContent = fmtDateTime(trend.lastScrapedAt);
  $('#trendCard').hidden = false;

  const series = trend.groups[0].data;
  const latest = series[series.length - 1];
  const prev = series[series.length - 2];
  const peak = series.reduce((a, b) => (b.ratio > a.ratio ? b : a));
  const avg = series.reduce((s, d) => s + d.ratio, 0) / series.length;
  const delta = prev ? latest.ratio - prev.ratio : 0;
  $('#trendKpiRow').innerHTML = [
    kpiCard({ icon: 'activity', label: '최근 관심도', value: latest.ratio.toFixed(1), sub: `${latest.period} 주간`, accent: true }),
    kpiCard({ icon: delta >= 0 ? 'trending-up' : 'trending-down', label: '전주 대비', value: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`, sub: '지수 변화' }),
    kpiCard({ icon: 'award', label: '기간 내 최고', value: peak.ratio.toFixed(1), sub: peak.period, valueClass: 'kpi-date' }),
    kpiCard({ icon: 'bar-chart-2', label: '평균 관심도', value: avg.toFixed(1), sub: '최근 1년 주간 평균' }),
  ].join('');
  if (window.lucide) window.lucide.createIcons();

  drawTrend(trend);
  $('#trendNote').innerHTML =
    '<p class="note-text">네이버 데이터랩은 절대 검색량이 아니라 <strong>상대 지수</strong>를 줍니다. ' +
    '기간 내 검색량이 가장 많았던 주를 100으로 두고 나머지를 환산한 값이라, ' +
    '다른 브랜드나 다른 기간의 숫자와 그대로 비교할 수 없습니다. ' +
    '읽어야 할 것은 값 자체가 아니라 <strong>추세와 급등 시점</strong>입니다.</p>';
}

function drawTrend(trend) {
  if (trendChart) trendChart.destroy();
  trendChart = new Chart($('#trend'), {
    type: 'line',
    data: {
      labels: trend.groups[0].data.map((d) => d.period),
      datasets: trend.groups.map((grp, i) => ({
        label: grp.title,
        data: grp.data.map((d) => d.ratio),
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: i === 0 ? 'rgba(66, 99, 235, 0.08)' : 'transparent',
        borderWidth: 2.5,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 5,
        fill: i === 0,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: trend.groups.length > 1,
          position: 'top',
          align: 'end',
          labels: { color: '#495057', boxWidth: 10, boxHeight: 10, padding: 14, usePointStyle: true, pointStyle: 'circle', font: { family: FONT, size: 12, weight: '500' } },
        },
        tooltip: { ...TOOLTIP, callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y.toFixed(1)}` } },
      },
      scales: {
        x: { ...AXIS_CAT, ticks: { ...AXIS_CAT.ticks, maxTicksLimit: 8 } },
        y: { ...AXIS_NUM, max: 100 },
      },
    },
  });
}

// ── 뉴스 ────────────────────────────────────────────────────
// 탭 두 개는 서로 겹치지 않는다 — 각각 따로 본다.
//  kr       = 국내 매체의 '엑스와이지' 보도
//  overseas = 해외 매체 보도 (언어권 무관)
const NEWS_TOPIC_GROUPS = [
  { label: '로봇·자동화', terms: ['로봇', '자동화', '무인'] },
  { label: '피지컬 AI', terms: ['피지컬 ai', '피지컬ai', '브레인엑스', 'brainx', '휴머노이드'] },
  { label: '투자·자금', terms: ['투자', '유치', '시리즈', '펀딩'] },
  { label: '협업·파트너십', terms: ['협력', '협약', 'mou', '파트너', '맞손'] },
  { label: '해외·수출', terms: ['해외', '수출', '글로벌', '진출'] },
  { label: '매출·실적', terms: ['매출', '실적', '흑자', '성장률'] },
  { label: '카페·커피', terms: ['카페', '커피', '바리스브루', '바리스타'] },
  { label: '라운지엑스', terms: ['라운지엑스', "lounge'x", 'loungex'] },
  { label: '물류·빌딩', terms: ['물류', '빌딩', 'rbms', '창고'] },
  { label: '푸드테크·외식', terms: ['푸드테크', '외식', '식음료', 'f&b'] },
];

let newsScope = 'kr';
let newsAgg = null;
let newsSelectedYear = null;
let newsMonthlyChart = null;
let newsPressChart = null;
let newsTopicsChart = null;

async function loadNews() {
  toggleView('news');
  const res = await fetch('data/news.json', { cache: 'no-store' });
  if (!res.ok) {
    newsData = null;
    $('#lastUpdated').textContent = '-';
    $('#newsKpiRow').innerHTML = '';
    $('#newsScopeTabs').innerHTML = '';
    $('#newsList').innerHTML = '<p class="empty-msg">뉴스 데이터가 아직 없습니다. 데이터 갱신 후 표시됩니다.</p>';
    return;
  }
  newsData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(newsData.lastScrapedAt);
  renderNewsScopeTabs();
  renderNews();
}

function newsArticles() {
  const all = newsData.articles || [];
  // region 이 없던 시절 데이터는 전부 국내 수집분이다
  if (newsScope === 'overseas') return all.filter((a) => a.region === 'overseas');
  return all.filter((a) => (a.region || 'kr') === 'kr');
}

function renderNewsScopeTabs() {
  const kr = newsData.krArticles ?? 0;
  const overseas = newsData.overseasArticles ?? 0;
  $('#newsScopeTabs').innerHTML = [
    { key: 'kr', label: `국내 ${kr}건` },
    { key: 'overseas', label: `해외 ${overseas}건` },
  ]
    .map((t) => `<button class="scope-tab${newsScope === t.key ? ' active' : ''}" data-scope="${t.key}">${t.label}</button>`)
    .join('');
  $('#newsScopeHint').textContent = {
    kr: "'엑스와이지'를 직접 언급한 국내 기사",
    overseas: '해외 매체 보도 — 절대량이 적습니다',
  }[newsScope];
  $('#newsScopeTabs').querySelectorAll('.scope-tab').forEach((btn) => {
    btn.onclick = () => {
      if (newsScope === btn.dataset.scope) return;
      newsScope = btn.dataset.scope;
      newsSelectedYear = null; // 탭마다 기사가 있는 연도가 다르다
      renderNewsScopeTabs();
      renderNews();
    };
  });
}

function renderNews() {
  newsAgg = aggregate(newsArticles(), { sourceKey: 'press', topicGroups: NEWS_TOPIC_GROUPS });
  const d = newsAgg;
  const scopeSub = { kr: '국내 매체 보도', overseas: '해외 매체 보도' }[newsScope];
  $('#newsKpiRow').innerHTML = [
    kpiCard({ icon: 'newspaper', label: '총 기사 수', value: d.total.toLocaleString(), sub: scopeSub }),
    kpiCard({ icon: 'building-2', label: '보도 언론사', value: d.sourceCount.toLocaleString(), sub: '곳' }),
    kpiCard({ icon: 'calendar', label: '최신 기사', value: d.latestDate || '-', sub: '가장 최근 보도일', valueClass: 'kpi-date' }),
    kpiCard({ icon: 'activity', label: '월간 보도량', value: d.monthlyActivity.toLocaleString(), sub: '최근 30일 기사', accent: true }),
  ].join('');
  if (window.lucide) window.lucide.createIcons();

  const redrawMonthly = (y) => {
    if (newsMonthlyChart) newsMonthlyChart.destroy();
    newsMonthlyChart = monthlyBarChart($('#newsMonthly'), d.monthlyByYear[y] || emptyMonths(), '건');
  };
  newsSelectedYear = setupYearSelector($('#newsYearSelect'), d, newsSelectedYear, (y) => {
    newsSelectedYear = y;
    redrawMonthly(y);
  });
  redrawMonthly(newsSelectedYear);

  if (newsPressChart) newsPressChart.destroy();
  newsPressChart = breakdownDoughnut($('#newsPress'), d.breakdown, '건', '곳');
  $('#newsPressHint').textContent =
    d.breakdown.length > BREAKDOWN_TOP_N ? `전체 누적 기준 · 상위 ${BREAKDOWN_TOP_N}곳` : '전체 누적 기준';
  if (newsTopicsChart) newsTopicsChart.destroy();
  newsTopicsChart = topicsBarChart($('#newsTopics'), d.topicFrequency, '개 기사에서 언급');

  renderItemList($('#newsList'), d.recent, { emptyMsg: '수집된 기사가 없습니다.', sourceKey: 'press' });
}


// ── 네이버 카페 ──────────────────────────────────────────────
// 카페는 블로그보다 홍보성 글이 적어 외부 언급 지표로 더 정직하다.
// 다만 카페글 검색 API 가 작성일을 주지 않아서 date 가 '발견일' 이다 —
// 월별 그래프는 '작성 추이' 가 아니라 '발견 추이' 이므로 화면에 그렇게 적는다.
const CAFE_TOPIC_GROUPS = [
  { label: '로봇·로보틱스', terms: ['로봇', '로보틱스'] },
  { label: '카페·바리스브루', terms: ['카페', '바리스브루', '커피', '바리스타'] },
  { label: '라운지엑스', terms: ['라운지엑스', "lounge'x", 'loungex'] },
  { label: '피지컬 AI', terms: ['피지컬 ai', '피지컬ai', '브레인엑스', 'brainx'] },
  { label: '후기·방문', terms: ['후기', '방문', '가봤', '다녀', '먹어'] },
  { label: '채용·조직', terms: ['채용', '공고', '입사', '면접'] },
  { label: '투자·주식', terms: ['투자', '시리즈', '유치', '주식', '공모'] },
  { label: '무인·자동화', terms: ['무인', '자동화', '키오스크'] },
  { label: '전시·행사', terms: ['전시', '엑스포', '박람회', '세미나'] },
  { label: '물류·빌딩', terms: ['물류', '빌딩', 'rbms', '창고'] },
];

let cafeAgg = null;
let cafeSelectedYear = null;
let cafeMonthlyChart = null;
let cafeBreakdownChart = null;
let cafeTopicsChart = null;

async function loadCafe() {
  toggleView('cafe');
  let res;
  try {
    res = await fetch('data/cafe.json', { cache: 'no-store' });
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    cafeData = null;
    $('#lastUpdated').textContent = '-';
    $('#cafeKpiRow').innerHTML = '';
    $('#cafeBasisHint').textContent = '';
    $('#cafeList').innerHTML =
      '<p class="empty-msg">카페 데이터가 아직 없습니다.<br />' +
      "네이버 개발자센터에서 애플리케이션에 '검색' API 를 추가하면 수집이 시작됩니다.</p>";
    return;
  }
  cafeData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(cafeData.lastScrapedAt);
  renderCafe();
}

function renderCafe() {
  const posts = cafeData.posts || [];
  cafeAgg = aggregate(posts, { sourceKey: 'cafe', topicGroups: CAFE_TOPIC_GROUPS });
  const d = cafeAgg;
  $('#cafeBasisHint').textContent =
    '카페글 검색 API 는 작성일을 주지 않는다 — 날짜는 이 대시보드가 글을 처음 발견한 날 기준이다';
  $('#cafeKpiRow').innerHTML = [
    kpiCard({ icon: 'file-text', label: '총 글 수', value: d.total.toLocaleString(), sub: '외부 언급' }),
    kpiCard({ icon: 'users-round', label: '언급 카페', value: d.sourceCount.toLocaleString(), sub: '곳' }),
    kpiCard({ icon: 'calendar', label: '최근 발견', value: d.latestDate || '-', sub: '가장 최근 수집일', valueClass: 'kpi-date' }),
    kpiCard({ icon: 'activity', label: '월간 발견량', value: d.monthlyActivity.toLocaleString(), sub: '최근 30일 신규 글', accent: true }),
  ].join('');
  if (window.lucide) window.lucide.createIcons();

  const redrawMonthly = (y) => {
    if (cafeMonthlyChart) cafeMonthlyChart.destroy();
    cafeMonthlyChart = monthlyBarChart($('#cafeMonthly'), d.monthlyByYear[y] || emptyMonths(), '건');
  };
  cafeSelectedYear = setupYearSelector($('#cafeYearSelect'), d, cafeSelectedYear, (y) => {
    cafeSelectedYear = y;
    redrawMonthly(y);
  });
  redrawMonthly(cafeSelectedYear);

  if (cafeBreakdownChart) cafeBreakdownChart.destroy();
  cafeBreakdownChart = breakdownDoughnut($('#cafeBreakdown'), d.breakdown, '건', '곳');
  $('#cafeBreakdownHint').textContent =
    d.breakdown.length > BREAKDOWN_TOP_N ? `전체 누적 기준 · 상위 ${BREAKDOWN_TOP_N}곳` : '전체 누적 기준';
  if (cafeTopicsChart) cafeTopicsChart.destroy();
  cafeTopicsChart = topicsBarChart($('#cafeTopics'), d.topicFrequency, '개 글에서 언급');

  renderItemList($('#cafeList'), d.recent, { emptyMsg: '수집된 글이 없습니다.', sourceKey: 'cafe' });
}

// ── 유튜브 ───────────────────────────────────────────────────
// 다른 수집원과 달리 조회수라는 정량 지표가 있다. 영상 편수보다 조회수가
// 실제 도달을 더 잘 보여주므로 KPI 와 별도 차트로 같이 보여준다.
const YOUTUBE_TOPIC_GROUPS = [
  { label: '로봇·로보틱스', terms: ['로봇', '로보틱스', 'robot'] },
  { label: '카페·바리스브루', terms: ['카페', '바리스브루', '커피', '바리스타', 'cafe', 'coffee', 'barista'] },
  { label: '라운지엑스', terms: ['라운지엑스', "lounge'x", 'loungex'] },
  { label: '피지컬 AI', terms: ['피지컬 ai', '피지컬ai', '브레인엑스', 'brainx', 'humanoid', '휴머노이드'] },
  { label: '리뷰·체험', terms: ['리뷰', '후기', '체험', '먹방', 'review'] },
  { label: '시연·데모', terms: ['시연', '데모', 'demo', '작동'] },
  { label: '투자·기업', terms: ['투자', '시리즈', '유치', 'ir', '기업'] },
  { label: '전시·행사', terms: ['전시', '엑스포', '박람회', 'ces', 'expo'] },
  { label: '무인·자동화', terms: ['무인', '자동화', '키오스크'] },
  { label: '뉴스·보도', terms: ['뉴스', '보도', '취재', 'news'] },
];

let youtubeScope = 'kr';
let youtubeAgg = null;
let youtubeSelectedYear = null;
let youtubeMonthlyChart = null;
let youtubeChannelsChart = null;
let youtubeTopViewsChart = null;

const fmtViews = (n) => {
  const v = Number(n || 0);
  if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}만`;
  return v.toLocaleString();
};

async function loadYoutube() {
  toggleView('youtube');
  let res;
  try {
    res = await fetch('data/youtube.json', { cache: 'no-store' });
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    youtubeData = null;
    $('#lastUpdated').textContent = '-';
    $('#youtubeKpiRow').innerHTML = '';
    $('#youtubeScopeTabs').innerHTML = '';
    $('#youtubeScopeHint').textContent = '';
    $('#youtubeList').innerHTML =
      '<p class="empty-msg">유튜브 데이터가 아직 없습니다.<br />' +
      'YouTube Data API 키(YOUTUBE_API_KEY)가 설정돼야 수집됩니다.</p>';
    return;
  }
  youtubeData = await res.json();
  $('#lastUpdated').textContent = fmtDateTime(youtubeData.lastScrapedAt);
  renderYoutubeScopeTabs();
  renderYoutube();
}

function youtubeVideos() {
  const all = youtubeData.videos || [];
  if (youtubeScope === 'overseas') return all.filter((v) => v.region === 'overseas');
  return all.filter((v) => (v.region || 'kr') === 'kr');
}

function renderYoutubeScopeTabs() {
  const kr = youtubeData.krVideos ?? 0;
  const overseas = youtubeData.overseasVideos ?? 0;
  $('#youtubeScopeTabs').innerHTML = [
    { key: 'kr', label: `국내 ${kr}편` },
    { key: 'overseas', label: `해외 ${overseas}편` },
  ]
    .map((t) => `<button class="scope-tab${youtubeScope === t.key ? ' active' : ''}" data-scope="${t.key}">${t.label}</button>`)
    .join('');
  $('#youtubeScopeHint').textContent = {
    kr: "'엑스와이지'를 언급한 국내 영상",
    overseas: '해외 채널 영상 — 절대량이 적습니다',
  }[youtubeScope];
  $('#youtubeScopeTabs').querySelectorAll('.scope-tab').forEach((btn) => {
    btn.onclick = () => {
      if (youtubeScope === btn.dataset.scope) return;
      youtubeScope = btn.dataset.scope;
      youtubeSelectedYear = null; // 탭마다 영상이 있는 연도가 다르다
      renderYoutubeScopeTabs();
      renderYoutube();
    };
  });
}

function renderYoutube() {
  const videos = youtubeVideos();
  youtubeAgg = aggregate(videos, { sourceKey: 'channel', topicGroups: YOUTUBE_TOPIC_GROUPS });
  const d = youtubeAgg;
  const views = videos.reduce((sum, v) => sum + (v.views || 0), 0);
  const scopeSub = { kr: '국내 채널', overseas: '해외 채널' }[youtubeScope];
  $('#youtubeKpiRow').innerHTML = [
    kpiCard({ icon: 'youtube', label: '총 영상 수', value: d.total.toLocaleString(), sub: scopeSub }),
    kpiCard({ icon: 'eye', label: '누적 조회수', value: fmtViews(views), sub: `${views.toLocaleString()}회` }),
    kpiCard({ icon: 'tv', label: '게시 채널', value: d.sourceCount.toLocaleString(), sub: '곳' }),
    kpiCard({ icon: 'activity', label: '월간 게시량', value: d.monthlyActivity.toLocaleString(), sub: '최근 30일 영상', accent: true }),
  ].join('');
  if (window.lucide) window.lucide.createIcons();

  const redrawMonthly = (y) => {
    if (youtubeMonthlyChart) youtubeMonthlyChart.destroy();
    youtubeMonthlyChart = monthlyBarChart($('#youtubeMonthly'), d.monthlyByYear[y] || emptyMonths(), '편');
  };
  youtubeSelectedYear = setupYearSelector($('#youtubeYearSelect'), d, youtubeSelectedYear, (y) => {
    youtubeSelectedYear = y;
    redrawMonthly(y);
  });
  redrawMonthly(youtubeSelectedYear);

  if (youtubeChannelsChart) youtubeChannelsChart.destroy();
  youtubeChannelsChart = breakdownDoughnut($('#youtubeChannels'), d.breakdown, '편', '곳');
  $('#youtubeChannelHint').textContent =
    d.breakdown.length > BREAKDOWN_TOP_N ? `전체 누적 기준 · 상위 ${BREAKDOWN_TOP_N}곳` : '전체 누적 기준';

  // 조회수 상위 — 가로 막대 차트를 주제 차트와 같은 모양으로 재사용한다.
  // 제목이 길면 축 라벨이 차트를 잡아먹어서 잘라 쓴다.
  const topViews = [...videos]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 10)
    .map((v) => ({ word: v.title.length > 28 ? `${v.title.slice(0, 27)}…` : v.title, count: v.views || 0 }));
  if (youtubeTopViewsChart) youtubeTopViewsChart.destroy();
  youtubeTopViewsChart = topicsBarChart($('#youtubeTopViews'), topViews, '회 조회');

  renderItemList($('#youtubeList'), d.recent, {
    emptyMsg: '수집된 영상이 없습니다.',
    sourceKey: 'channel',
    extra: (v) => `조회 ${fmtViews(v.views)}`,
  });
}

// ── 라우팅 ───────────────────────────────────────────────────
async function load() {
  if (currentSource === 'trend') return loadTrend();
  if (currentSource === 'news') return loadNews();
  if (currentSource === 'cafe') return loadCafe();
  if (currentSource === 'youtube') return loadYoutube();
  return loadBlog();
}

function showToast(msg, ms = 2400) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), ms);
}

const HAS_BACKEND = ['localhost', '127.0.0.1'].includes(window.location.hostname);

// GitHub Pages 에는 서버가 없어 수집을 직접 못 돌린다. Cloudflare Worker 를 배포하고
// 그 URL 을 여기 채우면 버튼이 GitHub Actions 워크플로우를 실제로 트리거한다.
// 비워두면 버튼은 이미 수집된 데이터를 다시 불러오기만 한다.
const TRIGGER_WORKER_URL = '';

// 수집 스케줄 (update.yml cron: '40 11,23 * * *' UTC = 20:40 / 08:40 KST)
const SCHEDULE_TEXT = '매일 오전·저녁 2회';

if (!HAS_BACKEND) {
  document.addEventListener('DOMContentLoaded', () => {
    const label = document.getElementById('refreshLabel');
    const btn = document.getElementById('refreshBtn');
    if (label) label.textContent = TRIGGER_WORKER_URL ? '데이터 업데이트' : '데이터 새로고침';
    if (btn) {
      btn.title = TRIGGER_WORKER_URL
        ? `최신 데이터를 다시 수집합니다 (GitHub Actions 실행, 3~5분 소요).\n자동 수집은 ${SCHEDULE_TEXT}.`
        : `이미 수집된 데이터를 다시 불러옵니다. 이 버튼은 새 데이터를 가져오지 않습니다.\n실제 수집은 ${SCHEDULE_TEXT} GitHub Actions 가 자동 실행합니다.`;
    }
  });
}

// Worker 를 통해 워크플로우를 돌리고 끝날 때까지 상태를 폴링한다
async function runRemoteUpdate(label) {
  label.textContent = '수집 요청 중...';
  const res = await fetch(`${TRIGGER_WORKER_URL}/trigger`, { method: 'POST' });
  if (!res.ok) throw new Error(`트리거 실패 (${res.status})`);
  showToast('수집을 시작했습니다. 3~5분 정도 걸립니다.', 4000);

  const started = Date.now();
  const LIMIT_MS = 10 * 60 * 1000; // 무한 폴링 방지
  while (Date.now() - started < LIMIT_MS) {
    await new Promise((r) => setTimeout(r, 5000));
    const elapsed = Math.floor((Date.now() - started) / 1000);
    label.textContent = `수집 중 ${elapsed}s`;
    let s;
    try {
      s = await (await fetch(`${TRIGGER_WORKER_URL}/status`, { cache: 'no-store' })).json();
    } catch {
      continue; // 일시적 실패는 넘기고 다음 폴링에서 재시도
    }
    if (s.status === 'completed') {
      if (s.conclusion === 'success') {
        await load();
        showToast(`업데이트 완료 · ${elapsed}초 소요`, 3000);
      } else {
        showToast(`수집 실패 (${s.conclusion})`, 5000);
      }
      return;
    }
  }
  showToast('수집이 예상보다 오래 걸립니다. 잠시 후 새로고침해 주세요.', 5000);
}

async function pollUpdate(startMs) {
  while (true) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch('/api/update/status', { cache: 'no-store' });
    const s = await res.json();
    const elapsed = Math.floor((Date.now() - startMs) / 1000);
    if (!s.running) return { ...s, elapsed };
    $('#refreshLabel').textContent = `수집 중 ${elapsed}s`;
    const tail = (s.logTail || []).filter((l) => !l.startsWith('[err]')).slice(-1)[0];
    if (tail) showToast(tail.replace(/^\[[^\]]+\]\s*/, ''), 3000);
  }
}

$('#refreshBtn').addEventListener('click', async () => {
  const btn = $('#refreshBtn');
  const label = $('#refreshLabel');
  const originalText = label.textContent;
  btn.disabled = true;
  btn.classList.add('spinning');
  const start = Date.now();

  // 트렌드·뉴스는 로컬 서버의 블로그 수집 파이프라인(/api/update) 대상이 아니다.
  // 그대로 두면 뉴스 화면에서 누른 버튼이 블로그 수집을 돌리게 되므로 다시 불러오기만 한다.
  const reloadOnly = (!HAS_BACKEND && !TRIGGER_WORKER_URL) || currentSource === 'trend' || currentSource === 'news';

  try {
    if (reloadOnly) {
      label.textContent = '불러오는 중...';
      await load();
      showToast('데이터를 다시 불러왔습니다 (실제 수집은 매일 자동 실행)', 3500);
    } else if (!HAS_BACKEND) {
      await runRemoteUpdate(label);
    } else {
      label.textContent = '시작 중...';
      const res = await fetch('/api/update?source=blog', { method: 'POST' });
      if (res.status === 409) {
        showToast('이미 업데이트가 진행 중입니다', 3000);
      } else if (!res.ok) {
        throw new Error(`서버 응답 ${res.status}`);
      } else {
        showToast('네이버 블로그에서 최신 포스트 가져오는 중... (1~2분)', 4000);
      }
      const final = await pollUpdate(start);
      if (final.ok) {
        await load();
        showToast(`업데이트 완료 · ${final.elapsed}초 소요`, 3000);
      } else {
        showToast(`업데이트 실패: ${final.message || '알 수 없는 오류'}`, 5000);
      }
    }
  } catch (e) {
    showToast(`오류: ${e.message}`, 5000);
  } finally {
    label.textContent = originalText;
    btn.classList.remove('spinning');
    btn.disabled = false;
  }
});

function switchSource(source) {
  if (source === currentSource) return;
  currentSource = source;
  document.querySelectorAll('.nav-item[data-source]').forEach((el) => {
    el.classList.toggle('active', el.dataset.source === source);
  });
  $('#pageTitle').textContent = SOURCE_PAGE_TITLE[source] || '브랜드 모니터링';
  load().catch((err) => showToast(`로드 실패: ${err.message}`, 4000));
}

document.querySelectorAll('.nav-item[data-source]').forEach((el) => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    switchSource(el.dataset.source);
  });
});

if (window.lucide) window.lucide.createIcons();

load().catch((err) => {
  document.body.insertAdjacentHTML(
    'beforeend',
    `<div class="error-banner">데이터 로드 실패: ${escapeHtml(err.message)}<br>먼저 <code>npm run update</code>를 실행해 <code>data/blog.json</code>을 생성하세요.</div>`
  );
});
