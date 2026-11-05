/* 교수 페이지 공통: 내 정보 로드, 상단 메뉴, 로그아웃 */
(function () {
  'use strict';
  const { api, toast } = window.App;

  const ready = api.get('/api/admin/me').then((me) => {
    const nameEl = document.querySelector('[data-me-name]');
    if (nameEl) nameEl.textContent = me.name;
    document.querySelectorAll('[data-admin-only]').forEach((el) => { el.hidden = !me.isAdmin; });
    const here = location.pathname;
    document.querySelectorAll('.nav a').forEach((a) => {
      if (a.getAttribute('href') === here) a.setAttribute('aria-current', 'page');
    });
    return me;
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-logout]');
    if (!btn) return;
    try {
      await api.post('/api/admin/logout');
    } catch (err) {
      toast(err.message, 'error');
    }
    location.href = '/admin/login.html';
  });

  window.Admin = { ready };
})();
