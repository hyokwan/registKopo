'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

const LOG_DIR = path.join(config.root, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

let stream = null;
function fileStream() {
  if (config.isTest) return null;
  if (!stream) {
    try {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      stream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    } catch (_) {
      stream = null;
    }
  }
  return stream;
}

function kstNow() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().replace('T', ' ').slice(0, 19);
}

function write(level, event, detail) {
  const line = `${kstNow()} [${level}] ${event}${detail ? ' ' + JSON.stringify(detail) : ''}`;
  if (!config.isTest || process.env.CB_TEST_LOG) {
    (level === 'ERROR' || level === 'WARN' ? console.error : console.log)(line);
  }
  const s = fileStream();
  if (s) s.write(line + '\n');
}

// 전화번호 가운데 마스킹: 010-1234-5678 -> 010-****-5678
function maskPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

module.exports = {
  info: (event, detail) => write('INFO', event, detail),
  warn: (event, detail) => write('WARN', event, detail),
  error: (event, detail) => write('ERROR', event, detail),
  maskPhone,
};
