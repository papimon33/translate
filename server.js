import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { detectCategory, isLocationAnswer, parseAnswerFloor } from './server/desk/wayfind_dict.js';
import { b32encode, totpVerify, echoNorm, echoMatch } from './server/util/security_util.js';
import { kstDay, CONFFIX, confFixReal, confFixTrigger, confFixMark, isAckOnly, stripFillers, deskCtlAllowed } from './server/util/pipeline_util.js';
import path from 'path';
import { Readable } from 'node:stream';
import { PORT, OPENAI_API_KEY, TRANSLATE_MODEL, REFINE_MODEL, TARGET_LANG, ITEMS_CAP, PRESET_SRC, normalizeMode, SX_MAX_FAILS, sxRetryDelay, DESKLOG_CAP, SONIOX_API_KEY, SONIOX_LANGS, CARTESIA_API_KEY, CARTESIA_VERSION, CARTESIA_MODEL, DESKTOP_REPO, GITHUB_TOKEN, DESKTOP_DOWNLOAD_URL, LANG_NAMES, ALL_LANGS, STATIC_DIR, DATA_DIR, PRICE_WHISPER_PER_MIN, PRICE_TRANSLATE_PER_MIN, ADMIN_ID, ADMIN_PASSWORD, AUTH_SECRET, AUTH_COOKIE, CARTESIA_ADMIN_API_KEY, OPENAI_ADMIN_API_KEY } from './server/config.js';
import { metrics, logErr } from './server/metrics.js';
import { dataKey, writeDataFile, readDataFile, sessions, users, usageDaily, usageHourly, vendorUsage, termsConfig, deskRegistry, profiles, col, profilesCol, setSessions, setTermsConfig, setDeskRegistry, loadStore, recordTts, persistDeskRegistry, dirtySessions, sessionsFlushInflight, saveSessions, flushSessions, deleteSessionStore, saveUsers, flushUsers, deleteUserStore, saveProfiles, deleteProfileStore, costOfDay, recordUsage, flushUsage, persistTermsConfig, addUsage } from './server/store/index.js';
import { TERM_LANGS, TERM_CATEGORIES, DEFAULT_SERVED_LANGS, sanitizeCatScope, normalizeTermsConfig, initTermsConfig } from './server/store/terms.js';
import { getSession, getSessionAny, newId, migrateSessions, capDeskLog, ensureJoinCode, sessionByJoinCode } from './server/store/sessions.js';
import { openSonioxWs, buildSonioxContextRaw, buildSonioxContext, validateSonioxPair, langJudge } from './server/vendors/soniox.js';
import { confFixTerms, confFixLLM, reasoningEffort, polishText, translateText, spacingPolish } from './server/vendors/openai.js';
import { cartesiaVoiceId, TTS_TEST_PHRASE, cartesiaTTSStream, cartesiaWarmup } from './server/vendors/cartesia.js';
import { vendorStatus, vendorRefreshAt, kickVendorRefresh } from './server/vendors/usage.js';
import { resolveCategoryDests, classifyFacility } from './server/desk/wayfind.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 등 프록시 뒤 — req.ip / x-forwarded-* 신뢰

// FORCE_HTTPS=1: http 접속을 https 로 301 리다이렉트(프록시 뒤에선 x-forwarded-proto 기준).
// Render 등 관리형 호스팅은 자체적으로 https 를 강제하므로 자가 호스팅에서만 필요.
if (process.env.FORCE_HTTPS === '1') {
  app.use((req, res, next) => {
    if (isHttps(req)) return next();
    // PUBLIC_HOST 가 설정돼 있으면 그 호스트로만 리다이렉트(스푸핑된 Host/X-Forwarded-Host 로 인한 오픈 리다이렉트 방지)
    const host = process.env.PUBLIC_HOST || String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    if (!host || /^(localhost|127\.)/.test(host)) return next(); // 로컬 개발은 예외
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  });
}

// 보안 헤더
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});
// CSRF 완화: /api 의 상태변경 요청은 동일 출처만 허용(쿠키 인증 보호)
app.use((req, res, next) => {
  if (req.path.startsWith('/api') && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE')) {
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    // Origin 이 없으면 Referer 로 폴백 검사(둘 다 없으면 브라우저 발 요청이 아니므로 통과 — curl 등 API 클라이언트)
    const src = req.headers.origin || req.headers.referer;
    if (src) {
      let oh = '';
      try { oh = new URL(src).host; } catch {}
      if (oh && oh !== host) return res.status(403).json({ error: 'cross-origin request blocked' });
    }
  }
  next();
});
// JSON 바디 한도 차등: 기본 256kb(무인증 엔드포인트 대용량 파싱 DoS 방지),
// 용어집 CSV 업로드(수천 행)가 오는 /api/terms-config 만 16mb 허용.
const bigJson = express.json({ limit: '16mb' });
const smallJson = express.json({ limit: '256kb' });
app.use((req, res, next) => (req.path === '/api/terms-config' ? bigJson : smallJson)(req, res, next));
// 빌드된 React 앱(dist) 서빙
if (!fs.existsSync(STATIC_DIR)) {
  console.warn('\n[경고] dist 폴더가 없습니다. 먼저 `npm run build` 를 실행하세요. (npm start 는 자동 빌드)\n');
}
app.use(express.static(STATIC_DIR));
// 2.5D 맵 라이브러리/데이터 — 데스크 뷰어 길안내용.
// 디렉터리 통째 서빙(express.static)은 인증 미들웨어보다 앞이라 제작용 도구 파일(test.html,
// _serve.py, original/*.html 등)까지 무인증 공개됐다 → 뷰어가 실제로 로드하는 2개만 노출한다.
for (const f of ['wayfinding_data.js', 'airport25d.js']) {
  app.get('/map/' + f, (req, res) => res.sendFile(new URL('./assets/map/' + f, import.meta.url).pathname));
}

// 데스크 뷰어 PWA manifest — '홈 화면에 추가'로 실행 시 항상 전체화면 유지. 시작 주소 = /desk/<참여 코드>
// (참여 코드가 곧 접근 권한이라 토큰을 주소에 싣지 않아도 재실행 후 바로 접속된다. 코드가 없거나 틀리면 /desk 랜딩)
app.get('/desk.webmanifest', (req, res) => {
  const s = sessionByJoinCode(req.query.code);
  const start = s && s.pipeline === 'desk' ? '/desk/' + s.joinCode : '/desk';
  res.type('application/manifest+json').json({
    name: 'KAC Desk', short_name: 'KAC Desk',
    display: 'fullscreen', display_override: ['fullscreen', 'standalone'],
    background_color: '#0b0e14', theme_color: '#0b0e14',
    start_url: start, scope: '/',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
});

const server = http.createServer(app);

await loadStore();
await initTermsConfig(); // 용어 시드·마이그레이션·기본 번역 병합(store/terms.js)

migrateSessions(); // 소유자 없는 구 세션 정리 + 실시간 번역 모드 이전(store/sessions.js)

/* ================================================================== */
/*  인증 (사용자 계정 + 관리자) — 호스트(데스크톱)만 보호               */
/*  관리자: 환경변수 ADMIN_ID/ADMIN_PASSWORD. 일반 사용자: 관리자가 생성.*/
/*  모바일 뷰어는 항상 공개: /ws/viewer, GET /api/sessions/:id, /api/qr  */
/* ================================================================== */
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
function isHttps(req) {
  return String(req.headers['x-forwarded-proto'] || req.protocol || '').split(',')[0].trim() === 'https';
}
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}
function makeUser({ id, username, password, role }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id, username: username || id, salt, hash: hashPassword(password, salt),
    role: role || 'user', createdAt: Date.now(), usageMs: 0,
  };
}
function verifyPassword(user, password) {
  if (!user || !user.salt) return false;
  const h = Buffer.from(hashPassword(password, user.salt), 'hex');
  const e = Buffer.from(user.hash, 'hex');
  return h.length === e.length && crypto.timingSafeEqual(h, e);
}
// 관리자는 env 기반 가상 사용자(저장 안 함).
function findUser(id) {
  if (id === ADMIN_ID) return { id: ADMIN_ID, username: '관리자', role: 'admin' };
  return users.find((u) => u.id === id) || null;
}
// 토큰에 발급 시각을 포함해 30일 후 만료(탈취 쿠키가 영구히 유효하던 문제 수정).
// 형식: id.발급ms.hmac — 구 형식(id.hmac)은 검증 실패로 자연 로그아웃(1회 재로그인).
const TOKEN_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
function authToken(id) {
  const ts = Date.now().toString(36);
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(`${id}.${ts}`).digest('hex');
  return `${encodeURIComponent(id)}.${ts}.${sig}`;
}
function userFromToken(tok) {
  if (!tok) return null;
  // 뒤에서부터 분해(id 에 '.' 이 포함될 수 있음): id.ts.sig
  const p1 = tok.lastIndexOf('.');
  const p2 = p1 > 0 ? tok.lastIndexOf('.', p1 - 1) : -1;
  if (p2 < 0) return null;
  const sig = tok.slice(p1 + 1);
  const ts = tok.slice(p2 + 1, p1);
  const id = decodeURIComponent(tok.slice(0, p2));
  const issued = parseInt(ts, 36);
  if (!Number.isFinite(issued) || Date.now() - issued > TOKEN_MAX_AGE_MS) return null;
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(`${id}.${ts}`).digest('hex');
  if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  return findUser(id);
}
function currentUser(req) {
  return userFromToken(getCookie(req, AUTH_COOKIE));
}
function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  req.user = u;
  next();
}
function requireAdmin(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'unauthorized' });
  if (u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  req.user = u;
  next();
}

/* ---- 본인 계정: 프로필(이메일·환경설정) + 정보 변경 + 탈퇴 ----
   응답의 user 형태는 /api/me·PATCH /api/me·로그인 공통: { id, username, role, email, prefs }. */
const PASSWORD_MIN_LEN = 4; // 비밀번호 최소 길이 — 본인 변경·관리자 생성/재설정 공통
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // 단순 형식(x@y.z)만 — 실제 도달 여부는 검증하지 않음
// 계정 동기화 환경설정(폰 앱 옵션) 화이트리스트 — 키별 검증 함수: 통과 시 저장할 값, 실패 시 undefined.
// 정책: 모르는 키는 조용히 버린다(구/신 앱 버전 혼재 대비), 아는 키의 잘못된 값은 400(앱 버그를 드러냄),
//       null 은 해당 키 삭제(기본값으로 되돌리기). 나머지 키는 기존 값에 병합.
const PREF_RULES = {
  sysLang: (v) => (['ko', 'en', 'ja'].includes(v) ? v : undefined),           // 시스템 UI 언어
  nativeLang: (v) => (typeof v === 'string' && /^[a-z]{2,3}$/.test(v) ? v : undefined), // 내 언어(ISO 코드)
  theme: (v) => (['light', 'dark', 'system'].includes(v) ? v : undefined),
  fontScale: (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0.8 && v <= 1.6 ? Math.round(v * 20) / 20 : undefined), // 0.05 단위
  ttsGender: (v) => (['f', 'm'].includes(v) ? v : undefined),                 // TTS 음성 성별
};
function publicUser(u) {
  const p = profiles.get(u.id);
  return { id: u.id, username: u.username, role: u.role, email: (p && p.email) || '', prefs: { ...((p && p.prefs) || {}) } };
}
function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? publicUser(u) : null });
});
// 본인 정보 변경(필드 모두 선택): email·prefs 는 관리자 포함 전원, username·password 는 일반 사용자만
// (관리자는 env 관리 — 해당 필드가 있을 때만 400 이라 관리자도 이메일·환경설정은 저장 가능).
// 비밀번호 변경은 currentPassword 확인 + password/passwordConfirm 일치 + 최소 길이.
// 모든 필드를 먼저 검증한 뒤 반영한다(일부만 저장되는 반쪽 변경 방지).
app.patch('/api/me', requireAuth, (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const isAdmin = req.user.role === 'admin';
  const wantName = typeof b.username === 'string' && !!b.username.trim();
  const wantPw = b.password != null && b.password !== '';
  if (isAdmin && (wantName || wantPw)) return res.status(400).json({ error: '관리자 계정은 환경변수로 관리됩니다.' });
  let stored = null;
  if (wantName || wantPw) {
    stored = users.find((x) => x.id === req.user.id);
    if (!stored) return res.status(404).json({ error: 'not found' });
  }
  if (wantPw) {
    const pw = String(b.password);
    if (pw !== b.passwordConfirm) return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
    if (pw.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
    if (!verifyPassword(stored, String(b.currentPassword || ''))) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
  }
  let email; // undefined = 변경 없음, '' = 지움
  if (b.email !== undefined) {
    if (b.email === null || b.email === '') email = '';
    else if (typeof b.email !== 'string') return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
    else {
      email = b.email.trim();
      if (email && (email.length > 254 || !EMAIL_RE.test(email))) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
    }
  }
  let prefPatch = null;
  if (b.prefs !== undefined) {
    if (!b.prefs || typeof b.prefs !== 'object' || Array.isArray(b.prefs)) return res.status(400).json({ error: '환경설정 형식이 올바르지 않습니다.' });
    prefPatch = {};
    for (const [k, rule] of Object.entries(PREF_RULES)) {
      if (!Object.prototype.hasOwnProperty.call(b.prefs, k)) continue;
      const v = b.prefs[k];
      if (v === null) { prefPatch[k] = null; continue; }
      const ok = rule(v);
      if (ok === undefined) return res.status(400).json({ error: `환경설정 값이 올바르지 않습니다: ${k}` });
      prefPatch[k] = ok;
    }
  }
  // ---- 반영 ----
  if (stored) {
    if (wantName) stored.username = b.username.trim();
    if (wantPw) {
      stored.salt = crypto.randomBytes(16).toString('hex');
      stored.hash = hashPassword(String(b.password), stored.salt);
    }
    saveUsers();
  }
  if (email !== undefined || prefPatch) {
    const id = req.user.id;
    const prev = profiles.get(id) || { id, email: '', prefs: {} };
    const prefs = { ...(prev.prefs || {}) };
    for (const [k, v] of Object.entries(prefPatch || {})) { if (v === null) delete prefs[k]; else prefs[k] = v; }
    profiles.set(id, { id, email: email !== undefined ? email : prev.email || '', prefs, updatedAt: Date.now() });
    saveProfiles(id);
  }
  res.json({ user: publicUser(stored || req.user) });
});
// 본인 탈퇴: 비밀번호 재확인 후 관리자 삭제와 동일하게 정리(deleteUserAccount) + 로그아웃. 관리자는 불가.
app.delete('/api/me', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
  const stored = users.find((x) => x.id === req.user.id);
  if (!stored) return res.status(404).json({ error: 'not found' });
  if (!verifyPassword(stored, String((req.body && req.body.password) || ''))) return res.status(400).json({ error: '비밀번호가 올바르지 않습니다.' });
  deleteUserAccount(stored.id);
  console.log(`[auth] 본인 탈퇴 user=${stored.id}`);
  clearAuthCookie(res);
  res.json({ ok: true });
});
process.on('uncaughtException', (e) => logErr('uncaught', e));
// 재배포·재시작(SIGTERM/SIGINT) 시 디바운스 저장분(세션 ~400ms·사용량 ~1s) 유실 방지 — flush 후 종료
let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig} — 미저장 변경 flush 후 종료`);
  try {
    for (const s of sessions) dirtySessions.add(s.id);
    await Promise.allSettled([flushSessions(), flushUsers(), flushUsage()]);
  } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', e));
app.get('/api/admin/health', requireAdmin, (req, res) => {
  const rms = [...rooms.values()];
  res.json({
    uptimeSec: Math.floor((Date.now() - metrics.startedAt) / 1000),
    memoryMB: Math.round(process.memoryUsage().rss / 1048576),
    node: process.version,
    sessions: sessions.length,
    liveHosts: rms.reduce((a, r) => a + r.hosts.size, 0),
    liveViewers: rms.reduce((a, r) => a + r.viewers.size, 0),
    dataEncrypted: !!dataKey,
    twoFaEnabled: !!adminTotpSecret(),
    forceHttps: process.env.FORCE_HTTPS === '1',
    saveFail: metrics.saveFail,           // 세션 저장(디스크·Mongo) 최근 실패 — null 이면 정상
    deskLogFull: metrics.deskLogFull.slice(-10).reverse(), // 응대 보존 상한 초과로 잘려 나간 기록
    deskLogCap: DESKLOG_CAP,
    recentErrors: metrics.errors.slice(-20).reverse(),
    clientErrors: metrics.clientErrors.slice(-20).reverse(),
  });
});
// 브라우저 오류 수집(window.onerror) — 관리자 시스템 상태에서 확인.
// 무인증 엔드포인트이므로 IP당 분당 10회로 제한(스팸·소음 방지).
const clientLogRate = new Map(); // ip -> { count, windowStart }
app.post('/api/client-log', (req, res) => {
  const ip = String(req.ip || 'ip');
  const now = Date.now();
  let rl = clientLogRate.get(ip);
  if (!rl || now - rl.windowStart > 60000) rl = { count: 0, windowStart: now };
  rl.count++;
  clientLogRate.set(ip, rl);
  if (clientLogRate.size > 2000) clientLogRate.clear(); // 상한(메모리 가드)
  if (rl.count > 10) return res.json({ ok: true }); // 조용히 무시
  const b = req.body || {};
  const e = { at: now, ua: String(req.headers['user-agent'] || '').slice(0, 80), msg: String(b.msg || '').slice(0, 300), src: String(b.src || '').slice(0, 120) };
  metrics.clientErrors.push(e);
  if (metrics.clientErrors.length > 100) metrics.clientErrors.shift();
  res.json({ ok: true });
});

/* ---- 관리자: 데스크 통계(응대 건수·언어 분포·평균 응대 시간·일별) — 대화 내용은 노출하지 않음 ---- */
/* 데스크 운영 통계 v2 — 시범운영 보고서용 상세 지표.
   응대(deskLog) 단위로 집계: 언어별 건수·평균시간, 일별·시간대 분포, 응대시간 중앙값,
   문장수(안내원/손님 비율), 누화 드랍율, 중단(interrupted) 응대, 길안내 감지→표시율,
   그리고 원자료 rows(응대 1건=1행) — CSV 내려받기·외부 분석용. */
app.get('/api/admin/desk-stats', requireAdmin, (req, res) => {
  const out = sessions.filter((s) => s.pipeline === 'desk').map((s) => {
    const log = Array.isArray(s.deskLog) ? s.deskLog : [];
    const langs = {};
    const byLang = {}; // lang -> { count, durSum, durN, sent }
    const daily = {};
    const hourly = Array(24).fill(0);
    const durs = [];
    let durSum = 0, durN = 0, interrupted = 0;
    let sentSum = 0, staffSent = 0, guestSent = 0, crossDrops = 0;
    const rows = [];
    for (const e of log) {
      const lang = e.lang || 'unknown';
      const sent = Array.isArray(e.items) ? e.items.length : 0;
      const dur = e.startedAt && e.endedAt ? e.endedAt - e.startedAt : null;
      langs[lang] = (langs[lang] || 0) + 1;
      const bl = byLang[lang] || (byLang[lang] = { count: 0, durSum: 0, durN: 0, sent: 0 });
      bl.count++; bl.sent += sent;
      if (dur != null) { durSum += dur; durN++; durs.push(dur); bl.durSum += dur; bl.durN++; }
      if (e.interrupted) interrupted++;
      sentSum += sent;
      if (e.stats) { staffSent += e.stats.staff || 0; guestSent += e.stats.guest || 0; crossDrops += e.stats.crossDrops || 0; }
      const kst = new Date((e.endedAt || Date.now()) + 9 * 3600 * 1000); // KST(UTC 서버에서 새벽 응대가 전날로 집계되는 문제 방지)
      const d = kst.toISOString().slice(0, 10);
      daily[d] = (daily[d] || 0) + 1;
      hourly[kst.getUTCHours()]++;
      rows.push({
        date: d, startedAt: e.startedAt || null, endedAt: e.endedAt || null, durMs: dur,
        lang, sentences: sent, staff: e.stats ? e.stats.staff || 0 : null, guest: e.stats ? e.stats.guest || 0 : null,
        crossDrops: e.stats ? e.stats.crossDrops || 0 : null, interrupted: !!e.interrupted,
      });
    }
    durs.sort((a, b) => a - b);
    const medianMs = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
    const wl = Array.isArray(s.wayfindLog) ? s.wayfindLog : [];
    const wayfindTop = {};
    for (const w of wl) { if (w.catId) wayfindTop[w.catId] = (wayfindTop[w.catId] || 0) + 1; }
    return {
      id: s.id, title: s.title || '안내데스크', owner: s.owner || null, deleted: !!s.deletedAt,
      count: log.length, interrupted, langs, avgMs: durN ? Math.round(durSum / durN) : 0, medianMs,
      byLang: Object.fromEntries(Object.entries(byLang).map(([lg, b]) => [lg, { count: b.count, avgMs: b.durN ? Math.round(b.durSum / b.durN) : 0, avgSent: b.count ? +(b.sent / b.count).toFixed(1) : 0 }])),
      sentences: { total: sentSum, avgPerConv: log.length ? +(sentSum / log.length).toFixed(1) : 0, staff: staffSent, guest: guestSent },
      crossDrops, crossDropRate: staffSent + guestSent + crossDrops > 0 ? +((crossDrops / (staffSent + guestSent + crossDrops)) * 100).toFixed(1) : 0,
      wayfindDetected: wl.length, wayfindShown: wl.filter((w) => w.shown).length,
      wayfindTop: Object.entries(wayfindTop).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([catId, count]) => ({ catId, count })),
      daily: Object.entries(daily).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })), // 전체 — 기간·월별 뷰는 클라에서 필터/그룹핑
      hourly,
      rows: rows.slice(-500),
    };
  });
  res.json(out);
});

/* ---- 관리자: 세부 로그 열람 — 데스크 응대 로그(건당) + 일반 세션 대화 로그 ---- */
app.get('/api/admin/logs', requireAdmin, (req, res) => {
  const desks = sessions.filter((s) => s.pipeline === 'desk').map((s) => ({
    id: s.id,
    title: s.title || '안내데스크',
    deleted: !!s.deletedAt, // 소프트 삭제된 세션의 로그도 계속 열람 가능(표기용)
    logs: (Array.isArray(s.deskLog) ? s.deskLog : []).map((e, i) => ({
      idx: i,
      startedAt: e.startedAt || null,
      endedAt: e.endedAt || null,
      lang: e.lang || null,
      count: Array.isArray(e.items) ? e.items.length : 0,
      stats: e.stats || null,
    })).reverse(),
  }));
  const others = sessions.filter((s) => s.pipeline !== 'desk').map((s) => ({
    id: s.id, title: s.title || '(제목 없음)', owner: s.owner || null, pipeline: s.pipeline || 'whisper', preset: s.preset || null,
    updatedAt: s.updatedAt || 0, count: Array.isArray(s.items) ? s.items.length : 0,
    deleted: !!s.deletedAt,
  })).sort((a, b) => b.updatedAt - a.updatedAt);
  res.json({ desks, sessions: others });
});
app.get('/api/admin/logs/desk/:sid/:idx', requireAdmin, (req, res) => {
  const s = getSessionAny(req.params.sid);
  if (!s || s.pipeline !== 'desk') return res.status(404).json({ error: 'not found' });
  const e = (s.deskLog || [])[Number(req.params.idx)];
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json({ startedAt: e.startedAt || null, endedAt: e.endedAt || null, lang: e.lang || null, consentAt: e.consentAt || null, stats: e.stats || null, items: e.items || [] });
});
app.get('/api/admin/logs/session/:id', requireAdmin, (req, res) => {
  const s = getSessionAny(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json({ id: s.id, title: s.title || '', langs: s.langs || [], items: s.items || [] });
});
/* ---- 관리자: 로그 정리(삭제) — 시범운영 후 데이터 관리용 ---- */
// 데스크 응대 1건 삭제
app.delete('/api/admin/logs/desk/:sid/:idx', requireAdmin, (req, res) => {
  const s = getSessionAny(req.params.sid);
  if (!s || s.pipeline !== 'desk' || !Array.isArray(s.deskLog)) return res.status(404).json({ error: 'not found' });
  const i = Number(req.params.idx);
  if (!(i >= 0 && i < s.deskLog.length)) return res.status(404).json({ error: 'not found' });
  // idx 는 목록 조회 시점 기준 — 그 사이 응대 종료/정리로 재색인됐다면 다른 기록을 지우게 되므로 endedAt 으로 동일성 검증
  const expect = Number(req.query.endedAt || 0);
  if (expect && (s.deskLog[i].endedAt || 0) !== expect) return res.status(409).json({ error: '목록이 갱신되었습니다 — 새로고침 후 다시 시도해 주세요.' });
  s.deskLog.splice(i, 1);
  saveSessions();
  res.json({ ok: true, remaining: s.deskLog.length });
});
// 소프트 삭제된 세션의 로그까지 지우면 남는 게 없으므로 껍데기도 완전 제거(저장소 포함)
const purgeIfDeleted = (s) => {
  if (!s.deletedAt) return false;
  setSessions(sessions.filter((x) => x.id !== s.id));
  deleteSessionStore(s.id);
  if (!col) saveSessions();
  return true;
};
// 데스크 응대 로그 전체 삭제(길안내 로그 포함)
app.delete('/api/admin/logs/desk/:sid', requireAdmin, (req, res) => {
  const s = getSessionAny(req.params.sid);
  if (!s || s.pipeline !== 'desk') return res.status(404).json({ error: 'not found' });
  const n = (s.deskLog || []).length;
  s.deskLog = [];
  s.wayfindLog = [];
  if (!purgeIfDeleted(s)) saveSessions();
  res.json({ ok: true, deleted: n });
});
// 일반 세션 대화 기록 삭제(세션 자체는 유지 — 단, 이미 삭제된 세션은 완전 제거)
app.delete('/api/admin/logs/session/:id', requireAdmin, (req, res) => {
  const s = getSessionAny(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  const n = (s.items || []).length;
  s.items = [];
  if (!purgeIfDeleted(s)) saveSessions();
  res.json({ ok: true, deleted: n });
});

/* ---- 관리자: 오탈자·오번역 검사 — 최근 대화의 원문·번역 쌍을 GPT 로 단어 단위 대조 검수 ----
   문장 전체가 아니라 개별 단어 단위로 오탈자(맞춤법·깨진 표기)·잘못 번역된 고유명사/시설명/전문용어를
   찾아 용어 설정(translation_terms) 후보로 반환. */
app.post('/api/admin/terms-suggest', requireAdmin, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY 미설정' });
  // sessionIds 지정 시 해당 세션(일반 대화 + 데스크 응대 로그)만 검사, 미지정 시 최근 전체
  const bq = req.body || {};
  const wanted = Array.isArray(bq.sessionIds) && bq.sessionIds.length ? new Set(bq.sessionIds.map(String)) : null;
  const pairs = [];
  const sorted = [...sessions].filter((s) => !wanted || wanted.has(s.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  for (const s of sorted) {
    const items = [
      ...(Array.isArray(s.items) ? s.items : []),
      ...(Array.isArray(s.deskLog) ? s.deskLog.flatMap((e) => e.items || []) : []), // 데스크 응대 기록 포함
    ];
    for (const it of items) {
      if (!it || !it.source || !it.texts) continue;
      const tx = Object.entries(it.texts).find(([, v]) => v && v !== it.source);
      if (!tx) continue;
      pairs.push(`[${tx[0]}] ${String(it.source).slice(0, 180)} => ${String(tx[1]).slice(0, 180)}`);
      if (pairs.length >= 200) break;
    }
    if (pairs.length >= 200) break;
  }
  if (pairs.length < 3) return res.json({ checked: pairs.length, suggestions: [] });
  const existing = (termsConfig.entries || [])
    .map((e) => TERM_LANGS.filter((lg) => e.names && e.names[lg]).map((lg) => e.names[lg]).join('/'))
    .filter(Boolean).join(', ');
  const sys =
    '너는 공항 안내 통역 품질 검수자다. 아래 "원문 => 기계번역" 쌍 목록을 문장 전체가 아니라 단어 단위로 대조하여, 개별 단어의 오류만 찾아라. ' +
    '검출 대상은 두 가지다: (1) 오탈자 — 맞춤법 오류·깨진 표기·잘못된 글자가 섞인 단어, (2) 잘못 번역된 단어 — 고유명사·시설명·전문용어가 원문과 다르게 옮겨졌거나 대화마다 다르게 번역된 경우. ' +
    '각 오류 항목은 반드시 정확히 하나의 단어(또는 「제1여객터미널」처럼 한 덩어리로 취급되는 용어) 여야 한다. 문장 전체의 어색함·문체·어순·의역 여부는 무시한다. ' +
    '반드시 JSON 하나만 출력한다: ' +
    '{"suggestions":[{"source":"원문의 해당 단어","target":"올바른 단어","wrong":"현재 잘못된 단어","lang":"외국어 쪽 언어코드(en/ja/zh/es/fr/pt/ar) — 목록의 [코드] 참고","reason":"짧은 이유"}]} ' +
    'source·target·wrong 은 각각 문장이 아니라 단어(또는 한 덩어리 용어) 하나여야 한다. lang 은 각 쌍 맨 앞의 [언어코드]를 그대로 쓴다(한자만으로 된 일본어를 중국어로 오판하지 말 것). 확실한 것만 최대 12개. 이미 등록된 용어는 제외: ' + (existing || '없음');
  try {
    const body = {
      model: REFINE_MODEL,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: pairs.join('\n').slice(0, 14000) }],
      max_completion_tokens: 900,
      response_format: { type: 'json_object' },
    };
    const re = reasoningEffort(REFINE_MODEL);
    if (re) body.reasoning_effort = re;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(500).json({ error: '검사 호출 실패: HTTP ' + r.status });
    const d = await r.json();
    const obj = JSON.parse(d?.choices?.[0]?.message?.content || '{}');
    const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
      .filter((x) => x && x.source && x.target)
      .slice(0, 12)
      .map((x) => ({ source: String(x.source).slice(0, 80), target: String(x.target).slice(0, 80), wrong: String(x.wrong || '').slice(0, 80), reason: String(x.reason || '').slice(0, 120) }));
    res.json({ checked: pairs.length, suggestions });
  } catch (e) {
    logErr('terms-suggest', e);
    res.status(500).json({ error: '검사 실패' });
  }
});

/* ---- 관리자: 용어 적중 분석 — 등록 용어가 실제 대화에서 몇 번 등장했는지(문자열 매칭, GPT 미사용) ----
   0회 용어 = 정리 후보. 대상 코퍼스: 데스크 응대 로그 + 일반 세션 대화(원문·번역 텍스트). */
app.get('/api/admin/terms-hit', requireAdmin, (req, res) => {
  const corpus = [];
  for (const s of sessions) {
    const push = (it) => {
      if (!it) return;
      if (it.source) corpus.push(String(it.source));
      if (it.texts) for (const v of Object.values(it.texts)) if (v) corpus.push(String(v));
    };
    (Array.isArray(s.items) ? s.items : []).forEach(push);
    (Array.isArray(s.deskLog) ? s.deskLog : []).forEach((e) => (e.items || []).forEach(push));
  }
  const text = corpus.join('\n');
  const lower = text.toLowerCase();
  const countOf = (needle) => {
    const n = String(needle || '').trim();
    if (n.length < 2) return 0;
    const hay = /[a-z]/i.test(n) ? lower : text; // 라틴 표기는 대소문자 무시
    const nn = /[a-z]/i.test(n) ? n.toLowerCase() : n;
    let cnt = 0, i = 0;
    while ((i = hay.indexOf(nn, i)) !== -1) { cnt++; i += nn.length; }
    return cnt;
  };
  const rows = (termsConfig.entries || []).map((e) => {
    const byLang = {};
    let hits = 0;
    for (const [lg, name] of Object.entries(e.names || {})) {
      const c = countOf(name);
      if (c > 0) byLang[lg] = c;
      hits += c;
    }
    return { ko: (e.names && e.names.ko) || '', category: e.category, mode: e.mode, hits, byLang };
  });
  // 같은 ko(정식+약칭 행)를 합쳐 보기 좋게
  const merged = new Map();
  for (const r of rows) {
    const m = merged.get(r.ko) || { ko: r.ko, category: r.category, hits: 0, byLang: {} };
    m.hits += r.hits;
    for (const [lg, c] of Object.entries(r.byLang)) m.byLang[lg] = (m.byLang[lg] || 0) + c;
    merged.set(r.ko, m);
  }
  const out = [...merged.values()].sort((a, b) => b.hits - a.hits);
  res.json({ at: Date.now(), corpusLines: corpus.length, terms: out, zeroCount: out.filter((t) => t.hits === 0).length });
});

/* ---- 정형 안내 멘트(원터치 재생용 문안) — 열람은 로그인 전원, 수정은 관리자 ---- */
/* ---- 데스크 현황: 전 데스크의 실시간 상태(호스트 연결·응대 중·뷰어 수) — 목록 화면 현황판용 ---- */
app.get('/api/desk-status', requireAuth, (req, res) => {
  const out = sessions
    .filter((s) => s.pipeline === 'desk' && !s.deletedAt)
    .map((s) => {
      const r = rooms.get(s.id);
      const dc = deskCtrl.get(s.id);
      const st = dc && dc.state ? dc.state() : null;
      return {
        id: s.id,
        hostOn: !!(r && r.hosts.size > 0),
        active: !!(st && st.phase === 'active'),
        lang: st && st.phase === 'active' ? st.lang : null,
        // 호스트 화면의 패시브 뷰어 소켓(role=host)은 제외 — 태블릿이 없어도 '뷰어 1'로 부풀던 문제
        viewers: r ? [...r.viewers].filter((v) => !v._hostView).length : 0,
      };
    });
  res.json(out);
});

/* ---- 전체 초기화(관리자): 세션(대화·응대 로그 포함)·AI 요약을 전부 삭제 ----
   파괴적 작업이므로 로그인 세션과 별개로 관리자 비밀번호를 본문에서 재확인한다.
   보존: 계정·안내데스크 정의·용어·정형 안내·사용량 통계(과금 기록). */
app.post('/api/admin/reset-all', requireAdmin, async (req, res) => {
  const pw = String((req.body || {}).password || '');
  const a = Buffer.from(pw), e = Buffer.from(ADMIN_PASSWORD);
  if (!(a.length === e.length && crypto.timingSafeEqual(a, e))) {
    return res.status(403).json({ error: '관리자 비밀번호가 일치하지 않습니다.' });
  }
  // 진행 중인 캡처·뷰어 연결을 먼저 정리(파이프라인 close 핸들러가 정상 경로로 정돈)
  for (const c of wss.clients) { try { c.close(); } catch {} }
  // 데스크 세션은 '설비'다 — 지우면 세션 id 가 바뀌어 뷰어 접근 토큰(HMAC of id)도 바뀌고
  // 현장에 인쇄·게시한 QR 이 전부 무효가 된다. 그래서 데스크 세션은 남기고 내용만 비운다.
  const kept = sessions.filter((s) => s.pipeline === 'desk' && !s.deletedAt);
  const removed = sessions.length - kept.length;
  let clearedLogs = 0;
  for (const s of kept) {
    clearedLogs += (s.deskLog || []).length;
    s.items = [];
    s.deskLog = [];
    s.wayfindLog = [];
    s.updatedAt = Date.now();
  }
  setSessions(kept);
  dirtySessions.clear();
  try {
    if (col) {
      if (sessionsFlushInflight) await sessionsFlushInflight;
      await col.deleteMany({ id: { $nin: kept.map((s) => s.id) } }); // 데스크 세션 외 전부 삭제
      for (const s of kept) await col.replaceOne({ id: s.id }, s, { upsert: true }); // 비운 상태로 저장
    } else await flushSessions();
  } catch (err) {
    console.error('[reset-all] 저장소 정리 실패', err);
    return res.status(500).json({ error: '저장소 정리에 실패했습니다 — 서버 로그를 확인하세요.' });
  }
  console.warn(`[reset-all] 관리자 초기화 — 세션 ${removed}개 삭제, 데스크 ${kept.length}개 유지(응대 기록 ${clearedLogs}건 비움)`);
  res.json({ ok: true, removedSessions: removed, keptDesks: kept.length, clearedDeskLogs: clearedLogs });
});

/* ---- 전체 데이터 백업(관리자): 세션·데스크 정의·용어·정형 안내를 JSON 한 파일로 ---- */
app.get('/api/admin/export', requireAdmin, (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="airtalk-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify({ exportedAt: Date.now(), sessions, deskRegistry, termsConfig }, null, 1));
});

/* ---- 안내데스크 사전 정의(레지스트리): 관리자가 이름·층·방향을 등록해 두면
   세션 생성 시 데스크를 '선택'만 한다(층·방향은 레지스트리에서 복사, 세션명은 별도). ---- */
app.get('/api/desk-registry', requireAuth, (req, res) => res.json(deskRegistry));
app.put('/api/desk-registry', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const desks = (Array.isArray(b.desks) ? b.desks : []).slice(0, 50).map((d) => ({
    id: String(d.id || newId()),
    name: String(d.name || '').trim().slice(0, 60),
    floor: ['1F', '2F', '3F', '4F'].includes(d.floor) ? d.floor : '1F',
    side: ['E', 'W', 'S', 'N'].includes(d.side) ? d.side : 'S',
  })).filter((d) => d.name);
  setDeskRegistry({ desks });
  try { await persistDeskRegistry(); } catch (e) { return res.status(500).json({ error: '저장 실패: ' + e.message }); }
  res.json(deskRegistry);
});

/* ---- 관리자 2FA(TOTP, RFC 6238) ----
   Google Authenticator 등 표준 OTP 앱 호환. 시크릿은 env ADMIN_TOTP_SECRET(우선) 또는
   data/security.json(관리자 페이지에서 설정, DATA_KEY 설정 시 암호화 저장). */
const SECURITY_FILE = path.join(DATA_DIR, 'security.json');
let securityCfg = { adminTotpSecret: '' };
try { if (fs.existsSync(SECURITY_FILE)) securityCfg = { ...securityCfg, ...JSON.parse(readDataFile(SECURITY_FILE)) }; } catch (e) { console.error('[2fa] security.json 로드 실패', e.message); }
function saveSecurityCfg() { try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); writeDataFile(SECURITY_FILE, JSON.stringify(securityCfg, null, 2)); } catch (e) { console.error('[2fa] 저장 실패', e); } }
const adminTotpSecret = () => process.env.ADMIN_TOTP_SECRET || securityCfg.adminTotpSecret || '';
let pending2faSecret = ''; // 설정 진행 중 시크릿(코드 확인 후 저장)
app.get('/api/admin/2fa', requireAdmin, (req, res) => res.json({ enabled: !!adminTotpSecret(), viaEnv: !!process.env.ADMIN_TOTP_SECRET }));
app.post('/api/admin/2fa/setup', requireAdmin, async (req, res) => {
  if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
  pending2faSecret = b32encode(crypto.randomBytes(20));
  const label = encodeURIComponent(`AirTalk:${req.user.id}`);
  const url = `otpauth://totp/${label}?secret=${pending2faSecret}&issuer=${encodeURIComponent('AirTalk')}`;
  try { res.json({ secret: pending2faSecret, qr: await QRCode.toDataURL(url, { width: 240, margin: 1 }) }); }
  catch (e) { res.status(500).json({ error: String(e) }); }
});
app.post('/api/admin/2fa/verify', requireAdmin, (req, res) => {
  if (!pending2faSecret) return res.status(400).json({ error: '먼저 2FA 설정을 시작하세요.' });
  if (!totpVerify(pending2faSecret, (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다. 앱의 6자리 코드를 다시 확인하세요.' });
  securityCfg.adminTotpSecret = pending2faSecret;
  pending2faSecret = '';
  saveSecurityCfg();
  console.log('[2fa] 관리자 2FA 활성화됨');
  res.json({ ok: true });
});
app.post('/api/admin/2fa/disable', requireAdmin, (req, res) => {
  if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
  if (!totpVerify(adminTotpSecret(), (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다.' });
  securityCfg.adminTotpSecret = '';
  saveSecurityCfg();
  console.log('[2fa] 관리자 2FA 해제됨');
  res.json({ ok: true });
});

// 로그인 무차별 대입 방어: (IP+ID) 조합당 15분 내 8회 실패 시 15분 잠금.
//  ── IP 단독으로 잠그면 공항 사내 NAT(직원 수십 명이 같은 공인 IP)에서 한 명의 오타가
//     전 직원을 잠그므로, 계정 ID 를 키에 포함해 실패한 그 계정만 잠기게 한다.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAIL = 8;
const loginFails = new Map(); // "ip|id" -> { count, first, lockUntil }
function loginIp(req) {
  return String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || 'ip').trim();
}
function loginKey(req, id) {
  return loginIp(req) + '|' + String(id || '').trim().toLowerCase();
}
app.post('/api/login', (req, res) => {
  const b = req.body || {};
  const id = String(b.id || '').trim();
  const password = String(b.password || '');
  const key = loginKey(req, id);
  const now = Date.now();
  // 만료 엔트리 게으른 청소(무한 증가 방지) — 크기가 커졌을 때만 순회
  if (loginFails.size > 2000) {
    for (const [k, v] of loginFails) { if (now - v.first > LOGIN_WINDOW_MS && (!v.lockUntil || now > v.lockUntil)) loginFails.delete(k); }
  }
  let rec = loginFails.get(key);
  if (rec && rec.lockUntil && now < rec.lockUntil) {
    const sec = Math.ceil((rec.lockUntil - now) / 1000);
    return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${sec}초 후 다시 시도하세요.` });
  }
  if (rec && now - rec.first > LOGIN_WINDOW_MS) rec = null; // 윈도우 경과 → 초기화

  let user = null;
  if (id === ADMIN_ID) {
    const a = Buffer.from(password), e = Buffer.from(ADMIN_PASSWORD);
    if (a.length === e.length && crypto.timingSafeEqual(a, e)) user = findUser(ADMIN_ID);
  } else {
    const u = users.find((x) => x.id === id);
    if (verifyPassword(u, password)) user = u;
  }
  if (!user) {
    rec = rec || { count: 0, first: now, lockUntil: 0 };
    rec.count++;
    if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
    loginFails.set(key, rec);
    console.warn(`[auth] 로그인 실패 id=${id} ip=${key} (${rec.count}회)`);
    return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
  }
  // 관리자 2FA: 비밀번호 통과 후 OTP 코드 확인(활성화된 경우)
  if (user.role === 'admin' && adminTotpSecret()) {
    if (!b.otp) return res.status(401).json({ need2fa: true, error: '인증 앱의 6자리 코드를 입력하세요.' });
    if (!totpVerify(adminTotpSecret(), b.otp)) {
      rec = rec || { count: 0, first: now, lockUntil: 0 };
      rec.count++;
      if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
      loginFails.set(key, rec);
      console.warn(`[auth] 2FA 코드 불일치 id=${id} ip=${key}`);
      return res.status(401).json({ need2fa: true, error: '인증 코드가 올바르지 않습니다.' });
    }
  }
  loginFails.delete(key); // 성공 시 초기화
  console.log(`[auth] 로그인 성공 id=${user.id} role=${user.role} ip=${key}`);
  const secure = isHttps(req) ? '; Secure' : '';
  // remember(자동 로그인) 시 30일 영속 쿠키, 아니면 세션 쿠키(브라우저 종료 시 해제)
  const persist = b.remember ? '; Max-Age=2592000' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken(user.id)}; HttpOnly; SameSite=Lax; Path=/${persist}${secure}`);
  res.json({ user: publicUser(user) });
});
app.post('/api/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/* ---- 관리자: 사용자 관리 + 사용량 통계 ---- */
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const list = users.map((u) => ({
    id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
    sessionCount: sessions.filter((s) => s.owner === u.id).length,
    usageMs: u.usageMs || 0,
  }));
  res.json(list);
});
app.post('/api/admin/users', requireAdmin, (req, res) => {
  const b = req.body || {};
  const id = String(b.id || '').trim();
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!id || !password) return res.status(400).json({ error: 'ID 와 비밀번호는 필수입니다.' });
  if (password.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
  if (id === ADMIN_ID || users.some((u) => u.id === id))
    return res.status(409).json({ error: '이미 존재하는 ID 입니다.' });
  const u = makeUser({ id, username, password, role: 'user' });
  users.push(u);
  saveUsers();
  res.json({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, sessionCount: 0, usageMs: 0 });
});
app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
  const u = users.find((x) => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
  const pw = String((req.body && req.body.password) || '');
  if (!pw) return res.status(400).json({ error: '비밀번호는 필수입니다.' });
  if (pw.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPassword(pw, u.salt);
  saveUsers();
  console.log(`[admin] 비밀번호 재설정 user=${u.id}`);
  res.json({ ok: true });
});
// 사용자 계정 완전 삭제 — 관리자 삭제(DELETE /api/admin/users/:id)·본인 탈퇴(DELETE /api/me) 공용.
// 사용자 레코드 + 소유 세션(하드 삭제, 저장소 포함) + 프로필. 소유 세션의 라이브 소켓도 끊는다 —
// 하드 삭제된 세션에 호스트가 붙어 있으면 좀비 스트리밍(비용)이 계속된다(closeSessionRoom, 세션 삭제와 동일 정리).
function deleteUserAccount(id) {
  const i = users.findIndex((u) => u.id === id);
  if (i >= 0) {
    users.splice(i, 1);
    deleteUserStore(id);
  }
  const owned = sessions.filter((s) => s.owner === id).map((s) => s.id);
  if (owned.length) {
    setSessions(sessions.filter((s) => s.owner !== id));
    owned.forEach((sid) => { deleteSessionStore(sid); closeSessionRoom(sid); });
    if (!col) saveSessions();
  }
  if (profiles.delete(id) || profilesCol) deleteProfileStore(id);
}
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === ADMIN_ID) return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
  deleteUserAccount(id);
  res.json({ ok: true });
});

// 사용량/비용 — 일별 + 합계 (관리자). 파이프라인별 분당 요금 기반.
app.get('/api/admin/usage', requireAdmin, (req, res) => {
  const daily = Object.keys(usageDaily)
    .sort()
    .map((date) => {
      const d = usageDaily[date];
      const whisperMin = (d.whisperMs || 0) / 60000;
      const translateMin = (d.translateMs || 0) / 60000;
      return { date, whisperMin, translateMin, minutes: whisperMin + translateMin, cost: costOfDay(d) };
    });
  const hourly = Object.keys(usageHourly)
    .sort()
    .slice(-72) // 최근 72시간
    .map((hour) => {
      const d = usageHourly[hour];
      const whisperMin = (d.whisperMs || 0) / 60000;
      const translateMin = (d.translateMs || 0) / 60000;
      return { hour, whisperMin, translateMin, minutes: whisperMin + translateMin, cost: costOfDay(d) };
    });
  res.json({
    daily,
    hourly,
    totalMinutes: daily.reduce((a, d) => a + d.minutes, 0),
    totalCost: daily.reduce((a, d) => a + d.cost, 0),
    rateWhisper: PRICE_WHISPER_PER_MIN,
    rateTranslate: PRICE_TRANSLATE_PER_MIN,
  });
});

app.get('/api/admin/vendor-usage', requireAdmin, async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 14));
  // 10분보다 오래됐으면 백그라운드로 신선화하고, 응답은 저장분으로 즉시 — 화면이 벤더 API 왕복(수 초)을 기다리지 않는다.
  // 단, 저장분이 아예 없으면(첫 부팅 직후) 한 번은 기다려 빈 화면을 피한다.
  const stale = Date.now() - vendorRefreshAt > 10 * 60e3;
  const empty = !Object.keys(vendorUsage.soniox).length && !Object.keys(vendorUsage.cartesia).length && !Object.keys(vendorUsage.openai).length;
  if (stale) {
    const p = kickVendorRefresh();
    if (empty) { try { await p; } catch {} }
  }
  const cut = kstDay(Date.now() - (days - 1) * 86400e3);
  const svcKeys = { soniox: !!SONIOX_API_KEY, cartesia: !!CARTESIA_API_KEY, openai: !!OPENAI_API_KEY };
  // 세 벤더의 일자 축을 동일하게(빈 날은 0) — 카드 간 막대가 날짜 기준으로 1:1 정렬되도록
  const axis = [];
  for (let i = days - 1; i >= 0; i--) axis.push(kstDay(Date.now() - i * 86400e3));
  const build = (k, extra) => {
    const st = { ...vendorStatus[k], serviceKey: svcKeys[k] }; // serviceKey=동작용 일반 키(사용량 조회 키와 별개)
    const all = Object.keys(vendorUsage[k]).sort();
    const hasData = all.some((d) => d >= cut);
    const days2 = hasData ? axis.map((date) => ({ date, ...(vendorUsage[k][date] || {}) })) : [];
    return { ...st, days: days2, earliest: all[0] || null, ...extra(days2) };
  };
  res.json({
    days, at: vendorRefreshAt, retention: { soniox: 91 },
    soniox: build('soniox', (ds) => {
      const byUser = {};
      for (const d of ds) for (const [uid, u] of Object.entries(d.byUser || {})) {
        const t = byUser[uid] || (byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
        t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
      }
      const users = Object.entries(byUser)
        .map(([id, u]) => ({ id, audioMin: +(u.audioMs / 60000).toFixed(1), costUsd: +u.costUsd.toFixed(4), requests: u.requests }))
        .sort((a, b) => b.costUsd - a.costUsd);
      // 파이프라인별(안내데스크/실시간 번역) 합계 — client_reference_id 의 |p: 태그 기준(구 로그는 etc)
      const byPipe = { desk: { audioMs: 0, costUsd: 0, requests: 0 }, live: { audioMs: 0, costUsd: 0, requests: 0 }, etc: { audioMs: 0, costUsd: 0, requests: 0 } };
      for (const d of ds) for (const [pk, u] of Object.entries(d.byPipe || {})) {
        const t = byPipe[pk] || byPipe.etc;
        t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
      }
      for (const t of Object.values(byPipe)) t.costUsd = +t.costUsd.toFixed(4);
      return { totalCostUsd: +ds.reduce((a, d) => a + (d.costUsd || 0), 0).toFixed(4), totalAudioMin: +(ds.reduce((a, d) => a + (d.audioMs || 0), 0) / 60000).toFixed(1), totalRequests: ds.reduce((a, d) => a + (d.requests || 0), 0), users, byPipe };
    }),
    cartesia: build('cartesia', (ds) => {
      // 파이프라인별 자체 집계(문자수 기준 — Cartesia 벤더 API 는 태그별 분해 미지원)
      const byPipe = { desk: { chars: 0, req: 0 }, live: { chars: 0, req: 0 } };
      for (const d of ds) {
        const s = vendorUsage.cartesiaSelf[d.date];
        if (!s) continue;
        for (const pk of ['desk', 'live']) { if (s[pk]) { byPipe[pk].chars += s[pk].chars || 0; byPipe[pk].req += s[pk].req || 0; } }
      }
      return { totalCredits: ds.reduce((a, d) => a + (d.credits || 0), 0), byPipe };
    }),
    openai: build('openai', (ds) => ({ totalCostUsd: +ds.reduce((a, d) => a + (d.costUsd || 0), 0).toFixed(4) })),
  });
});

// 용어 설정(통합 v3): 열람(로그인 누구나) + 수정(관리자만). Soniox context로 주입됨.
app.get('/api/terms-config', requireAuth, (req, res) => {
  res.json({
    version: 3,
    servedLangs: termsConfig.servedLangs || DEFAULT_SERVED_LANGS.slice(),
    categoryScope: sanitizeCatScope(termsConfig.categoryScope),
    entries: termsConfig.entries || [],
    langs: TERM_LANGS, categories: TERM_CATEGORIES, // UI 참고용
    updatedAt: termsConfig.updatedAt || 0,
  });
});
app.put('/api/terms-config', requireAdmin, async (req, res) => {
  // 신 스키마(entries) + 구형(terms/translationTerms/alt, JSON 업로드) 모두 정규화 수용
  setTermsConfig({ ...normalizeTermsConfig(req.body || {}), updatedAt: Date.now() });
  try { await persistTermsConfig(); }
  catch (e) {
    // 저장 실패를 200 으로 숨기지 않는다 — 관리자는 저장된 줄 알지만 재기동 시 유실되던 문제
    console.error('[terms] 저장 실패', e);
    return res.status(500).json({ error: '저장소 기록 실패 — 변경이 재시작 후 유실될 수 있습니다. 다시 시도해 주세요.' });
  }
  res.json({ version: 3, servedLangs: termsConfig.servedLangs, categoryScope: termsConfig.categoryScope, entries: termsConfig.entries, langs: TERM_LANGS, categories: TERM_CATEGORIES, updatedAt: termsConfig.updatedAt });
});

app.post('/api/terms-config/validate', requireAdmin, async (req, res) => {
  if (!SONIOX_API_KEY) return res.status(400).json({ error: 'SONIOX_API_KEY 미설정 — 실검증 불가' });
  const served = (termsConfig.servedLangs || DEFAULT_SERVED_LANGS).filter((l) => l !== 'ko');
  const results = await Promise.all(served.map(async (L) => {
    const ctx = buildSonioxContextRaw(['ko', L], { desk: false }); // 일반세션(항공용어 포함)이 더 큼 → 최악 케이스 검증
    const bytes = ctx ? JSON.stringify(ctx).length : 0;
    const terms = ctx && ctx.terms ? ctx.terms.length : 0;
    const pairs = ctx && ctx.translation_terms ? ctx.translation_terms.length : 0;
    let r; try { r = await validateSonioxPair('ko', L, ctx); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    return { lang: L, ok: r.ok, error: r.error || null, bytes, terms, pairs };
  }));
  res.json({ at: Date.now(), results });
});

/* (평가 러너는 제거됨 — 평가는 데스크 응대 로그의 '평가 JSON' 내려받기 + tools/eval/score.mjs --auto 로 진행) */

/* ---- 세션 REST API ---- */
app.get('/api/sessions', requireAuth, (req, res) => {
  // q= 검색: 제목 + 대화 내용(원문·번역, 데스크 응대 기록 포함)
  const q = String(req.query.q || '').trim().toLowerCase();
  const hitItem = (it) => {
    if (!it) return false;
    if (it.source && String(it.source).toLowerCase().includes(q)) return true;
    return !!(it.texts && Object.values(it.texts).some((v) => v && String(v).toLowerCase().includes(q)));
  };
  const matches = (s) => {
    if ((s.title || '').toLowerCase().includes(q)) return true;
    if (Array.isArray(s.items) && s.items.some(hitItem)) return true;
    return Array.isArray(s.deskLog) && s.deskLog.some((e) => Array.isArray(e.items) && e.items.some(hitItem));
  };
  // 검색 결과에 보여줄 매칭 발췌: 대화 내용에서 q 가 처음 나오는 곳 주위 텍스트(제목만 맞은 경우엔 null)
  const snippetOf = (s) => {
    if (!q) return null;
    const texts = [];
    const collect = (it) => { if (it) { if (it.source) texts.push(String(it.source)); if (it.texts) for (const v of Object.values(it.texts)) if (v) texts.push(String(v)); } };
    (s.items || []).forEach(collect);
    (s.deskLog || []).forEach((e) => (e.items || []).forEach(collect));
    for (const t of texts) {
      const i = t.toLowerCase().indexOf(q);
      if (i >= 0) {
        const start = Math.max(0, i - 24);
        const raw = t.slice(start, i + q.length + 56);
        return (start > 0 ? '…' : '') + raw.trim() + (i + q.length + 56 < t.length ? '…' : '');
      }
    }
    return null; // 제목만 매칭
  };
  // 폰 세션 목록의 '한국어 ⇄ 중국어' 표기용 — 마지막으로 번역한 방향(sxInfo)과 입력 언어
  const langsOf = (s) => ({
    inLang: s.inLang || null,
    sxInfo: s.sxInfo ? { mode: s.sxInfo.mode, target: s.sxInfo.target, a: s.sxInfo.a, b: s.sxInfo.b } : null,
  });
  const list = sessions
    .filter((s) => !s.deletedAt)
    // 일반 세션은 본인 것만. 안내데스크 세션은 관리자가 만들고 전 직원이 공용으로 운영 → 모두에게 노출.
    .filter((s) => (s.pipeline === 'desk' ? true : s.owner === req.user.id))
    .filter((s) => (q ? matches(s) : true))
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length, pipeline: s.pipeline || 'whisper', preset: s.preset || null, src: s.src || null, deskName: s.deskName || null, snippet: snippetOf(s), ...langsOf(s) }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  const pipeline = ['translate', 'soniox', 'desk'].includes(b.pipeline) ? b.pipeline : 'soniox'; // whisper(구) 지원 종료 — 기본 soniox
  // 안내데스크 세션은 관리자만 생성(공용 인프라) — 직원은 운영만
  if (pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 만들 수 있습니다.' });
  // translate 는 단일 출력 언어. desk 는 ko 시작(감지로 동적 확장). soniox 다국어.
  const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
  const langs = pipeline === 'translate' ? [outLang] : (pipeline === 'desk' ? ['ko'] : ALL_LANGS.slice());
  // 실시간 번역 모드: oneway(실시간 번역)/twoway(양방향 통역) + 소스. 신규 기본 소스는 마이크
  // (구 프리셋 키가 들어와도 같은 상황으로 매핑 — 캐시된 구 클라 대비).
  const mode = pipeline === 'soniox' ? normalizeMode(b.preset, b.src, 'mic') : null;
  // 데스크 안내: 레지스트리(관리자 사전 정의)에서 데스크 선택 → 층/방향/데스크명 복사.
  // deskId 없이 직접 deskFloor/deskSide 를 주는 구형 경로도 하위호환으로 유지.
  let deskName;
  if (pipeline === 'desk' && b.deskId) {
    const reg = (deskRegistry.desks || []).find((d) => d.id === String(b.deskId));
    if (!reg) return res.status(400).json({ error: '등록되지 않은 안내데스크입니다. 관리자 페이지에서 먼저 등록하세요.' });
    b.deskFloor = reg.floor;
    b.deskSide = reg.side;
    deskName = reg.name;
  }
  const deskFloor = pipeline === 'desk' ? (['1F', '2F', '3F', '4F'].includes(b.deskFloor) ? b.deskFloor : '1F') : undefined;
  const deskSide = pipeline === 'desk' ? (['E', 'W', 'S', 'N'].includes(b.deskSide) ? b.deskSide : 'S') : undefined;
  const s = {
    id: newId(),
    owner: req.user.id, // 소유자
    title: b.title || '새 세션',
    createdAt: now,
    updatedAt: now,
    pipeline, // 생성 후 변경 불가
    ...(mode ? { preset: mode.preset, src: mode.src } : {}),
    ...(deskFloor ? { deskFloor, deskSide } : {}),
    ...(deskName ? { deskName } : {}),
    langs,
    outLang,
    inLang: b.inLang || 'auto',
    items: [],
  };
  sessions.push(s);
  saveSessions();
  res.json(s);
});

app.get('/api/sessions/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (!viewerAccessOk(req, s.id)) return res.status(403).json({ error: 'forbidden' }); // 공개 뷰어: 유효 토큰 또는 로그인 필요
  // 공개 라우트(뷰어용) — 필요한 필드만 화이트리스트로 반환.
  // 전체 스프레드 금지: deskLog(지난 손님 응대 기록)·wayfindLog·owner 등이 노출됐던 문제 수정.
  res.json({
    id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
    pipeline: s.pipeline || 'whisper', preset: s.preset || null, src: s.src || null, // src: 호스트 화면 재진입 시 소리 입력 복원(목록에서 열 때 이 값이 쓰인다)
    langs: s.langs || [], outLang: s.outLang, inLang: s.inLang,
    sxInfo: s.sxInfo || null, speakers: s.speakers || {},
    deskFloor: s.deskFloor || null, deskSide: s.deskSide || null,
    items: s.items || [],
  });
});

// 데스크 뷰어 랜딩(공개): 안내데스크 세션 목록(id·제목·가동 여부) — 표시 전용이다.
// 뷰어 토큰이 없어 여기서 방을 골라 입장할 수는 없고(태블릿은 로그인한 직원이 발급한 세션별 QR 로 1회 설치),
// 이 목록은 어떤 데스크가 등록·가동 중인지 보여주기만 한다.
app.get('/api/desk-sessions', (req, res) => {
  const list = sessions
    .filter((s) => s.pipeline === 'desk' && !s.deletedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    // active = 호스트(안내원)가 마이크 캡처 중(대기 가능). 비활성이면 손님이 선택 못 함.
    // t(뷰어 접근 토큰)는 여기서 내려보내지 않는다 — 이 라우트는 무인증 공개라, 토큰을 실으면
    // 인터넷에서 누구나 진행 중인 승객 대화를 수신하고 desk-end 로 응대를 종료할 수 있다.
    // 태블릿은 로그인한 직원만 열 수 있는 GET /api/qr?session=.. 로 1회 프로비저닝한다(안내원 조작 0회).
    .map((s) => ({ id: s.id, title: s.title || '안내데스크', active: !!(rooms.get(s.id) && rooms.get(s.id).hosts.size > 0) }));
  res.json(list);
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  // 데스크 세션은 전 직원이 운영(층/방향·화자명 등 조작) — 소유자 제한 없음. 그 외에는 본인/관리자만.
  if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  // 데스크 세션 제목 변경(관리 행위)은 관리자만
  if (s.pipeline === 'desk' && typeof (req.body || {}).title === 'string' && req.user.role !== 'admin') delete req.body.title;
  // pipeline 은 생성 시 고정. title·inLang 수정 허용. outLang 은 translate 의 타깃 변경용.
  const b = req.body || {};
  if (typeof b.title === 'string') s.title = b.title;
  if (typeof b.inLang === 'string') s.inLang = b.inLang;
  // 모드(preset) 변경: 번역 이력이 없고 '녹음 중이 아닌' soniox 세션만 허용(진행 중 방향/설정 desync 방지)
  const activeHosts = rooms.get(req.params.id)?.hosts.size || 0;
  if (typeof b.preset === 'string' && s.pipeline === 'soniox' && activeHosts === 0 && (!Array.isArray(s.items) || s.items.length === 0)) {
    const m = normalizeMode(b.preset, typeof b.src === 'string' ? b.src : s.src, 'mic');
    if (m) { s.preset = m.preset; s.src = m.src; }
  } else if (typeof b.src === 'string' && s.pipeline === 'soniox' && (PRESET_SRC[s.preset] || []).includes(b.src)) {
    // 소스는 번역 이력과 무관(방향이 바뀌지 않음) — 이력이 있어도 변경 허용. 녹음 중 변경은 클라가 막는다.
    s.src = b.src;
  }
  if (s.pipeline === 'desk') { // 데스크 출발 층/방향
    if (['1F', '2F', '3F', '4F'].includes(b.deskFloor)) s.deskFloor = b.deskFloor;
    if (['E', 'W', 'S', 'N'].includes(b.deskSide)) s.deskSide = b.deskSide;
  }
  if (typeof b.outLang === 'string' && LANG_NAMES[b.outLang]) {
    s.outLang = b.outLang;
    if (s.pipeline === 'translate') s.langs = [b.outLang]; // translate 출력 언어 변경
  }
  // 화자 이름 매핑(diarization): { "1": "지정이름", ... } — 다운로드/요약/뷰어 공용
  if (b.speakers && typeof b.speakers === 'object' && !Array.isArray(b.speakers)) {
    const clean = {};
    for (const [k, v] of Object.entries(b.speakers)) {
      if (typeof v === 'string') { const nv = v.trim().slice(0, 40); if (nv) clean[String(k)] = nv; }
    }
    s.speakers = clean;
    broadcast(req.params.id, { type: 'speakers', speakers: clean }); // 뷰어(모바일) 실시간 반영
  }
  // 참여자 PTT(휴대폰 누르고 말하기) on/off — 뷰어에 실시간 반영
  s.updatedAt = Date.now();
  saveSessions();
  res.json(s);
});

// 세션 대화 내역만 비우기(세션 자체는 유지) — 세션 화면의 '…' 메뉴에서 사용자가 직접.
//  본인 세션(또는 관리자), 데스크는 관리자만. 라이브 뷰어 화면도 비운다.
app.delete('/api/sessions/:id/items', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 대화 내역은 관리자만 삭제할 수 있습니다.' });
  if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const n = Array.isArray(s.items) ? s.items.length : 0;
  s.items = [];
  s.updatedAt = Date.now();
  saveSessions();
  broadcast(req.params.id, { type: 'snapshot', items: [] }); // 접속 중인 뷰어 화면도 비움
  res.json({ ok: true, deleted: n });
});

// 지금 링크로 접속한 뷰어 수(폰 호스트 화면 표시용 — 번역 시작 전에도) — 호스트 화면의 패시브 뷰어는 제외
app.get('/api/sessions/:id/viewers', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const r = rooms.get(s.id);
  res.json({ n: r ? [...r.viewers].filter((v) => !v._hostView).length : 0 });
});
app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (s) {
    // 안내데스크 세션 삭제(관리 행위)는 관리자만
    if (s.pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 삭제할 수 있습니다.' });
    if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    if (s.pipeline === 'desk') {
      // 안내데스크(관리자 전용 삭제): 소프트 삭제 — 응대 통계·로그(deskLog)는 관리자 페이지에서 따로 정리
      s.deletedAt = Date.now();
      saveSessions();
    } else {
      // 일반 세션: 대화 기록까지 완전 삭제(2026-10-22 — 삭제한 대화가 관리자 로그에 남지 않게, 회의 녹취 개인정보)
      setSessions(sessions.filter((x) => x.id !== s.id));
      deleteSessionStore(s.id);
      if (!col) saveSessions();
    }
  }
  closeSessionRoom(req.params.id);
  res.json({ ok: true });
});
// 삭제된 세션의 연결 소켓(호스트·뷰어)을 먼저 정리하고 방 상태를 지운다 — rooms 만 지우면 이미 접속한
// 소켓들이 고아 room 상태를 들고 좀비 스트리밍(비용)·발화 락 오염을 일으킨다. (세션 삭제·계정 삭제 공용)
function closeSessionRoom(sid) {
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

/* ================================================================== */
/*  실시간 방(room) : 세션ID 기준. 호스트(여러 소스) + 뷰어 N           */
/* ================================================================== */
// 뷰어(무인증 공개 QR) 접속 상한 — 세션 id 만 알면 소켓을 대량으로 열어 메모리(스냅샷 전송)·
// 발화 락을 잠식하는 DoS 를 막는다. 세션당 상한은 강의 청중(수백 명)을 수용할 만큼 넉넉히,
// IP당 상한은 한 단말의 남용을 좁게 막는다(정상 손님은 세션당 1~2개면 충분).
const VIEWERS_PER_SESSION = 300;
const VIEWERS_PER_IP = 100; // 견학 일행이 공용 와이파이(같은 공인 IP)로 들어와도 막히지 않게(8 → 100, 2026-10-22). QR 토큰·세션당 상한이 DoS 를 막는다
const rooms = new Map(); // sessionId -> { viewers:Set<ws>, hosts:Set<ws> }
const deskCtrl = new Map(); // sessionId -> { start(lang), end() } — 데스크: 뷰어(손님)의 통역 시작/종료를 호스트 파이프라인에 전달
function getRoom(sessionId) {
  if (!rooms.has(sessionId)) rooms.set(sessionId, { viewers: new Set(), hosts: new Set() });
  return rooms.get(sessionId);
}
function broadcast(sessionId, payload) {
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
function broadcastAudio(sessionId, b64, lang) {
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
function hasAudioListener(sessionId, lang) {
  const room = rooms.get(sessionId);
  if (!room) return false;
  for (const v of room.viewers) {
    if (v._audioWanted && v.readyState === WebSocket.OPEN && !(lang && v._audioLang && v._audioLang !== lang)) return true;
  }
  return false;
}
// TTS 음성을 호스트로 — 뷰어(상대) 발화의 번역을 호스트가 듣게 함
function sendAudioToHosts(sessionId, b64, lang) {
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
function noteTts(sessionId, text) {
  const n = echoNorm(text);
  if (n.length < 4) return;
  const arr = recentTts.get(sessionId) || [];
  arr.push({ n, at: Date.now() });
  while (arr.length > 16) arr.shift();
  recentTts.set(sessionId, arr);
}
function isSelfEcho(sessionId, text) {
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

/* ------------------------------------------------------------------ */
/*  로컬 네트워크 IP (모바일 접속용)                                    */
/* ------------------------------------------------------------------ */
function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

/* ---- 데스크톱 앱 배포 (GitHub Release 최신 설치본) — Windows(.exe) + macOS(.dmg) ----
   info: 최신 릴리스의 플랫폼별 설치파일 존재·버전·크기를 반환(10분 캐시).
   download?platform=win|mac: 비공개 repo 는 서버가 토큰으로 에셋을 스트리밍(사용자 GitHub 인증 불필요),
             공개 repo/토큰 없음이면 browser_download_url 로 리다이렉트, env 지정 시 그 주소로. */
let _desktopCache = { at: 0, data: null };
async function fetchLatestDesktop() {
  if (DESKTOP_DOWNLOAD_URL) {
    const fn = (DESKTOP_DOWNLOAD_URL.split('/').pop() || 'KAC-Translator-Setup.exe').split('?')[0];
    return { available: true, source: 'env', url: DESKTOP_DOWNLOAD_URL, win: { filename: fn }, mac: null };
  }
  if (_desktopCache.data && Date.now() - _desktopCache.at < 10 * 60 * 1000) return _desktopCache.data;
  let data;
  try {
    const h = { Accept: 'application/vnd.github+json', 'User-Agent': 'kac-translator', 'X-GitHub-Api-Version': '2022-11-28' };
    if (GITHUB_TOKEN) h.Authorization = `Bearer ${GITHUB_TOKEN}`;
    // 최신순 릴리스 목록에서 '설치본 에셋(.exe/.dmg)이 하나라도 있는' 첫 릴리스를 고른다 —
    // 앱과 무관한 태그 릴리스가 섞여 있어도 데스크톱 설치본을 정확히 찾는다.
    const r = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases?per_page=20`, { headers: h });
    if (!r.ok) {
      data = { available: false, reason: r.status === 404 ? 'no-release' : `gh-${r.status}` };
    } else {
      const rels = await r.json();
      const assetInfo = (a) => (a ? { filename: a.name, size: a.size || null, assetId: a.id, browserUrl: a.browser_download_url || null } : null);
      let found = null;
      for (const rel of (Array.isArray(rels) ? rels : [])) {
        if (rel.draft) continue;
        const assets = Array.isArray(rel.assets) ? rel.assets : [];
        const win = assets.find((a) => /\.exe$/i.test(a.name));
        // mac: universal(인텔+애플실리콘 겸용) 우선, 없으면 첫 dmg
        const macs = assets.filter((a) => /\.dmg$/i.test(a.name));
        const mac = macs.find((a) => /universal/i.test(a.name)) || macs[0];
        // android: 버전마다 파일명이 달라 한 릴리스에 여러 개가 쌓일 수 있다 → 가장 최근에 올라온 것
        const android = assets.filter((a) => /\.apk$/i.test(a.name))
          .sort((x, y) => String(y.updated_at || '').localeCompare(String(x.updated_at || '')))[0];
        if (win || mac || android) { found = { rel, win, mac, android }; break; }
      }
      data = found
        ? { available: true, source: 'github', version: found.rel.tag_name || found.rel.name || null, publishedAt: found.rel.published_at || null, win: assetInfo(found.win), mac: assetInfo(found.mac), android: assetInfo(found.android) }
        : { available: false, reason: 'no-asset' };
    }
  } catch (e) {
    data = { available: false, reason: (e && e.message) || 'error' };
  }
  _desktopCache = { at: Date.now(), data };
  return data;
}
const platMeta = (a) => (a ? { filename: a.filename || null, size: a.size || null } : null);
app.get('/api/desktop/info', requireAuth, async (req, res) => {
  const d = await fetchLatestDesktop();
  res.json({
    available: !!d.available,
    version: d.version || null,
    publishedAt: d.publishedAt || null,
    windows: d.available ? platMeta(d.win) : null,
    mac: d.available ? platMeta(d.mac) : null,
    android: d.available ? platMeta(d.android) : null,
    reason: d.available ? null : (d.reason || null),
  });
});
app.get('/download/desktop', requireAuth, (req, res) => {
  const plat = req.query.platform === 'mac' ? 'mac' : req.query.platform === 'android' ? 'android' : 'win';
  sendLatestInstaller(res, plat);
});
// 휴대폰 브라우저 접속 = 로그인 없이 앱 설치 안내(폰은 앱으로만 쓴다) — APK 는 공개 GitHub 릴리스와 같은 파일이고
// 앱 안에서도 로그인해야 쓸 수 있으므로 공개해도 된다. 안드로이드만(데스크톱 설치본은 그대로 로그인 필요).
app.get('/app', (req, res) => sendLatestInstaller(res, 'android')); // 앱 받기(2026-10-27, 예전 /download/android)
async function sendLatestInstaller(res, plat) {
  const d = await fetchLatestDesktop();
  if (!d.available) return res.status(404).send('설치파일이 아직 준비되지 않았습니다. 관리자에게 문의하세요.');
  if (d.source === 'env') return res.redirect(d.url);
  const asset = plat === 'mac' ? d.mac : plat === 'android' ? d.android : d.win;
  const platName = { mac: 'macOS', android: 'Android', win: 'Windows' }[plat];
  if (!asset) return res.status(404).send(`${platName} 설치파일이 아직 준비되지 않았습니다.`);
  // 공개 repo 이고 서버 토큰이 없으면 GitHub 다운로드 URL 로 바로 보냄
  if (!GITHUB_TOKEN && asset.browserUrl) return res.redirect(asset.browserUrl);
  // 비공개 repo: 서버가 토큰으로 에셋 바이너리를 받아 그대로 흘려보냄(사용자 인증 불필요)
  try {
    const gh = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/assets/${asset.assetId}`, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'kac-translator', Authorization: `Bearer ${GITHUB_TOKEN}` },
      redirect: 'follow',
    });
    if (!gh.ok || !gh.body) return res.status(502).send('다운로드 실패: GitHub ' + gh.status);
    // APK 는 전용 MIME 이어야 안드로이드 브라우저가 다운로드 후 바로 설치 화면을 띄운다
    res.setHeader('Content-Type', plat === 'android' ? 'application/vnd.android.package-archive' : 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(asset.filename || 'KAC-Translator-Setup').replace(/"/g, '')}"`);
    if (asset.size) res.setHeader('Content-Length', String(asset.size));
    Readable.fromWeb(gh.body).pipe(res);
  } catch (e) {
    res.status(502).send('다운로드 실패: ' + ((e && e.message) || '오류'));
  }
}

/* ---- 뷰어(공개 QR) 접근 토큰 --------------------------------------------
   세션 id 로부터 AUTH_SECRET 으로 파생하는 무상태 서명. QR/링크에 &t= 로 실어 보내고,
   서버가 재계산해 대조한다. 세션마다 고정이라 인쇄 QR 이 계속 유효(데스크 운영과 호환)이고,
   저장/마이그레이션이 필요 없다 — 기존 세션도 자동 적용. 목적: 세션 id 열거로 뷰어를 무단
   개설하는 자동화 접근 차단(자원 고갈형 DoS 는 뷰어 접속 상한이 별도로 막는다).
   로그인한 직원/관리자는 토큰 없이도 접근 가능(호스트 앱·관리자 화면 그대로 동작). */
function viewerToken(sessionId) {
  return crypto.createHmac('sha256', AUTH_SECRET).update('viewer:' + String(sessionId)).digest('hex').slice(0, 16);
}
function viewerTokenValid(sessionId, t) {
  if (!t) return false;
  const a = Buffer.from(String(t)); const b = Buffer.from(viewerToken(sessionId));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// 공개 뷰어 라우트 게이트: 유효 토큰 또는 로그인 사용자만 통과.
function viewerAccessOk(req, sessionId) {
  return !!currentUser(req) || viewerTokenValid(sessionId, req.query && req.query.t);
}

const joinMisses = new Map(); // ip -> { n, at } — 틀린 코드 10분에 20번 넘으면 잠시 차단
function joinBlocked(ip) {
  const m = joinMisses.get(ip);
  if (!m) return false;
  if (Date.now() - m.at > 10 * 60 * 1000) { joinMisses.delete(ip); return false; }
  return m.n >= 20;
}
function joinMiss(ip) {
  const m = joinMisses.get(ip);
  if (!m || Date.now() - m.at > 10 * 60 * 1000) joinMisses.set(ip, { n: 1, at: Date.now() });
  else m.n++;
}
// 뷰어 페이지(빌드 산출물 dist/viewer/*.html)에 이 세션 정보를 심어 보낸다 — 페이지는 window.__JOIN 을 읽는다
const viewerHtmlCache = new Map();
function sendViewerPage(res, file, join) {
  let html = viewerHtmlCache.get(file);
  if (!html) {
    try { html = fs.readFileSync(path.join(STATIC_DIR, 'viewer', file), 'utf8'); } catch { return res.status(404).send('viewer page missing — run npm run build'); }
    if (process.env.NODE_ENV === 'production') viewerHtmlCache.set(file, html);
  }
  const inject = `<script>window.__JOIN=${JSON.stringify(join || {}).replace(/</g, '\\u003c')};</script>`;
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html.replace('</head>', inject + '</head>'));
}
function joinPage(req, res, desk) {
  const code = req.params.code;
  if (!code) return sendViewerPage(res, desk ? 'desk.html' : 'join.html', {});
  const ip = loginIp(req);
  if (joinBlocked(ip)) return sendViewerPage(res, desk ? 'desk.html' : 'join.html', { notFound: true, blocked: true, code: String(code).slice(0, 6) });
  const s = sessionByJoinCode(code);
  if (!s) { joinMiss(ip); return sendViewerPage(res, desk ? 'desk.html' : 'join.html', { notFound: true, code: String(code).slice(0, 6) }); }
  const isDesk = s.pipeline === 'desk';
  if (isDesk !== !!desk) return res.redirect(302, (isDesk ? '/desk/' : '/j/') + s.joinCode); // 안내데스크는 /desk(앱이 손님 태블릿 모드로 연다)
  sendViewerPage(res, isDesk ? 'desk.html' : 'join.html', { session: s.id, t: viewerToken(s.id), code: s.joinCode });
}
app.get(['/j', '/j/:code'], (req, res) => joinPage(req, res, false));
// 같은 정보를 JSON 으로(앱·테스트용) — 틀린 코드 횟수 제한은 페이지와 공유
app.get('/api/join/:code', (req, res) => {
  const ip = loginIp(req);
  if (joinBlocked(ip)) return res.status(429).json({ error: 'too many attempts' });
  const s = sessionByJoinCode(req.params.code);
  if (!s) { joinMiss(ip); return res.status(404).json({ error: 'not found' }); }
  res.json({ session: s.id, t: viewerToken(s.id), code: s.joinCode, desk: s.pipeline === 'desk' });
});
app.get(['/desk', '/desk/:code'], (req, res) => joinPage(req, res, true));
app.get('/overlay', (req, res) => sendViewerPage(res, 'overlay.html', {}));
// 예전 주소(…/mobile.html?session=&t=, …/desk.html) → 새 참여 주소로(이미 찍어 둔 QR·링크용). 토큰이 맞을 때만 그 세션으로.
app.get(['/mobile.html', '/desk.html'], (req, res) => {
  const desk = req.path === '/desk.html';
  const sid = String(req.query.session || '');
  const s = sid && viewerTokenValid(sid, req.query.t) ? getSession(sid) : null;
  if (s) return res.redirect(301, (s.pipeline === 'desk' ? '/desk/' : '/j/') + ensureJoinCode(s));
  res.redirect(301, desk ? '/desk' : '/j');
});

/* ---- QR (세션별 모바일 URL) ---- */
app.get('/api/qr', async (req, res) => {
  const sessionId = String(req.query.session || '');
  // 데스크 랜딩 QR: session 없이 호출하면 안내데스크 선택 화면(desk.html)으로
  const landing = req.query.desk === '1' || (!sessionId && req.query.landing === '1');
  if (!sessionId && !landing) return res.status(400).json({ error: 'session required' });
  // 특정 세션 QR 은 유효 토큰(자신의 뷰어에서 공유) 또는 로그인 사용자만. 랜딩(세션 없음)은 공개.
  if (sessionId && !viewerAccessOk(req, sessionId)) return res.status(403).json({ error: 'forbidden' });
  // 배포 환경: 요청 host/proto 사용(Render 등은 x-forwarded-* 로 전달).
  let proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  // PUBLIC_HOST(운영 도메인, 예: airtalk.kr)가 있으면 어느 주소로 접속했든 QR 은 그 도메인으로 —
  // 옛 주소(translate-voxm.onrender.com)로 접속한 구버전 앱에서 만든 QR 도 새 도메인을 가리키게(2026-10-27)
  if (process.env.PUBLIC_HOST) {
    host = process.env.PUBLIC_HOST;
    proto = 'https';
  } else if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host)) {
    // 로컬 접속(localhost)이면 같은 와이파이 모바일이 닿도록 LAN IP 로 대체.
    host = `${getLanIp()}:${PORT}`;
    proto = 'http';
  }
  // 데스크 안내 모드는 전용(최소 UI·터치 시작·전체화면) 뷰어로. 랜딩(세션 선택)은 desk.html (세션 없이)
  const sess = sessionId ? getSession(sessionId) : null;
  let url, code = null;
  if (landing) url = `${proto}://${host}/desk`;
  else {
    if (!sess) return res.status(404).json({ error: 'not found' });
    code = ensureJoinCode(sess);
    url = `${proto}://${host}/${sess.pipeline === 'desk' ? 'desk' : 'j'}/${code}`;
  }
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ url, qr: dataUrl, code });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

/* 보이스 미리듣기: 출력언어+성별로 짧은 테스트 음성(wav) 생성 */
app.post('/api/tts/preview', requireAuth, async (req, res) => {
  if (!CARTESIA_API_KEY) return res.status(400).json({ error: 'CARTESIA_API_KEY 미설정' });
  const b = req.body || {};
  const lang = ['ko', 'en', 'ja', 'zh'].includes(b.lang) ? b.lang : 'ko';
  const gender = b.gender === 'm' ? 'm' : 'f';
  try {
    const r = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': CARTESIA_API_KEY, 'Cartesia-Version': CARTESIA_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: CARTESIA_MODEL, transcript: TTS_TEST_PHRASE[lang], voice: { mode: 'id', id: cartesiaVoiceId(lang, gender) }, language: lang, output_format: { container: 'wav', encoding: 'pcm_s16le', sample_rate: 24000 } }),
    });
    if (!r.ok) return res.status(502).json({ error: 'tts ' + r.status });
    res.setHeader('Content-Type', 'audio/wav');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* 헬스체크 (Render healthCheck / UptimeRobot 슬립 방지용 핑) */
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

/* SPA 폴백: API 외 GET 은 React index.html */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  const idx = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  next();
});

/* ------------------------------------------------------------------ */
/*  WebSocket 라우팅                                                     */
/*   /ws/host?session=ID&src=mic|system&out=ko                          */
/*   /ws/viewer?session=ID                                              */
/* ------------------------------------------------------------------ */
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 }); // 1MB — 무인증 뷰어의 초대형 프레임 메모리 스파이크 방지

server.on('upgrade', (req, socket, head) => {
  try {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const hostUser = pathname === '/ws/host' ? currentUser(req) : null;
  if (pathname === '/ws/host' && !hostUser) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  // 공개 뷰어: 유효 토큰(QR 에 포함) 또는 로그인 사용자만. id 열거로 무단 접속하는 것을 막는다.
  if (pathname === '/ws/viewer' && !currentUser(req) && !viewerTokenValid(searchParams.get('session') || '', searchParams.get('t'))) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }
  if (pathname === '/ws/host' || pathname === '/ws/viewer') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._kind = pathname === '/ws/host' ? 'host' : 'viewer';
      ws._ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '').trim(); // 뷰어 IP당 접속 상한용
      ws._userId = hostUser ? hostUser.id : null;
      ws._session = searchParams.get('session') || 'default';
      ws._hostView = searchParams.get('role') === 'host'; // 호스트 화면의 패시브 뷰어 — 데스크 현황판 '뷰어 수'에서 제외
      ws._src = searchParams.get('src') || 'mic'; // mic | system
      ws._out = searchParams.get('out') || TARGET_LANG;
      ws._in = searchParams.get('in'); // 입력 언어 코드 | 'auto' | null
      ws._pipeline = searchParams.get('pipeline'); // 'whisper' | 'translate' | null
      ws._audioOut = searchParams.get('audioOut') === '1'; // translate 번역 음성 재생 여부
      ws._sxSens = searchParams.get('sxSens');       // soniox endpoint_sensitivity (-1~1)
      ws._sxMaxDelay = searchParams.get('sxMaxDelay'); // soniox max_endpoint_delay_ms (500~3000)
      ws._sxLatency = searchParams.get('sxLatency');   // soniox endpoint_latency_adjustment_level (0~3)
      ws._sxMode = searchParams.get('sxMode');     // soniox 번역 방향 'one'|'two'
      ws._sxTarget = searchParams.get('sxTarget'); // 단방향 타깃 언어
      ws._sxA = searchParams.get('sxA');           // 양방향 언어 A
      ws._sxB = searchParams.get('sxB');           // 양방향 언어 B
      ws._tts = searchParams.get('tts');           // soniox 실시간 TTS on('1')
      ws._gender = searchParams.get('gender');     // 음성 성별 'm' | 'f'
      ws._diar = searchParams.get('diar');         // 화자 구분 on('1')
      ws._deskLangs = searchParams.get('deskLangs'); // desk 후보 언어(콤마구분) — 취항국
      ws._deskIdle = searchParams.get('deskIdle');   // desk 외국어 무음 리셋(ms)
      ws._deskGuestSens = searchParams.get('deskGuestSens'); // desk 여객 태블릿 마이크 민감도(0~100)
      ws._dropAcks = searchParams.get('dropAcks');   // 단독 응답어(네/Yes) 기록 생략(고급옵션)
      ws._confFix = searchParams.get('confFix');     // 저신뢰 자동 교정(고급옵션)
      ws._wayfind = searchParams.get('wayfind');     // 데스크 길안내 지도 on/off('0'=끔)
      // 실시간 번역 채널 분리(양방향 통역을 채널별 단방향으로): 시스템+마이크, 스테레오 마이크 2채널.
      ws._role = searchParams.get('role');           // 'me'(내 채널) | 'them'(상대 채널) | null(단일 채널)
      ws._drop = searchParams.get('drop');           // 이 채널에서 인식되면 버릴 언어(=반대 채널의 언어 → 스피커·핀마이크로 샌 소리)
      ws._pair = searchParams.get('pair');           // 'a,b' — 세션 표시용 언어쌍(뷰어가 내 언어/상대 언어로 정렬)
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
  } catch (e) {
    // 비정상 Host 헤더(URL 파싱 실패)·깨진 % 쿠키 등 동기 예외 시 TCP 소켓을 방치하지 않는다(FD 누수 방지)
    logErr('ws-upgrade', e);
    try { socket.destroy(); } catch {}
  }
});

wss.on('connection', (ws) => {
  ws._alive = true;
  ws.on('error', (e) => logErr('ws-' + (ws._kind || '?'), e)); // ECONNRESET 등 — error 후 close 가 이어져 락 해제는 기존 경로로
  ws.on('pong', () => { ws._alive = true; });
  if (ws._kind === 'viewer') return handleViewer(ws);
  return handleHost(ws);
});

// 하트비트: 절전·망 단절로 FIN 없이 사라진 소켓을 주기 감지·정리.
// 없으면 죽은 연결이 데스크 active 표시와 room 을 영구 점유한다.
const HEARTBEAT_MS = 30000;
const hbTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._alive === false) { try { ws.terminate(); } catch {} continue; } // pong 미응답 → 강제 종료(close 핸들러가 락 해제)
    ws._alive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
hbTimer.unref();
// 뷰어 생존 신호(앱 메시지) — 브라우저는 위 프로토콜 ping 을 JS 에 보여 주지 않아, 망 전환·절전 복귀 후 '열린 채 죽은' 연결을
// 뷰어가 스스로 알아챌 수 없다(호스트는 번역 중인데 뷰어 화면만 멈춤). 15초마다 보내고 뷰어는 35초 무수신이면 새로 연결한다.
const VIEWER_HB_MS = Number(process.env.VIEWER_HB_MS) || 15000; // 테스트에서만 짧게
const VIEWER_HB_MSG = JSON.stringify({ type: 'hb' });
const viewerHbTimer = setInterval(() => {
  for (const r of rooms.values()) {
    for (const v of r.viewers) { if (!v._hostView && v.readyState === WebSocket.OPEN) { try { v.send(VIEWER_HB_MSG); } catch {} } }
  }
}, VIEWER_HB_MS);
viewerHbTimer.unref();

// 빈 room 정리: 마지막 연결이 떠나면 세션별 부속 상태도 회수(메모리 누수 방지)
function maybeGcRoom(sessionId) {
  const r = rooms.get(sessionId);
  if (r && r.hosts.size === 0 && r.viewers.size === 0 && !r.guestFeeder) { // 여객 피더(PC 직결)만 남은 room 은 유지
    rooms.delete(sessionId);
    recentTts.delete(sessionId);
  }
}

/* ----------------------------- 뷰어 ------------------------------- */
function handleViewer(ws) {
  const room = getRoom(ws._session);
  // 접속 상한(무인증 QR DoS 방어). 호스트 화면의 패시브 뷰어(_hostView)는 상한에서 제외.
  if (!ws._hostView) {
    const realViewers = [...room.viewers].filter((v) => !v._hostView);
    if (realViewers.length >= VIEWERS_PER_SESSION) {
      try { ws.send(JSON.stringify({ type: 'error', code: 'room_full', message: '접속자가 많아 잠시 후 다시 시도해 주세요.' })); } catch {}
      try { ws.close(1013, 'room full'); } catch {}
      return;
    }
    if (ws._ip) {
      const sameIp = realViewers.filter((v) => v._ip === ws._ip).length;
      if (sameIp >= VIEWERS_PER_IP) {
        try { ws.send(JSON.stringify({ type: 'error', code: 'ip_limit', message: '동일 기기에서 접속이 너무 많습니다.' })); } catch {}
        try { ws.close(1013, 'ip limit'); } catch {}
        return;
      }
    }
  }
  room.viewers.add(ws);
  ws._audioWanted = false; // '음성 듣기' 구독 여부
  const s = getSession(ws._session);
  // tm(레이턴시)·toks(신뢰도)는 저장 전용 — 뷰어 스냅샷에서 제외(라이브 buildMsg 와 동일 규약)
  ws.send(JSON.stringify({ type: 'snapshot', items: s ? s.items.map(({ tm, toks, ...it }) => it) : [] }));
  ws.send(JSON.stringify({ type: 'host', active: room.hosts.size > 0 })); // 현재 호스트 활성 여부
  {
    const dc = deskCtrl.get(ws._session);
    const gs = dc && dc.guestSens ? dc.guestSens() : undefined;
    const m2 = dc && dc.mic2 ? dc.mic2() : undefined; // PC 호스트가 여객 마이크 공급 중이면 뷰어는 표출 전용
    if (s && s.sxInfo) ws.send(JSON.stringify({ type: 'meta', sxInfo: s.sxInfo, ...(gs != null ? { guestSens: gs } : {}), ...(m2 != null ? { mic2: m2 } : {}) })); // 접속/재접속 시 현재 상태 동기화
  }
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // 데스크 여객 태블릿 마이크(2채널) — desk-mic on 을 보낸 뷰어의 오디오는 여객 채널로
      // 그 외 뷰어 오디오는 버린다 — 뷰어 발화(PTT)는 폐지됐고, 뷰어 소켓이 유료 엔진을 여는 경로는 데스크 여객 마이크뿐이다.
      if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.feedGuest) { dc.feedGuest(data, ws); return; } }
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'audioSub') { ws._audioWanted = !!m.on; ws._audioLang = typeof m.lang === 'string' && /^[a-z]{2,3}$/.test(m.lang) ? m.lang : null; }
      else if (m.type === 'desk-start') {
        // 데스크: 손님이 태블릿에서 언어 선택 → 호스트 파이프라인에서 soniox 양방향 통역 시작
        if (!deskCtlAllowed(ws, room)) { ws.send(JSON.stringify({ type: 'status', message: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.' })); return; }
        const ctrl = deskCtrl.get(ws._session);
        // consent: 손님이 태블릿 고지 모달에서 '동의하고 시작'을 누른 시점(감사 근거).
        // 구버전 캐시 클라는 이 필드를 안 보내므로 없으면 기록만 생략한다(하위 호환).
        if (ctrl) ctrl.start(String(m.lang || '').toLowerCase(), m.consent ? Date.now() : null);
        else ws.send(JSON.stringify({ type: 'status', message: '안내원이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.' }));
      } else if (m.type === 'desk-end') {
        // 데스크: 손님 화면의 종료(✕) — 대화 종료 후 대기 모드로
        if (!deskCtlAllowed(ws, room)) return;
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl) ctrl.end();
      } else if (m.type === 'desk-keepalive') {
        // 데스크: 종료 예고 배너 터치 → 무음 타이머 연장
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.keepalive) ctrl.keepalive();
      } else if (m.type === 'desk-mic') {
        // 데스크: 여객 태블릿 마이크 채널 on/off — 2채널 화자 귀속
        if (!deskCtlAllowed(ws, room, true)) return; // on 마다 여객 엔진 재체결(과금)이 따르므로 난사 차단(간격 제한은 제외)
        ws._deskMic = !!m.on;
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.guestMic) ctrl.guestMic(!!m.on, ws);
      }
    } catch {}
  });
  ws.on('close', () => {
    room.viewers.delete(ws);
    if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.guestMic) dc.guestMic(false, ws); } // 여객 마이크 이탈 → 단일 채널 폴백
    maybeGcRoom(ws._session);
  });
}

/* ---- 데스크 2마이크(PC 호스트): 여객 마이크 오디오 공급 전용 연결 ----
   호스트 PC 가 지향성 마이크 2대를 직접 잡아 두 번째 장치를 src=guestmic 연결로 스트리밍한다.
   컨트롤러·사용량·발화 락·유휴 타이머 등 일반 호스트 파이프라인은 만들지 않고,
   기존 데스크 파이프라인의 여객 채널(guestMic/feedGuest — 뷰어 desk-mic 와 동일 경로)에 오디오만 흘린다. */
function runDeskGuestFeed(ws) {
  const sessionId = ws._session;
  ws._deskGuestFeed = true; // guestMic 소유권 우선순위 판단용(호스트 공급 > 뷰어 태블릿)
  // room.hosts 에 넣지 않는다 — host active 계산을 오염시키지 않기 위해
  // 전용 슬롯(guestFeeder)로만 추적. 하트비트는 wss.clients 전체를 돌므로 좀비 감지엔 문제 없음.
  const room = getRoom(sessionId);
  if (room.guestFeeder && room.guestFeeder !== ws) {
    // 같은 세션의 이전 여객 공급 연결은 승계(새로고침 좀비 정리 — 일반 호스트 takeover 와 동일 규칙)
    try { room.guestFeeder.send(JSON.stringify({ type: 'takeover' })); } catch {}
    try { room.guestFeeder.close(); } catch {}
  }
  room.guestFeeder = ws;
  // 데스크 컨트롤러(본 호스트 연결)가 아직 없을 수 있음(두 파이프 동시 오픈 레이스) — 잠시 재시도
  let attachTries = 0;
  const attach = () => {
    const dc = deskCtrl.get(sessionId);
    if (dc && dc.guestMic) { dc.guestMic(true, ws); return true; }
    return false;
  };
  const attachTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN || attach() || ++attachTries > 20) clearInterval(attachTimer);
  }, 500);
  attach();
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const dc = deskCtrl.get(sessionId);
      if (dc && dc.feedGuest) dc.feedGuest(data, ws);
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'stop') { try { ws.close(); } catch {} }
      // commit/activity 등 일반 호스트 제어는 여객 채널에 해당 없음(soniox 엔드포인트가 확정) — 무시
    } catch {}
  });
  ws.on('close', () => {
    clearInterval(attachTimer);
    const r = rooms.get(sessionId);
    if (r && r.guestFeeder === ws) r.guestFeeder = null;
    const dc = deskCtrl.get(sessionId);
    if (dc && dc.guestMic) dc.guestMic(false, ws); // 소유자였으면 단일 채널 폴백(내부 소유권 체크)
  });
}

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
function handleHost(ws) {
  const sessionId = ws._session;
  // 데스크 여객 마이크 공급 전용 연결(2마이크 모드) — 일반 호스트 파이프라인을 타지 않는다
  if (ws._src === 'guestmic') return runDeskGuestFeed(ws);
  const side = ws._src === 'system' || ws._src === 'mic2' ? 'left' : 'right'; // 시스템·상대 마이크(스테레오 R)=좌, 내 마이크=우
  const session = getSession(sessionId);
  // 동시접속 충돌 방지: 같은 세션·같은 소스로 이미 녹음 중인 연결이 있으면 그쪽을 종료하고 새 연결이 승계.
  // (같은 계정으로 다른 기기/탭에서 시작하거나, 새로고침 후 좀비 연결이 남은 경우 — 나중 연결 우선)
  for (const h of [...getRoom(sessionId).hosts]) {
    if (h !== ws && h._src === ws._src) {
      try { h.send(JSON.stringify({ type: 'takeover' })); } catch {}
      try { h.close(); } catch {}
    }
  }
  // room.hosts 에 등록 + 활성 신호(뷰어의 '진행 중' 표시·데스크 가동 여부)
  getRoom(sessionId).hosts.add(ws);
  broadcast(sessionId, { type: 'host', active: true });
  ws.on('close', () => {
    const r = rooms.get(sessionId);
    if (r) {
      r.hosts.delete(ws);
      if (r.hosts.size === 0) broadcast(sessionId, { type: 'host', active: false });
    }
    maybeGcRoom(sessionId);
  });
  // 사용량 집계: 호스트 WS 연결 시간 → 사용자별 누적 + 파이프라인별 일별 비용.
  // 데스크는 예외 — 대기(idle)는 STT 미연결(비용 0)이므로 실제 통역(active) 시간만 집계.
  const usageStart = Date.now();
  ws.on('close', () => {
    const ms = pipeline === 'desk'
      ? (ws._deskActiveMs || 0) + (ws._deskActiveStart ? Date.now() - ws._deskActiveStart : 0)
      : Date.now() - usageStart;
    addUsage(ws._userId, ms);
    recordUsage(pipeline, ms); // pipeline 은 아래에서 정의됨(close 시점엔 초기화 완료)
  });
  // 유휴 자동 종료: 1분간 음성 활동(전사/번역 델타)이 없으면 OA 세션을 닫아 비용 절감.
  const IDLE_LIMIT_MS = 60000;
  let idleTimer = null;
  let idleClose = null; // 파이프라인이 OA 종료 함수를 등록
  let idleStopped = false;
  function bumpIdle() {
    if (idleStopped) return;
    if (pipeline === 'desk') return; // 데스크: 대기 모드는 무기한 유지(통역 중 종료는 deskIdle 로 별도 처리)
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleStopped = true;
      toHost({ type: 'idle-stop' });
      toHost({ type: 'status', message: '1분간 입력이 없어 번역을 중지했습니다.' });
      if (idleClose) try { idleClose(); } catch {}
    }, IDLE_LIMIT_MS);
  }
  ws.on('close', () => clearTimeout(idleTimer));
  // 클라이언트가 보내는 소리 감지(VAD) 신호로도 유휴 타이머 리셋 →
  // 시스템 오디오 등 '말(전사)'이 아닌 소리가 들어와도 중지되지 않음.
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    try {
      if (JSON.parse(data.toString()).type === 'activity') bumpIdle();
    } catch {}
  });
  const inRaw = ws._in != null ? ws._in : session ? session.inLang : null;
  const inLang = inRaw && inRaw !== 'auto' ? inRaw : null;
  const pipeline = ws._pipeline || (session && session.pipeline) || 'whisper';
  // 출력 언어 목록: whisper 는 다국어, translate 는 1개
  const sessionLangs =
    session && Array.isArray(session.langs) && session.langs.length
      ? session.langs
      : [ws._out || (session && session.outLang) || TARGET_LANG];
  const targetLang = sessionLangs[0]; // translate 파이프라인용 단일 언어

  const toHost = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendPartial = (text) => {
    const p = { type: 'partial', side, text };
    toHost(p);
    broadcast(sessionId, p);
  };
  // 문장 항목: texts = { 언어코드: 번역문 }. 같은 id 로 여러 번 호출하면 언어별로 병합됨.
  // lang = 발화(원문) 언어 — 데스크 뷰어가 말풍선 좌우(안내원/손님)를 번역 도착 전에 판단하는 데 사용.
  // sideOv = 채널별 side 오버라이드(데스크 여객 마이크 채널='left', 기본은 이 연결의 소스 기준).
  const buildMsg = (id, item) => ({ type: 'sentence', id, side: item.side || side, source: item.source || null, texts: item.texts, speaker: item.speaker || null, ...(item.lang ? { lang: item.lang } : {}), ...(item.toks ? { toks: item.toks } : {}) });
  // 화면에만 보냄(저장 안 함) — translate 스트리밍/whisper 진행표시용
  // draft:true — 아직 확정되지 않은(엔진이 <end> 를 주기 전) 진행 중 발화·번역이라는 표시.
  // 클라는 이걸 흐리게 그리고, 확정 시 buildMsg 가 draft 없이 같은 id 를 다시 보내면 또렷해진다.
  // 다듬기(polish)까지 끝나도 같은 경로(upsertItem→buildMsg)라 확정 표시가 유지된다.
  // 구버전 캐시 클라(desk.html 태블릿)는 이 필드를 무시하므로 지금과 똑같이 그려진다 — 추가는 안전.
  const liveSend = (id, langTexts, source, speaker, lang, sideOv) => {
    const m = { type: 'sentence', id, side: sideOv || side, source: source || null, texts: langTexts, speaker: speaker || null, ...(lang ? { lang } : {}), draft: true };
    toHost(m);
    broadcast(sessionId, m);
  };
  // 확정: 세션 저장 + 전송. 언어별로 병합.
  // toks = 원문 STT 토큰 [[text, confidence], ...] — 저신뢰 단어 하이라이트 + 추후 인식 품질 평가용 기록
  const upsertItem = (id, langTexts, source, speaker, lang, sideOv, toks, tm) => {
    const toksCapped = Array.isArray(toks) && toks.length ? toks.slice(0, 120) : null;
    let item;
    if (session) {
      item = session.items.find((x) => x.id === id);
      if (item) {
        item.texts = { ...(item.texts || {}), ...langTexts };
        if (source) item.source = source;
        if (speaker) item.speaker = speaker;
        if (lang) item.lang = lang;
        if (toksCapped) item.toks = toksCapped;
        if (tm) item.tm = { ...(item.tm || {}), ...tm };
      } else {
        item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, speaker: speaker || null, ...(lang ? { lang } : {}), ...(toksCapped ? { toks: toksCapped } : {}), ...(tm ? { tm: { ...tm } } : {}) };
        session.items.push(item);
        if (session.items.length > ITEMS_CAP) session.items.splice(0, session.items.length - ITEMS_CAP);
      }
      if (session.title === '새 세션' && session.items.length === 1) {
        const first = Object.values(item.texts)[0] || '';
        if (first) session.title = first.slice(0, 40);
      }
      session.updatedAt = Date.now();
      saveSessions(session.id);
    } else {
      // 세션이 삭제된 뒤에도 채널 귀속(side/lang)이 유지되도록 폴백에도 오버라이드 반영
      item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, ...(lang ? { lang } : {}), ...(toksCapped ? { toks: toksCapped } : {}) };
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  // 번역 다듬기 컨텍스트: 직전 확정 발화(타깃 언어 기준) 최대 3건 — 단답("처음부터요") 자연화에 필수
  const polishCtx = (key, excludeId) => {
    if (!session || !Array.isArray(session.items)) return '';
    const rows = [];
    for (let i = session.items.length - 1; i >= 0 && rows.length < 3; i--) {
      const it = session.items[i];
      if (!it || it.id === excludeId) continue;
      const t = (it.texts && (it.texts[key] || Object.values(it.texts)[0])) || it.source;
      if (t) rows.unshift(String(t).slice(0, 120));
    }
    return rows.join('\n');
  };
  // 확정 카드 다듬기: 비동기 nano → 카드가 살아 있고 텍스트가 그대로일 때만 덮어쓰기
  // (그 사이 confFix·늦은 번역 꼬리가 먼저 덮었으면 양보). 응대 종료로 deskLog 에
  // 아카이브된 뒤 도착하면 기록만 조용히 갱신(뷰어 방송 불필요).
  const polishCommit = (id, key, src, tgt) => {
    polishText(src, tgt, key, polishCtx(key, id)).then((out) => {
      if (!out) return;
      const it = session && Array.isArray(session.items) ? session.items.find((x) => x.id === id) : null;
      if (it && it.texts && it.texts[key] === tgt) { upsertItem(id, { [key]: out }); return; }
      if (session && Array.isArray(session.deskLog)) {
        for (let i = session.deskLog.length - 1; i >= 0 && i >= session.deskLog.length - 2; i--) {
          const e = session.deskLog[i];
          const a = e && Array.isArray(e.items) ? e.items.find((x) => x.id === id) : null;
          if (a && a.texts && a.texts[key] === tgt) { a.texts[key] = out; saveSessions(session.id); return; }
        }
      }
    }).catch(() => {});
  };

  // 저신뢰 자동 교정(고급옵션 confFix): 트리거(연속 저신뢰) 발화만 GPT 재검토 → 명백한 오인식이면
  // 같은 id 로 카드 덮어쓰기(원문+번역). runSoniox·runDesk(직원/여객) 커밋에서 호출.
  // TTS 재발화는 하지 않는다(이미 재생된 음성을 되돌릴 수 없어 텍스트만 교정).
  const maybeConfFix = (id, toks, txt, src, targetKey) => {
    try {
      if (!confFixTrigger(toks)) return;
      const low = confFixReal(toks)
        .filter(([, c]) => c < CONFFIX.LOW)
        .map(([t, c]) => `${String(t).trim()}(${c})`)
        .join(' ');
      // 직전 대화 2~3턴(현재 발화 제외) — 대화 흐름으로 오인식 단어를 유추할 근거
      const hist = (session && Array.isArray(session.items) ? session.items.slice(-4) : [])
        .filter((x) => x.id !== id && x.source)
        .slice(-3)
        .map((x) => `${x.source} → ${(x.texts && (x.texts.ko || Object.values(x.texts)[0])) || ''}`.trim())
        .join('\n');
      confFixLLM({
        srcLang: src,
        marked: confFixMark(toks),
        lowWords: low,
        history: hist,
        terms: confFixTerms(src),
        desk: pipeline === 'desk',
      }).then(async (r) => {
        if (!r || !r.changed) return;
        // 치환 적용 가드: 1글자·no-op·원문에 없는 치환은 폐기 — 프롬프트 실험에서 nano 가
        // 정상 발화(어절 첫 음절 저신뢰)에 '가→가상' 류 무의미 1글자 치환을 내는 오탐이 재현됐고,
        // 이 가드만으로 전부 걸러졌다(진짜 오인식은 '긴옌실→흡연실'처럼 2글자+ 덩어리로 나옴).
        let corrected = txt;
        let applied = 0;
        for (const rep of r.replacements) {
          const from = String((rep && rep.from) || '');
          const to = String((rep && rep.to) || '');
          if (from.trim().length < 2 || !to.trim() || to === from || !corrected.includes(from)) continue;
          corrected = corrected.replace(from, to);
          applied++;
        }
        if (!applied || corrected === txt) return;
        // 응대 종료(deskLog 아카이브)·세션 정리로 카드가 사라졌으면 폐기 — 다음 손님 화면에 유령 카드 방지
        if (!(session && Array.isArray(session.items) && session.items.some((x) => x.id === id))) return;
        // 번역은 검증된 경로로 다시 생성(판정 모델의 번역은 언어 섞임 등 품질이 불안정했음)
        const tr = await translateText(corrected, targetKey, true, [], REFINE_MODEL).catch(() => null);
        if (!tr) return;
        if (!(session && Array.isArray(session.items) && session.items.some((x) => x.id === id))) return; // 번역 대기 중 정리된 경우
        console.log('[confFix] 교정:', JSON.stringify(txt), '→', JSON.stringify(corrected));
        upsertItem(id, { [targetKey]: tr }, corrected);
        toHost({ type: 'status', message: '저신뢰 구간 자동 교정 적용' });
      }).catch(() => {});
    } catch {}
  };

  if (pipeline === 'translate') runTranslate();
  else if (pipeline === 'soniox') runSoniox();
  else if (pipeline === 'desk') runDesk();
  // whisper(구 다국어 번역) 파이프라인은 지원 종료 — 기존 세션 기록은 열람만 가능
  else toHost({ type: 'status', message: '이 세션의 번역 모드(다국어 번역·구)는 지원이 종료되었습니다. 새 세션을 만들어 이용해 주세요.' });

  /* ---------- Soniox stt-rt-v5 (전사) -> gpt 번역 [테스트] ---------- */
  function runSoniox() {
    if (!SONIOX_API_KEY) {
      toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — soniox 모드 사용 불가' });
      return;
    }
    // 엔드포인트 튜닝(테스트용, UI에서 선택). 문서 기본값: sensitivity 0, maxDelay 2000, latency 0.
    const sens = Number(ws._sxSens);
    const maxDelay = Number(ws._sxMaxDelay);
    const latency = Number(ws._sxLatency);
    // Soniox 자체 실시간 번역(기본). GPT 경유 없이 전사+번역 토큰을 한 스트림으로 받음.
    //  단방향(one): 타깃 1개 / 양방향(two): A↔B. 지원 언어 ko/en/ja/zh 로 한정.
    // 입력 언어 미지정(auto) 시 기본 언어 힌트. 2026-07-29 세션에서 힌트에 없던 스페인어의
    // 첫 12발화가 번역되지 않고 원문이 그대로 표시된 사례가 있어 실제 취항·관광 언어를 포함한다.
    // (용어 표기가 없는 언어는 영어 표기로 폴백되므로 context 크기는 거의 늘지 않는다)
    const L4 = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'ru'];
    const okL = (c) => SONIOX_LANGS.includes(c); // 선택지는 soniox 지원 언어 전체
    const sxMode = ws._sxMode === 'two' ? 'two' : 'one';
    const sxTarget = okL(ws._sxTarget) ? ws._sxTarget : 'en';
    const sxA = okL(ws._sxA) ? ws._sxA : 'ko';
    const sxB = okL(ws._sxB) ? ws._sxB : 'en';
    let ttsOn = ws._tts === '1' && !!CARTESIA_API_KEY;
    let gender = ws._gender === 'm' ? 'm' : 'f'; // 음성 성별(출력언어별 보이스 자동 선택)
    const diar = ws._diar === '1'; // 화자 구분(speaker diarization)
    if (ws._tts === '1' && !CARTESIA_API_KEY) {
      toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 출력(TTS) 비활성. 서버 환경변수를 확인하세요.' });
    }
    // 자동 감지(입력 언어 미지정) 세션에서 첫 발화로 확정한 입력 언어.
    // 잠기면 힌트·context 를 그 언어로 좁혀 1회 재연결한다(아래 lockDetected).
    let lockedIn = null;
    const buildConfig = () => ({
      model: 'stt-rt-v5',
      audio_format: 'pcm_s16le',
      sample_rate: 24000,
      num_channels: 1,
      enable_language_identification: true,
      enable_endpoint_detection: true,
      enable_speaker_diarization: diar, // 화자 구분(토글)
      // API 허용범위로 클램프: sensitivity -1~1, maxDelay 500~3000, latency 0~3
      endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
      max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
      endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
      language_hints: sxMode === 'two' ? [sxA, sxB] : (inLang ? [inLang] : (lockedIn ? [sxTarget, lockedIn] : L4)),
      translation: sxMode === 'two'
        ? { type: 'two_way', language_a: sxA, language_b: sxB }
        : { type: 'one_way', target_language: sxTarget },
      client_reference_id: 'u:' + (ws._userId || 'anon') + '|p:live', // 유저별+파이프라인(실시간 번역) 사용량 집계
      // 고유명사/번역 설정 주입 — 이 세션에서 쓰이는 언어의 표기·번역쌍만 조립.
      // 자동 감지에서 언어가 잠히면(lockedIn) 그 언어로 좁혀 용어집이 잘리지 않게 한다.
      ...((() => {
        const langs = sxMode === 'two' ? [sxA, sxB] : [sxTarget, ...(inLang ? [inLang] : (lockedIn ? [lockedIn] : L4))];
        const c = buildSonioxContext(langs, sxMode === 'two' ? {} : { target: sxTarget });
        return c ? { context: c } : {};
      })()),
    });

    let sx = null;          // 현재 엔진 소켓(예기치 않은 끊김 시 자동 재연결)
    let sxReady = false;
    let sxClosed = false;   // 사용자 중지/유휴 종료 — 재연결 금지
    let pending = [];
    /* 입력 언어 자동 감지 → 1회 재연결(데스크 lockDetected 와 동일 패턴).
       auto 세션은 광역 힌트(L4 8언어)로 시작하는데, 이 상태로 세션이 끝까지 가면
       ① 힌트가 흩어져 인식 정확도가 떨어지고 ② context 가 커져 용어집 뒤쪽이 잘린다
       (2026-07-29 세션: 번역쌍 전량 삭제 + 스페인어 첫 12발화 미번역).
       첫 확정 발화의 언어로 잠그고 [타깃, 감지언어] 로 좁혀 한 번만 재연결한다.
       재연결 1회는 context 재과금 1회뿐 — 주기적 재연결(2026-07-15 삭제)과 달리 무해하다. */
    const lockDetected = (src) => {
      if (lockedIn || inLang || sxMode === 'two' || sxClosed || idleStopped) return;
      if (!src || src === sxTarget || !SONIOX_LANGS.includes(src)) return; // 타깃 언어면 좁힐 이유 없음
      lockedIn = src;
      relockPending = true; // close 핸들러가 '실패'로 세지 않고 즉시 재연결하게
      toHost({ type: 'status', message: `입력 언어 감지: ${src} — 해당 언어로 인식 설정을 좁혀 재연결합니다.` });
      try { sx && sx.close(); } catch {} // 새 config(좁힌 힌트·용어집)로 다시 붙는다
    };
    let relockPending = false; // 재감지로 의도적으로 닫는 중인지
    // (삭제됨) 무음 시 '조용한 재연결'(인식 컨텍스트 플러시, 2026-07-13) — 재연결마다 config 의
    // context(용어집, input_text_tokens $4/1M)가 재청구돼 Soniox 비용의 71%를 차지했던 원인이라 제거.
    // 오인식 고착은 confFix(저신뢰 자동 교정)가 완화한다. 상세: PROJECT_NOTES 2026-07-15.
    idleClose = () => { sxClosed = true; try { sx && sx.close(); } catch {} };
    // 번역 방향 정보 — 뷰어(모바일)가 언어 표시에 사용
    // 채널 분리(양방향 통역을 채널별 단방향으로) — 엔진은 단방향이지만 세션은 a↔b 양방향으로 보여야
    // 뷰어가 '내 언어/상대 언어'로 정렬하고 자기 언어 음성만 듣는다.
    const pairLangs = String(ws._pair || '').split(',').filter((c) => okL(c));
    const sxInfo = pairLangs.length === 2
      ? { mode: 'two', target: sxTarget, a: pairLangs[0], b: pairLangs[1], split: true }
      : { mode: sxMode, target: sxTarget, a: sxA, b: sxB };
    if (session) { session.sxInfo = sxInfo; saveSessions(session.id); }
    broadcast(sessionId, { type: 'meta', sxInfo });
    let curId = null;     // 진행 중 발화 카드 id
    let finalText = '';   // 전사(원문) 확정 누적
    let finalTrans = '';  // Soniox 번역(타깃) 확정 누적
    let lastTrans = '';   // 마지막으로 표시한 번역(폴백용)
    let curSrc = '';      // 감지된 입력 언어(토큰 다수결 — 첫 단어 오인식 교정)
    const langVotes = langJudge(); // 발화 언어 판정(확정 번역의 source_language → 확정 원문 다수결)
    let curSpeaker = '';  // 현재 발화 화자(diarization)
    let lastCommitText = ''; // 직전 확정 텍스트(연속 중복 카드 방지)
    let lastCommitted = null; // { id, key, out, at } — 화자 변경 커밋 직후 늦게 도착한 번역 꼬리를 직전 카드에 귀속
    let lastCommitAt = 0;    // 직전 확정 시각 — 중복 판정은 5초 창 안에서만
    let sawSpeaker = false;  // 엔진이 화자 정보를 한 번이라도 반환했는지(진단용)
    let spkNotified = false; // 화자 감지 1회 알림
    let noSpkWarned = false; // 화자 미반환 1회 경고
    let srcToks = [];        // 원문 확정 토큰 [[text, confidence], ...] — 저신뢰 하이라이트 + 추후 평가용
    let dropAcks = ws._dropAcks === '1'; // 고급옵션: 단독 응답어(네/Yes/Okay) 기록 생략(라이브 토글 가능)
    let confFix = ws._confFix === '1'; // 고급옵션: 저신뢰 자동 교정(라이브 토글 가능)

    const targetKeyFor = (src) => (sxMode === 'two' ? (src === sxA ? sxB : sxA) : sxTarget);
    // 채널 분리: 반대 채널의 언어가 이 채널에서 인식되면 샌 소리(스피커→마이크, 옆 사람 핀마이크)로 보고 버린다.
    // 채널마다 언어가 정해져 있어야 쓸 수 있는 결정적 필터 — 같은 언어끼리(dropLang 없음)는 아래 교차 중복이 맡는다.
    // (버릴 언어 = 그 채널의 번역 타깃 — 내 채널은 상대 언어로 번역하므로 상대 언어 발화가 들리면 샌 소리)
    const dropLang = okL(ws._drop) ? ws._drop : null;
    const splitCh = ws._role === 'me' || ws._role === 'them';
    let bleedDrops = 0;
    // 교차 채널 중복(같은 세션의 다른 채널 연결과 공유): 8초 안에 반대 채널이 비슷한 문장을 확정했으면 샌 소리
    const chCommits = () => { const r = getRoom(sessionId); if (!r.chCommits) r.chCommits = []; return r.chCommits; };
    const crossChannelDup = (txt, tgt) => {
      const arr = chCommits();
      const now = Date.now();
      while (arr.length && now - arr[0].at > 8000) arr.shift();
      const n = echoNorm(txt), nt = echoNorm(tgt || '');
      return arr.some((e) => e.src !== ws._src && (
        (n.length >= 4 && (echoMatch(n, e.n) || (e.nt.length >= 4 && echoMatch(n, e.nt)))) ||
        (nt.length >= 4 && (echoMatch(nt, e.n) || (e.nt.length >= 4 && echoMatch(nt, e.nt))))
      ));
    };
    const noteChannelCommit = (txt, tgt) => { chCommits().push({ n: echoNorm(txt), nt: echoNorm(tgt || ''), at: Date.now(), src: ws._src }); };
    const spkLabel = (s) => (s != null && s !== '' ? String(s) : null); // 화자 번호만 전송(표시는 클라가 아이콘+번호)

    // ---- 실시간 TTS: 확정된 번역을 문장 단위로 잘라 즉시 합성(발화가 끝나기 전에도 흘려보냄) ----
    let ttsPending = '';      // 확정됐지만 아직 합성하지 않은 번역 텍스트
    let ttsLang = sxTarget;   // 현재 합성 언어(타깃)
    const SENT_END = /[.!?。！？…]/;
    // 마침표가 문장 끝이 아닌 약어들(영어 타깃에서 오탐 방지)
    const ABBR = new Set(['mr','mrs','ms','dr','prof','sr','jr','st','vs','etc','inc','ltd','co','corp','no','vol','fig','dept','univ','gov','gen','col','sgt','lt','capt','cmdr','rev','hon','pres','approx','mt','ave','rd','blvd','ph','messrs']);
    // 합성을 순차 직렬화: 짧은 뒷문장이 먼저 합성 완료돼 먼저 재생되는 순서 뒤바뀜 방지
    let ttsChain = Promise.resolve();
    let utterTm = null; // 진행 중 발화의 레이턴시 타임스탬프 { s, e, (tq, ta 는 발화 중 TTS 시) }
    // 레이턴시 로그: 카드(id)의 tm 에 시각 병합 — 커밋 전(카드 미생성)이면 utterTm 에 보류.
    // 첫 발생만 기록(문장 여러 개여도 '첫 오디오까지'가 체감 지연).
    const stampTm = (forId, key) => {
      const t = Date.now();
      const it = session && Array.isArray(session.items) ? session.items.find((x) => x.id === forId) : null;
      if (it) { if (!it.tm || it.tm[key] == null) { it.tm = { ...(it.tm || {}), [key]: t }; saveSessions(session && session.id); } }
      else if (utterTm && forId === curId && utterTm[key] == null) utterTm[key] = t;
    };
    const speakTts = (text, forId) => {
      const tx = (text || '').trim();
      if (!ttsOn || !tx) return;
      if (!/[\p{L}\p{N}]/u.test(tx)) return; // 문장부호만 있으면 스킵(Cartesia 400 방지)
      const lang = ttsLang;                  // 호출 시점 타깃 언어 고정
      // 듣는 사람(이 호스트 재생 또는 '듣기' 켠 뷰어)이 없으면 만들지 않는다 — 예전엔 아무도 안 들어도 줄을 세워 합성해
      // 줄이 밀리면 나중에 '듣기'를 켠 사람에게 이전 문장이 몰아서 나갔고, Cartesia 요금도 헛되이 나갔다(2026-10-25)
      const listening = () => !!ws._audioOut || hasAudioListener(sessionId, lang);
      if (!listening()) return;
      const voiceId = cartesiaVoiceId(lang, gender);
      noteTts(sessionId, tx); // 자기음성(에코) 필터에 등록 — 재입력 시 인식 결과를 버림
      // 뷰어(음성 듣기 구독자) + 호스트(TTS 켠 경우)에게 재생. 재입력은 AEC + 에코 필터로 차단.
      let firstAudio = false;
      ttsChain = ttsChain.then(() => {
        if (!listening()) return undefined; // 줄에서 차례가 왔을 때 듣던 사람이 모두 껐으면 건너뜀
        if (forId) stampTm(forId, 'tq'); // 합성 요청 시각 — 직렬 큐 대기 후, 실제 요청 직전(ta−tq=순수 합성 지연)
        recordTts(pipeline === 'desk' ? 'desk' : 'live', tx.length); // 파이프라인별 자체 사용량
        return cartesiaTTSStream(tx, voiceId, lang, (b64) => {
          if (!firstAudio) { firstAudio = true; if (forId) stampTm(forId, 'ta'); } // 첫 오디오 청크 시각
          broadcastAudio(sessionId, b64, lang);
          if (ws._audioOut) sendAudioToHosts(sessionId, b64, lang);
        });
      }).catch(() => {});
    };
    const flushTtsSentences = () => {
      if (!ttsOn) return;
      const buf = ttsPending;
      const out = [];
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i];
        if (!SENT_END.test(ch)) continue;
        if (ch === '.') {
          const next = buf[i + 1];
          if (next === undefined) break;        // 버퍼 끝의 마침표 → 약어/문장끝 모호, 더 기다림(commit이 처리)
          if (next === '.') continue;           // 줄임표(...) 일부
          if (/[0-9]/.test(next)) continue;     // 소수점 3.14
          let j = i - 1; while (j >= 0 && /[A-Za-z]/.test(buf[j])) j--;
          const word = buf.slice(j + 1, i);     // 마침표 앞 알파벳 덩어리
          if (word.length === 1) continue;      // 이니셜(J.) / e.g.·i.e. 조각
          if (ABBR.has(word.toLowerCase())) continue; // Dr. Mr. etc.
        }
        let end = i + 1;
        while (end < buf.length && /["'”’)\]]/.test(buf[end])) end++; // 닫는 따옴표/괄호 포함
        out.push(buf.slice(start, end));
        start = end;
        i = end - 1;
      }
      ttsPending = buf.slice(start);
      for (const s of out) speakTts(s, curId);
    };

    // 현재 누적분을 한 문장으로 확정 (GPT 호출 없음)
    const commit = () => {
      const id = curId, txt = stripFillers(finalText.trim()), src = curSrc, spk = curSpeaker;
      const tgt = stripFillers((finalTrans.trim() || lastTrans).trim());
      const toks = srcToks;               // 이 발화의 원문 토큰(신뢰도 포함)
      const tm = { ...(utterTm || {}), c: Date.now() }; // 레이턴시: s(첫 토큰)/e(<end>)/c(확정)
      utterTm = null;
      const tail = ttsPending;            // 종결부호 없이 남은 마지막 조각
      const hadFinal = !!finalTrans.trim(); // 발화 중 확정 번역이 흘러갔는지
      curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; curSpeaker = ''; ttsPending = ''; langVotes.reset(); srcToks = [];
      pending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외(발화 경계에서 비움)
      // 화자 구분 켰는데 엔진이 화자 정보를 한 번도 안 줬으면 1회 안내(진단)
      if (diar && !sawSpeaker && !noSpkWarned) { noSpkWarned = true; toHost({ type: 'status', message: '화자 구분: 엔진이 화자 정보를 반환하지 않음(번역/엔드포인트와 동시 사용 시 발생 가능)' }); }
      if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던(또는 잡음뿐인) 고스트 카드 제거
      // 고급옵션: 단독 응답어(네/Yes/Okay 단독 발화) 기록 생략
      if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null); return; }
      // TTS 자기음성 재입력(에코) → 확정하지 않고 화면 표시도 제거
      if (isSelfEcho(sessionId, txt)) { liveSend(id, {}, null, null); return; }
      // 채널 분리: 반대 채널 언어(샌 소리) 또는 반대 채널이 방금 확정한 같은 문장 → 버림
      if (dropLang && src === dropLang) { bleedDrops++; liveSend(id, {}, null, null); return; }
      if (splitCh && crossChannelDup(txt, tgt)) { bleedDrops++; liveSend(id, {}, null, null); return; }
      if (splitCh) noteChannelCommit(txt, tgt);
      const out = tgt || txt;
      // 직전 카드와 동일한 내용이 '5초 안에' 반복되면 중복(에코)으로 스킵 — 시간이 지난 의도적 반복 발화는 허용
      if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
      lastCommitText = out;
      lastCommitAt = Date.now();
      const target = targetKeyFor(src);
      upsertItem(id, { [target]: out }, txt, spkLabel(spk), src || null, undefined, toks, tm); // lang=발화 언어 — 뷰어가 내 말/상대 말 정렬
      lastCommitted = { id, key: target, out, at: Date.now() }; // 커밋 직후 늦게 도착하는 번역 꼬리 귀속용
      lockDetected(src); // 자동 감지: 첫 확정 발화의 언어로 힌트·용어집을 좁혀 1회 재연결
      if (tgt) polishCommit(id, target, txt, tgt); // 번역 다듬기(nano) — 직역투 후교정(비동기 카드 교체)
      if (confFix) maybeConfFix(id, toks, txt, src, target); // 저신뢰 자동 교정(고급옵션)
      // 실시간 TTS: 발화 중 문장 단위로 이미 흘려보냈고, 여기선 남은 꼬리만 합성.
      //  재입력은 브라우저 AEC(마이크 경로) + 서버 에코 텍스트 필터(시스템 캡처·기기 간 경로)로 차단.
      // 출력 언어로 말한 발화는 읽어 줄 번역이 없다 — 방금 한 말을 그대로 되읽지 않는다
      if (ttsOn && !(sxMode === 'one' && src === sxTarget && !tgt)) {
        ttsLang = target;
        const tl = tail.trim();
        if (tl) speakTts(tl, id);                   // 종결부호 없이 남은 번역 꼬리
        else if (!hadFinal) speakTts(out, id);      // 발화 중 합성된 게 없으면(번역 미확정) 전체 합성
      }
    };

    // 엔진 연결(끊기면 자동 재연결 — 이전에는 재연결이 없어 '진행 중'처럼 보이며 무음이 지속됐음)
    // 재연결은 지수 백오프 + 연속 실패 상한: config 거부·쿼터 초과처럼 즉시 닫히는 상황에서
    // 800ms 무한 재시도하면 재연결마다 context(input_text_tokens)가 재과금되므로 8회에서 중지한다.
    let sxFails = 0; // 토큰 수신 시 0 으로 리셋 — 정상 세션의 간헐적 끊김은 누적되지 않음
    function connectEngine() {
      if (sxClosed || idleStopped) return;
      const cur = openSonioxWs();
      sx = cur;
      cur.on('open', () => {
      if (sx !== cur) return;
      const config = buildConfig(); // 재감지로 언어가 잠혔으면 좁혀진 힌트·context 로 재생성됨
      try { cur.send(JSON.stringify(config)); } catch {} // config 먼저
      sxReady = true;
      // 리플레이: '마지막 확정 이후' 프레임(최근 ~2초)을 새 소켓에 재전송 — 연결 대기 중 큐잉뿐
      // 아니라, 죽은 구 소켓으로 이미 나갔던(=Soniox 가 못 들은) 진행 중 발화의 앞부분도 복구한다.
      for (const f of pending) { try { cur.send(f); } catch {} }
      toHost({ type: 'status', message: `엔진 연결됨 (Soniox stt-rt-v5 · ${sxMode === 'two' ? `양방향 ${sxA}↔${sxB}` : `단방향→${sxTarget}`}${ttsOn ? ' · TTS on' : ''}, sens=${config.endpoint_sensitivity}, maxDelay=${config.max_endpoint_delay_ms}ms, lat=${config.endpoint_latency_adjustment_level})` });
      // TTS 연결 워밍업 + 키/보이스 검증(첫 음성 지연 단축)
      if (ttsOn) {
        const wLang = sxMode === 'two' ? 'ko' : sxTarget;
        cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then((r) => toHost({ type: 'status', message: r.ok ? '음성(Cartesia) 준비됨' : ('음성 준비 실패: ' + r.error) }));
      }
      bumpIdle();
    });
    cur.on('message', (raw) => {
      if (sx !== cur) return; // 교체된 구 소켓의 늦은 토큰 무시
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
      const toks = ev.tokens || [];
      if (!toks.length) return;
      bumpIdle();
      sxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
      let endHit = false;
      let nonFinal = '';      // 비확정 전사(원문) — 매 응답마다 새로 구성
      let nonFinalTrans = ''; // 비확정 번역(타깃)
      langVotes.begin();
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        // 화자 정보는 원문/번역 토큰 어디서 와도 캡처(진단 + 표시용)
        if (diar && t.speaker != null && t.speaker !== '') {
          sawSpeaker = true;
          if (!spkNotified) { spkNotified = true; toHost({ type: 'status', message: '화자 구분 활성 — 화자 ' + t.speaker + ' 감지됨' }); }
        }
        if (t.translation_status === 'translation') {
          if (t.is_final) {
            // 화자 변경 커밋 직후: 새 원문 토큰이 오기 전에 도착한 번역 꼬리는 직전(방금 확정된) 발화의
            // 번역이다 — 새(빈) 발화에 붙이면 남의 번역으로 시작하므로 직전 카드에 이어붙인다.
            if (!curId && !finalText && lastCommitted && Date.now() - lastCommitted.at < 4000) {
              lastCommitted.out += t.text;
              upsertItem(lastCommitted.id, { [lastCommitted.key]: lastCommitted.out });
              continue;
            }
            langVotes.token(t); curSrc = langVotes.pick(curSrc); // 엔진이 번역한 방향이 가장 확실
            finalTrans += t.text;
            ttsLang = targetKeyFor(curSrc); // 현재 타깃 언어로 합성
            ttsPending += t.text;           // 문장 단위 실시간 TTS 큐
          } else nonFinalTrans += t.text;
        } else {
          // 전사(원문) 토큰 (translation_status: none | original | undefined)
          // 입력 언어는 첫 토큰이 아니라 '다수결'로 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
          langVotes.token(t); curSrc = langVotes.pick(curSrc); // 동률에선 유지(방향 플립 방지)
          // 화자 변경 시: 누적된 발화가 있으면 먼저 확정하고 새 화자로 시작
          if (diar && t.speaker != null && t.speaker !== '' && t.is_final && curSpeaker && String(t.speaker) !== String(curSpeaker) && finalText.trim()) commit();
          if (diar && t.speaker != null && t.speaker !== '') curSpeaker = t.speaker;
          if (t.is_final) {
            finalText += t.text;
            // 확정 토큰의 신뢰도 기록(2자리 반올림) — 저신뢰 단어 하이라이트 + 추후 인식 품질 평가
            if (t.text.trim()) srcToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]);
          } else nonFinal += t.text;
        }
      }
      flushTtsSentences(); // 완성된 문장은 즉시 합성(발화 종료 기다리지 않음)
      const shownSrc = (finalText + nonFinal).trim();
      const shownTgt = (finalTrans + nonFinalTrans).trim();
      if (shownTgt) lastTrans = shownTgt;
      if (!curId && (shownSrc || shownTgt)) { curId = newId(); utterTm = { s: Date.now() }; }
      if (curId) {
        // 타깃=번역(주 텍스트), 원문은 source 로 동시 표시.
        // 출력 언어로 말한 발화(예: 한국어 회의를 한국어로 기록)는 엔진이 번역하지 않는다 — 원문이 곧 표시 문장.
        // 비워 두면 화면이 확정 때까지 '번역 중…'으로 흐리게 남는다(확정 commit 은 원래 원문으로 폴백).
        const sameLang = sxMode === 'one' && curSrc === sxTarget && !shownTgt;
        if (dropLang && curSrc === dropLang) liveSend(curId, {}, null, null); // 샌 소리로 보이는 동안은 감춤(언어 판정이 바뀌면 다시 뜸)
        else liveSend(curId, { [targetKeyFor(curSrc)]: sameLang ? shownSrc : shownTgt }, shownSrc || null, spkLabel(curSpeaker), curSrc || undefined);
      }
      // 발화 종료(<end>) 또는 과도하게 길면 확정
      if (endHit) { if (utterTm && utterTm.e == null) utterTm.e = Date.now(); commit(); }
    });
    cur.on('error', (e) => { if (sx === cur) toHost({ type: 'status', message: 'Soniox 오류: ' + (e && e.message || e) }); });
    cur.on('close', () => {
      if (sx !== cur) return;
      sxReady = false; // 끊긴 소켓으로 send 하지 않도록(이전엔 true 로 남아 조용히 버려졌음)
      if (!sxClosed && !idleStopped) {
        // 언어 재감지로 우리가 의도해 닫은 경우는 '실패'가 아니다 — 백오프·8회 상한을 건드리지 않고
        // 즉시 새 config 로 재연결한다(그 사이 발화는 pending 리플레이 버퍼가 복구).
        if (relockPending) {
          relockPending = false;
          connectEngine();
          return;
        }
        sxFails++;
        if (sxFails >= SX_MAX_FAILS) { // 연결 직후 반복 종료 — 재시도할수록 과금만 누적되므로 명시적으로 중지
          idleStopped = true;
          toHost({ type: 'idle-stop' });
          toHost({ type: 'status', message: '엔진 연결이 반복 실패해 번역을 중지했습니다. 잠시 후 다시 시작해 주세요.' });
          return;
        }
        const delay = sxRetryDelay(sxFails);
        toHost({ type: 'status', message: '엔진 재연결 중…' });
        setTimeout(() => { if (sx === cur && !sxClosed && !idleStopped) connectEngine(); }, delay);
      } else {
        toHost({ type: 'status', message: '엔진 연결 종료 (Soniox)' });
      }
    });
    }
    connectEngine();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // 항상 리플레이 버퍼에 적재(마지막 확정 시 비움, 상한 ~2초) — 재연결 시 새 소켓에 재전송해
        // 백오프/재체결 동안의 발화 앞부분 유실을 복구한다. 연결 전 큐 역할도 겸한다.
        pending.push(data); if (pending.length > 24) pending.shift();
        if (sxReady && sx) { try { sx.send(data); } catch {} }
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') {
          sxClosed = true;
          gracefulEngineStop();
        } else if (m.type === 'dropAcks') { // 고급옵션: 단독 응답어 생략 라이브 토글
          dropAcks = !!m.on;
        } else if (m.type === 'confFix') { // 고급옵션: 저신뢰 자동 교정 라이브 토글
          confFix = !!m.on;
        } else if (m.type === 'tts') {
          // 녹음 중 TTS 토글: 합성 on/off + 이 기기(호스트) 재생 여부. local=false 면 '뷰어에게만'(합성은 하되 호스트로 안 보냄)
          ws._audioOut = !!m.on && m.local !== false;
          ttsOn = !!m.on && !!CARTESIA_API_KEY;
          if (m.gender === 'm' || m.gender === 'f') gender = m.gender;
          if (!!m.on && !CARTESIA_API_KEY) toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 재생을 사용할 수 없습니다.' });
          if (ttsOn) { const wLang = sxMode === 'two' ? 'ko' : sxTarget; cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then(() => {}).catch(() => {}); }
        }
      } catch {}
    });
    ws.on('close', () => { sxClosed = true; gracefulEngineStop(); });

    // 마지막 발화 보존: 즉시 close 하면 finalize 결과를 받을 기회가 없어 "말 끝내고 2초 안에 중지"한
    // 마지막 문장이 화면에 보였다가 기록에서 사라졌다. finalize('') 요청 후 1초간 토큰을 계속 수신
    // (<end> 도착 시 정상 commit)하고, 그래도 남은 확정분은 강제 commit 한 뒤 닫는다.
    function gracefulEngineStop() {
      const cur = sx;
      if (!cur) return;
      try { cur.send(''); } catch {}
      setTimeout(() => {
        try { if (curId && finalText.trim()) commit(); } catch {}
        try { cur.close(); } catch {}
      }, 1000);
    }
  }

  /* ---------- 데스크 안내 모드: 대기(idle) → 언어 선택 시 soniox two_way(ko↔X) ----------
     · 호스트 '대기 시작' = 마이크 캡처만(STT 세션 없음 — 대기 중 비용 0, 오디오는 버림).
     · 손님(뷰어 태블릿)이 언어(한·영·일·중)를 선택하거나 호스트가 언어를 골라 시작하면 그때 soniox 연결.
     · 무음 deskIdleMs(기본 30초) → 대화 종료: items 를 deskLog 에 보존, soniox 종료 → 대기(idle) 복귀.
     · TTS/화자분리 없음. 클라(호스트=ko / 뷰어=X)는 source+texts+meta(sxInfo)로 색/표시 결정. */
  function runDesk() {
    if (!SONIOX_API_KEY) { toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — 데스크 모드 사용 불가' }); return; }
    const sens = Number(ws._sxSens), maxDelay = Number(ws._sxMaxDelay), latency = Number(ws._sxLatency);
    const A = 'ko'; // 안내원 언어(고정)
    // 손님(또는 호스트)이 고르는 언어(soniox 지원, 한국어 제외).
    // es·fr·de 추가: '기타 언어'(자동 감지) 힌트로도 쓰이는데 빠져 있으면 해당 언어 첫 발화가
    // 번역되지 않고 원문이 그대로 표시된다(2026-07-29 스페인어 사례).
    const GUEST_LANGS = ['en', 'ja', 'zh', 'vi', 'th', 'id', 'ru', 'es', 'fr', 'de'];
    let deskIdleMs = Math.min(120000, Math.max(5000, Number(ws._deskIdle) || 30000)); // 무음 → 대화 종료(기본 30초). 'desk-idle' 메시지로 응대 중에도 변경 가능
    // 여객 태블릿 마이크 민감도(0~100, 50=기존 고정값과 동일) — 뷰어의 근접 게이트 임계로 변환돼 적용
    let guestSens = Math.min(100, Math.max(0, Number(ws._deskGuestSens) >= 0 ? Number(ws._deskGuestSens) : 50));
    const sendGuestSens = () => { const m = { type: 'desk-guest-sens', value: guestSens }; broadcast(sessionId, m); };

    let phase = 'idle';     // 'idle'(대기, soniox 없음) | 'active'(통역 중)
    let lockedB = null;     // 손님 언어
    let sx = null, sxReady = false;
    // 예기치 않은 종료만 누적 — 토큰 수신·새 응대 시작 시 0. 의도적 재체결(언어 감지·2채널 전환·
    // 여객 마이크 토글)은 closeSx() 가 sx 를 먼저 null 로 만들어 close 핸들러가 걸러내므로 세지 않는다.
    // 상한이 없으면 엔진이 연결 즉시 끊는 상황에서 800ms 무한 재시도가 돌고, 재연결마다 context 가
    // input_text_tokens 로 재청구돼 데스크 1대당 시간 수만원이 나간다(PROJECT_NOTES 2026-07-15 와 동일 사유).
    let sxFails = 0;
    let closed = false;     // 호스트 중지/종료 — 자동 재연결 금지 플래그
    let pending = [];       // 리플레이 버퍼(마지막 확정 이후 프레임, 상한 ~2초) — 재체결 시 재전송
    let lastVoiceArm = 0;   // 음량 기반 무음타이머 리셋 스로틀
    let foreignTimer = null;
    let warnTimer = null;       // 무음 종료 10초 전 예고
    // (삭제됨) 무음 시 양 채널 조용한 재연결(컨텍스트 플러시) — 재연결마다 context 가
    // input_text_tokens 로 재청구돼 비용 폭증(runSoniox 와 동일 사유, PROJECT_NOTES 2026-07-15).
    let staffTm = null, guestTm = null; // 채널별 발화 레이턴시 타임스탬프 { s, e } (커밋 시 c 추가)
    let pendingWayfind = null;  // 호스트 승인 대기 중인 길안내 제안
    let wayfindOn = ws._wayfind !== '0'; // 길안내 지도 기능(기본 on) — 끄면 감지·GPT 분류 자체를 생략
    let convStartedAt = 0;      // 현재 응대 시작 시각(통계용)
    let convConsentAt = null;   // 현재 응대의 손님 동의 시각(고지 모달 '동의하고 시작')

    // ---- 여객(뷰어 태블릿) 마이크 채널 — 2채널 화자 귀속 프로토타입 ----
    // 뷰어가 desk-mic on 을 보내고 바이너리 오디오를 올리면 별도 soniox one_way(선택언어→ko)로 처리.
    // 채널 자체가 화자 귀속이므로 언어 추정이 필요 없고, 동시 발화도 채널별로 독립 인식된다.
    let guestMicOn = false;
    let gsx = null, gsxReady = false;
    let gsxFails = 0;       // 여객 채널 재연결 실패 누적(데스크 채널과 독립) — 한쪽만 죽어도 상한이 걸리게
    let gPending = [];
    let gCurId = null, gFinalText = '', gFinalTrans = '', gLastTrans = '', gLastCommitText = '';
    let gLastCommitAt = 0;
    let gCurSrc = ''; const gLangVotes = langJudge(); // 여객 채널 감지 언어 — 안내원(ko) 누화 판정용
    let gToks = []; // 여객 채널 원문 확정 토큰 [[text, confidence], ...]
    const recentCommits = [];   // 교차 중복(누화) 필터: [{ n, at, ch }]
    const chStats = { staff: 0, guest: 0, crossDrops: 0 }; // 누화율 측정용(deskLog 에 저장)

    // 교차 채널 누화 판정: 반대 채널이 8초 내 유사 문장을 확정했으면 누화(마이크로 샌 소리)로 드랍.
    // 근접 게이트·언어 소유권을 통과한 잔여 누화의 마지막 방어선.
    // (두 엔진의 endpoint 시점이 벌어져 5초 창을 새던 문제 → 8초, 짧은 발화도 → 4자)
    // 원문뿐 아니라 번역문도 교차 대조 — 한 발화가 양쪽 마이크에 비슷한 음량으로 들어가 언어 판별까지
    // 엇갈린 경우(예: 손님 발화가 데스크 채널에서 한국어로 오인식), 원문 문자는 서로 달라도
    // "손님 채널의 한국어 번역 ↔ 데스크 채널의 한국어 원문"이 유사해 여기서 걸린다.
    // 판정(hit)과 기록(note)을 분리 — 음량 중재로 '살린' 발화도 기록해야 반대 채널의 진짜 누화가 걸린다.
    const crossDupHit = (ch, txt, tgt) => {
      const n = echoNorm(txt);
      const nt = echoNorm(tgt || '');
      const now = Date.now();
      while (recentCommits.length && now - recentCommits[0].at > 8000) recentCommits.shift();
      return recentCommits.some((e) => e.ch !== ch && (
        (n.length >= 4 && (echoMatch(n, e.n) || (e.nt.length >= 4 && echoMatch(n, e.nt)))) ||
        (nt.length >= 4 && (echoMatch(nt, e.n) || (e.nt.length >= 4 && echoMatch(nt, e.nt))))
      ));
    };
    const crossDupNote = (ch, txt, tgt) => { recentCommits.push({ n: echoNorm(txt), nt: echoNorm(tgt || ''), at: Date.now(), ch }); };

    /* ---- 음량 중재: 채널별 수신 프레임 RMS 로 '진짜 화자'를 판정 ----
       누화는 원거리 소리라 원 채널보다 항상 작다. 발화 시간창에서 자기 채널 평균 RMS 가
       반대 채널보다 확실히(1.3배) 크면, 언어 소유권·crossDup 이 누화로 판정했더라도 실제
       발화로 보고 살린다 — 겹침 발화 전체 드랍·직원의 외국어 응대 드랍·외래어 오귀속을 완화.
       표본이 없으면(테스트·단일 채널 순간 등) null → 기존 판정 유지. */
    const volLog = { staff: [], guest: [] }; // [{ t, r }] 최근 12초
    const noteVol = (ch, buf) => {
      try {
        const n = buf.length >> 1;
        if (!n) return 0;
        let sum = 0, cnt = 0;
        for (let i = 0; i < n; i += 4) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; cnt++; } // 4샘플 간격 서브샘플(CPU 절약)
        const r = Math.sqrt(sum / (cnt || 1));
        const arr = volLog[ch];
        const now = Date.now();
        arr.push({ t: now, r });
        while (arr.length && now - arr[0].t > 12000) arr.shift();
        return r;
      } catch { return 0; }
    };
    const meanVol = (ch, t0, t1) => {
      const arr = volLog[ch].filter((e) => e.t >= t0 && e.t <= t1);
      if (arr.length < 3) return null; // 표본 부족 → 판정 불가
      return arr.reduce((a, e) => a + e.r, 0) / arr.length;
    };
    const volOwn = (ch, t0, t1) => {
      const own = meanVol(ch, t0, t1);
      if (own == null) return null;
      const other = meanVol(ch === 'staff' ? 'guest' : 'staff', t0, t1);
      if (other == null) return own > 0.008 ? true : null; // 반대 채널 무데이터(단일 공급 순간)
      return own >= other * 1.3 && own > 0.008; // 명백히 우세 + 절대 최소음량
    };
    // 채널-언어 소유권(2채널 모드의 1차 방어): 여객 태블릿 마이크가 켜져 있으면
    // 손님 언어 발화는 여객 채널이, 한국어 발화는 데스크 채널이 소유한다.
    // 같은 발화가 반대쪽 마이크에 새어 들어와 문장이 조금 다르게 전사되면 crossDup(유사도)이
    // 놓칠 수 있는데, 언어 기준 소유권은 전사 차이와 무관하게 결정적으로 걸러 준다.
    // (손님이 한국어를 고른 단일언어 응대에서는 언어로 구분 불가 → crossDup 만 사용)
    // 자동 감지(Other languages) 중에도 적용: 언어가 아직 잠기지 않았을 뿐 '외국어=손님, 한국어=안내원'
    // 원칙은 동일 — 미적용 시 같은 발화가 두 채널에 동시에 라이브 표시(2줄)됐다가 커밋에서 합쳐지는 문제.
    const staffOwns = (src) => !(guestMicOn && src && src !== A && (autoDetect || (lockedB && lockedB !== A)));
    const guestOwns = (src) => !(src === A && (autoDetect || (lockedB && lockedB !== A)));

    // langs = 이번 응대의 활성 언어(ko + 손님 언어) — 해당 언어의 용어 표기·번역쌍만 context 로 주입
    // target = 단방향 세션의 타깃 언어(주면 번역쌍을 X→타깃 방향만 생성 — context 한도 절약)
    const baseConfig = (langs, target) => ({
      model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      client_reference_id: 'u:' + (ws._userId || 'anon') + '|p:desk', // 유저별+파이프라인(안내데스크) 사용량 집계
      enable_language_identification: true, enable_endpoint_detection: true,
      endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
      max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
      endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
      ...((() => { const c = buildSonioxContext(langs, { desk: true, target }); return c ? { context: c } : {}; })()), // 데스크: 항공용어 카테고리 제외
    });
    // 손님이 한국어를 고르면 two_way 가 성립하지 않으므로 전부 한국어로 표기(one_way→ko)
    // 2채널(여객 태블릿 마이크 on)에서는 이 채널이 안내원 전용 → one_way(ko→손님 언어) + 힌트 ko 고정.
    //   기기=채널로 화자가 물리적으로 확정돼 있어 two_way 언어 자동판별의 방향 뒤집힘이 사라지고,
    //   언어 힌트가 집중돼 인식도 좋아진다. 여객 채널(gsx)은 원래 one_way(손님 언어→ko) → 합쳐서 one_way×2.
    //   단일 마이크 폴백(여객 마이크 off)은 한 스트림에 두 언어가 섞이므로 two_way 유지(그게 올바른 용처).
    const configFor = () => {
      if (lockedB && lockedB !== A) {
        return guestMicOn
          ? { ...baseConfig([A, lockedB], lockedB), language_hints: [A], translation: { type: 'one_way', target_language: lockedB } }
          : { ...baseConfig([A, lockedB]), language_hints: [A, lockedB], translation: { type: 'two_way', language_a: A, language_b: lockedB } };
      }
      // 자동 감지 중: 언어 미정 → one_way(→ko) + 광역 힌트로 첫 발화 언어를 파악
      return { ...baseConfig([A], A), language_hints: autoDetect ? [A, ...GUEST_LANGS] : [A], translation: { type: 'one_way', target_language: A } };
    };

    const setMeta = () => {
      const sxInfo = phase === 'active'
        ? (lockedB && lockedB !== A ? { mode: 'two', a: A, b: lockedB } : (autoDetect ? { mode: 'detect' } : { mode: 'one', target: A }))
        : { mode: 'idle' };
      if (session) { session.sxInfo = sxInfo; if (phase === 'active' && lockedB) session.langs = [A, lockedB]; saveSessions(session.id); }
      broadcast(sessionId, { type: 'meta', sxInfo, guestSens, mic2: hostFed() });
      toHost({ type: 'meta', sxInfo, guestSens, mic2: hostFed() });
    };

    let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommitText = '';
    let lastCommitAt = 0; // 중복 판정은 5초 창 안에서만(의도적 반복 발화 허용)
    let autoDetect = false; // 'Other languages' 시작 — 첫 발화의 언어를 감지해 two_way 로 전환
    const langVotes = langJudge(); // 입력 언어 판정(첫 단어 오인식 교정)
    let srcToks = []; // 원문 확정 토큰 [[text, confidence], ...] — 저신뢰 하이라이트 + 추후 평가용
    let dropAcks = ws._dropAcks === '1'; // 고급옵션: 단독 응답어 기록 생략(라이브 토글 가능)
    let confFix = ws._confFix === '1'; // 고급옵션: 저신뢰 자동 교정(라이브 토글 가능)
    const targetKeyFor = (src) => (lockedB && lockedB !== A ? (src === A ? lockedB : A) : A);
    const resetUtterance = () => { curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; langVotes.reset(); srcToks = []; };

    // 자동 감지 완료(Other languages): 첫 발화가 한국어가 아니면 그 언어로 잠그고 채널 재체결.
    // 데스크·여객 어느 채널이 먼저 확정하든 여기로 모인다 — 표시 여부(소유권·누화 드랍)와 무관하게 언어부터 잠근다.
    const lockDetected = (src) => {
      if (!(autoDetect && phase === 'active' && src && src !== A && SONIOX_LANGS.includes(src))) return;
      autoDetect = false;
      lockedB = src;
      setMeta();
      armForeignTimer();
      const m2 = { type: 'desk-active', lang: src };
      broadcast(sessionId, m2); toHost(m2);
      toHost({ type: 'status', message: `언어 감지: ${src} — ${guestMicOn ? '채널별 언어 고정(단방향×2)' : `양방향 통역(ko↔${src})`}으로 전환` });
      closeSx(); connectSx();                       // 잠긴 언어 설정으로 재연결
      if (guestMicOn) { closeGuest(); connectGuest(); } // 여객 채널도 감지 언어 힌트로 재연결
    };

    const commit = () => {
      const id = curId, txt = stripFillers(finalText.trim()), src = curSrc;
      const tgt = stripFillers((finalTrans.trim() || lastTrans).trim());
      const toks = srcToks; // 이 발화의 원문 토큰(신뢰도 포함) — resetUtterance 전에 캡처
      const tm = { ...(staffTm || {}), c: Date.now() }; // 레이턴시: s(첫 토큰)/e(<end>)/c(확정)
      staffTm = null;
      resetUtterance();
      pending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외
      if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던(또는 추임새뿐인) 고스트 카드 제거
      // 자동 감지: 소유권·누화 판정으로 드랍되더라도 언어는 먼저 잠근다(첫 발화 유실 방지)
      lockDetected(src);
      // 음량 중재: 이 발화 시간창에서 데스크 마이크가 여객 마이크보다 명백히 큰 소리였다면
      // 언어·유사도 판정과 무관하게 실제 직원 발화로 본다(겹침·외국어 응대·복창을 드랍하지 않음).
      const louder = volOwn('staff', (tm.s || tm.c - 4000) - 300, tm.c);
      // 언어 소유권: 2채널 모드에서 손님 언어 발화는 여객 채널 소유 → 데스크 마이크 누화로 드랍
      if (!staffOwns(src) && louder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
      // 여객 채널이 이미 확정한 문장과 유사 → 데스크 마이크로 샌 누화, 드랍(화면 카드도 제거)
      if (guestMicOn && crossDupHit('staff', txt, tgt) && louder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
      crossDupNote('staff', txt, tgt);
      // 고급옵션: 단독 응답어(네/Yes 단독 발화) 기록 생략
      if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null); return; }
      chStats.staff++;
      const out = tgt || txt;
      if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
      lastCommitText = out;
      lastCommitAt = Date.now();
      upsertItem(id, { [targetKeyFor(src)]: out }, txt, null, src || null, undefined, toks, tm);
      if (tgt) polishCommit(id, targetKeyFor(src), txt, tgt); // 번역 다듬기(nano) — 직역투 후교정
      if (confFix) maybeConfFix(id, toks, txt, src, targetKeyFor(src)); // 저신뢰 자동 교정(고급옵션)
      // 길안내: 안내원(한국어) '답변'에서 시설 언급 감지 → 목적지 전송.
      // 외국인 질문이 아니라 직원 답변 기준 — 직원의 현장판단(보안구역·특정 시설 지목)을 반영하고,
      // 기계번역이 아닌 원어민 한국어 원문(txt)에서 매칭하므로 정확도가 높다.
      if (wayfindOn && phase === 'active' && src === A && txt) {
        const dfl = (session && session.deskFloor) || '1F';
        const dsd = (session && session.deskSide) || 'S';
        // 답변에 '목적지 층'이 있으면(예: "1층으로 내려가세요") 데스크 기본 층 우선순위를 덮어씀(직원 현장판단 반영).
        const destFloor = parseAnswerFloor(txt, dfl) || dfl;
        // 오탐 방지: 즉시 뷰어에 쏘지 않고 호스트에 '제안'만 → 호스트가 표시/무시(또는 자동 표시 설정).
        const fire = (catId, via) => {
          try {
            const wf = resolveCategoryDests(catId, destFloor);
            if (wf && wf.dests.length) {
              pendingWayfind = { type: 'wayfind', ...wf, deskFloor: dfl, deskSide: dsd };
              toHost({ ...pendingWayfind, type: 'wayfind-suggest' });
              if (session) { // 운영 로그: 감지 발화·경로(직매칭/GPT)·표시 여부 — 사전·프롬프트 튜닝용
                session.wayfindLog = session.wayfindLog || [];
                session.wayfindLog.push({ at: Date.now(), catId, via, txt: txt.slice(0, 80), shown: false });
                if (session.wayfindLog.length > 200) session.wayfindLog = session.wayfindLog.slice(-200);
                saveSessions(session.id);
              }
            }
          } catch {}
        };
        // 직전 손님 질문(한국어 번역) — 시설명이 답변에 없어도 질문에서 분류할 수 있게 컨텍스트로 전달
        const lastGuestQ = session && Array.isArray(session.items)
          ? [...session.items].reverse().find((it) => it.lang && it.lang !== A && it.texts && it.texts[A])
          : null;
        const NEG = /없|말고|아니/; // 부정·비교 표지 → 직매칭 신뢰 불가, GPT 분류로
        const direct = detectCategory(txt);            // 1) 사전 직매칭(원어민 한국어 → 신뢰도 높음, 무료)
        if (direct.length && !NEG.test(txt)) fire(direct[0].id, 'direct');
        else if (direct.length || isLocationAnswer(txt) || (lastGuestQ && isLocationAnswer(lastGuestQ.texts[A]))) {
          const gen = convStartedAt; // 비동기 분류가 응대 종료 후 도착하면 다음 손님에게 이전 지도가 제안되는 것 방지
          classifyFacility(txt, lastGuestQ ? lastGuestQ.texts[A] : null)
            .then((id) => { if (id && phase === 'active' && gen === convStartedAt) fire(id, 'gpt'); })
            .catch(() => {}); // 2) gpt-5.4-mini
        }
      }
    };

    // 무음 자동종료: 발화가 들릴 때마다 리셋 → deskIdleMs 동안 '아무 말도' 없으면 대화 종료 → 대기(idle)
    // 종료 10초 전 예고(desk-idle-warn) — 뷰어가 카운트다운을 보여주고 터치(keepalive)로 연장 가능
    const armForeignTimer = () => {
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      foreignTimer = setTimeout(() => { if (phase === 'active') endConversation(); }, deskIdleMs);
      const warnAt = deskIdleMs - 10000;
      if (warnAt > 2000) warnTimer = setTimeout(() => {
        if (phase === 'active') { const w = { type: 'desk-idle-warn', secondsLeft: 10 }; broadcast(sessionId, w); toHost(w); }
      }, warnAt);
    };
    let ending = false;      // 그레이스 종료 진행 중(중복 방지)
    let endTimer = null;     // 그레이스 마감 타이머(언어 전환 시 즉시 마감에 사용)
    const endConversation = (graceful = true) => {
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      pendingWayfind = null;
      // 종료 절차 중 commit() 의 자동감지 분기(양방향 재체결·desk-active 브로드캐스트)가 발동하지 않도록
      autoDetect = false;
      // 승계(takeover)로 밀려난 구 파이프라인의 지연 close/타이머가 새 호스트의 진행 중 응대를
      // 아카이브·리셋하지 못하게 — 현재 등록된 컨트롤러만 공유 세션을 만진다.
      if (deskCtrl.get(sessionId) !== ctrl) { phase = 'idle'; lockedB = null; resetUtterance(); closeSx(); closeGuest(); return; }
      if (ending) {
        // 그레이스 대기 중 즉시 마감 요청(언어 전환 등) → 지금 바로 마감해 새 응대와 겹치지 않게
        if (!graceful) { clearTimeout(endTimer); finishEnd(); }
        return;
      }
      if (!graceful || (!sx && !gsx)) { finishEnd(); return; }
      // 그레이스 마감: finalize('') 요청 후 0.9초간 in-flight 토큰을 계속 수신(<end> 도착 시 정상
      // 커밋)한 뒤 마감 — 즉시 close 하면 endpoint 대기 중이던 마지막 문장이 기록에서 유실된다.
      ending = true;
      try { sx && sx.send(''); } catch {}
      try { gsx && gsx.send(''); } catch {}
      endTimer = setTimeout(finishEnd, 900);
    };
    function finishEnd() {
      ending = false;
      clearTimeout(endTimer);
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      // 그레이스 중 호스트 이탈로 deskCtrl 이 지워졌어도 아카이브는 수행한다(기록 보존).
      // 단 '승계'(새 호스트 등록)면 뷰어 방송·메타는 새 파이프라인 몫이라 건드리지 않는다.
      const now2 = deskCtrl.get(sessionId);
      const superseded = !!(now2 && now2 !== ctrl);
      // 사용량: 실제 통역(active) 시간만 누적 — 대기(idle) 시간이 사용량으로 집계되던 문제 수정
      if (phase === 'active' && convStartedAt) ws._deskActiveMs = (ws._deskActiveMs || 0) + (Date.now() - convStartedAt);
      ws._deskActiveStart = 0;
      guestCommit(); // 손님의 마지막 미확정 발화도 기록에 남김
      commit();
      pendingWayfind = null; // commit() 의 길안내 감지가 종료 직전 발화로 제안을 재설정하는 경우 제거(다음 손님 오표시 방지)
      if (session) {
        if (Array.isArray(session.items) && session.items.length) {
          session.deskLog = session.deskLog || [];
          // stats: 채널별 확정 수 + 누화 드랍 수 — 2채널 프로토타입 누화율 측정용
          // 응대 언어: 잠긴 언어(lockedB) 우선, 미잠금 종료(감지 전 이탈 등)면 발화 items 에서 유추 — 로그 '미상' 방지
          const convLang = lockedB || (session.items.find((x) => x.lang && x.lang !== 'ko') || {}).lang || null;
          session.deskLog.push({ startedAt: convStartedAt || null, endedAt: Date.now(), lang: convLang, ...(convConsentAt ? { consentAt: convConsentAt } : {}), items: session.items, stats: { ...chStats } });
          capDeskLog(session);
          session.items = [];
        }
        saveSessions(session.id);
      }
      if (chStats.staff + chStats.guest + chStats.crossDrops > 0) console.log(`[desk] 채널 통계 staff=${chStats.staff} guest=${chStats.guest} crossDrops=${chStats.crossDrops}`);
      chStats.staff = 0; chStats.guest = 0; chStats.crossDrops = 0;
      recentCommits.length = 0;
      gLastCommitText = '';
      lastCommitText = '';
      phase = 'idle'; lockedB = null; autoDetect = false; resetUtterance();
      pending = []; gPending = [];
      closeSx();
      closeGuest(); // 여객 채널 종료(guestMicOn 플래그는 유지 — 다음 응대에서 재연결)
      if (!superseded) {
        broadcast(sessionId, { type: 'desk-reset' });
        toHost({ type: 'desk-reset' });
        broadcast(sessionId, { type: 'snapshot', items: [] });
        setMeta();
        toHost({ type: 'status', message: '대화 종료 — 대기 중(언어 선택 대기)' });
      }
    }

    // 통역 시작: 손님(뷰어)이 언어를 고르거나 호스트가 수동 시작 — 이때 처음 soniox 연결
    const startConversation = (B, consentAt) => {
      if (closed) return;
      // 명시 선택은 엔진 지원 전체(SONIOX_LANGS 60개)로 검증한다. 미지원 값이면 영어로 바꾸지 않고
      // 자동감지로 넘긴다 — 손님이 고른 언어가 아닌 언어로 조용히 통역되는 것보다 낫다.
      // (GUEST_LANGS 는 자동감지 language_hints 전용이라 여기 쓰지 않는다. 늘리면 힌트가 희석된다.)
      const lang = B !== 'auto' && SONIOX_LANGS.includes(B) ? B : null;
      const auto = !lang; // 'auto' 선택 또는 미지원 값 → 첫 발화로 감지
      if (phase === 'active' && !auto && lang === lockedB) return;
      // 응대 중 다른 언어 선택 = 새 손님 — 이전 응대를 먼저 마감(아카이브)해 두 손님의 기록이
      // 한 deskLog 항목으로 병합되지 않게 한다(즉시 마감 — 새 손님을 기다리게 하지 않음).
      if (phase === 'active') endConversation(false);
      if (phase !== 'active') { convStartedAt = Date.now(); ws._deskActiveStart = convStartedAt; } // 응대 시작 시각(통계·사용량용)
      phase = 'active'; lockedB = lang; autoDetect = auto; lastCommitText = ''; resetUtterance();
      sxFails = 0; gsxFails = 0; // 새 손님 응대는 이전 응대의 실패 이력을 물려받지 않는다
      convConsentAt = consentAt || null; // 이 응대의 손님 동의 시각(아카이브에 함께 저장)
      pending = [];
      setMeta();
      armForeignTimer();
      const m = { type: 'desk-active', lang: lang || 'auto' };
      broadcast(sessionId, m); toHost(m);
      toHost({ type: 'status', message: auto ? `통역 시작 — 손님의 첫 발화로 언어를 감지합니다 (무음 ${deskIdleMs / 1000}초 시 자동 종료)` : `통역 시작 (ko↔${lang}) — 무음 ${deskIdleMs / 1000}초 시 자동 종료` });
      connectSx();
      if (guestMicOn) connectGuest(); // 여객 마이크가 이미 연결돼 있으면 여객 채널도 시작
    };

    function closeSx() {
      const old = sx; sx = null; sxReady = false;
      if (old) { try { old.send(''); } catch {} try { old.close(); } catch {} }
    }
    function connectSx() {
      if (closed || phase !== 'active') return;
      const old = sx;
      sxReady = false;
      const next = openSonioxWs();
      sx = next;
      next.on('open', () => {
        if (sx !== next) return; // 빠른 재체결 시 구 소켓의 늦은 open 이 준비 상태를 오염시키지 않게
        try { next.send(JSON.stringify(configFor())); } catch {}
        sxReady = true;
        // 리플레이: 마지막 확정 이후 프레임을 재전송(버퍼 유지) — 구 소켓으로 나갔던 진행 중 발화 복구
        for (const f of pending) { try { next.send(f); } catch {} }
      });
      // 종료(idle)·소켓 교체 후 늦게 도착한 토큰이 다음 응대 화면·기록에 새지 않도록 가드
      next.on('message', (raw) => { if (sx === next && phase === 'active') onSxMessage(raw); });
      next.on('error', (e) => toHost({ type: 'status', message: 'Soniox 오류: ' + ((e && e.message) || e) }));
      // 통역 중 연결이 예기치 않게 끊기면 자동 재연결 — 응대 중 멈춤 방지
      next.on('close', () => {
        if (sx === next && !closed && phase === 'active') {
          sxReady = false; // 죽은 소켓으로 send 하지 않고 재연결까지 pending 큐에 쌓이도록(발화 앞부분 유실 방지)
          sxFails++;
          if (sxFails >= SX_MAX_FAILS) {
            // 상한 도달: 재시도만 멈춘다. endConversation 은 부르지 않는다 — 손님 앞에서 응대를 강제
            // 종료시키는 것보다, 안내원이 상황을 알고 판단하게 두는 편이 낫다(유인 데스크).
            sx = null;
            toHost({ type: 'status', message: `엔진 연결에 ${SX_MAX_FAILS}회 연속 실패해 자동 재연결을 멈췄습니다. 응대를 종료했다가 다시 시작해 주세요.` });
            broadcast(sessionId, { type: 'desk-engine-down' });
            return;
          }
          const delay = sxRetryDelay(sxFails);
          toHost({ type: 'status', message: `엔진 재연결 중… (${sxFails}/${SX_MAX_FAILS})` });
          setTimeout(() => { if (sx === next && !closed && phase === 'active') connectSx(); }, delay);
        }
      });
      try { if (old && old !== next) old.close(); } catch {}
    }

    function onSxMessage(raw) {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
      const toks = ev.tokens || [];
      if (!toks.length) return;
      sxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
      if (phase === 'active') armForeignTimer(); // 어떤 발화든(안내원 한국어 포함) 들리면 무음 타이머 리셋
      let endHit = false, nonFinal = '', nonFinalTrans = '';
      langVotes.begin();
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        if (t.translation_status === 'translation') {
          langVotes.token(t); curSrc = langVotes.pick(curSrc);
          if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text;
        } else {
          // 입력 언어는 확정 토큰 다수결 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
          langVotes.token(t); curSrc = langVotes.pick(curSrc); // 동률에선 유지(방향 플립 방지)
          if (t.is_final) {
            finalText += t.text;
            if (t.text.trim()) srcToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]); // 신뢰도 기록
          } else nonFinal += t.text;
        }
      }
      const shownSrc = (finalText + nonFinal).trim();
      const shownTgt = (finalTrans + nonFinalTrans).trim();
      if (shownTgt) lastTrans = shownTgt;
      if (!curId && (shownSrc || shownTgt)) { curId = newId(); staffTm = { s: Date.now() }; } // 레이턴시: 발화 시작
      // 2채널 모드: 손님 언어로 감지된 진행 중 발화는 표시하지 않음(커밋 시 드랍될 누화의 이중 표시 방지)
      if (curId) {
        if (!staffOwns(curSrc)) liveSend(curId, {}, null, null);
        else liveSend(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null, null, curSrc || null);
      }
      if (endHit) { if (staffTm && staffTm.e == null) staffTm.e = Date.now(); commit(); } // 길이 기반 강제 확정 제거
    }

    /* ---- 여객 채널(2채널 프로토타입): 뷰어 태블릿 마이크 → 별도 soniox one_way(선택언어→ko) ----
       언어 힌트를 손님 언어로 고정해 인식 정확도를 높이고, side='left'/lang=손님언어로 결정적 귀속.
       누화 방어: ① 뷰어 근접 게이트(작은 소리는 무음 전송) ② crossDup(교차 중복 필터). */
    const guestConfig = () => ({
      ...baseConfig(lockedB && lockedB !== A ? [A, lockedB] : [A], A), // 여객 채널은 항상 one_way→ko
      // 자동 감지 중엔 여객 채널이 외국어를 소유 — 광역 힌트로 첫 발화 언어를 파악(ko 고정이면 감지 불가)
      language_hints: lockedB && lockedB !== A ? [lockedB] : (autoDetect ? GUEST_LANGS : [A]),
      translation: { type: 'one_way', target_language: A },
    });
    function closeGuest() {
      // gPending(리플레이 버퍼)은 비우지 않는다 — 언어 감지 직후 closeGuest→connectGuest 재체결에서
      // 진행 중 발화의 앞부분을 새 소켓에 재전송하기 위함(확정 시 guestCommit 이 비움).
      const old = gsx; gsx = null; gsxReady = false;
      gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes.reset(); gToks = [];
      if (old) { try { old.send(''); } catch {} try { old.close(); } catch {} }
    }
    function connectGuest() {
      if (closed || phase !== 'active' || !guestMicOn) return;
      const old = gsx;
      gsxReady = false;
      const next = openSonioxWs();
      gsx = next;
      next.on('open', () => {
        if (gsx !== next) return; // 구 소켓의 늦은 open 가드(connectSx 와 동일)
        try { next.send(JSON.stringify(guestConfig())); } catch {}
        gsxReady = true;
        // 리플레이: 마지막 확정 이후 프레임(최근 ~2초)을 재전송(버퍼 유지) — 재체결 중 발화 앞부분 복구
        for (const f of gPending) { try { next.send(f); } catch {} }
      });
      // 종료·소켓 교체 후 늦게 도착한 토큰 차단(다음 응대로 새는 문제 방지)
      next.on('message', (raw) => { if (gsx === next && phase === 'active') onGuestMsg(raw); });
      next.on('error', () => {});
      next.on('close', () => {
        if (gsx === next && !closed && phase === 'active' && guestMicOn) {
          gsxReady = false; // 재연결까지 gPending 큐에 쌓이도록(여객 발화 앞부분 유실 방지)
          gsxFails++;
          if (gsxFails >= SX_MAX_FAILS) {
            // 여객 채널만 죽은 경우 — 데스크(안내원) 채널은 그대로 두고 단일 채널로 계속 응대한다.
            gsx = null;
            toHost({ type: 'status', message: `여객 마이크 엔진이 ${SX_MAX_FAILS}회 연속 실패했습니다. 데스크 마이크만으로 계속됩니다.` });
            return;
          }
          const delay = sxRetryDelay(gsxFails);
          setTimeout(() => { if (gsx === next && !closed && phase === 'active' && guestMicOn) connectGuest(); }, delay);
        }
      });
      try { if (old && old !== next) old.close(); } catch {}
    }
    const guestCommit = () => {
      const id = gCurId, txt = stripFillers(gFinalText.trim()), gSrc = gCurSrc;
      const tgt = stripFillers((gFinalTrans.trim() || gLastTrans).trim());
      const toks = gToks; // 이 발화의 원문 토큰(신뢰도 포함)
      const tm = { ...(guestTm || {}), c: Date.now() }; // 레이턴시: s/e/c
      guestTm = null;
      gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes.reset(); gToks = [];
      gPending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외
      if (!id || !txt) { if (id) liveSend(id, {}, null, null, null, 'left'); return; } // 고스트(또는 추임새뿐인) 카드 제거
      // 자동 감지(Other languages): 손님은 여객 태블릿에 대고 말하므로 이 채널에서 감지되는 게 정상 경로
      lockDetected(gSrc);
      // 음량 중재: 발화 시간창에서 여객 마이크가 명백히 우세하면 실제 손님 발화로 보고 살린다
      const gLouder = volOwn('guest', (tm.s || tm.c - 4000) - 300, tm.c);
      // 언어 소유권: 한국어로 감지된 발화는 안내원 채널 소유 → 여객 마이크 누화로 드랍
      if (!guestOwns(gSrc) && gLouder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
      // 안내원 채널이 이미 확정한 문장과 유사 → 여객 마이크로 샌 누화, 드랍
      if (crossDupHit('guest', txt, tgt) && gLouder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
      crossDupNote('guest', txt, tgt);
      // 고급옵션: 단독 응답어 기록 생략
      if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null, null, 'left'); return; }
      chStats.guest++;
      const out = tgt || txt;
      if (out && out === gLastCommitText && Date.now() - gLastCommitAt < 5000) return;
      gLastCommitText = out;
      gLastCommitAt = Date.now();
      upsertItem(id, { [A]: out }, txt, null, lockedB || null, 'left', toks, tm);
      if (tgt) polishCommit(id, A, txt, tgt); // 번역 다듬기(nano) — 손님 발화의 한국어 직역투 후교정
      if (confFix) maybeConfFix(id, toks, txt, gSrc, A); // 저신뢰 자동 교정(고급옵션) — 여객 채널
    };
    function onGuestMsg(raw) {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) return;
      const toks = ev.tokens || [];
      if (!toks.length) return;
      gsxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
      if (phase === 'active') armForeignTimer();
      let endHit = false, nonFinal = '', nonFinalTrans = '';
      gLangVotes.begin();
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        if (t.translation_status === 'translation') { gLangVotes.token(t); gCurSrc = gLangVotes.pick(gCurSrc); if (t.is_final) gFinalTrans += t.text; else nonFinalTrans += t.text; }
        else {
          gLangVotes.token(t); gCurSrc = gLangVotes.pick(gCurSrc);
          if (t.is_final) {
            gFinalText += t.text;
            if (t.text.trim()) gToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]); // 신뢰도 기록
          } else nonFinal += t.text;
        }
      }
      const shownSrc = (gFinalText + nonFinal).trim();
      const shownTgt = (gFinalTrans + nonFinalTrans).trim();
      if (shownTgt) gLastTrans = shownTgt;
      if (!gCurId && (shownSrc || shownTgt)) { gCurId = newId(); guestTm = { s: Date.now() }; } // 레이턴시: 발화 시작
      // 한국어(안내원 누화)로 감지된 진행 중 발화는 표시하지 않음
      if (gCurId) {
        if (!guestOwns(gCurSrc)) liveSend(gCurId, {}, null, null, null, 'left');
        else liveSend(gCurId, { [A]: shownTgt }, shownSrc || null, null, lockedB || null, 'left');
      }
      if (endHit) { if (guestTm && guestTm.e == null) guestTm.e = Date.now(); guestCommit(); } // 길이 기반 강제 확정 제거
    }
    // 여객 마이크 채널 on/off — 켜지면 응대 중일 때 즉시 엔진 연결, 꺼지면 단일 채널로 폴백.
    // fromWs 로 소유 소켓을 추적: 뷰어 재접속 시 구 소켓의 close 가 새 소켓의 채널을 끄지 않도록.
    // 공급원 2종: 뷰어 태블릿(desk-mic) / PC 호스트 직결(src=guestmic, _deskGuestFeed) — 호스트 공급 우선.
    let guestWs = null;
    let lastMic2 = false; // 뷰어에 알린 '호스트(PC) 여객 마이크 공급' 상태 — 변화 시에만 브로드캐스트
    const hostFed = () => !!(guestMicOn && guestWs && guestWs._deskGuestFeed);
    const pushMic2 = () => {
      const v = hostFed();
      if (v === lastMic2) return;
      lastMic2 = v;
      // on: 뷰어 태블릿은 자기 마이크 캡처를 멈추고 표출 전용으로 / off: (응대 중이면) 태블릿 마이크로 자동 복귀
      broadcast(sessionId, { type: 'desk-mic2', on: v });
    };
    const guestMic = (on, fromWs) => {
      if (on) {
        // PC 호스트가 여객 마이크를 직접 공급 중이면 뷰어 태블릿의 desk-mic 요청은 무시(호스트 공급 우선).
        // 소유 소켓이 이미 죽어 있으면(절전 등) 즉시 넘겨받게 readyState 를 함께 확인.
        if (guestWs && guestWs !== fromWs && guestWs._deskGuestFeed && !(fromWs && fromWs._deskGuestFeed) && guestWs.readyState === WebSocket.OPEN) return;
        guestWs = fromWs || guestWs;
      } else if (fromWs && guestWs && fromWs !== guestWs) return; // 소유자가 아닌(이전) 소켓의 해제는 무시
      if (guestMicOn === !!on) { pushMic2(); return; } // 소유권만 바뀐 경우(태블릿→PC)도 뷰어에 알림
      guestMicOn = !!on;
      const m = { type: 'desk-guest-mic', on: guestMicOn };
      toHost(m); broadcast(sessionId, m);
      gsxFails = 0; // 안내원이 직접 켠 것 = 재시도 의사 — 이전 장애의 실패 이력을 물려받지 않는다
      if (guestMicOn && phase === 'active') connectGuest();
      if (!guestMicOn) closeGuest();
      // 채널별 언어 고정 전환: 2채널이 되면 호스트 채널을 one_way(ko→손님 언어)로, 해제되면 two_way 로 재체결
      if (phase === 'active' && lockedB && lockedB !== A) { commit(); closeSx(); connectSx(); }
      pushMic2();
      toHost({
        type: 'status',
        message: guestMicOn
          ? `여객 마이크(${hostFed() ? 'PC 직결' : '태블릿'}) 연결 — 2채널(채널별 언어 고정, 단방향×2)로 동작합니다.`
          : '여객 마이크 해제 — 데스크 마이크 단일 채널(양방향)로 동작합니다.',
      });
    };

    ws.on('message', (data, isBinary) => {
      // 대기(idle) 중에는 오디오를 버림(STT 세션 없음 — 비용 0). 통역 중에만 soniox 로 전달.
      if (isBinary) {
        if (phase !== 'active') return;
        const r = noteVol('staff', data); // 음량 중재용 RMS 기록
        // 무음 타이머는 '토큰'뿐 아니라 '들리는 소리'로도 리셋 — 게이트/엔진 장애로 토큰이 안 와도
        // 손님·직원이 말하는 중이면 응대가 끊기지 않게 한다(2초 스로틀).
        if (r > 0.02 && Date.now() - lastVoiceArm > 2000) { lastVoiceArm = Date.now(); armForeignTimer(); }
        // 리플레이 버퍼: 마지막 확정 이후 프레임(최근 ~2초)을 유지 — 재체결(언어 감지·여객 마이크
        // 전환·엔진 재연결) 시 새 소켓에 재전송해 진행 중 발화의 앞부분 유실을 복구한다.
        pending.push(data); if (pending.length > 24) pending.shift();
        if (sxReady && sx) { try { sx.send(data); } catch {} }
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') { closed = true; clearTimeout(foreignTimer); clearTimeout(warnTimer); closeSx(); closeGuest(); }
        else if (m.type === 'desk-start') { startConversation(String(m.lang || '').toLowerCase()); } // 호스트 수동 시작(언어 선택)
        else if (m.type === 'desk-reset-now') { endConversation(); } // 호스트 수동 '대기모드로' — 대화 종료·뷰어 터치화면 복귀
        else if (m.type === 'desk-guest-sens') { // 여객 태블릿 마이크 민감도 변경(호스트 고급 설정)
          const v = Number(m.value);
          if (Number.isFinite(v)) { guestSens = Math.min(100, Math.max(0, v)); sendGuestSens(); }
        }
        else if (m.type === 'dropAcks') { dropAcks = !!m.on; } // 고급옵션: 단독 응답어 생략 라이브 토글
        else if (m.type === 'confFix') { confFix = !!m.on; } // 고급옵션: 저신뢰 자동 교정 라이브 토글
        else if (m.type === 'desk-idle') { // 무음 자동 종료 시간 변경 — 데스크는 상시 캡처라 세션 중 변경을 허용
          const v = Number(m.value);
          if (Number.isFinite(v)) {
            deskIdleMs = Math.min(120000, Math.max(5000, v));
            if (phase === 'active') armForeignTimer(); // 진행 중이면 새 시간으로 타이머 재장전
            toHost({ type: 'status', message: `무음 자동 종료: ${deskIdleMs / 1000}초` });
          }
        }
        else if (m.type === 'wayfind-show') { // 호스트가 길안내 제안 승인 → 뷰어에 지도 표시
          if (pendingWayfind) {
            broadcast(sessionId, pendingWayfind);
            if (session && Array.isArray(session.wayfindLog) && session.wayfindLog.length) { session.wayfindLog[session.wayfindLog.length - 1].shown = true; saveSessions(session.id); }
            pendingWayfind = null;
          }
        }
        else if (m.type === 'wayfind-dismiss') { pendingWayfind = null; } // 제안 무시
        else if (m.type === 'wayfind-on') { wayfindOn = !!m.on; if (!wayfindOn) pendingWayfind = null; } // 길안내 지도 기능 on/off(라이브)
      } catch {}
    });
    ws.on('close', () => {
      const wasActive = phase === 'active';
      closed = true;
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      // 순서 중요: endConversation() 의 좀비 가드는 '등록 컨트롤러 = 나'일 때만 아카이브를 허용한다.
      // deskCtrl 을 먼저 지우면 자기 자신을 좀비로 판정해 응대 기록·뷰어 리셋이 전부 생략된다(회귀 이력).
      const isCur = deskCtrl.get(sessionId) === ctrl;
      if (wasActive && isCur) endConversation(); // 응대 중 호스트 이탈 → 기록 보존 + 뷰어를 터치 화면으로
      else { closeSx(); closeGuest(); }
      if (isCur) deskCtrl.delete(sessionId);
    });

    // 뷰어(손님)의 통역 시작/종료/연장/여객 마이크 요청을 이 파이프라인으로 전달받기 위한 컨트롤러 등록
    const ctrl = {
      start: startConversation,
      state: () => ({ phase, lang: lockedB || null }), // 데스크 현황판용(응대 중 여부·손님 언어)
      guestSens: () => guestSens, // 뷰어 접속 시 현재 여객 마이크 민감도 동기화용
      mic2: hostFed, // 뷰어 접속 시 '호스트(PC) 여객 마이크 공급 중' 동기화용 — true 면 뷰어는 표출 전용
      end: endConversation,
      keepalive: () => { if (phase === 'active') armForeignTimer(); },
      guestMic,
      feedGuest: (data, fromWs) => {
        if (phase !== 'active' || !guestMicOn) return; // 대기 중 여객 오디오는 버림(비용 0)
        if (guestWs && fromWs && fromWs !== guestWs) return; // 소유 태블릿 외 스트림 거절(두 태블릿 동시 desk-mic 시 오염 방지)
        const r = noteVol('guest', data); // 음량 중재용 RMS 기록
        if (r > 0.02 && Date.now() - lastVoiceArm > 2000) { lastVoiceArm = Date.now(); armForeignTimer(); } // 소리 기반 무음타이머 리셋
        // 리플레이 버퍼(마지막 확정 이후, 상한 ~2초) — 언어 감지·재연결로 소켓이 바뀌어도 발화 앞부분 복구
        gPending.push(data);
        if (gPending.length > 24) gPending.shift();
        if (gsxReady && gsx) {
          // 백프레셔: 엔진 쪽으로 못 내보내고 쌓이면 오래된 오디오 대신 현재 프레임을 버려 실시간 유지
          if (gsx.bufferedAmount > 262144) return;
          try { gsx.send(data); } catch {}
        }
      },
    };
    deskCtrl.set(sessionId, ctrl);

    // 승계 복구: 응대 도중 호스트가 새로고침하면 구 파이프라인은 (컨트롤러 불일치 가드로) 세션을 못 만져
    // 진행 중이던 items 가 아카이브되지 않은 채 남는다 → 여기서 '중단된 응대'로 보존하고 뷰어를 초기화.
    // (방치하면 다음 손님의 deskLog 한 건에 이전 손님 대화가 섞여 기록됨)
    if (session && Array.isArray(session.items) && session.items.length) {
      session.deskLog = session.deskLog || [];
      session.deskLog.push({ startedAt: null, endedAt: Date.now(), lang: (session.items.find((x) => x.lang && x.lang !== 'ko') || {}).lang || null, interrupted: true, items: session.items, stats: null });
      capDeskLog(session);
      session.items = [];
      saveSessions(session.id);
      broadcast(sessionId, { type: 'desk-reset' });
      broadcast(sessionId, { type: 'snapshot', items: [] });
      toHost({ type: 'status', message: '이전 호스트의 진행 중 응대를 기록에 보존하고 대기 모드로 초기화했습니다.' });
    }

    setMeta();
    toHost({ type: 'status', message: `데스크 대기 중 — 손님이 태블릿에서 언어를 선택하면 통역이 시작됩니다. (무음 ${deskIdleMs / 1000}초 시 자동 종료)` });
  }

  /* ---------- gpt-realtime-translate -> gpt 다듬기 ---------- */
  function runTranslate() {
    const oa = new WebSocket(
      `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(TRANSLATE_MODEL)}`,
      { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
    );
    idleClose = () => { try { oa.close(); } catch {} };
    let oaReady = false;
    let closing = false;
    let buf = '';
    let curId = null;
    let idleTimer = null;
    let audioOut = ws._audioOut; // 번역 음성 재생 여부(클라 토글로 변경 가능)
    const pending = [];

    // translate 출력은 이미 자연스러운 번역이라, 카드에 바로 스트리밍해서 보여준다.
    const IDLE_MS = 1200; // 이만큼 새 글자가 없으면(말이 멈추면) 그 카드를 확정
    const MAX_BUF = 280; // 너무 길어지면 강제 확정(폭주 방지)
    // 스트리밍 중간 업데이트(저장 안 함): 같은 id 로 보내 카드 텍스트가 실시간으로 자라남
    const liveUpdate = () => {
      if (!curId) curId = newId();
      liveSend(curId, { [targetLang]: buf }, null);
    };
    // 확정: 세션에 저장하고, 다듬기 켜져 있으면 다듬어 교체
    const finalize = () => {
      clearTimeout(idleTimer);
      const text = stripFillers(buf.trim()); // 추임새(간투사) 제거
      const id = curId;
      buf = '';
      curId = null;
      if (!text || !id) return;
      upsertItem(id, { [targetLang]: text }, null);
      // translate 다듬기: 띄어쓰기만 교정 (단어·어순·내용 보존)
      spacingPolish(text).then((p) => p && upsertItem(id, { [targetLang]: stripFillers(p.trim()) }, null));
    };

    oa.on('open', () => {
      oa.send(
        JSON.stringify({
          type: 'session.update',
          session: { audio: { output: { language: targetLang } } },
        })
      );
      // 세션 준비 전 오디오는 버려지므로, 준비 이벤트(또는 1.5s 폴백) 후 전송.
      setTimeout(markReady, 1500);
    });
    function markReady() {
      if (oaReady) return;
      // 1.5s 폴백 타이머가 그 사이 죽은 소켓을 '연결됨'으로 되살리지 않게 — close 가 oaReady=false 로
      // 리셋한 뒤 폴백이 다시 true 로 만들면 이후 모든 오디오가 죽은 소켓으로 조용히 버려졌다.
      if (!oa || oa.readyState !== WebSocket.OPEN) return;
      oaReady = true;
      while (pending.length) oa.send(pending.shift());
      toHost({ type: 'status', message: '엔진 연결됨 (translate)' });
      bumpIdle(); // 무입력 카운트다운 시작
    }

    oa.on('message', (raw) => {
      let ev;
      try {
        ev = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!oaReady && /session\.(created|updated)/.test(ev.type || '')) markReady(); // 준비됨 → 버퍼 오디오 전송
      if (ev.type === 'session.output_audio.delta') {
        if (ev.delta) {
          if (audioOut) toHost({ type: 'audio', b64: ev.delta }); // 호스트: 자체 토글
          broadcastAudio(sessionId, ev.delta); // 모바일 뷰어: '음성 듣기' 켠 사람에게만 전송
        }
        return;
      }
      if (ev.type === 'session.output_transcript.delta') {
        bumpIdle(); // 번역 활동 → 유휴 타이머 리셋
        buf += ev.delta || '';
        liveUpdate(); // 카드에 바로 스트리밍
        if (buf.length >= MAX_BUF) {
          finalize();
        } else {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(finalize, IDLE_MS); // 말이 멈추면 그 카드 확정
        }
      } else if (ev.type === 'session.closed') {
        finalize();
        try {
          oa.close();
        } catch {}
      } else if (ev.type && ev.type.includes('error')) {
        console.error('[translate error]', JSON.stringify(ev));
        toHost({ type: 'status', message: '엔진 오류: ' + (ev.error?.message || ev.type) });
      }
    });
    oa.on('error', (e) => toHost({ type: 'status', message: 'OpenAI 연결 오류: ' + (e?.message || e) }));
    // 죽은 소켓으로 send 방지 + translate 는 자동 재연결이 없으므로 캡처를 명시적으로 멈춰
    // '진행 중처럼 보이며 오디오가 조용히 버려지는' 상태를 만들지 않는다.
    oa.on('close', () => {
      oaReady = false;
      toHost({ type: 'idle-stop' });
      toHost({ type: 'status', message: '엔진 연결 종료 — 다시 시작해 주세요.' });
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const msg = JSON.stringify({ type: 'session.input_audio_buffer.append', audio: Buffer.from(data).toString('base64') });
        if (oaReady) oa.send(msg);
        else { pending.push(msg); if (pending.length > 400) pending.shift(); } // 연결 전 큐 상한(~30초) — 엔진 미연결 장기화 시 메모리 폭증 방지
        return;
      }
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (m.type === 'audioOut') {
        audioOut = !!m.on; // 토글 실시간 반영
        return;
      }
      if (m.type === 'stop' && !closing) {
        closing = true;
        try {
          if (oaReady) oa.send(JSON.stringify({ type: 'session.close' }));
          else oa.close();
        } catch {}
      }
    });
    ws.on('close', () => {
      finalize(); // 남은 스트리밍 확정/저장
      try {
        oa.close();
      } catch {}
    });
  }
}

server.listen(PORT, () => {
  const ip = getLanIp();
  console.log(`\n  AirTalk 서버 실행 중`);
  console.log(`  · 데스크톱:  http://localhost:${PORT}`);
  console.log(`  · 같은 와이파이 모바일: http://${ip}:${PORT}\n`);
});

// 벤더 사용량 주기 신선화(12h) — 관리자가 화면을 안 봐도 일별 실사용량이 계속 누적되어
// 벤더 API 보관기간(예: Soniox 91일)이 지나도 앱에는 기록이 남는다. 키가 하나라도 있을 때만.
if (SONIOX_API_KEY || CARTESIA_ADMIN_API_KEY || OPENAI_ADMIN_API_KEY) {
  setTimeout(() => kickVendorRefresh().catch((e) => logErr('vendor-usage-boot', e)), 8000); // 부팅 직후 1회
  setInterval(() => kickVendorRefresh().catch((e) => logErr('vendor-usage-cron', e)), 12 * 3600e3); // 라우트 갱신과 동시 실행 방지(공용 가드)
}
