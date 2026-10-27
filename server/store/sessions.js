/* 세션 조회·id·부팅 마이그레이션·응대 기록(deskLog) 상한·참여 코드 — 세션 배열 자체는 store/index.js 소유 */
import crypto from 'crypto';
import { normalizeMode, DESKLOG_CAP } from '../config.js';
import { sessions, setSessions, col, saveSessions, deleteSessionStore } from './index.js';
import { metrics } from '../metrics.js';

export function getSession(id) {
  // 소프트 삭제된 세션은 일반 경로(목록·뷰어·WS·수정)에서 존재하지 않는 것으로 취급
  return sessions.find((s) => s.id === id && !s.deletedAt);
}
// 삭제된 세션 포함 조회 — 관리자 로그·통계 전용(세션을 지워도 대화 기록은 보존·열람)
export function getSessionAny(id) {
  return sessions.find((s) => s.id === id);
}
export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* 부팅 시 1회(용어 초기화 직후 — index.js): 소유자 없는 구 세션 정리 + 실시간 번역 모드 이전 */
export function migrateSessions() {
  // 소유자 없는 (구) 세션 정리 — 멀티유저 전환 시 1회.
  {
    const legacy = sessions.filter((s) => !s.owner);
    if (legacy.length) {
      setSessions(sessions.filter((s) => s.owner));
      legacy.forEach((s) => deleteSessionStore(s.id));
      if (!col) saveSessions();
      console.log(`[store] 소유자 없는 구 세션 ${legacy.length}개 삭제`);
    }
  }

  // 실시간 번역 모드 개편(3종 → 2종) 이전 — 부팅 시 1회, 바뀐 세션만 저장.
  // 구 'PC 음성 번역'(oneway)은 소스가 PC 소리였으므로 src 가 없으면 system 으로 채운다(신규 생성 기본값 mic 과 다름).
  {
    let moved = 0;
    for (const s of sessions) {
      if (s.pipeline !== 'soniox' || !s.preset) continue;
      const m = normalizeMode(s.preset, s.src, s.preset === 'oneway' ? 'system' : 'mic');
      if (m && (m.preset !== s.preset || m.src !== s.src)) { s.preset = m.preset; s.src = m.src; saveSessions(s.id); moved++; }
    }
    if (moved) console.log(`[store] 실시간 번역 모드 이전 ${moved}개 (live/oneway/twoway·구 프리셋 → 실시간 번역/양방향 통역 + 소스)`);
  }
}

/* deskLog(응대 기록) 보존 상한 — 넘치면 가장 오래된 응대부터 버리되, 관리자가 알 수 있게 기록을 남긴다.
   (지금까지는 조용히 잘려서 데이터가 사라진 사실 자체를 아무도 몰랐다)

   건수 상한과 별개로 **바이트 상한**을 함께 둔다: 데스크 세션은 deskLog 를 품은 문서 1개라
   Mongo 문서 한도(16MB)를 넘기면 replaceOne 이 통째로 실패한다 — 오래된 응대 몇 건이 잘리는 것과 달리
   그 데스크의 저장이 전부 멈춰 새 응대까지 사라진다. 잘림보다 훨씬 나쁜 실패라 먼저 막는다.
   item.toks(단어별 신뢰도)는 지우지 않는다 — tools/eval/conf-analyze.mjs 가 이걸 읽어 confFix 임계값 근거를
   뽑고, 공항 실소음·실억양의 신뢰도 분포는 시범 기간에만 얻을 수 있는 데이터다. */
const DESKLOG_MAX_BYTES = 8 * 1024 * 1024;
export function capDeskLog(session) {
  if (!Array.isArray(session.deskLog)) return;
  let dropped = 0;
  if (session.deskLog.length > DESKLOG_CAP) {
    dropped = session.deskLog.length - DESKLOG_CAP;
    session.deskLog = session.deskLog.slice(-DESKLOG_CAP);
  }
  let bytes = Buffer.byteLength(JSON.stringify(session.deskLog));
  while (bytes > DESKLOG_MAX_BYTES && session.deskLog.length > 1) {
    bytes -= Buffer.byteLength(JSON.stringify(session.deskLog.shift()));
    dropped++;
  }
  if (!dropped) return;
  const hit = metrics.deskLogFull.find((x) => x.id === session.id);
  if (hit) { hit.dropped += dropped; hit.at = Date.now(); }
  else metrics.deskLogFull.push({ id: session.id, title: session.title || '', dropped, at: Date.now() });
  if (metrics.deskLogFull.length > 30) metrics.deskLogFull.shift();
}

/* ---- 참여 코드(2026-10-27): 짧은 QR 주소 /j/K7Q2M9 · 안내데스크 /desk/K7Q2M9 ----
   세션마다 6자리(헷갈리는 0·O·1·I·L 제외 31자 → 약 8.9억 가지)를 한 번 만들어 세션에 저장한다(인쇄 QR 이 계속 유효).
   코드를 아는 것 = 뷰어 토큰을 가진 것과 같은 권한 — 페이지가 그 세션의 토큰을 받아 기존 경로(/ws/viewer?t=)로 접속한다.
   무작위 대입은 IP 당 틀린 코드 횟수로 막는다. */
const JOIN_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
function newJoinCode() {
  let c;
  do { c = Array.from(crypto.randomBytes(6), (b) => JOIN_ALPHABET[b % JOIN_ALPHABET.length]).join(''); }
  while (sessions.some((x) => x.joinCode === c));
  return c;
}
export function ensureJoinCode(s) {
  if (!s.joinCode) { s.joinCode = newJoinCode(); saveSessions(s.id); }
  return s.joinCode;
}
export function sessionByJoinCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[0-9A-Z]{6}$/.test(c)) return null;
  return sessions.find((x) => !x.deletedAt && x.joinCode === c) || null;
}
