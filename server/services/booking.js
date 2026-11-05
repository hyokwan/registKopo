'use strict';
// 지원자 예약: 예약 가능 시간 조회, 신청(자동 배정·중복 방지), 조회, 취소
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const time = require('../time');
const log = require('../logger');
const notify = require('./notify');
const { HttpError } = require('../http');

const { t } = db;
// 대졸자 과정 대상
const APPLICANT_TYPES = ['대졸·졸업예정', '구직자', '재직자', '전직·이직', '기타'];
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O/1/I 제외
const MSG_TAKEN = '방금 다른 분이 예약했어요. 다른 시간을 선택해 주세요.';
const MSG_NOT_FOUND = '예약을 찾을 수 없어요. 휴대폰 번호와 예약번호를 다시 확인해 주세요.';

function generateCode() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// 휴대폰: 숫자만 추출 후 010-1234-5678 형식. 올바르지 않으면 null
function normalizePhone(v) {
  const d = String(v || '').replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) return null;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

const normalizeCode = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// 예약 가능 구간: [지금 + 최소시간, 지금 + 최대일]
function bookingWindow() {
  const now = time.nowKst();
  return {
    now,
    min: time.addHours(now, config.booking.minHoursBefore),
    max: time.addDays(now, config.booking.maxDaysAhead),
  };
}

async function findDepartment(slug) {
  const [d] = await db.query(
    `SELECT id, name, slug, default_location, contact_phone, telegram_chat_id, slack_webhook_url
       FROM ${t('departments')} WHERE slug = ? AND is_active = 1`,
    [String(slug || '')]
  );
  if (!d) throw new HttpError(404, '학과를 찾을 수 없어요. 처음 화면에서 다시 시작해 주세요.');
  return d;
}

// 열린 빈 슬롯 (학과·시간 기준) — 교수 정보는 내부에서만 사용
const FREE_SLOTS_SQL = `
  FROM ${t('slots')} s
  JOIN ${t('professors')} p ON p.id = s.professor_id
  JOIN ${t('departments')} d ON d.id = p.department_id
 WHERE p.department_id = ? AND p.is_active = 1 AND s.is_open = 1`;

// ── 예약 가능 시간 ──────────────────────────────────────────
async function availability(slug, weekParam) {
  const dept = await findDepartment(slug);
  const win = bookingWindow();

  const freeInRange = (from, to) => db.query(
    `SELECT s.start_at, s.end_at,
            GROUP_CONCAT(DISTINCT COALESCE(s.location, p.office, d.default_location) SEPARATOR '\\n') AS locations
     ${FREE_SLOTS_SQL}
       AND s.start_at >= ? AND s.start_at < ? AND s.start_at >= ? AND s.start_at <= ?
       AND NOT EXISTS (SELECT 1 FROM ${t('reservations')} r WHERE r.slot_id = s.id AND r.status = 'BOOKED')
     GROUP BY s.start_at, s.end_at
     ORDER BY s.start_at`,
    [dept.id, from, to, win.min, win.max]
  );

  let monday;
  if (time.isValidDate(weekParam)) {
    monday = time.mondayOf(weekParam);
  } else {
    // 주를 지정하지 않으면 가장 빠른 예약 가능 시간이 있는 주
    const [first] = await freeInRange(win.min, win.max);
    monday = time.mondayOf(time.dateOf(first ? first.start_at : win.min));
  }
  const from = `${monday} 00:00:00`;
  const to = time.addDays(from, 7);
  const rows = await freeInRange(from, to);

  const byDate = new Map();
  for (let i = 0; i < 6; i++) byDate.set(time.dateOf(time.addDays(from, i)), []);
  for (const r of rows) {
    const list = byDate.get(time.dateOf(r.start_at));
    if (!list) continue; // 일요일 등 표시하지 않는 날
    const locs = String(r.locations || '').split('\n').filter(Boolean);
    list.push({ startAt: r.start_at, endAt: r.end_at, location: locs.length === 1 ? locs[0] : null });
  }

  const minMonday = time.mondayOf(time.dateOf(win.min));
  const maxMonday = time.mondayOf(time.dateOf(win.max));
  return {
    department: { name: dept.name, slug: dept.slug, defaultLocation: dept.default_location, contactPhone: dept.contact_phone },
    weekStart: monday,
    prevWeek: monday > minMonday ? time.dateOf(time.addDays(from, -7)) : null,
    nextWeek: monday < maxMonday ? time.dateOf(time.addDays(from, 7)) : null,
    days: [...byDate.entries()].map(([date, times]) => ({ date, times })),
  };
}

// ── 신청서 검증 ─────────────────────────────────────────────
function validateForm(body) {
  const errors = {};
  const name = String(body.applicantName || '').trim();
  if (!name) errors.applicantName = '이름을 입력해 주세요.';
  else if (name.length > 50) errors.applicantName = '이름은 50자 이내로 입력해 주세요.';

  const phone = normalizePhone(body.phone);
  if (!String(body.phone || '').trim()) errors.phone = '휴대폰 번호를 입력해 주세요.';
  else if (!phone) errors.phone = '휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)';

  const email = String(body.email || '').trim();
  if (email && (email.length > 190 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.email = '이메일 형식을 다시 확인해 주세요.';

  const applicantType = String(body.applicantType || '');
  if (!APPLICANT_TYPES.includes(applicantType)) errors.applicantType = '지원 유형을 선택해 주세요.';

  const interest = String(body.interest || '').trim();
  if (interest.length > 200) errors.interest = '관심분야는 200자 이내로 입력해 주세요.';

  const message = String(body.message || '').trim();
  if (message.length > 500) errors.message = '문의는 500자 이내로 입력해 주세요.';

  if (body.privacyAgreed !== true) errors.privacyAgreed = '개인정보 수집·이용에 동의해 주세요.';

  if (Object.keys(errors).length) {
    throw new HttpError(400, '입력 내용을 확인해 주세요.', { errors });
  }
  return { applicantName: name, phone, email: email || null, applicantType, interest: interest || null, message: message || null };
}

// ── 신청 ────────────────────────────────────────────────────
async function createReservation(body) {
  body = body || {};
  const start = time.normalizeHour(body.startAt);
  if (!start) throw new HttpError(400, '상담 시간을 다시 선택해 주세요.');
  const form = validateForm(body);
  const dept = await findDepartment(body.department);

  const win = bookingWindow();
  if (start < win.min || start > win.max) {
    throw new HttpError(409, '지금은 예약할 수 없는 시간이에요. 다른 시간을 선택해 주세요.');
  }

  let lastErr;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const result = await db.withTransaction((conn) => assignAndInsert(conn, dept, start, form));
      log.info('reservation.created', { code: result.code, startAt: start, phone: log.maskPhone(form.phone) });
      notify.reservationEvent('BOOKED', result.reservationId);
      return {
        code: result.code,
        startAt: start,
        endAt: time.addHours(start, 1),
        location: result.location,
        departmentName: dept.name,
      };
    } catch (e) {
      lastErr = e;
      // 예약번호 충돌, 데드락 → 재시도. 같은 슬롯 동시 예약(UNIQUE 위반)도 다른 빈 슬롯으로 재시도
      if (e.code === 'ER_DUP_ENTRY' || e.code === 'ER_LOCK_DEADLOCK' || e.code === 'ER_LOCK_WAIT_TIMEOUT') continue;
      throw e;
    }
  }
  if (lastErr && lastErr.code === 'ER_DUP_ENTRY') throw new HttpError(409, MSG_TAKEN, { reason: 'TAKEN' });
  throw lastErr;
}

async function assignAndInsert(conn, dept, start, form) {
  // 1) 그 시간의 열린 슬롯을 잠근다 (같은 시간 신청끼리 직렬화)
  const [slots] = await conn.query(
    `SELECT s.id, s.professor_id, COALESCE(s.location, p.office, d.default_location) AS location
     ${FREE_SLOTS_SQL} AND s.start_at = ?
     ORDER BY s.id
     FOR UPDATE`,
    [dept.id, start]
  );
  if (!slots.length) throw new HttpError(409, '선택하신 시간은 더 이상 예약할 수 없어요. 다른 시간을 선택해 주세요.', { reason: 'CLOSED' });

  // 2) 이미 예약된 슬롯 제외 (잠금 읽기라 최신 커밋 기준)
  const [booked] = await conn.query(
    `SELECT slot_id FROM ${t('reservations')} WHERE slot_id IN (?) AND status = 'BOOKED' FOR UPDATE`,
    [slots.map((s) => s.id)]
  );
  const bookedIds = new Set(booked.map((r) => r.slot_id));
  const free = slots.filter((s) => !bookedIds.has(s.id));
  if (!free.length) throw new HttpError(409, MSG_TAKEN, { reason: 'TAKEN' });

  // 3) 자동 배정: 그 주(월~일) 예약이 가장 적은 교수, 동률이면 무작위
  let chosen = free[0];
  if (free.length > 1) {
    const monday = time.mondayOf(time.dateOf(start));
    const [counts] = await conn.query(
      `SELECT s.professor_id, COUNT(*) AS n
         FROM ${t('reservations')} r JOIN ${t('slots')} s ON s.id = r.slot_id
        WHERE s.professor_id IN (?) AND r.status IN ('BOOKED', 'DONE', 'NO_SHOW')
          AND s.start_at >= ? AND s.start_at < ?
        GROUP BY s.professor_id`,
      [free.map((s) => s.professor_id), `${monday} 00:00:00`, time.addDays(`${monday} 00:00:00`, 7)]
    );
    const countOf = new Map(counts.map((c) => [c.professor_id, Number(c.n)]));
    const min = Math.min(...free.map((s) => countOf.get(s.professor_id) || 0));
    const ties = free.filter((s) => (countOf.get(s.professor_id) || 0) === min);
    chosen = ties[crypto.randomInt(ties.length)];
  }

  // 4) 예약 생성 (예약번호 UNIQUE, 슬롯당 BOOKED 1건 UNIQUE)
  const code = generateCode();
  const [ins] = await conn.query(
    `INSERT INTO ${t('reservations')}
       (slot_id, code, applicant_name, phone, email, applicant_type, interest, message, privacy_agreed, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'BOOKED')`,
    [chosen.id, code, form.applicantName, form.phone, form.email, form.applicantType, form.interest, form.message]
  );
  return { reservationId: ins.insertId, code, location: chosen.location };
}

// ── 조회·취소 (휴대폰 + 예약번호) ───────────────────────────
async function findByPhoneAndCode(conn, phoneRaw, codeRaw, lock) {
  const phone = normalizePhone(phoneRaw);
  const code = normalizeCode(codeRaw);
  if (!phone || code.length !== 8) throw new HttpError(404, MSG_NOT_FOUND);
  const [rows] = await conn.query(
    `SELECT r.id, r.code, r.status, r.applicant_name, r.applicant_type, r.interest, r.phone,
            r.cancelled_by, r.cancelled_at, r.created_at,
            s.start_at, s.end_at, COALESCE(s.location, p.office, d.default_location) AS location, d.name AS department_name, d.contact_phone AS department_phone
       FROM ${t('reservations')} r
       JOIN ${t('slots')} s ON s.id = r.slot_id
       JOIN ${t('professors')} p ON p.id = s.professor_id
       JOIN ${t('departments')} d ON d.id = p.department_id
      WHERE r.code = ? AND r.phone = ? AND r.anonymized_at IS NULL
      ${lock ? 'FOR UPDATE' : ''}`,
    [code, phone]
  );
  if (!rows[0]) throw new HttpError(404, MSG_NOT_FOUND);
  return rows[0];
}

function cancelDeadline(startAt) {
  return time.addHours(startAt, -config.booking.cancelMinHoursBefore);
}

// 공개 응답: 교수 정보 없음
function toPublic(r) {
  const deadline = cancelDeadline(r.start_at);
  return {
    code: r.code,
    status: r.status,
    applicantName: r.applicant_name,
    applicantType: r.applicant_type,
    interest: r.interest,
    startAt: r.start_at,
    endAt: r.end_at,
    location: r.location,
    departmentName: r.department_name,
    departmentPhone: r.department_phone,
    cancelledBy: r.cancelled_by,
    cancelledAt: r.cancelled_at,
    cancelDeadline: deadline,
    canCancel: r.status === 'BOOKED' && time.nowKst() < deadline,
  };
}

async function lookup({ phone, code } = {}) {
  const conn = db.getPool();
  const r = await findByPhoneAndCode(conn, phone, code, false);
  return toPublic(r);
}

// 예약번호를 잊었을 때: 이름 + 휴대폰이 모두 맞는 "아직 끝나지 않은 예약확정" 건만 돌려준다(예약번호 포함)
const MSG_FIND_NONE = '이름과 휴대폰 번호가 맞는 예정된 예약이 없어요. 신청할 때 입력한 그대로인지 확인해 주세요.';
async function findByNameAndPhone({ name, phone } = {}) {
  const cleanName = String(name || '').replace(/\s+/g, '');
  const cleanPhone = normalizePhone(phone);
  if (!cleanName || cleanName.length > 50 || !cleanPhone) throw new HttpError(404, MSG_FIND_NONE);
  const rows = await db.query(
    `SELECT r.id, r.code, r.status, r.applicant_name, r.applicant_type, r.interest, r.phone,
            r.cancelled_by, r.cancelled_at, r.created_at,
            s.start_at, s.end_at, COALESCE(s.location, p.office, d.default_location) AS location,
            d.name AS department_name, d.contact_phone AS department_phone
       FROM ${t('reservations')} r
       JOIN ${t('slots')} s ON s.id = r.slot_id
       JOIN ${t('professors')} p ON p.id = s.professor_id
       JOIN ${t('departments')} d ON d.id = p.department_id
      WHERE r.phone = ? AND REPLACE(r.applicant_name, ' ', '') = ?
        AND r.status = 'BOOKED' AND s.end_at > ? AND r.anonymized_at IS NULL
      ORDER BY s.start_at ASC
      LIMIT 10`,
    [cleanPhone, cleanName, time.nowKst()]
  );
  if (!rows.length) throw new HttpError(404, MSG_FIND_NONE);
  log.info('reservation.found_by_name', { count: rows.length, phone: log.maskPhone(cleanPhone) });
  return rows.map(toPublic);
}

async function cancelByApplicant({ phone, code, reason } = {}) {
  const cleanReason = String(reason || '').trim().slice(0, 200) || null;
  const result = await db.withTransaction(async (conn) => {
    const r = await findByPhoneAndCode(conn, phone, code, true);
    if (r.status !== 'BOOKED') throw new HttpError(409, '이미 취소되었거나 종료된 예약이에요.');
    if (time.nowKst() >= cancelDeadline(r.start_at)) {
      throw new HttpError(409, `상담 시작 ${config.booking.cancelMinHoursBefore}시간 전부터는 온라인으로 취소할 수 없어요. 학과로 연락해 주세요.`);
    }
    await conn.query(
      `UPDATE ${t('reservations')}
          SET status = 'CANCELLED', cancelled_by = 'APPLICANT', cancel_reason = ?, cancelled_at = NOW()
        WHERE id = ?`,
      [cleanReason, r.id]
    );
    return { id: r.id, code: r.code, phone: r.phone };
  });
  log.info('reservation.cancelled', { code: result.code, by: 'APPLICANT', phone: log.maskPhone(result.phone) });
  notify.reservationEvent('CANCELLED_BY_APPLICANT', result.id);
  return lookup({ phone, code });
}

module.exports = {
  availability,
  createReservation,
  lookup,
  findByNameAndPhone,
  cancelByApplicant,
  normalizePhone,
  generateCode,
  APPLICANT_TYPES,
  MSG_TAKEN,
  CODE_ALPHABET,
};
