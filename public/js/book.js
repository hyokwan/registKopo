/* 지원자: 학과 → 날짜 → 시간 선택 */
(function () {
  'use strict';
  const { api, toast, fmt, escapeHtml, store } = window.App;

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const prev = store.get('cb.selection') || {};

  const state = {
    dept: params.get('dept') || prev.department || null,
    week: params.get('week') || prev.week || null,
    data: null,
    date: null,
    time: null, // { startAt, endAt, location }
  };
  const preselect = prev.startAt || null;

  async function init() {
    let depts;
    try {
      depts = await api.get('/api/departments');
    } catch (err) {
      $('timeView').hidden = false;
      $('times').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!depts.length) {
      $('timeView').hidden = false;
      $('times').innerHTML = '<div class="empty">지금은 상담 예약을 받지 않아요.</div>';
      return;
    }
    if (depts.length === 1) state.dept = depts[0].slug; // 학과가 1개면 선택 화면 건너뛰기
    if (!state.dept || !depts.some((d) => d.slug === state.dept)) return showDepts(depts);
    showTimes();
  }

  function showDepts(depts) {
    $('deptView').hidden = false;
    $('timeView').hidden = true;
    $('deptList').innerHTML = depts.map((d) =>
      `<button type="button" class="dept-item" data-slug="${escapeHtml(d.slug)}">${escapeHtml(d.name)}<span aria-hidden="true">›</span></button>`
    ).join('');
    $('deptList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-slug]');
      if (!btn) return;
      state.dept = btn.dataset.slug;
      state.week = null;
      $('deptView').hidden = true;
      showTimes();
    });
  }

  function showTimes() {
    $('timeView').hidden = false;
    load(state.week);
  }

  function skeleton() {
    $('dates').innerHTML = Array.from({ length: 6 }, () => '<div class="date-chip skeleton" aria-hidden="true"></div>').join('');
    $('times').innerHTML = '<div class="time-grid">' + Array.from({ length: 6 }, () => '<div class="time-btn skeleton" aria-hidden="true"></div>').join('') + '</div>';
  }

  async function load(week) {
    skeleton();
    try {
      const data = await api.get(`/api/departments/${encodeURIComponent(state.dept)}/availability` + (week ? `?week=${encodeURIComponent(week)}` : ''));
      state.data = data;
      state.week = data.weekStart;
      $('deptName').textContent = `${data.department.name} · 상담은 1시간 동안 진행돼요`;
      const url = new URL(location.href);
      url.searchParams.set('week', data.weekStart);
      history.replaceState(null, '', url);

      // 날짜: 미리 고른 시간이 이 주에 있으면 그 날, 아니면 가능한 첫 날
      const preDay = preselect && data.days.find((d) => d.date === preselect.slice(0, 10) && d.times.length);
      const first = data.days.find((d) => d.times.length);
      state.date = (preDay || first || data.days[0]).date;
      state.time = preDay ? preDay.times.find((x) => x.startAt === preselect) || null : null;
      render();
    } catch (err) {
      $('dates').innerHTML = '';
      $('times').innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`;
    }
  }

  const md = (date) => `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일`;

  function render() {
    const d = state.data;
    const first = d.days[0].date;
    const last = d.days[d.days.length - 1].date;
    $('weekLabel').textContent = first.slice(5, 7) === last.slice(5, 7)
      ? `${md(first)} ~ ${Number(last.slice(8))}일`
      : `${md(first)} ~ ${md(last)}`;
    $('prevWeek').disabled = !d.prevWeek;
    $('nextWeek').disabled = !d.nextWeek;

    const today = todayKst();
    $('dates').innerHTML = d.days.map((day) => {
      const n = day.times.length;
      const cls = ['date-chip'];
      if (!n) cls.push('is-empty');
      if (day.date === today) cls.push('is-today');
      const label = `${fmt.date(day.date)}, ${n ? `예약 가능 ${n}개` : '예약 가능한 시간 없음'}`;
      return `<button type="button" class="${cls.join(' ')}" data-date="${day.date}" aria-pressed="${day.date === state.date}" aria-label="${label}">` +
        `<span class="date-chip__wd">${fmt.weekday(day.date)}</span>` +
        `<span class="date-chip__d">${Number(day.date.slice(8))}</span>` +
        `<span class="date-chip__n">${n ? n + '개' : '없음'}</span></button>`;
    }).join('');

    const allEmpty = d.days.every((day) => !day.times.length);
    const day = d.days.find((x) => x.date === state.date);
    $('timesTitle').textContent = allEmpty ? '시간 선택' : `${fmt.date(state.date)} 가능한 시간`;
    if (allEmpty) {
      $('times').innerHTML = '<div class="empty">이번 주는 상담 가능한 시간이 없어요. 다음 주를 확인해 주세요.' +
        (d.nextWeek ? '<br><button type="button" class="btn btn--md mt-12" id="emptyNext">다음 주 보기 ›</button>' : '') + '</div>';
      const btn = $('emptyNext');
      if (btn) btn.addEventListener('click', () => load(d.nextWeek));
    } else if (!day || !day.times.length) {
      $('times').innerHTML = '<div class="empty">이 날은 예약 가능한 시간이 없어요. 다른 날짜를 골라 주세요.</div>';
    } else {
      $('times').innerHTML = '<div class="time-grid" role="group" aria-label="시간 선택">' + day.times.map((x) =>
        `<button type="button" class="time-btn" data-start="${x.startAt}" aria-pressed="${!!state.time && state.time.startAt === x.startAt}" aria-label="${fmt.time(x.startAt)}부터 1시간">${fmt.time(x.startAt)}</button>`
      ).join('') + '</div>';
    }
    updateSelection();
  }

  function todayKst() {
    return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  }

  function updateSelection() {
    const t = state.time;
    $('nextBtn').disabled = !t;
    $('selectedHint').innerHTML = t ? `선택: <b>${fmt.date(t.startAt)} ${fmt.range(t.startAt, t.endAt)}</b>` : '';
  }

  $('dates').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (!btn || state.date === btn.dataset.date) return;
    state.date = btn.dataset.date;
    state.time = null;
    render();
  });

  $('times').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-start]');
    if (!btn) return;
    const day = state.data.days.find((x) => x.date === state.date);
    state.time = day.times.find((x) => x.startAt === btn.dataset.start) || null;
    $('times').querySelectorAll('[data-start]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    updateSelection();
  });

  $('prevWeek').addEventListener('click', () => state.data && state.data.prevWeek && load(state.data.prevWeek));
  $('nextWeek').addEventListener('click', () => state.data && state.data.nextWeek && load(state.data.nextWeek));

  $('nextBtn').addEventListener('click', () => {
    if (!state.time) return toast('시간을 먼저 선택해 주세요.', 'error');
    store.set('cb.selection', {
      department: state.dept,
      departmentName: state.data.department.name,
      defaultLocation: state.data.department.defaultLocation,
      week: state.week,
      startAt: state.time.startAt,
      endAt: state.time.endAt,
      location: state.time.location,
    });
    location.href = '/apply.html';
  });

  init();
})();
