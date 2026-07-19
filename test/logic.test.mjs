/* 파이프라인 순수 로직 회귀 테스트 — pipeline_util.js (무과금·즉시 실행)
   임계값 근거: PROJECT_NOTES 2026-07-14(5) confFix 확정안. 값 변경 시 이 테스트도 의도적으로 갱신할 것. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  kstDay, CONFFIX, confFixTrigger, confFixMark, isAckOnly, stripFillers, sanitizeTranslation, deskCtlAllowed,
} from '../pipeline_util.js';

/* ── confFix 트리거: 연속 2+ 저신뢰(<0.4) 또는 극단 단발(≤0.12), 실단어 ≥3, 저신뢰 비율 ≤70% ── */
test('confFixTrigger: 실단어 3개 미만이면 발동하지 않는다(인사·응답어 가드)', () => {
  assert.equal(confFixTrigger([['안녕', 0.1], ['하세요', 0.1]]), false);
  assert.equal(confFixTrigger([]), false);
  assert.equal(confFixTrigger(null), false);
});

test('confFixTrigger: 연속 2개 저신뢰(<0.4)면 발동한다', () => {
  assert.equal(confFixTrigger([['오늘', 0.9], ['가상', 0.35], ['공간', 0.38], ['입니다', 0.8]]), true);
});

test('confFixTrigger: 단발 저신뢰는 무시하되 극단값(≤0.12)이면 발동한다', () => {
  // 단발 0.2 — 어절 첫 음절·조사 등 구조적 저신뢰로 흔함 → 발동 X
  assert.equal(confFixTrigger([['오늘', 0.9], ['날씨', 0.2], ['좋네요', 0.95]]), false);
  // 단발이라도 0.12 이하 극단값 → 발동
  assert.equal(confFixTrigger([['오늘', 0.9], ['남씨', 0.1], ['좋네요', 0.95]]), true);
});

test('confFixTrigger: 저신뢰 비율 70% 초과(횡설수설·소음)면 발동하지 않는다', () => {
  assert.equal(confFixTrigger([['아', 0.2], ['어', 0.2], ['그', 0.2], ['음', 0.2]]), false);
});

test('confFixTrigger: 문장부호·confidence 없는 토큰은 실단어로 세지 않는다', () => {
  assert.equal(confFixTrigger([['.', 0.1], [',', 0.1], ['!', 0.1], ['오늘', 0.9], ['좋네요', 0.9]]), false);
});

test('confFixMark: 저신뢰(<0.55) 실단어만 «»로 마킹한다', () => {
  assert.equal(confFixMark([['오늘 ', 0.9], ['가상', 0.3], ['. ', 0.1], ['공간', 0.7]]), '오늘 «가상». 공간');
});

/* ── 단독 응답어(dropAcks) 판정 ── */
test('isAckOnly: 단독 응답어만 참(문장은 거짓)', () => {
  assert.equal(isAckOnly('네.'), true);
  assert.equal(isAckOnly('Yes'), true);
  assert.equal(isAckOnly('はい。'), true);
  assert.equal(isAckOnly('好的'), true);
  assert.equal(isAckOnly('네, 이쪽으로 오세요'), false);
  assert.equal(isAckOnly(''), false);
});

/* ── 간투사 제거 ── */
test('stripFillers: 문장 속 간투사(음/어/uh)를 제거하고 공백·구두점을 정리한다', () => {
  assert.equal(stripFillers('음 그러니까 어 화장실이요'), '그러니까 화장실이요');
  assert.equal(stripFillers('uh where is um the gate?'), 'Where is the gate?');
});

test('stripFillers: 발화 전체가 잡음이면 빈 문자열(카드 드롭), 단독 응답어는 보존', () => {
  assert.equal(stripFillers('あー'), '');
  assert.equal(stripFillers('yeah'), 'Yeah'); // 소프트 간투사 — 발화 전체면 실제 대답이므로 보존(첫 글자 복원 규칙 적용)
});

test('stripFillers: 간투사가 없는 문장은 그대로 둔다(한글 단어 속 음/어 오검출 금지)', () => {
  assert.equal(stripFillers('어제 음악회에 갔습니다'), '어제 음악회에 갔습니다');
});

/* ── GPT 번역 출력 정제 ── */
test('sanitizeTranslation: 코드블록·머리말·화살표·메타 주석을 벗겨낸다', () => {
  assert.equal(sanitizeTranslation('```\n안녕하세요\n```'), '안녕하세요');
  assert.equal(sanitizeTranslation('원문 → 번역된 문장'), '번역된 문장');
  assert.equal(sanitizeTranslation('번역하면 다음과 같습니다: 안녕하세요'), '안녕하세요');
  assert.equal(sanitizeTranslation('안녕하세요 (자연스럽게 번역)'), '안녕하세요');
  assert.equal(sanitizeTranslation(''), '');
});

/* ── 데스크 제어 남용 가드(C2 회귀): 소켓 20/분·세션 40/분·start/end 0.8초 간격 ── */
test('deskCtlAllowed: start/end 는 세션당 0.8초 간격, 마이크(micOnly)는 간격 제한이 없다', () => {
  const ws = {}, room = {};
  const t0 = 1_000_000;
  assert.equal(deskCtlAllowed(ws, room, false, t0), true);
  assert.equal(deskCtlAllowed(ws, room, false, t0 + 100), false); // 0.8초 미만 재시도 → 거부
  assert.equal(deskCtlAllowed(ws, room, true, t0 + 100), true);   // desk-mic 은 간격 제한 제외
  assert.equal(deskCtlAllowed(ws, room, false, t0 + 900), true);  // 간격 경과 → 허용
});

test('deskCtlAllowed: 소켓당 분당 20회 초과를 차단하고 60초 후 윈도가 리셋된다', () => {
  const ws = {};
  const t0 = 1_000_000;
  for (let i = 0; i < 20; i++) assert.equal(deskCtlAllowed(ws, null, true, t0 + i), true, `i=${i}`);
  assert.equal(deskCtlAllowed(ws, null, true, t0 + 30), false); // 21번째 → 거부
  assert.equal(deskCtlAllowed(ws, null, true, t0 + 61_000), true); // 윈도 리셋
});

test('deskCtlAllowed: 세션(room)당 분당 40회 상한 — 소켓을 갈아타도 막힌다', () => {
  const room = {};
  const t0 = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < 60; i++) {
    if (deskCtlAllowed({}, room, true, t0 + i)) allowed++; // 매번 새 소켓(공격 시나리오)
  }
  assert.equal(allowed, 40);
});

/* ── KST 일자 버킷 ── */
test('kstDay: UTC 자정 직전은 KST 로는 다음 날로 버킷된다', () => {
  // 2026-07-15T23:00:00Z = KST 2026-07-16 08:00
  assert.equal(kstDay(Date.parse('2026-07-15T23:00:00Z')), '2026-07-16');
  assert.equal(kstDay(Date.parse('2026-07-15T10:00:00Z')), '2026-07-15');
});
