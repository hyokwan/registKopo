# AI핀테크융합과 입학상담 예약

한국폴리텍대학 서울강서캠퍼스 **AI핀테크융합과(대졸자 과정)** 오프라인 입학상담 예약 사이트입니다.

- **지원자**: 회원가입 없이 상담 가능한 시간을 골라 신청합니다. 예약번호와 휴대폰 번호로 조회·취소합니다.
- **교수**: 로그인해서 1시간 단위 상담 시간을 열고 닫습니다. 예약을 확인하고 완료·불참·취소를 처리합니다.
- **알림**: 신청·취소가 생기면 텔레그램(필수)과 슬랙(선택)으로 바로 알려 줍니다.

같은 시간을 교수 여러 명이 열면 지원자에게는 한 칸으로 보입니다. 신청이 들어오면 그 주 예약이 가장 적은 교수에게 자동으로 배정합니다.

---

## 목차
1. [빠르게 실행하기 (내 PC)](#1-빠르게-실행하기-내-pc)
2. [학과 홈페이지 버튼과 연결하기](#2-학과-홈페이지-버튼과-연결하기)
3. [사용 방법](#3-사용-방법)
4. [설정 파일 `.env`](#4-설정-파일-env)
5. [텔레그램 알림 설정](#5-텔레그램-알림-설정)
6. [슬랙 알림 설정 (선택)](#6-슬랙-알림-설정-선택)
7. [서버에 배포하기 (pm2 + nginx)](#7-서버에-배포하기-pm2--nginx)
8. [명령어 모음](#8-명령어-모음)
9. [문제 해결](#9-문제-해결)
10. [폴더 구조와 기술 메모](#10-폴더-구조와-기술-메모)

---

## 1. 빠르게 실행하기 (내 PC)

### 준비물
- **Node.js 20 이상**: https://nodejs.org 에서 LTS 버전을 설치합니다. `node -v`로 버전을 확인하세요.
- **가비아 MySQL 접속 정보**: 가비아 콘솔에서 **이 PC의 외부 IP 접속 허용**이 되어 있어야 합니다.

### 처음 한 번만
프로젝트 폴더에서 터미널(PowerShell 등)을 열고 순서대로 실행합니다.

```bash
npm install                 # 1) 패키지 설치
npm run db:check            # 2) DB 접속 확인 (MySQL 버전이 나오면 성공)
npm run db:migrate          # 3) cb_ 테이블 만들기 (여러 번 실행해도 안전)
```

`.env` 파일이 없으면 `.env.example`을 복사해서 `.env`로 만들고 값을 채우세요([4장](#4-설정-파일-env)). `SESSION_SECRET`은 비워 두면 처음 실행할 때 자동으로 채워집니다.

**관리자(교수) 계정 만들기**
비밀번호는 명령줄 인자로 받지 않고 실행 후 화면에서 입력받습니다. 같은 이메일로 다시 실행하면 비밀번호만 바뀝니다.

```bash
npm run create-professor -- --department ai-fintech --email 학과메일@kopo.ac.kr --name "AI핀테크융합과 전체교수" --admin
```

### 서버 켜기

```bash
npm run dev     # 개발용: 코드를 고치면 자동으로 재시작
npm start       # 일반 실행
```

끌 때는 터미널에서 `Ctrl + C`를 누릅니다.

### 접속 주소

| 주소 | 화면 |
|---|---|
| http://localhost:3000/ | 지원자 첫 화면 |
| http://localhost:3000/reserve | 바로 시간 선택 (홈페이지 버튼용) |
| http://localhost:3000/my.html | 내 예약 확인·취소 |
| http://localhost:3000/admin/ | 교수 로그인 → 슬롯 관리 |

> 내 PC의 `localhost` 주소는 다른 사람이 접속할 수 없습니다. 실제 지원자가 쓰려면 [7장](#7-서버에-배포하기-pm2--nginx)처럼 서버에 올려야 합니다.

---

## 2. 학과 홈페이지 버튼과 연결하기

학과 홈페이지(또는 캠퍼스 홈페이지, 블로그, SNS) 버튼을 누르면 예약 화면으로 오게 하는 것이 이 사이트의 기본 사용 방식입니다.

### 어떤 주소를 연결하나요?

| 연결 주소 | 도착 화면 | 추천 |
|---|---|---|
| `https://예약사이트주소/reserve` | **시간 선택 화면으로 바로 이동** | ✅ 버튼 한 번에 예약 시작 |
| `https://예약사이트주소/` | 학과 소개, 진행 순서, 오시는 길이 있는 첫 화면 | 안내를 먼저 보여 주고 싶을 때 |
| `https://예약사이트주소/my.html` | 내 예약 확인·취소 | "예약 확인" 버튼용 |

- `예약사이트주소`는 배포한 도메인입니다(예: `booking.example.ac.kr`). `.env`의 `BASE_URL`도 같은 주소로 맞춰 주세요. 알림 메시지의 "관리" 링크가 이 값을 씁니다.
- `/reserve` 뒤에 붙인 값은 그대로 전달됩니다. 유입 경로를 구분하고 싶으면 `/reserve?from=homepage`처럼 붙여도 됩니다. 기능에는 영향이 없습니다.

### 홈페이지에 붙일 버튼 예시 (HTML)

홈페이지 편집기가 HTML을 지원하면 아래를 붙여 넣고 주소만 바꾸세요.

```html
<a href="https://booking.example.ac.kr/reserve" target="_blank" rel="noopener"
   style="display:inline-block;padding:14px 28px;border-radius:12px;background:#1E4FD8;color:#fff;font-weight:700;text-decoration:none;">
  입학상담 예약하기
</a>
```

- HTML을 쓸 수 없는 홈페이지 빌더(네이버 블로그, 링크트리 등)는 **버튼·링크 주소 칸에 `/reserve` 주소만** 넣으면 됩니다.
- QR코드(포스터·현수막용)도 같은 주소로 만들면 됩니다.
- 이 사이트는 보안을 위해 **다른 사이트 안에 iframe으로 넣는 것을 막아 두었습니다.** 새 창이나 새 탭으로 여는 링크를 쓰세요.

---

## 3. 사용 방법

### 교수 화면 (`/admin/`)

| 메뉴 | 할 수 있는 일 |
|---|---|
| **슬롯 관리** | 주간 표에서 빈칸을 누르면 열리고, 다시 누르면 닫힙니다. 드래그로 여러 칸을 한 번에 바꿀 수 있습니다. **[일괄 열기]**는 기간·요일·시간을 골라 한 번에 엽니다. **[장소 변경]**은 기본 장소나 기간별 장소를 바꿉니다. 예약된 칸을 누르면 상세 내용이 나옵니다. |
| **예약 목록** | 탭은 **예정 / 지난 / 취소**입니다. 지난 상담 중 아직 처리하지 않은 건은 "처리 필요"로 표시되며 **[완료] [불참]**으로 바로 처리합니다. 행을 누르면 상세 내용이 나오고 **교수 취소**(사유 필수)를 할 수 있습니다. 이름·휴대폰·예약번호로 검색할 수 있습니다. 관리자는 **[CSV 다운로드]**를 쓸 수 있습니다. |
| **설정** | 모든 교수는 내 이름, 기본 상담 장소, 내 텔레그램 chat_id, 비밀번호를 바꿀 수 있습니다. 관리자는 **학과 기본 장소·전화번호**, **교수 계정**(추가, 비밀번호 재설정, 관리자 지정, 사용 중지, 잠금 해제), **테스트 알림**을 관리합니다. |

알아 두면 좋은 규칙:
- **예약이 있는 시간은 닫을 수 없습니다.** 먼저 예약 목록에서 취소하세요.
- **교수 취소는 지원자에게 자동으로 연락이 가지 않습니다.** 문자나 카카오 알림을 보내지 않으니 전화로 알려 주세요. 지원자가 예약을 조회하면 "학과 사정으로 취소" 안내와 학과 전화번호가 나옵니다.
- 교수 취소 창의 "이 시간도 닫기"는 기본으로 체크되어 있습니다. 체크를 풀면 그 시간을 다른 지원자가 다시 예약할 수 있습니다.
- 완료·불참은 상담 시작 시간이 지난 뒤에 표시할 수 있습니다. 잘못 눌렀으면 상세 패널의 "미처리"로 되돌립니다.
- 처음 설치한 뒤 **설정 → 학과 정보**에서 학과 기본 장소(예: ○○관 301호)와 학과 전화번호를 꼭 입력하세요. 지원자 화면의 "오시는 길"과 취소 안내에 쓰입니다.

### 지원자 화면
1. 시간 선택: 날짜 칩 → 시간 버튼 → [다음]
2. 신청서: 이름, 휴대폰, 지원 유형(대졸·졸업예정 / 구직자 / 재직자 / 전직·이직 / 기타), 관심 분야, 문의, 개인정보 동의
3. 완료: **예약번호 8자리**를 크게 보여 주고 복사 버튼을 제공합니다
4. 내 예약 확인: 휴대폰과 예약번호로 조회합니다. 상담 3시간 전까지는 직접 취소할 수 있습니다

지원자에게 보이는 시간은 **지금부터 24시간 뒤 ~ 60일 이내**의 열린 시간뿐입니다. 이 기준은 `.env`에서 바꿀 수 있습니다.

---

## 4. 설정 파일 `.env`

프로젝트 루트의 `.env` 파일입니다. **절대 공유하거나 깃에 올리지 마세요**(이미 `.gitignore`에 포함되어 있습니다).

| 이름 | 설명 | 예시 |
|---|---|---|
| `PORT` | 서버 포트 | `3000` |
| `NODE_ENV` | `development` 또는 `production`(배포 시. HTTPS 전용 쿠키 사용) | `production` |
| `BASE_URL` | 사이트 주소. 알림의 관리 링크에 쓰입니다 | `https://booking.example.ac.kr` |
| `SESSION_SECRET` | 로그인 세션 암호화 키. 비워 두면 자동 생성 | |
| `DB_HOST` `DB_PORT` `DB_NAME` `DB_USER` `DB_PASSWORD` | 가비아 MySQL 접속 정보 | |
| `TELEGRAM_BOT_TOKEN` | 텔레그램 봇 토큰 ([5장](#5-텔레그램-알림-설정)) | `1234567890:AA...` |
| `TELEGRAM_CHAT_ID` | 알림 받을 채팅방 ID | `-1001234567890` |
| `SLACK_WEBHOOK_URL` | 슬랙 웹훅 주소 (선택) | `https://hooks.slack.com/services/...` |
| `BOOKING_MIN_HOURS_BEFORE` | 지금부터 몇 시간 뒤부터 예약을 받을지 | `24` |
| `BOOKING_MAX_DAYS_AHEAD` | 며칠 뒤까지 예약을 받을지 | `60` |
| `CANCEL_MIN_HOURS_BEFORE` | 지원자 온라인 취소 마감(상담 몇 시간 전) | `3` |
| `SLOT_DAY_START` `SLOT_DAY_END` | 슬롯 관리 표의 시작·끝 시각 | `9` / `18` |

> `.env`를 바꾼 뒤에는 서버를 다시 시작해야 반영됩니다(`Ctrl+C` 후 다시 실행하거나 `pm2 restart kopo-booking`).

**작성할 때 주의:** `이름=값` 형식으로 쓰고, `=` 뒤에 따옴표나 공백, 등호를 하나 더 넣지 마세요.
- ❌ `TELEGRAM_BOT_TOKEN==123:ABC` (등호 두 개)
- ✅ `TELEGRAM_BOT_TOKEN=123:ABC`

---

## 5. 텔레그램 알림 설정

### ① 봇 만들기 → `TELEGRAM_BOT_TOKEN`
1. 텔레그램에서 **@BotFather**를 검색해 대화를 시작합니다.
2. `/newbot`을 보내고 봇 이름과 아이디(`..._bot`으로 끝남)를 정합니다.
3. BotFather가 알려 주는 `1234567890:AAH...` 형태의 토큰을 `.env`의 `TELEGRAM_BOT_TOKEN`에 넣습니다.

### ② 알림 받을 방의 chat_id 확인 → `TELEGRAM_CHAT_ID`

**학과 단체방으로 받기 (추천)**
1. 텔레그램 그룹을 만들거나 기존 그룹에 위에서 만든 봇을 **멤버로 초대**합니다.
2. 그룹에 `/start@봇아이디`를 한 번 보냅니다(예: `/start@aifintech_kopo_bot`).
3. 브라우저에서 아래 주소를 엽니다. `<토큰>` 자리에 봇 토큰을 넣으세요.
   ```
   https://api.telegram.org/bot<토큰>/getUpdates
   ```
4. 결과에서 `"chat":{"id":-100xxxxxxxxxx, ... "type":"supergroup"}` 부분의 **id 값(마이너스 포함)**을 `TELEGRAM_CHAT_ID`에 넣습니다.
   - 결과가 비어 있으면(`"result":[]`) 그룹에 메시지를 하나 더 보낸 뒤 새로고침하세요.

**개인 채팅으로 받기**
봇과 1:1 대화방에서 아무 메시지를 보낸 뒤 같은 `getUpdates` 주소를 엽니다. `"chat":{"id":123456789,"type":"private"}`의 숫자를 넣으면 됩니다.

### ③ 확인
서버를 다시 시작하고 관리자로 로그인합니다. **설정 → 알림 → [🔔 테스트 알림 보내기]**를 눌러 메시지가 오는지 확인합니다. 실패하면 화면에 이유가 나옵니다([9장](#9-문제-해결) 참고).

### 교수 개인에게도 받기
교수마다 **설정 → 내 정보 → 내 텔레그램 chat_id**를 넣으면, 그 교수에게 배정된 예약 알림이 개인 텔레그램으로도 갑니다. 개인 chat_id는 위의 "개인 채팅으로 받기"로 확인합니다. 단, 교수가 먼저 봇에게 말을 걸어 둬야 봇이 메시지를 보낼 수 있습니다.

### 알림 예시
```
📅 [AI핀테크융합과] 상담 신청
일시: 2026-11-16(월) 14:00~15:00
장소: ○○관 301호
신청자: 홍길동 (대졸·졸업예정) / 010-****-5678
관심분야: 데이터분석
문의: ...
담당: AI핀테크융합과 전체교수
예약번호: AB12CD34
관리: https://booking.example.ac.kr/admin/reservations.html
```
휴대폰 번호는 가운데 4자리를 가립니다. 전체 번호는 교수 화면에서만 볼 수 있습니다.

알림 발송은 신청 처리와 따로 이루어집니다. 알림이 실패해도 예약은 정상 처리되고, 실패 내용은 로그(`logs/app.log`)에만 남습니다. 응답이 5초 안에 오지 않으면 한 번 다시 보냅니다.

---

## 6. 슬랙 알림 설정 (선택)

1. https://api.slack.com/apps 에서 **Create New App → From scratch**를 누르고 앱 이름과 워크스페이스를 고릅니다.
2. 왼쪽 메뉴 **Incoming Webhooks**에서 **Activate Incoming Webhooks**를 켭니다.
3. 아래쪽 **Add New Webhook to Workspace**를 누르고 알림 받을 채널을 고른 뒤 허용합니다.
4. 생성된 `https://hooks.slack.com/services/...` 주소를 `.env`의 `SLACK_WEBHOOK_URL`에 넣고 서버를 다시 시작합니다.
5. 설정 화면의 [테스트 알림 보내기]로 확인합니다.

---

## 7. 서버에 배포하기 (pm2 + nginx)

Ubuntu 서버(예: 클라우드 VM) 기준입니다.

### ① 서버 준비
```bash
# Node.js 20+ 설치 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
sudo npm install -g pm2
```

### ② 가비아 DB 접속 허용
가비아 콘솔 → 해당 DB → **외부 접속 IP 관리**에 **서버의 공인 IP**를 추가합니다. 서버의 공인 IP는 서버에서 `curl ifconfig.me`로 확인할 수 있습니다.

### ③ 코드 올리고 설치
```bash
cd /srv
git clone <저장소 주소> kopo-booking   # 또는 scp 등으로 폴더 업로드 (node_modules 제외)
cd kopo-booking
npm ci --omit=dev
cp .env.example .env && nano .env      # 값 입력: NODE_ENV=production, BASE_URL=https://도메인
npm run db:check
npm run db:migrate
```

### ④ pm2로 실행 (서버 재부팅 시 자동 시작)
```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup        # 출력되는 sudo 명령을 그대로 한 번 실행
pm2 logs kopo-booking   # 로그 보기
```

### ⑤ nginx + HTTPS
```bash
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/kopo-booking
sudo nano /etc/nginx/sites-available/kopo-booking     # 도메인 수정
sudo ln -s /etc/nginx/sites-available/kopo-booking /etc/nginx/sites-enabled/
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d booking.example.ac.kr
sudo nginx -t && sudo systemctl reload nginx
```
- 도메인 DNS의 A 레코드를 서버 IP로 먼저 연결해 두어야 certbot이 동작합니다.
- `NODE_ENV=production`이면 로그인 쿠키가 HTTPS에서만 동작합니다. 반드시 HTTPS로 접속하세요.

### ⑥ 개인정보 자동 익명화 (크론)
상담일로부터 6개월이 지난 예약의 이름·연락처·이메일·문의 내용을 지웁니다. 예약 기록(일시·상태·지원유형)은 통계용으로 남습니다.
```bash
crontab -e
# 매일 새벽 3시 10분 실행
10 3 * * * cd /srv/kopo-booking && /usr/bin/npm run purge-expired >> logs/purge.log 2>&1
```
실행 전에 대상 건수만 보고 싶으면 `npm run purge-expired -- --dry-run`을 씁니다.

### 업데이트할 때
```bash
cd /srv/kopo-booking
git pull
npm ci --omit=dev
npm run db:migrate
pm2 restart kopo-booking
```

---

## 8. 명령어 모음

| 명령어 | 하는 일 |
|---|---|
| `npm run dev` | 개발 서버 (코드 수정 시 자동 재시작) |
| `npm start` | 서버 실행 |
| `npm run db:check` | DB 접속 확인, MySQL 버전과 `cb_` 테이블 목록 출력 |
| `npm run db:migrate` | `db/migrations/*.sql` 중 아직 적용하지 않은 것만 적용 |
| `npm run create-professor -- --department ai-fintech --email ... --name "..." [--admin] [--office "..."]` | 교수 계정 생성. 이미 있으면 비밀번호와 정보만 갱신 |
| `npm run purge-expired [-- --dry-run]` | 보유기간이 지난 개인정보 익명화 |
| `npm test` | 자동 테스트 (`cb_test_` 테이블만 사용, 운영 데이터는 건드리지 않음) |

---

## 9. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| `db:check`에서 `ETIMEDOUT`·`ECONNREFUSED`·`ER_ACCESS_DENIED_ERROR` | 가비아 콘솔에서 **현재 PC·서버의 공인 IP가 허용**되어 있는지 확인하세요. 접속 정보 오타도 확인하세요. |
| 테스트 알림 실패: `HTTP 404 Not Found` | **봇 토큰이 틀렸습니다.** `.env`에서 `==`처럼 등호가 두 번 들어가지 않았는지, 앞뒤에 공백이나 따옴표가 없는지 확인하세요. |
| 테스트 알림 실패: `HTTP 400 ... chat not found` | chat_id가 틀렸거나, 봇이 그 그룹에 초대되지 않았습니다. 개인 chat_id라면 봇에게 먼저 말을 걸지 않은 경우입니다. |
| 테스트 알림 실패: `HTTP 403 ... bot was kicked` | 봇이 그룹에서 내보내졌습니다. 다시 초대하세요. |
| 지원자 화면에 시간이 안 보임 | 슬롯이 **지금부터 24시간 이후**에 열려 있는지 확인하세요. 이미 예약된 시간이거나, 사용 중지된 교수의 시간이면 보이지 않습니다. |
| 로그인이 "잠겼어요"라고 나옴 | 5회 연속 실패하면 10분 동안 잠깁니다. 기다리거나, 다른 관리자가 **설정 → 교수 계정 → 잠금 해제**를 누르면 됩니다. 관리자 비밀번호를 잊었다면 서버에서 `npm run create-professor`를 같은 이메일로 다시 실행하세요. |
| 배포 후 로그인이 계속 풀림 | HTTPS로 접속했는지, nginx에 `X-Forwarded-Proto` 설정이 있는지 확인하세요. |
| 서버 시작 시 "알림 채널 미설정" 경고 | `.env`에 텔레그램 값이 비어 있다는 뜻입니다. 예약은 정상 동작합니다. |

로그는 `logs/app.log`에 남습니다. 예약 생성·취소, 로그인 실패, 알림 실패가 기록되며 비밀번호와 전체 전화번호는 남기지 않습니다.

---

## 10. 폴더 구조와 기술 메모

```
server/
  index.js              Express 앱 (helmet·세션·CSRF·정적 파일·/reserve)
  config.js db.js time.js logger.js http.js
  routes/  public.js    공개 API (/api/departments, /api/reservations ...)
           admin.js     교수 API (/api/admin/*)
  services/ booking.js  예약 가능 시간·신청(자동 배정·중복 방지)·조회·취소
            slots.js    슬롯 열기/닫기·일괄·장소
            reservations.js  교수용 예약 목록·상태·취소·CSV
            accounts.js 교수 계정·학과 정보·내 정보
            notify.js   텔레그램·슬랙
            auth.js csrf.js
  cli/  db-check.js migrate.js create-professor.js purge-expired.js
db/migrations/          001_init.sql, 002_seed_department.sql, 003_...
public/                 정적 화면 (프레임워크 없이 HTML·CSS·JS)
  index.html book.html apply.html done.html my.html 404.html
  admin/ login.html slots.html reservations.html settings.html
  css/app.css  js/*.js  img/logo.png(있으면 헤더에 표시)
test/                   node:test + supertest
deploy/                 ecosystem.config.cjs (pm2), nginx.conf.example
```

- **DB**: 가비아 MySQL(공유 DB)을 씁니다. 이 프로젝트 테이블은 모두 **`cb_` 접두어**를 쓰고, 다른 테이블은 건드리지 않습니다. 문법은 MySQL 5.7 호환이고 InnoDB, utf8mb4를 씁니다. 모든 SQL은 `?` 자리표시자를 씁니다.
- **중복 예약 방지**: 트랜잭션 안에서 `SELECT ... FOR UPDATE`로 슬롯을 잠급니다. 여기에 더해 DB의 UNIQUE 제약(슬롯당 예약 확정 1건)이 이중으로 막습니다.
- **보안**
  - helmet(CSP)을 적용했습니다.
  - 상태를 바꾸는 모든 요청에 CSRF 토큰(`X-CSRF-Token`)을 확인합니다.
  - 레이트리밋을 둡니다: 신청 분당 5회, 조회·취소 분당 10회, 로그인 분당 10회.
  - 신청 폼에 허니팟을 둡니다.
  - 비밀번호는 bcrypt로 저장합니다.
  - 공개 API 응답에는 교수 정보(이름·이메일·ID)를 넣지 않습니다.
- **시간**: 모든 시각은 한국 시간(KST)입니다.
- **테스트**: `npm test`는 `cb_test_` 접두어 테이블을 따로 만들어 씁니다. 실제 텔레그램으로는 보내지 않습니다.
