'use strict';
// 설정: 교수 계정 관리, 학과 정보, 내 정보·비밀번호
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(() => h.resetData());
after(() => h.teardown());

test('관리자는 교수 계정을 추가하고, 새 계정으로 로그인할 수 있다', async () => {
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  const { agent, csrf } = await h.loginAgent(app, admin.email, admin.password);

  const bad = await agent.post('/api/admin/professors').set('X-CSRF-Token', csrf).send({ name: '', email: 'x', password: '123' });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.errors);

  const res = await agent.post('/api/admin/professors').set('X-CSRF-Token', csrf)
    .send({ name: '박교수', email: 'Park@Test.local', password: 'newpass123' });
  assert.equal(res.status, 201);
  assert.equal(res.body.data.email, 'park@test.local');
  assert.equal(res.body.data.isAdmin, false);
  assert.ok(!('password_hash' in res.body.data));

  const dup = await agent.post('/api/admin/professors').set('X-CSRF-Token', csrf).send({ name: '중복', email: 'park@test.local', password: 'newpass123' });
  assert.equal(dup.status, 409);

  await h.loginAgent(app, 'park@test.local', 'newpass123');
  const list = await agent.get('/api/admin/professors');
  assert.equal(list.body.data.length, 2);
});

test('일반 교수는 계정 관리·학과 변경 API를 쓸 수 없다', async () => {
  const p = await h.createProfessor();
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);
  assert.equal((await agent.get('/api/admin/professors')).status, 403);
  assert.equal((await agent.post('/api/admin/professors').set('X-CSRF-Token', csrf).send({})).status, 403);
  assert.equal((await agent.patch('/api/admin/department').set('X-CSRF-Token', csrf).send({ defaultLocation: 'x' })).status, 403);
  assert.equal((await agent.get('/api/admin/department')).status, 200, '학과 정보 조회는 가능');
});

test('사용 중지된 계정은 로그인이 끊기고, 마지막 관리자는 해제할 수 없다', async () => {
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  const p = await h.createProfessor();
  const a = await h.loginAgent(app, admin.email, admin.password);
  const b = await h.loginAgent(app, p.email, p.password);
  const patch = (id, body) => a.agent.patch(`/api/admin/professors/${id}`).set('X-CSRF-Token', a.csrf).send(body);

  assert.equal((await patch(p.id, { isActive: false })).status, 200);
  assert.equal((await b.agent.get('/api/admin/me')).status, 401, '기존 세션도 끊김');
  assert.equal((await patch(p.id, { isActive: true })).status, 200);

  assert.equal((await patch(admin.id, { isAdmin: false })).status, 409, '내 권한은 직접 못 바꿈');
  // 다른 관리자를 지정한 뒤 그 관리자를 해제 → 마지막 관리자가 남으므로 가능
  assert.equal((await patch(p.id, { isAdmin: true })).status, 200);
  assert.equal((await patch(p.id, { isAdmin: false })).status, 200);
});

test('관리자 비밀번호 재설정은 잠금도 풀고, 새 비밀번호로 로그인된다', async () => {
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  const p = await h.createProfessor();
  await h.db.query(`UPDATE ${h.t('professors')} SET locked_until = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE id = ?`, [p.id]);
  const a = await h.loginAgent(app, admin.email, admin.password);
  const list = await a.agent.get('/api/admin/professors');
  assert.equal(list.body.data.find((x) => x.id === p.id).locked, true);

  const res = await a.agent.patch(`/api/admin/professors/${p.id}`).set('X-CSRF-Token', a.csrf).send({ password: 'resetpass99' });
  assert.equal(res.status, 200);
  assert.equal(res.body.data.locked, false);
  await h.loginAgent(app, p.email, 'resetpass99');
});

test('학과 기본 장소·전화번호를 바꾸면 공개 API에 반영된다', async () => {
  const admin = await h.createProfessor({ email: 'adm@test.local', isAdmin: true });
  const { agent, csrf } = await h.loginAgent(app, admin.email, admin.password);
  const bad = await agent.patch('/api/admin/department').set('X-CSRF-Token', csrf).send({ defaultLocation: '  ' });
  assert.equal(bad.status, 400);
  const badPhone = await agent.patch('/api/admin/department').set('X-CSRF-Token', csrf).send({ contactPhone: 'abc' });
  assert.equal(badPhone.status, 400);

  const res = await agent.patch('/api/admin/department').set('X-CSRF-Token', csrf).send({ defaultLocation: '융합관 301호', contactPhone: '02-1234-5678' });
  assert.equal(res.status, 200);
  const pub = await h.request(app).get('/api/departments');
  assert.equal(pub.body.data[0].defaultLocation, '융합관 301호');
  assert.equal(pub.body.data[0].contactPhone, '02-1234-5678');

  // 테스트 시드 원상복구
  await h.db.query(`UPDATE ${h.t('departments')} SET default_location = ?, contact_phone = NULL WHERE id = ?`,
    ['한국폴리텍대학 서울강서캠퍼스 AI핀테크융합과 학과사무실', res.body.data.id]);
});

test('내 정보(연구실·텔레그램 chat_id)와 비밀번호를 바꿀 수 있다', async () => {
  const p = await h.createProfessor();
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);

  const badChat = await agent.patch('/api/admin/me').set('X-CSRF-Token', csrf).send({ telegramChatId: 'hello' });
  assert.equal(badChat.status, 400);
  const me = await agent.patch('/api/admin/me').set('X-CSRF-Token', csrf).send({ office: '301호', telegramChatId: '-1001234567' });
  assert.equal(me.status, 200);
  assert.equal(me.body.data.office, '301호');
  assert.equal(me.body.data.telegramChatId, '-1001234567');

  const wrong = await agent.post('/api/admin/me/password').set('X-CSRF-Token', csrf).send({ currentPassword: 'nope', newPassword: 'another123' });
  assert.equal(wrong.status, 400);
  assert.ok(wrong.body.errors.currentPassword);
  const ok = await agent.post('/api/admin/me/password').set('X-CSRF-Token', csrf).send({ currentPassword: p.password, newPassword: 'another123' });
  assert.equal(ok.status, 200);
  await h.loginAgent(app, p.email, 'another123');
});
