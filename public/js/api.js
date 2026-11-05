/* 공통 JS: JSON API 호출(CSRF 자동 처리), 토스트, 헤더, 날짜 유틸 */
(function () {
  'use strict';

  let csrfToken = null;

  async function getCsrf(force) {
    if (csrfToken && !force) return csrfToken;
    const res = await fetch('/api/csrf', { credentials: 'same-origin' });
    const json = await res.json();
    csrfToken = json.data.csrfToken;
    return csrfToken;
  }

  // 반환: data. 실패 시 Error(message)를 던지고 err.status를 담는다
  async function request(method, url, body, retried) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-CSRF-Token'] = await getCsrf();
    }
    let res;
    try {
      res = await fetch(url, {
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (_) {
      const e = new Error('인터넷 연결을 확인한 뒤 다시 시도해 주세요.');
      e.status = 0;
      throw e;
    }
    // CSRF 만료 시 토큰을 새로 받아 한 번 재시도
    if (res.status === 403 && method !== 'GET' && !retried) {
      await getCsrf(true);
      return request(method, url, body, true);
    }
    let json = null;
    try { json = await res.json(); } catch (_) { /* not json */ }
    if (!res.ok || !json || !json.ok) {
      const e = new Error((json && json.message) || '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
      e.status = res.status;
      e.body = json;
      if (res.status === 401 && url.startsWith('/api/admin/') && location.pathname !== '/admin/login.html') {
        location.href = '/admin/login.html?next=' + encodeURIComponent(location.pathname + location.search);
      }
      throw e;
    }
    return json.data;
  }

  const api = {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body || {}),
    patch: (url, body) => request('PATCH', url, body || {}),
    del: (url, body) => request('DELETE', url, body || {}),
    setCsrf: (token) => { csrfToken = token; },
  };

  // ── 토스트 ────────────────────────────────────────────
  function toast(message, type) {
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'toast-wrap';
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast--' + type : '');
    const icon = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
    el.textContent = icon + ' ' + message;
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-show'));
    setTimeout(() => {
      el.classList.remove('is-show');
      setTimeout(() => el.remove(), 300);
    }, type === 'error' ? 4000 : 2600);
  }

  // ── 날짜 유틸 (모두 KST 기준 문자열 'YYYY-MM-DD HH:mm:ss') ──
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function parseKst(s) {
    // 'YYYY-MM-DD HH:mm:ss' 또는 'YYYY-MM-DD'
    const [d, tm] = String(s).split(/[ T]/);
    const [y, m, day] = d.split('-').map(Number);
    const [hh, mm] = (tm || '00:00').split(':').map(Number);
    return { y, m, d: day, hh: hh || 0, mm: mm || 0, wd: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
  }
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = {
    date: (s) => { const p = parseKst(s); return `${p.m}월 ${p.d}일 (${WEEKDAYS[p.wd]})`; },
    dateFull: (s) => { const p = parseKst(s); return `${p.y}년 ${p.m}월 ${p.d}일 (${WEEKDAYS[p.wd]})`; },
    time: (s) => { const p = parseKst(s); return `${pad(p.hh)}:${pad(p.mm)}`; },
    range: (start, end) => `${fmt.time(start)}~${fmt.time(end)}`,
    weekday: (s) => WEEKDAYS[parseKst(s).wd],
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // 학교 로고가 있으면 헤더에 표시
  function initHeaderLogo() {
    const slot = document.querySelector('[data-logo]');
    if (!slot) return;
    const img = new Image();
    img.alt = '';
    img.className = 'brand__logo';
    img.onload = () => slot.prepend(img);
    img.src = '/img/logo.png';
  }
  document.addEventListener('DOMContentLoaded', initHeaderLogo);

  // 페이지 간 임시 저장 (sessionStorage, 실패해도 동작)
  const store = {
    get(key) {
      try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch (_) { return null; }
    },
    set(key, value) {
      try { sessionStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* ignore */ }
    },
    remove(key) {
      try { sessionStorage.removeItem(key); } catch (_) { /* ignore */ }
    },
  };

  // 휴대폰 자동 하이픈: 01012345678 -> 010-1234-5678
  function formatPhone(v) {
    const d = String(v || '').replace(/\D/g, '').slice(0, 11);
    if (d.length < 4) return d;
    if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  }
  function bindPhoneInput(input) {
    input.addEventListener('input', () => {
      const atEnd = input.selectionStart === input.value.length;
      input.value = formatPhone(input.value);
      if (atEnd) input.setSelectionRange(input.value.length, input.value.length);
    });
  }
  const isValidPhone = (v) => /^01[016789]\d{7,8}$/.test(String(v || '').replace(/\D/g, ''));

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'hp';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  window.App = { api, toast, fmt, parseKst, pad, escapeHtml, WEEKDAYS, store, formatPhone, bindPhoneInput, isValidPhone, copyText };
})();
