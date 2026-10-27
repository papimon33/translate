/* 데스크 엔진 재연결 상한 회귀 — 과금 폭주 방어(A2).
   엔진이 연결 즉시 끊는 장애를 재현하고, 서버가 무한 재시도하지 않는지 본다.
   재연결 1회마다 용어집 context 가 input_text_tokens 로 재청구되므로(데스크 약 $0.008/회)
   상한이 없으면 고정 800ms 재시도 = 4,500회/시간 = 데스크 1대당 시간 $36 이 나간다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait, deskToken } from './helpers/boot.mjs';

function wsClient(url, headers) {
  const ws = new WebSocket(url, { headers });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  const ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, messages, ready, send: (o) => ws.send(JSON.stringify(o)) };
}

test('데스크: 엔진이 연결 즉시 끊겨도 재연결이 8회에서 멈춘다(과금 폭주 방어)', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox({ autoClose: true }); // 붙는 족족 끊는 장애 엔진
  // 백오프 기준을 20ms 로 낮춰 8회 소진이 수 초 안에 끝나게 한다(운영 기본값은 800ms)
  const srv = await bootServer({ SONIOX_WS_URL: fake.url, SX_RETRY_BASE_MS: '20' });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };

  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '재시도 상한', pipeline: 'desk', inLang: 'auto' }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  const wsBase = srv.base.replace('http', 'ws');
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const tok = await deskToken(srv.base, cookie, sess.id);
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '뷰어가 호스트 활성 신호 수신' });

  viewer.send({ type: 'desk-start', lang: 'en' });

  // 상한 도달 시 호스트에게 명시적으로 알린다(조용히 멈추면 안내원이 원인을 알 수 없다)
  await until(() => host.messages.some((m) => m.type === 'status' && /자동 재연결을 멈췄/.test(m.message || '')),
    { desc: '재연결 포기 안내가 호스트에 도달' });
  // 손님 태블릿도 화면이 멈춘 이유를 알아야 한다
  assert.ok(viewer.messages.some((m) => m.type === 'desk-engine-down'), '뷰어에 엔진 중단 안내가 가야 함');

  const atCap = fake.connections.length;
  assert.equal(atCap, 8, `연결 시도가 상한(8)에서 멈춰야 함 — 실제 ${atCap}회`);

  // 상한 이후로는 더 붙지 않는다. 고정 800ms 무한 재시도였다면 이 대기 동안 계속 늘어난다.
  await wait(1500);
  assert.equal(fake.connections.length, atCap, `상한 후 재시도가 없어야 함 — ${fake.connections.length}회로 증가`);

  // 응대 자체는 강제 종료하지 않는다 — 유인 데스크에서 손님 앞 강제 종료보다 안내원 판단이 낫다
  assert.ok(!viewer.messages.some((m) => m.type === 'desk-reset'), '엔진 실패로 응대를 강제 종료하면 안 됨');
});
