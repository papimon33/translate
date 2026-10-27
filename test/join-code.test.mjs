/* 참여 코드(2026-10-27): QR = 짧은 주소 /j/<코드>(안내데스크 /desk/<코드>), 코드로 뷰어 토큰을 받는다 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('참여 코드: 짧은 QR 주소 · 코드로 입장 · 같은 코드 유지 · 틀린 코드 제한', { timeout: 40000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const mk = (body) => fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify(body) }).then((r) => r.json());
  const qrOf = (id) => fetch(`${srv.base}/api/qr?session=${id}`, auth).then((r) => r.json());

  const s = await mk({ title: '견학', pipeline: 'soniox', preset: 'twoway' });
  const q1 = await qrOf(s.id);
  assert.match(q1.code, /^[2-9A-HJKMNP-Z]{6}$/, '6자리, 헷갈리는 글자(0 O 1 I L) 없음');
  assert.ok(q1.url.endsWith(`/j/${q1.code}`), 'QR 주소 = /j/<코드>');
  assert.equal((await qrOf(s.id)).code, q1.code, '한 번 만든 코드는 그대로(인쇄 QR 유지)');

  // 코드 → 세션·토큰(소문자로 쳐도 된다)
  const j = await fetch(`${srv.base}/api/join/${q1.code.toLowerCase()}`).then((r) => r.json());
  assert.equal(j.session, s.id);
  assert.ok(j.t && j.t.length >= 8);
  assert.equal(j.desk, false);

  // 안내데스크 세션은 /desk/<코드>, /j 로 열면 /desk 로 넘긴다(앱이 손님 태블릿 모드로 연다)
  const d = await mk({ title: '1층 데스크', pipeline: 'desk' });
  const qd = await qrOf(d.id);
  assert.ok(qd.url.endsWith(`/desk/${qd.code}`));
  const redir = await fetch(`${srv.base}/j/${qd.code}`, { redirect: 'manual' });
  assert.equal(redir.status, 302);
  assert.equal(redir.headers.get('location'), `/desk/${qd.code}`);

  // 지운 세션의 코드는 더 이상 열리지 않는다
  await fetch(`${srv.base}/api/sessions/${s.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
  assert.equal((await fetch(`${srv.base}/api/join/${q1.code}`)).status, 404);

  // 틀린 코드를 계속 넣으면 잠시 막힌다(무작위 대입 방지)
  let last = 0;
  for (let i = 0; i < 22; i++) last = (await fetch(`${srv.base}/api/join/ZZZZZ${'23456789ABCDEFGHJKMNPQRSTUVWXYZ'[i]}`)).status;
  assert.equal(last, 429);
});
