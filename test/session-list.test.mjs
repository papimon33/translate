/* 세션 목록 API 의 언어 정보(2026-10-26) — 폰 목록 부제 '10/26 · 한국어 ⇄ 중국어' 용.
   · 만들 때 입력 언어(inLang)가 실리고, 번역을 한 번 열면 그 방향(sxInfo)이 실린다(가짜 Soniox, 무과금) */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

test('세션 목록: inLang 과 마지막 번역 방향(sxInfo)을 함께 준다', { timeout: 30000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await srv.stop(); await fake.close(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: '견학', pipeline: 'soniox', preset: 'twoway', inLang: 'auto' }) }).then((r) => r.json());
  const row = async () => (await fetch(`${srv.base}/api/sessions`, auth).then((r) => r.json())).find((s) => s.id === sess.id);

  const before = await row();
  assert.equal(before.inLang, 'auto');
  assert.equal(before.sxInfo, null, '번역을 열기 전엔 방향 정보 없음');

  const wsBase = srv.base.replace('http', 'ws');
  const host = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&pipeline=soniox&sxMode=two&sxA=ko&sxB=zh`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  const c = await fake.nextConnection();
  await c.waitConfig;

  await until(async () => !!(await row()).sxInfo, { desc: '목록에 sxInfo' });
  const after = await row();
  assert.equal(after.sxInfo.mode, 'two');
  assert.deepEqual([after.sxInfo.a, after.sxInfo.b], ['ko', 'zh']);
  host.close();
});
