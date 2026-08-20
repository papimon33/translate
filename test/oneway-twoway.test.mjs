/* PC 음성 번역(oneway 프리셋) + 양방향(two_way) 조합 회귀 — 화상회의 시나리오 (가짜 엔진, 무과금).
   시스템 채널(=Zoom 등 상대 음성)과 마이크 채널(=내 음성)이 각각 별도 호스트 WS 로 붙고,
   서버는 프리셋을 보지 않고 sxMode 만 보고 two_way 설정을 엔진에 보낸다.
   나중에 서버가 프리셋 기준으로 sxMode 를 클램프하면 이 조합이 조용히 단방향으로 떨어져
   상대 화면이 전부 한국어가 된다 — 그 회귀를 막는 테스트다. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('oneway 프리셋에서도 sxMode=two 면 시스템·마이크 두 채널 모두 two_way 로 붙는다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', ...auth,
    body: JSON.stringify({ title: '화상회의 양방향', pipeline: 'soniox', preset: 'oneway', inLang: 'auto' }),
  }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  // 클라이언트 'both' 모드와 동일하게 소스별 WS 2개(system=상대, mic=나) — 같은 sxMode/언어쌍
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
