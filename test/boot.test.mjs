/* 서버 부팅 스모크: 더미 키로 실제 기동 → /health 응답 확인 → 종료.
   (기존 placeholder 스모크는 서버가 뜨는지조차 보장하지 못했음) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3987;

test('서버가 기동되고 /health 가 응답한다', { timeout: 30000 }, async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, OPENAI_API_KEY: 'sk-dummy-boot-test', PORT: String(PORT), NODE_ENV: 'test', MONGODB_URI: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    let ok = false;
    for (let i = 0; i < 50; i++) { // 최대 ~10초 대기
      await new Promise((r) => setTimeout(r, 200));
      if (child.exitCode !== null) break;
      try {
        const r = await fetch(`http://127.0.0.1:${PORT}/health`);
        if (r.ok) { ok = true; break; }
      } catch {}
    }
    assert.equal(ok, true, '기동 실패 — 출력:\n' + out.slice(-1500));
  } finally {
    try { child.kill('SIGKILL'); } catch {}
  }
});
