# 작업정의서 — AI핀테크융합과 오프라인 입학상담 예약 사이트

> 이 문서와 `.env`를 프로젝트 루트에 두고 Claude Code에서 **"SPEC.md를 읽고 Phase 1부터 진행해줘"**로 시작한다.
> 각 Phase가 끝나면 멈추고, 만든 내용과 실행 방법을 보고한 뒤 다음 Phase로 넘어간다.

---

## 1. 목적
한국폴리텍대학 서울강서캠퍼스 **AI핀테크융합과** 지원자가 학과와의 **오프라인 면담을 1시간 단위로 예약**하는 웹사이트.

- **교수**: 로그인 후 상담 가능한 날짜·시간(1시간 슬롯)을 연다.
- **지원자**: 로그인 없이 **학과 → 시간**만 골라 신청한다. 교수는 고르지 않으며, 담당 교수는 시스템이 자동으로 배정한다.
- **알림**: 신청·취소 즉시 텔레그램(필수)·슬랙(선택)으로 알림이 간다.

---

## 2. 기술 스택 (고정)
| 구분 | 선택 |
|---|---|
| 런타임 | Node.js 20 LTS 이상 |
| 서버 | Express 4 |
| 화면 | `public/` 정적 **HTML + CSS + 순수 JS**(fetch로 JSON API 호출). 프레임워크·번들러·템플릿 엔진 없음 |
| DB | 기존 **가비아 호스팅 MySQL** (`mysql2/promise` 커넥션 풀) |
| 세션 | `express-session` + `express-mysql-session` (세션도 같은 DB에 저장, 서버 재시작해도 로그인 유지) |
| 비밀번호 | `bcryptjs` (네이티브 빌드 없는 패키지) |
| 보안 | `helmet`, `express-rate-limit`, CSRF 토큰(세션 기반, 직접 구현) |
| 알림 | Node 내장 `fetch`로 Telegram Bot API, Slack Incoming Webhook 호출 |
| 설정 | `dotenv` |
| 테스트 | `node:test` + `supertest` |
| 타임존 | 전부 `Asia/Seoul`. DB 커넥션에 `timezone: '+09:00'` 지정 |

---

## 3. DB 접속 (중요)
- 접속정보는 **루트의 `.env`에 이미 들어 있다**(`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`). 코드·문서·로그·커밋 어디에도 비밀번호를 하드코딩하거나 출력하지 않는다.
- `hkcodedb`는 **다른 용도와 함께 쓰는 DB**다. 따라서 다음 규칙을 지킨다.
  - 이 프로젝트의 모든 테이블은 접두어 **`cb_`**를 붙인다(예: `cb_slots`).
  - `cb_`로 시작하지 않는 테이블은 **조회·수정·삭제·DROP 금지**.
  - `DROP DATABASE`, `TRUNCATE` 등 파괴적 명령은 쓰지 않는다.
- MySQL 버전을 가정하지 말고, **MySQL 5.7에서도 동작하는 문법**만 쓴다. 엔진은 InnoDB, 문자셋은 utf8mb4.
- 스키마는 `db/migrations/001_init.sql` 같은 번호 붙은 SQL 파일로 관리하고, `npm run db:migrate`로 적용한다. 적용 이력은 `cb_migrations` 테이블에 기록한다.
- Phase 1에서 **`npm run db:check`**(접속 테스트 + MySQL 버전 출력)를 먼저 만들고 실행한다. 접속이 안 되면 가비아 관리 콘솔에서 **외부 접속 IP 허용**이 필요할 수 있으므로, 에러 메시지를 그대로 보고하고 멈춘다.

---

## 4. 사용자와 권한
| 구분 | 할 수 있는 일 |
|---|---|
| 지원자(비로그인) | 시간 조회, 예약 신청, 본인 예약 조회·취소 |
| 교수(로그인) | 본인 슬롯 열기/닫기, 본인에게 배정된 예약 조회·취소·상태 변경 |
| 관리자(`is_admin`) | 위 기능 + 교수 계정 관리, 학과 전체 예약 조회, CSV 다운로드, 테스트 알림 |

- **기본 운영 = 학과 공용 "AI핀테크융합과 전체교수" 계정 1개(관리자 권한).** 학과 교수들이 이 계정으로 함께 슬롯을 열고 예약을 확인한다.
- 교수 계정은 회원가입 화면 없이 CLI로 만든다. 비밀번호는 터미널에서 입력받는다(인자로 받지 않음).
  `npm run create-professor -- --department ai-fintech --email ... --name "AI핀테크융합과 전체교수" --admin`
- 나중에 교수 개인 계정을 추가해도 코드를 바꾸지 않고 동작해야 한다(자동 배정 규칙, 5장).

---

## 5. 데이터 모델
```
cb_departments              -- 초기 데이터: AI핀테크융합과 1건 (slug: ai-fintech)
  id, name, slug(UNIQUE), default_location, telegram_chat_id(NULL),
  slack_webhook_url(NULL), is_active, created_at

cb_professors
  id, department_id(FK), email(UNIQUE), name, password_hash,
  office(NULL — 없으면 학과 default_location), telegram_chat_id(NULL),
  is_admin, is_active, failed_login_count, locked_until(NULL), created_at

cb_slots                    -- 교수가 연 1시간 상담 가능 시간
  id, professor_id(FK), start_at(DATETIME, 정시만), end_at(= start_at + 1h),
  location(NULL — 없으면 교수 office → 학과 default_location 순), is_open, created_at
  UNIQUE(professor_id, start_at)

cb_reservations
  id, slot_id(FK), code(예약번호 8자리 대문자+숫자, 헷갈리는 0/O/1/I 제외, UNIQUE),
  applicant_name, phone, email(NULL),
  applicant_type ENUM('고3','재학·졸업생','재직자','전직·전환','기타'),
  interest(NULL), message(NULL, 500자), privacy_agreed,
  status ENUM('BOOKED','CANCELLED','DONE','NO_SHOW'),
  cancel_reason(NULL), cancelled_by ENUM('APPLICANT','PROFESSOR') NULL,
  created_at, cancelled_at(NULL)

cb_sessions                 -- express-mysql-session용 (테이블명 지정)
cb_migrations               -- 마이그레이션 이력
```

**자동 배정 규칙(필수)**
- 지원자에게 보이는 단위는 **"학과 + 시간"**이다. 같은 시간에 여러 교수가 슬롯을 열었으면 한 칸으로 합쳐 보이고, 빈 슬롯이 남아 있는 동안 계속 예약할 수 있다.
- 신청하면 그 시간의 빈 슬롯 중 **그 주 예약이 가장 적은 교수**에게 배정한다. 동률이면 무작위로 고른다.

**중복예약 방지(필수)**
- 한 슬롯에 `BOOKED` 예약은 최대 1건.
- 트랜잭션 안에서 `SELECT ... FOR UPDATE`로 빈 슬롯을 잠그고 배정한다.
- 동시에 두 명이 마지막 자리를 신청하면 한 명만 성공한다. 다른 한 명에게는 "방금 다른 분이 예약했어요. 다른 시간을 선택해 주세요."를 보여준다.

---

## 6. API
JSON API는 `/api/*` 아래에 두고, 응답 형식은 `{ ok: true, data }` / `{ ok: false, message }`로 통일한다.

**공개 API**
- `GET  /api/departments`
- `GET  /api/departments/:slug/availability?week=YYYY-MM-DD` — 날짜별 예약 가능 시간(교수 정보 제외)
- `POST /api/reservations` — 신청(학과 slug + 시작시각 + 신청서)
- `POST /api/reservations/lookup` — 휴대폰 + 예약번호로 조회
- `POST /api/reservations/cancel` — 휴대폰 + 예약번호로 취소

**교수 API** (`/api/admin/*`, 로그인 필요)
- 로그인·로그아웃·내 정보
- 슬롯: 주간 조회, 토글, 일괄 열기, 장소 변경
- 예약: 목록, 상태 변경, 취소
- 관리자 전용: 교수 계정 관리, CSV, 테스트 알림

공개 API 응답에는 **교수 이름·이메일·ID가 절대 포함되지 않는다.**

---

## 7. 화면 명세
페이지는 정적 HTML 파일로 만든다. 공통 CSS 1개(`public/css/app.css`), 공통 JS 1개(`public/js/api.js`)에 페이지별 JS를 더하는 구조다.

### 7.1 지원자 (모바일 우선)
| 페이지 | 내용 |
|---|---|
| `/` 메인 | 학과명·캠퍼스명, 한 줄 소개, **[상담 예약하기]** 큰 버튼, [내 예약 확인] 보조 링크, 오시는 길(장소 텍스트) |
| `/book.html` 시간 선택 | 학과가 1개면 학과 선택 화면을 건너뛴다. 상단에 **가로 스크롤 날짜 칩**(요일·날짜, 가능한 시간이 없는 날은 흐리게 표시), 아래에 **시간 버튼 그리드**(10:00, 11:00 …). 시간을 고르면 하단에 고정된 [다음] 버튼이 활성화된다 |
| `/apply.html` 신청서 | 선택한 일시·장소 요약 카드 + 입력 항목: 이름*, 휴대폰*(자동 하이픈), 이메일, 지원유형*(칩 선택), 관심분야, 문의(글자 수 표시), 개인정보 동의*(펼침 문구: 수집항목·목적·보유기간 "상담 종료 후 6개월"). 입력이 잘못되면 해당 칸 아래 빨간 안내문을 표시한다 |
| `/done.html` 완료 | 체크 아이콘, **예약번호를 크게 표시하고 [복사] 버튼**, 일시·장소, "예약번호와 휴대폰 번호로 조회·취소할 수 있어요" 안내 |
| `/my.html` 내 예약 | 휴대폰 + 예약번호 입력 → 예약 카드 표시 → [예약 취소](확인 모달). 상담 시작 3시간 전 이후에는 취소 버튼 대신 "학과로 연락해 주세요" 안내 |

**노출 조건**: 슬롯이 열려 있고(`is_open`) 빈 슬롯이 남아 있으며, 지금으로부터 `BOOKING_MIN_HOURS_BEFORE`(기본 24시간) 이후이고 `BOOKING_MAX_DAYS_AHEAD`(기본 60일) 이내인 시간만 보인다.

### 7.2 교수 (PC 우선, 모바일에서도 사용 가능)
| 페이지 | 내용 |
|---|---|
| `/admin/login.html` | 이메일·비밀번호. 5회 연속 실패하면 10분 잠금 |
| `/admin/slots.html` 슬롯 관리 | **주간 캘린더 그리드**(월~금, 토요일 표시 토글 / 세로축 `SLOT_DAY_START`~`SLOT_DAY_END`시). 칸 상태를 색으로 구분: 닫힘(회색 점선) / 열림(연한 브랜드색) / 예약됨(진한 브랜드색 + 신청자 이름). 클릭으로 열기·닫기를 토글하고, 드래그로 여러 칸을 한 번에 연다. 예약된 칸을 누르면 상세 패널이 뜬다. [일괄 열기] 모달: 기간 + 요일 + 시간대 선택. 모바일에서는 날짜별 리스트로 전환 |
| `/admin/reservations.html` | 탭: 예정 / 지난 / 취소. 행마다 일시·신청자·연락처·지원유형·상태 배지. 상태 변경(완료·노쇼), 취소(사유 입력). 관리자에게는 [CSV 다운로드] 버튼 표시 |
| `/admin/settings.html` (관리자) | 교수 계정 목록·추가·비활성화, 학과 기본 장소, [테스트 알림 보내기] |

규칙: 예약이 걸린 슬롯은 닫거나 삭제할 수 없다. 먼저 예약을 취소해야 한다.

---

## 8. 디자인 가이드 — "깔끔하게"
- **톤**: 흰 배경 중심의 미니멀 디자인. 카드와 여백으로 구분하고 선은 최소화한다. 장식 이미지는 쓰지 않는다.
- **색상**(`:root` CSS 변수 한 곳에서 관리)
  - `--brand: #1E4FD8`(신뢰감 있는 블루), `--brand-weak: #EAF0FF`
  - `--text: #191F28`, `--text-sub: #6B7684`, `--line: #E5E8EB`, `--bg: #F7F8FA`, `--danger: #E5484D`, `--success: #12B76A`
- **폰트**: Pretendard(CDN, `font-display: swap`). 본문 16px, 제목 22~28px 굵게.
- **컴포넌트**: 모서리 12~16px, 그림자는 아주 옅게(`0 1px 3px rgba(0,0,0,.06)`). 버튼 높이 52px, 주요 버튼은 꽉 찬 브랜드색, 보조 버튼은 흰 배경에 테두리.
- **모바일**: 360px 폭에서 가로 스크롤 없음, 좌우 여백 20px, 터치 영역 최소 44px, 주요 버튼은 화면 하단에 고정.
- **상태 표시**: 로딩 시 스켈레톤, 빈 상태에는 일러스트 대신 짧은 안내 문구("이번 주는 상담 가능한 시간이 없어요. 다음 주를 확인해 주세요."), 성공·실패는 토스트로 표시.
- **문구**: 친절한 존댓말 해요체. 에러 메시지는 사용자가 다음에 할 일을 알려준다.
- **접근성**: label과 input 연결, 색만으로 상태를 구분하지 않기(아이콘·텍스트 병행), 키보드 포커스 링 표시.
- **헤더**: 좌측에 "AI핀테크융합과 | 한국폴리텍대학 서울강서캠퍼스" 텍스트 로고. 학교 로고 이미지는 `public/img/logo.png`가 있으면 사용한다.

---

## 9. 알림
- **이벤트**: 예약 신청 / 지원자 취소 / 교수 취소
- **발송 대상**: `cb_departments`의 `telegram_chat_id`·`slack_webhook_url`. 비어 있으면 `.env`의 값을 쓴다. 값이 있는 채널만 보낸다. 배정된 교수에게 `telegram_chat_id`가 있으면 그 교수에게도 보낸다.
- **메시지 예시**(텔레그램 HTML parse_mode)
  ```
  📅 [AI핀테크융합과] 상담 신청
  일시: 2026-11-12(목) 14:00~15:00
  장소: OO관 301호
  신청자: 홍길동 (고3) / 010-****-5678
  관심분야: 자동매매, 데이터분석
  문의: ...
  예약번호: AB12CD34
  관리: {BASE_URL}/admin/reservations.html
  ```
- 휴대폰 번호는 가운데 4자리를 마스킹한다. 전체 번호는 관리 화면에서만 볼 수 있다.
- 응답을 보낸 뒤 비동기로 발송한다. **알림 실패가 예약 성공을 막으면 안 된다.** 타임아웃 5초, 재시도 1회, 실패하면 로그만 남긴다.
- `.env`의 텔레그램 값이 비어 있어도 서버가 정상적으로 떠야 한다. 시작할 때 "알림 채널 미설정" 경고만 출력한다.

---

## 10. 보안·운영
- `helmet` 적용. 세션 쿠키는 `httpOnly`, `sameSite=lax`, 운영 환경에서는 `secure`.
- 상태를 바꾸는 모든 요청(POST/PATCH/DELETE)에 CSRF 토큰을 검증한다(`GET /api/csrf`로 발급, `X-CSRF-Token` 헤더).
- 레이트리밋: 예약 신청 IP당 분당 5회, 조회·취소 분당 10회, 로그인 분당 10회.
- 신청 폼에 허니팟 필드를 둔다.
- 모든 SQL은 placeholder(`?`)로 작성한다. 문자열 이어붙이기는 금지.
- `npm run purge-expired`: 보유기간(상담일 + 6개월)이 지난 예약의 이름·연락처·이메일·문의를 익명화한다. 크론 등록 예시는 README에 둔다.
- 에러 응답은 한국어 안내로 하고, 스택트레이스는 노출하지 않는다.
- 로그(콘솔 + `logs/app.log`): 예약 생성·취소, 로그인 실패, 알림 실패. 비밀번호와 전체 전화번호는 로그에 남기지 않는다.

---

## 11. 설정 (`.env` — 이미 루트에 있음, 텔레그램 값은 사용자가 입력)
```
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000
SESSION_SECRET=

DB_HOST=
DB_PORT=3306
DB_NAME=
DB_USER=
DB_PASSWORD=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
SLACK_WEBHOOK_URL=

BOOKING_MIN_HOURS_BEFORE=24
BOOKING_MAX_DAYS_AHEAD=60
CANCEL_MIN_HOURS_BEFORE=3
SLOT_DAY_START=9
SLOT_DAY_END=18
```
- `.env.example`은 값을 비운 채로 만든다. `.env`는 `.gitignore`에 포함한다.
- `SESSION_SECRET`이 비어 있으면 Phase 1에서 랜덤 값을 생성해 `.env`에 채운다.

---

## 12. 폴더 구조
```
server/
  index.js            # Express 앱 시작
  config.js  db.js
  routes/  public.js  admin.js
  services/ booking.js  notify.js  auth.js  csrf.js
  cli/ migrate.js  db-check.js  create-professor.js  purge-expired.js
db/migrations/ 001_init.sql ...
public/
  index.html  book.html  apply.html  done.html  my.html
  admin/ login.html  slots.html  reservations.html  settings.html
  css/app.css   js/api.js  js/*.js   img/
test/
.env  .env.example  .gitignore  package.json  README.md
deploy/ ecosystem.config.cjs (pm2)  nginx.conf.example
```

---

## 13. 진행 단계 (각 단계 끝에 멈추고 보고)
| Phase | 내용 |
|---|---|
| 1 | 프로젝트 생성, `.gitignore`, **`db:check`로 가비아 DB 접속 확인**, 마이그레이션(`cb_` 테이블), 학과 시드, 교수 생성 CLI, 로그인·로그아웃 |
| 2 | 공통 CSS·레이아웃(8장 디자인 가이드), 교수 슬롯 관리 화면(토글·드래그·일괄 열기·장소 변경) |
| 3 | 지원자 흐름(시간 선택 → 신청 → 완료 → 내 예약 조회·취소), 자동 배정, 중복예약 방지 |
| 4 | 텔레그램·슬랙 알림, 테스트 알림 버튼 |
| 5 | 예약 목록·상태 변경·CSV, CSRF·레이트리밋·허니팟, 익명화 CLI |
| 6 | 테스트 보강, README(설치, 텔레그램 봇 만들기와 chat_id 확인법, 슬랙 웹훅 만들기, pm2 + nginx 배포) |

---

## 14. 완료 기준
**자동 테스트** (`npm test`, 테스트용 DB 또는 `cb_test_` 접두어 테이블 사용 — 운영 테이블을 건드리지 않음)
- [ ] 열린 슬롯만 보이고, 24시간 이내·과거 시간은 안 보인다
- [ ] 같은 슬롯에 동시 신청 2건 → 1건만 성공
- [ ] 같은 시간에 교수 2명이 열면 1칸으로 보이고, 2건이 예약된 뒤 사라진다
- [ ] 공개 API 응답 어디에도 교수 정보가 없다
- [ ] 공용 계정 1개만 있어도 예약·알림이 정상 동작한다
- [ ] 예약된 슬롯은 닫을 수 없다
- [ ] 휴대폰·예약번호가 틀리면 조회할 수 없고, 마감 이후에는 취소할 수 없다
- [ ] 알림 설정이 비었거나 틀려도 예약은 성공한다
- [ ] 비로그인 상태로 `/api/admin/*`를 호출하면 401, `/admin/*.html`에 접근하면 로그인 페이지로 이동한다
- [ ] CSRF 토큰이 없는 POST는 403

**수동 확인**
- [ ] 크롬 개발자도구 360px 폭에서 모든 지원자 화면이 가로 스크롤 없이 보인다
- [ ] 실제 텔레그램으로 신청·취소 알림이 도착한다

---

## 15. 하지 말 것
- 지원자 회원가입·로그인 만들지 않기
- React/Vue/Next.js, 번들러, CSS 프레임워크(Tailwind·Bootstrap) 도입하지 않기
- `cb_` 외 테이블 건드리지 않기, 파괴적 SQL 쓰지 않기
- `.env`·비밀번호·토큰을 커밋하거나 출력하지 않기
- SMS·카카오 알림톡은 이번 범위 밖
