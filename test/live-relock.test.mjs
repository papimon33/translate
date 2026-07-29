/* 실시간 번역(soniox) 입력 언어 자동 감지 → 1회 재연결 회귀 테스트 (가짜 엔진, 무과금).
   auto 세션은 광역 힌트(L4)로 시작하는데, 그대로 두면 힌트가 흩어지고 context 가 커져
   용어집 뒤쪽이 잘린다(2026-07-29 세션: 번역쌍 전량 삭제 + 스페인어 첫 12발화 미번역).
   첫 확정 발화의 언어를 잠그고 [타깃, 감지언어] 로 좁혀 한 번만 재연결하는 동작을 검증. */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait } from './helpers/boot.mjs';

test('실시간 번역: auto 세션이 첫 발화 언어로 힌트를 좁혀 1회 재연결한다', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', ...auth,
    body: JSON.stringify({ title: 'relock', pipeline: 'soniox', preset: 'live', inLang: 'auto' }),
  }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  // 호스트 연결: 단방향(→ko), 입력 언어 미지정(auto)
  const wsBase = srv.base.replace('http', 'ws');
  const host = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=ko&in=auto`, { headers: { Cookie: cookie } });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });

  // 1차 연결: 입력 언어를 모르므로 광역 힌트
  const c1 = await fake.nextConnection();
  const cfg1 = await c1.waitConfig;
  assert.ok(cfg1.language_hints.length > 2, `1차는 광역 힌트여야 함: ${JSON.stringify(cfg1.language_hints)}`);
  assert.ok(cfg1.language_hints.includes('es'), `취항 언어(es)가 힌트에 있어야 함: ${JSON.stringify(cfg1.language_hints)}`);

  // 스페인어 발화 1건 확정 → 언어 잠금 + 재연결 유발
  c1.sendTokens([
    { text: '¿Dónde', is_final: true, language: 'es', confidence: 0.95 },
    { text: ' está el baño?', is_final: true, language: 'es', confidence: 0.95 },
    { text: '화장실은 어디예요?', is_final: true, translation_status: 'translation' },
  ]);
  c1.end();

  // 2차 연결: [타깃, 감지언어] 로 좁혀짐
  const c2 = await fake.nextConnection();
  const cfg2 = await c2.waitConfig;
  assert.deepEqual(cfg2.language_hints, ['ko', 'es'], `2차는 [ko, es] 로 좁혀야 함: ${JSON.stringify(cfg2.language_hints)}`);
  assert.equal(cfg2.translation.target_language, 'ko', '번역 타깃은 유지돼야 함');

  // 재감지는 1회만 — 좁힌 뒤 같은 언어 발화가 또 와도 재연결하지 않는다
  c2.sendTokens([
    { text: 'Gracias', is_final: true, language: 'es', confidence: 0.95 },
    { text: '감사합니다', is_final: true, translation_status: 'translation' },
  ]);
  c2.end();
  await wait(600);
  assert.equal(fake.connections.length, 2, `재연결은 1회여야 함(현재 ${fake.connections.length}개 연결)`);

  // 첫 발화도 기록에 남아야 한다(재연결 때문에 유실되면 안 됨)
  await until(async () => {
    const s = await fetch(`${srv.base}/api/admin/logs/session/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json());
    return (s.items || []).some((it) => String(it.source || '').includes('baño'));
  }, { desc: '감지 발화가 세션 기록에 보존' });

  host.close();
  await wait(100);
});
