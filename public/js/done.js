/* 지원자: 예약 완료 */
(function () {
  'use strict';
  const { fmt, store, toast, copyText } = window.App;
  const $ = (id) => document.getElementById(id);

  const done = store.get('cb.done');
  if (!done || !done.code) {
    $('missingView').hidden = false;
    return;
  }

  $('doneView').hidden = false;
  $('code').textContent = done.code;
  $('when').textContent = `${fmt.dateFull(done.startAt)} ${fmt.range(done.startAt, done.endAt)}`;
  $('where').textContent = done.location || '-';
  $('dept').textContent = done.departmentName || '';
  $('myLink').href = `/my.html?code=${encodeURIComponent(done.code)}`;

  $('copyBtn').addEventListener('click', async () => {
    const ok = await copyText(done.code);
    toast(ok ? '예약번호를 복사했어요.' : '복사하지 못했어요. 예약번호를 직접 적어 두세요.', ok ? 'success' : 'error');
  });
})();
