/* 일반 세션 삭제 = 대화 기록까지 완전 삭제(관리자 로그에도 남지 않음, 2026-10-22) + 호스트 화면용 뷰어 수.
   안내데스크 세션은 기존대로 소프트 삭제(응대 로그·통계는 관리자 페이지에서 따로 정리). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bootServer, loginAdmin, until, viewerToken } from './helpers/boot.mjs';

test('일반 세션 삭제는 관리자 로그에서도 사라지고, 뷰어 수는 실제 뷰어만 센다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '회의', pipeline: 'soniox', preset: 'twoway' }) }).then((r) => r.json());
  assert.ok(sess.id);

  // 뷰어 수: 처음 0 → QR 링크로 뷰어 1명 접속 → 1, 호스트 화면의 패시브 뷰어(role=host)는 세지 않음
  const count = () => fetch(`${srv.base}/api/sessions/${sess.id}/viewers`, auth).then((r) => r.json()).then((j) => j.n);
  assert.equal(await count(), 0);
  const tok = await viewerToken(srv.base, cookie, sess.id); // 참여 코드(/j/<코드>) → 토큰
  const wsBase = srv.base.replace('http', 'ws');
  const v = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await new Promise((res, rej) => { v.once('open', res); v.once('error', rej); });
  const hv = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&role=host`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { hv.once('open', res); hv.once('error', rej); });
  await until(async () => (await count()) === 1, { desc: '뷰어 1명' });
  v.close();
  await until(async () => (await count()) === 0, { desc: '뷰어 퇴장' });
  hv.close();

  // 삭제 → 관리자 로그 목록·전문 조회 모두에서 사라짐
  const del = await fetch(`${srv.base}/api/sessions/${sess.id}`, { method: 'DELETE', ...auth }).then((r) => r.json());
  assert.equal(del.ok, true);
  const logs = await fetch(`${srv.base}/api/admin/logs`, auth).then((r) => r.json());
  assert.ok(!logs.sessions.some((x) => x.id === sess.id), '관리자 로그 목록에 남지 않음');
  const one = await fetch(`${srv.base}/api/admin/logs/session/${sess.id}`, auth);
  assert.equal(one.status, 404, '대화 전문도 조회되지 않음');
});
