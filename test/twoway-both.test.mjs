/* 양방향 통역 + 소리 입력 'PC 소리 + 마이크'(화상회의) 회귀 — 가짜 엔진, 무과금.
   클라이언트는 소스마다 WS 를 하나씩 연다(system=상대 음성, mic=내 음성). 서버는 프리셋이 아니라
   WS 쿼리(sxMode·src)를 보고 두 채널 모두 two_way 설정을 엔진에 보내야 한다.
   서버가 프리셋 기준으로 방향을 클램프하게 바뀌면 이 조합이 조용히 단방향으로 떨어져
   상대 화면이 전부 한국어가 된다 — 그 회귀를 막는다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('양방향 통역(PC 소리 + 마이크): 시스템·마이크 두 채널 모두 two_way 로 붙는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', ...auth,
    body: JSON.stringify({ title: '화상회의', pipeline: 'soniox', preset: 'twoway', src: 'both', inLang: 'auto' }),
  }).then((r) => r.json());
  assert.equal(sess.preset, 'twoway');
  assert.equal(sess.src, 'both', '양방향 통역은 PC 소리 + 마이크 소스를 저장해야 함');

  const wsBase = srv.base.replace('http', 'ws');
  const q = 'sxMode=two&sxA=ko&sxB=ja';
  const sys = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=system&${q}`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { sys.once('open', res); sys.once('error', rej); });
  const cfgSys = await (await fake.nextConnection()).waitConfig;
  const mic = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&${q}`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { mic.once('open', res); mic.once('error', rej); });
  const cfgMic = await (await fake.nextConnection()).waitConfig;

  for (const [name, cfg] of [['system', cfgSys], ['mic', cfgMic]]) {
    assert.equal(cfg.translation?.type, 'two_way', `${name} 채널이 two_way 여야 함: ${JSON.stringify(cfg.translation)}`);
    assert.equal(cfg.translation.language_a, 'ko', `${name} 채널 language_a`);
    assert.equal(cfg.translation.language_b, 'ja', `${name} 채널 language_b`);
    assert.deepEqual([...cfg.language_hints].sort(), ['ja', 'ko'], `${name} 채널 힌트는 언어쌍으로 좁혀져야 함`);
  }
  try { sys.close(); mic.close(); } catch {}
});
