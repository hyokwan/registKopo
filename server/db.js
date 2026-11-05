'use strict';
const mysql = require('mysql2/promise');
const config = require('./config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      ...config.db,
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
      timezone: '+09:00',
      dateStrings: true, // DATETIME을 'YYYY-MM-DD HH:mm:ss' 문자열(KST)로 다룬다
      connectTimeout: 10000,
    });
    // 세션 타임존을 KST로 고정 (NOW() 등)
    pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+09:00'");
    });
  }
  return pool;
}

// 테이블 이름: t('slots') -> 'cb_slots' (테스트: 'cb_test_slots')
const t = (name) => `\`${config.tablePrefix}${name}\``;

async function query(sql, params) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function withTransaction(fn) {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

async function close() {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

module.exports = { getPool, query, withTransaction, close, t };
