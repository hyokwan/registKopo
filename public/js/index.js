(function () {
  'use strict';
  const { api } = window.App;
  const placeText = document.getElementById('placeText');
  api.get('/api/departments')
    .then((list) => {
      const dept = list[0];
      placeText.textContent = dept ? dept.defaultLocation : '학과로 문의해 주세요.';
      if (dept && dept.contactPhone) {
        const p = document.getElementById('phoneText');
        p.textContent = '';
        const a = document.createElement('a');
        a.href = 'tel:' + dept.contactPhone.replace(/[^0-9+]/g, '');
        a.textContent = dept.contactPhone;
        p.append('☎ 학과 문의 ', a);
        p.hidden = false;
      }
    })
    .catch(() => { placeText.textContent = '한국폴리텍대학 서울강서캠퍼스'; });
})();
