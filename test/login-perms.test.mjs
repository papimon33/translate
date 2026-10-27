/* 로그인 자리(계정당 PC 1 + 폰 1)·사용자 권한(음성 재생·안내데스크) 회귀 테스트 (2026-10-27, 가짜 엔진·무과금).
   - 같은 종류에서 다시 로그인하면 확인(409 confirmReplace) → replace 로 들어가면 이전 기기는 401 reason=replaced.
   - 비밀번호를 바꾸면(본인·관리자 재설정) 다른 기기는 reason=password, 바꾼 기기는 새 쿠키로 계속.
   - 번역 중인 호스트 연결은 토큰이 끊겨도 같은 세션 재접속은 되고, 새 세션 시작은 막힌다.
   - 권한: 새 계정은 기본 꺼짐, 기존 계정은 부팅 시 켜짐. 안내데스크는 목록·열기·접속, TTS 는 미리듣기·뷰어 듣기 표시를 서버가 막는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

async function call(base, method, p, cookie, body) {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  return { status: r.status, body: await r.json().catch(() => null), cookie: setCookie.map((c) => String(c).split(';')[0]).join('; ') };
}
const login = (base, id, password, device, replace) => call(base, 'POST', '/api/login', null, { id, password, device, ...(replace ? { replace: true } : {}) });
// 호스트 연결 — 열리면 소켓, 거부되면 HTTP 상태 코드
function openHost(base, cookie, sessionId) {
  return new Promise((res) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/host?session=${sessionId}&src=mic&sxMode=one&sxTarget=en`, { headers: { Cookie: cookie } });
    ws.once('open', () => res(ws));
    ws.once('unexpected-response', (req, r) => res(r.statusCode));
    ws.once('error', () => res('error'));
  });
}

test('로그인 자리: 같은 종류는 확인 후 이전 기기 로그아웃, 다른 종류는 함께, 로그아웃하면 자리가 빈다', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base } = srv;
  const admin = await loginAdmin(base);
  assert.equal((await call(base, 'POST', '/api/admin/users', admin, { id: 'kim', password: 'kimpw1' })).status, 200);

  const pc1 = await login(base, 'kim', 'kimpw1', 'pc');
  assert.equal(pc1.status, 200);
  const phone = await login(base, 'kim', 'kimpw1', 'phone'); // 다른 종류 → 확인 없이 함께
  assert.equal(phone.status, 200);

  // 같은 종류(PC) 두 번째 → 확인 요청, 아무것도 바뀌지 않음
  const ask = await login(base, 'kim', 'kimpw1', 'pc');
  assert.equal(ask.status, 409);
  assert.equal(ask.body.confirmReplace, true);
  assert.equal(ask.cookie, '', '확인 전에는 쿠키를 주지 않는다');
  assert.equal((await call(base, 'GET', '/api/me', pc1.cookie)).body.user?.id, 'kim');

  // 확인 후 → 새 PC 로그인, 이전 PC 는 이유와 함께 로그아웃, 폰은 그대로
  const pc2 = await login(base, 'kim', 'kimpw1', 'pc', true);
  assert.equal(pc2.status, 200);
  assert.deepEqual((await call(base, 'GET', '/api/me', pc1.cookie)).body, { user: null, reason: 'replaced' });
  const lost = await call(base, 'GET', '/api/sessions', pc1.cookie);
  assert.equal(lost.status, 401);
  assert.equal(lost.body.reason, 'replaced');
  assert.equal((await call(base, 'GET', '/api/me', pc2.cookie)).body.user?.id, 'kim');
  assert.equal((await call(base, 'GET', '/api/me', phone.cookie)).body.user?.id, 'kim');

  // 로그아웃하면 자리가 비어 다음 로그인은 확인 없이
  await call(base, 'POST', '/api/logout', pc2.cookie);
  assert.deepEqual((await call(base, 'GET', '/api/me', pc2.cookie)).body, { user: null }, '스스로 로그아웃은 이유 안내 없음');
  assert.equal((await login(base, 'kim', 'kimpw1', 'pc')).status, 200);
});

test('비밀번호 변경: 본인 변경은 다른 기기만, 관리자 재설정은 모든 기기 로그아웃', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base } = srv;
  const admin = await loginAdmin(base);
  await call(base, 'POST', '/api/admin/users', admin, { id: 'lee', password: 'leepw1' });
  const pc = await login(base, 'lee', 'leepw1', 'pc');
  const phone = await login(base, 'lee', 'leepw1', 'phone');

  const r = await call(base, 'PATCH', '/api/me', pc.cookie, { password: 'leepw2', passwordConfirm: 'leepw2', currentPassword: 'leepw1' });
  assert.equal(r.status, 200);
  assert.ok(r.cookie.startsWith('kac_auth='), '바꾼 기기는 새 쿠키');
  assert.equal((await call(base, 'GET', '/api/me', r.cookie)).body.user?.id, 'lee');
  assert.deepEqual((await call(base, 'GET', '/api/me', phone.cookie)).body, { user: null, reason: 'password' });
  assert.equal((await login(base, 'lee', 'leepw2', 'phone')).status, 200, '폰 자리는 비어 확인 없이 다시 로그인');

  // 관리자 재설정 → 그 사용자의 모든 기기
  const phone2 = await login(base, 'lee', 'leepw2', 'phone', true);
  assert.equal((await call(base, 'POST', '/api/admin/users/lee/password', admin, { password: 'leepw3' })).status, 200);
  assert.equal((await call(base, 'GET', '/api/me', r.cookie)).body.reason, 'password');
  assert.equal((await call(base, 'GET', '/api/me', phone2.cookie)).body.reason, 'password');
});

test('번역 중 다른 기기 로그인: 진행 중인 세션 재접속은 되고, 새 번역 시작은 막힌다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const admin = await loginAdmin(base);
  await call(base, 'POST', '/api/admin/users', admin, { id: 'park', password: 'parkpw' });
  const pc1 = await login(base, 'park', 'parkpw', 'pc');
  const s1 = (await call(base, 'POST', '/api/sessions', pc1.cookie, { title: '진행 중', pipeline: 'soniox', preset: 'oneway' })).body;
  const s2 = (await call(base, 'POST', '/api/sessions', pc1.cookie, { title: '다른 세션', pipeline: 'soniox', preset: 'oneway' })).body;

  const host = await openHost(base, pc1.cookie, s1.id);
  assert.ok(host instanceof WebSocket, '번역 시작');
  await (await fake.nextConnection()).waitConfig;

  await login(base, 'park', 'parkpw', 'pc', true); // 다른 PC 에서 로그인
  assert.equal(host.readyState, WebSocket.OPEN, '진행 중인 번역은 끊지 않는다');

  const again = await openHost(base, pc1.cookie, s1.id); // 같은 세션 재접속(망 끊김 복구·2채널 두 번째 연결)
  assert.ok(again instanceof WebSocket, '같은 세션 재접속은 허용: ' + again);
  assert.equal(await openHost(base, pc1.cookie, s2.id), 401, '새 세션 시작은 거부');
  for (const w of [host, again]) w.close();
});

test('권한: 새 계정은 꺼짐, 안내데스크·음성 재생을 서버가 막고, 켜면 바로 쓸 수 있다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const { base } = srv;
  const admin = await loginAdmin(base);
  const created = await call(base, 'POST', '/api/admin/users', admin, { id: 'choi', password: 'choipw' });
  assert.deepEqual(created.body.perms, { tts: false, desk: false }, '새 계정 기본 꺼짐');
  const desk = (await call(base, 'POST', '/api/sessions', admin, { title: '1층 데스크', pipeline: 'desk', inLang: 'auto' })).body;
  const choi = (await login(base, 'choi', 'choipw', 'pc')).cookie;
  const mine = (await call(base, 'POST', '/api/sessions', choi, { title: '내 세션', pipeline: 'soniox', preset: 'oneway' })).body;

  assert.deepEqual((await call(base, 'GET', '/api/me', choi)).body.user.perms, { tts: false, desk: false });
  // 안내데스크: 목록·조회·현황·QR·호스트 접속 모두 막힘, 만들기는 관리자만
  assert.ok(!(await call(base, 'GET', '/api/sessions', choi)).body.some((s) => s.id === desk.id), '목록에서 숨김');
  assert.equal((await call(base, 'GET', `/api/sessions/${desk.id}`, choi)).status, 403);
  assert.deepEqual((await call(base, 'GET', '/api/desk-status', choi)).body, []);
  assert.equal((await call(base, 'GET', `/api/qr?session=${desk.id}`, choi)).status, 403);
  assert.equal(await openHost(base, choi, desk.id), 403);
  assert.equal((await call(base, 'POST', '/api/sessions', choi, { title: 'x', pipeline: 'desk' })).status, 403);
  // 음성 재생: 미리듣기 거부, 내 세션의 QR 뷰어에 듣기 버튼 없음(tts:false)
  assert.equal((await call(base, 'POST', '/api/tts/preview', choi, { lang: 'ko' })).status, 403);
  assert.equal((await call(base, 'GET', `/api/sessions/${mine.id}`, choi)).body.tts, false);

  // 관리자가 켠다 → 바로 반영
  assert.equal((await call(base, 'PUT', '/api/admin/users/choi/perms', admin, { tts: true, desk: true })).status, 200);
  assert.ok((await call(base, 'GET', '/api/sessions', choi)).body.some((s) => s.id === desk.id), '목록에 보임');
  assert.equal((await call(base, 'GET', `/api/sessions/${desk.id}`, choi)).status, 200);
  assert.equal((await call(base, 'GET', `/api/sessions/${mine.id}`, choi)).body.tts, true);
  const host = await openHost(base, choi, desk.id);
  assert.ok(host instanceof WebSocket, '안내데스크 운영 가능');
  host.close();
  assert.equal((await call(base, 'DELETE', `/api/sessions/${desk.id}`, choi)).status, 403, '삭제는 여전히 관리자만');
  const list = (await call(base, 'GET', '/api/admin/users', admin)).body;
  assert.deepEqual(list.find((u) => u.id === 'choi').perms, { tts: true, desk: true });
});

test('권한 이전: 권한 필드가 없던 기존 계정은 부팅 시 모두 켜진다', { timeout: 40000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-perms-'));
  // 기존 계정(perms 없음) — 비밀번호 해시는 makeUser 형식(scrypt)이 아니어도 목록·권한 확인엔 충분
  fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify([{ id: 'old', username: '기존 직원', role: 'user', createdAt: 1, usageMs: 0 }]));
  const srv = await bootServer({ DATA_DIR: dataDir });
  t.after(() => srv.stop());
  const admin = await loginAdmin(srv.base);
  const list = (await call(srv.base, 'GET', '/api/admin/users', admin)).body;
  assert.deepEqual(list.find((u) => u.id === 'old').perms, { tts: true, desk: true });
});
