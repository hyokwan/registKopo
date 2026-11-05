'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const db = require('../db');
const csrf = require('../services/csrf');
const booking = require('../services/booking');
const { ok, fail, wrap } = require('../http');

const { t } = db;
const router = express.Router();

const limiter = (limit) => rateLimit({
  windowMs: 60e3,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) => fail(res, 429, '요청이 너무 많아요. 1분 뒤에 다시 시도해 주세요.'),
  skip: () => config.isTest && !process.env.CB_TEST_RATELIMIT,
});
const createLimiter = limiter(5);
const lookupLimiter = limiter(10);

router.get('/csrf', (req, res) => ok(res, { csrfToken: csrf.issueToken(req) }));

router.get('/departments', wrap(async (req, res) => {
  const rows = await db.query(
    `SELECT name, slug, default_location AS defaultLocation, contact_phone AS contactPhone FROM ${t('departments')} WHERE is_active = 1 ORDER BY id`
  );
  ok(res, rows);
}));

router.get('/departments/:slug/availability', wrap(async (req, res) => {
  ok(res, await booking.availability(req.params.slug, req.query.week));
}));

router.post('/reservations', createLimiter, wrap(async (req, res) => {
  const body = req.body || {};
  // 허니팟: 사람에게는 보이지 않는 칸이 채워져 있으면 봇으로 간주
  if (body.website) return fail(res, 400, '요청을 처리하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  ok(res, await booking.createReservation(body), 201);
}));

router.post('/reservations/lookup', lookupLimiter, wrap(async (req, res) => {
  ok(res, await booking.lookup(req.body || {}));
}));

// 예약번호 찾기: 이름 + 휴대폰
router.post('/reservations/find', lookupLimiter, wrap(async (req, res) => {
  const body = req.body || {};
  ok(res, await booking.findByNameAndPhone({ name: body.name, phone: body.phone }));
}));

router.post('/reservations/cancel', lookupLimiter, wrap(async (req, res) => {
  ok(res, await booking.cancelByApplicant(req.body || {}));
}));

module.exports = router;
