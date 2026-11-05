'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const time = require('../server/time');
const booking = require('../server/services/booking');

let app;
before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(() => h.resetData());
after(() => h.teardown());

function futureStart(daysAhead, hour) {
  let d = time.addDays(time.nowKst(), daysAhead);
  while ([0, 6].includes(time.weekdayOf(d))) d = time.addDays(d, 1);
  return `${time.dateOf(d)} ${String(hour).padStart(2, '0')}:00:00`;
}

// 규칙 검사 없이 슬롯을 직접 넣는다
async function openSlot(professorId, start, isOpen = 1) {
  const r = await h.db.query(
    `INSERT INTO ${h.t('slots')} (professor_id, start_at, end_at, is_open) VALUES (?, ?, ?, ?)`,
    [professorId, start, time.addHours(start, 1), isOpen]
  );
  return r.insertId;
}

const form = (startAt, extra = {}) => ({
  department: 'ai-fintech',
  startAt,
  applicantName: '홍길동',
  phone: '01012345678',
  email: 'hong@example.com',
  applicantType: '구직자',
  interest: '자동매매',
  message: '궁금한 점이 있어요.',
  privacyAgreed: true,
  ...extra,
});

async function apply(body) {
  const { agent, csrf } = await h.publicAgent(app);
  return agent.post('/api/reservations').set('X-CSRF-Token', csrf).send(body);
}

const allTimes = (data) => data.days.flatMap((d) => d.times.map((x) => x.startAt));

test('열린 슬롯만 보이고, 24시간 이내·과거·닫힌 시간은 안 보인다', async () => {
  const p = await h.createProfessor();
  const ok1 = futureStart(3, 10);
  const closed = futureStart(3, 11);
  const soon = time.addHours(time.nowKst().slice(0, 14) + '00:00', 3);
  const past = time.addHours(time.nowKst().slice(0, 14) + '00:00', -5);
  await openSlot(p.id, ok1);
  await openSlot(p.id, closed, 0);
  await openSlot(p.id, soon);
  await openSlot(p.id, past);

  const res = await h.request(app).get('/api/departments/ai-fintech/availability?week=' + time.dateOf(ok1));
  assert.equal(res.status, 200);
  assert.deepEqual(allTimes(res.body.data), [ok1]);
  for (const s of [soon, past]) {
    const r = await h.request(app).get('/api/departments/ai-fintech/availability?week=' + time.dateOf(s));
    assert.ok(!allTimes(r.body.data).includes(s), `${s}는 보이면 안 됨`);
  }
  // 주 미지정 → 가장 빠른 예약 가능 주
  const auto = await h.request(app).get('/api/departments/ai-fintech/availability');
  assert.equal(auto.body.data.weekStart, time.mondayOf(time.dateOf(ok1)));
});

test('신청 → 예약번호 발급 → 같은 시간은 더 이상 안 보임', async () => {
  const p = await h.createProfessor();
  const s = futureStart(3, 10);
  await openSlot(p.id, s);
  const res = await apply(form(s));
  assert.equal(res.status, 201);
  const { code } = res.body.data;
  assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal(res.body.data.startAt, s);

  const avail = await h.request(app).get('/api/departments/ai-fintech/availability?week=' + time.dateOf(s));
  assert.deepEqual(allTimes(avail.body.data), []);

  const [row] = await h.db.query(`SELECT phone, status FROM ${h.t('reservations')} WHERE code = ?`, [code]);
  assert.equal(row.phone, '010-1234-5678');
  assert.equal(row.status, 'BOOKED');
});

test('같은 슬롯에 동시 신청 2건 → 1건만 성공', async () => {
  const p = await h.createProfessor();
  const s = futureStart(3, 14);
  await openSlot(p.id, s);
  const [a, b] = await Promise.all([apply(form(s)), apply(form(s, { applicantName: '김철수', phone: '010-9999-8888' }))]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.message, booking.MSG_TAKEN);
  const [{ n }] = await h.db.query(`SELECT COUNT(*) AS n FROM ${h.t('reservations')} WHERE status = 'BOOKED'`);
  assert.equal(n, 1);
});

test('동시 신청 여러 건(5건)이 몰려도 슬롯 수(2)만큼만 성공', async () => {
  const p1 = await h.createProfessor({ email: 'p1@test.local' });
  const p2 = await h.createProfessor({ email: 'p2@test.local' });
  const s = futureStart(4, 10);
  await openSlot(p1.id, s);
  await openSlot(p2.id, s);
  const results = await Promise.all([1, 2, 3, 4, 5].map((i) => apply(form(s, { phone: `010-0000-000${i}` }))));
  assert.equal(results.filter((r) => r.status === 201).length, 2);
  assert.equal(results.filter((r) => r.status === 409).length, 3);
  const rows = await h.db.query(
    `SELECT s.professor_id FROM ${h.t('reservations')} r JOIN ${h.t('slots')} s ON s.id = r.slot_id WHERE r.status = 'BOOKED'`
  );
  assert.deepEqual(rows.map((r) => r.professor_id).sort(), [p1.id, p2.id].sort());
});

test('같은 시간에 교수 2명이 열면 1칸으로 보이고, 2건 예약 뒤 사라진다', async () => {
  const p1 = await h.createProfessor({ email: 'p1@test.local' });
  const p2 = await h.createProfessor({ email: 'p2@test.local' });
  const s = futureStart(3, 15);
  await openSlot(p1.id, s);
  await openSlot(p2.id, s);
  const week = '?week=' + time.dateOf(s);

  let avail = await h.request(app).get('/api/departments/ai-fintech/availability' + week);
  assert.deepEqual(allTimes(avail.body.data), [s]);

  assert.equal((await apply(form(s))).status, 201);
  avail = await h.request(app).get('/api/departments/ai-fintech/availability' + week);
  assert.deepEqual(allTimes(avail.body.data), [s], '빈 슬롯이 남아 있으면 계속 보임');

  assert.equal((await apply(form(s, { phone: '010-2222-3333' }))).status, 201);
  avail = await h.request(app).get('/api/departments/ai-fintech/availability' + week);
  assert.deepEqual(allTimes(avail.body.data), []);

  const third = await apply(form(s, { phone: '010-4444-5555' }));
  assert.equal(third.status, 409);
});

test('자동 배정: 그 주 예약이 가장 적은 교수에게 배정', async () => {
  const p1 = await h.createProfessor({ email: 'p1@test.local' });
  const p2 = await h.createProfessor({ email: 'p2@test.local' });
  const s1 = futureStart(7, 10);
  const s2 = time.addHours(s1, 1);
  // p1은 같은 주에 이미 예약 1건
  const busy = await openSlot(p1.id, time.addHours(s1, 3));
  await h.db.query(
    `INSERT INTO ${h.t('reservations')} (slot_id, code, applicant_name, phone, applicant_type, privacy_agreed)
     VALUES (?, 'BUSY2345', '기존', '010-1111-1111', '기타', 1)`, [busy]
  );
  await openSlot(p1.id, s2);
  await openSlot(p2.id, s2);
  const r = await apply(form(s2));
  assert.equal(r.status, 201);
  const [row] = await h.db.query(
    `SELECT s.professor_id FROM ${h.t('reservations')} r JOIN ${h.t('slots')} s ON s.id = r.slot_id WHERE r.code = ?`,
    [r.body.data.code]
  );
  assert.equal(row.professor_id, p2.id);
});

test('공개 API 응답 어디에도 교수 정보가 없다', async () => {
  const p = await h.createProfessor({ email: 'secret.prof@test.local', name: '비밀교수이름' });
  const s = futureStart(3, 10);
  await openSlot(p.id, s);
  const bodies = [];
  bodies.push((await h.request(app).get('/api/departments')).body);
  bodies.push((await h.request(app).get('/api/departments/ai-fintech/availability?week=' + time.dateOf(s))).body);
  const created = await apply(form(s));
  bodies.push(created.body);
  const { agent, csrf } = await h.publicAgent(app);
  const q = { phone: '010-1234-5678', code: created.body.data.code };
  bodies.push((await agent.post('/api/reservations/lookup').set('X-CSRF-Token', csrf).send(q)).body);
  bodies.push((await agent.post('/api/reservations/cancel').set('X-CSRF-Token', csrf).send(q)).body);
  const json = JSON.stringify(bodies);
  for (const needle of ['secret.prof@test.local', '비밀교수이름', 'professor', 'Professor', `"id":${p.id}`]) {
    assert.ok(!json.includes(needle), `공개 응답에 ${needle} 포함됨`);
  }
});

test('입력 검증: 필수 항목·형식·동의, 허니팟', async () => {
  const p = await h.createProfessor();
  const s = futureStart(3, 10);
  await openSlot(p.id, s);
  const bad = await apply(form(s, { applicantName: '', phone: '0101234', applicantType: '학생', privacyAgreed: false, email: 'x@' }));
  assert.equal(bad.status, 400);
  assert.deepEqual(Object.keys(bad.body.errors).sort(), ['applicantName', 'applicantType', 'email', 'phone', 'privacyAgreed']);
  const long = await apply(form(s, { message: 'a'.repeat(501) }));
  assert.equal(long.status, 400);
  assert.ok(long.body.errors.message);
  const bot = await apply(form(s, { website: 'http://spam' }));
  assert.equal(bot.status, 400);
  const [{ n }] = await h.db.query(`SELECT COUNT(*) AS n FROM ${h.t('reservations')}`);
  assert.equal(n, 0);
});

test('24시간 이내 시간으로 직접 신청해도 거절', async () => {
  const p = await h.createProfessor();
  const soon = time.addHours(time.nowKst().slice(0, 14) + '00:00', 3);
  await openSlot(p.id, soon);
  const r = await apply(form(soon));
  assert.equal(r.status, 409);
});

test('휴대폰·예약번호가 틀리면 조회할 수 없고, 맞으면 조회·취소', async () => {
  const p = await h.createProfessor();
  const s = futureStart(3, 10);
  await openSlot(p.id, s);
  const { code } = (await apply(form(s))).body.data;
  const { agent, csrf } = await h.publicAgent(app);
  const post = (url, body) => agent.post(url).set('X-CSRF-Token', csrf).send(body);

  assert.equal((await post('/api/reservations/lookup', { phone: '010-1234-5679', code })).status, 404);
  assert.equal((await post('/api/reservations/lookup', { phone: '010-1234-5678', code: 'ZZZZZZZZ' })).status, 404);
  assert.equal((await post('/api/reservations/cancel', { phone: '010-0000-0000', code })).status, 404);

  const found = await post('/api/reservations/lookup', { phone: '010 1234 5678', code: code.toLowerCase() });
  assert.equal(found.status, 200);
  assert.equal(found.body.data.status, 'BOOKED');
  assert.equal(found.body.data.canCancel, true);

  const cancelled = await post('/api/reservations/cancel', { phone: '01012345678', code, reason: '일정 변경' });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.data.status, 'CANCELLED');
  assert.equal((await post('/api/reservations/cancel', { phone: '01012345678', code })).status, 409);

  // 취소된 시간은 다시 예약 가능
  const again = await h.request(app).get('/api/departments/ai-fintech/availability?week=' + time.dateOf(s));
  assert.deepEqual(allTimes(again.body.data), [s]);
  assert.equal((await apply(form(s, { phone: '010-7777-6666' }))).status, 201);
});

test('마감(상담 3시간 전) 이후에는 취소할 수 없다', async () => {
  const p = await h.createProfessor();
  const soon = time.addHours(time.nowKst().slice(0, 14) + '00:00', 2);
  const slotId = await openSlot(p.id, soon);
  await h.db.query(
    `INSERT INTO ${h.t('reservations')} (slot_id, code, applicant_name, phone, applicant_type, privacy_agreed)
     VALUES (?, 'SOON2345', '홍길동', '010-1234-5678', '구직자', 1)`, [slotId]
  );
  const { agent, csrf } = await h.publicAgent(app);
  const q = { phone: '010-1234-5678', code: 'SOON2345' };
  const found = await agent.post('/api/reservations/lookup').set('X-CSRF-Token', csrf).send(q);
  assert.equal(found.body.data.canCancel, false);
  const r = await agent.post('/api/reservations/cancel').set('X-CSRF-Token', csrf).send(q);
  assert.equal(r.status, 409);
  assert.match(r.body.message, /학과로 연락/);
});

test('휴대폰 번호 정규화', () => {
  assert.equal(booking.normalizePhone('01012345678'), '010-1234-5678');
  assert.equal(booking.normalizePhone('011-123-4567'), '011-123-4567');
  assert.equal(booking.normalizePhone('02-123-4567'), null);
  assert.equal(booking.normalizePhone(''), null);
});

test('예약번호를 잊으면 이름 + 휴대폰으로 예정된 예약을 찾는다', async () => {
  const p = await h.createProfessor();
  const s1 = futureStart(3, 10);
  const s2 = futureStart(4, 14);
  await openSlot(p.id, s1);
  await openSlot(p.id, s2);
  const a = await apply(form(s1, { applicantName: '김 효관', phone: '010-2222-3333' }));
  const b = await apply(form(s2, { applicantName: '김효관', phone: '01022223333' }));
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const { agent, csrf } = await h.publicAgent(app);
  const find = (body) => agent.post('/api/reservations/find').set('X-CSRF-Token', csrf).send(body);

  const res = await find({ name: '김효관', phone: '010 2222 3333' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.data.map((x) => x.code), [a.body.data.code, b.body.data.code], '이름 띄어쓰기 무시, 시간순');
  assert.ok(res.body.data.every((x) => x.canCancel));
  assert.ok(!JSON.stringify(res.body).includes('테스트교수'), '교수 정보 없음');

  assert.equal((await find({ name: '김효곤', phone: '010-2222-3333' })).status, 404, '이름이 다르면 못 찾음');
  assert.equal((await find({ name: '김효관', phone: '010-2222-3334' })).status, 404, '번호가 다르면 못 찾음');
  assert.equal((await find({ name: '', phone: '' })).status, 404);

  // 취소된 예약은 찾기 결과에서 빠진다
  await agent.post('/api/reservations/cancel').set('X-CSRF-Token', csrf).send({ phone: '01022223333', code: a.body.data.code });
  const after = await find({ name: '김효관', phone: '01022223333' });
  assert.deepEqual(after.body.data.map((x) => x.code), [b.body.data.code]);
});
