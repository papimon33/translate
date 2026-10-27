/* 인증 — 쿠키 토큰·비밀번호·현재 사용자·권한 가드·로그인 시도 제한·관리자 2FA 시크릿·뷰어(공개 QR) 토큰.
   라우트(로그인·2FA·본인 계정)는 routes/auth.js·routes/me.js, 앱 미들웨어(HTTPS·보안 헤더·CSRF)는 ./middleware.js. */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATA_DIR, ADMIN_ID, AUTH_SECRET, AUTH_COOKIE } from '../config.js';
import { users, profiles, readDataFile, writeDataFile, saveProfiles, saveUsers } from '../store/index.js';

/* ================================================================== */
/*  인증 (사용자 계정 + 관리자) — 호스트(데스크톱)만 보호               */
/*  관리자: 환경변수 ADMIN_ID/ADMIN_PASSWORD. 일반 사용자: 관리자가 생성.*/
/*  모바일 뷰어는 항상 공개: /ws/viewer, GET /api/sessions/:id, /api/qr  */
/* ================================================================== */
/* 부팅 시 1회(저장소 로드·마이그레이션 직후 — 구 server.js 와 같은 시점, index.js): 기본 비밀번호 경고 + 운영 게이트 */
export function authBootCheck() {
  if (!process.env.ADMIN_PASSWORD)
    console.warn('[auth] ADMIN_PASSWORD 미설정 — 기본값 "admin" 사용 중. 운영 전 반드시 설정하세요.');
  // 운영(production) 게이트: 기본 비밀번호·파생 시크릿은 쿠키 위조(관리자 탈취)로 직결되므로 기동을 중단한다.
  // (파생 시크릿은 비밀번호만 알면 오프라인에서 계산 가능 — 2FA 도 우회됨. SECURITY_GUIDE.md 참고)
  // 검증 환경 등에서 의도적으로 건너뛰려면 ALLOW_INSECURE=1.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_INSECURE !== '1') {
    if (!process.env.AUTH_SECRET) {
      console.error('\n[중단] 운영 환경에서 AUTH_SECRET 이 설정되지 않았습니다. `node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"` 로 생성해 환경변수로 설정하세요.\n');
      process.exit(1);
    }
    if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'admin') {
      console.error('\n[중단] 운영 환경에서 ADMIN_PASSWORD 가 기본값입니다. 강한 비밀번호로 설정하세요.\n');
      process.exit(1);
    }
  }
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET)
    console.warn('[auth] (운영) AUTH_SECRET 미설정 — ADMIN_PASSWORD 에서 파생됩니다. 비번 변경 시 전원 로그아웃되니 AUTH_SECRET 고정 권장.');
}

function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      // 깨진 %-인코딩(%zz 등) 쿠키 1개가 모든 API 를 500 으로 만들지 않게 — 파싱 실패는 미로그인 취급
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}
export function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim() === 'https';
}
export function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
export function makeUser({ id, username, password, role, perms }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id, username: username || id, salt, hash: hashPassword(password, salt),
    role: role || 'user', createdAt: Date.now(), usageMs: 0, perms: cleanPerms(perms),
  };
}

/* ---- 사용자별 기능 권한(2026-10-27) — 관리자는 항상 전부 가능 ----
   tts : 번역 음성 재생(읽은 글자 수만큼 비용) — 없으면 호스트 TTS·뷰어 듣기·음성 미리듣기를 서버가 막는다.
   desk: 안내데스크 운영(목록에 보이고 열기·시작) — 만들기·이름 변경·삭제는 권한과 무관하게 관리자만. */
export const PERM_KEYS = ['tts', 'desk'];
export function cleanPerms(p) {
  return Object.fromEntries(PERM_KEYS.map((k) => [k, !!(p && p[k] === true)]));
}
export function hasPerm(u, k) {
  return !!u && (u.role === 'admin' || !!(u.perms && u.perms[k]));
}
export const permsOf = (u) => Object.fromEntries(PERM_KEYS.map((k) => [k, hasPerm(u, k)]));
// 부팅 시 1회: 권한이 없던 기존 계정은 지금처럼 쓰도록 전부 켠다(새 계정은 기본 꺼짐)
export function migrateUserPerms() {
  let n = 0;
  for (const u of users) if (!u.perms) { u.perms = { tts: true, desk: true }; n++; }
  if (n) { saveUsers(); console.log(`[auth] 기존 계정 ${n}개에 권한(음성 재생·안내데스크) 부여`); }
}
export function verifyPassword(user, password) {
  if (!user || !user.salt) return false;
  const h = Buffer.from(hashPassword(password, user.salt), 'hex');
  const e = Buffer.from(user.hash, 'hex');
  return h.length === e.length && crypto.timingSafeEqual(h, e);
}
// 관리자는 env 기반 가상 사용자(저장 안 함).
export function findUser(id) {
  if (id === ADMIN_ID) return { id: ADMIN_ID, username: '관리자', role: 'admin' };
  return users.find((u) => u.id === id) || null;
}
/* ---- 로그인 토큰 + 로그인 자리(2026-10-27) ----
   계정당 PC 1대 + 폰 1대. 같은 종류에서 새로 로그인하면 이전 기기의 토큰은 무효(reason: replaced),
   비밀번호를 바꾸면 전부 무효(reason: password). 자리는 프로필(profiles[id].logins)에 둔다 — 관리자(가상 사용자)도 같다.
     logins[kind] = { jti, at, prev: { jti, reason } }   (prev = 마지막으로 끊긴 토큰 — 로그아웃 이유 안내용)
   토큰 형식: id.kind.jti.발급ms.hmac, 30일 후 만료. 구 형식(id.발급ms.hmac)은 검증 실패로 자연 로그아웃(1회 재로그인). */
const TOKEN_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const DEVICE_KINDS = ['pc', 'phone'];
export const deviceKind = (v) => (v === 'phone' ? 'phone' : 'pc');
const sign = (body) => crypto.createHmac('sha256', AUTH_SECRET).update(body).digest('hex');
export function authToken(id, kind, jti) {
  const ts = Date.now().toString(36);
  const body = `${encodeURIComponent(id)}.${kind}.${jti}.${ts}`;
  return `${body}.${sign(body)}`;
}
function parseToken(tok) {
  if (!tok) return null;
  const parts = tok.split('.'); // id 는 encodeURIComponent 라 '.' 이 남을 수 있어 뒤에서부터 4칸을 뗀다
  if (parts.length < 5) return null;
  const sig = parts.pop(), ts = parts.pop(), jti = parts.pop(), kind = parts.pop();
  const idEnc = parts.join('.');
  if (!DEVICE_KINDS.includes(kind) || !jti) return null;
  const issued = parseInt(ts, 36);
  if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_MAX_AGE_MS) return null;
  const expect = sign(`${idEnc}.${kind}.${jti}.${ts}`);
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  let id;
  try { id = decodeURIComponent(idEnc); } catch { return null; }
  return { id, kind, jti };
}
function loginsOf(id, create) {
  let p = profiles.get(id);
  if (!p) {
    if (!create) return null;
    p = { id, email: '', prefs: {} };
    profiles.set(id, p);
  }
  if (!p.logins) p.logins = {};
  return p.logins;
}
// 지금 그 종류로 로그인된 기기가 있나(30일 지난 자리는 빈 것으로 본다)
export function activeLogin(id, kind) {
  const s = (loginsOf(id) || {})[kind];
  return !!(s && s.jti && Date.now() - s.at < TOKEN_MAX_AGE_MS);
}
// 새 로그인 — 같은 종류의 이전 토큰은 무효가 된다. 새 jti 를 돌려준다.
export function openLogin(id, kind) {
  const logins = loginsOf(id, true);
  const cur = logins[kind];
  const jti = crypto.randomBytes(9).toString('base64url');
  const prev = cur && cur.jti ? { jti: cur.jti, reason: 'replaced' } : cur && cur.prev;
  logins[kind] = { jti, at: Date.now(), ...(prev ? { prev } : {}) };
  saveProfiles(id);
  return jti;
}
export function closeLogin(id, kind, jti) {
  const logins = loginsOf(id);
  const s = logins && logins[kind];
  if (!s || s.jti !== jti) return;
  logins[kind] = { jti: null, at: 0, prev: { jti, reason: 'logout' } };
  saveProfiles(id);
}
// 비밀번호 변경 등: 모든 기기 로그아웃
export function closeAllLogins(id, reason) {
  const logins = loginsOf(id, true);
  for (const k of DEVICE_KINDS) {
    const s = logins[k];
    if (s && s.jti) logins[k] = { jti: null, at: 0, prev: { jti: s.jti, reason } };
  }
  saveProfiles(id);
}
export function setAuthCookie(req, res, id, kind, remember = true) {
  const jti = openLogin(id, kind);
  const secure = isHttps(req) ? '; Secure' : '';
  // remember(자동 로그인) 시 30일 영속 쿠키, 아니면 세션 쿠키(브라우저 종료 시 해제)
  const persist = remember ? '; Max-Age=2592000' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken(id, kind, jti)}; HttpOnly; SameSite=Lax; Path=/${persist}${secure}`);
}
/* 요청의 로그인 상태 → { user, kind, jti } 또는 { user: null, reason }.
   reason: replaced(같은 종류의 다른 기기에서 로그인) | password(비밀번호 변경) — 화면이 로그인 창에 이유를 보여 준다.
   grace(token, reason): true 면 끊긴 토큰도 통과(번역 중인 호스트 연결의 재접속 — realtime/index.js). */
export function authFromReq(req, { grace } = {}) {
  const t = parseToken(getCookie(req, AUTH_COOKIE));
  if (!t) return { user: null };
  const user = findUser(t.id);
  if (!user) return { user: null };
  const s = (loginsOf(t.id) || {})[t.kind];
  if (s && s.jti === t.jti) return { user, kind: t.kind, jti: t.jti };
  const reason = s && s.prev && s.prev.jti === t.jti ? s.prev.reason : 'replaced';
  if (grace && grace(t, reason)) return { user, kind: t.kind, jti: t.jti, replaced: true };
  return { user: null, ...(reason !== 'logout' ? { reason } : {}) };
}
export function currentUser(req) {
  return authFromReq(req).user;
}
const unauthorized = (res, a) => res.status(401).json({ error: 'unauthorized', ...(a.reason ? { reason: a.reason } : {}) });
export function requireAuth(req, res, next) {
  const a = authFromReq(req);
  if (!a.user) return unauthorized(res, a);
  req.user = a.user;
  req.auth = a;
  next();
}
export function requireAdmin(req, res, next) {
  const a = authFromReq(req);
  if (!a.user) return unauthorized(res, a);
  if (a.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  req.user = a.user;
  req.auth = a;
  next();
}

/* ---- 본인 계정: 프로필(이메일·환경설정) + 정보 변경 + 탈퇴 ----
   응답의 user 형태는 /api/me·PATCH /api/me·로그인 공통: { id, username, role, perms, email, prefs }. */
export const PASSWORD_MIN_LEN = 4; // 비밀번호 최소 길이 — 본인 변경·관리자 생성/재설정 공통
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 단순 형식(x@y.z)만 — 실제 도달 여부는 검증하지 않음
// 계정 동기화 환경설정(폰 앱 옵션) 화이트리스트 — 키별 검증 함수: 통과 시 저장할 값, 실패 시 undefined.
// 정책: 모르는 키는 조용히 버린다(구/신 앱 버전 혼재 대비), 아는 키의 잘못된 값은 400(앱 버그를 드러냄),
//       null 은 해당 키 삭제(기본값으로 되돌리기). 나머지 키는 기존 값에 병합.
export const PREF_RULES = {
  sysLang: (v) => (['ko', 'en', 'ja'].includes(v) ? v : undefined),           // 시스템 UI 언어
  nativeLang: (v) => (typeof v === 'string' && /^[a-z]{2,3}$/.test(v) ? v : undefined), // 내 언어(ISO 코드)
  theme: (v) => (['light', 'dark', 'system'].includes(v) ? v : undefined),
  fontScale: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0.8 && v <= 1.6 ? Math.round(v * 20) / 20 : undefined), // 0.05 단위
  ttsGender: (v) => (['f', 'm'].includes(v) ? v : undefined),                 // TTS 음성 성별
};
export function publicUser(u) {
  const p = profiles.get(u.id);
  return { id: u.id, username: u.username, role: u.role, perms: permsOf(u), email: (p && p.email) || '', prefs: { ...((p && p.prefs) || {}) } };
}
export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/* ---- 관리자 2FA(TOTP, RFC 6238) ----
   Google Authenticator 등 표준 OTP 앱 호환. 시크릿은 env ADMIN_TOTP_SECRET(우선) 또는
   data/security.json(관리자 페이지에서 설정, DATA_KEY 설정 시 암호화 저장). */
const SECURITY_FILE = path.join(DATA_DIR, 'security.json');
export let securityCfg = { adminTotpSecret: '' };
// 부팅 시 1회(index.js — 구 server.js 와 같은 시점): data/security.json 로드
export function loadSecurityCfg() {
  try { if (fs.existsSync(SECURITY_FILE)) securityCfg = { ...securityCfg, ...JSON.parse(readDataFile(SECURITY_FILE)) }; } catch (e) { console.error('[2fa] security.json 로드 실패', e.message); }
}
export function saveSecurityCfg() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); writeDataFile(SECURITY_FILE, JSON.stringify(securityCfg, null, 2)); } catch (e) { console.error('[2fa] 저장 실패', e); } }
export const adminTotpSecret = () => process.env.ADMIN_TOTP_SECRET || securityCfg.adminTotpSecret || '';

// 로그인 무차별 대입 방어: (IP+ID) 조합당 15분 내 8회 실패 시 15분 잠금.
//  ── IP 단독으로 잠그면 공항 사내 NAT(직원 수십 명이 같은 공인 IP)에서 한 명의 오타가
//     전 직원을 잠그므로, 계정 ID 를 키에 포함해 실패한 그 계정만 잠기게 한다.
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAIL = 8;
export const loginFails = new Map(); // "ip|id" -> { count, first, lockUntil }
export function loginIp(req) {
  return String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || 'ip').trim();
}
export function loginKey(req, id) {
  return loginIp(req) + '|' + String(id || '').trim().toLowerCase();
}

/* ---- 뷰어(공개 QR) 접근 토큰 --------------------------------------------
   세션 id 로부터 AUTH_SECRET 으로 파생하는 무상태 서명. QR/링크에 &t= 로 실어 보내고,
   서버가 재계산해 대조한다. 세션마다 고정이라 인쇄 QR 이 계속 유효(데스크 운영과 호환)이고,
   저장/마이그레이션이 필요 없다 — 기존 세션도 자동 적용. 목적: 세션 id 열거로 뷰어를 무단
   개설하는 자동화 접근 차단(자원 고갈형 DoS 는 뷰어 접속 상한이 별도로 막는다).
   로그인한 직원/관리자는 토큰 없이도 접근 가능(호스트 앱·관리자 화면 그대로 동작). */
export function viewerToken(sessionId) {
  return crypto.createHmac('sha256', AUTH_SECRET).update('viewer:' + String(sessionId)).digest('hex').slice(0, 16);
}
export function viewerTokenValid(sessionId, t) {
  if (!t) return false;
  const a = Buffer.from(String(t)); const b = Buffer.from(viewerToken(sessionId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// 공개 뷰어 라우트 게이트: 유효 토큰 또는 로그인 사용자만 통과. 안내데스크 세션은 로그인만으로는 안 되고 안내데스크 권한이 있어야 한다.
export function viewerAccessOk(req, sessionId, desk) {
  if (viewerTokenValid(sessionId, req.query && req.query.t)) return true;
  const u = currentUser(req);
  return !!u && (!desk || hasPerm(u, 'desk'));
}
