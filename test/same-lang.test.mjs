/* 출력 언어로 말한 발화(한국어 회의를 한국어로 기록) 표시 회귀 (가짜 엔진, 무과금).
   Soniox one_way 는 이미 타깃 언어인 발화를 번역하지 않아 원문 토큰만 온다. 확정(commit)은 원래 원문으로
   폴백했지만, 진행 중 카드는 타깃이 비어 있어 화면이 '번역 중…'으로 흐리게 남았다.
   → 진행 중에도 원문을 타깃 칸에 싣는다. 다른 언어 발화는 번역이 올 때까지 비워 둬야 한다(원문을 번역처럼 보이면 안 됨). */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until } from './helpers/boot.mjs';

test('실시간 번역: 출력 언어로 말하면 진행 중에도 원문이 표시 문장, 다른 언어는 번역 대기', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', ...auth,
    body: JSON.stringify({ title: '한국어 기록', pipeline: 'soniox', preset: 'oneway', inLang: 'ko' }),
  }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  const wsBase = srv.base.replace('http', 'ws');
  const host = new WebSocket(`${wsBase}/ws/host?session=${sess.id}&src=mic&sxMode=one&sxTarget=ko&in=ko`, { headers: { Cookie: cookie } });
  const msgs = [];
  host.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
  await new Promise((res, rej) => { host.once('open', res); host.once('error', rej); });
  const conn = await fake.nextConnection();
  await conn.waitConfig;
  const sentences = () => msgs.filter((m) => m.type === 'sentence');

  // 1) 한국어(=출력 언어) 진행 중 — 번역 토큰이 없어도 타깃 칸에 원문
  conn.sendTokens([{ text: '오늘 회의 안건은', is_final: false, language: 'ko' }]);
  await until(() => sentences().some((m) => m.draft === true), { desc: '진행 중 카드' });
  const live = sentences().filter((m) => m.draft === true).pop();
  assert.equal(live.source, '오늘 회의 안건은');
  assert.equal(live.texts.ko, '오늘 회의 안건은', `같은 언어면 원문이 곧 표시 문장이어야 함: ${JSON.stringify(live.texts)}`);

  // 2) 확정 — 저장 기록도 원문 그대로
  conn.sendTokens([{ text: '오늘 회의 안건은 예산입니다.', is_final: true, language: 'ko', confidence: 0.96 }]);
  conn.end();
  await until(() => sentences().some((m) => m.id === live.id && m.draft === undefined), { desc: '확정 카드' });
  const done = sentences().filter((m) => m.id === live.id && m.draft === undefined).pop();
  assert.equal(done.texts.ko, '오늘 회의 안건은 예산입니다.');

  // 3) 다른 언어(영어) 진행 중 — 번역 전에는 타깃 칸을 비워 둔다(영어 원문을 한국어 칸에 넣으면 안 됨)
  const before = sentences().length;
  conn.sendTokens([{ text: 'Let me share my screen', is_final: false, language: 'en' }]);
  await until(() => sentences().length > before && sentences().slice(before).some((m) => m.draft === true), { desc: '영어 진행 중 카드' });
  const en = sentences().slice(before).filter((m) => m.draft === true).pop();
  assert.equal(en.source, 'Let me share my screen');
  assert.equal(en.texts.ko, '', `다른 언어는 번역 도착 전 비어 있어야 함: ${JSON.stringify(en.texts)}`);
});
