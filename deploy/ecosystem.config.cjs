// pm2 설정: 서버 프로젝트 폴더에서 `pm2 start deploy/ecosystem.config.cjs`
// 비밀값은 여기에 쓰지 않는다. 프로젝트 루트의 .env 를 읽는다.
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'kopo-booking',
      script: 'server/index.js',
      cwd: path.join(__dirname, '..'),
      instances: 1, // 세션은 DB에 저장되지만 단일 인스턴스로 충분하다
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
