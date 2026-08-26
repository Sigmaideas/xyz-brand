# XYZ 브랜드 모니터링

엑스와이지(XYZ) 브랜드가 외부에서 어떻게 언급되는지 한 화면에서 보는 내부용 대시보드.

**대시보드:** https://sigmaideas.github.io/xyz-brand/

매장 브랜드 '라운지엑스' 는 별도 저장소([loungex-brand](https://github.com/Sigmaideas/loungex-brand))에서 본다.
두 대시보드는 코드 구조와 디자인을 공유하지만 수집 대상과 데이터가 완전히 분리돼 있다.

## 화면 구성

| 메뉴 | 내용 | 데이터 |
|---|---|---|
| 네이버 블로그 모니터링 | '엑스와이지' 를 언급한 블로그 포스트 · 전체/외부/공식 탭 | `data/blog.json` |
| 네이버 카페 모니터링 | 카페 언급글 · 카페별 비중 | `data/cafe.json` |
| 검색어 트렌드 | 네이버 데이터랩 기준 브랜드 검색 관심도 추이 | `data/trend.json` |
| 뉴스 모니터링 | 국내·해외 언론 보도 | `data/news.json` |
| 유튜브 모니터링 | 브랜드 언급 영상 · 조회수 · 국내/해외 탭 | `data/youtube.json` |

블로그의 **외부 언급** 탭이 실질적인 브랜드 확산 지표다. 공식 블로그(`xyz_inc`, `lounge_lab`)
발행분을 빼야 외부에서 자발적으로 얼마나 이야기되는지 보인다.

## 실행

```bash
npm install
npx playwright install chromium

npm run blog        # 네이버 블로그 포스트 (검색 API, 없으면 Playwright 로 대체)
npm run cafe        # 네이버 카페 글 (검색 API 필요)
npm run news        # 구글 뉴스 RSS (키 불필요) + 네이버 뉴스 (검색 API)
npm run trend       # 네이버 데이터랩 (데이터랩 API 필요)
npm run youtube     # 유튜브 영상·조회수 (YouTube Data API 필요)
npm run update      # 위 다섯을 순서대로

npm run dashboard   # http://localhost:8080
```

## API 키

`.env.example` 을 `.env` 로 복사해 채운다. 자동 수집(GitHub Actions)은 저장소 Secrets 를 쓴다.

| 키 | 용도 | 없으면 |
|---|---|---|
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 블로그·카페·뉴스(검색 API) + 검색어 트렌드(데이터랩 API) | 아래 표 참고 |
| `YOUTUBE_API_KEY` | 유튜브 영상·조회수 | 유튜브 화면만 빔 |

네이버는 **API 별로 따로 신청**해야 한다. 애플리케이션의 '사용 API' 에 `검색` 과
`데이터랩(검색어트렌드)` 이 **둘 다** 체크돼 있어야 전부 동작한다. 하나가 빠지면 그 API 만
401 `Scope Status Invalid` 가 난다.

| 등록 상태 | 결과 |
|---|---|
| 둘 다 등록 | 전부 정상 |
| 데이터랩만 등록 | 트렌드 정상 · 카페 스킵 · 뉴스는 구글만 · 블로그는 Playwright 대체 경로 |
| 검색만 등록 | 트렌드만 빔 |
| 키 없음 | 블로그만 Playwright 로 동작 |

YouTube 키는 console.cloud.google.com 에서 'YouTube Data API v3' 를 사용 설정한 뒤 API 키를
만든다. 무료 쿼터 10,000유닛/일 이고 이 수집기는 1회당 약 400유닛을 쓴다.

⚠️ 키 값에 한글이 섞이면(한글 IME 켜고 입력하면 `l` 이 `ㅣ` 로 바뀐다) HTTP 헤더에 못 실려
`ByteString` 오류가 난다. 원인이 안 드러나는 오류라 `scraper/relevance.js` 의 `badKeyChars`
가 호출 전에 잡아 메시지를 남긴다.

## 자동 수집

`.github/workflows/update.yml` 이 하루 2회(약 10:00 / 22:00 KST) 돌면서 다섯 수집기를
실행하고 `data/*.json` 변경분을 커밋한다. 각 단계는 `continue-on-error` 라 하나가 실패해도
나머지 결과는 살아남는다.

대시보드의 '데이터 업데이트' 버튼은 GitHub Pages 에서는 **이미 수집된 데이터를 다시 불러오기만**
한다. 실제 수집을 버튼으로 돌리려면 Cloudflare Worker 를 배포하고 `app.js` 의
`TRIGGER_WORKER_URL` 을 채워야 한다.

## 구조

```
xyz-brand/
├── index.html          # 대시보드 마크업 (3개 뷰)
├── app.js              # 렌더링 — 블로그·뉴스가 집계/차트 코드를 공유한다
├── style.css
├── server.js           # 로컬 개발용 정적 서버 + 수집 트리거 API
├── logo.png            # ⚠️ 임시 워드마크 — 공식 로고로 교체 필요
├── scraper/
│   ├── relevance.js      # 동명이인 제외·맥락 판정 (전 수집기 공용) + 키 검증
│   ├── scrape-blog.js    # 네이버 블로그 — 검색 API, 실패 시 Playwright 대체
│   ├── scrape-cafe.js    # 네이버 카페 — 검색 API
│   ├── scrape-news.js    # 구글 뉴스 RSS (국내 + 해외) + 네이버 뉴스
│   ├── scrape-trend.js   # 네이버 데이터랩
│   └── scrape-youtube.js # YouTube Data API — 영상 + 조회수
└── data/               # 누적 저장소 겸 대시보드 입력 (커밋됨)
```

수집기는 모두 **누적형**이다. 검색 결과는 시간이 지나면 밀려나므로 매 실행마다 기존
`data/*.json` 을 읽어 합친다. 관련성 판정은 매번 다시 돌리기 때문에, 판정 규칙을 고치면
과거에 잘못 들어온 항목도 다음 실행에서 함께 정리된다.

## 동명이인 주의

'엑스와이지' / 'XYZ' 는 동명이 유난히 많다. 수집기의 `EXCLUDE` 목록은 실제로 걸려 나온
것들을 하나씩 넣은 결과다.

| 동명 | 정체 |
|---|---|
| 엑스와이지 스튜디오 | 연예기획사 (조보아 등 소속) |
| XYZ로보틱스 / XYZ Robotics | 중국 물류로봇 회사 |
| W.XYZ | 워커힐 호텔 멤버십 |
| 엑스와이지 칵테일 / 엑스와이지포차 | 각각 칵테일 이름, 압구정 술집 |

새 오탐이 보이면 **`scraper/relevance.js` 의 `EXCLUDE` 한 곳**에만 추가하면 블로그·카페·뉴스·
유튜브에 동시에 반영된다. 공백·괄호를 지운 소문자 기준으로 비교하므로 그 형태로 적는다.

수집원마다 판정 강도가 다르다 — 뉴스는 언론사 편집을 거쳐 이미 걸러진 상태라 브랜드 표기만
확인하고, 블로그·카페·유튜브는 로봇/푸드테크 맥락(`ANCHORS`)까지 함께 요구한다.

## 수집이 깨졌을 때

**블로그가 0건으로 나온다** — 네이버 검색 결과 HTML 이 바뀐 것이다. 클래스명은 난독화돼
있어 못 쓰고, `data-template-id="ugcItem"` / `"articleSource"` 속성과 `blog.naver.com/{id}/{postId}`
URL 패턴에 의존한다. 이 중 무엇이 바뀌었는지 확인하려면
`HEADLESS=false npm run blog` 로 브라우저를 띄워 본다.

**카페 월별 그래프가 수집 시작일부터만 있다** — 정상이다. 카페글 검색 API 는 작성일을
주지 않아서(블로그 API 의 `postdate` 에 해당하는 필드가 없다) '처음 발견한 날' 을 날짜로 쓴다.
즉 카페 화면의 월별 그래프는 '작성 추이' 가 아니라 '발견 추이' 다.

**유튜브 조회수가 안 오른다** — 조회수는 매 실행마다 누적분 전체를 다시 조회해 갱신한다.
`videos.list` 가 실패하면(쿼터 소진 등) 기존 값을 유지하고 로그에 남긴다.

**작성일이 이상하다** — 네이버는 '3일 전' 같은 상대 표기와 '2026.03.10.' 절대 표기를 섞어
쓴다. 상대 표기는 수집 시점 기준으로 환산해 저장하므로, 오래 지나 재수집된 글은 실제
작성일과 며칠 어긋날 수 있다. 월별 집계 용도에는 충분하다.
