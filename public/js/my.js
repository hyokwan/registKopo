/* 지원자: 내 예약 조회·취소 */
(function () {
  'use strict';
  const { api, fmt, toast, escapeHtml, store, bindPhoneInput, isValidPhone } = window.App;
  const $ = (id) => document.getElementById(id);

  const form = $('lookupForm');
  const result = $('result');
  const modal = $('cancelModal');
  let current = null; // { phone, code, data }

  bindPhoneInput($('phone'));
  $('code').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  });

  // 완료 화면에서 넘어오면 미리 채우기
  const done = store.get('cb.done');
  const qsCode = new URLSearchParams(location.search).get('code');
  if (qsCode) $('code').value = qsCode.toUpperCase().slice(0, 8);
  if (done && done.code && (!qsCode || qsCode.toUpperCase() === done.code)) {
    $('code').value = done.code;
    if (done.phone) $('phone').value = done.phone;
  }

  function setError(name, message) {
    const field = form.querySelector(`[data-field="${name}"]`);
    field.classList.toggle('is-invalid', !!message);
    $('err-' + name).textContent = message || '';
    $(name).setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  const STATUS = {
    BOOKED: ['badge--booked', '● 예약 확정'],
    DONE: ['badge--done', '✓ 상담 완료'],
    NO_SHOW: ['badge--noshow', '✕ 불참'],
    CANCELLED: ['badge--cancelled', '✕ 취소됨'],
  };

  const phoneLink = (d) => (d.departmentPhone
    ? ` ☎ <a href="tel:${escapeHtml(d.departmentPhone.replace(/[^0-9+]/g, ''))}">${escapeHtml(d.departmentPhone)}</a>`
    : '');

  function render(d) {
    const [cls, label] = STATUS[d.status] || STATUS.BOOKED;
    let footer = '';
    if (d.canCancel) {
      footer = `<button type="button" class="btn btn--block mt-20" id="cancelBtn">예약 취소</button>
        <p class="hint center">${escapeHtml(fmt.date(d.cancelDeadline))} ${escapeHtml(fmt.time(d.cancelDeadline))}까지 온라인으로 취소할 수 있어요.</p>`;
    } else if (d.status === 'BOOKED') {
      footer = '<p class="notice notice--warn">⚠️ 상담 시작이 얼마 남지 않아 온라인 취소가 어려워요. 일정 변경이나 취소는 <b>학과로 연락해 주세요.</b>' + phoneLink(d) + '</p>';
    } else if (d.status === 'CANCELLED') {
      footer = `<p class="notice">${d.cancelledBy === 'PROFESSOR' ? '학과 사정으로 취소된 예약이에요. 불편을 드려 죄송해요.' : '취소된 예약이에요.'}${d.cancelledBy === 'PROFESSOR' ? phoneLink(d) : ''} 다시 예약하려면 <a href="/book.html">시간 선택</a>으로 가 주세요.</p>`;
    }
    result.innerHTML = `
      <article class="card res-card" aria-labelledby="resTitle">
        <div class="res-card__head">
          <h2 class="h2" id="resTitle">${escapeHtml(d.applicantName)} 님의 예약</h2>
          <span class="badge ${cls}">${label}</span>
        </div>
        <dl class="info">
          <dt>예약번호</dt><dd>${escapeHtml(d.code)}</dd>
          <dt>일시</dt><dd>${escapeHtml(fmt.dateFull(d.startAt))}<br>${escapeHtml(fmt.range(d.startAt, d.endAt))}</dd>
          <dt>장소</dt><dd>${escapeHtml(d.location || '-')}</dd>
          <dt>학과</dt><dd>${escapeHtml(d.departmentName)}</dd>
          <dt>지원유형</dt><dd>${escapeHtml(d.applicantType)}</dd>
        </dl>
        ${footer}
      </article>`;
    const btn = $('cancelBtn');
    if (btn) btn.addEventListener('click', openCancel);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').hidden = true;
    const phone = $('phone').value.trim();
    const code = $('code').value.trim();
    setError('phone', !phone ? '휴대폰 번호를 입력해 주세요.' : !isValidPhone(phone) ? '휴대폰 번호를 다시 확인해 주세요.' : '');
    setError('code', code.length !== 8 ? '예약번호 8자리를 입력해 주세요.' : '');
    if (!isValidPhone(phone) || code.length !== 8) return;

    const btn = $('lookupBtn');
    btn.disabled = true;
    result.innerHTML = '<div class="skeleton res-card skeleton--card" aria-hidden="true"></div>';
    try {
      const data = await api.post('/api/reservations/lookup', { phone, code });
      current = { phone, code, data };
      render(data);
    } catch (err) {
      result.innerHTML = '';
      $('formError').textContent = err.message;
      $('formError').hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  function openCancel() {
    const d = current.data;
    $('cancelDesc').textContent = `${fmt.date(d.startAt)} ${fmt.range(d.startAt, d.endAt)} 상담 예약을 취소해요. 취소하면 되돌릴 수 없어요.`;
    $('cancelReason').value = '';
    modal.hidden = false;
    $('cancelReason').focus();
  }
  function closeCancel() {
    modal.hidden = true;
    const btn = $('cancelBtn');
    if (btn) btn.focus();
  }
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeCancel();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeCancel(); });

  modal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('cancelConfirm');
    btn.disabled = true;
    try {
      const data = await api.post('/api/reservations/cancel', { phone: current.phone, code: current.code, reason: $('cancelReason').value.trim() });
      current.data = data;
      modal.hidden = true;
      render(data);
      toast('예약을 취소했어요.', 'success');
    } catch (err) {
      toast(err.message, 'error');
      modal.hidden = true;
      // 마감 등으로 실패하면 최신 상태로 다시 표시
      try { current.data = await api.post('/api/reservations/lookup', { phone: current.phone, code: current.code }); render(current.data); } catch (_) { /* ignore */ }
    } finally {
      btn.disabled = false;
    }
  });
})();
