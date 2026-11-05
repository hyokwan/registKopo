'use strict';
// 알림 발송: 텔레그램(HTML parse_mode) + 슬랙(Incoming Webhook)
// 응답을 보낸 뒤 비동기로 처리하며, 실패해도 예약 흐름에 영향을 주지 않는다.
// 타임아웃 5초, 재시도 1회, 실패하면 로그만 남긴다. (토큰·전체 전화번호는 로그에 남기지 않음)
const https = require('https');
const config = require('../config');
const db = require('../db');
const log = require('../logger');
const { formatKo } = require('../time');

const { t } = db;
const TIMEOUT_MS = 5000;
const RETRIES = 1;

// HTTPS POST (JSON). family: 4 = IPv4만, 0 = 운영체제 기본
// fetch를 쓰지 않는 이유: IPv6가 막힌 서버(예: Oracle Cloud 기본 설정)에서 fetch의 IPv4/IPv6 번갈아 연결이
// 시도당 0.25초만 기다리다 ETIMEDOUT으로 실패하는 경우가 있어, IPv4로 직접 연결한다.
function postJson(url, body, family) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const req = https.request(url, {
      method: 'POST',
      family,
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length },
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(text);
        let reason = `HTTP ${res.statusCode}`;
        try { const j = JSON.parse(text); if (j.description) reason += ` ${j.description}`; } catch (_) { if (text) reason += ` ${text.slice(0, 100)}`; }
        reject(Object.assign(new Error(reason), { status: res.statusCode }));
      });
    });
    // 연결부터 응답 완료까지 전체 시간 제한
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), TIMEOUT_MS);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end(data);
  });
}

// 연결 단계 오류(IPv4 경로·주소 없음)일 때만 운영체제 기본 방식으로 한 번 더 시도한다
const NETWORK_ERRORS = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EADDRNOTAVAIL']);

// 실제 HTTP 호출. 테스트에서는 _setTransport로 바꿔 끼운다.
async function httpTransport(url, body) {
  try {
    return await postJson(url, body, 4);
  } catch (err) {
    if (!NETWORK_ERRORS.has(err.code)) throw err;
    return postJson(url, body, 0);
  }
}

// 테스트 환경에서는 실제로 보내지 않는다(.env의 실제 채널로 테스트 메시지가 가지 않도록).
let transport = config.isTest ? async () => '' : httpTransport;
function _setTransport(fn) { transport = fn || (config.isTest ? async () => '' : httpTransport); }

const escapeHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

// 발송 대상: 학과 설정 → 없으면 .env. 배정 교수의 chat_id가 있으면 추가.
function resolveTargets(dept, professorChatId) {
  const targets = [];
  const token = config.telegram.botToken;
  const chatId = (dept && dept.telegram_chat_id) || config.telegram.chatId;
  if (token && chatId) targets.push({ channel: 'telegram', label: '텔레그램(학과)', chatId: String(chatId) });
  if (token && professorChatId && String(professorChatId) !== String(chatId)) {
    targets.push({ channel: 'telegram', label: '텔레그램(담당 교수)', chatId: String(professorChatId) });
  }
  const webhook = (dept && dept.slack_webhook_url) || config.slackWebhookUrl;
  if (webhook) targets.push({ channel: 'slack', label: '슬랙', webhook });
  return targets;
}

async function sendOne(target, html, plain) {
  const url = target.channel === 'telegram'
    ? `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`
    : target.webhook;
  const body = target.channel === 'telegram'
    ? { chat_id: target.chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }
    : { text: plain };
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      await transport(url, body, target);
      return { channel: target.label, ok: true };
    } catch (err) {
      lastErr = err;
      // 4xx(잘못된 chat_id·토큰 등)는 다시 보내도 같으므로 재시도하지 않는다 (429 제외)
      if (err.status && err.status >= 400 && err.status < 500 && err.status !== 429) break;
    }
  }
  const reason = errorReason(lastErr);
  log.warn('notify.failed', { channel: target.label, reason });
  return { channel: target.label, ok: false, reason };
}

function errorReason(err) {
  if (!err) return '알 수 없는 오류';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return '응답 시간 초과(5초)';
  // fetch 실패 메시지에 URL(토큰 포함)이 섞이지 않도록 정리
  return String(err.message || err).replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 200);
}

async function sendAll(targets, html, plain) {
  return Promise.all(targets.map((tg) => sendOne(tg, html, plain)));
}

// 텔레그램 HTML → 슬랙용 일반 텍스트
const toPlain = (html) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const TITLES = {
  BOOKED: '📅 [{dept}] 상담 신청',
  CANCELLED_BY_APPLICANT: '❌ [{dept}] 상담 취소 (지원자)',
  CANCELLED_BY_PROFESSOR: '⚠️ [{dept}] 상담 취소 (교수)',
};

function buildMessage(event, r) {
  const lines = [`<b>${escapeHtml(TITLES[event].replace('{dept}', r.department_name))}</b>`];
  lines.push(`일시: ${escapeHtml(formatKo(r.start_at, r.end_at))}`);
  lines.push(`장소: ${escapeHtml(r.location || '-')}`);
  lines.push(`신청자: ${escapeHtml(r.applicant_name)} (${escapeHtml(r.applicant_type)}) / ${maskPhone(r.phone)}`);
  if (event === 'BOOKED') {
    if (r.interest) lines.push(`관심분야: ${escapeHtml(r.interest)}`);
    if (r.message) lines.push(`문의: ${escapeHtml(r.message)}`);
  } else if (r.cancel_reason) {
    lines.push(`취소 사유: ${escapeHtml(r.cancel_reason)}`);
  }
  lines.push(`담당: ${escapeHtml(r.professor_name)}`);
  lines.push(`예약번호: <code>${escapeHtml(r.code)}</code>`);
  lines.push(`관리: ${escapeHtml(config.baseUrl.replace(/\/$/, ''))}/admin/reservations.html`);
  return lines.join('\n');
}

async function loadReservation(id) {
  const rows = await db.query(
    `SELECT r.code, r.applicant_name, r.phone, r.applicant_type, r.interest, r.message, r.cancel_reason,
            s.start_at, s.end_at, COALESCE(s.location, p.office, d.default_location) AS location,
            p.name AS professor_name, p.telegram_chat_id AS professor_chat_id,
            d.name AS department_name, d.telegram_chat_id, d.slack_webhook_url
       FROM ${t('reservations')} r
       JOIN ${t('slots')} s ON s.id = r.slot_id
       JOIN ${t('professors')} p ON p.id = s.professor_id
       JOIN ${t('departments')} d ON d.id = p.department_id
      WHERE r.id = ?`,
    [id]
  );
  return rows[0] || null;
}

// 예약 이벤트 알림. 반환된 Promise는 테스트에서 기다릴 때만 쓴다.
let pending = Promise.resolve();
function reservationEvent(event, reservationId) {
  const job = new Promise((resolve) => setImmediate(resolve))
    .then(async () => {
      if (!TITLES[event]) return [];
      const r = await loadReservation(reservationId);
      if (!r) return [];
      const targets = resolveTargets(r, r.professor_chat_id);
      if (!targets.length) return [];
      const html = buildMessage(event, r);
      return sendAll(targets, html, toPlain(html));
    })
    .catch((err) => {
      log.error('notify.error', { event, reservationId, reason: errorReason(err) });
      return [];
    });
  pending = pending.then(() => job);
  return job;
}

// 테스트용: 대기 중인 알림이 모두 끝날 때까지 기다린다
function _flush() { return pending; }

// 관리자 [테스트 알림 보내기]: 결과를 기다려 채널별 성공/실패를 돌려준다
async function sendTest(professor) {
  const [dept] = await db.query(`SELECT * FROM ${t('departments')} WHERE id = ?`, [professor.department_id]);
  const targets = resolveTargets(dept, professor.telegram_chat_id);
  if (!targets.length) return { results: [], configured: false };
  const html = [
    `<b>🔔 [${escapeHtml(dept.name)}] 테스트 알림</b>`,
    '상담 예약 알림이 이 채널로 정상 도착해요.',
    `보낸 사람: ${escapeHtml(professor.name)}`,
    `관리: ${escapeHtml(config.baseUrl.replace(/\/$/, ''))}/admin/reservations.html`,
  ].join('\n');
  const results = await sendAll(targets, html, toPlain(html));
  log.info('notify.test', { by: professor.id, results: results.map((x) => `${x.channel}:${x.ok ? 'ok' : 'fail'}`) });
  return { results, configured: true };
}

// 설정 화면 표시용 (값 자체는 내려주지 않는다)
async function channelStatus(professor) {
  const [dept] = await db.query(`SELECT telegram_chat_id, slack_webhook_url FROM ${t('departments')} WHERE id = ?`, [professor.department_id]);
  return {
    telegram: !!(config.telegram.botToken && ((dept && dept.telegram_chat_id) || config.telegram.chatId)),
    telegramTokenMissing: !config.telegram.botToken,
    slack: !!((dept && dept.slack_webhook_url) || config.slackWebhookUrl),
    professorTelegram: !!professor.telegram_chat_id,
  };
}

module.exports = { reservationEvent, sendTest, channelStatus, buildMessage, maskPhone, httpTransport, _setTransport, _flush };
