'use strict';
// 교수 슬롯 관리: 주간 조회, 열기/닫기, 일괄 열기, 장소 변경
const config = require('../config');
const db = require('../db');
const time = require('../time');
const { HttpError } = require('../http');

const { t } = db;
const MAX_OPEN_DAYS_AHEAD = 180;
const MAX_BATCH = 1500;
const ALLOWED_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6]); // 월~토

// 슬롯 하나의 시작 시각이 열 수 있는 시각인지 검사. 문제가 있으면 이유 문자열
function checkStart(start, now) {
  const h = time.hourOf(start);
  if (h < config.slotDayStart || h >= config.slotDayEnd) return `${config.slotDayStart}시~${config.slotDayEnd}시 사이만 열 수 있어요.`;
  if (!ALLOWED_WEEKDAYS.has(time.weekdayOf(start))) return '일요일은 열 수 없어요.';
  if (start <= now) return '지난 시간은 바꿀 수 없어요.';
  if (start > time.addDays(now, MAX_OPEN_DAYS_AHEAD)) return `${MAX_OPEN_DAYS_AHEAD}일 이후 시간은 아직 열 수 없어요.`;
  return null;
}

function normalizeStarts(list) {
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, '변경할 시간을 선택해 주세요.');
  if (list.length > MAX_BATCH) throw new HttpError(400, `한 번에 ${MAX_BATCH}칸까지 바꿀 수 있어요. 기간을 나눠 주세요.`);
  const out = new Set();
  for (const s of list) {
    const v = time.normalizeHour(s);
    if (!v) throw new HttpError(400, '시간 형식이 올바르지 않아요. 정시(예: 2026-11-12 14:00)만 선택할 수 있어요.');
    out.add(v);
  }
  return [...out].sort();
}

const cleanLocation = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s.length > 200) throw new HttpError(400, '장소는 200자 이내로 입력해 주세요.');
  return s || null;
};

// 월간 조회: 날짜별 열린 칸·예약 수와 예약자 이름 (본인 슬롯)
async function getMonth(professor, monthParam) {
  const now = time.nowKst();
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(monthParam || '')) ? monthParam : now.slice(0, 7);
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const rows = await db.query(
    `SELECT s.start_at, s.is_open, r.status, r.applicant_name
       FROM ${t('slots')} s
       LEFT JOIN ${t('reservations')} r ON r.slot_id = s.id AND r.status <> 'CANCELLED'
      WHERE s.professor_id = ? AND s.start_at >= ? AND s.start_at < ?
      ORDER BY s.start_at`,
    [professor.id, `${month}-01 00:00:00`, `${next}-01 00:00:00`]
  );
  const days = {};
  for (const r of rows) {
    const d = time.dateOf(r.start_at);
    const day = days[d] || (days[d] = { date: d, open: 0, booked: 0, done: 0, hours: [], bookings: [] });
    const hour = time.hourOf(r.start_at);
    if (r.status) {
      if (r.status === 'BOOKED') day.booked += 1; else day.done += 1;
      day.bookings.push({ hour, name: r.applicant_name, status: r.status });
    } else if (r.is_open) {
      day.open += 1;
      day.hours.push(hour);
    }
  }
  return {
    month,
    prevMonth: prev,
    nextMonth: next,
    today: time.dateOf(now),
    hourStart: config.slotDayStart,
    hourEnd: config.slotDayEnd,
    maxDate: time.dateOf(time.addDays(now, MAX_OPEN_DAYS_AHEAD)),
    days: Object.values(days),
  };
}

// 주간 조회: 월요일부터 토요일까지
async function getWeek(professor, weekParam) {
  const base = time.isValidDate(weekParam) ? weekParam : time.dateOf(time.nowKst());
  const monday = time.mondayOf(base);
  const from = `${monday} 00:00:00`;
  const to = time.addDays(from, 7);
  const rows = await db.query(
    `SELECT s.id, s.start_at, s.end_at, s.location, s.is_open,
            COALESCE(s.location, p.office, d.default_location) AS effective_location,
            r.id AS r_id, r.code AS r_code, r.applicant_name AS r_name, r.phone AS r_phone, r.email AS r_email,
            r.applicant_type AS r_type, r.interest AS r_interest, r.message AS r_message, r.status AS r_status,
            r.created_at AS r_created_at
       FROM ${t('slots')} s
       JOIN ${t('professors')} p ON p.id = s.professor_id
       JOIN ${t('departments')} d ON d.id = p.department_id
       LEFT JOIN ${t('reservations')} r ON r.slot_id = s.id AND r.status <> 'CANCELLED'
      WHERE s.professor_id = ? AND s.start_at >= ? AND s.start_at < ?
      ORDER BY s.start_at`,
    [professor.id, from, to]
  );
  const days = [];
  for (let i = 0; i < 6; i++) days.push(time.dateOf(time.addDays(from, i)));
  return {
    weekStart: monday,
    prevWeek: time.dateOf(time.addDays(from, -7)),
    nextWeek: time.dateOf(time.addDays(from, 7)),
    days,
    dayStart: config.slotDayStart,
    dayEnd: config.slotDayEnd,
    now: time.nowKst(),
    defaultLocation: professor.office || professor.default_location,
    slots: rows.map((r) => ({
      id: r.id,
      startAt: r.start_at,
      endAt: r.end_at,
      location: r.location,
      effectiveLocation: r.effective_location,
      isOpen: !!r.is_open,
      reservation: r.r_id
        ? {
            id: r.r_id, code: r.r_code, applicantName: r.r_name, phone: r.r_phone, email: r.r_email,
            applicantType: r.r_type, interest: r.r_interest, message: r.r_message, status: r.r_status, createdAt: r.r_created_at,
          }
        : null,
    })),
  };
}

// 여러 칸을 열거나 닫는다. 반환 { changed, skipped: [{ startAt, reason }] }
async function setSlots(professor, startList, open) {
  const starts = normalizeStarts(startList);
  const now = time.nowKst();
  const skipped = [];
  const valid = [];
  for (const s of starts) {
    const reason = checkStart(s, now);
    if (reason) skipped.push({ startAt: s, reason });
    else valid.push(s);
  }
  if (!valid.length) return { changed: 0, skipped };

  if (open) {
    const values = valid.map((s) => [professor.id, s, time.addHours(s, 1), 1]);
    const result = await db.query(
      `INSERT INTO ${t('slots')} (professor_id, start_at, end_at, is_open) VALUES ?
       ON DUPLICATE KEY UPDATE is_open = 1`,
      [values]
    );
    // affectedRows: 신규 1, 변경 2, 변경 없음 0 → 실제 바뀐 칸 수 계산이 어려워 대상 수를 반환
    return { changed: valid.length, skipped, affected: result.affectedRows };
  }

  // 닫기: 예약(BOOKED)이 걸린 칸은 건너뛴다. 이력이 없는 칸은 삭제, 취소 이력이 있으면 is_open=0
  return db.withTransaction(async (conn) => {
    const [rows] = await conn.query(
      `SELECT s.id, s.start_at,
              (SELECT COUNT(*) FROM ${t('reservations')} r WHERE r.slot_id = s.id) AS total,
              (SELECT COUNT(*) FROM ${t('reservations')} r WHERE r.slot_id = s.id AND r.status = 'BOOKED') AS booked
         FROM ${t('slots')} s
        WHERE s.professor_id = ? AND s.start_at IN (?)
        FOR UPDATE`,
      [professor.id, valid]
    );
    const toDelete = [];
    const toHide = [];
    for (const r of rows) {
      if (r.booked > 0) skipped.push({ startAt: r.start_at, reason: '예약이 있어 닫을 수 없어요. 먼저 예약을 취소해 주세요.' });
      else if (r.total > 0) toHide.push(r.id);
      else toDelete.push(r.id);
    }
    if (toDelete.length) await conn.query(`DELETE FROM ${t('slots')} WHERE id IN (?) AND professor_id = ?`, [toDelete, professor.id]);
    if (toHide.length) await conn.query(`UPDATE ${t('slots')} SET is_open = 0 WHERE id IN (?) AND professor_id = ?`, [toHide, professor.id]);
    return { changed: toDelete.length + toHide.length, skipped };
  });
}

// 일괄 열기: 기간 + 요일 + 시간대
async function bulkOpen(professor, { from, to, weekdays, hours, location }) {
  if (!time.isValidDate(from) || !time.isValidDate(to)) throw new HttpError(400, '시작일과 종료일을 선택해 주세요.');
  if (from > to) throw new HttpError(400, '종료일이 시작일보다 빠를 수 없어요.');
  const wds = new Set((Array.isArray(weekdays) ? weekdays : []).map(Number).filter((n) => ALLOWED_WEEKDAYS.has(n)));
  if (!wds.size) throw new HttpError(400, '요일을 하나 이상 선택해 주세요.');
  const hs = [...new Set((Array.isArray(hours) ? hours : []).map(Number))]
    .filter((h) => Number.isInteger(h) && h >= config.slotDayStart && h < config.slotDayEnd)
    .sort((a, b) => a - b);
  if (!hs.length) throw new HttpError(400, '시간대를 하나 이상 선택해 주세요.');
  const loc = cleanLocation(location);

  const now = time.nowKst();
  const starts = [];
  for (let d = `${from} 00:00:00`; time.dateOf(d) <= to; d = time.addDays(d, 1)) {
    if (!wds.has(time.weekdayOf(d))) continue;
    for (const h of hs) {
      const s = `${time.dateOf(d)} ${String(h).padStart(2, '0')}:00:00`;
      if (!checkStart(s, now)) starts.push(s);
    }
    if (starts.length > MAX_BATCH) throw new HttpError(400, `한 번에 ${MAX_BATCH}칸까지 열 수 있어요. 기간을 나눠 주세요.`);
  }
  if (!starts.length) return { changed: 0, skipped: [] };
  const result = await setSlots(professor, starts, true);
  if (loc) await setLocationByStarts(professor, starts, loc);
  return result;
}

async function setLocationByIds(professor, ids, location) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!list.length) throw new HttpError(400, '장소를 바꿀 시간을 선택해 주세요.');
  const r = await db.query(
    `UPDATE ${t('slots')} SET location = ? WHERE professor_id = ? AND id IN (?)`,
    [cleanLocation(location), professor.id, list]
  );
  return { changed: r.affectedRows };
}

async function setLocationByStarts(professor, starts, location) {
  const r = await db.query(
    `UPDATE ${t('slots')} SET location = ? WHERE professor_id = ? AND start_at IN (?)`,
    [cleanLocation(location), professor.id, starts]
  );
  return { changed: r.affectedRows };
}

// 기간 안의 열린 슬롯 장소를 한 번에 변경
async function setLocationByRange(professor, { from, to, location }) {
  if (!time.isValidDate(from) || !time.isValidDate(to) || from > to) throw new HttpError(400, '기간을 올바르게 선택해 주세요.');
  const r = await db.query(
    `UPDATE ${t('slots')} SET location = ?
      WHERE professor_id = ? AND start_at >= ? AND start_at < ? AND start_at > ?`,
    [cleanLocation(location), professor.id, `${from} 00:00:00`, time.addDays(`${to} 00:00:00`, 1), time.nowKst()]
  );
  return { changed: r.affectedRows };
}

module.exports = { getWeek, getMonth, setSlots, bulkOpen, setLocationByIds, setLocationByRange, checkStart };
