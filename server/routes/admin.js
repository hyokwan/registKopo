'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const auth = require('../services/auth');
const csrf = require('../services/csrf');
const slots = require('../services/slots');
const notify = require('../services/notify');
const reservations = require('../services/reservations');
const accounts = require('../services/accounts');
const { ok, fail, wrap } = require('../http');

const router = express.Router();

const limitHandler = (req, res) => fail(res, 429, '요청이 너무 많아요. 1분 뒤에 다시 시도해 주세요.');
const loginLimiter = rateLimit({
  windowMs: 60e3, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, handler: limitHandler,
  skip: () => config.isTest && !process.env.CB_TEST_RATELIMIT,
});

// ── 로그인 / 로그아웃 (로그인 불필요) ─────────────────────────
router.post('/login', loginLimiter, wrap(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return fail(res, 400, '이메일과 비밀번호를 모두 입력해 주세요.');
  const result = await auth.login(email, password);
  if (result.error) return fail(res, result.status, result.error);

  // 세션 고정 공격 방지: 로그인 시 세션 ID 재발급
  await new Promise((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
  req.session.professorId = result.professor.id;
  const csrfToken = csrf.rotateToken(req);
  await new Promise((resolve, reject) => req.session.save((e) => (e ? reject(e) : resolve())));
  ok(res, { me: auth.toPublicMe(result.professor), csrfToken });
}));

router.post('/logout', wrap(async (req, res) => {
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.clearCookie('cb.sid');
  ok(res, null);
}));

// ── 이하 로그인 필요 ───────────────────────────────────────────
router.use(auth.requireAuthApi);

router.get('/me', (req, res) => ok(res, auth.toPublicMe(req.professor)));

// 내 정보 변경 { office?, telegramChatId?, name? }
router.patch('/me', wrap(async (req, res) => {
  await accounts.updateMe(req.professor, req.body || {});
  ok(res, auth.toPublicMe(await auth.findById(req.professor.id)));
}));

router.post('/me/password', wrap(async (req, res) => {
  await accounts.changeMyPassword(req.professor, req.body || {});
  ok(res, null);
}));

// ── 슬롯 ───────────────────────────────────────────────────────
router.get('/slots', wrap(async (req, res) => {
  ok(res, await slots.getWeek(req.professor, req.query.week));
}));

// 여러 칸 열기/닫기 (클릭 토글, 드래그 공통) { starts: [...], open: true|false }
router.post('/slots/set', wrap(async (req, res) => {
  const { starts, open } = req.body || {};
  if (typeof open !== 'boolean') return fail(res, 400, '열기/닫기 중 무엇을 할지 알려 주세요.');
  ok(res, await slots.setSlots(req.professor, starts, open));
}));

// 일괄 열기 { from, to, weekdays: [1..6], hours: [9..17], location? }
router.post('/slots/bulk', wrap(async (req, res) => {
  ok(res, await slots.bulkOpen(req.professor, req.body || {}));
}));

// 장소 변경 { ids: [...] , location } 또는 { from, to, location }
router.post('/slots/location', wrap(async (req, res) => {
  const body = req.body || {};
  if (Array.isArray(body.ids)) return ok(res, await slots.setLocationByIds(req.professor, body.ids, body.location));
  ok(res, await slots.setLocationByRange(req.professor, body));
}));

// ── 예약 ───────────────────────────────────────────────────────
// ?tab=upcoming|past|cancelled &scope=all|mine &q= &page=
router.get('/reservations', wrap(async (req, res) => {
  ok(res, await reservations.list(req.professor, req.query));
}));

// CSV (관리자) ?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/reservations.csv', auth.requireAdmin, wrap(async (req, res) => {
  const { csv } = await reservations.exportCsv(req.professor, req.query);
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="reservations-${stamp}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send(csv);
}));

// { status: 'DONE' | 'NO_SHOW' | 'BOOKED' }
router.patch('/reservations/:id/status', wrap(async (req, res) => {
  ok(res, await reservations.setStatus(req.professor, req.params.id, (req.body || {}).status));
}));

// { reason, closeSlot?: boolean(기본 true) }
router.post('/reservations/:id/cancel', wrap(async (req, res) => {
  const body = req.body || {};
  ok(res, await reservations.cancelByProfessor(req.professor, req.params.id, { reason: body.reason, closeSlot: body.closeSlot !== false }));
}));

// ── 설정: 학과 (조회는 모든 교수, 변경은 관리자) ───────────────
router.get('/department', wrap(async (req, res) => {
  ok(res, await accounts.getDepartment(req.professor));
}));

router.patch('/department', auth.requireAdmin, wrap(async (req, res) => {
  ok(res, await accounts.updateDepartment(req.professor, req.body || {}));
}));

// ── 설정: 교수 계정 (관리자) ───────────────────────────────────
router.get('/professors', auth.requireAdmin, wrap(async (req, res) => {
  ok(res, await accounts.listProfessors(req.professor));
}));

router.post('/professors', auth.requireAdmin, wrap(async (req, res) => {
  ok(res, await accounts.createProfessor(req.professor, req.body || {}), 201);
}));

router.patch('/professors/:id', auth.requireAdmin, wrap(async (req, res) => {
  ok(res, await accounts.updateProfessor(req.professor, req.params.id, req.body || {}));
}));

// ── 알림 (관리자) ──────────────────────────────────────────────
const notifyLimiter = rateLimit({
  windowMs: 60e3, limit: 5, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (req, res) => fail(res, 429, '테스트 알림을 너무 자주 보냈어요. 1분 뒤에 다시 시도해 주세요.'),
  skip: () => config.isTest && !process.env.CB_TEST_RATELIMIT,
});

router.get('/notify/status', auth.requireAdmin, wrap(async (req, res) => {
  ok(res, await notify.channelStatus(req.professor));
}));

router.post('/notify/test', auth.requireAdmin, notifyLimiter, wrap(async (req, res) => {
  ok(res, await notify.sendTest(req.professor));
}));

module.exports = router;
