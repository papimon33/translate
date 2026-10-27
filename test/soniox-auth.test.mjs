/* Soniox 인증 방식 회귀 (가짜 엔진, 무과금).
   Soniox 는 start(config) 메시지의 api_key 를 2027-01-15 에 중단한다 → 연결(업그레이드) 요청의
   Authorization: Bearer <키> 헤더로 인증해야 한다. 서버가 Soniox 를 여는 네 곳을 모두 확인한다:
   ① 실시간 번역(runSoniox) ② 데스크 안내원 채널(connectSx) ③ 데스크 여객 채널(connectGuest)
   ④ 용어 설정 실검증(validateSonioxPair) */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait, deskToken } from './helpers/boot.mjs';

const KEY = 'test-soniox-key'; // helpers/boot.mjs 의 더미 SONIOX_API_KEY

function wsClient(url, headers) {
  const ws = new WebSocket(url, { headers });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  const ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, messages, ready, send: (o) => ws.send(JSON.stringify(o)) };
}

// 헤더로 키가 오고 config 에는 키가 없어야 한다
async function assertHeaderAuth(conn, where) {
  const config = await conn.waitConfig;
  assert.equal(conn.headers.authorization, `Bearer ${KEY}`, `${where}: Authorization 헤더로 키를 보내야 함`);
  assert.ok(!('api_key' in config), `${where}: config 에 api_key 가 없어야 함`);
  return config;
}

let fake, srv, cookie, wsBase;
test.before(async () => {
  fake = await startFakeSoniox();
  srv = await bootServer({ SONIOX_WS_URL: fake.url });
  cookie = await loginAdmin(srv.base);
  wsBase = srv.base.replace('http', 'ws');
});
test.after(async () => { await fake.close(); await srv.stop(); });

const post = (path, body) => fetch(srv.base + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
});

test('실시간 번역: Soniox 연결이 헤더 인증이고 config 에 키가 없다', { timeout: 30000 }, async () => {
  const sess = await post('/api/sessions', { title: 'auth live', pipeline: 'soniox', preset: 'live', inLang: 'en' }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=ko&in=en`, { Cookie: cookie });
  await host.ready;
  const config = await assertHeaderAuth(await fake.nextConnection(), '실시간 번역');
  assert.equal(config.model, 'stt-rt-v5', '나머지 config 는 그대로');
  host.ws.close();
  await wait(100);
});

test('데스크: 안내원 채널·여객 채널 모두 헤더 인증이고 config 에 키가 없다', { timeout: 30000 }, async () => {
  const reg = await fetch(`${srv.base}/api/desk-registry`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ desks: [{ name: '인증 데스크', floor: '1F', side: 'S' }] }),
  }).then((r) => r.json());
  assert.ok(reg.desks?.[0]?.id, '데스크 등록 실패: ' + JSON.stringify(reg));
  const sess = await post('/api/sessions', { title: 'auth desk', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const tok = await deskToken(srv.base, cookie, sess.id);
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '뷰어가 호스트 활성 신호 수신' });

  // 안내원 채널(connectSx): 손님이 언어 선택
  const before = fake.connections.length;
  viewer.send({ type: 'desk-start', lang: 'en' });
  await assertHeaderAuth(await fake.nextConnection(), '데스크 안내원 채널');

  // 여객 채널(connectGuest): 태블릿 마이크 on → 여객 엔진 연결 + 안내원 채널 단방향 재체결
  viewer.send({ type: 'desk-mic', on: true });
  await until(() => fake.connections.length >= before + 3, { desc: '여객 채널 + 안내원 재체결 연결' });
  const added = fake.connections.slice(before + 1);
  const configs = [];
  for (const c of added) configs.push(await assertHeaderAuth(c, '데스크 2채널'));
  assert.ok(
    configs.some((c) => c.translation?.target_language === 'ko' && JSON.stringify(c.language_hints) === '["en"]'),
    `여객 채널(en→ko) 연결이 있어야 함: ${JSON.stringify(configs.map((c) => [c.language_hints, c.translation]))}`,
  );

  viewer.ws.close();
  host.ws.close();
  await wait(100);
});

test('용어 설정 실검증: 언어쌍별 Soniox 연결이 헤더 인증이고 config 에 키가 없다', { timeout: 30000 }, async () => {
  const before = fake.connections.length;
  const r = await post('/api/terms-config/validate', {});
  assert.equal(r.status, 200, '실검증 요청 실패');
  const { results } = await r.json();
  assert.ok(results.length >= 1, '운영 언어쌍이 1개 이상이어야 함');
  const added = fake.connections.slice(before);
  assert.equal(added.length, results.length, '언어쌍마다 연결 1개');
  for (const c of added) await assertHeaderAuth(c, '용어 실검증');
});
