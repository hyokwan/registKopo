'use strict';
// 설정: 교수 계정 관리(관리자), 학과 정보(관리자), 내 정보·비밀번호(모든 교수)
const bcrypt = require('bcryptjs');
const db = require('../db');
const time = require('../time');
const log = require('../logger');
const auth = require('./auth');
const { HttpError } = require('../http');

const { t } = db;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const invalid = (field, message) => new HttpError(400, message, { errors: { [field]: message } });

function cleanText(v, field, label, max, { required = false } = {}) {
  const s = String(v == null ? '' : v).trim();
  if (required && !s) throw invalid(field, `${label}을(를) 입력해 주세요.`);
  if (s.length > max) throw invalid(field, `${label}은(는) ${max}자 이내로 입력해 주세요.`);
  return s || null;
}

// 텔레그램 chat_id: 숫자(그룹은 -100…) 또는 @채널이름
function cleanChatId(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (!/^-?\d{3,20}$/.test(s) && !/^@[A-Za-z0-9_]{5,32}$/.test(s)) {
    throw invalid('telegramChatId', '텔레그램 chat_id는 숫자(예: 123456789, 그룹은 -100…) 형식으로 입력해 주세요.');
  }
  return s;
}

function cleanPhone(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (!/^[0-9][0-9\- ]{6,18}[0-9]$/.test(s)) throw invalid('contactPhone', '전화번호를 다시 확인해 주세요. (예: 02-2186-5800)');
  return s;
}

const toItem = (p) => ({
  id: p.id,
  email: p.email,
  name: p.name,
  office: p.office,
  telegramChatId: p.telegram_chat_id,
  isAdmin: !!p.is_admin,
  isActive: !!p.is_active,
  locked: !!p.locked,
  upcoming: Number(p.upcoming || 0),
  createdAt: p.created_at,
});

async function listProfessors(admin) {
  const rows = await db.query(
    `SELECT p.id, p.email, p.name, p.office, p.telegram_chat_id, p.is_admin, p.is_active, p.created_at,
            (p.locked_until IS NOT NULL AND p.locked_until > NOW()) AS locked,
            (SELECT COUNT(*) FROM ${t('reservations')} r JOIN ${t('slots')} s ON s.id = r.slot_id
              WHERE s.professor_id = p.id AND r.status = 'BOOKED' AND s.start_at >= ?) AS upcoming
       FROM ${t('professors')} p
      WHERE p.department_id = ?
      ORDER BY p.is_active DESC, p.is_admin DESC, p.name ASC, p.id ASC`,
    [time.nowKst(), admin.department_id]
  );
  return rows.map(toItem);
}

async function getProfessor(admin, id) {
  const list = await listProfessors(admin);
  const p = list.find((x) => x.id === Number(id));
  if (!p) throw new HttpError(404, '교수 계정을 찾을 수 없어요.');
  return p;
}

async function createProfessor(admin, body) {
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 190) throw invalid('email', '이메일 형식을 다시 확인해 주세요.');
  const name = cleanText(body.name, 'name', '이름', 100, { required: true });
  const office = cleanText(body.office, 'office', '연구실', 200);
  const pwErr = auth.validatePassword(body.password);
  if (pwErr) throw invalid('password', pwErr);

  const [dup] = await db.query(`SELECT id FROM ${t('professors')} WHERE email = ?`, [email]);
  if (dup) throw new HttpError(409, '이미 등록된 이메일이에요.', { errors: { email: '이미 등록된 이메일이에요.' } });

  const r = await db.query(
    `INSERT INTO ${t('professors')} (department_id, email, name, password_hash, office, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
    [admin.department_id, email, name, await auth.hashPassword(body.password), office, body.isAdmin ? 1 : 0]
  );
  log.info('professor.created', { id: r.insertId, by: admin.id, isAdmin: !!body.isAdmin });
  return getProfessor(admin, r.insertId);
}

// { name?, office?, isAdmin?, isActive?, password?(재설정) }
async function updateProfessor(admin, id, body) {
  const pid = parseInt(id, 10);
  const result = await db.withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT id, is_admin, is_active FROM ${t('professors')} WHERE id = ? AND department_id = ? FOR UPDATE`,
      [pid, admin.department_id]
    );
    const target = rows[0];
    if (!target) throw new HttpError(404, '교수 계정을 찾을 수 없어요.');

    const sets = [];
    const params = [];
    if (body.name !== undefined) { sets.push('name = ?'); params.push(cleanText(body.name, 'name', '이름', 100, { required: true })); }
    if (body.office !== undefined) { sets.push('office = ?'); params.push(cleanText(body.office, 'office', '연구실', 200)); }
    if (body.telegramChatId !== undefined) { sets.push('telegram_chat_id = ?'); params.push(cleanChatId(body.telegramChatId)); }

    const losingAdmin = (body.isAdmin === false && target.is_admin) || (body.isActive === false && target.is_admin && target.is_active);
    if (target.id === admin.id && (body.isAdmin === false || body.isActive === false)) {
      throw new HttpError(409, '내 계정의 관리자 권한이나 사용 상태는 직접 바꿀 수 없어요. 다른 관리자에게 요청해 주세요.');
    }
    if (losingAdmin) {
      const [[c]] = await conn.query(
        `SELECT COUNT(*) AS n FROM ${t('professors')} WHERE department_id = ? AND is_admin = 1 AND is_active = 1 AND id <> ? FOR UPDATE`,
        [admin.department_id, target.id]
      );
      if (!c.n) throw new HttpError(409, '사용 중인 관리자가 최소 1명은 있어야 해요.');
    }
    if (typeof body.isAdmin === 'boolean') { sets.push('is_admin = ?'); params.push(body.isAdmin ? 1 : 0); }
    if (typeof body.isActive === 'boolean') { sets.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }
    if (body.password !== undefined) {
      const pwErr = auth.validatePassword(body.password);
      if (pwErr) throw invalid('password', pwErr);
      sets.push('password_hash = ?', 'failed_login_count = 0', 'locked_until = NULL');
      params.push(await auth.hashPassword(body.password));
    }
    if (body.unlock === true) sets.push('failed_login_count = 0', 'locked_until = NULL');
    if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');

    await conn.query(`UPDATE ${t('professors')} SET ${sets.join(', ')} WHERE id = ?`, [...params, target.id]);
    // 비활성화된 계정은 다음 요청부터 로그인이 풀린다 (requireAuthApi가 is_active를 확인)
    return target.id;
  });
  log.info('professor.updated', {
    id: result, by: admin.id,
    fields: Object.keys(body).filter((k) => body[k] !== undefined && k !== 'password').concat(body.password !== undefined ? ['password'] : []),
  });
  return getProfessor(admin, result);
}

// ── 학과 ──────────────────────────────────────────────────────
async function getDepartment(professor) {
  const [d] = await db.query(
    `SELECT id, name, slug, default_location, contact_phone FROM ${t('departments')} WHERE id = ?`,
    [professor.department_id]
  );
  return { id: d.id, name: d.name, slug: d.slug, defaultLocation: d.default_location, contactPhone: d.contact_phone };
}

async function updateDepartment(admin, body) {
  const sets = [];
  const params = [];
  if (body.defaultLocation !== undefined) {
    sets.push('default_location = ?');
    params.push(cleanText(body.defaultLocation, 'defaultLocation', '기본 장소', 200, { required: true }));
  }
  if (body.contactPhone !== undefined) { sets.push('contact_phone = ?'); params.push(cleanPhone(body.contactPhone)); }
  if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');
  await db.query(`UPDATE ${t('departments')} SET ${sets.join(', ')} WHERE id = ?`, [...params, admin.department_id]);
  log.info('department.updated', { by: admin.id, fields: Object.keys(body) });
  return getDepartment(admin);
}

// ── 내 정보 ───────────────────────────────────────────────────
async function updateMe(professor, body) {
  const sets = [];
  const params = [];
  if (body.office !== undefined) { sets.push('office = ?'); params.push(cleanText(body.office, 'office', '연구실', 200)); }
  if (body.telegramChatId !== undefined) { sets.push('telegram_chat_id = ?'); params.push(cleanChatId(body.telegramChatId)); }
  if (body.name !== undefined) { sets.push('name = ?'); params.push(cleanText(body.name, 'name', '이름', 100, { required: true })); }
  if (!sets.length) throw new HttpError(400, '바꿀 내용이 없어요.');
  await db.query(`UPDATE ${t('professors')} SET ${sets.join(', ')} WHERE id = ?`, [...params, professor.id]);
}

async function changeMyPassword(professor, { currentPassword, newPassword }) {
  const [row] = await db.query(`SELECT password_hash FROM ${t('professors')} WHERE id = ?`, [professor.id]);
  if (!row || !(await bcrypt.compare(String(currentPassword || ''), row.password_hash))) {
    throw invalid('currentPassword', '현재 비밀번호가 맞지 않아요.');
  }
  const pwErr = auth.validatePassword(newPassword);
  if (pwErr) throw invalid('newPassword', pwErr);
  await db.query(`UPDATE ${t('professors')} SET password_hash = ? WHERE id = ?`, [await auth.hashPassword(newPassword), professor.id]);
  log.info('professor.password_changed', { id: professor.id });
}

module.exports = {
  listProfessors, createProfessor, updateProfessor,
  getDepartment, updateDepartment, updateMe, changeMyPassword,
};
