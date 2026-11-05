'use strict';
// 교수용 예약 관리: 목록(예정/지난/취소), 상태 변경, 교수 취소, CSV
// 교수는 본인 슬롯의 예약만, 관리자는 학과 전체 예약을 다룬다.
const db = require('../db');
const time = require('../time');
const log = require('../logger');
const notify = require('./notify');
const { HttpError } = require('../http');

const { t } = db;
const TABS = ['upcoming', 'past', 'cancelled'];
const PAGE_SIZE = 50;

// 조회 범위 조건: 관리자 + scope=all → 학과 전체, 그 외 → 본인
function scopeWhere(professor, scope) {
  if (professor.is_admin && scope !== 'mine') return { sql: 'p.department_id = ?', params: [professor.department_id] };
  return { sql: 's.professor_id = ?', params: [professor.id] };
}

const baseSelect = () => `
  SELECT r.id, r.code, r.applicant_name, r.phone, r.email, r.applicant_type, r.interest, r.message,
         r.status, r.cancel_reason, r.cancelled_by, r.created_at, r.cancelled_at, r.anonymized_at,
         s.id AS slot_id, s.start_at, s.end_at, COALESCE(s.location, p.office, d.default_location) AS location,
         p.id AS professor_id, p.name AS professor_name
    FROM ${t('reservations')} r
    JOIN ${t('slots')} s ON s.id = r.slot_id
    JOIN ${t('professors')} p ON p.id = s.professor_id
    JOIN ${t('departments')} d ON d.id = p.department_id`;

function toAdmin(r) {
  return {
    id: r.id,
    code: r.code,
    applicantName: r.applicant_name,
    phone: r.phone,
    email: r.email,
    applicantType: r.applicant_type,
    interest: r.interest,
    message: r.message,
    status: r.status,
    cancelReason: r.cancel_reason,
    cancelledBy: r.cancelled_by,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    anonymized: !!r.anonymized_at,
    startAt: r.start_at,
    endAt: r.end_at,
    location: r.location,
    professorId: r.professor_id,
    professorName: r.professor_name,
  };
}

function tabWhere(tab, now) {
  if (tab === 'upcoming') return { sql: "r.status = 'BOOKED' AND s.start_at >= ?", params: [now], order: 's.start_at ASC, r.id ASC' };
  if (tab === 'past') return { sql: "r.status IN ('BOOKED','DONE','NO_SHOW') AND s.start_at < ?", params: [now], order: 's.start_at DESC, r.id DESC' };
  return { sql: "r.status = 'CANCELLED'", params: [], order: 'COALESCE(r.cancelled_at, r.created_at) DESC, r.id DESC' };
}

// 이름·휴대폰(숫자)·예약번호 검색
function searchWhere(q) {
  const s = String(q || '').trim().slice(0, 50);
  if (!s) return { sql: '1=1', params: [] };
  const like = `%${s.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const digits = s.replace(/\D/g, '');
  const conds = ['r.applicant_name LIKE ?', 'r.code LIKE ?'];
  const params = [like, `%${s.toUpperCase().replace(/[^A-Z0-9]/g, '')}%`];
  if (digits.length >= 4) {
    conds.push("REPLACE(r.phone, '-', '') LIKE ?");
    params.push(`%${digits}%`);
  }
  return { sql: `(${conds.join(' OR ')})`, params };
}

async function list(professor, { tab = 'upcoming', scope, q, page, countsOnly } = {}) {
  if (!TABS.includes(tab)) throw new HttpError(400, '목록 종류를 다시 선택해 주세요.');
  const now = time.nowKst();
  const sc = scopeWhere(professor, scope);
  const tw = tabWhere(tab, now);
  const sw = searchWhere(q);
  const pageNo = Math.max(1, Math.min(1000, parseInt(page, 10) || 1));

  const where = `WHERE ${sc.sql} AND ${tw.sql} AND ${sw.sql}`;
  const params = [...sc.params, ...tw.params, ...sw.params];
  const rows = countsOnly ? [] : await db.query(
    `${baseSelect()} ${where} ORDER BY ${tw.order} LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE + 1, (pageNo - 1) * PAGE_SIZE]
  );

  // 탭 배지용 개수 (검색과 무관)
  const [counts] = await db.query(
    `SELECT SUM(r.status = 'BOOKED' AND s.start_at >= ?) AS upcoming,
            SUM(r.status = 'BOOKED' AND s.start_at < ?) AS pastPending
       FROM ${t('reservations')} r
       JOIN ${t('slots')} s ON s.id = r.slot_id
       JOIN ${t('professors')} p ON p.id = s.professor_id
      WHERE ${sc.sql}`,
    [now, now, ...sc.params]
  );

  return {
    tab,
    scope: professor.is_admin && scope !== 'mine' ? 'all' : 'mine',
    page: pageNo,
    hasMore: rows.length > PAGE_SIZE,
    items: rows.slice(0, PAGE_SIZE).map(toAdmin),
    counts: { upcoming: Number(counts.upcoming || 0), pastPending: Number(counts.pastPending || 0) },
  };
}

// 권한 확인 + 잠금 조회
async function lockOwned(conn, professor, id) {
  const rid = parseInt(id, 10);
  if (!rid) throw new HttpError(404, '예약을 찾을 수 없어요.');
  const sc = scopeWhere(professor, 'all');
  const [rows] = await conn.query(`${baseSelect()} WHERE r.id = ? AND ${sc.sql} FOR UPDATE`, [rid, ...sc.params]);
  if (!rows[0]) throw new HttpError(404, '예약을 찾을 수 없어요. 이미 삭제됐거나 담당이 아닌 예약이에요.');
  return rows[0];
}

const STATUS_CHANGE = ['DONE', 'NO_SHOW', 'BOOKED'];

async function setStatus(professor, id, status) {
  if (!STATUS_CHANGE.includes(status)) throw new HttpError(400, '바꿀 상태를 다시 선택해 주세요.');
  const r = await db.withTransaction(async (conn) => {
    const row = await lockOwned(conn, professor, id);
    if (row.status === 'CANCELLED') throw new HttpError(409, '취소된 예약은 상태를 바꿀 수 없어요.');
    if (status !== 'BOOKED' && row.start_at > time.nowKst()) {
      throw new HttpError(409, '완료·불참은 상담 시작 시간이 지난 뒤에 표시할 수 있어요.');
    }
    if (row.status !== status) {
      await conn.query(`UPDATE ${t('reservations')} SET status = ? WHERE id = ?`, [status, row.id]);
    }
    return { ...row, status };
  }).catch((err) => {
    if (err && err.code === 'ER_DUP_ENTRY') throw new HttpError(409, '이 시간에 다른 예약이 있어 되돌릴 수 없어요.');
    throw err;
  });
  log.info('reservation.status', { code: r.code, status, by: professor.id });
  return toAdmin(r);
}

async function cancelByProfessor(professor, id, { reason, closeSlot = true } = {}) {
  const cleanReason = String(reason || '').trim();
  if (!cleanReason) throw new HttpError(400, '취소 사유를 입력해 주세요. 지원자가 예약 조회 화면에서 볼 수 있어요.', { errors: { reason: '취소 사유를 입력해 주세요.' } });
  if (cleanReason.length > 200) throw new HttpError(400, '취소 사유는 200자 이내로 입력해 주세요.', { errors: { reason: '200자 이내로 입력해 주세요.' } });

  const r = await db.withTransaction(async (conn) => {
    const row = await lockOwned(conn, professor, id);
    if (row.status !== 'BOOKED') throw new HttpError(409, '예약 확정 상태인 예약만 취소할 수 있어요.');
    if (row.start_at <= time.nowKst()) throw new HttpError(409, '이미 시작된 상담은 취소 대신 완료·불참으로 표시해 주세요.');
    await conn.query(
      `UPDATE ${t('reservations')}
          SET status = 'CANCELLED', cancelled_by = 'PROFESSOR', cancel_reason = ?, cancelled_at = NOW()
        WHERE id = ?`,
      [cleanReason, row.id]
    );
    // 기본: 같은 시간에 다른 지원자가 다시 예약하지 않도록 슬롯도 닫는다
    if (closeSlot) await conn.query(`UPDATE ${t('slots')} SET is_open = 0 WHERE id = ?`, [row.slot_id]);
    return { ...row, status: 'CANCELLED', cancelled_by: 'PROFESSOR', cancel_reason: cleanReason };
  });
  log.info('reservation.cancelled', { code: r.code, by: 'PROFESSOR', professor: professor.id, phone: log.maskPhone(r.phone), closeSlot: !!closeSlot });
  notify.reservationEvent('CANCELLED_BY_PROFESSOR', r.id);
  return toAdmin(r);
}

// ── CSV (관리자) ───────────────────────────────────────────────
const STATUS_KO = { BOOKED: '예약 확정', DONE: '상담 완료', NO_SHOW: '불참', CANCELLED: '취소' };
const BY_KO = { APPLICANT: '지원자', PROFESSOR: '교수' };

// 엑셀 수식 실행 방지(=,+,-,@로 시작하면 ' 붙임) + 따옴표 이스케이프
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(professor, { from, to } = {}) {
  if (!professor.is_admin) throw new HttpError(403, '관리자만 사용할 수 있는 기능이에요.');
  const conds = ['p.department_id = ?'];
  const params = [professor.department_id];
  if (from) {
    if (!time.isValidDate(from)) throw new HttpError(400, '시작 날짜를 다시 확인해 주세요.');
    conds.push('s.start_at >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    if (!time.isValidDate(to)) throw new HttpError(400, '끝 날짜를 다시 확인해 주세요.');
    conds.push('s.start_at < ?');
    params.push(`${time.dateOf(time.addDays(`${to} 00:00:00`, 1))} 00:00:00`);
  }
  const rows = await db.query(`${baseSelect()} WHERE ${conds.join(' AND ')} ORDER BY s.start_at ASC, r.id ASC`, params);
  const header = ['예약번호', '상담일', '시간', '장소', '담당', '상태', '신청자', '휴대폰', '이메일', '지원유형', '관심분야', '문의', '취소주체', '취소사유', '신청일시', '취소일시'];
  const lines = [header.map(csvCell).join(',')];
  for (const r of rows) {
    lines.push([
      r.code, time.dateOf(r.start_at), `${r.start_at.slice(11, 16)}~${r.end_at.slice(11, 16)}`, r.location, r.professor_name,
      STATUS_KO[r.status] || r.status, r.applicant_name, r.phone, r.email, r.applicant_type, r.interest, r.message,
      BY_KO[r.cancelled_by] || '', r.cancel_reason, r.created_at, r.cancelled_at,
    ].map(csvCell).join(','));
  }
  log.info('reservation.csv', { by: professor.id, rows: rows.length, from: from || null, to: to || null });
  // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM
  return { csv: '﻿' + lines.join('\r\n') + '\r\n', count: rows.length };
}

module.exports = { list, setStatus, cancelByProfessor, exportCsv, csvCell };
