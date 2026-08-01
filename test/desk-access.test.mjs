/* 데스크 뷰어 접근제어 회귀 — 공개 목록이 뷰어 토큰을 배포하면 안 된다.
   배포하면 인터넷에서 누구나 승객 대화를 실시간 수신하고 desk-end 로 응대를 종료할 수 있다.
   태블릿은 관리자만 열 수 있는 /api/qr 로 1회 프로비저닝한다(안내원 조작 0회). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { bootServer, loginAdmin, deskToken } from './helpers/boot.mjs';

test('데스크 공개 목록은 뷰어 토큰을 배포하지 않는다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(async () => { await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '접근제어 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '접근제어', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  // 목록은 계속 공개다(id·제목·가동 여부는 비밀이 아니다). 다만 토큰은 없어야 한다.
  const list = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const row = list.find((x) => x.id === sess.id);
  assert.ok(row, '데스크가 목록에 보여야 함');
  assert.equal(row.t, undefined, '공개 목록에 뷰어 토큰(t)이 실리면 안 됨');
  assert.equal(row.title, '접근제어', '제목은 계속 노출');

  // 로그인 없이는 QR(=토큰)도 못 받는다
  const anon = await fetch(`${srv.base}/api/qr?session=${sess.id}`);
  assert.equal(anon.status, 403, '무인증 QR 요청은 403 이어야 함');

  // 관리자는 받는다 — 이게 태블릿 프로비저닝 경로다
  const tok = await deskToken(srv.base, cookie, sess.id);
  assert.ok(tok.length >= 8, '관리자 QR 은 토큰을 포함해야 함');

  // 그 토큰으로는 뷰어 접속이 되고, 토큰 없이는 안 된다
  const wsBase = srv.base.replace('http', 'ws');
  const ok = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await new Promise((res, rej) => { ok.once('open', res); ok.once('error', rej); });
  ok.close();

  const bad = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}`);
  const err = await new Promise((res) => { bad.once('open', () => res(null)); bad.once('error', (e) => res(e)); });
  assert.ok(err, '토큰 없는 뷰어 접속은 거부돼야 함');
});
