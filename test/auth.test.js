'use strict';
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app;
before(async () => { await h.setup(); app = h.getApp(); });
beforeEach(() => h.resetData());
after(() => h.teardown());

test('비로그인 상태로 /api/admin/* 호출하면 401', async () => {
  const res = await h.request(app).get('/api/admin/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.ok, false);
});

test('비로그인 상태로 /admin/*.html 접근하면 로그인 페이지로 이동', async () => {
  const res = await h.request(app).get('/admin/slots.html');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /^\/admin\/login\.html\?next=/);
  const login = await h.request(app).get('/admin/login.html');
  assert.equal(login.status, 200);
});

test('CSRF 토큰이 없는 POST는 403', async () => {
  const res = await h.request(app).post('/api/admin/login').send({ email: 'a@b.c', password: 'x' });
  assert.equal(res.status, 403);
  assert.equal(res.body.ok, false);
});

test('로그인 → 내 정보 → 로그아웃', async () => {
  const p = await h.createProfessor({ isAdmin: true });
  const { agent, csrf } = await h.loginAgent(app, p.email, p.password);
  const me = await agent.get('/api/admin/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.data.email, p.email);
  assert.equal(me.body.data.isAdmin, true);
  assert.equal(me.body.data.passwordHash, undefined);

  const page = await agent.get('/admin/slots.html');
  assert.equal(page.status, 200);

  const out = await agent.post('/api/admin/logout').set('X-CSRF-Token', csrf);
  assert.equal(out.status, 200);
  const after = await agent.get('/api/admin/me');
  assert.equal(after.status, 401);
});

test('비밀번호 5회 연속 실패하면 잠김 (맞는 비밀번호도 거부)', async () => {
  const p = await h.createProfessor();
  const { agent, csrf } = await h.publicAgent(app);
  for (let i = 1; i <= 4; i++) {
    const r = await agent.post('/api/admin/login').set('X-CSRF-Token', csrf).send({ email: p.email, password: 'wrong-pass' });
    assert.equal(r.status, 401);
  }
  const fifth = await agent.post('/api/admin/login').set('X-CSRF-Token', csrf).send({ email: p.email, password: 'wrong-pass' });
  assert.equal(fifth.status, 423);
  const locked = await agent.post('/api/admin/login').set('X-CSRF-Token', csrf).send({ email: p.email, password: p.password });
  assert.equal(locked.status, 423);
  const [row] = await h.db.query(`SELECT locked_until FROM ${h.t('professors')} WHERE id = ?`, [p.id]);
  assert.ok(row.locked_until);
});

test('없는 계정과 틀린 비밀번호는 같은 안내 문구', async () => {
  const p = await h.createProfessor();
  const { agent, csrf } = await h.publicAgent(app);
  const a = await agent.post('/api/admin/login').set('X-CSRF-Token', csrf).send({ email: 'nobody@test.local', password: 'whatever1' });
  const b = await agent.post('/api/admin/login').set('X-CSRF-Token', csrf).send({ email: p.email, password: 'whatever1' });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.ok(b.body.message.startsWith(a.body.message));
});
