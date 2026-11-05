'use strict';
// 알림 발송 점검: 설정 → DNS → 네트워크(IPv4/IPv6) → 봇 토큰 → 채팅방 순서로 확인한다.
//   npm run notify:check            확인만 (메시지 안 보냄)
//   npm run notify:check -- --send  실제로 테스트 메시지 1건 발송
// 토큰 값은 출력하지 않는다.
const dns = require('dns').promises;
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../config');

const TOKEN = config.telegram.botToken || '';
const CHAT = String(config.telegram.chatId || '');
const SEND = process.argv.includes('--send');
const mask = (s) => String(s).split(TOKEN).join('bot***');

let problems = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg, hint) => { problems += 1; console.log(`  ❌ ${msg}${hint ? `\n     → ${hint}` : ''}`); };
const info = (msg) => console.log(`  ·  ${msg}`);

// family를 고정해서 HTTPS 요청 (IPv4/IPv6 따로 확인)
function get(urlPath, family) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const req = https.request(
      { host: 'api.telegram.org', path: urlPath, method: 'GET', family, timeout: 6000 },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - started }));
      }
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('6초 안에 응답 없음'), { code: 'TIMEOUT' })));
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  console.log('\n[1] 실행 환경');
  info(`Node ${process.version} / NODE_ENV=${config.isProd ? 'production' : process.env.NODE_ENV || '-'}`);
  info(`프로젝트 폴더: ${config.root}`);
  const envPath = path.join(config.root, '.env');
  if (fs.existsSync(envPath)) ok('.env 파일 있음');
  else bad('.env 파일이 없어요', `${envPath} 에 .env를 만들어 주세요.`);
  const notifySrc = fs.readFileSync(path.join(__dirname, '../services/notify.js'), 'utf8');
  if (notifySrc.includes('api.telegram.org')) ok('알림 코드 포함된 버전');
  else bad('알림 코드가 없는 옛 버전이에요', '최신 코드로 다시 올린 뒤 pm2 restart 해 주세요.');

  console.log('\n[2] 텔레그램 설정 값 (.env)');
  if (!TOKEN) bad('TELEGRAM_BOT_TOKEN이 비어 있어요');
  else if (/^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(TOKEN)) ok(`봇 토큰 형식 정상 (길이 ${TOKEN.length})`);
  else {
    const why = [];
    if (TOKEN.startsWith('=')) why.push('맨 앞에 = 가 하나 더 있어요 (TELEGRAM_BOT_TOKEN==...)');
    if (/\s/.test(TOKEN)) why.push('공백이 들어 있어요');
    if (/["']/.test(TOKEN)) why.push('따옴표가 들어 있어요');
    if (/^bot/i.test(TOKEN)) why.push('앞에 "bot"을 붙이지 마세요');
    bad('봇 토큰 형식이 이상해요', why.join(' / ') || 'BotFather가 준 "숫자:영문" 형태 그대로 넣어 주세요.');
  }
  if (!CHAT) bad('TELEGRAM_CHAT_ID가 비어 있어요');
  else if (/^-?\d+$/.test(CHAT)) ok(`chat_id 형식 정상 (${CHAT.startsWith('-') ? '그룹' : '개인 대화'})`);
  else bad('chat_id 형식이 이상해요', '숫자만 넣어 주세요. 그룹은 - 로 시작해요.');

  console.log('\n[3] DNS (api.telegram.org)');
  let v4 = [];
  let v6 = [];
  try { v4 = await dns.resolve4('api.telegram.org'); ok(`IPv4 ${v4.join(', ')}`); } catch (e) { bad(`IPv4 주소를 못 찾았어요 (${e.code})`, '서버 DNS 설정(/etc/resolv.conf)을 확인해 주세요.'); }
  try { v6 = await dns.resolve6('api.telegram.org'); info(`IPv6 ${v6.join(', ')}`); } catch (_) { info('IPv6 주소 없음'); }

  console.log('\n[4] 네트워크 연결 (서버 → 텔레그램, 나가는 방향)');
  let reachable = false;
  for (const family of [4, 6]) {
    if (family === 6 && !v6.length) continue;
    try {
      const r = await get('/', family);
      ok(`IPv${family} 연결 성공 (HTTP ${r.status}, ${r.ms}ms)`);
      reachable = true;
    } catch (e) {
      const code = e.code || e.name;
      const hint = family === 4
        ? '서버에서 인터넷으로 나가는 통신이 막혀 있어요. Oracle Cloud: VCN → Security List / NSG의 Egress 규칙(0.0.0.0/0, TCP 443), 서브넷이 Private이면 NAT Gateway, 서버 방화벽(iptables/firewalld) OUTPUT 규칙을 확인해 주세요.'
        : 'IPv6만 안 되는 경우는 보통 문제없어요. (Node는 IPv4로 다시 시도함)';
      (family === 4 ? bad : info)(`IPv${family} 연결 실패: ${code} ${mask(e.message)}`, family === 4 ? hint : undefined);
      if (family === 6) info(hint);
    }
  }
  // 참고용: Node 기본 fetch (앱은 IPv4 우선 https로 보내므로 여기서 실패해도 알림에는 영향 없음)
  try {
    const started = Date.now();
    const r = await fetch('https://api.telegram.org/', { signal: AbortSignal.timeout(6000) });
    info(`참고: fetch 방식도 연결됨 (HTTP ${r.status}, ${Date.now() - started}ms)`);
  } catch (e) {
    const cause = e.cause ? `${e.cause.code || ''}` : e.name;
    info(`참고: fetch 방식은 실패(${mask(cause)}) — IPv6가 막힌 서버에서 흔해요. 앱은 IPv4로 직접 보내므로 괜찮아요.`);
  }

  if (TOKEN && reachable) {
    console.log('\n[5] 봇 토큰 확인 (getMe, 앱과 같은 전송 방식)');
    let tokenOk = false;
    try {
      const { httpTransport } = require('../services/notify');
      const j = JSON.parse(await httpTransport(`https://api.telegram.org/bot${TOKEN}/getMe`, {}));
      ok(`봇: ${j.result.first_name} (@${j.result.username})`);
      tokenOk = true;
    } catch (e) {
      bad(`getMe 실패: ${mask(e.message)}`, e.status === 404 || e.status === 401 ? '토큰이 틀렸어요. BotFather에서 다시 복사해 주세요.' : undefined);
    }

    if (tokenOk && CHAT) {
      console.log('\n[6] 채팅방 확인 (getChat)');
      try {
        const r = await get(`/bot${TOKEN}/getChat?chat_id=${encodeURIComponent(CHAT)}`, 4);
        const j = JSON.parse(r.body);
        if (j.ok) ok(`보낼 곳: ${j.result.title || [j.result.first_name, j.result.last_name].filter(Boolean).join(' ')} (${j.result.type})`);
        else bad(`채팅방 접근 불가: ${j.description}`, j.description && /upgraded/.test(j.description)
          ? '그룹이 슈퍼그룹으로 바뀌어 ID가 바뀌었어요. 새 ID(-100…)로 바꿔 주세요.'
          : '봇이 그 그룹에 들어가 있는지, chat_id가 맞는지 확인해 주세요.');
      } catch (e) { bad(`getChat 실패: ${mask(e.message)}`); }

      if (SEND) {
        console.log('\n[7] 테스트 메시지 발송');
        const notify = require('../services/notify');
        const db = require('../db');
        try {
          const [d] = await db.query(`SELECT id FROM ${db.t('departments')} ORDER BY id LIMIT 1`);
          const r = await notify.sendTest({ id: 0, department_id: d.id, name: `서버 점검 (${require('os').hostname()})`, telegram_chat_id: null });
          r.results.forEach((x) => (x.ok ? ok(`${x.channel} 발송 성공`) : bad(`${x.channel} 발송 실패: ${x.reason}`)));
        } catch (e) { bad(`발송 중 오류: ${mask(e.message)}`); } finally { await db.close(); }
      } else {
        info('실제 메시지까지 보내 보려면: npm run notify:check -- --send');
      }
    }
  }

  console.log(problems ? `\n⚠️  문제 ${problems}개를 찾았어요. 위의 → 안내를 확인해 주세요.` : '\n🎉 알림 발송에 문제가 없어요. .env를 바꿨다면 pm2 restart를 해 주세요.');
  console.log('   최근 알림 로그: grep -E "notify" logs/app.log | tail -20\n');
  process.exitCode = problems ? 1 : 0;
})().catch((e) => { console.error(mask(e.stack || e.message)); process.exitCode = 1; });
