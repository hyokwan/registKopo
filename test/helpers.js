'use strict';
// 테스트는 cb_test_ 접두어 테이블만 사용한다 (운영 cb_ 테이블을 건드리지 않음)
process.env.NODE_ENV = 'test';
process.env.CB_TABLE_PREFIX = 'cb_test_';

const request = require('supertest');
const config = require('../server/config');
const db = require('../server/db');
const auth = require('../server/services/auth');
const { migrate } = require('../server/cli/migrate');
const { createApp } = require('../server/index');

if (config.tablePrefix !== 'cb_test_') throw new Error('테스트 접두어가 cb_test_가 아니에요. 중단합니다.');
const { t } = db;

let migrated = false;
async function setup() {
  if (!migrated) {
    await migrate({ prefix: 'cb_test_', log: () => {} });
    migrated = true;
  }
  await resetData();
}

// FK 순서대로 테스트 데이터 삭제 (TRUNCATE 사용 안 함)
async function resetData() {
  await db.query(`DELETE FROM ${t('reservations')}`);
  await db.query(`DELETE FROM ${t('slots')}`);
  await db.query(`DELETE FROM ${t('professors')}`);
  await db.query(`DELETE FROM ${t('sessions')}`);
  await db.query(`UPDATE ${t('departments')} SET telegram_chat_id = NULL, slack_webhook_url = NULL`);
}

async function department(slug = 'ai-fintech') {
  const [d] = await db.query(`SELECT * FROM ${t('departments')} WHERE slug = ?`, [slug]);
  return d;
}

async function createProfessor({ email = 'prof@test.local', name = '테스트교수', password = 'password123', isAdmin = false, telegramChatId = null } = {}) {
  const dept = await department();
  const hash = await auth.hashPassword(password);
  const r = await db.query(
    `INSERT INTO ${t('professors')} (department_id, email, name, password_hash, is_admin, telegram_chat_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [dept.id, email, name, hash, isAdmin ? 1 : 0, telegramChatId]
  );
  return { id: r.insertId, email, name, password };
}

// 로그인된 supertest agent + csrf 토큰
async function loginAgent(app, email, password) {
  const agent = request.agent(app);
  const c = await agent.get('/api/csrf');
  const res = await agent.post('/api/admin/login').set('X-CSRF-Token', c.body.data.csrfToken).send({ email, password });
  if (!res.body.ok) throw new Error('로그인 실패: ' + res.body.message);
  return { agent, csrf: res.body.data.csrfToken };
}

async function publicAgent(app) {
  const agent = request.agent(app);
  const c = await agent.get('/api/csrf');
  return { agent, csrf: c.body.data.csrfToken };
}

let app = null;
function getApp() {
  if (!app) app = createApp();
  return app;
}

async function teardown() {
  if (app && app.locals.sessionStore) {
    try { await app.locals.sessionStore.close(); } catch (_) { /* ignore */ }
  }
  await db.close();
}

module.exports = { setup, resetData, teardown, getApp, createProfessor, department, loginAgent, publicAgent, db, t, request };
