'use strict';
// 교수용 예약 관리: 목록 범위·탭, 상태 변경, 교수 취소, CSV, 익명화
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const time = require('../server/time');
const notify = require('../server/services/notify');
const { purgeExpired } = require('../server/cli/purge-expired');
const { csvCell } = require('../server/services/reservations');

let app;
let sent;
before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(async () => {
  await h.resetData();
  sent = [];
  notify._setTransport(async (url, body) => { sent.push(body); });
});
after(async () => { notify._setTransport(null); await h.teardown(); });

const hourFromNow = (n) => time.addHours(time.nowKst().slice(0, 14) + '00:00', n);

// 규칙 검사 없이 슬롯 + 예약을 직접 넣는다
let seq = 0;
async function seedReservation(professorId, start, { status = 'BOOKED', name = '홍길동', phone = '010-1234-5678', message = null } = {}) {
  const s = await h.db.query(
    `INSERT INTO ${h.t('slots')} (professor_id, start_at, end_at, is_open) VALUES (?, ?, ?, 1)`,
    [professorId, start, time.addHours(start, 1)]
  );
  seq += 1;
  const code = `TST${String(seq).padStart(5, '0')}`.replace(/[01]/g, 'A');
  const r = await h.db.query(
    `INSERT INTO ${h.t('reservations')} (slot_id, code, applicant_name, phone, applicant_type, message, privacy_agreed, status)
     VALUES (?, ?, ?, ?, '재직자', ?, 1, ?)`,
    [s.insertId, code, name, phone, message, status]
  );
  return { id: r.insertId, slotId: s.insertId, code };
}

test('교수는 본인 예약만, 관리자는 학과 전체를 본다. 탭별로 나뉜다', async () => {
  const p1 = await h.createProfessor({ email: 'p1@test.local', name: '김교수' });
  const p2 = await h.createProfessor({ email: 'p2@test.local', name: '이교수' });
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  await seedReservation(p1.id, hourFromNow(48), { name: '미래1' });
  await seedReservation(p2.id, hourFromNow(50), { name: '미래2' });
  await seedReservation(p1.id, hourFromNow(-30), { name: '지난1' });
  await seedReservation(p1.id, hourFromNow(-60), { name: '완료1', status: 'DONE' });
  await seedReservation(p2.id, hourFromNow(72), { name: '취소1', status: 'CANCELLED' });

  const a = await h.loginAgent(app, p1.email, p1.password);
  const up = await a.agent.get('/api/admin/reservations?tab=upcoming&scope=all');
  assert.equal(up.status, 200);
  assert.deepEqual(up.body.data.items.map((x) => x.applicantName), ['미래1'], '일반 교수는 scope=all이어도 본인 것만');
  assert.equal(up.body.data.scope, 'mine');
  const past = await a.agent.get('/api/admin/reservations?tab=past');
  assert.deepEqual(past.body.data.items.map((x) => x.applicantName), ['지난1', '완료1']);
  assert.equal(past.body.data.counts.pastPending, 1);

  const b = await h.loginAgent(app, admin.email, admin.password);
  const all = await b.agent.get('/api/admin/reservations?tab=upcoming');
  assert.deepEqual(all.body.data.items.map((x) => x.applicantName), ['미래1', '미래2']);
  assert.equal(all.body.data.items[0].phone, '010-1234-5678', '교수 화면에는 전체 번호');
  const cancelled = await b.agent.get('/api/admin/reservations?tab=cancelled');
  assert.deepEqual(cancelled.body.data.items.map((x) => x.applicantName), ['취소1']);
  const search = await b.agent.get('/api/admin/reservations?tab=upcoming&q=' + encodeURIComponent('미래2'));
  assert.deepEqual(search.body.data.items.map((x) => x.applicantName), ['미래2']);
  const byPhone = await b.agent.get('/api/admin/reservations?tab=upcoming&q=5678');
  assert.equal(byPhone.body.data.items.length, 2);
});

test('완료·불참은 상담 시작 후에만, 다른 교수 예약은 바꿀 수 없다', async () => {
  const p1 = await h.createProfessor({ email: 'p1@test.local' });
  const p2 = await h.createProfessor({ email: 'p2@test.local' });
  const pastR = await seedReservation(p1.id, hourFromNow(-2));
  const futureR = await seedReservation(p1.id, hourFromNow(30));
  const otherR = await seedReservation(p2.id, hourFromNow(-3));
  const { agent, csrf } = await h.loginAgent(app, p1.email, p1.password);
  const patch = (id, status) => agent.patch(`/api/admin/reservations/${id}/status`).set('X-CSRF-Token', csrf).send({ status });

  const done = await patch(pastR.id, 'DONE');
  assert.equal(done.status, 200);
  assert.equal(done.body.data.status, 'DONE');
  assert.equal((await patch(pastR.id, 'NO_SHOW')).body.data.status, 'NO_SHOW');
  assert.equal((await patch(pastR.id, 'BOOKED')).body.data.status, 'BOOKED', '되돌리기 가능');
  assert.equal((await patch(futureR.id, 'DONE')).status, 409);
  assert.equal((await patch(otherR.id, 'DONE')).status, 404);
  assert.equal((await patch(pastR.id, 'CANCELLED')).status, 400, '상태 변경으로 취소할 수 없음');
});

test('교수 취소: 사유 필수, 알림 발송, 슬롯 닫기 선택, 지원자 조회에 반영', async () => {
  const p = await h.createProfessor();
  const r1 = await seedReservation(p.id, hourFromNow(48));
  const r2 = await seedReservation(p.id, hourFromNow(72), { phone: '010-9999-8888' });
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);
  const cancel = (id, body) => agent.post(`/api/admin/reservations/${id}/cancel`).set('X-CSRF-Token', csrf).send(body);

  const noReason = await cancel(r1.id, {});
  assert.equal(noReason.status, 400);
  assert.ok(noReason.body.errors.reason);

  const res = await cancel(r1.id, { reason: '학과 행사' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, 'CANCELLED');
  assert.equal(res.body.data.cancelledBy, 'PROFESSOR');
  const [s1] = await h.db.query(`SELECT is_open FROM ${h.t('slots')} WHERE id = ?`, [r1.slotId]);
  assert.equal(s1.is_open, 0, '기본값: 슬롯도 닫힘');

  await notify._flush();
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /상담 취소 \(교수\)/);
  assert.match(sent[0].text, /취소 사유: 학과 행사/);

  await cancel(r2.id, { reason: '개인 사정', closeSlot: false });
  const [s2] = await h.db.query(`SELECT is_open FROM ${h.t('slots')} WHERE id = ?`, [r2.slotId]);
  assert.equal(s2.is_open, 1, 'closeSlot=false면 다시 예약 가능');

  assert.equal((await cancel(r1.id, { reason: '중복' })).status, 409, '이미 취소된 예약');

  const pub = await h.publicAgent(app);
  const look = await pub.agent.post('/api/reservations/lookup').set('X-CSRF-Token', pub.csrf).send({ phone: '01012345678', code: r1.code });
  assert.equal(look.body.data.status, 'CANCELLED');
  assert.equal(look.body.data.cancelledBy, 'PROFESSOR');
  assert.ok(!JSON.stringify(look.body).includes('테스트교수'), '공개 응답에 교수 정보 없음');
});

test('지난 상담은 교수 취소 대신 완료·불참으로', async () => {
  const p = await h.createProfessor();
  const r = await seedReservation(p.id, hourFromNow(-1));
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);
  const res = await agent.post(`/api/admin/reservations/${r.id}/cancel`).set('X-CSRF-Token', csrf).send({ reason: 'x' });
  assert.equal(res.status, 409);
});

test('CSV는 관리자만, BOM·전체 번호·수식 방지 포함', async () => {
  const p = await h.createProfessor();
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  await seedReservation(p.id, hourFromNow(48), { name: '=HYPERLINK("x")', message: '쉼표, "따옴표"\n줄바꿈' });

  const a = await h.loginAgent(app, p.email, p.password);
  assert.equal((await a.agent.get('/api/admin/reservations.csv')).status, 403);

  const b = await h.loginAgent(app, admin.email, admin.password);
  const res = await b.agent.get('/api/admin/reservations.csv').buffer(true).parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(c));
    r.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
  });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /attachment; filename="reservations-\d{8}\.csv"/);
  const body = res.body;
  assert.equal(body.charCodeAt(0), 0xFEFF);
  assert.match(body, /예약번호,상담일,시간/);
  assert.match(body, /010-1234-5678/);
  assert.match(body, /"'=HYPERLINK\(""x""\)"/);
  assert.match(body, /"쉼표, ""따옴표""\n줄바꿈"/);

  assert.equal((await b.agent.get('/api/admin/reservations.csv?from=2026-13-01')).status, 400);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-5'), "'-5");
  assert.equal(csvCell('010-1'), '010-1');
});

test('익명화: 상담일 + 6개월이 지난 예약만 개인정보를 지운다', async () => {
  const p = await h.createProfessor();
  const old = await seedReservation(p.id, time.addDays(time.nowKst().slice(0, 14) + '00:00', -200), { message: '문의', name: '오래된' });
  const recent = await seedReservation(p.id, hourFromNow(-48), { name: '최근' });

  const preview = await purgeExpired({ dryRun: true });
  assert.equal(preview.target, 1);
  assert.equal(preview.anonymized, 0);

  const res = await purgeExpired();
  assert.equal(res.anonymized, 1);
  const [o] = await h.db.query(`SELECT applicant_name, phone, email, message, anonymized_at, status FROM ${h.t('reservations')} WHERE id = ?`, [old.id]);
  assert.equal(o.applicant_name, '(익명)');
  assert.equal(o.phone, '');
  assert.equal(o.message, null);
  assert.ok(o.anonymized_at);
  assert.equal(o.status, 'BOOKED', '통계용 상태는 유지');
  const [r] = await h.db.query(`SELECT applicant_name FROM ${h.t('reservations')} WHERE id = ?`, [recent.id]);
  assert.equal(r.applicant_name, '최근');

  assert.equal((await purgeExpired()).anonymized, 0, '두 번 실행해도 안전');

  const pub = await h.publicAgent(app);
  const look = await pub.agent.post('/api/reservations/lookup').set('X-CSRF-Token', pub.csrf).send({ phone: '01012345678', code: old.code });
  assert.equal(look.status, 404, '익명화된 예약은 조회 불가');
});

test('/reserve 짧은 주소는 시간 선택 화면으로 이동한다', async () => {
  const res = await h.request(app).get('/reserve?utm_source=homepage');
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, '/book.html?utm_source=homepage');
});
