import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { detectCategory } from './wayfind_dict.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 모델은 코드 고정(환경변수로 안 받음). 바꾸려면 여기서 직접 수정.
const TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
const TRANSLATE_MODEL = 'gpt-realtime-translate';
const REFINE_MODEL = 'gpt-5-nano';
const TARGET_LANG = process.env.TARGET_LANG || 'ko';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''; // Nova-3 테스트 모드(선택)
const SONIOX_API_KEY = process.env.SONIOX_API_KEY || ''; // Soniox stt-rt-v5 테스트 모드(선택)
const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || ''; // Cartesia Sonic 실시간 TTS(선택)
const CARTESIA_VERSION = '2025-04-16';
const CARTESIA_MODEL = 'sonic-3.5';
// 출력 언어 × 성별 고정 보이스 매핑 (Cartesia voice id)
const _RONALD = '5ee9feff-1265-424a-9d7f-8e4d431a12c7';
const CARTESIA_VOICES = {
  ko: { male: '89f4372f-1f73-4b85-8e1e-5d24ed8bc826' /*jaewon*/, female: '4dd4630e-19e0-4243-bca0-676ff85119b7' /*Haeun*/ },
  en: { male: _RONALD, female: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' /*skylar*/ },
  ja: { male: _RONALD, female: 'd0ff6870-dd30-420d-8568-d756d806ea62' /*hinata*/ },
  zh: { male: _RONALD, female: '6eb8965c-e295-47bd-a9e4-3eeebb3abcff' /*Jing*/ },
};
function cartesiaVoiceId(lang, gender) {
  const m = CARTESIA_VOICES[lang] || CARTESIA_VOICES.en;
  return gender === 'm' ? m.male : m.female;
}
// 미리듣기용 짧은 테스트 문장(언어별)
const TTS_TEST_PHRASE = { ko: '안녕하세요, 음성 테스트입니다.', en: 'Hello, this is a voice test.', ja: 'こんにちは、音声テストです。', zh: '你好，这是语音测试。' };

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

// 데스크 뷰어 PWA manifest(세션별 start_url) — '홈 화면에 추가'로 실행 시 항상 전체화면 유지
app.get('/desk.webmanifest', (req, res) => {
  const session = String(req.query.session || '');
  const start = '/desk.html' + (session ? `?session=${encodeURIComponent(session)}` : '');
  res.type('application/manifest+json').json({
    name: 'KAC Desk', short_name: 'KAC Desk',
    display: 'fullscreen', display_override: ['fullscreen', 'standalone'],
    background_color: '#0b0e14', theme_color: '#0b0e14',
    start_url: start, scope: '/',
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  });
});

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
const USAGE_HOURLY_FILE = path.join(DATA_DIR, 'usage_hourly.json');
const TERMS_FILE = path.join(DATA_DIR, 'terms_config.json'); // 고유명사/번역 설정(전역, Soniox context)
const SUMMARIES_FILE = path.join(DATA_DIR, 'summaries.json');
const MONGODB_URI = process.env.MONGODB_URI;                       // 있으면 Mongo, 없으면 로컬 파일
const MONGODB_DB = process.env.MONGODB_DB || 'kac_translator';     // DB 이름(앱이 자동 생성). 코드 기본값.

let sessions = [];  // 메모리 캐시(항상 진실의 원천)
let users = [];     // 생성된 사용자 { id, username, salt, hash, role, createdAt, usageMs }
let usageDaily = {}; // { 'YYYY-MM-DD': { whisperMs, translateMs } } — 파이프라인별 사용시간 일별 집계
let usageHourly = {}; // { 'YYYY-MM-DDTHH': { whisperMs, translateMs } } — 시간대별 집계(UTC)
// 전역 고유명사/번역 설정 — 세션(Soniox) 연결 시 context로 주입. 관리자만 수정, 전원 열람.
let termsConfig = { terms: [], translationTerms: [], updatedAt: 0 };
let summaries = []; // [{ id, sessionId, owner, title, createdAt, updatedAt, status, summary, error }]
let col = null;     // Mongo sessions 컬렉션. null 이면 파일 모드.
let usersCol = null;
let usageCol = null;
let usageHourlyCol = null;
let termsConfigCol = null;
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
        usageHourlyCol = db.collection('usageHourly');
        termsConfigCol = db.collection('termsConfig');
        summariesCol = db.collection('summaries');
        try { await db.collection('glossary').drop(); console.log('[store] 구 glossary 컬렉션 삭제'); } catch {} // 용어집 폐기
        await col.createIndex({ id: 1 }, { unique: true });
        await usersCol.createIndex({ id: 1 }, { unique: true });
        await usageCol.createIndex({ date: 1 }, { unique: true });
        await usageHourlyCol.createIndex({ hour: 1 }, { unique: true });
        await summariesCol.createIndex({ id: 1 }, { unique: true });
        sessions = await col.find({}, { projection: { _id: 0 } }).toArray();
        users = await usersCol.find({}, { projection: { _id: 0 } }).toArray();
        const rows = await usageCol.find({}, { projection: { _id: 0 } }).toArray();
        usageDaily = {};
        rows.forEach((r) => (usageDaily[r.date] = { whisperMs: r.whisperMs || 0, translateMs: r.translateMs || 0 }));
        const hrows = await usageHourlyCol.find({}, { projection: { _id: 0 } }).toArray();
        usageHourly = {};
        hrows.forEach((r) => (usageHourly[r.hour] = { whisperMs: r.whisperMs || 0, translateMs: r.translateMs || 0 }));
        const tc = await termsConfigCol.findOne({ _id: 'singleton' });
        if (tc) termsConfig = { terms: tc.terms || [], translationTerms: tc.translationTerms || [], updatedAt: tc.updatedAt || 0 };
        summaries = await summariesCol.find({}, { projection: { _id: 0 } }).toArray();
        console.log(`[store] MongoDB 연결됨 — 세션 ${sessions.length} / 사용자 ${users.length}`);
        return;
      } catch (e) {
        console.error(`[store] MongoDB 연결 실패 (시도 ${attempt}/3): ${e.message}`);
        col = usersCol = usageCol = usageHourlyCol = termsConfigCol = summariesCol = null;
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
    if (fs.existsSync(USAGE_HOURLY_FILE)) {
      const h = JSON.parse(fs.readFileSync(USAGE_HOURLY_FILE, 'utf8'));
      if (h && typeof h === 'object') usageHourly = h;
    }
    if (fs.existsSync(TERMS_FILE)) {
      const t = JSON.parse(fs.readFileSync(TERMS_FILE, 'utf8'));
      if (t && typeof t === 'object') termsConfig = { terms: t.terms || [], translationTerms: t.translationTerms || [], updatedAt: t.updatedAt || 0 };
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
function hourKey() {
  return new Date().toISOString().slice(0, 13); // UTC YYYY-MM-DDTHH
}
function recordUsage(pipeline, ms) {
  if (!ms || ms < 0) return;
  const k = dateKey();
  const d = usageDaily[k] || (usageDaily[k] = { whisperMs: 0, translateMs: 0 });
  const hk = hourKey();
  const h = usageHourly[hk] || (usageHourly[hk] = { whisperMs: 0, translateMs: 0 });
  if (pipeline === 'translate') { d.translateMs += ms; h.translateMs += ms; }
  else { d.whisperMs += ms; h.whisperMs += ms; }
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
    if (usageHourlyCol) {
      const hops = Object.entries(usageHourly).map(([hour, v]) => ({
        replaceOne: { filter: { hour }, replacement: { hour, whisperMs: v.whisperMs || 0, translateMs: v.translateMs || 0 }, upsert: true },
      }));
      if (hops.length) await usageHourlyCol.bulkWrite(hops, { ordered: false });
    }
  } else {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(usageDaily, null, 2));
    fs.writeFileSync(USAGE_HOURLY_FILE, JSON.stringify(usageHourly, null, 2));
  }
}

// 고유명사/번역설정 기본 시드(KAC 항공 도메인) — 저장된 설정이 없을 때만 1회 주입
const DEFAULT_TERMS = ['ICAO','IATA','FAA','KAC','IIAC','FIDS','CIQ','BHS','NOTAM','PBB','VDGS','FOD','A-CDM','MRO','ILS','AWOS','SCADA','AODB','EIRP','FIS','ASDE','BMS','AVSM'];
const DEFAULT_TRANSLATION_TERMS = [
  { source: 'apron', target: '주기장' }, { source: 'ramp', target: '램프' }, { source: 'slot', target: '슬롯' },
  { source: 'terminal', target: '터미널' }, { source: 'gate', target: '탑승구' }, { source: 'marshalling', target: '항공기 유도' },
  { source: 'towing', target: '토잉' }, { source: 'towing car', target: '토잉카' }, { source: 'pushback', target: '푸시백' },
  { source: 'hub', target: '허브 공항' }, { source: 'curbside', target: '커브사이드' }, { source: 'landside', target: '랜드사이드' },
  { source: 'airside', target: '에어사이드' }, { source: 'carousel', target: '수하물 수취대' }, { source: 'holdover time', target: '방빙유지시간' },
  { source: 'de-icing', target: '제빙 작업' }, { source: 'taxing', target: '지상 활주' }, { source: 'taxiway', target: '유도로' },
  { source: 'runway', target: '활주로' }, { source: 'stand', target: '주기장 번호' }, { source: 'screening', target: '보안검색' },
  { source: 'pat-down', target: '촉수검색' }, { source: 'diversion', target: '회항' }, { source: 'check-in', target: '체크인' },
  { source: 'concourse', target: '탑승동' }, { source: 'turnaround', target: '턴어라운드' }, { source: 'turnaround time', target: '지상조업 시간' },
  { source: 'baggage claim', target: '수하물 수취대' }, { source: 'customs', target: '세관' }, { source: 'immigration', target: '출입국심사' },
  { source: 'quarantine', target: '검역' },
];

await loadStore();
if (!termsConfig.updatedAt) {
  termsConfig = { terms: DEFAULT_TERMS.slice(), translationTerms: DEFAULT_TRANSLATION_TERMS.slice(), updatedAt: Date.now() };
  try { await persistTermsConfig(); console.log('[terms] 기본 고유명사/번역 설정 시드 저장'); } catch (e) { console.error('[terms] 시드 저장 실패', e); }
}

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

/* ---- 고유명사/번역 설정 저장 + Soniox context 구성 ---- */
async function persistTermsConfig() {
  if (termsConfigCol) {
    await termsConfigCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...termsConfig }, { upsert: true });
  } else {
    fs.writeFileSync(TERMS_FILE, JSON.stringify(termsConfig, null, 2));
  }
}
// Soniox 세션 context: terms(고유명사) + translation_terms(번역 쌍). 비어 있으면 null.
function buildSonioxContext() {
  const terms = (termsConfig.terms || []).map((t) => String(t || '').trim()).filter(Boolean);
  const tt = (termsConfig.translationTerms || [])
    .filter((p) => p && p.source && p.target)
    .map((p) => ({ source: String(p.source).trim(), target: String(p.target).trim() }))
    .filter((p) => p.source && p.target);
  // 번역쌍의 source 단어도 전사 인식 향상 위해 terms에 합침(중복 제거)
  const allTerms = [...new Set([...terms, ...tt.map((p) => p.source)])];
  const ctx = {};
  if (allTerms.length) ctx.terms = allTerms;
  if (tt.length) ctx.translation_terms = tt;
  return Object.keys(ctx).length ? ctx : null;
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
  // remember(자동 로그인) 시 30일 영속 쿠키, 아니면 세션 쿠키(브라우저 종료 시 해제)
  const persist = b.remember ? '; Max-Age=2592000' : '';
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken(user.id)}; HttpOnly; SameSite=Lax; Path=/${persist}${secure}`);
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

// 고유명사/번역 설정: 열람(로그인 누구나) + 수정(관리자만). Soniox context로 주입됨.
app.get('/api/terms-config', requireAuth, (req, res) => {
  res.json({ terms: termsConfig.terms || [], translationTerms: termsConfig.translationTerms || [], updatedAt: termsConfig.updatedAt || 0 });
});
app.put('/api/terms-config', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const terms = Array.isArray(b.terms)
    ? [...new Set(b.terms.map((t) => String(t || '').trim()).filter(Boolean))].slice(0, 1000)
    : [];
  const translationTerms = Array.isArray(b.translationTerms)
    ? b.translationTerms
        .map((p) => ({ source: String((p && p.source) || '').trim(), target: String((p && p.target) || '').trim() }))
        .filter((p) => p.source && p.target)
        .slice(0, 1000)
    : [];
  termsConfig = { terms, translationTerms, updatedAt: Date.now() };
  try { await persistTermsConfig(); } catch (e) { console.error('[terms] 저장 실패', e); }
  res.json(termsConfig);
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
  `- 전문이 "* [화자] : 발언" 형식이면 각 발언이 누구 것인지 구분해, 발언자별 입장·주장·담당 사항을 명확히 반영한다.\n` +
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
  const names = session.speakers || {};
  for (const it of session.items || []) {
    let t = it.texts ? it.texts.ko || Object.values(it.texts)[0] || '' : it.text || '';
    t = (t || '').trim();
    if (!t) continue;
    if (it.speaker) {
      const nm = names[it.speaker] || ('화자 ' + it.speaker);
      lines.push(`* [${nm}] : ${t}`);
    } else lines.push(t);
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
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length, pipeline: s.pipeline || 'whisper', preset: s.preset || null }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  const pipeline = ['translate', 'deepgram', 'soniox', 'desk'].includes(b.pipeline) ? b.pipeline : 'whisper';
  // whisper 는 항상 한·영·일·중 전부 번역. translate 는 단일 출력 언어. desk 는 ko 시작(감지로 동적 확장).
  const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
  const langs = pipeline === 'translate' ? [outLang] : (pipeline === 'desk' ? ['ko'] : ALL_LANGS.slice()); // whisper·deepgram 다국어
  // 통역 용도 프리셋(대면/온라인/현장) — 클라가 소스·방향 기본값을 매핑
  const preset = ['oneway', 'twoway', 'mobile', 'meeting', 'online', 'field'].includes(b.preset) ? b.preset : undefined;
  // 데스크 안내: 출발 안내데스크 층/방향(길안내 출발점)
  const deskFloor = pipeline === 'desk' ? (['1F', '2F', '3F', '4F'].includes(b.deskFloor) ? b.deskFloor : '1F') : undefined;
  const deskSide = pipeline === 'desk' ? (['E', 'W', 'S', 'N'].includes(b.deskSide) ? b.deskSide : 'S') : undefined;
  const s = {
    id: newId(),
    owner: req.user.id, // 소유자
    title: b.title || '새 세션',
    createdAt: now,
    updatedAt: now,
    pipeline, // 생성 후 변경 불가
    ...(preset ? { preset } : {}),
    ...(deskFloor ? { deskFloor, deskSide } : {}),
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

// 데스크 뷰어 랜딩(공개): 안내데스크 세션 목록(id·제목만) — 뷰어가 방을 선택해 접속
app.get('/api/desk-sessions', (req, res) => {
  const list = sessions
    .filter((s) => s.pipeline === 'desk')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map((s) => ({ id: s.id, title: s.title || '안내데스크' }));
  res.json(list);
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
  if (s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  // pipeline 은 생성 시 고정. title·inLang 수정 허용. outLang 은 translate 의 타깃 변경용.
  const b = req.body || {};
  if (typeof b.title === 'string') s.title = b.title;
  if (typeof b.inLang === 'string') s.inLang = b.inLang;
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
const rooms = new Map(); // sessionId -> { viewers:Set<ws>, hosts:Set<ws> }
const roomCfg = new Map(); // sessionId -> 호스트가 시작한 soniox 설정(폰 PTT가 재사용)
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
// 폰 PTT 결과를 호스트(데스크톱) 화면에도 실시간 반영
function sendToHosts(sessionId, payload) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify(payload);
  for (const h of room.hosts) {
    if (h.readyState === WebSocket.OPEN) h.send(msg);
  }
}
// 세션 항목 저장 + 표시 메시지 생성(폰 PTT용 — handleHost 클로저 밖에서 사용)
function applyItem(sessionId, id, side, langTexts, source) {
  const session = getSession(sessionId);
  let item;
  if (session) {
    item = session.items.find((x) => x.id === id);
    if (item) { item.texts = { ...(item.texts || {}), ...langTexts }; if (source) item.source = source; }
    else { item = { id, side, source: source || null, texts: { ...langTexts } }; session.items.push(item); }
    if (session.title === '새 세션' && session.items.length === 1) { const f = Object.values(item.texts)[0] || ''; if (f) session.title = f.slice(0, 40); }
    session.updatedAt = Date.now();
    saveSessions();
  } else {
    item = { id, side, source: source || null, texts: { ...langTexts } };
  }
  return { type: 'sentence', id, side, source: item.source || null, texts: item.texts, terms: {} };
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
// TTS 음성을 호스트로 — 뷰어(상대) 발화의 번역을 호스트가 듣게 함
function sendAudioToHosts(sessionId, b64) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify({ type: 'audio', b64 });
  for (const h of room.hosts) {
    if (h.readyState === WebSocket.OPEN) h.send(msg);
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
  // 데스크 랜딩 QR: session 없이 호출하면 안내데스크 선택 화면(desk.html)으로
  const landing = req.query.desk === '1' || (!sessionId && req.query.landing === '1');
  if (!sessionId && !landing) return res.status(400).json({ error: 'session required' });
  // 배포 환경: 요청 host/proto 사용(Render 등은 x-forwarded-* 로 전달).
  let proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  // 로컬 접속(localhost)이면 같은 와이파이 모바일이 닿도록 LAN IP 로 대체.
  if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host)) {
    host = `${getLanIp()}:${PORT}`;
    proto = 'http';
  }
  // 데스크 안내 모드는 전용(최소 UI·터치 시작·전체화면) 뷰어로. 랜딩(세션 선택)은 desk.html (세션 없이)
  const sess = sessionId ? getSession(sessionId) : null;
  let url;
  if (landing) url = `${proto}://${host}/desk.html`;
  else {
    const viewer = sess && sess.pipeline === 'desk' ? 'desk.html' : 'mobile.html';
    url = `${proto}://${host}/${viewer}?session=${encodeURIComponent(sessionId)}`;
  }
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
    res.json({ url, qr: dataUrl });
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
/* ------------------------------------------------------------------ */
/*  Cartesia Sonic 실시간 TTS (텍스트 → 24kHz PCM16 스트리밍)            */
/*   bytes 엔드포인트의 스트리밍 본문을 청크 단위로 받아 즉시 흘려보냄.   */
/* ------------------------------------------------------------------ */
async function cartesiaTTSStream(text, voiceId, language, onAudio) {
  if (!CARTESIA_API_KEY || !text || !text.trim()) return;
  const body = {
    model_id: CARTESIA_MODEL,
    transcript: text,
    voice: { mode: 'id', id: voiceId },
    language,
    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
  };
  let res;
  try {
    res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': CARTESIA_API_KEY,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error('[cartesia] error', e.message); return; }
  if (!res.ok || !res.body) { console.error('[cartesia] HTTP', res.status, (await res.text().catch(() => '')).slice(0, 160)); return; }
  // 스트리밍 raw PCM16 → ~0.2초 단위로 짝수바이트 정렬해 전송(끊김 없는 순차 재생)
  const MIN = 9600; // 24k * 2byte * 0.2s
  let carry = Buffer.alloc(0);
  try {
    for await (const chunk of res.body) {
      carry = Buffer.concat([carry, Buffer.from(chunk)]);
      if (carry.length >= MIN) {
        const even = carry.length - (carry.length % 2);
        onAudio(carry.subarray(0, even).toString('base64'));
        carry = carry.subarray(even);
      }
    }
    if (carry.length >= 2) {
      const even = carry.length - (carry.length % 2);
      onAudio(carry.subarray(0, even).toString('base64'));
    }
  } catch (e) { console.error('[cartesia] stream', e.message); }
}

// 시작 시 연결 워밍업 + 키/보이스 검증(첫 음성 지연 단축, TLS keep-alive 확보)
async function cartesiaWarmup(voiceId, language) {
  if (!CARTESIA_API_KEY) return { ok: false, error: 'CARTESIA_API_KEY 미설정' };
  // 구두점만 있는 transcript 는 거부됨 → 언어별 짧은 단어 사용
  const tx = { ko: '네.', en: 'Hi.', ja: 'はい。', zh: '你好。' }[language] || 'Hi.';
  try {
    const res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': CARTESIA_API_KEY, 'Cartesia-Version': CARTESIA_VERSION, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: CARTESIA_MODEL, transcript: tx, voice: { mode: 'id', id: voiceId }, language, output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 } }),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 80)}` };
    try { for await (const _ of res.body) { /* drain to keep socket warm */ } } catch {}
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// 모델별 reasoning_effort: gpt-5.4+ 는 'minimal' 미지원(none/low/…) → 'none',
// 구형 gpt-5(nano/mini)는 'minimal'. 그 외 모델은 미설정.
function reasoningEffort(model) {
  if (/^gpt-5\.\d/.test(model)) return 'none';
  if (/^gpt-5/.test(model)) return 'minimal';
  return null;
}

async function translateText(text, targetLang, polish, context, model) {
  const useModel = model && /^gpt-/.test(model) ? model : REFINE_MODEL;
  const langName = LANG_NAMES[targetLang] || targetLang;
  try {
    const sys = polish
      ? `너는 전문 동시통역사다. 실시간 음성에서 받아쓴 텍스트(말하는 도중 끊긴 단편일 수 있음)를 ${langName}로 옮긴다. 딱딱한 직역투·문어체를 피하고, 실제 사람이 말하듯 자연스러운 '구어체'로 옮긴다. 의미가 매끄럽게 전달되도록 적당히 의역한다.
규칙:
- 여러 문장이 함께 들어오면 각 문장을 그대로 문장 단위로 옮기고, 서로 억지로 합치지 않는다.
- 문체는 입으로 말하는 자연스러운 구어체로 한다. 글로 쓴 듯한 딱딱한 문어체("~하였다", "~이다", 번역체)를 피하고, 말할 때 쓰는 표현("~예요/~해요/~거든요/~네요" 등)으로 옮긴다. 정중함은 유지하되 반말은 섞지 않는다. 직역해서 어색한 표현은 한국어다운 표현으로 바꾼다(자연스러움 우선, 의미는 정확히 유지).
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
    const body = { model: useModel, messages, max_completion_tokens: 500 };
    const re = reasoningEffort(useModel);
    if (re) body.reasoning_effort = re;

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
    const re = reasoningEffort(REFINE_MODEL);
    if (re) body.reasoning_effort = re;
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
async function segmentTranslate(text, context, force, targetLang, polish, model) {
  const useModel = model && /^gpt-/.test(model) ? model : REFINE_MODEL;
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
    `- 문체는 글이 아니라 '말'이다. 실제 말하듯 자연스러운 구어체로 옮긴다(딱딱한 문어체·번역체 금지, '~예요/~해요/~거든요/~네요' 같은 말투). 정중함은 유지하되 반말은 섞지 않는다.\n` +
    `- 직역해서 어색한 표현은 한국어다운 자연스러운 표현으로 바꾼다(자연스러움 우선, 단 의미는 정확히 유지).\n` +
    `- 학년은 한국식으로 자연스럽게 옮긴다(예: seventh grade → 7학년).\n` +
    `- 고유명사·지명은 발음을 살리고, 추측성 괄호·부연은 넣지 않는다.${ctxLine}\n` +
    `출력은 JSON 한 개: {"translation": "...", "remainder": "..."}`;
  try {
    const body = {
      model: useModel,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: text },
      ],
      max_completion_tokens: 600,
      response_format: { type: 'json_object' },
    };
    const re = reasoningEffort(useModel);
    if (re) body.reasoning_effort = re;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      console.error('[segment] HTTP', r.status, await r.text());
      return { translation: await translateText(text, targetLang, polish, context, useModel), remainder: '' };
    }
    const data = await r.json();
    const obj = JSON.parse(data?.choices?.[0]?.message?.content || '{}');
    return { translation: (obj.translation || '').trim(), remainder: (obj.remainder || '').trim() };
  } catch (e) {
    console.error('[segment] error', e);
    return { translation: await translateText(text, targetLang, polish, context, useModel), remainder: '' };
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
/*  데스크 길안내 — 시설 데이터 로드 + 카테고리→인스턴스 해석                */
/* ------------------------------------------------------------------ */
let _facilities = null; // { '1F':[{name,x,y,in_secure,...}], ... }
function loadFacilities() {
  if (_facilities) return _facilities;
  try {
    let s = fs.readFileSync(new URL('./map/wayfinding_data.js', import.meta.url), 'utf8');
    s = s.replace(/^\s*window\.AIRPORT_DATA\s*=/, '').replace(/;\s*$/, '');
    const d = JSON.parse(s);
    _facilities = d.facilities || {};
  } catch (e) { console.warn('[wayfind] 시설 데이터 로드 실패:', e.message); _facilities = {}; }
  return _facilities;
}
const DESK_FLOORS = ['1F', '2F', '3F', '4F'];
// 카테고리 → 목적지 배열. 데스크 층 우선(전부), 없으면 층번호상 가장 가까운 층. in_secure 는 가급적 제외.
function resolveWayfind(koText, deskFloor) {
  const cats = detectCategory(koText);
  if (!cats.length) return null;
  const cat = cats[0];
  const fac = loadFacilities();
  const onFloor = (fk) => (fac[fk] || []).filter((f) => cat.match.some((m) => String(f.name).includes(m)));
  const pick = (list) => { const open = list.filter((f) => !f.in_secure); return (open.length ? open : list).map((f) => ({ floor: f._fk, x: f.x, y: f.y, name: f.name })); };
  // 층 우선순위: 데스크 층 → 가까운 층 순
  const base = DESK_FLOORS.indexOf(deskFloor) >= 0 ? deskFloor : '1F';
  const order = DESK_FLOORS.slice().sort((a, b) => Math.abs(DESK_FLOORS.indexOf(a) - DESK_FLOORS.indexOf(base)) - Math.abs(DESK_FLOORS.indexOf(b) - DESK_FLOORS.indexOf(base)));
  for (const fk of order) {
    const list = onFloor(fk).map((f) => ({ ...f, _fk: fk }));
    if (list.length) return { category: cat.id, ko: cat.ko, sameFloor: fk === base, floor: fk, dests: pick(list) };
  }
  return { category: cat.id, ko: cat.ko, dests: [] }; // 매칭은 됐지만 시설 없음
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
      ws._sxSens = searchParams.get('sxSens');       // soniox endpoint_sensitivity (-1~1)
      ws._sxMaxDelay = searchParams.get('sxMaxDelay'); // soniox max_endpoint_delay_ms (500~3000)
      ws._sxLatency = searchParams.get('sxLatency');   // soniox endpoint_latency_adjustment_level (0~3)
      ws._model = searchParams.get('model');           // 번역 GPT 모델 오버라이드(테스트용)
      ws._sxMode = searchParams.get('sxMode');     // soniox 번역 방향 'one'|'two'
      ws._sxTarget = searchParams.get('sxTarget'); // 단방향 타깃 언어
      ws._sxA = searchParams.get('sxA');           // 양방향 언어 A
      ws._sxB = searchParams.get('sxB');           // 양방향 언어 B
      ws._tts = searchParams.get('tts');           // soniox 실시간 TTS on('1')
      ws._gender = searchParams.get('gender');     // 음성 성별 'm' | 'f'
      ws._diar = searchParams.get('diar');         // 화자 구분 on('1')
      ws._deskLangs = searchParams.get('deskLangs'); // desk 후보 언어(콤마구분) — 취항국
      ws._deskIdle = searchParams.get('deskIdle');   // desk 외국어 무음 리셋(ms)
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

/* 폰 PTT(누르고 말하기) 파이프라인: 폰 마이크 오디오 → Soniox 양방향 번역 →
   호스트·뷰어에 브로드캐스트(+TTS). 호스트 설정(roomCfg)을 재사용. */
function startTalkPipeline(sessionId, side) {
  if (!SONIOX_API_KEY) return null;
  const cfg = roomCfg.get(sessionId) || {};
  const L4 = ['ko', 'en', 'ja', 'zh'];
  const a = L4.includes(cfg.sxA) ? cfg.sxA : 'ko';
  const b = L4.includes(cfg.sxB) ? cfg.sxB : (cfg.sxMode === 'one' && L4.includes(cfg.sxTarget) ? cfg.sxTarget : 'en');
  const config = {
    api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
    enable_language_identification: true, enable_endpoint_detection: true,
    endpoint_sensitivity: cfg.sens || 0, max_endpoint_delay_ms: cfg.maxDelay || 2000, endpoint_latency_adjustment_level: cfg.latency || 0,
    language_hints: [a, b], translation: { type: 'two_way', language_a: a, language_b: b },
  };
  const sx = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
  let ready = false; const pending = [];
  let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommit = '';
  const targetKeyFor = (src) => (src === a ? b : a);
  const SX_MAX = 200;
  const commit = () => {
    const id = curId, txt = finalText.trim(), src = curSrc, tgt = (finalTrans.trim() || lastTrans).trim();
    curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = '';
    if (!id || !txt) return;
    const out = tgt || txt;
    if (out === lastCommit) return;
    lastCommit = out;
    const target = targetKeyFor(src || a);
    const msg = applyItem(sessionId, id, side, { [target]: out }, txt);
    broadcast(sessionId, msg); sendToHosts(sessionId, msg);
    if (cfg.ttsOn) {
      const voiceId = cartesiaVoiceId(target, cfg.gender || 'f');
      // 뷰어(폰 PTT) 발화 번역 → 호스트로 음성 전달(+다른 뷰어). 호스트가 상대 말을 듣게 함.
      cartesiaTTSStream(out, voiceId, target, (b64) => { sendAudioToHosts(sessionId, b64); broadcastAudio(sessionId, b64); }).catch(() => {});
    }
  };
  sx.on('open', () => { try { sx.send(JSON.stringify(config)); } catch {} ready = true; while (pending.length) sx.send(pending.shift()); });
  sx.on('message', (raw) => {
    let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (ev.error_code) return;
    const toks = ev.tokens || []; if (!toks.length) return;
    let endHit = false, nonFinal = '', nonFinalTrans = '';
    for (const t of toks) {
      if (t.text === '<end>') { endHit = true; continue; }
      if (t.translation_status === 'translation') { if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text; }
      else { if (t.language && !curSrc) curSrc = String(t.language).split('-')[0].toLowerCase(); if (t.is_final) finalText += t.text; else nonFinal += t.text; }
    }
    const shownSrc = (finalText + nonFinal).trim(), shownTgt = (finalTrans + nonFinalTrans).trim();
    if (shownTgt) lastTrans = shownTgt;
    if (!curId && (shownSrc || shownTgt)) curId = newId();
    if (curId) { const msg = { type: 'sentence', id: curId, side, source: shownSrc || null, texts: { [targetKeyFor(curSrc || a)]: shownTgt } }; broadcast(sessionId, msg); sendToHosts(sessionId, msg); }
    if (endHit || finalText.length >= SX_MAX) commit();
  });
  sx.on('error', () => {});
  return {
    feed: (data) => { if (ready) { try { sx.send(data); } catch {} } else pending.push(data); },
    stop: () => { try { sx.send(''); } catch {} try { sx.close(); } catch {} },
  };
}

/* 데스크 안내(뷰어 구동): 뷰어 태블릿이 직접 마이크를 캡처 → 이 파이프라인으로 전송.
   detect(one_way→ko + 언어식별) → 외국어 첫 문장 endpoint에서 그 언어로 lock → two_way(ko↔X) 재연결.
   무음 deskIdleMs(기본 7초) 동안 아무 말 없으면 대화 종료(deskLog 보존)·리셋 → 다시 감지. 결과는 뷰어+호스트로 broadcast. */
function startDeskPipeline(sessionId, opts = {}) {
  if (!SONIOX_API_KEY) return null;
  const A = 'ko';
  const SUPPORTED = ['en', 'ja', 'zh', 'vi', 'th', 'tl', 'id', 'ru', 'ms'];
  let CAND = SUPPORTED;
  if (opts.deskLangs) {
    const f = String(opts.deskLangs).split(',').map((s) => s.trim().toLowerCase()).filter((c) => SUPPORTED.includes(c));
    if (f.length) CAND = f;
  }
  const deskIdleMs = Math.min(60000, Math.max(2000, Number(opts.deskIdle) || 7000));
  const sens = Number(opts.sxSens);
  const side = 'right';
  let phase = 'detect', lockedB = null, sx = null, sxReady = false, stopped = false;
  const pending = [];
  let foreignTimer = null;
  let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommitText = '';

  const baseConfig = () => ({
    api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
    enable_language_identification: true, enable_endpoint_detection: true,
    endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
    max_endpoint_delay_ms: 2000, endpoint_latency_adjustment_level: 0,
    ...(buildSonioxContext() ? { context: buildSonioxContext() } : {}),
  });
  const configFor = () => (phase === 'locked' && lockedB
    ? { ...baseConfig(), language_hints: [A, lockedB], translation: { type: 'two_way', language_a: A, language_b: lockedB } }
    : { ...baseConfig(), language_hints: [A, ...CAND], translation: { type: 'one_way', target_language: A } });

  const sendMeta = () => {
    const sxInfo = phase === 'locked' && lockedB ? { mode: 'two', a: A, b: lockedB } : { mode: 'one', target: A, detect: true };
    const s = getSession(sessionId);
    if (s) { s.sxInfo = sxInfo; if (phase === 'locked') s.langs = [A, lockedB]; saveSessions(); }
    broadcast(sessionId, { type: 'meta', sxInfo });
    sendToHosts(sessionId, { type: 'meta', sxInfo });
  };
  const targetKeyFor = (src) => (phase === 'locked' ? (src === A ? lockedB : A) : A);
  const reset = () => { curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; };

  const live = (id, langTexts, source) => { const m = { type: 'sentence', id, side, source: source || null, texts: langTexts, terms: {} }; broadcast(sessionId, m); sendToHosts(sessionId, m); };
  const commit = () => {
    const id = curId, txt = finalText.trim(), src = curSrc;
    const tgt = (finalTrans.trim() || lastTrans).trim();
    reset();
    if (!id || !txt) return;
    const out = tgt || txt;
    if (out && out === lastCommitText) return;
    lastCommitText = out;
    const msg = applyItem(sessionId, id, side, { [targetKeyFor(src)]: out }, txt);
    broadcast(sessionId, msg); sendToHosts(sessionId, msg);
  };

  const armTimer = () => { clearTimeout(foreignTimer); foreignTimer = setTimeout(() => { if (phase === 'locked') endConversation(); }, deskIdleMs); };
  const endConversation = () => {
    clearTimeout(foreignTimer);
    commit();
    const s = getSession(sessionId);
    if (s) {
      if (Array.isArray(s.items) && s.items.length) {
        s.deskLog = s.deskLog || [];
        s.deskLog.push({ endedAt: Date.now(), lang: lockedB, items: s.items });
        if (s.deskLog.length > 200) s.deskLog = s.deskLog.slice(-200);
        s.items = [];
      }
      saveSessions();
    }
    lastCommitText = ''; phase = 'detect'; lockedB = null; reset();
    broadcast(sessionId, { type: 'desk-reset' }); sendToHosts(sessionId, { type: 'desk-reset' });
    broadcast(sessionId, { type: 'snapshot', items: [] });
    sendMeta();
    reconnect();
  };
  const relock = (B) => { phase = 'locked'; lockedB = B; lastCommitText = ''; reset(); sendMeta(); armTimer(); reconnect(); };

  function reconnect() {
    if (stopped) return;
    const old = sx; sxReady = false;
    const next = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
    sx = next;
    next.on('open', () => { try { next.send(JSON.stringify(configFor())); } catch {} sxReady = true; while (pending.length) { try { next.send(pending.shift()); } catch {} } });
    next.on('message', onMsg);
    next.on('error', () => {});
    next.on('close', () => {});
    try { if (old && old !== next) old.close(); } catch {}
  }
  function onMsg(raw) {
    let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (ev.error_code) return;
    const toks = ev.tokens || [];
    if (!toks.length) return;
    if (phase === 'locked') armTimer();
    let endHit = false, nonFinal = '', nonFinalTrans = '';
    for (const t of toks) {
      if (t.text === '<end>') { endHit = true; continue; }
      if (t.translation_status === 'translation') { if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text; }
      else { const lang = t.language ? String(t.language).split('-')[0].toLowerCase() : ''; if (lang && !curSrc) curSrc = lang; if (t.is_final) finalText += t.text; else nonFinal += t.text; }
    }
    const shownSrc = (finalText + nonFinal).trim(), shownTgt = (finalTrans + nonFinalTrans).trim();
    if (shownTgt) lastTrans = shownTgt;
    if (!curId && (shownSrc || shownTgt)) curId = newId();
    if (curId) live(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null);
    if (endHit || finalText.length >= 200) {
      const src = curSrc;
      commit();
      if (phase === 'detect' && src && src !== A && CAND.includes(src)) relock(src);
    }
  }

  sendMeta();
  reconnect();
  return {
    feed: (data) => { if (sxReady && sx) { try { sx.send(data); } catch {} } else if (pending.length < 2000) pending.push(data); },
    stop: () => { stopped = true; clearTimeout(foreignTimer); try { sx && sx.send(''); } catch {} try { sx && sx.close(); } catch {} },
  };
}

/* ----------------------------- 뷰어 ------------------------------- */
function handleViewer(ws) {
  const room = getRoom(ws._session);
  room.viewers.add(ws);
  ws._audioWanted = false; // '음성 듣기' 구독 여부
  let talk = null; // 폰 PTT 파이프라인
  const s = getSession(ws._session);
  ws.send(JSON.stringify({ type: 'snapshot', items: s ? s.items : [] }));
  ws.send(JSON.stringify({ type: 'host', active: room.hosts.size > 0 })); // 현재 호스트 활성 여부
  if (s && s.sxInfo) ws.send(JSON.stringify({ type: 'meta', sxInfo: s.sxInfo })); // 접속/재접속 시 현재 출력언어 라벨 동기화
  ws.on('message', (data, isBinary) => {
    if (isBinary) { if (talk) talk.feed(data); return; }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'audioSub') ws._audioWanted = !!m.on;
      else if (m.type === 'ptt') {
        if (m.on) {
          if (!talk) talk = startTalkPipeline(ws._session, 'right');
          if (!talk) ws.send(JSON.stringify({ type: 'status', message: '음성 입력 불가 — SONIOX_API_KEY 미설정' }));
        } else if (talk) { talk.stop(); talk = null; }
      } else if (m.type === 'desk-viewer-start') {
        // 데스크: 마이크는 호스트. 뷰어 터치 → 호스트(패시브 뷰어 연결)에 캡처 시작 요청
        broadcast(ws._session, { type: 'desk-remote-start' });
      }
    } catch {}
  });
  ws.on('close', () => { room.viewers.delete(ws); if (talk) { talk.stop(); talk = null; } });
}

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
function handleHost(ws) {
  const sessionId = ws._session;
  const side = ws._src === 'system' ? 'left' : 'right'; // 시스템=좌, 마이크=우
  const session = getSession(sessionId);
  // 폰 PTT 결과를 이 호스트 화면에도 보내기 위해 room.hosts 에 등록 + 활성 신호
  getRoom(sessionId).hosts.add(ws);
  broadcast(sessionId, { type: 'host', active: true });
  ws.on('close', () => { const r = rooms.get(sessionId); if (r) { r.hosts.delete(ws); if (r.hosts.size === 0) broadcast(sessionId, { type: 'host', active: false }); } });
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
  // 번역 GPT 모델(테스트용 오버라이드). 미지정/이상값이면 기본 REFINE_MODEL.
  const refineModel = ws._model && /^gpt-/.test(ws._model) ? ws._model : REFINE_MODEL;
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
  const buildMsg = (id, item) => ({ type: 'sentence', id, side, source: item.source || null, texts: item.texts, speaker: item.speaker || null });
  // 화면에만 보냄(저장 안 함) — translate 스트리밍/whisper 진행표시용
  const liveSend = (id, langTexts, source, speaker) => {
    const m = { type: 'sentence', id, side, source: source || null, texts: langTexts, speaker: speaker || null };
    toHost(m);
    broadcast(sessionId, m);
  };
  // 확정: 세션 저장 + 전송. 언어별로 병합.
  const upsertItem = (id, langTexts, source, speaker) => {
    let item;
    if (session) {
      item = session.items.find((x) => x.id === id);
      if (item) {
        item.texts = { ...(item.texts || {}), ...langTexts };
        if (source) item.source = source;
        if (speaker) item.speaker = speaker;
      } else {
        item = { id, side, source: source || null, texts: { ...langTexts }, speaker: speaker || null };
        session.items.push(item);
      }
      if (session.title === '새 세션' && session.items.length === 1) {
        const first = Object.values(item.texts)[0] || '';
        if (first) session.title = first.slice(0, 40);
      }
      session.updatedAt = Date.now();
      saveSessions();
    } else {
      item = { id, side, source: source || null, texts: { ...langTexts } };
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  if (pipeline === 'translate') runTranslate();
  else if (pipeline === 'deepgram') runDeepgram();
  else if (pipeline === 'soniox') runSoniox();
  else if (pipeline === 'desk') runDesk();
  else runWhisper();

  /* ---------- Soniox stt-rt-v5 (전사) -> gpt 번역 [테스트] ---------- */
  function runSoniox() {
    if (!SONIOX_API_KEY) {
      toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — soniox 모드 사용 불가' });
      return;
    }
    const SX_MAX_CHARS = 200; // endpoint 안 잡혀도 이 길이에서 강제 확정(폭주 방지)
    // 엔드포인트 튜닝(테스트용, UI에서 선택). 문서 기본값: sensitivity 0, maxDelay 2000, latency 0.
    const sens = Number(ws._sxSens);
    const maxDelay = Number(ws._sxMaxDelay);
    const latency = Number(ws._sxLatency);
    // Soniox 자체 실시간 번역(기본). GPT 경유 없이 전사+번역 토큰을 한 스트림으로 받음.
    //  단방향(one): 타깃 1개 / 양방향(two): A↔B. 지원 언어 ko/en/ja/zh 로 한정.
    const L4 = ['ko', 'en', 'ja', 'zh'];
    const okL = (c) => L4.includes(c);
    const sxMode = ws._sxMode === 'two' ? 'two' : 'one';
    const sxTarget = okL(ws._sxTarget) ? ws._sxTarget : 'en';
    const sxA = okL(ws._sxA) ? ws._sxA : 'ko';
    const sxB = okL(ws._sxB) ? ws._sxB : 'en';
    const ttsOn = ws._tts === '1' && !!CARTESIA_API_KEY; // 확정 문장마다 Cartesia TTS 음성 출력
    const gender = ws._gender === 'm' ? 'm' : 'f'; // 음성 성별(출력언어별 보이스 자동 선택)
    const diar = ws._diar === '1'; // 화자 구분(speaker diarization)
    if (ws._tts === '1' && !CARTESIA_API_KEY) {
      toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 출력(TTS) 비활성. 서버 환경변수를 확인하세요.' });
    }
    const config = {
      api_key: SONIOX_API_KEY,
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
      language_hints: sxMode === 'two' ? [sxA, sxB] : (inLang ? [inLang] : L4),
      translation: sxMode === 'two'
        ? { type: 'two_way', language_a: sxA, language_b: sxB }
        : { type: 'one_way', target_language: sxTarget },
      ...(buildSonioxContext() ? { context: buildSonioxContext() } : {}), // 고유명사/번역 설정 주입
    };

    const sx = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
    idleClose = () => { try { sx.close(); } catch {} };
    let sxReady = false;
    const pending = [];
    const langsOut = sxMode === 'two' ? [sxA, sxB] : [sxTarget];
    // 폰 PTT 가 재사용할 호스트 설정 저장
    roomCfg.set(sessionId, { sxMode, sxTarget, sxA, sxB, sens: config.endpoint_sensitivity, maxDelay: config.max_endpoint_delay_ms, latency: config.endpoint_latency_adjustment_level, ttsOn, gender });
    // 번역 방향 정보 — 뷰어(모바일)가 언어 표시에 사용
    const sxInfo = { mode: sxMode, target: sxTarget, a: sxA, b: sxB };
    if (session) { session.sxInfo = sxInfo; saveSessions(); }
    broadcast(sessionId, { type: 'meta', sxInfo });
    let curId = null;     // 진행 중 발화 카드 id
    let finalText = '';   // 전사(원문) 확정 누적
    let finalTrans = '';  // Soniox 번역(타깃) 확정 누적
    let lastTrans = '';   // 마지막으로 표시한 번역(폴백용)
    let curSrc = '';      // 감지된 입력 언어
    let curSpeaker = '';  // 현재 발화 화자(diarization)
    let lastCommitText = ''; // 직전 확정 텍스트(연속 중복 카드 방지)
    let sawSpeaker = false;  // 엔진이 화자 정보를 한 번이라도 반환했는지(진단용)
    let spkNotified = false; // 화자 감지 1회 알림
    let noSpkWarned = false; // 화자 미반환 1회 경고

    const targetKeyFor = (src) => (sxMode === 'two' ? (src === sxA ? sxB : sxA) : sxTarget);
    const spkLabel = (s) => (s != null && s !== '' ? String(s) : null); // 화자 번호만 전송(표시는 클라가 아이콘+번호)

    // ---- 실시간 TTS: 확정된 번역을 문장 단위로 잘라 즉시 합성(발화가 끝나기 전에도 흘려보냄) ----
    let ttsPending = '';      // 확정됐지만 아직 합성하지 않은 번역 텍스트
    let ttsLang = sxTarget;   // 현재 합성 언어(타깃)
    const SENT_END = /[.!?。！？…]/;
    // 마침표가 문장 끝이 아닌 약어들(영어 타깃에서 오탐 방지)
    const ABBR = new Set(['mr','mrs','ms','dr','prof','sr','jr','st','vs','etc','inc','ltd','co','corp','no','vol','fig','dept','univ','gov','gen','col','sgt','lt','capt','cmdr','rev','hon','pres','approx','mt','ave','rd','blvd','ph','messrs']);
    // 합성을 순차 직렬화: 짧은 뒷문장이 먼저 합성 완료돼 먼저 재생되는 순서 뒤바뀜 방지
    let ttsChain = Promise.resolve();
    const speakTts = (text) => {
      const tx = (text || '').trim();
      if (!ttsOn || !tx) return;
      if (!/[\p{L}\p{N}]/u.test(tx)) return; // 문장부호만 있으면 스킵(Cartesia 400 방지)
      const lang = ttsLang;                  // 호출 시점 타깃 언어 고정
      const voiceId = cartesiaVoiceId(lang, gender);
      ttsChain = ttsChain.then(() => cartesiaTTSStream(tx, voiceId, lang, (b64) => { broadcastAudio(sessionId, b64); }).catch(() => {}));
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
      for (const s of out) speakTts(s);
    };

    // 현재 누적분을 한 문장으로 확정 (GPT 호출 없음)
    const commit = () => {
      const id = curId, txt = finalText.trim(), src = curSrc, spk = curSpeaker;
      const tgt = (finalTrans.trim() || lastTrans).trim();
      const tail = ttsPending;            // 종결부호 없이 남은 마지막 조각
      const hadFinal = !!finalTrans.trim(); // 발화 중 확정 번역이 흘러갔는지
      curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; curSpeaker = ''; ttsPending = '';
      // 화자 구분 켰는데 엔진이 화자 정보를 한 번도 안 줬으면 1회 안내(진단)
      if (diar && !sawSpeaker && !noSpkWarned) { noSpkWarned = true; toHost({ type: 'status', message: '화자 구분: 엔진이 화자 정보를 반환하지 않음(번역/엔드포인트와 동시 사용 시 발생 가능)' }); }
      if (!id || !txt) return;
      const out = tgt || txt;
      // 직전 카드와 완전히 동일한 내용이면 중복으로 보고 스킵(반복/에코 방지)
      if (out && out === lastCommitText) return;
      lastCommitText = out;
      const target = targetKeyFor(src);
      upsertItem(id, { [target]: out }, txt, spkLabel(spk));
      // 실시간 TTS: 발화 중 문장 단위로 이미 흘려보냈고, 여기선 남은 꼬리만 합성.
      //  호스트(시스템 오디오 캡처) 스피커로는 재생하지 않음 → TTS 재캡처 피드백 루프 원천 차단.
      if (ttsOn) {
        ttsLang = target;
        const tl = tail.trim();
        if (tl) speakTts(tl);                       // 종결부호 없이 남은 번역 꼬리
        else if (!hadFinal) speakTts(out);          // 발화 중 합성된 게 없으면(번역 미확정) 전체 합성
      }
    };

    sx.on('open', () => {
      try { sx.send(JSON.stringify(config)); } catch {} // config 먼저
      sxReady = true;
      while (pending.length) sx.send(pending.shift());
      toHost({ type: 'status', message: `엔진 연결됨 (Soniox stt-rt-v5 · ${sxMode === 'two' ? `양방향 ${sxA}↔${sxB}` : `단방향→${sxTarget}`}${ttsOn ? ' · TTS on' : ''}, sens=${config.endpoint_sensitivity}, maxDelay=${config.max_endpoint_delay_ms}ms, lat=${config.endpoint_latency_adjustment_level})` });
      // TTS 연결 워밍업 + 키/보이스 검증(첫 음성 지연 단축)
      if (ttsOn) {
        const wLang = sxMode === 'two' ? 'ko' : sxTarget;
        cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then((r) => toHost({ type: 'status', message: r.ok ? '음성(Cartesia) 준비됨' : ('음성 준비 실패: ' + r.error) }));
      }
      bumpIdle();
    });
    sx.on('message', (raw) => {
      let ev;
      try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
      const toks = ev.tokens || [];
      if (!toks.length) return;
      bumpIdle();
      let endHit = false;
      let nonFinal = '';      // 비확정 전사(원문) — 매 응답마다 새로 구성
      let nonFinalTrans = ''; // 비확정 번역(타깃)
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        // 화자 정보는 원문/번역 토큰 어디서 와도 캡처(진단 + 표시용)
        if (diar && t.speaker != null && t.speaker !== '') {
          sawSpeaker = true;
          if (!spkNotified) { spkNotified = true; toHost({ type: 'status', message: '화자 구분 활성 — 화자 ' + t.speaker + ' 감지됨' }); }
        }
        if (t.translation_status === 'translation') {
          if (t.is_final) {
            finalTrans += t.text;
            ttsLang = targetKeyFor(curSrc); // 현재 타깃 언어로 합성
            ttsPending += t.text;           // 문장 단위 실시간 TTS 큐
          } else nonFinalTrans += t.text;
        } else {
          // 전사(원문) 토큰 (translation_status: none | original | undefined)
          if (t.language && !curSrc) curSrc = String(t.language).split('-')[0].toLowerCase();
          // 화자 변경 시: 누적된 발화가 있으면 먼저 확정하고 새 화자로 시작
          if (diar && t.speaker != null && t.speaker !== '' && t.is_final && curSpeaker && String(t.speaker) !== String(curSpeaker) && finalText.trim()) commit();
          if (diar && t.speaker != null && t.speaker !== '') curSpeaker = t.speaker;
          if (t.is_final) finalText += t.text;
          else nonFinal += t.text;
        }
      }
      flushTtsSentences(); // 완성된 문장은 즉시 합성(발화 종료 기다리지 않음)
      const shownSrc = (finalText + nonFinal).trim();
      const shownTgt = (finalTrans + nonFinalTrans).trim();
      if (shownTgt) lastTrans = shownTgt;
      if (!curId && (shownSrc || shownTgt)) curId = newId();
      if (curId) {
        // 타깃=번역(주 텍스트), 원문은 source 로 동시 표시
        liveSend(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null, spkLabel(curSpeaker));
      }
      // 발화 종료(<end>) 또는 과도하게 길면 확정
      if (endHit || finalText.length >= SX_MAX_CHARS) commit();
    });
    sx.on('error', (e) => toHost({ type: 'status', message: 'Soniox 오류: ' + (e && e.message || e) }));
    sx.on('close', () => toHost({ type: 'status', message: '엔진 연결 종료 (Soniox)' }));

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (sxReady) sx.send(data);
        else pending.push(data);
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') {
          try { sx.send(''); } catch {} // 빈 프레임 = graceful end
          try { sx.close(); } catch {}
        }
      } catch {}
    });
    ws.on('close', () => { try { sx.close(); } catch {} });
  }

  /* ---------- 데스크 안내 모드: 언어 자동감지(detect) → soniox two_way(ko↔X) ----------
     · A=ko 고정. 외국어 첫 발화가 끝나면(endpoint) 그 언어로 lock 후 양방향 재연결.
     · 외국어 무음 deskIdleMs(기본 7초) → 대화 종료: items 를 deskLog 에 보존하고 화면 리셋 → 다시 감지 모드.
     · TTS/화자분리 없음. 클라(호스트=ko / 뷰어=X)는 source+texts+meta(sxInfo)로 색/표시 결정. */
  function runDesk() {
    if (!SONIOX_API_KEY) { toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — 데스크 모드 사용 불가' }); return; }
    const SX_MAX_CHARS = 200;
    const sens = Number(ws._sxSens), maxDelay = Number(ws._sxMaxDelay), latency = Number(ws._sxLatency);
    const A = 'ko'; // 안내원 언어(고정)
    // soniox two_way 지원 + 취항국 후보(몽골·광둥 미지원이라 제외). ws._deskLangs(콤마구분)로 덮어쓰기.
    const SUPPORTED = ['en', 'ja', 'zh', 'vi', 'th', 'tl', 'id', 'ru', 'ms'];
    let CAND = SUPPORTED;
    if (ws._deskLangs) {
      const f = String(ws._deskLangs).split(',').map((s) => s.trim().toLowerCase()).filter((c) => SUPPORTED.includes(c));
      if (f.length) CAND = f;
    }
    const deskIdleMs = Math.min(60000, Math.max(2000, Number(ws._deskIdle) || 7000)); // 외국어 무음 → 리셋

    let phase = 'detect';   // 'detect' | 'locked'
    let lockedB = null;
    let sx = null, sxReady = false;
    let closed = false;     // 호스트 중지/종료 — 자동 재연결 금지 플래그
    const pending = [];
    let foreignTimer = null;

    const baseConfig = () => ({
      api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      enable_language_identification: true, enable_endpoint_detection: true,
      endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
      max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
      endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
      ...(buildSonioxContext() ? { context: buildSonioxContext() } : {}),
    });
    const configFor = () => (phase === 'locked' && lockedB
      ? { ...baseConfig(), language_hints: [A, lockedB], translation: { type: 'two_way', language_a: A, language_b: lockedB } }
      : { ...baseConfig(), language_hints: [A, ...CAND], translation: { type: 'one_way', target_language: A } });

    const setMeta = () => {
      const sxInfo = phase === 'locked' && lockedB ? { mode: 'two', a: A, b: lockedB } : { mode: 'one', target: A, detect: true };
      if (session) { session.sxInfo = sxInfo; if (phase === 'locked') session.langs = [A, lockedB]; saveSessions(); }
      broadcast(sessionId, { type: 'meta', sxInfo });
      toHost({ type: 'meta', sxInfo });
    };

    let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommitText = '';
    const targetKeyFor = (src) => (phase === 'locked' ? (src === A ? lockedB : A) : A);
    const resetUtterance = () => { curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; };

    const commit = () => {
      const id = curId, txt = finalText.trim(), src = curSrc;
      const tgt = (finalTrans.trim() || lastTrans).trim();
      resetUtterance();
      if (!id || !txt) return;
      const out = tgt || txt;
      if (out && out === lastCommitText) return;
      lastCommitText = out;
      upsertItem(id, { [targetKeyFor(src)]: out }, txt, null);
      // 길안내: 외국인 발화(→한국어 번역 out)에서 시설 질문 감지 → 목적지 전송
      if (src && src !== A) {
        try {
          const wf = resolveWayfind(out, (session && session.deskFloor) || '1F');
          if (wf && wf.dests && wf.dests.length) {
            const msg = { type: 'wayfind', category: wf.category, ko: wf.ko, floor: wf.floor, sameFloor: wf.sameFloor, dests: wf.dests, deskFloor: (session && session.deskFloor) || '1F', deskSide: (session && session.deskSide) || 'S' };
            broadcast(sessionId, msg); toHost(msg);
          }
        } catch {}
      }
    };

    // 무음 자동종료: 발화가 들릴 때마다 리셋 → deskIdleMs 동안 '아무 말도' 없으면 대화 종료(다음 손님)
    const armForeignTimer = () => {
      clearTimeout(foreignTimer);
      foreignTimer = setTimeout(() => { if (phase === 'locked') endConversation(); }, deskIdleMs);
    };
    const endConversation = () => {
      clearTimeout(foreignTimer);
      commit();
      if (session) {
        if (Array.isArray(session.items) && session.items.length) {
          session.deskLog = session.deskLog || [];
          session.deskLog.push({ endedAt: Date.now(), lang: lockedB, items: session.items });
          if (session.deskLog.length > 200) session.deskLog = session.deskLog.slice(-200); // 보존 상한
          session.items = [];
        }
        saveSessions();
      }
      lastCommitText = '';
      phase = 'detect'; lockedB = null; resetUtterance();
      broadcast(sessionId, { type: 'desk-reset' });
      toHost({ type: 'desk-reset' });
      broadcast(sessionId, { type: 'snapshot', items: [] });
      setMeta();
      toHost({ type: 'status', message: '대화 종료 — 다음 손님 대기(언어 감지 모드)' });
      reconnect();
    };

    const relock = (B) => { // 첫 외국어 발화 확정 후 호출(해당 발화는 이미 commit 됨)
      phase = 'locked'; lockedB = B; lastCommitText = ''; resetUtterance();
      setMeta();
      armForeignTimer();
      toHost({ type: 'status', message: `언어 감지: ${B} — 양방향 통역 시작 (ko↔${B})` });
      reconnect();
    };

    function reconnect() {
      if (closed) return;
      const old = sx;
      sxReady = false;
      const next = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
      sx = next;
      idleClose = () => { try { next.close(); } catch {} };
      next.on('open', () => {
        try { next.send(JSON.stringify(configFor())); } catch {}
        sxReady = true;
        while (pending.length) { try { next.send(pending.shift()); } catch {} }
      });
      next.on('message', onSxMessage);
      next.on('error', (e) => toHost({ type: 'status', message: 'Soniox 오류: ' + ((e && e.message) || e) }));
      // 현재 활성 연결이 예기치 않게 끊기면(중지/유휴 아님) 자동 재연결 — 녹음 중 멈춤 방지
      next.on('close', () => {
        if (sx === next && !closed && !idleStopped) {
          toHost({ type: 'status', message: '엔진 재연결 중…' });
          setTimeout(() => { if (sx === next && !closed && !idleStopped) reconnect(); }, 800);
        }
      });
      try { if (old && old !== next) old.close(); } catch {}
    }

    function onSxMessage(raw) {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
      const toks = ev.tokens || [];
      if (!toks.length) return;
      bumpIdle();
      if (phase === 'locked') armForeignTimer(); // 어떤 발화든(안내원 한국어 포함) 들리면 무음 타이머 리셋
      let endHit = false, nonFinal = '', nonFinalTrans = '';
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        if (t.translation_status === 'translation') {
          if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text;
        } else {
          const lang = t.language ? String(t.language).split('-')[0].toLowerCase() : '';
          if (lang && !curSrc) curSrc = lang;
          if (t.is_final) finalText += t.text; else nonFinal += t.text;
        }
      }
      const shownSrc = (finalText + nonFinal).trim();
      const shownTgt = (finalTrans + nonFinalTrans).trim();
      if (shownTgt) lastTrans = shownTgt;
      if (!curId && (shownSrc || shownTgt)) curId = newId();
      if (curId) liveSend(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null, null);
      if (endHit || finalText.length >= SX_MAX_CHARS) {
        const src = curSrc;
        commit();
        // 감지 모드: 외국어 발화가 한 문장 끝나면 그 언어로 lock(한국어는 통과만, lock 안 함)
        if (phase === 'detect' && src && src !== A && CAND.includes(src)) relock(src);
      }
    }

    ws.on('message', (data, isBinary) => {
      if (isBinary) { if (sxReady && sx) { try { sx.send(data); } catch {} } else if (pending.length < 2000) pending.push(data); return; }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') { closed = true; try { sx && sx.send(''); } catch {} try { sx && sx.close(); } catch {} }
      } catch {}
    });
    ws.on('close', () => { closed = true; clearTimeout(foreignTimer); try { sx && sx.close(); } catch {} });

    setMeta();
    reconnect();
    toHost({ type: 'status', message: `데스크 모드 — 언어 감지 대기 (후보: ${CAND.join(', ')}, 무음 ${deskIdleMs / 1000}s 리셋)` });
  }

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
          translateText(txt, lang, true, [], refineModel)
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
        const { translation, remainder } = await segmentTranslate(input, ctx, force, targetLang, polish, refineModel);
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
              translateText(consumed, lang, polish, undefined, refineModel).then((t) => {
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
