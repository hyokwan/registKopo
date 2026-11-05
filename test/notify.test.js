'use strict';
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const time = require('../server/time');
const config = require('../server/config');
const notify = require('../server/services/notify');

let app;
let sent;
const saved = { ...config.telegram, slack: config.slackWebhookUrl };

before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(async () => {
  await h.resetData();
  sent = [];
  // 실제 .env 채널 대신 가짜 값 + 가짜 전송기 (실제 메시지는 나가지 않음)
  config.telegram.botToken = '123456:TESTTOKEN';
  config.telegram.chatId = '-100111';
  config.slackWebhookUrl = '';
  notify._setTransport(async (url, body) => { sent.push({ url, body }); });
});
afterEach(() => {
  config.telegram.botToken = saved.botToken;
  config.telegram.chatId = saved.chatId;
  config.slackWebhookUrl = saved.slack;
  notify._setTransport(null);
});
after(() => h.teardown());

function futureStart(daysAhead, hour) {
  let d = time.addDays(time.nowKst(), daysAhead);
  while ([0, 6].includes(time.weekdayOf(d))) d = time.addDays(d, 1);
  return `${time.dateOf(d)} ${String(hour).padStart(2, '0')}:00:00`;
}

async function openSlot(professorId, start) {
  await h.db.query(
    `INSERT INTO ${h.t('slots')} (professor_id, start_at, end_at, is_open) VALUES (?, ?, ?, 1)`,
    [professorId, start, time.addHours(start, 1)]
  );
}

async function book(startAt, extra = {}) {
  const { agent, csrf } = await h.publicAgent(app);
  return agent.post('/api/reservations').set('X-CSRF-Token', csrf).send({
    department: 'ai-fintech', startAt, applicantName: '홍<길동>', phone: '01012345678',
    applicantType: '구직자', interest: '자동매매', message: 'a & b', privacyAgreed: true, ...extra,
  });
}

test('예약 신청 시 텔레그램 알림: 마스킹된 번호, HTML 이스케이프, 관리 링크', async () => {
  const p = await h.createProfessor({ name: '김교수' });
  const start = futureStart(3, 14);
  await openSlot(p.id, start);
  const res = await book(start);
  assert.equal(res.status, 201);
  await notify._flush();

  assert.equal(sent.length, 1);
  const { url, body } = sent[0];
  assert.match(url, /^https:\/\/api\.telegram\.org\/bot123456:TESTTOKEN\/sendMessage$/);
  assert.equal(body.chat_id, '-100111');
  assert.equal(body.parse_mode, 'HTML');
  assert.match(body.text, /상담 신청/);
  assert.match(body.text, /010-\*\*\*\*-5678/);
  assert.ok(!body.text.includes('1234'), '가운데 번호가 노출되면 안 된다');
  assert.match(body.text, /홍&lt;길동&gt;/);
  assert.match(body.text, /a &amp; b/);
  assert.match(body.text, new RegExp(res.body.data.code));
  assert.match(body.text, /\/admin\/reservations\.html/);
  assert.match(body.text, new RegExp(time.formatKo(start, time.addHours(start, 1)).replace(/[()]/g, '\\$&')));
});

test('학과 채널이 있으면 .env 대신 사용하고, 배정 교수 chat_id로도 보낸다. 슬랙도 보낸다', async () => {
  await h.db.query(`UPDATE ${h.t('departments')} SET telegram_chat_id = ?, slack_webhook_url = ?`, ['-100222', 'https://hooks.slack.test/x']);
  const p = await h.createProfessor({ telegramChatId: '999' });
  const start = futureStart(4, 10);
  await openSlot(p.id, start);
  assert.equal((await book(start)).status, 201);
  await notify._flush();

  const chats = sent.filter((s) => s.body.chat_id).map((s) => s.body.chat_id).sort();
  assert.deepEqual(chats, ['-100222', '999']);
  const slack = sent.find((s) => s.url === 'https://hooks.slack.test/x');
  assert.ok(slack);
  assert.ok(!/<b>|&lt;/.test(slack.body.text), '슬랙은 HTML 태그 없이 보낸다');
});

test('지원자 취소 시 취소 알림 (사유 포함)', async () => {
  const p = await h.createProfessor();
  const start = futureStart(3, 15);
  await openSlot(p.id, start);
  const code = (await book(start)).body.data.code;
  await notify._flush();
  sent = [];
  const { agent, csrf } = await h.publicAgent(app);
  const res = await agent.post('/api/reservations/cancel').set('X-CSRF-Token', csrf).send({ phone: '010-1234-5678', code, reason: '일정 변경' });
  assert.equal(res.status, 200);
  await notify._flush();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body.text, /상담 취소 \(지원자\)/);
  assert.match(sent[0].body.text, /취소 사유: 일정 변경/);
});

test('알림 실패(타임아웃·오류)여도 예약은 성공하고, 재시도 1회 후 멈춘다', async () => {
  let calls = 0;
  notify._setTransport(async () => { calls += 1; const e = new Error('timeout'); e.name = 'TimeoutError'; throw e; });
  const p = await h.createProfessor();
  const start = futureStart(3, 16);
  await openSlot(p.id, start);
  const res = await book(start);
  assert.equal(res.status, 201);
  const results = await notify._flush();
  void results;
  assert.equal(calls, 2);
});

test('4xx 오류(잘못된 chat_id 등)는 재시도하지 않는다', async () => {
  let calls = 0;
  notify._setTransport(async () => { calls += 1; const e = new Error('HTTP 400 Bad Request: chat not found'); e.status = 400; throw e; });
  const p = await h.createProfessor({ isAdmin: true, email: 'adm@test.local' });
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);
  const res = await agent.post('/api/admin/notify/test').set('X-CSRF-Token', csrf);
  assert.equal(res.status, 200);
  assert.equal(calls, 1);
  assert.equal(res.body.data.results[0].ok, false);
  assert.match(res.body.data.results[0].reason, /chat not found/);
});

test('알림 채널이 하나도 없어도 예약은 성공한다', async () => {
  config.telegram.botToken = '';
  config.telegram.chatId = '';
  const p = await h.createProfessor();
  const start = futureStart(3, 11);
  await openSlot(p.id, start);
  assert.equal((await book(start)).status, 201);
  await notify._flush();
  assert.equal(sent.length, 0);
});

test('테스트 알림은 관리자만 보낼 수 있고, 상태 API는 값 자체를 내려주지 않는다', async () => {
  const prof = await h.createProfessor();
  const admin = await h.createProfessor({ email: 'admin@test.local', isAdmin: true });

  const a = await h.loginAgent(app, prof.email, prof.password);
  assert.equal((await a.agent.post('/api/admin/notify/test').set('X-CSRF-Token', a.csrf)).status, 403);
  assert.equal((await a.agent.get('/api/admin/notify/status')).status, 403);

  const b = await h.loginAgent(app, admin.email, admin.password);
  const st = await b.agent.get('/api/admin/notify/status');
  assert.equal(st.status, 200);
  assert.equal(st.body.data.telegram, true);
  assert.ok(!JSON.stringify(st.body).includes('TESTTOKEN'));
  assert.ok(!JSON.stringify(st.body).includes('-100111'));

  const res = await b.agent.post('/api/admin/notify/test').set('X-CSRF-Token', b.csrf);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.results.length, 1);
  assert.equal(res.body.data.results[0].ok, true);
  assert.match(sent[0].body.text, /테스트 알림/);
});
