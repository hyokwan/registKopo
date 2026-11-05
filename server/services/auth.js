'use strict';
const bcrypt = require('bcryptjs');
const db = require('../db');
const log = require('../logger');
const { fail } = require('../http');

const { t } = db;
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;
const BCRYPT_ROUNDS = 10;

// 존재하지 않는 계정에도 같은 시간만큼 비교해 계정 존재 여부가 드러나지 않게 한다
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_ROUNDS);

const hashPassword = (plain) => bcrypt.hash(plain, BCRYPT_ROUNDS);

function validatePassword(plain) {
  if (typeof plain !== 'string' || plain.length < 8) return '비밀번호는 8자 이상으로 입력해 주세요.';
  if (plain.length > 72) return '비밀번호는 72자 이하로 입력해 주세요.';
  return null;
}

const PUBLIC_FIELDS = 'p.id, p.department_id, p.email, p.name, p.office, p.telegram_chat_id, p.is_admin, p.is_active';

async function findById(id) {
  const rows = await db.query(
    `SELECT ${PUBLIC_FIELDS}, d.name AS department_name, d.slug AS department_slug, d.default_location
       FROM ${t('professors')} p JOIN ${t('departments')} d ON d.id = p.department_id
      WHERE p.id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

// 반환: { professor } 또는 { error, status }
async function login(email, password) {
  const normalized = String(email || '').trim().toLowerCase();
  const rows = await db.query(
    `SELECT id, password_hash, is_active, failed_login_count,
            (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
       FROM ${t('professors')} WHERE email = ? LIMIT 1`,
    [normalized]
  );
  const row = rows[0];
  const genericError = { status: 401, error: '이메일 또는 비밀번호가 맞지 않아요. 다시 확인해 주세요.' };

  if (!row || !row.is_active) {
    await bcrypt.compare(String(password || ''), DUMMY_HASH);
    log.warn('login.fail', { email: normalized, reason: row ? 'inactive' : 'unknown' });
    return genericError;
  }
  if (row.locked) {
    log.warn('login.fail', { email: normalized, reason: 'locked' });
    return { status: 423, error: `로그인을 ${MAX_FAILS}회 연속 실패해 잠시 잠겼어요. ${LOCK_MINUTES}분 뒤에 다시 시도해 주세요.` };
  }

  const match = await bcrypt.compare(String(password || ''), row.password_hash);
  if (!match) {
    const fails = row.failed_login_count + 1;
    if (fails >= MAX_FAILS) {
      await db.query(
        `UPDATE ${t('professors')} SET failed_login_count = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`,
        [LOCK_MINUTES, row.id]
      );
      log.warn('login.fail', { email: normalized, reason: 'locked_now' });
      return { status: 423, error: `로그인을 ${MAX_FAILS}회 연속 실패해 ${LOCK_MINUTES}분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.` };
    }
    await db.query(`UPDATE ${t('professors')} SET failed_login_count = ? WHERE id = ?`, [fails, row.id]);
    log.warn('login.fail', { email: normalized, reason: 'bad_password', fails });
    return { ...genericError, error: `${genericError.error} (${fails}/${MAX_FAILS}회)` };
  }

  await db.query(`UPDATE ${t('professors')} SET failed_login_count = 0, locked_until = NULL WHERE id = ?`, [row.id]);
  return { professor: await findById(row.id) };
}

// 로그인 필요 미들웨어. API는 401 JSON, 페이지는 로그인 화면으로 이동
function loadProfessor(req) {
  const id = req.session && req.session.professorId;
  if (!id) return Promise.resolve(null);
  return findById(id).then((p) => (p && p.is_active ? p : null));
}

function requireAuthApi(req, res, next) {
  loadProfessor(req)
    .then((p) => {
      if (!p) return fail(res, 401, '로그인이 필요해요. 다시 로그인해 주세요.');
      req.professor = p;
      next();
    })
    .catch(next);
}

function requireAuthPage(req, res, next) {
  loadProfessor(req)
    .then((p) => {
      if (!p) return res.redirect(302, '/admin/login.html?next=' + encodeURIComponent(req.originalUrl));
      req.professor = p;
      next();
    })
    .catch(next);
}

function requireAdmin(req, res, next) {
  if (!req.professor || !req.professor.is_admin) return fail(res, 403, '관리자만 사용할 수 있는 기능이에요.');
  next();
}

const toPublicMe = (p) => ({
  id: p.id,
  name: p.name,
  email: p.email,
  office: p.office,
  telegramChatId: p.telegram_chat_id,
  isAdmin: !!p.is_admin,
  department: { id: p.department_id, name: p.department_name, slug: p.department_slug, defaultLocation: p.default_location },
});

module.exports = {
  hashPassword,
  validatePassword,
  login,
  findById,
  requireAuthApi,
  requireAuthPage,
  requireAdmin,
  toPublicMe,
};
