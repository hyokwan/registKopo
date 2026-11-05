/* 교수: 예약 목록 — 예정/지난/취소 탭, 완료·불참 표시, 교수 취소, CSV(관리자) */
(function () {
  'use strict';
  const { api, fmt, toast, escapeHtml, store } = window.App;
  const $ = (id) => document.getElementById(id);

  const STATUS = {
    BOOKED: ['badge--booked', '● 예약 확정'],
    DONE: ['badge--done', '✓ 상담 완료'],
    NO_SHOW: ['badge--noshow', '✕ 불참'],
    CANCELLED: ['badge--cancelled', '✕ 취소'],
  };
  const TAB_EMPTY = {
    upcoming: '예정된 상담이 없어요. 슬롯 관리에서 상담 시간을 열어 두면 지원자가 예약할 수 있어요.',
    past: '지난 상담이 없어요.',
    cancelled: '취소된 예약이 없어요.',
  };

  const params = new URLSearchParams(location.search);
  const state = {
    me: null,
    tab: ['upcoming', 'past', 'cancelled'].includes(params.get('tab')) ? params.get('tab') : 'upcoming',
    q: params.get('code') || params.get('q') || '',
    page: 1,
    items: [],
    hasMore: false,
    mineOnly: store.get('cb.res.mineOnly') === true,
    openCode: params.get('code') || null,
    current: null,
  };
  let seq = 0;

  // ── 레이어(패널·모달) 열고 닫기: 겹쳐 열릴 수 있어 포커스를 스택으로 관리 ──
  const focusStack = [];
  function openLayer(layer, focusEl) {
    focusStack.push(document.activeElement);
    layer.hidden = false;
    const first = focusEl || layer.querySelector('input, button:not([data-close]), [href]') || layer.querySelector('button');
    if (first) first.focus();
  }
  function closeLayer(layer) {
    if (layer.hidden) return;
    layer.hidden = true;
    const prev = focusStack.pop();
    if (prev && prev.isConnected) prev.focus();
  }
  document.querySelectorAll('.drawer, .modal').forEach((layer) => {
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-close]')) closeLayer(layer);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 가장 위에 있는 레이어부터 닫는다
    const open = [...document.querySelectorAll('.modal:not([hidden])'), ...document.querySelectorAll('.drawer:not([hidden])')];
    if (open[0]) closeLayer(open[0]);
  });

  // ── 목록 ──
  function syncUrl() {
    const u = new URLSearchParams();
    if (state.tab !== 'upcoming') u.set('tab', state.tab);
    if (state.q) u.set('q', state.q);
    history.replaceState(null, '', location.pathname + (u.toString() ? '?' + u : ''));
  }

  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    load(1);
  }

  async function load(page) {
    const my = ++seq;
    state.page = page;
    const list = $('list');
    if (page === 1) {
      list.setAttribute('aria-busy', 'true');
      list.innerHTML = '<div class="skeleton skeleton--card"></div>';
    }
    syncUrl();
    try {
      const u = new URLSearchParams({ tab: state.tab, page: String(page), scope: state.mineOnly ? 'mine' : 'all' });
      if (state.q) u.set('q', state.q);
      const data = await api.get('/api/admin/reservations?' + u);
      if (my !== seq) return;
      state.items = page === 1 ? data.items : state.items.concat(data.items);
      state.hasMore = data.hasMore;
      state.scope = data.scope;
      $('cnt-upcoming').textContent = data.counts.upcoming ? String(data.counts.upcoming) : '';
      $('cnt-past').textContent = data.counts.pastPending ? `처리 필요 ${data.counts.pastPending}` : '';
      render();
      if (state.openCode) {
        const hit = state.items.find((x) => x.code === state.openCode);
        state.openCode = null;
        if (hit) openDrawer(hit);
      }
    } catch (err) {
      if (my !== seq) return;
      list.innerHTML = `<div class="empty"><p>${escapeHtml(err.message)}</p><button type="button" class="btn btn--md mt-12" id="retryBtn">다시 시도</button></div>`;
      $('retryBtn').addEventListener('click', () => load(1));
    } finally {
      if (my === seq) list.setAttribute('aria-busy', 'false');
    }
  }

  const showProfessor = () => state.scope === 'all' && new Set(state.items.map((x) => x.professorId)).size > 1;

  function needsAction(r) {
    return state.tab === 'past' && r.status === 'BOOKED';
  }

  function rowHtml(r) {
    const [cls, label] = STATUS[r.status] || STATUS.BOOKED;
    const pending = needsAction(r);
    return `
      <li class="res-row${pending ? ' is-pending' : ''}">
        <button type="button" class="res-row__main" data-open="${r.id}" aria-label="${escapeHtml(r.applicantName)} 님 예약 상세 보기">
          <span class="res-row__when">
            <b>${escapeHtml(fmt.date(r.startAt))}</b>
            <span>${escapeHtml(fmt.range(r.startAt, r.endAt))}</span>
          </span>
          <span class="res-row__who">
            <b>${escapeHtml(r.applicantName)}</b>
            <span class="muted">${escapeHtml(r.applicantType)}${showProfessor() ? ' · 담당 ' + escapeHtml(r.professorName) : ''}</span>
          </span>
          <span class="res-row__phone">${escapeHtml(r.phone || '-')}</span>
          <span class="res-row__status">${pending ? '<span class="badge badge--noshow">⏳ 처리 필요</span>' : `<span class="badge ${cls}">${label}</span>`}</span>
        </button>
        ${pending ? `
        <div class="res-row__actions">
          <button type="button" class="btn btn--sm" data-status="DONE" data-id="${r.id}">✓ 완료</button>
          <button type="button" class="btn btn--sm" data-status="NO_SHOW" data-id="${r.id}">✕ 불참</button>
        </div>` : (state.tab === 'past' ? '<div class="res-row__actions" aria-hidden="true"></div>' : '')}
      </li>`;
  }

  function render() {
    const list = $('list');
    if (!state.items.length) {
      list.innerHTML = `<div class="empty"><p>${escapeHtml(state.q ? `'${state.q}' 검색 결과가 없어요.` : TAB_EMPTY[state.tab])}</p></div>`;
    } else {
      list.innerHTML = `<ul class="res-list">${state.items.map(rowHtml).join('')}</ul>`;
    }
    $('moreBtn').hidden = !state.hasMore;
  }

  $('list').addEventListener('click', (e) => {
    const st = e.target.closest('[data-status]');
    if (st) return changeStatus(Number(st.dataset.id), st.dataset.status, st);
    const open = e.target.closest('[data-open]');
    if (open) {
      const r = state.items.find((x) => x.id === Number(open.dataset.open));
      if (r) openDrawer(r);
    }
  });

  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  // 탭 키보드 이동 (←/→)
  document.querySelector('.tabs').addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const tabs = [...document.querySelectorAll('.tab')];
    const i = tabs.findIndex((b) => b.dataset.tab === state.tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    setTab(next.dataset.tab);
  });

  let qTimer = null;
  $('q').value = state.q;
  $('q').addEventListener('input', () => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.q = $('q').value.trim(); load(1); }, 300);
  });
  $('moreBtn').addEventListener('click', () => load(state.page + 1));
  $('mineOnly').checked = state.mineOnly;
  $('mineOnly').addEventListener('change', () => {
    state.mineOnly = $('mineOnly').checked;
    store.set('cb.res.mineOnly', state.mineOnly);
    load(1);
  });

  // ── 상태 변경 ──
  function replaceItem(updated) {
    const i = state.items.findIndex((x) => x.id === updated.id);
    if (i >= 0) state.items[i] = updated;
    if (state.current && state.current.id === updated.id) state.current = updated;
  }

  async function changeStatus(id, status, btn) {
    if (btn) btn.disabled = true;
    try {
      const updated = await api.patch(`/api/admin/reservations/${id}/status`, { status });
      replaceItem(updated);
      const msg = { DONE: '상담 완료로 표시했어요.', NO_SHOW: '불참으로 표시했어요.', BOOKED: '예약 확정으로 되돌렸어요.' }[status];
      toast(msg, 'success');
      render();
      if (!$('drawer').hidden && state.current && state.current.id === id) renderDrawer(updated);
      refreshCounts();
    } catch (err) {
      toast(err.message, 'error');
      if (btn && btn.isConnected) btn.disabled = false;
    }
  }

  // 탭 배지 숫자만 갱신 (목록은 그대로 두어 방금 처리한 행이 사라지지 않게)
  async function refreshCounts() {
    try {
      const u = new URLSearchParams({ tab: state.tab, scope: state.mineOnly ? 'mine' : 'all', countsOnly: '1' });
      const data = await api.get('/api/admin/reservations?' + u);
      $('cnt-upcoming').textContent = data.counts.upcoming ? String(data.counts.upcoming) : '';
      $('cnt-past').textContent = data.counts.pastPending ? `처리 필요 ${data.counts.pastPending}` : '';
    } catch (_) { /* 배지는 다음 새로고침 때 갱신 */ }
  }

  // ── 상세 패널 ──
  const isPast = (r) => r.startAt <= nowKst();
  function nowKst() {
    const d = new Date(Date.now() + 9 * 3600e3);
    return d.toISOString().replace('T', ' ').slice(0, 19);
  }

  function renderDrawer(r) {
    const [cls, label] = STATUS[r.status] || STATUS.BOOKED;
    $('drawerWhen').textContent = `${fmt.dateFull(r.startAt)} ${fmt.range(r.startAt, r.endAt)}`;
    $('drawerTitle').textContent = r.anonymized ? '(익명 처리된 예약)' : `${r.applicantName} 님`;

    let actions = '';
    if (r.status === 'CANCELLED') {
      actions = `<p class="notice">${r.cancelledBy === 'PROFESSOR' ? '교수가' : '지원자가'} ${escapeHtml(r.cancelledAt ? r.cancelledAt.slice(0, 16) : '')}에 취소했어요.${r.cancelReason ? `<br>사유: ${escapeHtml(r.cancelReason)}` : ''}</p>`;
    } else if (!isPast(r)) {
      actions = `
        <button type="button" class="btn btn--md btn--block btn--danger-outline" id="profCancelBtn">예약 취소</button>
        <p class="hint">완료·불참은 상담 시작 시간이 지나면 표시할 수 있어요.</p>`;
    } else {
      const seg = (status, text) => `<button type="button" class="seg__btn" data-set="${status}" aria-pressed="${r.status === status}">${text}</button>`;
      actions = `
        <p class="label">상담 결과</p>
        <div class="seg" role="group" aria-label="상담 결과">
          ${seg('DONE', '✓ 상담 완료')}${seg('NO_SHOW', '✕ 불참')}${seg('BOOKED', '미처리')}
        </div>`;
    }

    $('drawerBody').innerHTML = `
      <div class="drawer__section">
        <span class="badge ${cls}">${label}</span>
        <dl class="info mt-12">
          <dt>예약번호</dt><dd>${escapeHtml(r.code)}</dd>
          <dt>연락처</dt><dd>${r.phone ? `<a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a>` : '-'}</dd>
          <dt>이메일</dt><dd>${r.email ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : '-'}</dd>
          <dt>지원유형</dt><dd>${escapeHtml(r.applicantType)}</dd>
          <dt>관심분야</dt><dd>${escapeHtml(r.interest || '-')}</dd>
          <dt>장소</dt><dd>${escapeHtml(r.location || '-')}</dd>
          <dt>담당</dt><dd>${escapeHtml(r.professorName)}</dd>
          <dt>신청일</dt><dd>${escapeHtml(r.createdAt.slice(0, 16))}</dd>
        </dl>
        ${r.message ? `<p class="label mt-20">문의 내용</p><p class="msg-box">${escapeHtml(r.message)}</p>` : ''}
      </div>
      <div class="drawer__section">${actions}</div>`;

    const cancelBtn = $('profCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => openCancel(r));
    $('drawerBody').querySelectorAll('[data-set]').forEach((b) => {
      b.addEventListener('click', () => { if (b.getAttribute('aria-pressed') !== 'true') changeStatus(r.id, b.dataset.set, b); });
    });
  }

  function openDrawer(r) {
    state.current = r;
    renderDrawer(r);
    if ($('drawer').hidden) openLayer($('drawer'), $('drawer').querySelector('[data-close]'));
  }

  // ── 교수 취소 ──
  const cancelModal = $('cancelModal');
  function setReasonError(msg) {
    cancelModal.querySelector('[data-field="reason"]').classList.toggle('is-invalid', !!msg);
    $('err-reason').textContent = msg || '';
    $('cancelReason').setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function openCancel(r) {
    $('cancelDesc').textContent = `${fmt.date(r.startAt)} ${fmt.range(r.startAt, r.endAt)} · ${r.applicantName} 님 (${r.phone})`;
    $('cancelReason').value = '';
    $('closeSlot').checked = true;
    setReasonError('');
    openLayer(cancelModal, $('cancelReason'));
  }
  $('cancelReason').addEventListener('input', () => { if ($('cancelReason').value.trim()) setReasonError(''); });
  cancelModal.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = $('cancelReason').value.trim();
    if (!reason) { setReasonError('취소 사유를 입력해 주세요.'); $('cancelReason').focus(); return; }
    const btn = $('cancelConfirm');
    btn.disabled = true;
    try {
      const updated = await api.post(`/api/admin/reservations/${state.current.id}/cancel`, { reason, closeSlot: $('closeSlot').checked });
      closeLayer(cancelModal);
      closeLayer($('drawer'));
      toast('예약을 취소했어요. 지원자에게 전화로 알려 주세요.', 'success');
      state.items = state.items.filter((x) => x.id !== updated.id);
      render();
      refreshCounts();
    } catch (err) {
      if (err.body && err.body.errors && err.body.errors.reason) setReasonError(err.body.errors.reason);
      else toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });

  // ── CSV (관리자) ──
  const csvModal = $('csvModal');
  $('csvBtn').addEventListener('click', () => openLayer(csvModal));
  csvModal.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = $('csvFrom').value;
    const to = $('csvTo').value;
    if (from && to && from > to) { toast('시작일이 종료일보다 늦어요. 기간을 다시 확인해 주세요.', 'error'); return; }
    const u = new URLSearchParams();
    if (from) u.set('from', from);
    if (to) u.set('to', to);
    // 세션 쿠키로 인증되는 GET이라 링크 이동으로 내려받는다
    const a = document.createElement('a');
    a.href = '/api/admin/reservations.csv' + (u.toString() ? '?' + u : '');
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
    closeLayer(csvModal);
  });

  window.Admin.ready.then((me) => {
    state.me = me;
    $('scopeWrap').hidden = !me.isAdmin;
    if (!me.isAdmin) state.mineOnly = false;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    load(1);
  });
})();
