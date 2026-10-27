// 화면 테스트용 서버 — 가짜 Soniox + server.js(:3012), 격리된 DATA_DIR(운영 DB 절대 안 씀). playwright.config 의 webServer 가 띄운다.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startFakeSoniox } from '../helpers/fake-soniox.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-e2e-'));
const fake = await startFakeSoniox();
// 테스트가 가짜 엔진에 말을 넣는 창구(:3013) — POST /tok {tokens}, POST /end, GET /conns. 가장 최근 연결에 보낸다.
const open = () => fake.connections.filter((c) => !c.closed);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    const c = open().pop();
    if (req.url === '/conns') return res.end(JSON.stringify({ open: open().length, total: fake.connections.length, config: c ? c.config : null }));
    if (!c) { res.statusCode = 409; return res.end('no connection'); }
    if (req.url === '/tok') c.sendTokens(JSON.parse(body).tokens);
    else if (req.url === '/end') c.end();
    res.end('ok');
  });
}).listen(3013, '127.0.0.1');
const child = spawn(process.execPath, ['server.js'], {
  cwd: ROOT, stdio: 'inherit',
  env: { ...process.env, PORT: '3012', NODE_ENV: 'test', MONGODB_URI: '', DATA_DIR: dataDir, OPENAI_API_KEY: 'sk-dummy-test', SONIOX_API_KEY: 'test-soniox-key', SONIOX_WS_URL: fake.url, CARTESIA_API_KEY: '', DATA_KEY: '', ADMIN_ID: 'admin', ADMIN_PASSWORD: 'admin', ADMIN_TOTP_SECRET: '' },
});
const bye = () => { try { child.kill('SIGKILL'); } catch {} fs.rmSync(dataDir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
child.on('exit', () => process.exit(1));
