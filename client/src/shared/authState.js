/* 로그인 상태 공용(2026-10-27)
   - 권한: 서버가 내려준 user.perms(tts·desk) — 관리자는 서버가 전부 true 로 보낸다.
   - 로그아웃 알림: 같은 종류(PC·폰)의 다른 기기에서 로그인하거나 비밀번호가 바뀌면 서버가 401 + reason 을 준다.
     번역 중이면 바로 끊지 않고, 중지한 뒤에 로그인 화면으로 보낸다(무대 통역이 끊기지 않게). */
let perms = {};
export const setPerms = (p) => { perms = p || {}; };
export const can = (k) => !!perms[k];

let recording = false, pending = null, handler = null;
export function onAuthLost(fn) {
  handler = fn;
  return () => { if (handler === fn) handler = null; };
}
export function authLost(reason) {
  if (recording) { pending = reason; return; }
  if (handler) handler(reason);
}
export function setRecordingFlag(on) {
  recording = !!on;
  if (!recording && pending) { const r = pending; pending = null; if (handler) handler(r); }
}
