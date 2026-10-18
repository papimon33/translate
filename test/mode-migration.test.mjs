/* 실시간 번역 모드 개편(3종 → 2종) 회귀 — 가짜 엔진, 무과금.
   ① 부팅 시 기존 세션 이전: 구 프리셋이 같은 상황의 '모드 + 소리 입력'으로 바뀌고 디스크에 저장된다.
   ② 소리 입력 변경 규칙: 모드별로 유효한 두 값만, 번역 이력이 있어도 허용. 모드 변경 시 무효 소스는 마이크로.
   ③ 뷰어 발화(PTT) 폐지: 뷰어가 ptt 메시지·오디오를 보내도 유료 엔진이 열리지 않는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait, deskToken } from './helpers/boot.mjs';

const item = (id) => ({ id, side: 'right', source: '안녕하세요', texts: { ja: 'こんにちは' } });
const legacy = (id, preset, extra = {}) => ({ id, owner: 'admin', title: id, createdAt: 1, updatedAt: 1, pipeline: 'soniox', preset, langs: ['ko'], outLang: 'ko', inLang: 'auto', items: [], ...extra });

test('부팅 시 구 프리셋 세션이 실시간 번역/양방향 통역 + 소리 입력으로 이전된다', { timeout: 60000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-mig-'));
  const file = path.join(dir, 'sessions.json');
  fs.writeFileSync(file, JSON.stringify([
    legacy('s-live', 'live'),
    legacy('s-oneway', 'oneway'),                 // 구 'PC 음성 번역' — 소스가 PC 소리였다
    legacy('s-online', 'online'),
    legacy('s-twoway', 'twoway'),
    legacy('s-mobile', 'mobile'),
    legacy('s-meeting', 'meeting', { items: [item('a')] }),
    legacy('s-ok', 'twoway', { src: 'both' }),    // 이미 새 형식 — 그대로
    legacy('s-nopreset', undefined),              // 프리셋 없는 구세션 — 대상 아님
    { ...legacy('s-desk', undefined), pipeline: 'desk' },
  ]));
  const srv = await bootServer({ DATA_DIR: dir });
  t.after(async () => { await srv.stop(); });

  // 이전분은 디바운스(~400ms) 후 디스크에 기록된다
  let saved;
  await until(() => {
    try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return false; }
    return saved.find((s) => s.id === 's-live')?.src === 'mic';
  }, { desc: '이전 결과 저장' });
  const by = Object.fromEntries(saved.map((s) => [s.id, s]));
  const expect = {
    's-live': ['oneway', 'mic'], 's-oneway': ['oneway', 'system'], 's-online': ['oneway', 'system'],
    's-twoway': ['twoway', 'mic'], 's-mobile': ['twoway', 'mic'], 's-meeting': ['twoway', 'mic'], 's-ok': ['twoway', 'both'],
  };
  for (const [id, [p, src]] of Object.entries(expect)) {
    assert.deepEqual([by[id].preset, by[id].src], [p, src], `${id} 이전 결과`);
  }
  assert.equal(by['s-meeting'].items.length, 1, '이전이 대화 기록을 건드리면 안 됨');
  assert.equal(by['s-nopreset'].src, undefined, '프리셋 없는 세션은 대상이 아님');
  assert.equal(by['s-desk'].src, undefined, '데스크 세션은 대상이 아님');

  // 목록 응답에 src 가 실려야 호스트 화면이 소리 입력을 복원한다(목록에서 열 때 이 객체가 그대로 쓰인다)
  const cookie = await loginAdmin(srv.base);
  const list = await fetch(`${srv.base}/api/sessions`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const row = (Array.isArray(list) ? list : list.sessions || []).find((s) => s.id === 's-oneway');
  assert.equal(row?.src, 'system', '목록 응답에 src 포함: ' + JSON.stringify(row));
});

test('소리 입력 변경: 모드별 유효값만, 이력이 있어도 허용 / 모드 변경 시 무효 소스는 마이크로', { timeout: 60000 }, async (t) => {
  // 번역 이력이 있는 세션을 미리 심어 둔다 — 소스는 이력과 무관하게 바뀌어야 하고, 모드(방향)는 막혀야 한다
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'airtalk-src-'));
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify([legacy('s-hist', 'twoway', { src: 'mic', items: [item('a')] })]));
  const srv = await bootServer({ DATA_DIR: dir });
  t.after(async () => { await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const patch = (id, body) => fetch(`${srv.base}/api/sessions/${id}`, { method: 'PATCH', ...auth, body: JSON.stringify(body) }).then((r) => r.json());
  const get = (id) => fetch(`${srv.base}/api/sessions/${id}`, { headers: { Cookie: cookie } }).then((r) => r.json());

  // 신규 생성 기본 소스는 마이크, 구 프리셋 키가 와도 같은 상황으로 매핑
  const rt = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'rt', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  assert.deepEqual([rt.preset, rt.src], ['oneway', 'mic']);
  const old = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'old', pipeline: 'soniox', preset: 'live' }) }).then((r) => r.json());
  assert.deepEqual([old.preset, old.src], ['oneway', 'mic'], '구 키 live → 실시간 번역/마이크');

  await patch(rt.id, { src: 'system' });
  assert.equal((await get(rt.id)).src, 'system', '실시간 번역은 PC 소리 허용');
  await patch(rt.id, { src: 'both' });
  assert.equal((await get(rt.id)).src, 'system', '실시간 번역에 PC 소리+마이크는 무효 — 무시돼야 함');

  // 모드 변경: 양방향으로 바꾸면 PC 소리(단독)는 무효 → 마이크
  await patch(rt.id, { preset: 'twoway' });
  const bi = await get(rt.id);
  assert.deepEqual([bi.preset, bi.src], ['twoway', 'mic']);

  // 이력 있는 세션: 소스 변경은 허용, 모드(방향) 변경은 거부
  await patch('s-hist', { src: 'both' });
  assert.equal((await get('s-hist')).src, 'both', '이력이 있어도 소스는 바꿀 수 있어야 함');
  await patch('s-hist', { preset: 'oneway' });
  assert.equal((await get('s-hist')).preset, 'twoway', '이력이 있으면 모드(방향)는 바뀌면 안 됨');
});

test('뷰어 발화(PTT) 폐지: 뷰어가 ptt·오디오를 보내도 엔진이 열리지 않는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'ptt', pipeline: 'soniox', preset: 'twoway' }) }).then((r) => r.json());
  const detail = await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(detail.viewerPTT, undefined, '세션 응답에 뷰어 발화 플래그가 없어야 함');

  const tok = await deskToken(srv.base, cookie, sess.id); // /api/qr 경유 토큰(데스크 전용 아님 — 세션 공통)
  const wsBase = srv.base.replace('http', 'ws');
  const viewer = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  const msgs = [];
  viewer.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => { viewer.once('open', res); viewer.once('error', rej); });
  viewer.send(JSON.stringify({ type: 'ptt', on: true }));
  viewer.send(Buffer.alloc(4800)); // 오디오 프레임
  await wait(1200);
  assert.equal(fake.connections.length, 0, '뷰어 소켓이 유료 엔진을 열면 안 됨');
  assert.ok(!msgs.some((m) => m.type === 'ptt-state' || m.type === 'ptt-denied'), '발화 락 메시지가 더는 오지 않아야 함');
  viewer.close();
});
