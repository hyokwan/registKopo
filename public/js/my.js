/* 지원자: 내 예약 조회·취소 (예약번호로 찾기 / 이름으로 찾기) */
(function () {
  'use strict';
  const { api, fmt, toast, escapeHtml, store, bindPhoneInput, isValidPhone, copyText } = window.App;
  const $ = (id) => document.getElementById(id);

  const form = $('lookupForm');
  const result = $('result');
  const modal = $('cancelModal');
  let mode = 'code';
  let deptPhone = null;
  // 화면에 보이는 예약들: code → { phone, data }
  let shown = new Map();
  let cancelTarget = null;

  bindPhoneInput($('phone'));
  $('code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  });

  // 완료 화면에서 넘어오면 미리 채우기
  const done = store.get('cb.done');
  const params = new URLSearchParams(location.search);
  const qsCode = params.get('code');
  if (qsCode) $('code').value = qsCode.toUpperCase().slice(0, 8);
  if (done && done.code && (!qsCode || qsCode.toUpperCase() === done.code)) {
    $('code').value = done.code;
    if (done.phone) $('phone').value = done.phone;
  }

  // 학과 전화번호: 하단 안내 + 실패·취소 안내에 사용
  const telLink = (phone) => `<a href="tel:${escapeHtml(phone.replace(/[^0-9+]/g, ''))}">${escapeHtml(phone)}</a>`;
  const phoneLink = (d) => {
    const p = (d && d.departmentPhone) || deptPhone;
    return p ? ` ☎ ${telLink(p)}` : '';
  };
  api.get('/api/departments').then((list) => {
    deptPhone = list[0] && list[0].contactPhone;
    if (!deptPhone) return;
    $('contactBox').innerHTML = `📞 조회가 어렵거나 일정을 바꾸고 싶으면 <b>학과로 전화해 주세요.</b> ${telLink(deptPhone)}`;
    $('contactBox').hidden = false;
  }).catch(() => { /* 안내만 생략 */ });

  // ── 조회 방법 전환 ──
  const DESC = {
    code: '신청할 때 입력한 휴대폰 번호와 예약번호를 입력해 주세요.',
    name: '신청할 때 입력한 이름과 휴대폰 번호로 예정된 예약을 찾아요.',
  };
  function setError(name, message) {
    const field = form.querySelector(`[data-field="${name}"]`);
    field.classList.toggle('is-invalid', !!message);
    $('err-' + name).textContent = message || '';
    $(name).setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function setMode(next, focus) {
    mode = next;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    form.querySelector('[data-field="name"]').hidden = mode !== 'name';
    form.querySelector('[data-field="code"]').hidden = mode !== 'code';
    $('modeDesc').textContent = DESC[mode];
    $('lookupBtn').textContent = mode === 'name' ? '예약 찾기' : '예약 조회';
    $('formError').hidden = true;
    ['name', 'code', 'phone'].forEach((k) => setError(k, ''));
    if (focus) (mode === 'name' ? $('name') : $('code')).focus();
  }
  document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode, true)));
  $('forgotLink').addEventListener('click', () => setMode('name', true));
  if (params.get('mode') === 'name') setMode('name');

  const STATUS = {
    BOOKED: ['badge--booked', '● 예약 확정'],
    DONE: ['badge--done', '✓ 상담 완료'],
    NO_SHOW: ['badge--noshow', '✕ 불참'],
    CANCELLED: ['badge--cancelled', '✕ 취소됨'],
  };

  function cardHtml(d, highlightCode) {
    const [cls, label] = STATUS[d.status] || STATUS.BOOKED;
    let footer = '';
    if (d.canCancel) {
      footer = `<button type="button" class="btn btn--block mt-20" data-cancel="${escapeHtml(d.code)}">예약 취소</button>
        <p class="hint center">${escapeHtml(fmt.date(d.cancelDeadline))} ${escapeHtml(fmt.time(d.cancelDeadline))}까지 온라인으로 취소할 수 있어요.</p>`;
    } else if (d.status === 'BOOKED') {
      footer = `<p class="notice notice--warn">⚠️ 상담 시작이 얼마 남지 않아 온라인 취소가 어려워요. 일정 변경이나 취소는 <b>학과로 전화해 주세요.</b>${phoneLink(d)}</p>`;
    } else if (d.status === 'CANCELLED') {
      footer = `<p class="notice">${d.cancelledBy === 'PROFESSOR' ? '학과 사정으로 취소된 예약이에요. 불편을 드려 죄송해요.' : '취소된 예약이에요.'}${d.cancelledBy === 'PROFESSOR' ? phoneLink(d) : ''} 다시 예약하려면 <a href="/book.html">시간 선택</a>으로 가 주세요.</p>`;
    }
    const codeDd = highlightCode
      ? `<dd><span class="code-strong">${escapeHtml(d.code)}</span> <button type="button" class="btn btn--sm" data-copy="${escapeHtml(d.code)}">복사</button></dd>`
      : `<dd>${escapeHtml(d.code)}</dd>`;
    return `
      <article class="card res-card" aria-label="${escapeHtml(fmt.date(d.startAt))} 예약">
        <div class="res-card__head">
          <h2 class="h2">${escapeHtml(d.applicantName)} 님의 예약</h2>
          <span class="badge ${cls}">${label}</span>
        </div>
        <dl class="info">
          <dt>예약번호</dt>${codeDd}
          <dt>일시</dt><dd>${escapeHtml(fmt.dateFull(d.startAt))}<br>${escapeHtml(fmt.range(d.startAt, d.endAt))}</dd>
          <dt>장소</dt><dd>${escapeHtml(d.location || '-')}</dd>
          <dt>학과</dt><dd>${escapeHtml(d.departmentName)}</dd>
          <dt>지원유형</dt><dd>${escapeHtml(d.applicantType)}</dd>
        </dl>
        ${footer}
      </article>`;
  }

  function render(items, phone, found) {
    shown = new Map(items.map((d) => [d.code, { phone, data: d }]));
    const head = found
      ? `<p class="found-head">예정된 예약 <b>${items.length}건</b>을 찾았어요. 예약번호를 캡처하거나 복사해 두세요.</p>`
      : '';
    result.innerHTML = head + items.map((d) => cardHtml(d, found)).join('');
  }
  const rerender = (found) => {
    const entries = [...shown.values()];
    render(entries.map((x) => x.data), entries[0] ? entries[0].phone : '', found);
  };

  result.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-cancel]');
    if (c) return openCancel(c.dataset.cancel, c);
    const cp = e.target.closest('[data-copy]');
    if (cp) {
      const copied = await copyText(cp.dataset.copy);
      toast(copied ? '예약번호를 복사했어요.' : '복사하지 못했어요. 길게 눌러 직접 복사해 주세요.', copied ? 'success' : 'error');
    }
  });

  function showFail(message) {
    result.innerHTML = '';
    $('formError').innerHTML = `${escapeHtml(message)}${deptPhone ? `<br>찾기 어려우면 학과로 전화해 주세요. ${telLink(deptPhone)}` : ''}`;
    $('formError').hidden = false;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').hidden = true;
    const phone = $('phone').value.trim();
    const phoneErr = !phone ? '휴대폰 번호를 입력해 주세요.' : !isValidPhone(phone) ? '휴대폰 번호를 다시 확인해 주세요.' : '';
    setError('phone', phoneErr);
    let other = '';
    if (mode === 'code') {
      other = $('code').value.trim().length !== 8 ? '예약번호 8자리를 입력해 주세요.' : '';
      setError('code', other);
    } else {
      other = !$('name').value.trim() ? '이름을 입력해 주세요.' : '';
      setError('name', other);
    }
    if (phoneErr || other) return;

    const btn = $('lookupBtn');
    btn.disabled = true;
    result.innerHTML = '<div class="skeleton res-card skeleton--card" aria-hidden="true"></div>';
    try {
      if (mode === 'code') {
        render([await api.post('/api/reservations/lookup', { phone, code: $('code').value.trim() })], phone, false);
      } else {
        render(await api.post('/api/reservations/find', { name: $('name').value.trim(), phone }), phone, true);
      }
    } catch (err) {
      showFail(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  // ── 취소 ──
  let lastFocus = null;
  function openCancel(code, from) {
    const entry = shown.get(code);
    if (!entry) return;
    cancelTarget = entry;
    lastFocus = from;
    const d = entry.data;
    $('cancelDesc').textContent = `${fmt.date(d.startAt)} ${fmt.range(d.startAt, d.endAt)} 상담 예약을 취소해요. 취소하면 되돌릴 수 없어요.`;
    $('cancelReason').value = '';
    modal.hidden = false;
    $('cancelReason').focus();
  }
  function closeCancel() {
    modal.hidden = true;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeCancel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeCancel(); });

  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('cancelConfirm');
    const { phone, data } = cancelTarget;
    btn.disabled = true;
    try {
      cancelTarget.data = await api.post('/api/reservations/cancel', { phone, code: data.code, reason: $('cancelReason').value.trim() });
      modal.hidden = true;
      rerender(mode === 'name');
      toast('예약을 취소했어요.', 'success');
    } catch (err) {
      toast(err.message, 'error');
      modal.hidden = true;
      // 마감 등으로 실패하면 최신 상태로 다시 표시
      try { cancelTarget.data = await api.post('/api/reservations/lookup', { phone, code: data.code }); rerender(mode === 'name'); } catch (_) { /* ignore */ }
    } finally {
      btn.disabled = false;
    }
  });
})();
