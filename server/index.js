'use strict';
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const MySQLStore = require('express-mysql-session')(session);

const config = require('./config');
const db = require('./db');
const log = require('./logger');
const csrf = require('./services/csrf');
const auth = require('./services/auth');
const { fail } = require('./http');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // nginx 리버스 프록시 뒤에서 실제 IP/HTTPS를 인식
  app.set('trust proxy', 'loopback');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          fontSrc: ["'self'", 'https://cdn.jsdelivr.net', 'data:'],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          upgradeInsecureRequests: config.isProd ? [] : null,
        },
      },
      hsts: config.isProd,
    })
  );

  const store = new MySQLStore(
    {
      createDatabaseTable: false,
      clearExpired: !config.isTest,
      schema: { tableName: `${config.tablePrefix}sessions` },
    },
    db.getPool()
  );
  app.locals.sessionStore = store;

  app.use(
    session({
      name: 'cb.sid',
      secret: config.sessionSecret,
      store,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: 12 * 3600e3,
      },
    })
  );

  app.use(express.json({ limit: '20kb' }));

  // ── API ──────────────────────────────────────────────
  app.use('/api', csrf.verify);
  app.use('/api', require('./routes/public'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api', (req, res) => fail(res, 404, '요청하신 기능을 찾을 수 없어요.'));

  // 외부 홈페이지 버튼용 짧은 주소 → 시간 선택 화면으로 바로 이동 (쿼리는 그대로 전달)
  app.get(['/reserve', '/reserve/'], (req, res) => {
    const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    res.redirect(302, '/book.html' + qs);
  });

  // ── 교수 페이지 보호: login.html 외 /admin/*.html 은 로그인 필요 ──
  app.get(['/admin', '/admin/'], (req, res) => res.redirect(302, '/admin/slots.html'));
  app.get(/^\/admin\/(?!login\.html$).+\.html$/, auth.requireAuthPage);

  app.use(express.static(path.join(config.root, 'public'), { extensions: ['html'], maxAge: config.isProd ? '1h' : 0 }));

  app.use((req, res) => res.status(404).sendFile(path.join(config.root, 'public', '404.html'), (e) => {
    if (e) res.status(404).type('text').send('페이지를 찾을 수 없어요.');
  }));

  // 에러 핸들러: 스택트레이스는 노출하지 않는다
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return fail(res, 400, '요청 형식이 올바르지 않아요.');
    if (err.type === 'entity.too.large') return fail(res, 413, '입력 내용이 너무 길어요. 줄여서 다시 보내 주세요.');
    const status = err.status && err.status < 500 ? err.status : 500;
    if (status === 500) log.error('server.error', { path: req.path, code: err.code, message: err.message });
    const message = status === 500 ? '일시적인 오류가 발생했어요. 잠시 후 다시 시도해 주세요.' : err.message;
    if (req.path.startsWith('/api')) return fail(res, status, message, err.extra);
    res.status(status).type('text').send(message);
  });

  return app;
}

function warnNotifyChannels() {
  const tg = config.telegram.botToken && config.telegram.chatId;
  const slack = config.slackWebhookUrl;
  if (!tg && !slack) log.warn('notify.unconfigured', { message: '알림 채널 미설정 (TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, SLACK_WEBHOOK_URL)' });
  else if (!config.telegram.botToken) log.warn('notify.unconfigured', { message: '텔레그램 알림 미설정' });
}

module.exports = { createApp };

if (require.main === module) {
  const app = createApp();
  warnNotifyChannels();
  app.listen(config.port, () => {
    log.info('server.start', { port: config.port, env: config.nodeEnv, baseUrl: config.baseUrl });
  });
}
