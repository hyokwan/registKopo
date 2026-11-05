'use strict';
// 모든 시각은 KST 기준 'YYYY-MM-DD HH:mm:ss' 문자열로 다룬다 (DB도 +09:00, dateStrings)
const KST_OFFSET = 9 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');

// Date(UTC 인스턴트) -> KST 문자열
function toKst(date) {
  const d = new Date(date.getTime() + KST_OFFSET);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

// KST 문자열 -> Date(UTC 인스턴트)
function fromKst(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  const [, y, mo, d, hh = '0', mm = '0', ss = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss) - KST_OFFSET;
  const date = new Date(ms);
  // 존재하지 않는 날짜(2월 30일 등) 거르기
  if (toKst(date).slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  return date;
}

const nowKst = () => toKst(new Date());
const addHours = (s, h) => toKst(new Date(fromKst(s).getTime() + h * 3600e3));
const addDays = (s, n) => addHours(s, n * 24);
const dateOf = (s) => String(s).slice(0, 10);
const hourOf = (s) => parseInt(String(s).slice(11, 13), 10);

// 0=일 ... 6=토
function weekdayOf(s) {
  const [y, m, d] = dateOf(s).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 해당 날짜가 속한 주의 월요일 'YYYY-MM-DD'
function mondayOf(dateStr) {
  const wd = weekdayOf(dateStr);
  const diff = wd === 0 ? -6 : 1 - wd;
  return dateOf(addDays(`${dateOf(dateStr)} 00:00:00`, diff));
}

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !!fromKst(s);
}

// 정시인 시각 'YYYY-MM-DD HH:00:00'으로 정규화. 정시가 아니면 null
function normalizeHour(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(s || '').trim());
  if (!m || m[3] !== '00' || (m[4] && m[4] !== '00')) return null;
  const v = `${m[1]} ${m[2]}:00:00`;
  return fromKst(v) ? v : null;
}

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
function formatKo(start, end) {
  return `${dateOf(start)}(${WEEKDAY_KO[weekdayOf(start)]}) ${start.slice(11, 16)}~${end.slice(11, 16)}`;
}

module.exports = { toKst, fromKst, nowKst, addHours, addDays, dateOf, hourOf, weekdayOf, mondayOf, isValidDate, normalizeHour, formatKo, WEEKDAY_KO };
