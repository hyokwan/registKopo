'use strict';
const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');

const MIGRATIONS_DIR = path.join(config.root, 'db', 'migrations');

// 세미콜론으로 끝나는 줄 기준으로 문장을 나눈다 (주석 줄 제거)
function splitStatements(sql) {
  const lines = sql.split(/\r?\n/).filter((l) => !/^\s*--/.test(l));
  const out = [];
  let buf = [];
  for (const line of lines) {
    buf.push(line);
    if (/;\s*$/.test(line)) {
      const stmt = buf.join('\n').trim().replace(/;\s*$/, '');
      if (stmt) out.push(stmt);
      buf = [];
    }
  }
  const rest = buf.join('\n').trim();
  if (rest) out.push(rest);
  return out;
}

async function migrate({ prefix = config.tablePrefix, log = console.log } = {}) {
  if (!/^cb_[a-z0-9_]*$/.test(prefix)) throw new Error(`허용되지 않는 테이블 접두어: ${prefix}`);
  const pool = db.getPool();
  const historyTable = `\`${prefix}migrations\``;
  await pool.query(
    `CREATE TABLE IF NOT EXISTS ${historyTable} (
      \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      \`name\` VARCHAR(190) NOT NULL,
      \`applied_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`uq_${prefix}migrations_name\` (\`name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  const [doneRows] = await pool.query(`SELECT name FROM ${historyTable}`);
  const done = new Set(doneRows.map((r) => r.name));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8').replace(/\{\{p\}\}/g, prefix);
    for (const stmt of splitStatements(sql)) {
      if (/\b(DROP\s+DATABASE|TRUNCATE)\b/i.test(stmt)) throw new Error(`${file}: 파괴적 명령은 허용되지 않아요.`);
      await pool.query(stmt);
    }
    await pool.query(`INSERT INTO ${historyTable} (name) VALUES (?)`, [file]);
    log(`  적용: ${file}`);
    applied++;
  }
  log(applied ? `마이그레이션 ${applied}개 적용 완료 (접두어 ${prefix})` : `적용할 마이그레이션이 없어요 (접두어 ${prefix})`);
}

module.exports = { migrate, splitStatements };

if (require.main === module) {
  migrate()
    .catch((e) => {
      console.error('❌ 마이그레이션 실패:', e.code || '', e.message);
      process.exitCode = 1;
    })
    .finally(() => db.close());
}
