/* 모노 양방향(ko⇄ja)의 발화 언어 판정 회귀 (가짜 엔진, 무과금).
   2026-10-21 실측: 같은 목소리가 일본어 'スマートフォンで…'를 말하자 엔진이 처음 몇 응답 동안 한국어 '스마트폰…'으로
   비확정 토큰을 보냈다가 확정은 일본어로 냈다. 서버가 응답마다 비확정 토큰까지 다시 세서 한국어 표가 쌓였고,
   카드가 '한국어 발화'로 저장되며 번역 칸(ja)에 한국어 번역문이 들어갔다(화면·뷰어에서 방향이 뒤집힘).
   기대: 확정 번역 토큰의 source_language(엔진이 실제로 번역한 방향)와 확정 원문으로 판정 → lang=ja, 번역 칸=ko. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

test('양방향: 비확정 토큰의 초기 오판이 반복돼도 확정·번역 방향으로 발화 언어를 정한다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '견학', pipeline: 'soniox', preset: 'twoway', inLang: 'auto' }),
  }).then((r) => r.json());
  const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws/host?src=mic&session=${sess.id}&pipeline=soniox&sxMode=two&sxA=ko&sxB=ja`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const c = await fake.nextConnection();
  await c.waitConfig;

  // 엔진이 처음 여러 응답 동안 같은 비확정 토큰을 한국어로 다시 보냄(실제 응답 패턴: 비확정은 매번 재전송)
  for (let i = 0; i < 12; i++) c.sendTokens([{ text: '스마트폰', is_final: false, language: 'ko' }]);
  // 확정은 일본어, 번역은 ja→ko
  c.sendTokens([
    { text: 'スマートフォンでモバイルチェックインもできますか。', is_final: true, language: 'ja' },
    { text: '스마트폰으로 모바일 체크인도 할 수 있나요?', is_final: true, translation_status: 'translation', language: 'ko', source_language: 'ja' },
  ]);
  c.sendTokens([{ text: '<end>', is_final: true }]);

  const item = await until(async () => {
    const s = await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json());
    return (s.items || []).find((x) => /スマートフォン/.test(x.source || ''));
  }, { desc: '확정 카드' });
  assert.equal(item.lang, 'ja', '발화 언어는 일본어');
  assert.deepEqual(Object.keys(item.texts || {}), ['ko'], '번역 칸은 한국어');
  assert.match(item.texts.ko, /스마트폰으로/);
  ws.close();
});
