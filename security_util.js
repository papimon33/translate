/* 순수 보안/필터 유틸 — server.js 와 테스트(test/security.test.mjs)가 공유.
   부작용(파일·전역 상태) 없는 함수만 둔다. */
import crypto from 'crypto';

/* ---- Base32 (RFC 4648) — TOTP 시크릿 인코딩 ---- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
export function b32decode(str) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

/* ---- TOTP (RFC 6238, 30초 스텝·6자리·SHA-1) ---- */
export function totpCode(secretB32, step) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1000000).padStart(6, '0');
}
export function totpVerify(secretB32, code, nowMs = Date.now()) {
  if (!secretB32) return false;
  const c = String(code || '').replace(/\D/g, '');
  if (c.length !== 6) return false;
  const now = Math.floor(nowMs / 1000 / 30);
  for (const s of [now - 1, now, now + 1]) { // 시계 오차 ±30초 허용
    if (crypto.timingSafeEqual(Buffer.from(totpCode(secretB32, s)), Buffer.from(c))) return true;
  }
  return false;
}

/* ---- 저장 데이터 암호화(AES-256-GCM) ---- */
export function deriveDataKey(raw) {
  return crypto.scryptSync(String(raw), 'kac-data-v1', 32);
}
export function encryptData(key, jsonStr) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(jsonStr, 'utf8'), c.final()]);
  return JSON.stringify({ __enc: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: enc.toString('base64') });
}
// 평문이면 그대로, 암호문이면 복호화해 반환. 암호문인데 key 없으면 throw.
export function decryptData(key, raw) {
  let obj = null;
  try { obj = JSON.parse(raw); } catch { return raw; }
  if (obj && obj.__enc === 'aes-256-gcm') {
    if (!key) throw new Error('암호화된 데이터인데 DATA_KEY 가 설정되지 않았습니다.');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(obj.iv, 'base64'));
    d.setAuthTag(Buffer.from(obj.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(obj.data, 'base64')), d.final()]).toString('utf8');
  }
  return raw;
}

/* ---- TTS 자기음성(에코) 텍스트 매칭 ---- */
export const echoNorm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
// a, b = echoNorm 결과. 에코 = 거의 같은 문장이 되돌아온 경우이므로 길이가 비슷할 때만 매칭.
// (짧은 조각이 긴 문장에 포함되는 경우는 '상대 문구를 따라 말한 실제 발화'일 수 있어 매칭하지 않음 — 오탐 방지)
export function echoMatch(a, b) {
  if (a.length < 6 || b.length < 6) return false;
  const s = a.length <= b.length ? a : b;
  const l = a.length <= b.length ? b : a;
  if (s.length / l.length < 0.6) return false; // 길이 격차가 크면 에코로 보지 않음
  if (l.includes(s)) return true;
  if (s.length >= 10) {
    let same = 0;
    for (let i = 0; i < s.length; i++) if (s[i] === l[i]) same++;
    if (same / s.length >= 0.7) return true;
  }
  return false;
}
