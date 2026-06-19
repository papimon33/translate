import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';
import { setGlossary, annotate, glossarySize } from './glossary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 모델은 코드 고정(환경변수로 안 받음). 바꾸려면 여기서 직접 수정.
const TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
const TRANSLATE_MODEL = 'gpt-realtime-translate';
const REFINE_MODEL = 'gpt-5-nano';
const TARGET_LANG = process.env.TARGET_LANG || 'ko';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''; // Nova-3 테스트 모드(선택)

const LANG_NAMES = {
  ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어',
  fr: '프랑스어', de: '독일어', vi: '베트남어', th: '태국어', id: '인도네시아어',
};
const ALL_LANGS = ['ko', 'en', 'ja', 'zh']; // whisper 는 항상 한·영·일·중 전부 번역

if (!OPENAI_API_KEY) {
  console.error('\n[오류] OPENAI_API_KEY 가 설정되지 않았습니다. .env 파일을 만들어 주세요. (.env.example 참고)\n');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 등 프록시 뒤 — req.ip / x-forwarded-* 신뢰

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
    const origin = req.headers.origin;
    if (origin) {
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      let oh = '';
      try { oh = new URL(origin).host; } catch {}
      if (oh && oh !== host) return res.status(403).json({ error: 'cross-origin request blocked' });
    }
  }
  next();
});
app.use(express.json({ limit: '16mb' })); // 용어집 CSV 업로드(수천 행) 대응
// 빌드된 React 앱(dist) 서빙
const STATIC_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(STATIC_DIR)) {
  console.warn('\n[경고] dist 폴더가 없습니다. 먼저 `npm run build` 를 실행하세요. (npm start 는 자동 빌드)\n');
}
app.use(express.static(STATIC_DIR));

const server = http.createServer(app);

/* ================================================================== */
/*  세션 영속화 (data/sessions.json)                                   */
/*  세션: { id, title, createdAt, updatedAt, outLang, items:[          */
/*          { id, side:'left'|'right', text } ] }                      */
/* ================================================================== */
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const GLOSSARY_FILE = path.join(DATA_DIR, 'glossary.json'); // 로컬 폴백(공개 repo에 안 올림)
const SUMMARIES_FILE = path.join(DATA_DIR, 'summaries.json');
const MONGODB_URI = process.env.MONGODB_URI;                       // 있으면 Mongo, 없으면 로컬 파일
const MONGODB_DB = process.env.MONGODB_DB || 'kac_translator';     // DB 이름(앱이 자동 생성). 코드 기본값.

let sessions = [];  // 메모리 캐시(항상 진실의 원천)
let users = [];     // 생성된 사용자 { id, username, salt, hash, role, createdAt, usageMs }
let usageDaily = {}; // { 'YYYY-MM-DD': { whisperMs, translateMs } } — 파이프라인별 사용시간 일별 집계
let glossaryRows = []; // [{ en, ko, meaning }] — 용어집(공개 repo 미커밋, Mongo/파일 저장)
let glossaryUpdatedAt = 0;
let summaries = []; // [{ id, sessionId, owner, title, createdAt, updatedAt, status, summary, error }]
let col = null;     // Mongo sessions 컬렉션. null 이면 파일 모드.
let usersCol = null;
let usageCol = null;
let glossaryCol = null;
let summariesCol = null;

async function loadStore() {
  if (MONGODB_URI) {
    const { MongoClient } = await import('mongodb');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
        await client.connect();
        const db = client.db(MONGODB_DB);
        col = db.collection('sessions');
        usersCol = db.collection('users');
        usageCol = db.collection('usageDaily');
        glossaryCol = db.collection('glossary');
        summariesCol = db.collection('summaries');
        await col.createIndex({ id: 1 }, { unique: true });
        await usersCol.createIndex({ id: 1 }, { unique: true });
        await usageCol.createIndex({ date: 1 }, { unique: true });
        await summariesCol.createIndex({ id: 1 }, { unique: true });
        sessions = await col.find({}, { projection: { _id: 0 } }).toArray();
        users = await usersCol.find({}, { projection: { _id: 0 } }).toArray();
        const rows = await usageCol.find({}, { projection: { _id: 0 } }).toArray();
        usageDaily = {};
        rows.forEach((r) => (usageDaily[r.date] = { whisperMs: r.whisperMs || 0, translateMs: r.translateMs || 0 }));
        glossaryRows = await glossaryCol.find({}, { projection: { _id: 0 } }).toArray();
        summaries = await summariesCol.find({}, { projection: { _id: 0 } }).toArray();
        console.log(`[store] MongoDB 연결됨 — 세션 ${sessions.length} / 사용자 ${users.length} / 용어 ${glossaryRows.length}`);
        return;
      } catch (e) {
        console.error(`[store] MongoDB 연결 실패 (시도 ${attempt}/3): ${e.message}`);
        col = usersCol = usageCol = glossaryCol = summariesCol = null;
        if (attempt < 3) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    // MONGODB_URI 가 설정됐는데도 연결 실패 → 운영에선 파일 모드로 조용히 폴백하면
    // 데이터가 분리/유실되므로 기동을 중단한다(설정 점검 유도).
    if (process.env.NODE_ENV === 'production') {
      console.error('[store] MONGODB_URI 설정됨에도 연결 실패 — 데이터 유실 방지를 위해 종료합니다. (Atlas Network Access/URI 확인)');
      process.exit(1);
    }
    console.error('[store] (개발 모드) 로컬 파일 모드로 폴백');
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      sessions = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!Array.isArray(sessions)) sessions = [];
    }
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (!Array.isArray(users)) users = [];
    }
    if (fs.existsSync(USAGE_FILE)) {
      const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
      if (u && typeof u === 'object') usageDaily = u;
    }
    if (fs.existsSync(GLOSSARY_FILE)) {
      const g = JSON.parse(fs.readFileSync(GLOSSARY_FILE, 'utf8'));
      if (Array.isArray(g)) glossaryRows = g;
    }
    if (fs.existsSync(SUMMARIES_FILE)) {
      const s = JSON.parse(fs.readFileSync(SUMMARIES_FILE, 'utf8'));
      if (Array.isArray(s)) summaries = s;
    }
  } catch (e) {
    console.error('[store] 로드 실패', e);
  }
}

let saveTimer = null;
function saveSessions() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSessions().catch((e) => console.error('[sessions] 저장 실패', e));
  }, 400);
}
async function flushSessions() {
  if (col) {
    if (!sessions.length) return;
    const ops = sessions.map((s) => ({
      replaceOne: { filter: { id: s.id }, replacement: s, upsert: true },
    }));
    await col.bulkWrite(ops, { ordered: false });
  } else {
    fs.writeFileSync(DATA_FILE, JSON.stringify(sessions, null, 2));
  }
}
// 삭제는 flush(=upsert)로 반영되지 않으므로 별도 처리(Mongo 모드 한정).
async function deleteSessionStore(id) {
  if (col) {
    try {
      await col.deleteOne({ id });
    } catch (e) {
      console.error('[sessions] 삭제 실패', e);
    }
  } else {
    saveSessions(); // 파일 모드: 메모리에서 이미 splice 됨 → 전체 재기록
  }
}

let userSaveTimer = null;
function saveUsers() {
  if (userSaveTimer) return;
  userSaveTimer = setTimeout(() => {
    userSaveTimer = null;
    flushUsers().catch((e) => console.error('[users] 저장 실패', e));
  }, 400);
}
async function flushUsers() {
  if (usersCol) {
    if (!users.length) return;
    const ops = users.map((u) => ({
      replaceOne: { filter: { id: u.id }, replacement: u, upsert: true },
    }));
    await usersCol.bulkWrite(ops, { ordered: false });
  } else {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  }
}
async function deleteUserStore(id) {
  if (usersCol) {
    try {
      await usersCol.deleteOne({ id });
    } catch (e) {
      console.error('[users] 삭제 실패', e);
    }
  } else {
    saveUsers();
  }
}

/* ---- 사용량(일별) 집계 + 비용 ----
   비용은 파이프라인별 '오디오 분당 요금' × 호스트 WS 연결 시간으로 계산. */
const PRICE_WHISPER_PER_MIN = Number(process.env.PRICE_WHISPER_PER_MIN || 0.017);
const PRICE_TRANSLATE_PER_MIN = Number(process.env.PRICE_TRANSLATE_PER_MIN || 0.034);
function costOfDay(d) {
  return ((d.whisperMs || 0) / 60000) * PRICE_WHISPER_PER_MIN + ((d.translateMs || 0) / 60000) * PRICE_TRANSLATE_PER_MIN;
}
function dateKey() {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}
function recordUsage(pipeline, ms) {
  if (!ms || ms < 0) return;
  const k = dateKey();
  const d = usageDaily[k] || (usageDaily[k] = { whisperMs: 0, translateMs: 0 });
  if (pipeline === 'translate') d.translateMs += ms;
  else d.whisperMs += ms;
  saveUsage();
}
let usageSaveTimer = null;
function saveUsage() {
  if (usageSaveTimer) return;
  usageSaveTimer = setTimeout(() => {
    usageSaveTimer = null;
    flushUsage().catch((e) => console.error('[usage] 저장 실패', e));
  }, 1000);
}
async function flushUsage() {
  if (usageCol) {
    const ops = Object.entries(usageDaily).map(([date, v]) => ({
      replaceOne: { filter: { date }, replacement: { date, whisperMs: v.whisperMs || 0, translateMs: v.translateMs || 0 }, upsert: true },
    }));
    if (ops.length) await usageCol.bulkWrite(ops, { ordered: false });
  } else {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usageDaily, null, 2));
  }
}

await loadStore();
setGlossary(glossaryRows); // 부팅 시 자동자 구성
if (glossaryRows.length) console.log(`[glossary] 용어 ${glossaryRows.length}행 → 패턴 ${glossarySize()}개`);

/* ---- AI 요약 저장 ---- */
let summarySaveTimer = null;
function saveSummaries() {
  if (summarySaveTimer) return;
  summarySaveTimer = setTimeout(() => {
    summarySaveTimer = null;
    flushSummaries().catch((e) => console.error('[summary] 저장 실패', e));
  }, 300);
}
async function flushSummaries() {
  if (summariesCol) {
    if (!summaries.length) return;
    const ops = summaries.map((s) => ({ replaceOne: { filter: { id: s.id }, replacement: s, upsert: true } }));
    await summariesCol.bulkWrite(ops, { ordered: false });
  } else {
    fs.writeFileSync(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
  }
}
async function deleteSummaryStore(id) {
  if (summariesCol) {
    try { await summariesCol.deleteOne({ id }); } catch (e) { console.error('[summary] 삭제 실패', e); }
  } else {
    saveSummaries();
  }
}
// 서버 재시작으로 중단된 '요약중'은 실패로 표시(무한 스피너 방지, 재시도 가능)
{
  let changed = false;
  for (const s of summaries) {
    if (s.status === 'pending') { s.status = 'error'; s.error = '서버 재시작으로 중단되었습니다. 다시 시도해 주세요.'; s.updatedAt = Date.now(); changed = true; }
  }
  if (changed) saveSummaries();
}

/* ---- 용어집 저장 + CSV 파싱 ---- */
async function persistGlossary() {
  if (glossaryCol) {
    await glossaryCol.deleteMany({});
    if (glossaryRows.length) await glossaryCol.insertMany(glossaryRows.map((r) => ({ ...r })));
  } else {
    fs.writeFileSync(GLOSSARY_FILE, JSON.stringify(glossaryRows, null, 2));
  }
}
// CSV/TSV 파싱 (RFC4180 따옴표 처리, 구분자 자동 감지). 컬럼: 영문, 한글, 해설.
function parseGlossaryCsv(text) {
  let s = String(text || '').replace(/^﻿/, ''); // BOM 제거
  // 구분자: 첫 줄에 탭이 있으면 TSV, 아니면 콤마
  const firstLine = s.slice(0, s.indexOf('\n') < 0 ? s.length : s.indexOf('\n'));
  const delim = firstLine.includes('\t') ? '\t' : ',';
  const rows = [];
  let field = '';
  let record = [];
  let inQuotes = false;
  const pushField = () => {
    record.push(field);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (record.some((c) => c.trim() !== '')) rows.push(record);
    record = [];
  };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      pushField();
    } else if (ch === '\n') {
      pushRecord();
    } else if (ch === '\r') {
      // skip (CRLF)
    } else field += ch;
  }
  if (field !== '' || record.length) pushRecord();
  if (!rows.length) return [];
  // 헤더 감지: 첫 행이 '영문'/'한글'/'해설' 류면 건너뜀
  const head = rows[0].map((c) => c.trim());
  const looksHeader = /영문|english|term/i.test(head[0] || '') || /한글|korean/i.test(head[1] || '');
  const body = looksHeader ? rows.slice(1) : rows;
  return body
    .map((r) => ({ en: (r[0] || '').trim(), ko: (r[1] || '').trim(), meaning: (r[2] || '').trim() }))
    .filter((r) => r.en || r.ko);
}

function getSession(id) {
  return sessions.find((s) => s.id === id);
}
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// 소유자 없는 (구) 세션 정리 — 멀티유저 전환 시 1회.
{
  const legacy = sessions.filter((s) => !s.owner);
  if (legacy.length) {
    sessions = sessions.filter((s) => s.owner);
    legacy.forEach((s) => deleteSessionStore(s.id));
    if (!col) saveSessions();
    console.log(`[store] 소유자 없는 구 세션 ${legacy.length}개 삭제`);
  }
}

/* ================================================================== */
/*  인증 (사용자 계정 + 관리자) — 호스트(데스크톱)만 보호               */
/*  관리자: 환경변수 ADMIN_ID/ADMIN_PASSWORD. 일반 사용자: 관리자가 생성.*/
/*  모바일 뷰어는 항상 공개: /ws/viewer, GET /api/sessions/:id, /api/qr  */
/* ================================================================== */
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const AUTH_SECRET =
  process.env.AUTH_SECRET || crypto.createHash('sha256').update('kac::' + ADMIN_PASSWORD).digest('hex');
const AUTH_COOKIE = 'kac_auth';
if (!process.env.ADMIN_PASSWORD)
  console.warn('[auth] ADMIN_PASSWORD 미설정 — 기본값 "admin" 사용 중. 운영 전 반드시 설정하세요.');
if (process.env.NODE_ENV === 'production' && !process.env.AUTH_SECRET)
  console.warn('[auth] (운영) AUTH_SECRET 미설정 — ADMIN_PASSWORD 에서 파생됩니다. 비번 변경 시 전원 로그아웃되니 AUTH_SECRET 고정 권장.');

function getCookie(req, name) {
  const h = req.headers.cookie || '';
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
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
function authToken(id) {
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(id).digest('hex');
  return `${encodeURIComponent(id)}.${sig}`;
}
function userFromToken(tok) {
  if (!tok) return null;
  const i = tok.lastIndexOf('.');
  if (i < 0) return null;
  const id = decodeURIComponent(tok.slice(0, i));
  const sig = tok.slice(i + 1);
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(id).digest('hex');
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
function addUsage(userId, ms) {
  if (!userId || !ms || ms < 0) return;
  const u = users.find((x) => x.id === userId); // 관리자는 가상 사용자라 집계 대상 아님
  if (!u) return;
  u.usageMs = (u.usageMs || 0) + ms;
  saveUsers();
}

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({ user: u ? { id: u.id, username: u.username, role: u.role } : null });
});
// 본인 정보 변경: ID 불가, 사용자명·비밀번호 변경(비번은 password/passwordConfirm 일치 확인).
app.patch('/api/me', requireAuth, (req, res) => {
  if (req.user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 환경변수로 관리됩니다.' });
  const stored = users.find((x) => x.id === req.user.id);
  if (!stored) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  if (typeof b.username === 'string' && b.username.trim()) stored.username = b.username.trim();
  if (b.password) {
    if (b.password !== b.passwordConfirm) return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
    stored.salt = crypto.randomBytes(16).toString('hex');
    stored.hash = hashPassword(b.password, stored.salt);
  }
  saveUsers();
  res.json({ user: { id: stored.id, username: stored.username, role: stored.role } });
});
// 로그인 무차별 대입 방어: IP당 15분 내 8회 실패 시 15분 잠금
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAIL = 8;
const loginFails = new Map(); // ip -> { count, first, lockUntil }
function loginKey(req) {
  return String(req.ip || (req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || 'ip').trim();
}
app.post('/api/login', (req, res) => {
  const key = loginKey(req);
  const now = Date.now();
  let rec = loginFails.get(key);
  if (rec && rec.lockUntil && now < rec.lockUntil) {
    const sec = Math.ceil((rec.lockUntil - now) / 1000);
    return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${sec}초 후 다시 시도하세요.` });
  }
  if (rec && now - rec.first > LOGIN_WINDOW_MS) rec = null; // 윈도우 경과 → 초기화

  const b = req.body || {};
  const id = String(b.id || '').trim();
  const password = String(b.password || '');
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
  loginFails.delete(key); // 성공 시 초기화
  console.log(`[auth] 로그인 성공 id=${user.id} role=${user.role} ip=${key}`);
  const secure = isHttps(req) ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken(user.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
  res.json({ user: { id: user.id, username: user.username, role: user.role } });
});
app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
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
  u.salt = crypto.randomBytes(16).toString('hex');
  u.hash = hashPassword(pw, u.salt);
  saveUsers();
  console.log(`[admin] 비밀번호 재설정 user=${u.id}`);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const i = users.findIndex((u) => u.id === id);
  if (i >= 0) {
    users.splice(i, 1);
    deleteUserStore(id);
  }
  const owned = sessions.filter((s) => s.owner === id).map((s) => s.id);
  if (owned.length) {
    sessions = sessions.filter((s) => s.owner !== id);
    owned.forEach((sid) => deleteSessionStore(sid));
    if (!col) saveSessions();
  }
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
  res.json({
    daily,
    totalMinutes: daily.reduce((a, d) => a + d.minutes, 0),
    totalCost: daily.reduce((a, d) => a + d.cost, 0),
    rateWhisper: PRICE_WHISPER_PER_MIN,
    rateTranslate: PRICE_TRANSLATE_PER_MIN,
  });
});

// 용어집: 현황 조회 + CSV 업로드(교체)
app.get('/api/admin/glossary', requireAdmin, (req, res) => {
  res.json({ count: glossaryRows.length, patterns: glossarySize(), updatedAt: glossaryUpdatedAt });
});
app.post('/api/admin/glossary', requireAdmin, async (req, res) => {
  const csv = (req.body && req.body.csv) || '';
  if (!csv) return res.status(400).json({ error: 'CSV 내용이 비어 있습니다.' });
  let rows;
  try {
    rows = parseGlossaryCsv(csv);
  } catch (e) {
    return res.status(400).json({ error: 'CSV 파싱 실패: ' + e.message });
  }
  if (!rows.length) return res.status(400).json({ error: '유효한 용어 행이 없습니다. (컬럼: 영문, 한글, 해설)' });
  glossaryRows = rows;
  glossaryUpdatedAt = Date.now();
  setGlossary(glossaryRows);
  try {
    await persistGlossary();
  } catch (e) {
    console.error('[glossary] 저장 실패', e);
  }
  res.json({ count: glossaryRows.length, patterns: glossarySize(), updatedAt: glossaryUpdatedAt });
});
// 용어집 열람(로그인 사용자 누구나). 한글 기준 정렬.
app.get('/api/glossary', requireAuth, (req, res) => {
  const list = glossaryRows
    .map((r) => ({ ko: r.ko || '', en: r.en || '', meaning: r.meaning || '' }))
    .sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
  res.json(list);
});

/* ================================================================== */
/*  AI 요약 (gpt-5-nano) — 세션 전문을 체계적으로 요약                   */
/* ================================================================== */
const SUMMARY_MODEL = 'gpt-5-nano';
const SUMMARY_SYS =
  `너는 회의·대화 기록 요약 전문가다. 주어진 전사/번역 전문을 바탕으로 한국어로 체계적이고 자세한 요약을 작성한다.\n` +
  `규칙:\n` +
  `- 요약 본문만 출력한다. "다음은 요약입니다" 같은 머리말·맺음말·메타발언을 절대 넣지 않는다.\n` +
  `- 소제목(## )과 불릿(- )으로 체계적으로 정리한다. 핵심 주제, 주요 논의·결정사항, 수치·일정·담당자 등 구체 정보, (있다면) 후속 조치를 빠짐없이 담는다.\n` +
  `- 전문에 없는 내용을 지어내지 않는다. 불확실한 건 추정하지 않는다.\n` +
  `- 자세하되 군더더기 없이 정보 밀도 높게 작성한다.`;
const SUMMARY_MAX_INPUT = 16000; // 단일 호출 입력 문자 한도
const SUMMARY_CHUNK = 12000;

async function chatComplete(system, user, maxTokens) {
  const body = {
    model: SUMMARY_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_completion_tokens: maxTokens,
  };
  if (/^gpt-5/.test(SUMMARY_MODEL)) body.reasoning_effort = 'low';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 160));
  const data = await r.json();
  const txt = data?.choices?.[0]?.message?.content?.trim();
  if (!txt) throw new Error('빈 응답');
  return txt;
}
function sessionTranscript(session) {
  const lines = [];
  for (const it of session.items || []) {
    let t = it.texts ? it.texts.ko || Object.values(it.texts)[0] || '' : it.text || '';
    t = (t || '').trim();
    if (t) lines.push(t);
  }
  return lines.join('\n');
}
async function summarizeTranscript(transcript) {
  const text = transcript.trim();
  if (text.length <= SUMMARY_MAX_INPUT) {
    return await chatComplete(SUMMARY_SYS, `다음 전문을 요약하라:\n\n${text}`, 2000);
  }
  // 길면 청크별 핵심 노트 → 통합 요약(map-reduce)
  const chunks = [];
  let cur = '';
  for (const ln of text.split('\n')) {
    if ((cur + '\n' + ln).length > SUMMARY_CHUNK && cur) { chunks.push(cur); cur = ln; }
    else cur = cur ? cur + '\n' + ln : ln;
  }
  if (cur) chunks.push(cur);
  const notesSys = '다음 회의 전문 일부에서 핵심 정보(주제, 논의·결정, 수치·일정·담당, 후속조치)를 불릿으로 빠짐없이 정리하라. 머리말 없이 불릿만 출력.';
  const notes = [];
  for (let i = 0; i < chunks.length; i++) {
    notes.push(await chatComplete(notesSys, `(${i + 1}/${chunks.length})\n\n${chunks[i]}`, 1200));
  }
  let combined = notes.join('\n');
  if (combined.length > SUMMARY_MAX_INPUT) combined = combined.slice(0, SUMMARY_MAX_INPUT);
  return await chatComplete(SUMMARY_SYS, `다음은 회의 각 구간의 핵심 노트다. 이를 종합해 전체 요약을 작성하라:\n\n${combined}`, 2500);
}
async function runSummary(rec, transcript) {
  try {
    const summary = await summarizeTranscript(transcript);
    rec.status = 'done';
    rec.summary = summary;
    rec.error = '';
  } catch (e) {
    rec.status = 'error';
    rec.error = e && e.message ? String(e.message).slice(0, 300) : '요약 실패';
    console.error('[summary] 실패', e);
  }
  rec.updatedAt = Date.now();
  saveSummaries();
}
function pubSummary(s, withBody) {
  const o = { id: s.id, sessionId: s.sessionId, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, status: s.status, error: s.error || '' };
  if (withBody) o.summary = s.summary || '';
  return o;
}

app.get('/api/summaries', requireAuth, (req, res) => {
  const list = summaries
    .filter((s) => s.owner === req.user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((s) => pubSummary(s, false));
  res.json(list);
});
app.get('/api/summaries/:id', requireAuth, (req, res) => {
  const s = summaries.find((x) => x.id === req.params.id);
  if (!s || s.owner !== req.user.id) return res.status(404).json({ error: 'not found' });
  res.json(pubSummary(s, true));
});
app.post('/api/summaries', requireAuth, (req, res) => {
  const sessionId = String((req.body && req.body.sessionId) || '');
  const session = getSession(sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (session.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const transcript = sessionTranscript(session);
  const now = Date.now();
  // 세션당 1개 — 기존 레코드 재사용(재생성/재시도 시 덮어쓰기)
  let rec = summaries.find((s) => s.sessionId === sessionId && s.owner === req.user.id);
  if (!rec) { rec = { id: newId(), sessionId, owner: req.user.id, createdAt: now }; summaries.push(rec); }
  rec.title = session.title || '(제목 없음)';
  rec.updatedAt = now;
  rec.summary = '';
  rec.error = '';
  if (transcript.trim().length < 10) {
    rec.status = 'error';
    rec.error = '요약할 내용이 부족합니다.';
    saveSummaries();
    return res.json(pubSummary(rec, false));
  }
  rec.status = 'pending';
  saveSummaries();
  runSummary(rec, transcript); // 비동기 백그라운드 처리(화면 이탈해도 진행)
  res.json(pubSummary(rec, false));
});
app.delete('/api/summaries/:id', requireAuth, (req, res) => {
  const i = summaries.findIndex((s) => s.id === req.params.id);
  if (i >= 0) {
    if (summaries[i].owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const id = summaries[i].id;
    summaries.splice(i, 1);
    deleteSummaryStore(id);
  }
  res.json({ ok: true });
});

/* ---- 세션 REST API ---- */
app.get('/api/sessions', requireAuth, (req, res) => {
  const list = sessions
    .filter((s) => s.owner === req.user.id) // 사용자마다 자기 세션만
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length, pipeline: s.pipeline || 'whisper' }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  const pipeline = ['translate', 'deepgram'].includes(b.pipeline) ? b.pipeline : 'whisper';
  // whisper 는 항상 한·영·일·중 전부 번역. translate 는 단일 출력 언어.
  const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
  const langs = pipeline === 'translate' ? [outLang] : ALL_LANGS.slice(); // whisper·deepgram 은 다국어
  const s = {
    id: newId(),
    owner: req.user.id, // 소유자
    title: b.title || '새 세션',
    createdAt: now,
    updatedAt: now,
    pipeline, // 생성 후 변경 불가
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
  res.json(s);
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  // pipeline 은 생성 시 고정. title·inLang 수정 허용. outLang 은 translate 의 타깃 변경용.
  const b = req.body || {};
  if (typeof b.title === 'string') s.title = b.title;
  if (typeof b.inLang === 'string') s.inLang = b.inLang;
  if (typeof b.outLang === 'string' && LANG_NAMES[b.outLang]) {
    s.outLang = b.outLang;
    if (s.pipeline === 'translate') s.langs = [b.outLang]; // translate 출력 언어 변경
  }
  s.updatedAt = Date.now();
  saveSessions();
  res.json(s);
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const i = sessions.findIndex((s) => s.id === req.params.id);
  if (i >= 0) {
    if (sessions[i].owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    sessions.splice(i, 1);
    deleteSessionStore(req.params.id);
  }
  rooms.delete(req.params.id);
  res.json({ ok: true });
});

/* ================================================================== */
/*  실시간 방(room) : 세션ID 기준. 호스트(여러 소스) + 뷰어 N           */
/* ================================================================== */
const rooms = new Map(); // sessionId -> { viewers:Set<ws> }
function getRoom(sessionId) {
  if (!rooms.has(sessionId)) rooms.set(sessionId, { viewers: new Set() });
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
function broadcastAudio(sessionId, b64) {
  const room = rooms.get(sessionId);
  if (!room) return;
  let msg = null;
  for (const v of room.viewers) {
    if (v._audioWanted && v.readyState === WebSocket.OPEN) {
      if (!msg) msg = JSON.stringify({ type: 'audio', b64 });
      v.send(msg);
    }
  }
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

/* ---- QR (세션별 모바일 URL) ---- */
app.get('/api/qr', async (req, res) => {
  const sessionId = String(req.query.session || '');
  if (!sessionId) return res.status(400).json({ error: 'session required' });
  // 배포 환경: 요청 host/proto 사용(Render 등은 x-forwarded-* 로 전달).
  let proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  // 로컬 접속(localhost)이면 같은 와이파이 모바일이 닿도록 LAN IP 로 대체.
  if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host)) {
    host = `${getLanIp()}:${PORT}`;
    proto = 'http';
  }
  const url = `${proto}://${host}/mobile.html?session=${encodeURIComponent(sessionId)}`;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ url, qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: String(e) });
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
/*  번역 출력 정화: 소형 모델이 끼워넣는 군더더기 제거                    */
/*   - 머리말("…다음과 같습니다"), 불릿(-), 화살표(원문 → 번역),         */
/*     "참고:/제안:/주의:/Note:" 줄, 끝의 메타 괄호주석 등.              */
/* ------------------------------------------------------------------ */
function sanitizeTranslation(out) {
  let s = String(out || '').trim();
  if (!s) return '';
  // 코드블록 제거
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
  // 문두 머리말 제거: "…(옮기면/번역하면) 다음과 같습니다:" 류 접두를 통째로 잘라냄
  s = s.replace(/^[^\n]*?다음과\s*같습니다\s*[:：.]?\s*/, '');
  // 화살표(원문 → 번역) 형식이면 화살표 뒤(번역)만 취함
  if (/→|->/.test(s)) {
    s = s
      .split(/\n+/)
      .map((ln) => {
        const parts = ln.split(/\s*(?:→|->)\s*/);
        return parts.length > 1 ? parts[parts.length - 1] : ln;
      })
      .join('\n');
  }
  const DROP = /^\s*(?:참고|제안|주의|노트|note)\s*[:：]/i; // 줄 전체가 메타면 버림
  const META_TAIL = /\s*[\(（]?\s*(?:참고|제안|주의|노트|note)\s*[:：].*$/i; // 줄 중간부터 시작하는 메타(괄호 포함) 꼬리 제거
  const lines = s
    .split(/\n+/)
    .map((ln) => ln.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()) // 불릿/번호 제거
    .map((ln) => (DROP.test(ln) ? '' : ln.replace(META_TAIL, '').trim()))
    .filter(Boolean);
  s = lines.join('\n').trim();
  // 끝에 붙는 메타 괄호주석(번역/의역/정중체 등 키워드 포함)만 제거
  s = s.replace(/\s*[\(（][^)）]*(번역|의역|정중체|매끄럽|자연스럽|문장\s*단위|note|참고)[^)）]*[\)）]\s*$/i, '').trim();
  return s;
}

/* ------------------------------------------------------------------ */
/*  전사된 원문 -> 목표 언어로 번역(+다듬기) : gpt-5-mini                */
/* ------------------------------------------------------------------ */
async function translateText(text, targetLang, polish, context) {
  const langName = LANG_NAMES[targetLang] || targetLang;
  try {
    const sys = polish
      ? `너는 전문 동시통역사다. 실시간 음성에서 받아쓴 텍스트(말하는 도중 끊긴 단편일 수 있음)를 ${langName}로 옮긴다. 딱딱한 직역투를 피하고, 의미가 매끄럽게 전달되도록 적당히 의역하여 부드럽고 자연스러운 구어체로 다듬는다.
규칙:
- 여러 문장이 함께 들어오면 각 문장을 그대로 문장 단위로 옮기고, 서로 억지로 합치지 않는다.
- 문체는 부드럽고 자연스러운 정중체로 통일한다(딱딱하지 않은 정중한 어투, 반말은 섞지 않는다). 직역해서 어색한 표현은 한국어다운 표현으로 바꾼다(자연스러움 우선, 의미는 정확히 유지).
- 고유명사·지명·상품명·음식명은 발음을 살려 표기하고 억지로 의역하지 않는다 (예: 初島→하츠시마, ところてん/所天→도코로텐, 天草→텐구사).
- "(혹은 …)", "(서쪽?)" 같은 추측성 괄호나 부연을 절대 넣지 않는다. 불확실해도 가장 자연스러운 하나로만 옮긴다.
- 앞 맥락(이전 대화)이 주어지면 그 흐름에 자연스럽게 이어 옮긴다.
- 출력은 오직 ${langName} 번역문 한 덩어리뿐이다. 입력이 짧거나 애매해도 절대 해설/분석/제안을 하지 마라.
- 금지: "…다음과 같습니다", "번역하면", "참고:", "제안:", "Note:" 같은 머리말·맺음말; 불릿(-)·번호·화살표(→); 원문 다시 쓰기(원문 병기); 괄호 안 설명. 번역문만 그대로 출력한다.
- 이미 ${langName}면 자연스럽게 교정만 한다.`
      : `너는 번역기다. 입력을 ${langName}로 정확히 옮긴다. 고유명사는 발음을 살린다. 출력은 ${langName} 번역문만. 머리말·해설·불릿·화살표·괄호설명·원문 병기 금지. 이미 ${langName}면 그대로 출력한다.`;
    const messages = [{ role: 'system', content: sys }];
    // 이전 맥락을 few-shot 으로 제공해 연속성/용어 일관성 확보
    if (context && context.length) {
      for (const p of context) {
        messages.push({ role: 'user', content: p.src });
        messages.push({ role: 'assistant', content: p.tr });
      }
    }
    messages.push({ role: 'user', content: text });
    const body = { model: REFINE_MODEL, messages, max_completion_tokens: 500 };
    if (/^gpt-5/.test(REFINE_MODEL)) body.reasoning_effort = 'minimal';

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[translate] HTTP', r.status, await r.text());
      return text;
    }
    const data = await r.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';
    const clean = sanitizeTranslation(raw);
    return clean || text; // 정화 후 비면 원문으로 폴백(빈 카드 방지)
  } catch (e) {
    console.error('[translate] error', e);
    return text;
  }
}

/* translate 파이프라인 다듬기: 단어·표현·어순·문장부호는 그대로 두고 띄어쓰기만 교정 */
async function spacingPolish(text) {
  try {
    const sys =
      '입력 문장의 단어·표현·어순·문장부호·내용은 절대 바꾸지 마라. 오직 띄어쓰기(공백)만 자연스럽게 교정해서 그대로 출력한다. 의역·교체·추가·삭제 금지. 설명 없이 교정된 문장만 출력.';
    const body = {
      model: REFINE_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 400,
    };
    if (/^gpt-5/.test(REFINE_MODEL)) body.reasoning_effort = 'minimal';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return text;
    const data = await r.json();
    return data?.choices?.[0]?.message?.content?.trim() || text;
  } catch {
    return text;
  }
}

/* 누적된 원문에서 "완결된 문장만" 번역하고, 끝의 미완성 부분은 remainder 로 돌려준다.
   whisper 가 마침표를 안 찍어도 GPT 가 문법으로 경계를 판단한다. */
async function segmentTranslate(text, context, force, targetLang, polish) {
  const langName = LANG_NAMES[targetLang] || targetLang;
  const ctxLine =
    context && context.length
      ? '\n참고(직전 번역, 말투 맞추기용): ' + context.map((p) => p.tr).join(' ')
      : '';
  const sys =
    `너는 실시간 음성 통역사다. 입력은 음성 인식으로 받아쓴 것이라 문장부호가 빠져 있거나 문장 중간에서 끝날 수 있다.\n` +
    `할 일:\n` +
    `- 입력에서 의미가 완결된 문장들만 골라 ${langName}로 옮긴다. 딱딱한 직역투를 피하고, 원문에 얽매이기보다 의미가 매끄럽게 전달되도록 적당히 의역하여 부드럽고 자연스러운 구어체로 다듬는다.\n` +
    (force
      ? `- 입력 전체를 번역한다(끝이 미완성이라도). remainder 는 빈 문자열.\n`
      : `- translation 에는 주어와 서술어를 갖춘 '완결된 문장'만 넣는다.\n` +
        `- 끝이 문장 도중에서 끊겼거나, 동사가 없는 도입부 조각(예: 전치사구만 있음)뿐이면 번역하지 말고 원문 그대로 remainder 에 남긴다.\n` +
        `- 완결 문장이 하나도 없으면 translation 은 빈 문자열, remainder 에 입력 전체.\n`) +
    `- remainder 에는 입력의 '맨 뒤 미완성 부분(꼬리)'만 원문 그대로 담는다. 이미 번역한 앞부분은 절대 remainder 에 넣지 않는다. 입력 전체를 remainder 로 주지 마라.\n` +
    `- 입력의 어떤 내용도 버리지 마라(번역에 넣거나 remainder 에 넣거나 둘 중 하나).\n` +
    `- 음성 인식 특성상 같은 단어/구가 연달아 중복될 수 있다(예: "we We", "they They", "between In my best"). 중복은 한 번만 반영한다.\n` +
    `- 여러 문장이면 각 문장을 그대로 유지하고 서로 합치지 않는다.\n` +
    `- 문체는 부드럽고 자연스러운 정중체로 통일한다(기본 '~합니다/~예요'처럼 딱딱하지 않은 정중한 어투, 반말은 섞지 않는다).\n` +
    `- 직역해서 어색한 표현은 한국어다운 자연스러운 표현으로 바꾼다(자연스러움 우선, 단 의미는 정확히 유지).\n` +
    `- 학년은 한국식으로 자연스럽게 옮긴다(예: seventh grade → 7학년).\n` +
    `- 고유명사·지명은 발음을 살리고, 추측성 괄호·부연은 넣지 않는다.${ctxLine}\n` +
    `출력은 JSON 한 개: {"translation": "...", "remainder": "..."}`;
  try {
    const body = {
      model: REFINE_MODEL,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 600,
      response_format: { type: 'json_object' },
    };
    if (/^gpt-5/.test(REFINE_MODEL)) body.reasoning_effort = 'minimal';
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[segment] HTTP', r.status, await r.text());
      return { translation: await translateText(text, targetLang, polish, context), remainder: '' };
    }
    const data = await r.json();
    const obj = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    return { translation: (obj.translation || '').trim(), remainder: (obj.remainder || '').trim() };
  } catch (e) {
    console.error('[segment] error', e);
    return { translation: await translateText(text, targetLang, polish, context), remainder: '' };
  }
}

/* 약어(Dr. Mr. U.S. e.g. 등)·소수(3.5)·머리글자(J.)를 문장 끝으로 오인하지 않는 문장 분리기 */
const ABBR = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'st', 'sr', 'jr', 'vs', 'etc', 'e.g', 'i.e',
  'a.m', 'p.m', 'u.s', 'u.k', 'mt', 'no', 'vol', 'fig', 'inc', 'ltd', 'co', 'corp',
  'dept', 'gen', 'sen', 'rep', 'gov', 'lt', 'col', 'sgt', 'capt', 'cmdr', 'rev', 'hon', 'ph.d',
]);
const CLOSERS = '\'"”’」』)]';
function splitSentences(buf) {
  const sentences = [];
  let start = 0;
  const pushFrom = (i) => {
    let j = i + 1;
    while (j < buf.length && (CLOSERS.includes(buf[j]) || buf[j] === ' ')) j++;
    const s = buf.slice(start, j).trim();
    if (s) sentences.push(s);
    start = j;
    return j - 1;
  };
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    if (ch === '\n' || '!?。！？…'.includes(ch)) {
      i = pushFrom(i);
    } else if (ch === '.') {
      const prev = buf[i - 1] || '';
      const next = buf[i + 1] || '';
      if (next === '.') continue; // 생략부호/연속점
      if (/\d/.test(prev) && /\d/.test(next)) continue; // 소수 3.5
      const before2 = buf[i - 2];
      if (/[A-Za-z0-9]/.test(prev) && (before2 === undefined || /\s/.test(before2))) continue; // 머리글자/번호 "J." "1."
      const wm = buf.slice(start, i).match(/([A-Za-z][A-Za-z.]*)$/);
      const lastWord = wm ? wm[1].toLowerCase().replace(/\.+$/, '') : '';
      if (ABBR.has(lastWord)) continue; // 약어
      i = pushFrom(i);
    }
  }
  return { sentences, rest: buf.slice(start) };
}

/* ------------------------------------------------------------------ */
/*  WebSocket 라우팅                                                     */
/*   /ws/host?session=ID&src=mic|system&out=ko                          */
/*   /ws/viewer?session=ID                                              */
/* ------------------------------------------------------------------ */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname, searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const hostUser = pathname === '/ws/host' ? currentUser(req) : null;
  if (pathname === '/ws/host' && !hostUser) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  if (pathname === '/ws/host' || pathname === '/ws/viewer') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._kind = pathname === '/ws/host' ? 'host' : 'viewer';
      ws._userId = hostUser ? hostUser.id : null;
      ws._session = searchParams.get('session') || 'default';
      ws._src = searchParams.get('src') || 'mic'; // mic | system
      ws._out = searchParams.get('out') || TARGET_LANG;
      ws._in = searchParams.get('in'); // 입력 언어 코드 | 'auto' | null
      ws._refine = searchParams.get('refine'); // '0' | '1' | null
      ws._pipeline = searchParams.get('pipeline'); // 'whisper' | 'translate' | null
      ws._audioOut = searchParams.get('audioOut') === '1'; // translate 번역 음성 재생 여부
      ws._endpointing = searchParams.get('endpointing'); // deepgram 문장종료 무음(ms) — 테스트용
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

wss.on('connection', (ws) => {
  if (ws._kind === 'viewer') return handleViewer(ws);
  return handleHost(ws);
});

/* ----------------------------- 뷰어 ------------------------------- */
function handleViewer(ws) {
  const room = getRoom(ws._session);
  room.viewers.add(ws);
  ws._audioWanted = false; // '음성 듣기' 구독 여부
  const s = getSession(ws._session);
  ws.send(JSON.stringify({ type: 'snapshot', items: s ? s.items : [] }));
  ws.on('message', (data) => {
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'audioSub') ws._audioWanted = !!m.on;
    } catch {}
  });
  ws.on('close', () => room.viewers.delete(ws));
}

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
function handleHost(ws) {
  const sessionId = ws._session;
  const side = ws._src === 'system' ? 'left' : 'right'; // 시스템=좌, 마이크=우
  const session = getSession(sessionId);
  // 사용량 집계: 호스트 WS 연결 시간 → 사용자별 누적 + 파이프라인별 일별 비용.
  const usageStart = Date.now();
  ws.on('close', () => {
    const ms = Date.now() - usageStart;
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
  const polish = true; // 다듬기 필수
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
  const buildMsg = (id, item) => ({ type: 'sentence', id, side, source: item.source || null, texts: item.texts, terms: item.terms || {} });
  // 완성 문장의 텍스트에서 용어집 매칭 구간 계산 (translate 파이프라인 + 한글만)
  const computeTerms = (item) => {
    const terms = {};
    if (pipeline === 'translate') {
      for (const [lang, txt] of Object.entries(item.texts || {})) {
        const spans = annotate(txt);
        if (spans.length) terms[lang] = spans;
      }
    }
    item.terms = terms;
  };
  // 화면에만 보냄(저장 안 함) — translate 스트리밍/whisper 진행표시용
  const liveSend = (id, langTexts, source) => {
    toHost({ type: 'sentence', id, side, source: source || null, texts: langTexts });
    broadcast(sessionId, { type: 'sentence', id, side, source: source || null, texts: langTexts });
  };
  // 확정: 세션 저장 + 전송. 언어별로 병합.
  const upsertItem = (id, langTexts, source) => {
    let item;
    if (session) {
      item = session.items.find((x) => x.id === id);
      if (item) {
        item.texts = { ...(item.texts || {}), ...langTexts };
        if (source) item.source = source;
      } else {
        item = { id, side, source: source || null, texts: { ...langTexts } };
        session.items.push(item);
      }
      if (session.title === '새 세션' && session.items.length === 1) {
        const first = Object.values(item.texts)[0] || '';
        if (first) session.title = first.slice(0, 40);
      }
      computeTerms(item);
      session.updatedAt = Date.now();
      saveSessions();
    } else {
      item = { id, side, source: source || null, texts: { ...langTexts } };
      computeTerms(item);
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  if (pipeline === 'translate') runTranslate();
  else if (pipeline === 'deepgram') runDeepgram();
  else runWhisper();

  /* ---------- Deepgram Nova-3 (전사+화자구분) -> gpt 번역 [테스트] ---------- */
  function runDeepgram() {
    if (!DEEPGRAM_API_KEY) {
      toHost({ type: 'status', message: 'DEEPGRAM_API_KEY 미설정 — deepgram 모드 사용 불가' });
      return;
    }
    // 문장 길이 조절: endpointing = 문장 끝으로 보는 무음 길이(ms). 크게 할수록 더 긴 문장.
    // UI(테스트용)에서 선택한 값이 있으면 사용, 없으면 기본 1200ms.
    const epRaw = Number(ws._endpointing);
    const DG_ENDPOINTING_MS = Number.isFinite(epRaw) && epRaw >= 0 ? epRaw : 1200;
    const DG_UTTERANCE_END_MS = Math.max(1000, DG_ENDPOINTING_MS); // utterance_end_ms 는 최소 1000
    const DG_MAX_CHARS = 200; // 무음 없이 계속 말하면 이 길이에서 강제 확정(폭주·번역깨짐 방지)
    const qp = new URLSearchParams({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: '24000',
      channels: '1',
      smart_format: 'true',
      punctuate: 'true',
      interim_results: 'true',
      endpointing: String(DG_ENDPOINTING_MS),
      utterance_end_ms: String(DG_UTTERANCE_END_MS),
      language: inLang || 'multi', // 입력 언어 select 반영. 자동이면 Nova-3 다국어(multi)
    });
    const dg = new WebSocket('wss://api.deepgram.com/v1/listen?' + qp.toString(), {
      headers: { Authorization: 'Token ' + DEEPGRAM_API_KEY },
    });
    idleClose = () => { try { dg.close(); } catch {} };
    let dgReady = false;
    const pending = [];
    const langsOut = ALL_LANGS;
    let curId = null;    // 진행 중 발화 카드 id(끝나면 확정)
    let finalBuf = '';   // 이번 발화에서 확정(is_final)된 조각 누적
    let curSrc = '';     // 감지된 입력 언어

    dg.on('open', () => {
      dgReady = true;
      while (pending.length) dg.send(pending.shift());
      toHost({ type: 'status', message: `엔진 연결됨 (Deepgram Nova-3, endpointing=${DG_ENDPOINTING_MS}ms)` });
      bumpIdle();
    });
    dg.on('message', async (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.type !== 'Results') return;
      const alt = ev.channel && ev.channel.alternatives && ev.channel.alternatives[0];
      const text = (alt && alt.transcript || '').trim();
      if (!text) return;
      bumpIdle();
      const det = (alt.languages && alt.languages[0]) || inLang || '';
      const sl = String(det).split('-')[0].toLowerCase();
      if (sl) curSrc = sl;
      if (!curId) curId = newId();
      // 지금까지 확정된 조각 + 현재(진행/방금확정) 텍스트를 합쳐 카드에 제자리 스트리밍(검은 글씨)
      const shown = ((finalBuf ? finalBuf + ' ' : '') + text).trim();
      const live = {};
      for (const lang of langsOut) live[lang] = shown;
      liveSend(curId, live, null);
      if (!ev.is_final) return; // interim → 표시만(아직 확정/번역 안 함)
      finalBuf = shown; // is_final 조각 누적
      // 말이 멈췄거나(speech_final) 너무 길면 → 한 문장으로 확정 + 번역
      if (ev.speech_final || finalBuf.length >= DG_MAX_CHARS) {
        const id = curId, txt = finalBuf, src = curSrc;
        curId = null; finalBuf = ''; curSrc = '';
        const base = {};
        for (const lang of langsOut) base[lang] = txt; // 들린 대로 즉시 확정(검은 글씨)
        upsertItem(id, base, txt);
        for (const lang of langsOut) {
          if (lang === src) continue; // 입력=출력은 그대로
          translateText(txt, lang, true, [])
            .then((tr) => { if (tr) upsertItem(id, { [lang]: tr }); })
            .catch(() => {});
        }
      }
    });
    dg.on('error', (e) => toHost({ type: 'status', message: 'Deepgram 오류: ' + (e && e.message || e) }));
    dg.on('close', () => toHost({ type: 'status', message: '엔진 연결 종료 (Deepgram)' }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (dgReady) dg.send(data);
        else pending.push(data);
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') { try { dg.send(JSON.stringify({ type: 'CloseStream' })); } catch {}; try { dg.close(); } catch {} }
      } catch {}
    });
    ws.on('close', () => { try { dg.close(); } catch {} });
  }

  /* ---------- whisper 전사 -> gpt 번역 ---------- */
  function runWhisper() {
    const oa = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    idleClose = () => { try { oa.close(); } catch {} };
    let oaReady = false;
    let appendedSinceCommit = 0;
    let srcBuf = ''; // 현재 커밋의 스트리밍 델타
    let srcAccum = ''; // 표시 단위가 될 때까지 누적되는 원문
    let batchStart = 0; // 현재 배치가 쌓이기 시작한 시각(ms)
    let tailTimer = null;
    const N_MS = 4000; // 최소 표시 단위(이 시간 전엔 번역 보류하고 더 모음 → 도입부 조각이 주절과 붙을 시간)
    const HARD_MS = 10000; // 이 시간 넘으면 미완성이라도 강제 확정(폭주 방지, 드물게 발동)
    const pending = [];
    const history = []; // 최근 원문->번역 쌍 (맥락용)
    const now = () => Date.now();
    let translating = false;

    // N초 배칭 + GPT 문장 경계 판단: 완결 문장만 번역하고 미완성 꼬리는 다음으로 넘김.
    // remainder 는 입력의 '깔끔한 꼬리'일 때만 신뢰. 아니면 통째로 보류하고 더 모아 재시도(중복/누락 방지).
    const flushBatch = async (force) => {
      if (translating) return;
      const input = srcAccum.trim();
      if (!input) return;
      translating = true;
      srcAccum = ''; // 소비 시작 (호출 중 도착분은 뒤에 append)
      let tail = ''; // 다음으로 넘길 원문
      try {
        const ctx = history.slice(-2);
        const { translation, remainder } = await segmentTranslate(input, ctx, force, targetLang, polish);
        const rem = (remainder || '').trim();
        const cleanSuffix = rem && rem.length < input.length && input.endsWith(rem);

        if (!force && rem && !cleanSuffix) {
          // GPT 분절을 신뢰할 수 없음 → 번역 버리고 입력 통째 보류, 더 모아서 재시도
          tail = input;
        } else {
          const consumed = cleanSuffix ? input.slice(0, input.length - rem.length).trim() : input;
          tail = force ? '' : cleanSuffix ? rem : '';
          const tr = (translation || '').trim();
          if (tr && consumed) {
            const id = newId();
            // 1차 언어(segmentTranslate 결과) 먼저 표시
            upsertItem(id, { [sessionLangs[0]]: tr }, consumed);
            history.push({ src: consumed, tr });
            if (history.length > 24) history.shift();
            // 나머지 언어는 같은 원문(consumed)을 직접 번역해 병렬로 채움
            for (const lang of sessionLangs.slice(1)) {
              translateText(consumed, lang, polish).then((t) => {
                if (t && t.trim()) upsertItem(id, { [lang]: t.trim() });
              });
            }
          }
        }
      } finally {
        srcAccum = (tail + ' ' + srcAccum).replace(/\s+/g, ' ').trim(); // 보류분 + 호출 중 도착분
        batchStart = srcAccum ? batchStart || now() : 0;
        sendPartial(srcAccum);
        translating = false;
      }
    };

    oa.on('open', () => {
      oa.send(
        JSON.stringify({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: inLang
                  ? { model: TRANSCRIBE_MODEL, language: inLang }
                  : { model: TRANSCRIBE_MODEL },
              },
            },
          },
        })
      );
      // 세션 준비 전 오디오는 OpenAI 가 버리므로, 준비 이벤트(또는 1.5s 폴백) 후 전송.
      setTimeout(markReady, 1500);
    });
    function markReady() {
      if (oaReady) return;
      oaReady = true;
      while (pending.length) oa.send(pending.shift());
      toHost({ type: 'status', message: '엔진 연결됨 (whisper)' });
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
      if (ev.type === 'conversation.item.input_audio_transcription.delta') {
        bumpIdle(); // 음성 활동 → 유휴 타이머 리셋
        srcBuf += ev.delta || '';
        sendPartial((srcAccum + ' ' + srcBuf).trim());
      } else if (ev.type === 'conversation.item.input_audio_transcription.completed') {
        srcAccum = (srcAccum + ' ' + (ev.transcript || srcBuf || '')).replace(/\s+/g, ' ').trim();
        srcBuf = '';
        if (!batchStart && srcAccum) batchStart = now();
        sendPartial(srcAccum); // 진행 중 원문 실시간 표시
        const elapsed = batchStart ? now() - batchStart : 0;
        if (elapsed >= HARD_MS) flushBatch(true);
        else if (elapsed >= N_MS) flushBatch(false);
        // 말이 멈추면 남은 것 확정 (연속 발화 중엔 커밋이 더 자주 와서 안 터짐)
        clearTimeout(tailTimer);
        tailTimer = setTimeout(() => flushBatch(true), 3000);
      } else if (ev.type && ev.type.includes('error')) {
        console.error('[whisper error]', JSON.stringify(ev));
        toHost({ type: 'status', message: '엔진 오류: ' + (ev.error?.message || ev.type) });
      }
    });
    oa.on('error', (e) => toHost({ type: 'status', message: 'OpenAI 연결 오류: ' + (e?.message || e) }));
    oa.on('close', () => toHost({ type: 'status', message: '엔진 연결 종료' }));

    const commit = () => {
      if (!oaReady || appendedSinceCommit === 0) return;
      appendedSinceCommit = 0;
      try {
        oa.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
      } catch {}
    };

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const msg = JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(data).toString('base64') });
        if (oaReady) oa.send(msg);
        else pending.push(msg);
        appendedSinceCommit++;
        return;
      }
      let m;
      try {
        m = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (m.type === 'commit' || m.type === 'stop') commit();
    });
    ws.on('close', () => {
      clearTimeout(tailTimer);
      flushBatch(true); // 남은 마지막 원문 확정(저장/뷰어 전송)
      setTimeout(() => {
        try {
          oa.close();
        } catch {}
      }, 2000);
    });
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
      const text = buf.trim();
      const id = curId;
      buf = '';
      curId = null;
      if (!text || !id) return;
      upsertItem(id, { [targetLang]: text }, null);
      // translate 다듬기: 띄어쓰기만 교정 (단어·어순·내용 보존)
      spacingPolish(text).then((p) => p && upsertItem(id, { [targetLang]: p.trim() }, null));
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
    oa.on('close', () => toHost({ type: 'status', message: '엔진 연결 종료' }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const msg = JSON.stringify({ type: 'session.input_audio_buffer.append', audio: Buffer.from(data).toString('base64') });
        if (oaReady) oa.send(msg);
        else pending.push(msg);
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
  console.log(`\n  KAC Translator 서버 실행 중`);
  console.log(`  · 데스크톱:  http://localhost:${PORT}`);
  console.log(`  · 같은 와이파이 모바일: http://${ip}:${PORT}\n`);
});
