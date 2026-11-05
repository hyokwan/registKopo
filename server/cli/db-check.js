'use strict';
const config = require('../config');
const db = require('../db');

(async () => {
  const { host, port, database, user } = config.db;
  console.log(`DB 접속 시도: ${host}:${port} / DB=${database} / USER=${user}`);
  try {
    const [row] = await db.query('SELECT VERSION() AS version, NOW() AS now, @@session.time_zone AS tz');
    console.log('✅ 접속 성공');
    console.log(`MySQL 버전: ${row.version}`);
    console.log(`서버 시각(KST 세션): ${row.now} (time_zone=${row.tz})`);
    const tables = await db.query(
      'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME LIKE ?',
      [database, 'cb\\_%']
    );
    console.log(`cb_ 테이블 ${tables.length}개${tables.length ? ': ' + tables.map((r) => r.name).join(', ') : ''}`);
    process.exitCode = 0;
  } catch (e) {
    console.error('❌ 접속 실패');
    console.error(`코드: ${e.code || '-'} / 메시지: ${e.message}`);
    if (['ETIMEDOUT', 'ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'EHOSTUNREACH'].includes(e.code)) {
      console.error('→ 가비아 관리 콘솔에서 이 PC의 외부 접속 IP 허용이 필요할 수 있어요.');
    }
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
