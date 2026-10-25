/* TTS 는 듣는 사람이 있을 때만 합성(2026-10-25, 가짜 Soniox + 가짜 Cartesia, 무과금).
   예전엔 아무도 안 들어도 문장마다 합성해 줄이 밀리면 나중에 '듣기'를 켠 뷰어에게 이전 문장이 몰아서 나갔고 요금도 헛되이 나갔다.
   · 호스트 재생 끔 + 듣는 뷰어 없음 → Cartesia 요청 0
   · 뷰어가 '듣기'(audioSub)를 켠 뒤의 문장만 합성되어 그 뷰어에게 간다 */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait } from './helpers/boot.mjs';

function startFakeCartesia() {
  const wss = new WebSocketServer({ port: 0 });
  const requests = [];
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      requests.push(m);
      const pcm = Buffer.alloc(9600 * 2).toString('base64'); // 0.4초 무음
      ws.send(JSON.stringify({ type: 'chunk', context_id: m.context_id, data: pcm }));
      ws.send(JSON.stringify({ type: 'done', context_id: m.context_id }));
    });
  });
  // close: 서버가 열어 둔 상시 연결을 끊어야 wss.close 가 끝난다
  return new Promise((res) => wss.on('listening', () => res({ url: `ws://127.0.0.1:${wss.address().port}`, requests, close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }) })));
}

test('TTS: 듣는 사람이 없으면 합성하지 않고, 듣기를 켠 뒤 문장만 그 뷰어에게 간다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const cart = await startFakeCartesia();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url, CARTESIA_API_KEY: 'test-cartesia', CARTESIA_TTS_WS_URL: cart.url });
  t.after(async () => { await srv.stop(); await fake.close(); await cart.close(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '견학', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  const qr = await fetch(`${srv.base}/api/qr?session=${sess.id}`, auth).then((r) => r.json());
  const tok = new URL(qr.url).searchParams.get('t');
  const wsBase = srv.base.replace('http', 'ws');

  // 뷰어(아직 '듣기' 안 켬)
  const viewer = new WebSocket(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  const audio = [];
  viewer.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.type === 'audio') audio.push(m); });
  await new Promise((res, rej) => { viewer.once('open', res); viewer.once('error', rej); });

  // 호스트: TTS 켬, 이 기기 재생 끔(audioOut=0) — 단방향 →en
  const host = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&pipeline=soniox&sxMode=one&sxTarget=en&in=ko&tts=1&audioOut=0`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  const c = await fake.nextConnection();
  await c.waitConfig;

  const say = (ko, en) => { c.sendTokens([{ text: ko, is_final: true, language: 'ko' }, { text: en, is_final: true, translation_status: 'translation', language: 'en', source_language: 'ko' }]); c.sendTokens([{ text: '<end>', is_final: true }]); };

  // 세션 시작 시 짧은 예열 합성('Hi.' — 첫 음성 지연 단축)은 기존 동작이라 문장 합성만 센다
  const spoken = () => cart.requests.filter((r) => /Hello|Nice/.test(r.transcript || ''));
  // 1) 아무도 안 들음 → 합성 없음
  say('안녕하세요.', 'Hello.');
  await wait(800);
  assert.equal(spoken().length, 0, '듣는 사람이 없으면 문장 합성 0');

  // 2) 뷰어가 듣기를 켬 → 그 뒤 문장만 합성되어 전달
  viewer.send(JSON.stringify({ type: 'audioSub', on: true }));
  await wait(200);
  say('반갑습니다.', 'Nice to meet you.');
  await until(() => audio.length > 0, { desc: '뷰어가 음성 수신' });
  assert.equal(spoken().length, 1, '듣기를 켠 뒤 문장 1개만 합성');
  assert.match(spoken()[0].transcript, /Nice to meet you/);

  host.close();
  viewer.close();
});
