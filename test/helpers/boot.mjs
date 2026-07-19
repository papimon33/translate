/* 테스트용 서버 부팅 헬퍼 — 임시 DATA_DIR(격리) + 더미 키 + 파일 모드로 실기동.
   SONIOX_WS_URL 등 env 오버라이드는 extraEnv 로 주입(가짜 엔진 연결). */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function bootServer(extraEnv = {}) {
  const dataDir = extraEnv.DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-test-'));
  // 파일별 병렬 실행(node --test) 시 포트 충돌을 피하기 위해 pid+난수 분산
  const port = 4100 + (process.pid % 900) + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'test',
      MONGODB_URI: '',
      DATA_DIR: dataDir,
      OPENAI_API_KEY: 'sk-dummy-test',
      SONIOX_API_KEY: 'test-soniox-key',
      CARTESIA_API_KEY: '',
      DATA_KEY: '',
      ADMIN_ID: 'admin',
      ADMIN_PASSWORD: 'admin',
      ADMIN_TOTP_SECRET: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) break;
    try {
      const r = await fetch(base + '/health');
      if (r.ok) {
        return {
          child, base, port, dataDir,
          log: () => out,
          stop: () => new Promise((res) => { child.once('exit', res); child.kill('SIGKILL'); }),
        };
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  try { child.kill('SIGKILL'); } catch {}
  throw new Error('서버 기동 실패:\n' + out.slice(-2000));
}

export async function loginAdmin(base) {
  const r = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'admin', password: 'admin' }),
  });
  if (!r.ok) throw new Error('관리자 로그인 실패: ' + r.status);
  const cookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((c) => String(c).split(';')[0]).join('; ');
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 조건이 참이 될 때까지 폴링(비동기 브로드캐스트·저장 디바운스 대기용) */
export async function until(fn, { timeout = 8000, step = 100, desc = '조건' } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const v = await fn();
    if (v) return v;
    await wait(step);
  }
  throw new Error(`시간 초과: ${desc}`);
}
