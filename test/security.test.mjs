/* 보안·필터 유틸 단위 테스트 — npm test (node:test) */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { b32encode, b32decode, totpCode, totpVerify, deriveDataKey, encryptData, decryptData, echoNorm, echoMatch } from '../security_util.js';

test('base32 라운드트립', () => {
  for (const len of [1, 5, 16, 20, 33]) {
    const buf = crypto.randomBytes(len);
    assert.deepEqual(b32decode(b32encode(buf)), buf);
  }
});

test('TOTP: RFC 6238 검증 벡터(SHA-1, 8→6자리 절단 비교)', () => {
  // RFC 6238 테스트 키 "12345678901234567890" (base32: GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ)
  const secret = b32encode(Buffer.from('12345678901234567890'));
  // time=59s → step=1 → RFC 벡터 94287082 의 마지막 6자리 287082
  assert.equal(totpCode(secret, 1), '287082');
  // time=1111111109 → step=37037036 → 07081804 → 081804
  assert.equal(totpCode(secret, 37037036), '081804');
});

test('TOTP verify: 현재/±1스텝 허용, 그 외 거부', () => {
  const secret = b32encode(crypto.randomBytes(20));
  const now = Date.now();
  const step = Math.floor(now / 1000 / 30);
  assert.equal(totpVerify(secret, totpCode(secret, step), now), true);
  assert.equal(totpVerify(secret, totpCode(secret, step - 1), now), true);
  assert.equal(totpVerify(secret, totpCode(secret, step + 5), now), false);
  assert.equal(totpVerify(secret, 'abcdef', now), false);
  assert.equal(totpVerify('', '123456', now), false);
});

test('저장 암호화: 라운드트립 + 변조 감지 + 평문 통과', () => {
  const key = deriveDataKey('test-key');
  const plain = JSON.stringify({ hello: '안녕하세요', n: 42 });
  const enc = encryptData(key, plain);
  assert.notEqual(enc, plain);
  assert.equal(decryptData(key, enc), plain);
  // 평문은 그대로 통과(기존 데이터 하위호환)
  assert.equal(decryptData(key, plain), plain);
  assert.equal(decryptData(null, plain), plain);
  // 변조 감지(GCM 태그)
  const tampered = JSON.parse(enc);
  tampered.data = Buffer.from('00' + Buffer.from(tampered.data, 'base64').toString('hex').slice(2), 'hex').toString('base64');
  assert.throws(() => decryptData(key, JSON.stringify(tampered)));
  // 암호문인데 키 없음 → 오류
  assert.throws(() => decryptData(null, enc));
});

test('에코 필터: TTS 재입력 텍스트 매칭', () => {
  const n = echoNorm;
  // 동일 문장(문장부호·공백 차이) → 에코
  assert.equal(echoMatch(n('Hello, this is a test.'), n('hello this is a test')), true);
  // 길이가 비슷한 포함 관계(살짝 잘려 인식) → 에코
  assert.equal(echoMatch(n('this is a test sentence for'), n('Hello, this is a test sentence for you.')), true);
  // 짧은 조각이 긴 문장에 포함 — 상대 문구를 따라 말한 실제 발화일 수 있음 → 에코 아님(오탐 방지)
  assert.equal(echoMatch(n('gate three?'), n('Please go to gate three, it is on the second floor.')), false);
  // 앞부분 다수 일치(인식 왜곡) → 에코
  assert.equal(echoMatch(n('안내데스크는 이층에 있습니다 감사합니다'), n('안내데스크는 이층에 있습니다 감사합니당')), true);
  // 전혀 다른 문장 → 통과
  assert.equal(echoMatch(n('화장실이 어디예요'), n('오늘 날씨가 좋습니다')), false);
  // 너무 짧은 문장은 판단하지 않음(오탐 방지)
  assert.equal(echoMatch(n('네'), n('네')), false);
});
