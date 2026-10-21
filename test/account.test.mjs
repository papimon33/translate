/* 본인 계정 API 회귀 테스트 — 프로필(이메일·환경설정) 저장소 + GET/PATCH/DELETE /api/me.
   - 프로필은 users 와 분리된 저장소(profiles.json / Mongo profiles)라 관리자(env 가상 사용자)도 이메일·환경설정을 저장한다.
   - prefs 정책(server.js PREF_RULES): 모르는 키는 조용히 버리고, 아는 키의 잘못된 값은 400(아무것도 저장 안 함),
     null 은 해당 키 삭제. 이 테스트가 그 정책을 고정한다.
   - 비밀번호 변경은 currentPassword 필수, 탈퇴는 비밀번호 재확인 후 사용자·소유 세션·프로필·라이브 소켓까지 정리. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

async function call(base, method, p, cookie, body) {
  const r = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const setCookie = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [r.headers.get('set-cookie')].filter(Boolean);
  return { status: r.status, body: await r.json().catch(() => null), setCookie };
}
async function login(base, id, password) {
  const r = await call(base, 'POST', '/api/login', null, { id, password });
  if (r.status !== 200) return null;
  return r.setCookie.map((c) => String(c).split(';')[0]).join('; ');
}
async function createUser(base, adminCookie, id, password, username) {
  const r = await call(base, 'POST', '/api/admin/users', adminCookie, { id, username: username || id, password });
  assert.equal(r.status, 200, '사용자 생성 실패: ' + JSON.stringify(r.body));
  return login(base, id, password);
}
const readProfiles = (dataDir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'profiles.json'), 'utf8')); } catch { return null; }
};
const readSessions = (dataDir) => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'sessions.json'), 'utf8')); } catch { return null; }
};

test('GET/PATCH /api/me: 응답 형태 + 이메일 검증 + prefs 화이트리스트 + 관리자 제한 + 비밀번호 변경', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base } = srv;

  // 로그아웃 상태는 기존대로 { user: null }
  assert.deepEqual((await call(base, 'GET', '/api/me')).body, { user: null });

  // ---- 관리자(가상 사용자): 이메일·prefs 는 저장, username/password 는 거부 ----
  const admin = await loginAdmin(base);
  assert.deepEqual((await call(base, 'GET', '/api/me', admin)).body, {
    user: { id: 'admin', username: '관리자', role: 'admin', email: '', prefs: {} },
  });
  let r = await call(base, 'PATCH', '/api/me', admin, { email: 'ops@airport.kr', prefs: { theme: 'dark', sysLang: 'en' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.user, { id: 'admin', username: '관리자', role: 'admin', email: 'ops@airport.kr', prefs: { theme: 'dark', sysLang: 'en' } });
  r = await call(base, 'PATCH', '/api/me', admin, { username: '새이름' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '관리자 계정은 환경변수로 관리됩니다.');
  r = await call(base, 'PATCH', '/api/me', admin, { password: 'abcd', passwordConfirm: 'abcd', currentPassword: 'admin', email: 'x@y.zz' });
  assert.equal(r.status, 400);
  assert.equal((await call(base, 'GET', '/api/me', admin)).body.user.email, 'ops@airport.kr', '거부된 요청은 이메일도 바꾸지 않는다');

  // ---- 일반 사용자 ----
  const kim = await createUser(base, admin, 'kim', 'pw1234', '김직원');
  assert.ok(kim, '로그인 실패');
  r = await call(base, 'GET', '/api/me', kim);
  assert.deepEqual(r.body, { user: { id: 'kim', username: '김직원', role: 'user', email: '', prefs: {} } });

  // 이메일: trim 후 저장, 형식 오류·254자 초과는 400(기존 값 유지), '' 는 지움
  r = await call(base, 'PATCH', '/api/me', kim, { email: '  Kim@Example.com ' });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.email, 'Kim@Example.com');
  for (const bad of ['kim', 'kim@example', 'a b@c.de', '@c.de', 'x'.repeat(250) + '@y.zz', 42]) {
    r = await call(base, 'PATCH', '/api/me', kim, { email: bad });
    assert.equal(r.status, 400, `잘못된 이메일이 통과: ${bad}`);
    assert.equal(r.body.error, '이메일 형식이 올바르지 않습니다.');
  }
  assert.equal((await call(base, 'GET', '/api/me', kim)).body.user.email, 'Kim@Example.com');
  r = await call(base, 'PATCH', '/api/me', kim, { email: '' });
  assert.equal(r.body.user.email, '');

  // prefs: 화이트리스트 키만 저장(모르는 키는 버림), fontScale 은 0.05 단위 반올림
  r = await call(base, 'PATCH', '/api/me', kim, {
    prefs: { sysLang: 'ja', nativeLang: 'vi', theme: 'system', fontScale: 1.13, ttsGender: 'm', bogus: 1, isAdmin: true },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.user.prefs, { sysLang: 'ja', nativeLang: 'vi', theme: 'system', fontScale: 1.15, ttsGender: 'm' });
  // 부분 갱신은 병합
  r = await call(base, 'PATCH', '/api/me', kim, { prefs: { theme: 'light' } });
  assert.deepEqual(r.body.user.prefs, { sysLang: 'ja', nativeLang: 'vi', theme: 'light', fontScale: 1.15, ttsGender: 'm' });
  // 아는 키의 잘못된 값 → 400, 같은 요청의 다른 필드(email)도 저장하지 않는다
  const badPrefs = [
    { sysLang: 'zh' }, { nativeLang: 'EN' }, { nativeLang: 'kor1' }, { theme: 'blue' },
    { fontScale: 2 }, { fontScale: 0.5 }, { fontScale: '1.2' }, { ttsGender: 'x' },
  ];
  for (const prefs of badPrefs) {
    r = await call(base, 'PATCH', '/api/me', kim, { prefs, email: 'should@not.save' });
    assert.equal(r.status, 400, `잘못된 prefs 가 통과: ${JSON.stringify(prefs)}`);
    assert.match(r.body.error, /^환경설정 값이 올바르지 않습니다/);
  }
  for (const prefs of ['dark', [1], null]) {
    r = await call(base, 'PATCH', '/api/me', kim, { prefs });
    assert.equal(r.status, 400, `prefs 형식 오류가 통과: ${JSON.stringify(prefs)}`);
  }
  r = await call(base, 'GET', '/api/me', kim);
  assert.equal(r.body.user.email, '', '거부된 요청의 email 은 저장되지 않아야 함');
  assert.deepEqual(r.body.user.prefs, { sysLang: 'ja', nativeLang: 'vi', theme: 'light', fontScale: 1.15, ttsGender: 'm' });
  // null 은 키 삭제(기본값 복귀), 경계값 0.8/1.6 허용
  r = await call(base, 'PATCH', '/api/me', kim, { prefs: { ttsGender: null, fontScale: 1.6 } });
  assert.deepEqual(r.body.user.prefs, { sysLang: 'ja', nativeLang: 'vi', theme: 'light', fontScale: 1.6 });
  r = await call(base, 'PATCH', '/api/me', kim, { prefs: { fontScale: 0.8 } });
  assert.equal(r.body.user.prefs.fontScale, 0.8);

  // 사용자명 변경(기존 기능 유지)
  r = await call(base, 'PATCH', '/api/me', kim, { username: '  김주임 ' });
  assert.equal(r.body.user.username, '김주임');

  // ---- 비밀번호 변경: currentPassword 필수 ----
  r = await call(base, 'PATCH', '/api/me', kim, { password: 'newpw99', passwordConfirm: 'newpw99' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '현재 비밀번호가 올바르지 않습니다.');
  r = await call(base, 'PATCH', '/api/me', kim, { password: 'newpw99', passwordConfirm: 'newpw99', currentPassword: 'wrong' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '현재 비밀번호가 올바르지 않습니다.');
  r = await call(base, 'PATCH', '/api/me', kim, { password: 'newpw99', passwordConfirm: 'newpw98', currentPassword: 'pw1234' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '비밀번호가 일치하지 않습니다.');
  r = await call(base, 'PATCH', '/api/me', kim, { password: 'abc', passwordConfirm: 'abc', currentPassword: 'pw1234' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /4자 이상/);
  assert.ok(await login(base, 'kim', 'pw1234'), '실패한 변경 요청 뒤에도 기존 비밀번호는 유효');
  r = await call(base, 'PATCH', '/api/me', kim, { password: 'newpw99', passwordConfirm: 'newpw99', currentPassword: 'pw1234' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await login(base, 'kim', 'pw1234'), null, '옛 비밀번호는 거부');
  assert.ok(await login(base, 'kim', 'newpw99'), '새 비밀번호로 로그인');

  // 관리자 생성·재설정도 같은 최소 길이
  r = await call(base, 'POST', '/api/admin/users', admin, { id: 'short', password: 'abc' });
  assert.equal(r.status, 400);
  r = await call(base, 'POST', '/api/admin/users/kim/password', admin, { password: 'abc' });
  assert.equal(r.status, 400);
});

test('DELETE /api/me: 비밀번호 확인 → 사용자·세션·프로필·라이브 소켓 정리 + 쿠키 해제, 관리자 삭제도 프로필 정리', { timeout: 60000 }, async (t) => {
  const srv = await bootServer();
  t.after(() => srv.stop());
  const { base, dataDir } = srv;
  const admin = await loginAdmin(base);

  const lee = await createUser(base, admin, 'lee', 'leepw1');
  let r = await call(base, 'PATCH', '/api/me', lee, { email: 'lee@example.com', prefs: { theme: 'dark' } });
  assert.equal(r.status, 200);
  const sess = (await call(base, 'POST', '/api/sessions', lee, { title: '탈퇴 전 세션' })).body;
  assert.ok(sess.id, '세션 생성 실패');
  await until(() => readProfiles(dataDir)?.some((p) => p.id === 'lee'), { desc: 'lee 프로필 저장' });
  await until(() => readSessions(dataDir)?.some((s) => s.id === sess.id), { desc: '세션 저장' });

  // 소유 세션에 접속한 라이브 소켓(뷰어) — 탈퇴 시 끊겨야 한다(좀비 연결 방지)
  const wsBase = base.replace('http', 'ws');
  const viewer = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}`, { headers: { Cookie: lee } });
  const viewerMsgs = [];
  viewer.on('message', (d) => { try { viewerMsgs.push(JSON.parse(d.toString())); } catch {} });
  let viewerClosed = false;
  viewer.on('close', () => { viewerClosed = true; });
  await new Promise((res, rej) => { viewer.once('open', res); viewer.once('error', rej); });

  // 관리자는 탈퇴 불가
  r = await call(base, 'DELETE', '/api/me', admin, { password: 'admin' });
  assert.equal(r.status, 400);
  // 비밀번호 틀림/누락 → 400, 아무것도 지워지지 않음
  r = await call(base, 'DELETE', '/api/me', lee, { password: 'nope' });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, '비밀번호가 올바르지 않습니다.');
  r = await call(base, 'DELETE', '/api/me', lee);
  assert.equal(r.status, 400);
  assert.equal((await call(base, 'GET', '/api/me', lee)).body.user?.id, 'lee');
  assert.equal(viewerClosed, false);

  // 올바른 비밀번호 → 탈퇴
  r = await call(base, 'DELETE', '/api/me', lee, { password: 'leepw1' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  const cleared = r.setCookie.find((c) => c.startsWith('kac_auth='));
  assert.ok(cleared && /^kac_auth=;/.test(cleared) && /Max-Age=0/.test(cleared), '인증 쿠키 해제: ' + r.setCookie.join(' | '));

  // 사용자·세션·로그인 모두 사라짐
  assert.deepEqual((await call(base, 'GET', '/api/me', lee)).body, { user: null }, '옛 쿠키로는 더 이상 인증되지 않음');
  assert.equal(await login(base, 'lee', 'leepw1'), null);
  const list = (await call(base, 'GET', '/api/admin/users', admin)).body;
  assert.ok(!list.some((u) => u.id === 'lee'), '사용자 목록에서 제거');
  assert.equal((await call(base, 'GET', `/api/admin/logs/session/${sess.id}`, admin)).status, 404, '소유 세션 하드 삭제');
  await until(() => viewerClosed, { desc: '소유 세션의 라이브 소켓 종료' });
  assert.ok(viewerMsgs.some((m) => m.type === 'status' && /삭제/.test(m.message || '')), '종료 사유 안내');
  // 저장소(파일)에서도 제거
  await until(() => readProfiles(dataDir) && !readProfiles(dataDir).some((p) => p.id === 'lee'), { desc: 'profiles.json 에서 lee 제거' });
  await until(() => readSessions(dataDir) && !readSessions(dataDir).some((s) => s.id === sess.id), { desc: 'sessions.json 에서 세션 제거' });
  const usersFile = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf8'));
  assert.ok(!usersFile.some((u) => u.id === 'lee'), 'users.json 에서 제거');

  // 관리자 삭제 경로도 프로필을 지운다(공용 deleteUserAccount)
  const park = await createUser(base, admin, 'park', 'parkpw');
  r = await call(base, 'PATCH', '/api/me', park, { email: 'park@example.com' });
  assert.equal(r.status, 200);
  await until(() => readProfiles(dataDir)?.some((p) => p.id === 'park'), { desc: 'park 프로필 저장' });
  r = await call(base, 'DELETE', '/api/admin/users/park', admin);
  assert.equal(r.status, 200);
  await until(() => readProfiles(dataDir) && !readProfiles(dataDir).some((p) => p.id === 'park'), { desc: 'profiles.json 에서 park 제거' });
  // 같은 ID 로 다시 만들면 빈 프로필로 시작
  const park2 = await createUser(base, admin, 'park', 'parkpw');
  assert.deepEqual((await call(base, 'GET', '/api/me', park2)).body.user, { id: 'park', username: 'park', role: 'user', email: '', prefs: {} });
});

test('파일 모드: 프로필(관리자 포함)은 서버 재시작 후에도 유지된다', { timeout: 60000 }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-profile-'));
  let srv = await bootServer({ DATA_DIR: dataDir });
  t.after(() => (srv.child.exitCode == null && srv.child.signalCode == null ? srv.stop() : undefined));
  let admin = await loginAdmin(srv.base);
  let choi = await createUser(srv.base, admin, 'choi', 'choipw');
  await call(srv.base, 'PATCH', '/api/me', admin, { prefs: { fontScale: 1.25, sysLang: 'ko' } });
  await call(srv.base, 'PATCH', '/api/me', choi, { email: 'choi@example.com', prefs: { nativeLang: 'en', theme: 'dark', ttsGender: 'f' } });
  await until(() => {
    const p = readProfiles(dataDir);
    return p && p.some((x) => x.id === 'admin') && p.some((x) => x.id === 'choi' && x.prefs?.ttsGender === 'f');
  }, { desc: 'profiles.json 저장' });
  await srv.stop();

  srv = await bootServer({ DATA_DIR: dataDir });
  admin = await loginAdmin(srv.base);
  choi = await login(srv.base, 'choi', 'choipw');
  assert.deepEqual((await call(srv.base, 'GET', '/api/me', admin)).body.user, {
    id: 'admin', username: '관리자', role: 'admin', email: '', prefs: { fontScale: 1.25, sysLang: 'ko' },
  });
  assert.deepEqual((await call(srv.base, 'GET', '/api/me', choi)).body.user, {
    id: 'choi', username: 'choi', role: 'user', email: 'choi@example.com', prefs: { nativeLang: 'en', theme: 'dark', ttsGender: 'f' },
  });
});
