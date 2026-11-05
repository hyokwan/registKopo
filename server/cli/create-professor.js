'use strict';
// 사용법:
//   npm run create-professor -- --department ai-fintech --email prof@example.com --name "AI핀테크융합과 전체교수" --admin
// 비밀번호는 터미널에서 입력받는다(화면에 표시되지 않음). 같은 이메일이 있으면 비밀번호·이름·권한을 갱신한다.
const readline = require('readline');
const db = require('../db');
const auth = require('../services/auth');

const { t } = db;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

// 입력을 화면에 표시하지 않고 한 줄 읽는다. 파이프 입력(비 TTY)도 지원
function askHidden(prompt) {
  return new Promise((resolve) => {
    const input = process.stdin;
    if (!input.isTTY) {
      const rl = readline.createInterface({ input, terminal: false });
      rl.once('line', (line) => { resolve(line.replace(/\r$/, '')); rl.close(); });
      rl.once('close', () => resolve(''));
      return;
    }
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');
    let buf = '';
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          input.setRawMode(false);
          input.pause();
          input.removeListener('data', onData);
          process.stdout.write('\n');
          return resolve(buf);
        }
        if (c === '\u0003') { process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else buf += c;
      }
    };
    input.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const deptSlug = args.department;
  const email = String(args.email || '').trim().toLowerCase();
  const name = typeof args.name === 'string' ? args.name.trim() : '';
  const isAdmin = !!args.admin;

  if (!deptSlug || !email || !name) {
    console.error('사용법: npm run create-professor -- --department <slug> --email <이메일> --name "<이름>" [--admin] [--office "<장소>"]');
    process.exitCode = 1;
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('이메일 형식이 올바르지 않아요.');
    process.exitCode = 1;
    return;
  }

  const [dept] = await db.query(`SELECT id, name FROM ${t('departments')} WHERE slug = ?`, [deptSlug]);
  if (!dept) {
    console.error(`학과(slug=${deptSlug})를 찾을 수 없어요. 먼저 npm run db:migrate 를 실행해 주세요.`);
    process.exitCode = 1;
    return;
  }

  const password = await askHidden('비밀번호(8자 이상): ');
  const pwError = auth.validatePassword(password);
  if (pwError) { console.error(pwError); process.exitCode = 1; return; }
  if (process.stdin.isTTY) {
    const confirm = await askHidden('비밀번호 확인: ');
    if (confirm !== password) { console.error('비밀번호가 서로 달라요.'); process.exitCode = 1; return; }
  }

  const hash = await auth.hashPassword(password);
  const office = typeof args.office === 'string' ? args.office.trim() : null;
  const [existing] = await db.query(`SELECT id FROM ${t('professors')} WHERE email = ?`, [email]);
  if (existing) {
    await db.query(
      `UPDATE ${t('professors')} SET department_id = ?, name = ?, password_hash = ?, is_admin = ?, is_active = 1,
              office = COALESCE(?, office), failed_login_count = 0, locked_until = NULL WHERE id = ?`,
      [dept.id, name, hash, isAdmin ? 1 : 0, office, existing.id]
    );
    console.log(`✅ 기존 계정을 갱신했어요: ${name} <${email}> (${dept.name}${isAdmin ? ', 관리자' : ''})`);
  } else {
    await db.query(
      `INSERT INTO ${t('professors')} (department_id, email, name, password_hash, office, is_admin) VALUES (?, ?, ?, ?, ?, ?)`,
      [dept.id, email, name, hash, office, isAdmin ? 1 : 0]
    );
    console.log(`✅ 교수 계정을 만들었어요: ${name} <${email}> (${dept.name}${isAdmin ? ', 관리자' : ''})`);
  }
}

main()
  .catch((e) => { console.error('❌ 실패:', e.code || '', e.message); process.exitCode = 1; })
  .finally(() => db.close());
