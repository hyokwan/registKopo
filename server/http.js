'use strict';

// 응답 형식 통일: { ok: true, data } / { ok: false, message }
class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const ok = (res, data = null, status = 200) => res.status(status).json({ ok: true, data });
const fail = (res, status, message, extra) => res.status(status).json({ ok: false, message, ...(extra || {}) });

// async 라우트 에러를 에러 핸들러로 넘긴다
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, ok, fail, wrap };
