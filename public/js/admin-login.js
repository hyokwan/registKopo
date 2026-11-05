(function () {
  'use strict';
  const { api } = window.App;
  const form = document.getElementById('loginForm');
  const errorEl = document.getElementById('formError');
  const btn = document.getElementById('submitBtn');

  // 이미 로그인 상태면 바로 이동
  api.get('/api/admin/me').then(() => goNext()).catch(() => {});

  function goNext() {
    const next = new URLSearchParams(location.search).get('next');
    // 같은 사이트의 /admin 경로로만 이동 (오픈 리다이렉트 방지)
    location.href = next && /^\/admin\/[\w\-./?=&%]*$/.test(next) ? next : '/admin/slots.html';
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) {
      errorEl.textContent = '이메일과 비밀번호를 모두 입력해 주세요.';
      errorEl.hidden = false;
      return;
    }
    btn.disabled = true;
    btn.textContent = '로그인 중…';
    try {
      const data = await api.post('/api/admin/login', { email, password });
      api.setCsrf(data.csrfToken);
      goNext();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.hidden = false;
      form.password.value = '';
      form.password.focus();
    } finally {
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  });
})();
