'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

require('dotenv').config({ path: ENV_PATH, quiet: true });

// SESSION_SECRET이 비어 있으면 랜덤 값을 만들어 .env에 채운다 (값은 출력하지 않음)
function ensureSessionSecret() {
  if (process.env.SESSION_SECRET) return;
  const secret = crypto.randomBytes(48).toString('hex');
  process.env.SESSION_SECRET = secret;
  if (process.env.NODE_ENV === 'test') return;
  try {
    let text = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    if (/^SESSION_SECRET=.*$/m.test(text)) {
      text = text.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${secret}`);
    } else {
      text += `${text.endsWith('\n') || !text ? '' : '\n'}SESSION_SECRET=${secret}\n`;
    }
    fs.writeFileSync(ENV_PATH, text);
    console.log('[config] SESSION_SECRET이 비어 있어 새로 생성해 .env에 저장했어요.');
  } catch (e) {
    console.warn('[config] SESSION_SECRET을 .env에 저장하지 못했어요:', e.message);
  }
}
ensureSessionSecret();

const int = (v, d) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : d;
};

const env = process.env;

module.exports = {
  root: ROOT,
  port: int(env.PORT, 3000),
  nodeEnv: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  baseUrl: (env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  sessionSecret: env.SESSION_SECRET,
  db: {
    host: env.DB_HOST,
    port: int(env.DB_PORT, 3306),
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
  },
  // 테스트에서는 cb_test_ 접두어 테이블을 사용해 운영 테이블을 건드리지 않는다
  tablePrefix: env.CB_TABLE_PREFIX || (env.NODE_ENV === 'test' ? 'cb_test_' : 'cb_'),
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN || '',
    chatId: env.TELEGRAM_CHAT_ID || '',
  },
  slackWebhookUrl: env.SLACK_WEBHOOK_URL || '',
  booking: {
    minHoursBefore: int(env.BOOKING_MIN_HOURS_BEFORE, 24),
    maxDaysAhead: int(env.BOOKING_MAX_DAYS_AHEAD, 60),
    cancelMinHoursBefore: int(env.CANCEL_MIN_HOURS_BEFORE, 3),
  },
  slotDayStart: int(env.SLOT_DAY_START, 9),
  slotDayEnd: int(env.SLOT_DAY_END, 18),
};
