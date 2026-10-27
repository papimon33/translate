import { WebSocket } from 'ws';
import { echoNorm, echoMatch } from '../util/security_util.js';

/* ================================================================== */
/*  실시간 방(room) : 세션ID 기준. 호스트(여러 소스) + 뷰어 N           */
/* ================================================================== */
// 뷰어(무인증 공개 QR) 접속 상한 — 세션 id 만 알면 소켓을 대량으로 열어 메모리(스냅샷 전송)·
// 발화 락을 잠식하는 DoS 를 막는다. 세션당 상한은 강의 청중(수백 명)을 수용할 만큼 넉넉히,
// IP당 상한은 한 단말의 남용을 좁게 막는다(정상 손님은 세션당 1~2개면 충분).
export const VIEWERS_PER_SESSION = 300;
export const VIEWERS_PER_IP = 100; // 견학 일행이 공용 와이파이(같은 공인 IP)로 들어와도 막히지 않게(8 → 100, 2026-10-22). QR 토큰·세션당 상한이 DoS 를 막는다
export const rooms = new Map(); // sessionId -> { viewers:Set<ws>, hosts:Set<ws> }
export const deskCtrl = new Map(); // sessionId -> { start(lang), end() } — 데스크: 뷰어(손님)의 통역 시작/종료를 호스트 파이프라인에 전달
export function getRoom(sessionId) {
  if (!rooms.has(sessionId)) rooms.set(sessionId, { viewers: new Set(), hosts: new Set() });
  return rooms.get(sessionId);
}
export function broadcast(sessionId, payload) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const v of room.viewers) {
    if (v.readyState === WebSocket.OPEN) v.send(msg);
  }
}
// 번역 음성은 '음성 듣기'를 켠(구독한) 뷰어에게만 전송 → 무료 티어 대역폭 절약
// lang: 이 음성의 언어. 뷰어가 '내 언어'를 지정해 구독하면(audioSub.lang) 그 언어 음성만 보낸다 —
// 양방향에서 한국인 뷰어가 설명자 말의 일본어 음성까지 듣지 않게. 미지정 뷰어·언어 없는 음성은 그대로.
export function broadcastAudio(sessionId, b64, lang) {
  const room = rooms.get(sessionId);
  if (!room) return;
  let msg = null;
  for (const v of room.viewers) {
    if (v._audioWanted && v.readyState === WebSocket.OPEN) {
      if (lang && v._audioLang && v._audioLang !== lang) continue;
      if (!msg) msg = JSON.stringify({ type: 'audio', b64, ...(lang ? { lang } : {}) });
      v.send(msg);
    }
  }
}
// 이 언어 음성을 들을 뷰어가 있는가('듣기' 켠 뷰어 — 내 언어를 정한 뷰어는 그 언어만)
export function hasAudioListener(sessionId, lang) {
  const room = rooms.get(sessionId);
  if (!room) return false;
  for (const v of room.viewers) {
    if (v._audioWanted && v.readyState === WebSocket.OPEN && !(lang && v._audioLang && v._audioLang !== lang)) return true;
  }
  return false;
}
// TTS 음성을 호스트로 — 뷰어(상대) 발화의 번역을 호스트가 듣게 함
export function sendAudioToHosts(sessionId, b64, lang) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify({ type: 'audio', b64, ...(lang ? { lang } : {}) });
  for (const h of room.hosts) {
    if (h.readyState === WebSocket.OPEN) h.send(msg);
  }
}

/* ---- TTS 자기음성(에코) 텍스트 필터 ----
   우리가 방금 합성해 내보낸 문장이 스피커→마이크(기기 간)·시스템 오디오 캡처(온라인 회의)로
   되돌아와 다시 인식되는 것을 텍스트 수준에서 차단. 브라우저 AEC 가 못 막는 경로의 안전망. */
const recentTts = new Map(); // sessionId -> [{ n(정규화), at }]
export function noteTts(sessionId, text) {
  const n = echoNorm(text);
  if (n.length < 4) return;
  const arr = recentTts.get(sessionId) || [];
  arr.push({ n, at: Date.now() });
  while (arr.length > 16) arr.shift();
  recentTts.set(sessionId, arr);
}
export function isSelfEcho(sessionId, text) {
  const n = echoNorm(text);
  if (n.length < 6) return false;
  const arr = recentTts.get(sessionId);
  if (!arr || !arr.length) return false;
  const now = Date.now();
  for (const e of arr) {
    if (now - e.at > 20000) continue;
    if (echoMatch(n, e.n)) return true;
  }
  return false;
}

// 삭제된 세션의 연결 소켓(호스트·뷰어)을 먼저 정리하고 방 상태를 지운다 — rooms 만 지우면 이미 접속한
// 소켓들이 고아 room 상태를 들고 좀비 스트리밍(비용)·발화 락 오염을 일으킨다. (세션 삭제·계정 삭제 공용)
export function closeSessionRoom(sid) {
  const r = rooms.get(sid);
  if (r) {
    for (const cx of [...r.hosts, ...r.viewers]) {
      try { cx.send(JSON.stringify({ type: 'status', message: '세션이 삭제되어 연결을 종료합니다.' })); } catch {}
      try { cx.close(); } catch {}
    }
  }
  rooms.delete(sid);
  recentTts.delete(sid);
  deskCtrl.delete(sid);
}

// 빈 room 정리: 마지막 연결이 떠나면 세션별 부속 상태도 회수(메모리 누수 방지)
export function maybeGcRoom(sessionId) {
  const r = rooms.get(sessionId);
  if (r && r.hosts.size === 0 && r.viewers.size === 0 && !r.guestFeeder) { // 여객 피더(PC 직결)만 남은 room 은 유지
    rooms.delete(sessionId);
    recentTts.delete(sessionId);
  }
}
