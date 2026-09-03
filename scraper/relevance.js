/**
 * 브랜드 관련성 판정 (모든 수집기 공용)
 *
 * '엑스와이지' / 'XYZ' 는 동명이 유난히 많아서, 표기만 걸리면 무관한 글이 대량으로 들어온다.
 * EXCLUDE 는 실제로 걸려 나온 것들을 하나씩 넣은 결과다 — 새 오탐은 여기 한 곳에만 추가하면
 * 블로그·뉴스·유튜브에 동시에 반영된다.
 *
 * 수집원마다 노이즈 수준이 달라서 강도만 다르게 쓴다:
 *   뉴스              — 브랜드 표기만 확인 (언론사 편집을 거쳐 이미 걸러진 상태)
 *   블로그·유튜브      — 브랜드 표기 + 로봇/푸드테크 맥락(ANCHORS) 을 함께 요구
 */

// 브랜드 표기 흔들림
const BRAND_TOKENS = ['엑스와이지', 'xyzinc'];

// 브랜드 표기와 함께 나와야 '그 엑스와이지' 로 인정하는 맥락 단어
const ANCHORS = [
  '로봇', '로보틱스', '바리스타', '카페', '무인', '푸드테크', '자동화',
  '라운지엑스', '브레인엑스', '바리스브루', '피지컬ai', '피지컬 ai', '아이스크림',
  '채용', '스타트업', '시리즈b', '기업설명회', '엑스포', '휴머노이드',
];

// 동명이인 — 아래 표기가 보이면 맥락과 무관하게 버린다.
//   엑스와이지 스튜디오(연예기획사) · XYZ로보틱스(중국 물류로봇) · W.XYZ(워커힐 멤버십)
//   엑스와이지 칵테일 · 압구정 엑스와이지포차 · 'W X Y Z' 알파벳 노래 · 후디니 xyzdist()
const EXCLUDE = [
  '엑스와이지스튜디오', 'xyz로보틱스', 'xyzrobotics', '엑스와이지엔터',
  '떠블유엑스와이지', 'w.xyz', '더블유닷', '엑스와이지포차', 'xyzdist',
];

// 해외 판정은 국내보다 빡빡하게. 라틴 문자권에서 'XYZ' 는 좌표계·상품코드·플레이스홀더로
// 아무 데나 나오는 세 글자라 표기만으로는 전혀 못 거른다.
// → 'XYZ' + 한국/로봇 맥락이 같이 있어야 하고, 중국 XYZ Robotics 는 명시적으로 뺀다.
// 일본어·중국어 매체도 수집하므로 해당 표기를 함께 둔다.
const INTL_ANCHORS = ['korea', 'korean', 'seoul', 'robot', 'robotics', 'barista', 'cafe', 'café',
  'coffee', 'foodtech', 'humanoid', 'physical ai',
  '韓国', 'ロボット', 'カフェ', '韩国', '机器人'];
const INTL_EXCLUDE = ['xyz robotics', 'xyzrobotics', 'shanghai', 'w.xyz', '.xyz domain'];

// 공백·따옴표·괄호를 지운 소문자 기준으로 비교한다.
// EXCLUDE/ANCHORS 에 표기를 추가할 때도 그 형태로 적을 것.
const normalize = (x) => `${x.title || ''} ${x.description || ''}`.toLowerCase().replace(/[\s'’·,()㈜]+/g, '');

/**
 * @param {{title: string, description?: string}} item
 * @param {{requireAnchor?: boolean, exempt?: boolean}} opts
 *   requireAnchor — 맥락 단어까지 요구할지 (블로그·유튜브 true, 뉴스 false)
 *   exempt        — 공식 채널처럼 맥락 조건을 면제할 대상 (웰컴키트·행사 공지엔 앵커가 없다)
 */
function isBrandMention(item, { requireAnchor = true, exempt = false } = {}) {
  const t = normalize(item);
  if (EXCLUDE.some((x) => t.includes(x))) return false;
  if (exempt) return true;
  if (!BRAND_TOKENS.some((x) => t.includes(x))) return false;
  return requireAnchor ? ANCHORS.some((x) => t.includes(x)) : true;
}

/** 해외 콘텐츠 — 'xyz' + 한국/로봇 맥락. normalize 가 공백을 지우므로 비교값도 지워 맞춘다. */
function isIntlBrandMention(item) {
  const t = normalize(item);
  if (INTL_EXCLUDE.some((x) => t.includes(x.replace(/\s+/g, '')))) return false;
  return t.includes('xyz') && INTL_ANCHORS.some((x) => t.includes(x));
}

// HTTP 헤더는 latin-1 만 담을 수 있다. 키에 한글이 섞이면(한글 IME 켜고 입력하면
// l→ㅣ 처럼 바뀐다) fetch 가 'Cannot convert argument to a ByteString' 로 죽는데
// 원인이 전혀 드러나지 않으므로 호출 전에 미리 잡아 준다.
function badKeyChars(name, value) {
  const bad = [...value].filter((c) => c.charCodeAt(0) > 255);
  if (bad.length === 0) return null;
  return `${name} 에 ASCII 가 아닌 문자(${bad.join(' ')})가 들어 있습니다 — 한글 IME 상태로 입력했거나 복사가 잘못된 값입니다`;
}

/** 네이버 오픈 API 키를 읽고 검증한다. 못 쓰는 상태면 이유 문자열을 reason 에 담아 반환. */
function naverKeys() {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return { reason: 'NAVER_CLIENT_ID/SECRET 없음' };
  const bad = badKeyChars('NAVER_CLIENT_ID', id) || badKeyChars('NAVER_CLIENT_SECRET', secret);
  if (bad) return { reason: bad };
  return { id, secret };
}

module.exports = {
  BRAND_TOKENS, ANCHORS, EXCLUDE, INTL_ANCHORS, INTL_EXCLUDE,
  normalize, isBrandMention, isIntlBrandMention, badKeyChars, naverKeys,
};
