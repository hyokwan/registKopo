/* 교수: 월간 상담 시간 — 날짜 여러 개 선택 → 시간 골라 한 번에 열기/닫기 */
(function () {
  'use strict';
  const { api, toast, escapeHtml, pad, WEEKDAYS } = window.App;
  const $ = (id) => document.getElementById(id);
  const SAT_KEY = 'cb.slots.showSat';
  const HOURS_KEY = 'cb.month.hours';

  const state = {
    month: new URLSearchParams(location.search).get('month') || '',
    data: null,
    selected: new Set(), // 'YYYY-MM-DD'
    hours: null, // Set<number>
  };

  try { $('showSat').checked = localStorage.getItem(SAT_KEY) === '1'; } catch (_) { /* ignore */ }
  const weekdays = () => ($('showSat').checked ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5]);

  // ── 날짜 계산 (UTC 기준으로 요일만 계산, 시간대 영향 없음) ──
  const toDate = (s) => new Date(`${s}T00:00:00Z`);
  const fmtDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const addDays = (s, n) => { const d = toDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); };
  const wdOf = (s) => toDate(s).getUTCDay();
  const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

  function monthDates() {
    const out = [];
    for (let d = `${state.month}-01`; d.slice(0, 7) === state.month; d = addDays(d, 1)) out.push(d);
    return out;
  }

  // 열 수 있는 날: 오늘 이후(오늘 포함, 지난 시간은 서버가 건너뜀) ~ 최대 날짜, 월~토
  const editable = (date) => state.data && date >= state.data.today && date <= state.data.maxDate && wdOf(date) !== 0;

  async function load(month) {
    $('calendar').setAttribute('aria-busy', 'true');
    try {
      const data = await api.get('/api/admin/slots/month' + (month ? '?month=' + encodeURIComponent(month) : ''));
      state.data = data;
      state.month = data.month;
      state.byDate = new Map(data.days.map((d) => [d.date, d]));
      if (!state.hours) initHours();
      const url = new URL(location.href);
      url.searchParams.set('month', data.month);
      history.replaceState(null, '', url);
      $('weekLink').href = '/admin/slots.html?week=' + (data.month === data.today.slice(0, 7) ? data.today : data.month + '-01');
      $('monthLabel').textContent = `${data.month.slice(0, 4)}년 ${Number(data.month.slice(5))}월`;
      render();
    } catch (err) {
      $('calendar').innerHTML = `<div class="empty"><p>${escapeHtml(err.message)}</p><button type="button" class="btn btn--md mt-12" id="retry">다시 시도</button></div>`;
      $('retry').addEventListener('click', () => load(state.month));
    } finally {
      $('calendar').setAttribute('aria-busy', 'false');
    }
  }

  function render() {
    const { month } = state.data;
    const first = `${month}-01`;
    const wds = weekdays();
    // 달력 시작: 첫 날이 속한 주의 월요일
    let cur = addDays(first, -((wdOf(first) + 6) % 7));
    const weeks = [];
    while (cur.slice(0, 7) <= month) {
      const row = [];
      for (let i = 0; i < 7; i++) {
        const date = addDays(cur, i);
        if (wds.includes(wdOf(date))) row.push(date);
      }
      // 이 달 날짜가 하나도 없는 줄(예: 1일이 일요일인 달의 첫 주)은 그리지 않는다
      if (row.some((d) => d.slice(0, 7) === month)) weeks.push(row);
      cur = addDays(cur, 7);
      if (cur.slice(0, 7) > month) break;
    }

    const head = wds.map((wd) => `<button type="button" class="month-grid__wd" data-wd="${wd}" aria-label="이 달 ${WEEKDAYS[wd]}요일 모두 선택">${WEEKDAYS[wd]}</button>`).join('');
    const cells = weeks.flat().map((date) => {
      if (date.slice(0, 7) !== month) return '<div class="day is-outside" aria-hidden="true"></div>';
      const info = state.byDate.get(date);
      const past = date < state.data.today;
      const can = editable(date);
      const sel = state.selected.has(date);
      const open = info ? info.open : 0;
      const booked = info ? info.booked + info.done : 0;
      const names = info ? info.bookings.map((b) => `${b.hour}시 ${b.name}`) : [];
      const label = `${md(date)} ${WEEKDAYS[wdOf(date)]}요일, 열린 시간 ${open}칸, 예약 ${booked}건${sel ? ', 선택됨' : ''}`;
      return `
        <button type="button" class="day${past ? ' is-past' : ''}${sel ? ' is-selected' : ''}${date === state.data.today ? ' is-today' : ''}"
          data-date="${date}" aria-pressed="${sel}" aria-label="${escapeHtml(label)}"${can ? '' : ' aria-disabled="true"'}>
          <span class="day__num">${Number(date.slice(8))}</span>
          ${open ? `<span class="day__open">○ ${open}</span>` : ''}
          ${booked ? `<span class="day__booked">● ${booked}</span>` : ''}
          ${names.length ? `<span class="day__names">${names.slice(0, 3).map(escapeHtml).join('<br>')}${names.length > 3 ? `<br>외 ${names.length - 3}명` : ''}</span>` : ''}
        </button>`;
    }).join('');
    $('calendar').innerHTML = `<div class="month-grid">${head}${cells}</div>`;
    $('calendar').firstElementChild.style.setProperty('--cols', wds.length);
    renderBar();
  }

  // ── 선택 ──
  $('calendar').addEventListener('click', (e) => {
    const wdBtn = e.target.closest('[data-wd]');
    if (wdBtn) {
      const wd = Number(wdBtn.dataset.wd);
      const dates = monthDates().filter((d) => wdOf(d) === wd && editable(d));
      if (!dates.length) return toast('이 달에는 더 고를 수 있는 날이 없어요.', 'error');
      const allOn = dates.every((d) => state.selected.has(d));
      dates.forEach((d) => (allOn ? state.selected.delete(d) : state.selected.add(d)));
      return render();
    }
    const day = e.target.closest('[data-date]');
    if (!day) return;
    const date = day.dataset.date;
    if (!editable(date)) {
      if (date < state.data.today) return toast('지난 날은 바꿀 수 없어요. 예약 목록에서 확인해 주세요.', 'error');
      return toast('아직 열 수 없는 날이에요. (최대 180일 이후까지)', 'error');
    }
    if (state.selected.has(date)) state.selected.delete(date); else state.selected.add(date);
    render();
  });

  // ── 시간 칩 (기본: 12시 제외 전부, 마지막 선택을 기억) ──
  function initHours() {
    const { hourStart, hourEnd } = state.data;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(HOURS_KEY) || 'null'); } catch (_) { /* ignore */ }
    const all = [];
    for (let h = hourStart; h < hourEnd; h++) all.push(h);
    state.allHours = all;
    state.hours = new Set(Array.isArray(saved) && saved.length ? saved.filter((h) => all.includes(h)) : all.filter((h) => h !== 12));
    $('hourChips').innerHTML = all.map((h) => `<label class="chip"><input type="checkbox" value="${h}"${state.hours.has(h) ? ' checked' : ''}><span>${pad(h)}:00</span></label>`).join('')
      + '<button type="button" class="btn btn--sm btn--ghost" id="hoursAll">전체</button>';
    $('hourChips').addEventListener('change', (e) => {
      const h = Number(e.target.value);
      if (e.target.checked) state.hours.add(h); else state.hours.delete(h);
      saveHours();
      renderBar();
    });
    $('hoursAll').addEventListener('click', () => {
      const allOn = state.hours.size === all.length;
      state.hours = new Set(allOn ? [] : all);
      $('hourChips').querySelectorAll('input').forEach((i) => { i.checked = !allOn; });
      saveHours();
      renderBar();
    });
  }
  function saveHours() {
    try { localStorage.setItem(HOURS_KEY, JSON.stringify([...state.hours])); } catch (_) { /* ignore */ }
  }

  function renderBar() {
    const dates = [...state.selected].sort();
    $('bar').hidden = dates.length === 0;
    document.body.classList.toggle('has-month-bar', dates.length > 0);
    if (!dates.length) return;
    const shown = dates.slice(0, 6).map((d) => `${md(d)}(${WEEKDAYS[wdOf(d)]})`).join(', ');
    $('selLabel').innerHTML = `<b>${dates.length}일 선택</b> · ${escapeHtml(shown)}${dates.length > 6 ? ` 외 ${dates.length - 6}일` : ''}`;
    const n = dates.length * state.hours.size;
    $('previewText').textContent = state.hours.size ? `${dates.length}일 × ${state.hours.size}시간 = ${n}칸` : '시간을 하나 이상 골라 주세요.';
    $('openBtn').disabled = $('closeBtn').disabled = !state.hours.size;
    const wl = $('weekDetail');
    wl.hidden = dates.length !== 1;
    if (dates.length === 1) wl.href = '/admin/slots.html?week=' + dates[0];
  }

  $('clearSel').addEventListener('click', () => { state.selected.clear(); render(); });

  async function apply(open) {
    const dates = [...state.selected].sort();
    const starts = [];
    dates.forEach((d) => [...state.hours].sort((a, b) => a - b).forEach((h) => starts.push(`${d} ${pad(h)}:00:00`)));
    if (!starts.length) return;
    const btn = open ? $('openBtn') : $('closeBtn');
    btn.disabled = true;
    try {
      const r = await api.post('/api/admin/slots/set', { starts, open });
      const skipped = r.skipped || [];
      const bookedSkip = skipped.filter((s) => /예약/.test(s.reason)).length;
      const pastSkip = skipped.length - bookedSkip;
      let msg = open ? `${r.changed}칸을 열었어요.` : `${r.changed}칸을 닫았어요.`;
      if (bookedSkip) msg += ` 예약이 있는 ${bookedSkip}칸은 그대로 두었어요.`;
      if (pastSkip) msg += ` 지난 시간 ${pastSkip}칸은 건너뛰었어요.`;
      toast(msg, 'success');
      state.selected.clear();
      await load(state.month);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  }
  $('openBtn').addEventListener('click', () => apply(true));
  $('closeBtn').addEventListener('click', () => apply(false));

  $('prevMonth').addEventListener('click', () => { state.selected.clear(); load(state.data.prevMonth); });
  $('nextMonth').addEventListener('click', () => { state.selected.clear(); load(state.data.nextMonth); });
  $('thisMonth').addEventListener('click', () => { state.selected.clear(); load(''); });
  $('showSat').addEventListener('change', () => {
    try { localStorage.setItem(SAT_KEY, $('showSat').checked ? '1' : '0'); } catch (_) { /* ignore */ }
    if (!$('showSat').checked) [...state.selected].filter((d) => wdOf(d) === 6).forEach((d) => state.selected.delete(d));
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected.size) { state.selected.clear(); render(); }
  });

  window.Admin.ready.then(() => load(state.month));
})();
