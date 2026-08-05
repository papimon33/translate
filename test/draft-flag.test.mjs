/* 진행 중(미확정) 발화 표시 회귀 — 흐린 글씨 → 확정 시 또렷하게.
   서버는 진행 중 카드를 liveSend 로 보내며 draft:true 를 얹고, 확정(commit→upsertItem→buildMsg)
   때는 이 필드를 아예 빼서 같은 id 를 다시 보낸다. 클라는 이 유무만 보고 색을 정한다.

   확정 메시지에 draft 가 남아 버리면 카드가 영영 흐린 채로 남으므로, '없음'을 단언하는 쪽이 핵심이다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, deskToken } from './helpers/boot.mjs';

function wsClient(url, headers) {
  const ws = new WebSocket(url, { headers });
  const messages = [];
  ws.on('message', (d) => { try { messages.push(JSON.parse(d.toString())); } catch {} });
  const ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, messages, ready, send: (o) => ws.send(JSON.stringify(o)) };
}

test('진행 중 발화는 draft:true, 확정되면 draft 없이 같은 id 로 다시 온다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: 'draft 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'draft 표시', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  const wsBase = srv.base.replace('http', 'ws');
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const tok = await deskToken(srv.base, cookie, sess.id);
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}&t=${tok}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '호스트 활성 신호' });

  viewer.send({ type: 'desk-start', lang: 'en' });
  const conn = await fake.nextConnection();
  await conn.waitConfig;

  // 1) 아직 확정 안 된 토큰(is_final:false) — 화면에는 떠야 하지만 흐리게
  conn.sendTokens([
    { text: 'Where is the ', is_final: false, language: 'en' },
    { text: '화장실이 ', is_final: false, translation_status: 'translation' },
  ]);
  await until(() => viewer.messages.some((m) => m.type === 'sentence' && m.draft === true), { desc: '진행 중 카드에 draft:true' });
  const live = viewer.messages.filter((m) => m.type === 'sentence' && m.draft === true).pop();
  assert.ok(live.id, '진행 중 카드에도 id 가 있어야 확정 시 같은 카드를 덮어쓸 수 있다');
  assert.ok(live.source, '진행 중 원문이 실려야 함');

  // 2) 확정 — 같은 id 로 draft 없이 다시 온다
  conn.sendTokens([
    { text: 'Where is the restroom?', is_final: true, language: 'en', confidence: 0.97 },
    { text: '화장실이 어디예요?', is_final: true, translation_status: 'translation' },
  ]);
  conn.end();
  await until(
    () => viewer.messages.some((m) => m.type === 'sentence' && m.id === live.id && m.draft === undefined && m.source === 'Where is the restroom?'),
    { desc: '확정 카드가 draft 없이 도착' },
  );

  // 확정 이후 그 카드에 draft 가 다시 붙는 일은 없어야 한다(붙으면 화면이 흐린 채로 굳는다)
  const idx = viewer.messages.findIndex((m) => m.type === 'sentence' && m.id === live.id && m.draft === undefined);
  const after = viewer.messages.slice(idx).filter((m) => m.type === 'sentence' && m.id === live.id);
  assert.ok(after.every((m) => m.draft === undefined), '확정 후 같은 카드에 draft 가 다시 실리면 안 됨');

  // 저장 기록에는 draft 가 남지 않는다(화면 상태이지 데이터가 아니다)
  const detail = await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json());
  const items = detail.items || [];
  assert.ok(items.length >= 1, '확정 발화가 저장돼야 함');
  assert.ok(items.every((it) => it.draft === undefined), '저장 item 에 draft 가 섞이면 안 됨');
});
