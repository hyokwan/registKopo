'use strict';
// 보유기간(상담일 + 6개월)이 지난 예약의 개인정보를 익명화한다.
// 예약 행 자체(일시·상태·지원유형)는 통계용으로 남기고 이름·연락처·이메일·관심분야·문의·취소사유만 지운다.
//   npm run purge-expired              실제 익명화
//   npm run purge-expired -- --dry-run 대상 건수만 확인
const db = require('../db');
const time = require('../time');
const log = require('../logger');

const { t } = db;
const RETENTION_MONTHS = 6;

async function purgeExpired({ dryRun = false, now = time.nowKst(), months = RETENTION_MONTHS } = {}) {
  const where = `r.anonymized_at IS NULL AND s.start_at < DATE_SUB(?, INTERVAL ? MONTH)`;
  const [c] = await db.query(
    `SELECT COUNT(*) AS n FROM ${t('reservations')} r JOIN ${t('slots')} s ON s.id = r.slot_id WHERE ${where}`,
    [now, months]
  );
  const target = Number(c.n);
  if (dryRun || !target) return { target, anonymized: 0 };

  const r = await db.query(
    `UPDATE ${t('reservations')} r JOIN ${t('slots')} s ON s.id = r.slot_id
        SET r.applicant_name = '(익명)', r.phone = '', r.email = NULL, r.interest = NULL,
            r.message = NULL, r.cancel_reason = NULL, r.anonymized_at = NOW()
      WHERE ${where}`,
    [now, months]
  );
  log.info('reservation.purged', { count: r.affectedRows, months });
  return { target, anonymized: r.affectedRows };
}

module.exports = { purgeExpired };

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  purgeExpired({ dryRun })
    .then(({ target, anonymized }) => {
      if (dryRun) console.log(`[미리보기] 익명화 대상 ${target}건 (상담일로부터 ${RETENTION_MONTHS}개월 경과)`);
      else console.log(`익명화 완료: ${anonymized}건`);
    })
    .catch((err) => {
      console.error(`익명화 실패: ${err.code || ''} ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
