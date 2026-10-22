/* 뷰어 연결 유지(2026-10-22): 서버 생존 신호(hb)로 뷰어가 '열린 채 죽은' 연결을 알아채게 하고,
   같은 공인 IP(견학 일행의 공용 와이파이)에서 9명 이상도 접속되게(상한 8 → 100). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('뷰어: 생존 신호가 주기적으로 오고, 같은 IP 에서 12명이 접속된다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer({ VIEWER_HB_MS: '400' });
  t.after(() => srv.stop());
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '견학', pipeline: 'soniox', preset: 'twoway' }) }).then((r) => r.json());
  const qr = await fetch(`${srv.base}/api/qr?session=${sess.id}`, auth).then((r) => r.json());
  const tok = new URL(qr.url).searchParams.get('t');
  const url = `${srv.base.replace('http', 'ws')}/ws/viewer?session=${sess.id}&t=${tok}`;

  const socks = [];
  t.after(() => socks.forEach((s) => { try { s.close(); } catch {} }));
  const refused = [];
  for (let i = 0; i < 12; i++) {
    const s = new WebSocket(url);
    socks.push(s);
    s.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'error') refused.push(m.code); });
    await new Promise((res, rej) => { s.once('open', res); s.once('error', rej); });
  }
  const hb = await new Promise((res) => socks[11].on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'hb') res(m); }));
  assert.equal(hb.type, 'hb', '생존 신호 수신');
  assert.deepEqual(refused, [], '같은 IP 12명 모두 접속(예전 상한 8이면 9번째부터 거부)');
  const n = await fetch(`${srv.base}/api/sessions/${sess.id}/viewers`, auth).then((r) => r.json()).then((j) => j.n);
  assert.equal(n, 12);
});
