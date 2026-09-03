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
// → 'XYZ' + 한국/로봇 맥락이 같이 있어야 하고, 아래 INTL_EXCLUDE 로 다른 뜻을 먼저 쳐낸다.
// 일본어·중국어 매체도 수집하므로 해당 표기를 함께 둔다.
const INTL_ANCHORS = ['korea', 'korean', 'seoul', 'robot', 'robotics', 'barista', 'cafe', 'café',
  'coffee', 'foodtech', 'humanoid', 'physical ai', 'dual arm', 'bimanual', 'deux',
  '韓国', 'ロボット', 'カフェ', 'バリスタ', '韩国', '机器人', '咖啡'];

// 유튜브처럼 편집을 안 거친 UGC 는 한 단계 더 좁힌다. generic 'robot' 을 맥락으로
// 인정하면 'Crazy XYZ'(인도 채널)·랩 자동화 XYZ 스테이지·로봇 완구가 끝없이 들어온다.
// 브랜드 고유 맥락(DEUX·바리스타·카페·한국)까지 요구하면 그 부류가 통째로 빠진다.
const INTL_GENERIC = ['robot', 'robotics', 'ロボット', '机器人'];
const INTL_STRICT_ANCHORS = INTL_ANCHORS.filter((x) => !INTL_GENERIC.includes(x));

// 'XYZ' 표기 없이도 이것만 보이면 우리 브랜드로 인정하는 고유 제품명.
// 'baris' 단독은 못 쓴다 — normalize 후 'barista' 안에 그대로 들어 있다.
// '라운지엑스'/'loungex' 도 넣지 않는다. 매장 브랜드라 별도 저장소(loungex-brand)
// 대시보드의 수집 대상이고, 여기서까지 잡으면 두 대시보드가 섞인다.
const INTL_BRAND_TOKENS = ['baris brew', 'barisbrew'];

// 'XYZ' 의 다른 뜻 — 앵커(robot 등)와 같이 나와도 우리 브랜드가 아닌 것들.
//   1행: 동명 회사·서비스
//   2~4행: XYZ 축(좌표계) 직교로봇 — 갠트리·리니어 액추에이터 업체 영상이 압도적으로 많다.
//          앵커에 'robot' 이 있는 한 이 veto 없이는 해외 탭이 이 부류로 뒤덮인다.
//   5행: 완구 — 'Tobot X/Y/Z'(변신로봇 완구) 가 조회수 수백만짜리로 대량 잡힌다.
//         'tobot' 하나면 언어(인니어·베트남어) 무관하게 이 계열이 전부 걸러진다.
//   6행: XYZprinting 의 완구 로봇 Bolide, 개인 제작·강좌 채널 등 실제로 걸려 나온 것들
const INTL_EXCLUDE = ['xyz robotics', 'xyzrobotics', 'shanghai', 'w.xyz', '.xyz domain',
  'gantry', 'cartesian', 'linear actuator', 'linear module', 'linear motion', 'linear stage',
  'xyz table', 'xyz stage', 'motion stage', 'pick and place', 'palletizing', 'ball screw',
  'cnc', '3 axis', 'axis xyz', 'kinematic', 'user coordinate', 'stepper', 'dispensing',
  '직교로봇',
  'tobot', 'mainan', 'transformer',
  'bolide', 'xyzprinting', 'xyzrobots', 'tech world xyz', 'tilting mechanism', 'arduino',
  'haeger', 'vir the robot'];

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

/**
 * 해외 콘텐츠 — normalize 가 공백을 지우므로 비교값도 지워 맞춘다.
 * 순서가 중요하다: 다른 뜻(INTL_EXCLUDE)을 먼저 쳐내야 고유 제품명 검사가 의미를 갖는다.
 *
 * @param {{strict?: boolean}} opts
 *   strict — generic 'robot' 을 맥락으로 인정하지 않는다 (유튜브 true, 뉴스 false)
 */
function isIntlBrandMention(item, { strict = false } = {}) {
  const t = normalize(item);
  const has = (x) => t.includes(x.replace(/\s+/g, ''));
  if (INTL_EXCLUDE.some(has)) return false;
  if (INTL_BRAND_TOKENS.some(has)) return true;
  return t.includes('xyz') && (strict ? INTL_STRICT_ANCHORS : INTL_ANCHORS).some(has);
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
  BRAND_TOKENS, ANCHORS, EXCLUDE, INTL_ANCHORS, INTL_STRICT_ANCHORS, INTL_BRAND_TOKENS, INTL_EXCLUDE,
  normalize, isBrandMention, isIntlBrandMention, badKeyChars, naverKeys,
};
