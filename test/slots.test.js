'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const time = require('../server/time');

let app;
before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(() => h.resetData());
after(() => h.teardown());

// 지금부터 daysAhead일 이후의 첫 평일(월~금) hour시
function futureStart(daysAhead, hour) {
  let d = time.addDays(time.nowKst(), daysAhead);
  while ([0, 6].includes(time.weekdayOf(d))) d = time.addDays(d, 1);
  return `${time.dateOf(d)} ${String(hour).padStart(2, '0')}:00:00`;
}

async function login() {
  const p = await h.createProfessor({ isAdmin: true });
  const s = await h.loginAgent(app, p.email, p.password);
  return { ...s, professor: p };
}

test('칸 열기 → 주간 조회에 보임 → 닫으면 삭제', async () => {
  const { agent, csrf } = await login();
  const s1 = futureStart(3, 10);
  const s2 = futureStart(3, 11);
  const open = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s1, s2], open: true });
  assert.equal(open.status, 200);
  assert.equal(open.body.data.changed, 2);

  const week = await agent.get('/api/admin/slots?week=' + time.dateOf(s1));
  const found = week.body.data.slots.filter((s) => s.isOpen);
  assert.equal(found.length, 2);
  assert.equal(found[0].endAt, time.addHours(s1, 1));
  assert.equal(week.body.data.weekStart, time.mondayOf(time.dateOf(s1)));

  const close = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s1], open: false });
  assert.equal(close.body.data.changed, 1);
  const rows = await h.db.query(`SELECT * FROM ${h.t('slots')}`);
  assert.equal(rows.length, 1);
});

test('지난 시간·운영 시간 밖·정시가 아닌 시간은 열 수 없음', async () => {
  const { agent, csrf } = await login();
  const past = `${time.dateOf(time.addDays(time.nowKst(), -1))} 10:00:00`;
  const late = futureStart(3, 22);
  const r = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [past, late], open: true });
  assert.equal(r.body.data.changed, 0);
  assert.equal(r.body.data.skipped.length, 2);

  const bad = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [futureStart(3, 10).replace(':00:00', ':30:00')], open: true });
  assert.equal(bad.status, 400);
});

test('예약된 슬롯은 닫을 수 없음', async () => {
  const { agent, csrf, professor } = await login();
  const s = futureStart(3, 14);
  await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s], open: true });
  const [slot] = await h.db.query(`SELECT id FROM ${h.t('slots')} WHERE professor_id = ?`, [professor.id]);
  await h.db.query(
    `INSERT INTO ${h.t('reservations')} (slot_id, code, applicant_name, phone, applicant_type, privacy_agreed, status)
     VALUES (?, 'TESTAB23', '홍길동', '010-1234-5678', '구직자', 1, 'BOOKED')`,
    [slot.id]
  );
  const r = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s], open: false });
  assert.equal(r.body.data.changed, 0);
  assert.match(r.body.data.skipped[0].reason, /예약/);
  const [still] = await h.db.query(`SELECT is_open FROM ${h.t('slots')} WHERE id = ?`, [slot.id]);
  assert.equal(still.is_open, 1);

  // 취소된 예약만 있으면 삭제 대신 닫힘 처리
  await h.db.query(`UPDATE ${h.t('reservations')} SET status = 'CANCELLED' WHERE slot_id = ?`, [slot.id]);
  const r2 = await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s], open: false });
  assert.equal(r2.body.data.changed, 1);
  const [closed] = await h.db.query(`SELECT is_open FROM ${h.t('slots')} WHERE id = ?`, [slot.id]);
  assert.equal(closed.is_open, 0);
});

test('일괄 열기: 기간 + 요일 + 시간대, 장소 지정', async () => {
  const { agent, csrf } = await login();
  const from = time.dateOf(futureStart(3, 9));
  const to = time.dateOf(time.addDays(`${from} 00:00:00`, 13));
  const r = await agent.post('/api/admin/slots/bulk').set('X-CSRF-Token', csrf)
    .send({ from, to, weekdays: [1, 3], hours: [10, 14], location: 'OO관 301호' });
  assert.equal(r.status, 200);
  // 14일 안에 월·수는 정확히 4일 → 8칸
  assert.equal(r.body.data.changed, 8);
  const rows = await h.db.query(`SELECT start_at, location FROM ${h.t('slots')}`);
  assert.equal(rows.length, 8);
  assert.ok(rows.every((x) => [1, 3].includes(time.weekdayOf(x.start_at)) && x.location === 'OO관 301호'));

  const again = await agent.post('/api/admin/slots/bulk').set('X-CSRF-Token', csrf).send({ from, to, weekdays: [1, 3], hours: [10, 14] });
  assert.equal(again.status, 200);
  assert.equal((await h.db.query(`SELECT COUNT(*) AS n FROM ${h.t('slots')}`))[0].n, 8);

  const bad = await agent.post('/api/admin/slots/bulk').set('X-CSRF-Token', csrf).send({ from, to, weekdays: [], hours: [10] });
  assert.equal(bad.status, 400);
});

test('장소 변경: 개별·기간·기본 장소', async () => {
  const { agent, csrf } = await login();
  const s = futureStart(3, 10);
  await agent.post('/api/admin/slots/set').set('X-CSRF-Token', csrf).send({ starts: [s], open: true });
  let week = await agent.get('/api/admin/slots?week=' + time.dateOf(s));
  const slot = week.body.data.slots[0];
  assert.match(slot.effectiveLocation, /학과사무실/);

  await agent.patch('/api/admin/me').set('X-CSRF-Token', csrf).send({ office: '본관 501호' });
  week = await agent.get('/api/admin/slots?week=' + time.dateOf(s));
  assert.equal(week.body.data.slots[0].effectiveLocation, '본관 501호');

  await agent.post('/api/admin/slots/location').set('X-CSRF-Token', csrf).send({ ids: [slot.id], location: '세미나실' });
  week = await agent.get('/api/admin/slots?week=' + time.dateOf(s));
  assert.equal(week.body.data.slots[0].effectiveLocation, '세미나실');

  const d = time.dateOf(s);
  await agent.post('/api/admin/slots/location').set('X-CSRF-Token', csrf).send({ from: d, to: d, location: '' });
  week = await agent.get('/api/admin/slots?week=' + d);
  assert.equal(week.body.data.slots[0].effectiveLocation, '본관 501호');
});

test('다른 교수의 슬롯은 건드릴 수 없음', async () => {
  const other = await h.createProfessor({ email: 'other@test.local' });
  const s = futureStart(3, 10);
  await h.db.query(`INSERT INTO ${h.t('slots')} (professor_id, start_at, end_at) VALUES (?, ?, ?)`, [other.id, s, time.addHours(s, 1)]);
  const { agent, csrf } = await login();
  const week = await agent.get('/api/admin/slots?week=' + time.dateOf(s));
  assert.equal(week.body.data.slots.length, 0);
  const [row] = await h.db.query(`SELECT id FROM ${h.t('slots')}`);
  await agent.post('/api/admin/slots/location').set('X-CSRF-Token', csrf).send({ ids: [row.id], location: 'X' });
  const [after] = await h.db.query(`SELECT location FROM ${h.t('slots')} WHERE id = ?`, [row.id]);
  assert.equal(after.location, null);
});
