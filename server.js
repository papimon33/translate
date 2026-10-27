import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import { b32encode, totpVerify } from './server/util/security_util.js';
import { kstDay } from './server/util/pipeline_util.js';
import path from 'path';
import { Readable } from 'node:stream';
import { PORT, OPENAI_API_KEY, REFINE_MODEL, PRESET_SRC, normalizeMode, DESKLOG_CAP, SONIOX_API_KEY, CARTESIA_API_KEY, CARTESIA_VERSION, CARTESIA_MODEL, DESKTOP_REPO, GITHUB_TOKEN, DESKTOP_DOWNLOAD_URL, LANG_NAMES, ALL_LANGS, STATIC_DIR, PRICE_WHISPER_PER_MIN, PRICE_TRANSLATE_PER_MIN, ADMIN_ID, ADMIN_PASSWORD, AUTH_COOKIE, CARTESIA_ADMIN_API_KEY, OPENAI_ADMIN_API_KEY } from './server/config.js';
import { metrics, logErr } from './server/metrics.js';
import { dataKey, sessions, users, usageDaily, usageHourly, vendorUsage, termsConfig, deskRegistry, profiles, col, profilesCol, setSessions, setTermsConfig, setDeskRegistry, loadStore, persistDeskRegistry, dirtySessions, sessionsFlushInflight, saveSessions, flushSessions, deleteSessionStore, saveUsers, flushUsers, deleteUserStore, saveProfiles, deleteProfileStore, costOfDay, flushUsage, persistTermsConfig } from './server/store/index.js';
import { TERM_LANGS, TERM_CATEGORIES, DEFAULT_SERVED_LANGS, sanitizeCatScope, normalizeTermsConfig, initTermsConfig } from './server/store/terms.js';
import { getSession, getSessionAny, newId, migrateSessions, ensureJoinCode, sessionByJoinCode } from './server/store/sessions.js';
import { authBootCheck, isHttps, hashPassword, makeUser, verifyPassword, findUser, authToken, currentUser, requireAuth, requireAdmin, PASSWORD_MIN_LEN, EMAIL_RE, PREF_RULES, publicUser, clearAuthCookie, securityCfg, loadSecurityCfg, saveSecurityCfg, adminTotpSecret, LOGIN_WINDOW_MS, LOGIN_MAX_FAIL, loginFails, loginIp, loginKey, viewerToken, viewerTokenValid, viewerAccessOk } from './server/auth/index.js';
import { forceHttps, securityHeaders, csrfGuard } from './server/auth/middleware.js';
import { buildSonioxContextRaw, validateSonioxPair } from './server/vendors/soniox.js';
import { reasoningEffort } from './server/vendors/openai.js';
import { cartesiaVoiceId, TTS_TEST_PHRASE } from './server/vendors/cartesia.js';
import { vendorStatus, vendorRefreshAt, kickVendorRefresh } from './server/vendors/usage.js';
import { rooms, deskCtrl, broadcast, closeSessionRoom } from './server/realtime/rooms.js';
import { wss, attachRealtime } from './server/realtime/index.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 등 프록시 뒤 — req.ip / x-forwarded-* 신뢰

// FORCE_HTTPS=1: http 접속을 https 로 301 리다이렉트(프록시 뒤에선 x-forwarded-proto 기준).
// Render 등 관리형 호스팅은 자체적으로 https 를 강제하므로 자가 호스팅에서만 필요.
if (process.env.FORCE_HTTPS === '1') app.use(forceHttps); // auth/middleware.js

// 보안 헤더
app.use(securityHeaders);
// CSRF 완화: /api 의 상태변경 요청은 동일 출처만 허용(쿠키 인증 보호)
app.use(csrfGuard);
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
authBootCheck(); // 기본 비밀번호 경고 + 운영 게이트(auth/index.js)

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

loadSecurityCfg(); // 관리자 2FA 시크릿(data/security.json)
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

// WebSocket(/ws/host·/ws/viewer) 업그레이드·하트비트 — realtime/index.js
attachRealtime(server);

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
