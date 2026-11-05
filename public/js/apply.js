/* 지원자: 신청서 작성 */
(function () {
  'use strict';
  const { api, fmt, store, bindPhoneInput, isValidPhone } = window.App;
  const $ = (id) => document.getElementById(id);

  const sel = store.get('cb.selection');
  if (!sel || !sel.startAt) {
    location.replace('/book.html');
    return;
  }

  const backUrl = `/book.html?dept=${encodeURIComponent(sel.department)}&week=${encodeURIComponent(sel.week || '')}`;
  $('backLink').href = backUrl;
  $('changeLink').href = backUrl;
  $('takenBack').href = backUrl;
  $('sumWhen').textContent = `${fmt.date(sel.startAt)} ${fmt.range(sel.startAt, sel.endAt)}`;
  $('sumWhere').textContent = sel.location || `${sel.defaultLocation || sel.departmentName} (확정 장소는 완료 화면에서 안내)`;

  const form = $('applyForm');
  const submitBtn = $('submitBtn');
  bindPhoneInput($('phone'));

  // 입력 중 임시 저장 (새로고침해도 유지)
  const draft = store.get('cb.draft') || {};
  ['applicantName', 'phone', 'email', 'interest', 'message'].forEach((k) => { if (draft[k]) form[k].value = draft[k]; });
  if (draft.applicantType) {
    const r = form.querySelector(`input[name="applicantType"][value="${CSS.escape(draft.applicantType)}"]`);
    if (r) r.checked = true;
  }

  const msg = $('message');
  const updateCount = () => { $('msgCount').textContent = `${msg.value.length} / 500`; };
  msg.addEventListener('input', updateCount);
  updateCount();

  function values() {
    const type = form.querySelector('input[name="applicantType"]:checked');
    return {
      department: sel.department,
      startAt: sel.startAt,
      applicantName: form.applicantName.value.trim(),
      phone: form.phone.value.trim(),
      email: form.email.value.trim(),
      applicantType: type ? type.value : '',
      interest: form.interest.value.trim(),
      message: form.message.value.trim(),
      privacyAgreed: form.privacyAgreed.checked,
      website: form.website.value,
    };
  }

  // 입력하는 즉시 해당 칸의 오류를 갱신한다.
  // (blur 시점의 change로 갱신하면 오류 문구가 사라지며 레이아웃이 밀려, 다음 클릭이 빗나간다)
  form.addEventListener('input', (e) => {
    const v = values();
    store.set('cb.draft', { applicantName: v.applicantName, phone: v.phone, email: v.email, applicantType: v.applicantType, interest: v.interest, message: v.message });
    const field = e.target.closest('[data-field]');
    if (field && field.classList.contains('is-invalid')) setError(field.dataset.field, validate(v)[field.dataset.field]);
  });

  function validate(v) {
    const e = {};
    if (!v.applicantName) e.applicantName = '이름을 입력해 주세요.';
    if (!v.phone) e.phone = '휴대폰 번호를 입력해 주세요.';
    else if (!isValidPhone(v.phone)) e.phone = '휴대폰 번호를 다시 확인해 주세요. (예: 010-1234-5678)';
    if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = '이메일 형식을 다시 확인해 주세요.';
    if (!v.applicantType) e.applicantType = '지원 유형을 선택해 주세요.';
    if (v.message.length > 500) e.message = '문의는 500자 이내로 입력해 주세요.';
    if (!v.privacyAgreed) e.privacyAgreed = '개인정보 수집·이용에 동의해 주세요.';
    return e;
  }

  function setError(name, message) {
    const field = form.querySelector(`[data-field="${name}"]`);
    if (!field) return;
    field.classList.toggle('is-invalid', !!message);
    $('err-' + name).textContent = message || '';
    const input = field.querySelector('input, textarea');
    if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function showErrors(errors) {
    ['applicantName', 'phone', 'email', 'applicantType', 'interest', 'message', 'privacyAgreed'].forEach((k) => setError(k, errors[k]));
    const firstKey = Object.keys(errors)[0];
    if (!firstKey) return;
    const field = form.querySelector(`[data-field="${firstKey}"]`);
    const input = field && field.querySelector('input, textarea');
    if (field) field.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (input) input.focus({ preventScroll: true });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('formError').hidden = true;
    const v = values();
    const errors = validate(v);
    showErrors(errors);
    if (Object.keys(errors).length) return;

    submitBtn.disabled = true;
    submitBtn.textContent = '신청하는 중…';
    try {
      const data = await api.post('/api/reservations', v);
      store.set('cb.done', { ...data, phone: v.phone });
      store.remove('cb.draft');
      store.remove('cb.selection');
      location.replace('/done.html');
    } catch (err) {
      if (err.status === 400 && err.body && err.body.errors) {
        showErrors(err.body.errors);
      } else if (err.status === 409) {
        $('takenDesc').textContent = err.message;
        $('takenModal').hidden = false;
        $('takenBack').focus();
      } else {
        $('formError').textContent = err.message;
        $('formError').hidden = false;
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = '예약 신청하기';
    }
  });
})();
