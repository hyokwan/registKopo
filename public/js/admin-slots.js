/* 교수 슬롯 관리: 주간 그리드(클릭·드래그), 모바일 리스트, 상세 패널, 일괄 열기, 장소 변경 */
(function () {
  'use strict';
  const { api, toast, fmt, pad, escapeHtml, WEEKDAYS } = window.App;
  const SAT_KEY = 'cb.slots.showSat';

  const board = document.getElementById('board');
  const summaryEl = document.getElementById('summary');
  const weekLabel = document.getElementById('weekLabel');
  const showSatEl = document.getElementById('showSat');
  const desktopMq = window.matchMedia('(min-width: 760px)');

  const state = {
    week: new URLSearchParams(location.search).get('week') || null,
    data: null,
    byStart: new Map(),
    loading: false,
    me: null,
  };

  try { showSatEl.checked = localStorage.getItem(SAT_KEY) === '1'; } catch (_) { /* ignore */ }

  // ── 데이터 ─────────────────────────────────────────────
  async function load(week) {
    state.loading = true;
    board.setAttribute('aria-busy', 'true');
    try {
      const data = await api.get('/api/admin/slots' + (week ? '?week=' + encodeURIComponent(week) : ''));
      state.data = data;
      state.week = data.weekStart;
      state.byStart = new Map(data.slots.map((s) => [s.startAt, s]));
      const url = new URL(location.href);
      url.searchParams.set('week', data.weekStart);
      history.replaceState(null, '', url);
      document.getElementById('monthLink').href = '/admin/month.html?month=' + data.weekStart.slice(0, 7);
      render();
    } catch (err) {
      board.innerHTML = '<div class="empty">' + escapeHtml(err.message) + '</div>';
    } finally {
      state.loading = false;
      board.setAttribute('aria-busy', 'false');
    }
  }

  function visibleDays() {
    const days = state.data.days;
    return showSatEl.checked ? days : days.slice(0, 5);
  }

  function hours() {
    const out = [];
    for (let h = state.data.dayStart; h < state.data.dayEnd; h++) out.push(h);
    return out;
  }

  const startOf = (day, h) => `${day} ${pad(h)}:00:00`;

  function cellInfo(start) {
    const slot = state.byStart.get(start) || null;
    const past = start <= state.data.now;
    const r = slot && slot.reservation;
    let kind = 'closed';
    if (r) kind = 'booked';
    else if (slot && slot.isOpen) kind = 'open';
    return { start, slot, past, kind, reservation: r };
  }

  // ── 렌더링 ─────────────────────────────────────────────
  function cellHtml(info, withTime) {
    const { start, past, kind, reservation: r } = info;
    const cls = ['cell'];
    let stateText = '';
    let label = `${fmt.date(start)} ${fmt.time(start)}`;
    if (kind === 'booked') {
      cls.push('is-booked');
      if (r.status === 'DONE') cls.push('is-done');
      if (r.status === 'NO_SHOW') cls.push('is-noshow');
      const st = r.status === 'DONE' ? '✓ 완료' : r.status === 'NO_SHOW' ? '✕ 노쇼' : '● 예약';
      stateText = `<span class="cell__state">${st}</span><span class="cell__name">${escapeHtml(r.applicantName)}</span>`;
      label += ` 예약됨, ${r.applicantName}. 누르면 상세를 볼 수 있어요`;
    } else if (kind === 'open') {
      cls.push('is-open');
      stateText = '<span class="cell__state">○ 열림</span>';
      label += past ? ' 열림(지난 시간)' : ' 열림. 누르면 닫혀요';
    } else {
      stateText = past ? '' : '<span class="cell__state">닫힘</span>';
      label += past ? ' 지난 시간' : ' 닫힘. 누르면 열려요';
    }
    if (past) cls.push('is-past');
    const disabled = past && kind !== 'booked';
    const title = info.slot && info.slot.effectiveLocation ? ` title="장소: ${escapeHtml(info.slot.effectiveLocation)}"` : '';
    const time = withTime ? `<span class="cell__time">${fmt.time(start)}</span>` : '';
    return `<button type="button" class="${cls.join(' ')}" data-start="${start}" aria-label="${escapeHtml(label)}"${title}${disabled ? ' disabled' : ''}>${time}${stateText}</button>`;
  }

  function render() {
    const d = state.data;
    const days = visibleDays();
    const last = days[days.length - 1];
    const short = (day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
    weekLabel.textContent = desktopMq.matches
      ? `${fmt.date(days[0] + ' 00:00:00')} ~ ${fmt.date(last + ' 00:00:00')}`
      : `${short(days[0])} ~ ${short(last)}`;
    const today = d.now.slice(0, 10);

    if (desktopMq.matches) {
      const grid = document.createElement('div');
      grid.className = 'slot-grid';
      grid.style.gridTemplateColumns = `56px repeat(${days.length}, minmax(0, 1fr))`;
      let html = '<div class="slot-grid__corner"></div>';
      for (const day of days) {
        html += `<div class="slot-grid__day${day === today ? ' is-today' : ''}">${fmt.weekday(day)}<small>${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}${day === today ? ' 오늘' : ''}</small></div>`;
      }
      for (const h of hours()) {
        html += `<div class="slot-grid__time">${pad(h)}:00</div>`;
        for (const day of days) html += cellHtml(cellInfo(startOf(day, h)), false);
      }
      grid.innerHTML = html;
      board.replaceChildren(grid);
    } else {
      let html = '<div class="slot-list">';
      for (const day of days) {
        html += `<section class="slot-list__day${day === today ? ' is-today' : ''}"><h3>${fmt.date(day + ' 00:00:00')}${day === today ? ' <small>오늘</small>' : ''}</h3><div class="slot-list__cells">`;
        for (const h of hours()) html += cellHtml(cellInfo(startOf(day, h)), true);
        html += '</div></section>';
      }
      html += '</div>';
      board.innerHTML = html;
    }

    // 요약
    let open = 0; let booked = 0;
    for (const s of d.slots) {
      if (!days.includes(s.startAt.slice(0, 10))) continue;
      if (s.reservation) booked++;
      else if (s.isOpen && s.startAt > d.now) open++;
    }
    summaryEl.innerHTML = `<span>예약 가능 <b>${open}</b>칸</span><span>예약 <b>${booked}</b>건</span><span>기본 장소 <b>${escapeHtml(d.defaultLocation || '-')}</b></span>`;
  }

  // ── 열기/닫기 반영 ─────────────────────────────────────
  async function commit(starts, open) {
    if (!starts.length) return;
    starts.forEach((s) => {
      const el = board.querySelector(`[data-start="${s}"]`);
      if (el) el.classList.add('is-saving');
    });
    try {
      const res = await api.post('/api/admin/slots/set', { starts, open });
      if (res.changed) toast(`${res.changed}칸을 ${open ? '열었어요' : '닫았어요'}.`, 'success');
      if (res.skipped && res.skipped.length) {
        toast(`${res.skipped.length}칸은 바꾸지 못했어요: ${res.skipped[0].reason}`, 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
    await load(state.week);
  }

  // ── 드래그(사각형 선택) ────────────────────────────────
  let drag = null;

  function cellPos(start) {
    const days = visibleDays();
    return { x: days.indexOf(start.slice(0, 10)), y: Number(start.slice(11, 13)) };
  }

  function updateDragPreview() {
    const days = visibleDays();
    const x1 = Math.min(drag.anchor.x, drag.cur.x); const x2 = Math.max(drag.anchor.x, drag.cur.x);
    const y1 = Math.min(drag.anchor.y, drag.cur.y); const y2 = Math.max(drag.anchor.y, drag.cur.y);
    const sel = new Set();
    for (let x = x1; x <= x2; x++) {
      for (let y = y1; y <= y2; y++) {
        const info = cellInfo(startOf(days[x], y));
        if (info.past || info.kind === 'booked') continue;
        if (drag.open ? info.kind === 'closed' : info.kind === 'open') sel.add(info.start);
      }
    }
    board.querySelectorAll('.is-pending-open, .is-pending-close').forEach((el) => {
      if (!sel.has(el.dataset.start)) el.classList.remove('is-pending-open', 'is-pending-close');
    });
    sel.forEach((s) => {
      const el = board.querySelector(`[data-start="${s}"]`);
      if (el) el.classList.add(drag.open ? 'is-pending-open' : 'is-pending-close');
    });
    drag.selected = sel;
  }

  board.addEventListener('pointerdown', (e) => {
    if (!desktopMq.matches || e.button !== 0 || state.loading) return;
    const el = e.target.closest('.cell[data-start]');
    if (!el || el.disabled) return;
    const info = cellInfo(el.dataset.start);
    if (info.kind === 'booked') return; // 클릭 이벤트에서 상세 패널을 연다
    e.preventDefault();
    drag = { open: info.kind !== 'open', anchor: cellPos(info.start), cur: cellPos(info.start), selected: new Set(), pointerId: e.pointerId };
    updateDragPreview();
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const el = target && target.closest('.slot-grid .cell[data-start]');
    if (!el) return;
    const pos = cellPos(el.dataset.start);
    if (pos.x === drag.cur.x && pos.y === drag.cur.y) return;
    drag.cur = pos;
    updateDragPreview();
  });

  function endDrag(e, cancel) {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    const { selected, open } = drag;
    drag = null;
    if (cancel) {
      board.querySelectorAll('.is-pending-open, .is-pending-close').forEach((el) => el.classList.remove('is-pending-open', 'is-pending-close'));
      return;
    }
    commit([...selected], open);
  }
  document.addEventListener('pointerup', (e) => endDrag(e, false));
  document.addEventListener('pointercancel', (e) => endDrag(e, true));

  // 클릭: 예약 칸 → 상세 / 키보드·모바일 → 한 칸 토글
  board.addEventListener('click', (e) => {
    const el = e.target.closest('.cell[data-start]');
    if (!el || el.disabled || state.loading) return;
    const info = cellInfo(el.dataset.start);
    if (info.kind === 'booked') return openDrawer(info);
    const isPointerOnDesktop = desktopMq.matches && e.detail > 0;
    if (isPointerOnDesktop) return; // 데스크톱 마우스 클릭은 pointer 로직이 처리
    commit([info.start], info.kind !== 'open');
  });

  // ── 상세 패널 ─────────────────────────────────────────
  const drawer = document.getElementById('drawer');
  let lastFocus = null;
  const STATUS = {
    BOOKED: ['badge--booked', '● 예약'],
    DONE: ['badge--done', '✓ 상담 완료'],
    NO_SHOW: ['badge--noshow', '✕ 노쇼'],
    CANCELLED: ['badge--cancelled', '취소'],
  };

  function openDrawer(info) {
    const r = info.reservation;
    const s = info.slot;
    const [badgeCls, badgeText] = STATUS[r.status] || STATUS.BOOKED;
    document.getElementById('drawerWhen').textContent = `${fmt.dateFull(s.startAt)} ${fmt.range(s.startAt, s.endAt)}`;
    document.getElementById('drawerTitle').textContent = r.applicantName + ' 님';
    document.getElementById('drawerBody').innerHTML = `
      <div class="drawer__section">
        <span class="badge ${badgeCls}">${badgeText}</span>
        <dl class="info mt-12">
          <dt>예약번호</dt><dd>${escapeHtml(r.code)}</dd>
          <dt>연락처</dt><dd><a href="tel:${escapeHtml(r.phone)}">${escapeHtml(r.phone)}</a></dd>
          <dt>이메일</dt><dd>${r.email ? `<a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : '-'}</dd>
          <dt>지원유형</dt><dd>${escapeHtml(r.applicantType)}</dd>
          <dt>관심분야</dt><dd>${escapeHtml(r.interest || '-')}</dd>
          <dt>신청일</dt><dd>${escapeHtml(r.createdAt.slice(0, 16))}</dd>
        </dl>
        ${r.message ? `<p class="label mt-20">문의 내용</p><p class="msg-box">${escapeHtml(r.message)}</p>` : ''}
      </div>
      <form class="drawer__section" id="slotLocForm">
        <div class="field">
          <label for="slotLoc">이 시간의 장소</label>
          <input type="text" id="slotLoc" maxlength="200" value="${escapeHtml(s.location || '')}" placeholder="${escapeHtml(s.effectiveLocation || '')}">
          <p class="hint mt-6">비우면 기본 장소(${escapeHtml(state.data.defaultLocation || '-')})를 써요.</p>
        </div>
        <button type="submit" class="btn btn--md btn--block mt-12">장소 저장</button>
      </form>
      <div class="drawer__section">
        <a class="btn btn--md btn--block" href="/admin/reservations.html?code=${encodeURIComponent(r.code)}">예약 목록에서 관리 (완료·노쇼·취소)</a>
        <p class="hint">예약이 있는 시간은 닫을 수 없어요. 먼저 예약을 취소해 주세요.</p>
      </div>`;
    document.getElementById('slotLocForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api.post('/api/admin/slots/location', { ids: [s.id], location: document.getElementById('slotLoc').value });
        toast('장소를 저장했어요.', 'success');
        closeLayer(drawer);
        load(state.week);
      } catch (err) { toast(err.message, 'error'); }
    });
    openLayer(drawer);
  }

  // ── 레이어 공통(모달·패널) ────────────────────────────
  function openLayer(layer) {
    lastFocus = document.activeElement;
    layer.hidden = false;
    const first = layer.querySelector('input, button:not([data-close]), [href]') || layer.querySelector('button');
    if (first) first.focus();
  }
  function closeLayer(layer) {
    layer.hidden = true;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  document.querySelectorAll('.drawer, .modal').forEach((layer) => {
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-close]')) closeLayer(layer);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (drag) return endDrag(null, true);
    document.querySelectorAll('.drawer:not([hidden]), .modal:not([hidden])').forEach(closeLayer);
  });

  // ── 일괄 열기 ─────────────────────────────────────────
  const bulkModal = document.getElementById('bulkModal');
  const bulkForm = bulkModal.querySelector('form');
  const bulkWeekdays = document.getElementById('bulkWeekdays');
  const bulkHours = document.getElementById('bulkHours');
  const bulkPreview = document.getElementById('bulkPreview');
  const bulkError = document.getElementById('bulkError');

  function buildBulkForm() {
    bulkWeekdays.innerHTML = [1, 2, 3, 4, 5, 6].map((wd) =>
      `<label class="chip"><input type="checkbox" name="wd" value="${wd}"${wd <= 5 || showSatEl.checked ? ' checked' : ''}><span>${WEEKDAYS[wd]}</span></label>`
    ).join('');
    bulkHours.innerHTML = hours().map((h) =>
      `<label class="chip"><input type="checkbox" name="hr" value="${h}"${h !== 12 ? ' checked' : ''}><span>${pad(h)}:00</span></label>`
    ).join('');
    const today = state.data.now.slice(0, 10);
    const from = state.data.weekStart > today ? state.data.weekStart : today;
    document.getElementById('bulkFrom').value = from;
    document.getElementById('bulkFrom').min = today;
    document.getElementById('bulkTo').value = addDaysStr(from, 27);
    document.getElementById('bulkTo').min = today;
    document.getElementById('bulkLocation').value = '';
    document.getElementById('bulkLocation').placeholder = state.data.defaultLocation || '';
    bulkError.hidden = true;
    updateBulkPreview();
  }

  function addDaysStr(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }

  function bulkValues() {
    return {
      from: document.getElementById('bulkFrom').value,
      to: document.getElementById('bulkTo').value,
      weekdays: [...bulkWeekdays.querySelectorAll('input:checked')].map((i) => Number(i.value)),
      hours: [...bulkHours.querySelectorAll('input:checked')].map((i) => Number(i.value)),
      location: document.getElementById('bulkLocation').value.trim(),
    };
  }

  function updateBulkPreview() {
    const v = bulkValues();
    if (!v.from || !v.to || v.from > v.to) { bulkPreview.textContent = '기간을 선택해 주세요.'; return; }
    const now = state.data.now;
    let count = 0; let days = 0;
    for (let d = v.from; d <= v.to; d = addDaysStr(d, 1)) {
      const [y, m, dd] = d.split('-').map(Number);
      const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
      if (!v.weekdays.includes(wd)) continue;
      days++;
      for (const h of v.hours) if (`${d} ${pad(h)}:00:00` > now) count++;
      if (days > 400) break;
    }
    bulkPreview.textContent = count ? `${days}일 × ${v.hours.length}개 시간대 → 최대 ${count}칸을 열어요.` : '조건에 맞는 시간이 없어요.';
  }

  bulkModal.addEventListener('change', updateBulkPreview);
  bulkModal.addEventListener('input', updateBulkPreview);
  bulkModal.querySelectorAll('[data-hours]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const mode = btn.dataset.hours;
      bulkHours.querySelectorAll('input').forEach((i) => {
        const h = Number(i.value);
        i.checked = mode === 'all' ? h !== 12 : mode === 'am' ? h < 12 : mode === 'pm' ? h >= 13 : false;
      });
      updateBulkPreview();
    });
  });

  document.getElementById('bulkBtn').addEventListener('click', () => {
    if (!state.data) return;
    buildBulkForm();
    openLayer(bulkModal);
  });

  bulkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    bulkError.hidden = true;
    const v = bulkValues();
    const msg = !v.from || !v.to ? '시작일과 종료일을 선택해 주세요.'
      : v.from > v.to ? '종료일이 시작일보다 빠를 수 없어요.'
      : !v.weekdays.length ? '요일을 하나 이상 선택해 주세요.'
      : !v.hours.length ? '시간대를 하나 이상 선택해 주세요.' : '';
    if (msg) { bulkError.textContent = msg; bulkError.hidden = false; return; }
    const btn = document.getElementById('bulkSubmit');
    btn.disabled = true;
    try {
      const res = await api.post('/api/admin/slots/bulk', v);
      toast(res.changed ? `${res.changed}칸을 열었어요.` : '새로 열 칸이 없었어요.', 'success');
      closeLayer(bulkModal);
      await load(v.from <= state.week ? state.week : v.from);
    } catch (err) {
      bulkError.textContent = err.message;
      bulkError.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  // ── 장소 변경 ─────────────────────────────────────────
  const locModal = document.getElementById('locModal');
  const locForm = locModal.querySelector('form');
  const locError = document.getElementById('locError');

  document.getElementById('locationBtn').addEventListener('click', async () => {
    const me = await window.Admin.ready;
    state.me = me;
    document.getElementById('office').value = me.office || '';
    document.getElementById('office').placeholder = me.department.defaultLocation || '';
    document.getElementById('locFrom').value = '';
    document.getElementById('locTo').value = '';
    document.getElementById('locValue').value = '';
    locError.hidden = true;
    openLayer(locModal);
  });

  locForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    locError.hidden = true;
    const office = document.getElementById('office').value.trim();
    const from = document.getElementById('locFrom').value;
    const to = document.getElementById('locTo').value;
    const value = document.getElementById('locValue').value.trim();
    if ((from && !to) || (!from && to)) { locError.textContent = '기간의 시작일과 종료일을 모두 선택해 주세요.'; locError.hidden = false; return; }
    if (from && to && from > to) { locError.textContent = '종료일이 시작일보다 빠를 수 없어요.'; locError.hidden = false; return; }
    try {
      const messages = [];
      if (office !== (state.me.office || '')) {
        state.me = await api.patch('/api/admin/me', { office });
        messages.push('기본 장소를 저장했어요.');
      }
      if (from && to) {
        const r = await api.post('/api/admin/slots/location', { from, to, location: value });
        messages.push(`${r.changed}칸의 장소를 바꿨어요.`);
      }
      toast(messages.join(' ') || '바뀐 내용이 없어요.', messages.length ? 'success' : undefined);
      closeLayer(locModal);
      load(state.week);
    } catch (err) {
      locError.textContent = err.message;
      locError.hidden = false;
    }
  });

  // ── 주 이동 / 토요일 / 반응형 ─────────────────────────
  document.getElementById('prevWeek').addEventListener('click', () => state.data && load(state.data.prevWeek));
  document.getElementById('nextWeek').addEventListener('click', () => state.data && load(state.data.nextWeek));
  document.getElementById('thisWeek').addEventListener('click', () => load(null));
  showSatEl.addEventListener('change', () => {
    try { localStorage.setItem(SAT_KEY, showSatEl.checked ? '1' : '0'); } catch (_) { /* ignore */ }
    if (state.data) render();
  });
  desktopMq.addEventListener('change', () => state.data && render());

  load(state.week);
})();
