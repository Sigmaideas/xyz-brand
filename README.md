# XYZ 브랜드 모니터링

엑스와이지(XYZ) 브랜드가 외부에서 어떻게 언급되는지 한 화면에서 보는 내부용 대시보드.

**대시보드:** https://sigmaideas.github.io/xyz-brand/

매장 브랜드 '라운지엑스' 는 별도 저장소([loungex-brand](https://github.com/Sigmaideas/loungex-brand))에서 본다.
두 대시보드는 코드 구조와 디자인을 공유하지만 수집 대상과 데이터가 완전히 분리돼 있다.

## 화면 구성

| 메뉴 | 내용 | 데이터 |
|---|---|---|
| 네이버 블로그 모니터링 | '엑스와이지' 를 언급한 블로그 포스트 · 전체/외부/공식 탭 | `data/blog.json` |
| 검색어 트렌드 | 네이버 데이터랩 기준 브랜드 검색 관심도 추이 | `data/trend.json` |
| 뉴스 모니터링 | 국내·해외 언론 보도 | `data/news.json` |

블로그의 **외부 언급** 탭이 실질적인 브랜드 확산 지표다. 공식 블로그(`xyz_inc`, `lounge_lab`)
발행분을 빼야 외부에서 자발적으로 얼마나 이야기되는지 보인다.

## 실행

```bash
npm install
npx playwright install chromium

npm run blog        # 네이버 블로그 포스트 수집
npm run news        # 구글 뉴스 RSS (키 불필요)
npm run trend       # 네이버 데이터랩 (키 필요)
npm run update      # 위 셋 순서대로

npm run dashboard   # http://localhost:8080
```

## API 키

`.env.example` 을 `.env` 로 복사해 채운다. 자동 수집(GitHub Actions)은 저장소 Secrets 를 쓴다.

| 키 | 용도 | 없으면 |
|---|---|---|
| `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` | 데이터랩 검색어 트렌드 | 트렌드 화면만 비고 나머지는 정상 |

블로그·뉴스는 키가 필요 없다. 네이버 **검색** API 는 쓰지 않는다 — 발급된 키가
검색 스코프 미등록이라 401 이 나서, 블로그는 통합검색 화면을 Playwright 로 훑는다.

## 자동 수집

`.github/workflows/update.yml` 이 하루 2회(약 10:00 / 22:00 KST) 돌면서 세 수집기를
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
│   ├── scrape-blog.js  # 네이버 통합검색 블로그 탭 (Playwright)
│   ├── scrape-news.js  # 구글 뉴스 RSS (국내 + 해외 로케일)
│   └── scrape-trend.js # 네이버 데이터랩
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

새 오탐이 보이면 `scrape-blog.js` 의 `EXCLUDE`, `scrape-news.js` 의 `EXCLUDE_TOKENS` 에
표기를 추가하면 된다. 공백·괄호를 지운 소문자 기준으로 비교하므로 그 형태로 적는다.

## 수집이 깨졌을 때

**블로그가 0건으로 나온다** — 네이버 검색 결과 HTML 이 바뀐 것이다. 클래스명은 난독화돼
있어 못 쓰고, `data-template-id="ugcItem"` / `"articleSource"` 속성과 `blog.naver.com/{id}/{postId}`
URL 패턴에 의존한다. 이 중 무엇이 바뀌었는지 확인하려면
`HEADLESS=false npm run blog` 로 브라우저를 띄워 본다.

**작성일이 이상하다** — 네이버는 '3일 전' 같은 상대 표기와 '2026.03.10.' 절대 표기를 섞어
쓴다. 상대 표기는 수집 시점 기준으로 환산해 저장하므로, 오래 지나 재수집된 글은 실제
작성일과 며칠 어긋날 수 있다. 월별 집계 용도에는 충분하다.
