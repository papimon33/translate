/* 안내데스크: 안내원 PC 이탈 → 복귀 시 태블릿이 조작 없이 정상 복구되는가.
   운영 전제 — 안내원은 PC 를 켜고 세션을 여는 것까지만 하고, 태블릿은 켠 채로 손대지 않는다.
   따라서 PC 가 닫히거나 새로고침돼도 태블릿은 그대로 두고 다음 손님을 받을 수 있어야 한다.

   두 가지 이탈 형태를 모두 본다.
   ① 급이탈 후 복귀: 구 호스트 소켓이 먼저 죽고, 나중에 새 호스트가 붙는다(절전·크래시).
   ② 승계(takeover): 새 호스트가 먼저 붙고, 구 소켓의 close 가 뒤늦게 도착한다(새로고침·랜 재연결).
      ②가 더 위험하다 — 구 소켓의 close 가 새 파이프라인을 정리해 버리면 복귀 직후 먹통이 된다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait } from './helpers/boot.mjs';

function wsClient(url, headers) {
  const ws = new WebSocket(url, { headers });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  const ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, messages, ready, send: (o) => ws.send(JSON.stringify(o)) };
}

/* 한 응대를 끝까지 돌린다: 손님이 언어 선택 → 엔진 토큰 재생 → 확정 카드가 뷰어에 도착 */
async function runConversation(fake, viewer, lang, srcText, tgtText) {
  const before = viewer.messages.length;
  viewer.send({ type: 'desk-start', lang });
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  conn.sendTokens([
    { text: srcText, is_final: true, language: lang, confidence: 0.97 },
    { text: tgtText, is_final: true, translation_status: 'translation' },
  ]);
  conn.end();
  await until(
    () => viewer.messages.slice(before).some((m) => m.type === 'sentence' && m.source === srcText),
    { desc: `확정 카드 수신(${lang}: ${srcText})` },
  );
  return conn;
}

test('안내데스크: 안내원 PC 급이탈 → 복귀 후 태블릿 조작 없이 다음 손님 응대가 된다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '복구 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '호스트 복구', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  const wsBase = srv.base.replace('http', 'ws');
  const dl = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const tok = dl.find((x) => x.id === sess.id)?.t;

  // 태블릿: 한 번 붙으면 끝까지 이 소켓을 유지한다(안내원이 손대지 않는다는 전제)
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;

  const host1 = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host1.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '호스트 활성 신호' });

  // 손님 1 — 정상 응대
  await runConversation(fake, viewer, 'en', 'Where is the gate?', '게이트가 어디예요?');

  // --- PC 가 닫힘: 호스트 소켓이 예고 없이 죽는다(close 프레임 없음) ---
  const n1 = viewer.messages.length;
  host1.ws.terminate();

  // 태블릿은 이유를 알아야 하고(호스트 비활성), 진행 중이던 화면은 대기로 돌아가야 한다
  await until(() => viewer.messages.slice(n1).some((m) => m.type === 'host' && m.active === false), { desc: '호스트 비활성 통지' });
  await until(() => viewer.messages.slice(n1).some((m) => m.type === 'desk-reset'), { desc: '뷰어 대기 화면 복귀' });

  // 응대 기록은 보존돼야 한다(손님 1의 발화가 사라지면 안 됨)
  const log1 = await fetch(`${srv.base}/api/admin/logs`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const desk1 = (log1.desks || []).find((d) => d.id === sess.id);
  assert.equal(desk1?.logs?.length, 1, '호스트 이탈 시 응대 1건이 아카이브돼야 함: ' + JSON.stringify(log1).slice(0, 300));
  assert.equal(desk1.logs[0].count, 1, '아카이브된 응대에 손님 1의 발화가 남아야 함');

  // 태블릿의 WS 는 살아 있어야 한다 — 죽었다면 손님이 새로고침을 해야 하고, 그건 무조작 운영이 아니다
  assert.equal(viewer.ws.readyState, WebSocket.OPEN, '호스트 이탈이 태블릿 소켓을 끊으면 안 됨');

  // --- PC 복귀: 안내원이 노트북을 열고 세션을 다시 연다 ---
  const n2 = viewer.messages.length;
  const host2 = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host2.ready;
  await until(() => viewer.messages.slice(n2).some((m) => m.type === 'host' && m.active), { desc: '복귀 후 호스트 활성 신호' });

  // 손님 2 — 태블릿을 손대지 않고 그대로 다음 응대가 돼야 한다
  await runConversation(fake, viewer, 'ja', 'トイレはどこですか', '화장실이 어디예요?');
  assert.equal(viewer.ws.readyState, WebSocket.OPEN, '복귀 후에도 태블릿 소켓 유지');

  // 두 손님의 대화가 한 기록에 섞이면 안 된다 — 복귀 후 응대는 별건으로 남아야 한다
  host2.ws.close();
  await until(async () => {
    const l = await fetch(`${srv.base}/api/admin/logs`, { headers: { Cookie: cookie } }).then((r) => r.json());
    return ((l.desks || []).find((d) => d.id === sess.id)?.logs || []).length === 2;
  }, { desc: '복귀 후 응대가 별도 기록으로 아카이브' });
  const log2 = await fetch(`${srv.base}/api/admin/logs`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const logs = (log2.desks || []).find((d) => d.id === sess.id).logs;
  // /api/admin/logs 는 관리자 화면용으로 최신순 정렬해 반환한다(server.js `.reverse()`)
  assert.deepEqual(logs.map((x) => x.lang), ['ja', 'en'], '손님별로 언어가 분리 기록돼야 함(최신순)');
  assert.deepEqual(logs.map((x) => x.count), [1, 1], '두 응대가 한 건으로 병합되면 안 됨');
});

test('안내데스크: 승계(새 호스트 먼저 접속) 후 구 소켓 close 가 새 응대를 망가뜨리지 않는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '승계 데스크', floor: '1F', side: 'N' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '승계', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());

  const wsBase = srv.base.replace('http', 'ws');
  const dl = await fetch(`${srv.base}/api/desk-sessions`).then((r) => r.json());
  const tok = dl.find((x) => x.id === sess.id)?.t;
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;

  const host1 = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host1.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '호스트1 활성' });
  await runConversation(fake, viewer, 'en', 'Thank you', '감사합니다');

  // 새 호스트가 먼저 붙는다(구 소켓은 아직 살아 있음) — 새로고침·랜 재연결의 실제 순서
  const host2 = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host2.ready;
  await wait(300); // 새 파이프라인이 deskCtrl 을 승계하도록

  // 그 다음에야 구 소켓이 죽는다 — 이 close 가 새 파이프라인을 정리해 버리면 여기서부터 먹통이 된다
  host1.ws.terminate();
  await wait(500);

  // 승계 후 새 응대가 정상 동작해야 한다
  await runConversation(fake, viewer, 'zh', '洗手间在哪里', '화장실이 어디예요?');
  assert.equal(viewer.ws.readyState, WebSocket.OPEN, '승계 후에도 태블릿 소켓 유지');
});
