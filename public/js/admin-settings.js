/* 교수: 설정 — 내 정보·비밀번호(모두), 학과 정보·교수 계정·알림(관리자) */
(function () {
  'use strict';
  const { api, toast, escapeHtml } = window.App;
  const $ = (id) => document.getElementById(id);
  let me = null;

  // ── 공통: 칸별 오류 표시 (prefix: me / pw / dept / add / reset) ──
  function setErrors(form, prefix, errors) {
    form.querySelectorAll('[data-field]').forEach((field) => {
      const name = field.dataset.field;
      const msg = errors[name] || '';
      field.classList.toggle('is-invalid', !!msg);
      const el = $(`err-${prefix}-${name}`);
      if (el) el.textContent = msg;
      const input = field.querySelector('input');
      if (input) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    });
    const first = form.querySelector('.is-invalid input');
    if (first) first.focus();
  }
  // 서버 오류: 칸 오류가 있으면 칸에, 없으면 토스트로
  function handleError(err, form, prefix) {
    if (err.body && err.body.errors) setErrors(form, prefix, err.body.errors);
    else toast(err.message, 'error');
  }
  async function submitting(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  }

  // ── 레이어 ──
  let lastFocus = null;
  function openLayer(layer, focusEl) {
    lastFocus = document.activeElement;
    layer.hidden = false;
    (focusEl || layer.querySelector('input')).focus();
  }
  function closeLayer(layer) {
    layer.hidden = true;
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
  }
  document.querySelectorAll('.modal').forEach((layer) => {
    layer.addEventListener('click', (e) => {
      if (e.target === layer || e.target.closest('[data-close]')) closeLayer(layer);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(closeLayer);
  });

  // ── 내 정보 ──
  function fillMe() {
    $('meEmail').textContent = `로그인 이메일: ${me.email}`;
    $('meName').value = me.name || '';
    $('meOffice').value = me.office || '';
    $('meOffice').placeholder = me.department.defaultLocation || '';
    $('meChat').value = me.telegramChatId || '';
    $('pwUser').value = me.email;
  }
  $('meForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = $('meForm');
    const name = $('meName').value.trim();
    if (!name) return setErrors(form, 'me', { name: '이름을 입력해 주세요.' });
    setErrors(form, 'me', {});
    submitting(form, async () => {
      try {
        me = await api.patch('/api/admin/me', { name, office: $('meOffice').value, telegramChatId: $('meChat').value });
        fillMe();
        document.querySelectorAll('[data-me-name]').forEach((el) => { el.textContent = me.name; });
        toast('내 정보를 저장했어요.', 'success');
      } catch (err) { handleError(err, form, 'me'); }
    });
  });

  // ── 비밀번호 ──
  $('pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = $('pwForm');
    const cur = $('curPw').value;
    const next = $('newPw').value;
    const errors = {};
    if (!cur) errors.currentPassword = '현재 비밀번호를 입력해 주세요.';
    if (next.length < 8) errors.newPassword = '새 비밀번호는 8자 이상으로 입력해 주세요.';
    else if (next.length > 72) errors.newPassword = '새 비밀번호는 72자 이하로 입력해 주세요.';
    if (!errors.newPassword && $('newPw2').value !== next) errors.confirmPassword = '새 비밀번호가 서로 달라요. 다시 입력해 주세요.';
    setErrors(form, 'pw', errors);
    if (Object.keys(errors).length) return;
    submitting(form, async () => {
      try {
        await api.post('/api/admin/me/password', { currentPassword: cur, newPassword: next });
        form.reset();
        $('pwUser').value = me.email;
        toast('비밀번호를 바꿨어요.', 'success');
      } catch (err) { handleError(err, form, 'pw'); }
    });
  });

  // ── 학과 정보 (관리자) ──
  async function loadDept() {
    const d = await api.get('/api/admin/department');
    $('deptLoc').value = d.defaultLocation || '';
    $('deptPhone').value = d.contactPhone || '';
  }
  $('deptForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = $('deptForm');
    const loc = $('deptLoc').value.trim();
    if (!loc) return setErrors(form, 'dept', { defaultLocation: '학과 기본 장소를 입력해 주세요.' });
    setErrors(form, 'dept', {});
    submitting(form, async () => {
      try {
        const d = await api.patch('/api/admin/department', { defaultLocation: loc, contactPhone: $('deptPhone').value });
        me.department.defaultLocation = d.defaultLocation;
        $('meOffice').placeholder = d.defaultLocation;
        toast('학과 정보를 저장했어요.', 'success');
      } catch (err) { handleError(err, form, 'dept'); }
    });
  });

  // ── 교수 계정 (관리자) ──
  let profs = [];
  function profHtml(p) {
    const self = p.id === me.id;
    const tags = [
      p.isAdmin ? '<span class="tag tag--brand">관리자</span>' : '',
      !p.isActive ? '<span class="tag">사용 중지</span>' : '',
      p.locked ? '<span class="tag tag--warn">로그인 잠김</span>' : '',
      self ? '<span class="tag">나</span>' : '',
    ].join('');
    const meta = [p.email, p.office || null, p.upcoming ? `예정 상담 ${p.upcoming}건` : null].filter(Boolean).map(escapeHtml).join(' · ');
    const actions = self ? '' : `
      <button type="button" class="btn btn--sm" data-act="reset" data-id="${p.id}">비밀번호 재설정</button>
      ${p.locked ? `<button type="button" class="btn btn--sm" data-act="unlock" data-id="${p.id}">잠금 해제</button>` : ''}
      ${p.isActive ? `<button type="button" class="btn btn--sm" data-act="admin" data-id="${p.id}">${p.isAdmin ? '관리자 해제' : '관리자 지정'}</button>` : ''}
      <button type="button" class="btn btn--sm${p.isActive ? ' btn--danger-outline' : ''}" data-act="active" data-id="${p.id}">${p.isActive ? '사용 중지' : '다시 사용'}</button>`;
    return `
      <li class="prof${p.isActive ? '' : ' is-inactive'}">
        <div class="prof__info">
          <div class="prof__name">${escapeHtml(p.name)}${tags}</div>
          <div class="prof__meta">${meta}</div>
        </div>
        <div class="prof__actions">${actions}</div>
      </li>`;
  }
  async function loadProfs() {
    profs = await api.get('/api/admin/professors');
    $('profList').innerHTML = profs.map(profHtml).join('');
  }
  async function patchProf(id, body, msg) {
    try {
      await api.patch(`/api/admin/professors/${id}`, body);
      toast(msg, 'success');
      await loadProfs();
    } catch (err) { toast(err.message, 'error'); }
  }

  $('profList').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const p = profs.find((x) => x.id === Number(btn.dataset.id));
    if (!p) return;
    const act = btn.dataset.act;
    if (act === 'reset') return openReset(p);
    if (act === 'unlock') return patchProf(p.id, { unlock: true }, '로그인 잠금을 풀었어요.');
    if (act === 'admin') return patchProf(p.id, { isAdmin: !p.isAdmin }, p.isAdmin ? '관리자 권한을 해제했어요.' : '관리자로 지정했어요.');
    if (act === 'active') {
      if (p.isActive) {
        const warn = p.upcoming ? `\n예정된 상담 ${p.upcoming}건은 그대로 남아요. 필요하면 예약 목록에서 따로 취소해 주세요.` : '';
        // eslint-disable-next-line no-alert
        if (!window.confirm(`${p.name} 계정을 사용 중지할까요?\n로그인할 수 없고, 열어 둔 시간도 지원자에게 보이지 않아요.${warn}`)) return;
        return patchProf(p.id, { isActive: false }, '계정을 사용 중지했어요.');
      }
      return patchProf(p.id, { isActive: true }, '계정을 다시 사용할 수 있어요.');
    }
  });

  const addModal = $('addModal');
  $('addProfBtn').addEventListener('click', () => {
    addModal.querySelector('form').reset();
    setErrors(addModal.querySelector('form'), 'add', {});
    openLayer(addModal, $('addName'));
  });
  addModal.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const body = { name: $('addName').value.trim(), email: $('addEmail').value.trim(), password: $('addPw').value, isAdmin: $('addAdmin').checked };
    const errors = {};
    if (!body.name) errors.name = '이름을 입력해 주세요.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) errors.email = '이메일 형식을 다시 확인해 주세요.';
    if (body.password.length < 8) errors.password = '비밀번호는 8자 이상으로 입력해 주세요.';
    setErrors(form, 'add', errors);
    if (Object.keys(errors).length) return;
    submitting(form, async () => {
      try {
        await api.post('/api/admin/professors', body);
        closeLayer(addModal);
        toast(`${body.name} 계정을 추가했어요.`, 'success');
        await loadProfs();
      } catch (err) { handleError(err, form, 'add'); }
    });
  });

  const resetModal = $('resetModal');
  let resetTarget = null;
  function openReset(p) {
    resetTarget = p;
    $('resetDesc').textContent = `${p.name} (${p.email})`;
    resetModal.querySelector('form').reset();
    setErrors(resetModal.querySelector('form'), 'reset', {});
    openLayer(resetModal, $('resetPw'));
  }
  resetModal.querySelector('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const password = $('resetPw').value;
    if (password.length < 8) return setErrors(form, 'reset', { password: '비밀번호는 8자 이상으로 입력해 주세요.' });
    submitting(form, async () => {
      try {
        await api.patch(`/api/admin/professors/${resetTarget.id}`, { password });
        closeLayer(resetModal);
        toast('비밀번호를 재설정했어요. 본인에게 알려 주세요.', 'success');
        await loadProfs();
      } catch (err) { handleError(err, form, 'reset'); }
    });
  });

  // ── 알림 (관리자) ──
  const item = (ok, label, desc) => `
    <li class="channel ${ok ? 'is-on' : 'is-off'}">
      <span class="channel__icon" aria-hidden="true">${ok ? '✓' : '–'}</span>
      <span class="channel__label">${escapeHtml(label)}</span>
      <span class="channel__desc">${escapeHtml(desc)}</span>
    </li>`;

  async function loadStatus() {
    const s = await api.get('/api/admin/notify/status');
    $('channelList').innerHTML = [
      item(s.telegram, '텔레그램', s.telegram ? '연결됨' : s.telegramTokenMissing ? '미설정 (봇 토큰 없음)' : '미설정 (chat_id 없음)'),
      item(s.slack, '슬랙', s.slack ? '연결됨' : '미설정 (선택)'),
      item(s.professorTelegram, '내 텔레그램', s.professorTelegram ? '담당 예약을 나에게도 보내요' : '미설정 (선택)'),
    ].join('');
    $('testBtn').disabled = !s.telegram && !s.slack && !s.professorTelegram;
  }

  $('testBtn').addEventListener('click', async () => {
    const btn = $('testBtn');
    btn.disabled = true;
    btn.textContent = '보내는 중…';
    const out = $('testResult');
    try {
      const r = await api.post('/api/admin/notify/test');
      if (!r.configured) {
        out.innerHTML = item(false, '알림 채널', '설정된 채널이 없어요. .env 값을 확인해 주세요.');
      } else {
        out.innerHTML = r.results.map((x) => item(x.ok, x.channel, x.ok ? '보냈어요. 도착했는지 확인해 주세요.' : `실패: ${x.reason}`)).join('');
        const failed = r.results.filter((x) => !x.ok).length;
        toast(failed ? '일부 채널로 보내지 못했어요. 결과를 확인해 주세요.' : '테스트 알림을 보냈어요.', failed ? 'error' : 'success');
      }
      out.hidden = false;
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '🔔 테스트 알림 보내기';
    }
  });

  window.Admin.ready.then((m) => {
    me = m;
    fillMe();
    $('pwShared').hidden = !me.isAdmin;
    if (!me.isAdmin) return;
    $('pageSub').textContent = '내 정보, 학과 정보, 교수 계정, 알림을 관리해요.';
    const fail = (el) => (err) => { if (el) el.innerHTML = ''; toast(err.message, 'error'); };
    loadDept().catch(fail());
    loadProfs().catch(fail($('profList')));
    loadStatus().catch(fail($('channelList')));
  });
})();
