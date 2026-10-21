/* 양방향 통역의 채널 분리(스테레오 2채널·시스템+마이크) 회귀 (가짜 엔진, 무과금).
   채널마다 언어가 정해지면 엔진이 언어를 추측할 필요가 없다:
   · 내 채널(me): 단방향 ko→ja, 반대 채널 언어(ja)가 인식되면 샌 소리로 버린다
   · 상대 채널(them): 단방향 →ko, (스테레오면) 내 언어(ko)를 버린다
   · 같은 세션의 두 채널이 같은 문장을 8초 안에 확정하면 나중 것은 샌 소리(교차 중복)
   · 세션은 엔진이 단방향이어도 '양방향(ko,ja)'으로 표시돼야 뷰어가 내 언어 기준으로 정렬한다
   · 확정 항목에 발화 언어(lang)가 저장돼야 뷰어가 내 말/상대 말을 가른다 */
import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startFakeSoniox } from './helpers/fake-soniox.mjs';
import { bootServer, loginAdmin, until, wait } from './helpers/boot.mjs';

function host(url, cookie) {
  const ws = new WebSocket(url, { headers: { Cookie: cookie } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
  const ready = new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  return { ws, msgs, ready };
}

test('채널 분리: 반대 언어 버림 · 교차 중복 버림 · 세션은 양방향 표시 · 발화 언어 저장', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const sess = await fetch(`${srv.base}/api/sessions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: '견학 통역', pipeline: 'soniox', preset: 'twoway', inLang: 'auto' }),
  }).then((r) => r.json());
  assert.ok(sess.id);

  const wsBase = srv.base.replace('http', 'ws');
  const common = `session=${sess.id}&pipeline=soniox&sxA=ko&sxB=ja&pair=ko%2Cja`;
  const me = host(`${wsBase}/ws/host?src=mic&${common}&sxMode=one&sxTarget=ja&in=ko&role=me&drop=ja`, cookie);
  await me.ready;
  const cMe = await fake.nextConnection();
  const cfgMe = await cMe.waitConfig;
  // 상대 채널은 '버릴 언어' 없이(시스템 소리처럼) 열어 교차 중복 필터를 따로 검증한다
  const them = host(`${wsBase}/ws/host?src=mic2&${common}&sxMode=one&sxTarget=ko&in=ja&role=them`, cookie);
  await them.ready;
  const cThem = await fake.nextConnection();
  const cfgThem = await cThem.waitConfig;

  assert.deepEqual(cfgMe.translation, { type: 'one_way', target_language: 'ja' }, '내 채널은 단방향 →ja');
  assert.deepEqual(cfgMe.language_hints, ['ko'], '내 채널 힌트는 내 언어만');
  assert.deepEqual(cfgThem.translation, { type: 'one_way', target_language: 'ko' }, '상대 채널은 단방향 →ko');

  // 1) 내 채널에 일본어(상대 목소리가 핀마이크로 샘) → 버림
  cMe.sendTokens([{ text: 'すみません、質問があります。', is_final: true, language: 'ja' }]);
  cMe.end();
  // 2) 상대 채널의 일본어 질문 → 한국어 번역으로 확정, 왼쪽, lang=ja
  cThem.sendTokens([
    { text: 'この工場は何年に建てられましたか。', is_final: true, language: 'ja' },
    { text: '이 공장은 몇 년에 지어졌나요?', is_final: true, translation_status: 'translation' },
  ]);
  cThem.end();
  // 3) 내 채널의 한국어 답변 → 일본어 번역, 오른쪽, lang=ko
  cMe.sendTokens([
    { text: '이 공장은 천구백구십오년에 지어졌습니다.', is_final: true, language: 'ko' },
    { text: 'この工場は1995年に建てられました。', is_final: true, translation_status: 'translation' },
  ]);
  cMe.end();
  // 4) 같은 한국어 답변이 상대 채널에도 새어 들어옴(버릴 언어 없음) → 교차 중복으로 버림
  await wait(300);
  cThem.sendTokens([{ text: '이 공장은 천구백구십오년에 지어졌습니다.', is_final: true, language: 'ko' }]);
  cThem.end();

  const items = async () => (await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json())).items || [];
  await until(async () => (await items()).length >= 2, { desc: '두 발화 확정' });
  await wait(600);
  const list = await items();
  assert.equal(list.length, 2, `샌 소리 2건(일본어 1, 교차 중복 1)은 버려져야 함: ${JSON.stringify(list.map((i) => i.source))}`);
  const q = list.find((i) => i.lang === 'ja');
  const a = list.find((i) => i.lang === 'ko');
  assert.ok(q && a, '발화 언어(lang)가 저장돼야 함');
  assert.equal(q.side, 'left', '상대 채널 발화는 왼쪽');
  assert.equal(q.texts.ko, '이 공장은 몇 년에 지어졌나요?');
  assert.equal(a.side, 'right', '내 채널 발화는 오른쪽');
  assert.equal(a.texts.ja, 'この工場は1995年に建てられました。');
  assert.ok(!list.some((i) => /すみません/.test(i.source || '')), '내 채널의 일본어는 기록되면 안 됨');

  const s = await fetch(`${srv.base}/api/sessions/${sess.id}`, { headers: { Cookie: cookie } }).then((r) => r.json());
  assert.equal(s.sxInfo && s.sxInfo.mode, 'two', '세션은 양방향으로 표시');
  assert.equal(s.sxInfo.a, 'ko');
  assert.equal(s.sxInfo.b, 'ja');
});
