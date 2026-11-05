'use strict';
const crypto = require('crypto');
const { fail } = require('../http');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function issueToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function rotateToken(req) {
  req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  return req.session.csrfToken;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// 상태를 바꾸는 모든 요청(POST/PATCH/PUT/DELETE)에 X-CSRF-Token 헤더 검증
function verify(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const sent = req.get('X-CSRF-Token');
  const expected = req.session && req.session.csrfToken;
  if (!sent || !expected || !safeEqual(sent, expected)) {
    return fail(res, 403, '보안 확인이 만료됐어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.');
  }
  next();
}

module.exports = { issueToken, rotateToken, verify };
