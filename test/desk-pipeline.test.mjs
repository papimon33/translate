/* 데스크 파이프라인 E2E — 가짜 Soniox 엔진(무과금) 기반 회귀 테스트.
   커버: 응대 시작 → 토큰 재생 → 카드 확정(기록) → ① 호스트 급이탈 시 응대 아카이브(C1 회귀)
        ② 뷰어 desk-start 난사 빈도 제한(C2 회귀) */
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

test('데스크: 응대 시작→발화 확정→호스트 급이탈 시 응대가 아카이브된다(C1) + start 난사 차단(C2)', { timeout: 60000 }, async (t) => {
  const fake = await startFakeSoniox();
  const srv = await bootServer({ SONIOX_WS_URL: fake.url });
  t.after(async () => { await fake.close(); await srv.stop(); });

  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };

  // 데스크 정의 등록 → 데스크 세션 생성
  const reg = await fetch(`${srv.base}/api/desk-registry`, { method: 'PUT', ...auth, body: JSON.stringify({ desks: [{ name: '테스트 데스크', floor: '1F', side: 'S' }] }) }).then((r) => r.json());
  assert.ok(reg.desks?.[0]?.id, '데스크 등록 실패: ' + JSON.stringify(reg));
  const sess = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'E2E 데스크', pipeline: 'desk', inLang: 'auto', deskId: reg.desks[0].id }) }).then((r) => r.json());
  assert.ok(sess.id, '세션 생성 실패: ' + JSON.stringify(sess));

  // 호스트(안내원 캡처) + 뷰어(손님 태블릿) 접속
  const wsBase = srv.base.replace('http', 'ws');
  const host = wsClient(`${wsBase}/ws/host?session=${sess.id}`, { Cookie: cookie });
  await host.ready;
  const viewer = wsClient(`${wsBase}/ws/viewer?session=${sess.id}`);
  await viewer.ready;
  await until(() => viewer.messages.some((m) => m.type === 'host' && m.active), { desc: '뷰어가 호스트 활성 신호 수신' });

  // 손님이 언어 선택 → 서버가 (가짜) Soniox 에 연결하고 config 를 보낸다
  viewer.send({ type: 'desk-start', lang: 'en' });
  const conn = await fake.nextConnection();
  const config = await conn.waitConfig;
  assert.equal(config.api_key, 'test-soniox-key', '엔진 config 에 서비스 키가 실려야 함');
  assert.ok(JSON.stringify(config).includes('en'), '통역 언어(en)가 config 에 반영돼야 함');

  // C2 회귀: 0.8초 안에 desk-start 를 다시 난사 → 빈도 제한으로 거부(안내 status)
  viewer.send({ type: 'desk-start', lang: 'ja' });
  await until(() => viewer.messages.some((m) => m.type === 'status' && /너무 잦습니다/.test(m.message || '')), { desc: '난사 거부 안내 수신' });
  assert.equal(fake.connections.length, 1, '난사가 막혀 엔진 재체결이 없어야 함');

  // 손님 발화 재생: 원문(en) + 번역(ko) + <end> → 카드 확정
  conn.sendTokens([
    { text: 'Where ', is_final: true, language: 'en', confidence: 0.98 },
    { text: 'is the restroom?', is_final: true, language: 'en', confidence: 0.97 },
    { text: '화장실이 어디예요?', is_final: true, translation_status: 'translation' },
  ]);
  conn.end();
  const sentence = await until(
    () => viewer.messages.find((m) => m.type === 'sentence' && String(m.source || '').includes('restroom')),
    { desc: '확정 카드(sentence) 수신' }
  );
  assert.equal(sentence.lang, 'en', '발화 원문 언어가 기록돼야 함(화자 색 구분 근거)');
  assert.ok((sentence.texts || {}).ko, '한국어 번역이 실려야 함');

  // C1 회귀: 응대 중(active) 호스트 급이탈(브라우저 종료와 동일) → 응대가 deskLog 로 아카이브되고 뷰어는 리셋
  host.ws.terminate();
  const logs = await until(async () => {
    const d = await fetch(`${srv.base}/api/admin/logs`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const desk = (d.desks || []).find((x) => x.id === sess.id);
    return desk && desk.logs.length >= 1 ? desk.logs : null;
  }, { desc: '호스트 이탈 후 응대 아카이브(deskLog)' });
  assert.equal(logs[0].lang, 'en', '아카이브에 손님 언어가 보존돼야 함');
  assert.ok(logs[0].count >= 1, '아카이브에 확정 문장이 포함돼야 함');
  await until(() => viewer.messages.some((m) => m.type === 'desk-reset'), { desc: '뷰어 리셋(대기 화면) 신호' });

  viewer.ws.close();
  await wait(100);
});
