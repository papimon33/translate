import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { detectCategory, isLocationAnswer, parseAnswerFloor, CATEGORIES } from './wayfind_dict.js';
import { b32encode, totpVerify, deriveDataKey, encryptData, decryptData, echoNorm, echoMatch } from './security_util.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 모델은 코드 고정(환경변수로 안 받음). 바꾸려면 여기서 직접 수정.
const TRANSLATE_MODEL = 'gpt-realtime-translate';
const REFINE_MODEL = 'gpt-5-nano';
const TARGET_LANG = process.env.TARGET_LANG || 'ko';
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || ''; // Nova-3 테스트 모드(선택)
const SONIOX_API_KEY = process.env.SONIOX_API_KEY || ''; // Soniox stt-rt-v5 테스트 모드(선택)
// Soniox stt-rt-v5 지원 언어(60) — 번역은 지원 언어 임의 쌍. 선택 UI/검증에 사용.
const SONIOX_LANGS = ['af','sq','ar','az','eu','be','bn','bs','bg','ca','zh','hr','cs','da','nl','en','et','fi','fr','gl','de','el','gu','he','hi','hu','id','it','ja','kn','kk','ko','lv','lt','mk','ms','ml','mr','no','fa','pl','pt','pa','ro','ru','sr','sk','sl','es','sw','sv','tl','ta','te','th','tr','uk','ur','vi','cy'];
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
const STATIC_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(STATIC_DIR)) {
  console.warn('\n[경고] dist 폴더가 없습니다. 먼저 `npm run build` 를 실행하세요. (npm start 는 자동 빌드)\n');
}
app.use(express.static(STATIC_DIR));
// 2.5D 맵 라이브러리/데이터/아이콘 — 데스크 뷰어 길안내용
app.use('/map', express.static(new URL('./map/', import.meta.url).pathname));

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

/* ---- 저장 데이터 암호화(파일 모드): DATA_KEY 설정 시 AES-256-GCM ----
   DATA_KEY(임의의 긴 문자열)를 scrypt 로 32바이트 키로 파생해 data/*.json 을 암호화 저장.
   기존 평문 파일은 그대로 읽히고, 다음 저장부터 암호문으로 바뀐다(점진 마이그레이션).
   Mongo 사용 시에는 Atlas 저장소 암호화(기본 제공)를 사용 — SECURITY_GUIDE.md 참고. */
const DATA_KEY_RAW = process.env.DATA_KEY || '';
const dataKey = DATA_KEY_RAW ? deriveDataKey(DATA_KEY_RAW) : null;
function writeDataFile(file, jsonStr) {
  // 원자적 쓰기(임시파일 → rename): 저장 도중 프로세스가 죽어도 기존 파일이 온전히 남는다.
  // (직접 덮어쓰면 반쯤 쓰인 파일이 다음 부팅에서 파싱 실패 → 세션/사용자 전체가 조용히 초기화됨)
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, dataKey ? encryptData(dataKey, jsonStr) : jsonStr);
  fs.renameSync(tmp, file);
}
function readDataFile(file) {
  return decryptData(dataKey, fs.readFileSync(file, 'utf8')); // 평문(기존 데이터)은 그대로 — 다음 저장 시 암호화됨
}

const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const USAGE_HOURLY_FILE = path.join(DATA_DIR, 'usage_hourly.json');
const TERMS_FILE = path.join(DATA_DIR, 'terms_config.json'); // 고유명사/번역 설정(전역, Soniox context)
const SUMMARIES_FILE = path.join(DATA_DIR, 'summaries.json');
const VENDOR_USAGE_FILE = path.join(DATA_DIR, 'vendor_usage.json'); // 벤더 실사용량 일별 누적(무기한 보관)
const FAQ_FILE = path.join(DATA_DIR, 'faq_report.json');   // 자주 묻는 질문 분석 결과(관리자, GPT 클러스터링)
const CANNED_FILE = path.join(DATA_DIR, 'canned.json');    // 정형 안내 멘트(원터치 재생용 문안)
const MONGODB_URI = process.env.MONGODB_URI;                       // 있으면 Mongo, 없으면 로컬 파일
const MONGODB_DB = process.env.MONGODB_DB || 'kac_translator';     // DB 이름(앱이 자동 생성). 코드 기본값.

let sessions = [];  // 메모리 캐시(항상 진실의 원천)
let users = [];     // 생성된 사용자 { id, username, salt, hash, role, createdAt, usageMs }
let usageDaily = {}; // { 'YYYY-MM-DD': { whisperMs, translateMs } } — 파이프라인별 사용시간 일별 집계
let usageHourly = {}; // { 'YYYY-MM-DDTHH': { whisperMs, translateMs } } — 시간대별 집계(UTC)
// 벤더 실사용량 일별 누적 — 벤더 API 는 조회 보관기간(예: Soniox 91일)이 있어 그 뒤엔 못 꺼내므로
// 여기 계속 쌓아 무기한 보관한다. { soniox:{date:{audioMs,costUsd,requests}}, cartesia:{date:{credits}}, openai:{date:{costUsd}} }
let vendorUsage = { soniox: {}, cartesia: {}, openai: {} };
// 전역 고유명사/번역 설정 — 세션(Soniox) 연결 시 context로 주입. 관리자만 수정, 전원 열람.
let termsConfig = { version: 3, servedLangs: [], categoryScope: {}, entries: [], updatedAt: 0 };
let summaries = []; // [{ id, sessionId, owner, title, createdAt, updatedAt, status, summary, error }]
let faqReport = null; // { at, checked, topics:[{topic,count,examples[]}] } — 자주 묻는 질문 분석 결과
let cannedConfig = { items: [] }; // 정형 안내 멘트 [{ id, title, texts:{ko,en,ja,zh} }]
let col = null;     // Mongo sessions 컬렉션. null 이면 파일 모드.
let usersCol = null;
let usageCol = null;
let usageHourlyCol = null;
let termsConfigCol = null;
let summariesCol = null;
let vendorUsageCol = null;
let faqCol = null;
let cannedCol = null;

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
        vendorUsageCol = db.collection('vendorUsage');
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
        if (tc) { const { _id, ...rest } = tc; termsConfig = { ...rest, updatedAt: tc.updatedAt || 0 }; } // 전체 보존(entries/servedLangs/categoryScope), 구형은 부팅 마이그레이션
        const vu = await vendorUsageCol.findOne({ _id: 'singleton' });
        if (vu) vendorUsage = { soniox: vu.soniox || {}, cartesia: vu.cartesia || {}, openai: vu.openai || {} };
        faqCol = db.collection('faqReport');
        cannedCol = db.collection('canned');
        const fr = await faqCol.findOne({ _id: 'singleton' });
        if (fr) { const { _id, ...rest } = fr; faqReport = rest; }
        const cn = await cannedCol.findOne({ _id: 'singleton' });
        if (cn && Array.isArray(cn.items)) cannedConfig = { items: cn.items };
        summaries = await summariesCol.find({}, { projection: { _id: 0 } }).toArray();
        console.log(`[store] MongoDB 연결됨 — 세션 ${sessions.length} / 사용자 ${users.length}`);
        return;
      } catch (e) {
        console.error(`[store] MongoDB 연결 실패 (시도 ${attempt}/3): ${e.message}`);
        col = usersCol = usageCol = usageHourlyCol = termsConfigCol = summariesCol = vendorUsageCol = faqCol = cannedCol = null;
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
      sessions = JSON.parse(readDataFile(DATA_FILE));
      if (!Array.isArray(sessions)) sessions = [];
    }
    if (fs.existsSync(USERS_FILE)) {
      users = JSON.parse(readDataFile(USERS_FILE));
      if (!Array.isArray(users)) users = [];
    }
    if (fs.existsSync(USAGE_FILE)) {
      const u = JSON.parse(readDataFile(USAGE_FILE));
      if (u && typeof u === 'object') usageDaily = u;
    }
    if (fs.existsSync(USAGE_HOURLY_FILE)) {
      const h = JSON.parse(readDataFile(USAGE_HOURLY_FILE));
      if (h && typeof h === 'object') usageHourly = h;
    }
    if (fs.existsSync(TERMS_FILE)) {
      const t = JSON.parse(readDataFile(TERMS_FILE));
      if (t && typeof t === 'object') termsConfig = { ...t, updatedAt: t.updatedAt || 0 }; // 전체 보존, 구형은 부팅 마이그레이션
    }
    if (fs.existsSync(SUMMARIES_FILE)) {
      const s = JSON.parse(readDataFile(SUMMARIES_FILE));
      if (Array.isArray(s)) summaries = s;
    }
    if (fs.existsSync(VENDOR_USAGE_FILE)) {
      const v = JSON.parse(readDataFile(VENDOR_USAGE_FILE));
      if (v && typeof v === 'object') vendorUsage = { soniox: v.soniox || {}, cartesia: v.cartesia || {}, openai: v.openai || {} };
    }
    if (fs.existsSync(FAQ_FILE)) {
      const f = JSON.parse(readDataFile(FAQ_FILE));
      if (f && typeof f === 'object') faqReport = f;
    }
    if (fs.existsSync(CANNED_FILE)) {
      const c = JSON.parse(readDataFile(CANNED_FILE));
      if (c && Array.isArray(c.items)) cannedConfig = { items: c.items };
    }
  } catch (e) {
    console.error('[store] 로드 실패', e);
  }
}
async function persistVendorUsage() {
  if (vendorUsageCol) { await vendorUsageCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...vendorUsage }, { upsert: true }); }
  else { writeDataFile(VENDOR_USAGE_FILE, JSON.stringify(vendorUsage, null, 2)); }
}
async function persistFaqReport() {
  if (faqCol) { await faqCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...faqReport }, { upsert: true }); }
  else { writeDataFile(FAQ_FILE, JSON.stringify(faqReport, null, 2)); }
}
async function persistCanned() {
  if (cannedCol) { await cannedCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...cannedConfig }, { upsert: true }); }
  else { writeDataFile(CANNED_FILE, JSON.stringify(cannedConfig, null, 2)); }
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
    writeDataFile(DATA_FILE, JSON.stringify(sessions, null, 2));
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
    writeDataFile(USERS_FILE, JSON.stringify(users, null, 2));
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
  // 요금 버킷 분류: 실시간 통역 계열(translate·soniox·desk)은 translate 단가, 다국어 전사 계열은 whisper 단가
  if (pipeline === 'translate' || pipeline === 'soniox' || pipeline === 'desk') { d.translateMs += ms; h.translateMs += ms; }
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
    writeDataFile(USAGE_FILE, JSON.stringify(usageDaily, null, 2));
    writeDataFile(USAGE_HOURLY_FILE, JSON.stringify(usageHourly, null, 2));
  }
}

/* ---- 고유명사/번역설정 스키마 ----
   terms: { airline: string[], aviation: string[], etc: string[] } — 카테고리별 인식(STT) 힌트.
   translationTerms: [{ ko, en?, ja?, zh?, es?, fr?, pt?, ar? }] — 한 행 = 한 용어의 다국어 표기.
     세션 연결 시 활성 언어쌍의 표기만 골라 Soniox context 로 조립(비면 en → ko 폴백).
   구형(terms 배열 / {source,target} 쌍)은 로드·저장 시 자동 마이그레이션. */
const TERM_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'pt', 'ar'];
const TERM_CATEGORIES = ['airline', 'aviation', 'facility', 'etc']; // 항공사·항공용어·시설·기타
const DEFAULT_SERVED_LANGS = ['ko', 'en', 'ja', 'zh'];         // 필수 입력 대상(운영 언어) — 관리자가 변경
// 카테고리별 적용 대상: 데스크(손님 응대)엔 항공용어 불필요(예산 낭비) → 기본 제외
const DEFAULT_CATEGORY_SCOPE = {
  airline:  { desk: true,  session: true },
  aviation: { desk: false, session: true },
  facility: { desk: true,  session: true },
  etc:      { desk: true,  session: true },
};

// ── 통합 용어 모델(v3) ──
// termsConfig = { version:3, servedLangs, categoryScope, entries:[], updatedAt }
// entry = { id, category, scope:['*']|['zh',...], names:{ko(필수),en,ja,...}, mode }
//   mode 'pair'      : 활성 언어쌍 양방향 번역 + 인식
//   mode 'inputOnly' : 외국어 표기 → 한국어 단방향 번역 + 인식 (약칭·오인식 교정)
//   mode 'recognize' : 언어무관 인식 힌트만(번역쌍 없음) — 약어·고유명사(예: ICAO)
// scope: '*' 아니면 그 언어 세션에만 주입되고, 그 언어만 필수.

// 기본 시드(KAC 항공 도메인) — 저장된 설정이 없을 때만 1회 주입
const DEFAULT_TERMS_AVIATION = ['ICAO','IATA','FAA','KAC','IIAC','FIDS','CIQ','BHS','NOTAM','PBB','VDGS','FOD','A-CDM','MRO','ILS','AWOS','SCADA','AODB','EIRP','FIS','ASDE','BMS','AVSM'];
// 취항 항공사 다국어 표기 — es/fr/pt/ar 는 통상 영문 명칭을 쓰므로 비워 두면 en 으로 폴백된다.
// alt = 현지에서 통용되는 축약/구어 표기(언어별 배열). 인식(terms) 힌트로 쓰이고,
//        "축약형 → 한국어 정식명" 단방향 번역으로도 강제된다(예: 国航 → 중국국제항공).
// (파라타/섬에어 등 신생 항공사의 외국어 표기 일부는 미확정 — 원어민 검수 권장)
const DEFAULT_AIRLINES = [
  { ko: '대한항공', en: 'Korean Air', ja: '大韓航空', zh: '大韩航空' },
  { ko: '아시아나항공', en: 'Asiana Airlines', ja: 'アシアナ航空', zh: '韩亚航空' },
  { ko: '제주항공', en: 'Jeju Air', ja: 'チェジュ航空', zh: '济州航空' },
  { ko: '진에어', en: 'Jin Air', ja: 'ジンエアー', zh: '真航空' },
  { ko: '티웨이항공', en: "T'way Air", ja: 'ティーウェイ航空', zh: '德威航空' },
  { ko: '에어부산', en: 'Air Busan', ja: 'エアプサン', zh: '釜山航空' },
  { ko: '이스타항공', en: 'Eastar Jet', ja: 'イースター航空', zh: '易斯达航空' },
  { ko: '에어서울', en: 'Air Seoul', ja: 'エアソウル', zh: '首尔航空' },
  { ko: '에어로케이', en: 'Aero K', ja: 'エアロK' },
  { ko: '파라타항공', en: 'Parata Air', ja: 'パラタ航空', zh: '帕拉塔航空' }, // ja/zh 는 잠정 음역 — 검수 필요
  { ko: '섬에어' },
  { ko: '일본항공', en: 'Japan Airlines', ja: '日本航空', zh: '日本航空', alt: { ja: ['日航', 'JAL'] } },
  { ko: '전일본공수', en: 'All Nippon Airways', ja: '全日本空輸', zh: '全日空', alt: { ja: ['全日空', 'ANA'] } },
  { ko: '피치항공', en: 'Peach Aviation', ja: 'ピーチ・アビエーション', zh: '乐桃航空', alt: { ja: ['ピーチ'] } },
  { ko: '중국국제항공', en: 'Air China', ja: '中国国際航空', zh: '中国国际航空', alt: { zh: ['国航'] } },
  { ko: '중국남방항공', en: 'China Southern Airlines', ja: '中国南方航空', zh: '中国南方航空', alt: { zh: ['南航'] } },
  { ko: '중국동방항공', en: 'China Eastern Airlines', ja: '中国東方航空', zh: '中国东方航空', alt: { zh: ['东航'] } },
  { ko: '상하이항공', en: 'Shanghai Airlines', ja: '上海航空', zh: '上海航空', alt: { zh: ['上航'] } },
  { ko: '길상항공', en: 'Juneyao Air', ja: '吉祥航空', zh: '吉祥航空', alt: { zh: ['吉祥'] } },
  { ko: '춘추항공', en: 'Spring Airlines', ja: '春秋航空', zh: '春秋航空', alt: { zh: ['春秋'] } },
  { ko: '사천항공', en: 'Sichuan Airlines', ja: '四川航空', zh: '四川航空', alt: { zh: ['川航'] } },
  { ko: '하문항공', en: 'XiamenAir', ja: '厦門航空', zh: '厦门航空', alt: { zh: ['厦航'] } },
  { ko: '중화항공', en: 'China Airlines', ja: 'チャイナエアライン', zh: '中华航空' },
  { ko: '에바항공', en: 'EVA Air', ja: 'エバー航空', zh: '长荣航空' },
  { ko: '타이거에어 타이완', en: 'Tigerair Taiwan', ja: 'タイガーエア台湾', zh: '台湾虎航' },
  { ko: '캐세이퍼시픽항공', en: 'Cathay Pacific', ja: 'キャセイパシフィック航空', zh: '国泰航空' },
  { ko: '홍콩익스프레스', en: 'HK Express', ja: '香港エクスプレス', zh: '香港快运航空' },
  { ko: '마카오항공', en: 'Air Macau', ja: 'マカオ航空', zh: '澳门航空' },
  { ko: '베트남항공', en: 'Vietnam Airlines', ja: 'ベトナム航空', zh: '越南航空' },
  { ko: '비엣젯항공', en: 'VietJet Air', ja: 'ベトジェットエア', zh: '越捷航空' },
  { ko: '필리핀항공', en: 'Philippine Airlines', ja: 'フィリピン航空', zh: '菲律宾航空' },
  { ko: '세부퍼시픽', en: 'Cebu Pacific', ja: 'セブパシフィック航空', zh: '宿务太平洋航空' },
  { ko: '타이에어아시아엑스', en: 'Thai AirAsia X', ja: 'タイ・エアアジアX' },
  { ko: '몽골항공', en: 'MIAT Mongolian Airlines', ja: 'MIATモンゴル航空', zh: '蒙古航空' },
  { ko: '미아트 몽골항공', en: 'MIAT Mongolian Airlines', ja: 'MIATモンゴル航空', zh: '蒙古航空' },
  { ko: '싱가포르항공', en: 'Singapore Airlines', ja: 'シンガポール航空', zh: '新加坡航空' },
];
const DEFAULT_TRANSLATION_TERMS = [
  { ko: '주기장', en: 'apron' }, { ko: '램프', en: 'ramp' }, { ko: '슬롯', en: 'slot' },
  { ko: '터미널', en: 'terminal' }, { ko: '탑승구', en: 'gate' }, { ko: '항공기 유도', en: 'marshalling' },
  { ko: '토잉', en: 'towing' }, { ko: '토잉카', en: 'towing car' }, { ko: '푸시백', en: 'pushback' },
  { ko: '허브 공항', en: 'hub' }, { ko: '커브사이드', en: 'curbside' }, { ko: '랜드사이드', en: 'landside' },
  { ko: '에어사이드', en: 'airside' }, { ko: '수하물 수취대', en: 'baggage claim' }, { ko: '방빙유지시간', en: 'holdover time' },
  { ko: '제빙 작업', en: 'de-icing' }, { ko: '지상 활주', en: 'taxing' }, { ko: '유도로', en: 'taxiway' },
  { ko: '활주로', en: 'runway' }, { ko: '주기장 번호', en: 'stand' }, { ko: '보안검색', en: 'screening' },
  { ko: '촉수검색', en: 'pat-down' }, { ko: '회항', en: 'diversion' }, { ko: '체크인', en: 'check-in' },
  { ko: '탑승동', en: 'concourse' }, { ko: '턴어라운드', en: 'turnaround' }, { ko: '지상조업 시간', en: 'turnaround time' },
  { ko: '세관', en: 'customs' }, { ko: '출입국심사', en: 'immigration' }, { ko: '검역', en: 'quarantine' },
];

let _eidc = 0;
function entryId() { return 'e' + Date.now().toString(36) + (_eidc++).toString(36) + Math.random().toString(36).slice(2, 5); }
const cleanTerm = (v, n = 80) => String(v == null ? '' : v).trim().slice(0, n);

// 시드 → entries[]
function seedEntries() {
  const out = [];
  const namesOf = (o) => { const n = {}; for (const lg of TERM_LANGS) if (o[lg]) n[lg] = cleanTerm(o[lg]); return n; };
  for (const a of DEFAULT_AIRLINES) {
    out.push({ id: entryId(), category: 'airline', scope: ['*'], names: namesOf(a), mode: 'pair' });
    if (a.alt) for (const lg of Object.keys(a.alt)) for (const v of a.alt[lg])
      out.push({ id: entryId(), category: 'airline', scope: [lg], names: { ko: a.ko, [lg]: cleanTerm(v, 40) }, mode: 'inputOnly' });
  }
  for (const s of DEFAULT_TERMS_AVIATION) out.push({ id: entryId(), category: 'aviation', scope: ['*'], names: { ko: cleanTerm(s) }, mode: 'recognize' });
  for (const r of DEFAULT_TRANSLATION_TERMS) out.push({ id: entryId(), category: 'aviation', scope: ['*'], names: namesOf(r), mode: 'pair' });
  return out;
}

function sanitizeServed(v) {
  const arr = Array.isArray(v) ? v.filter((x) => TERM_LANGS.includes(x)) : [];
  const set = [...new Set(['ko', ...(arr.length ? arr : DEFAULT_SERVED_LANGS)])];
  return set.filter((x) => TERM_LANGS.includes(x));
}
function sanitizeCatScope(v) {
  const out = {};
  for (const c of TERM_CATEGORIES) {
    const d = (v && v[c]) || DEFAULT_CATEGORY_SCOPE[c];
    out[c] = { desk: d.desk !== false, session: d.session !== false };
  }
  return out;
}
function normEntry(e) {
  if (!e || typeof e !== 'object') return null;
  const category = TERM_CATEGORIES.includes(e.category) ? e.category : 'etc';
  const mode = ['pair', 'inputOnly', 'recognize'].includes(e.mode) ? e.mode : 'pair';
  let scope = Array.isArray(e.scope) ? [...new Set(e.scope.map((x) => String(x)).filter((x) => x === '*' || TERM_LANGS.includes(x)))] : [];
  if (!scope.length) scope = ['*'];
  const names = {};
  const src = e.names && typeof e.names === 'object' ? e.names : e; // names 없이 평면으로 와도 수용
  for (const lg of TERM_LANGS) { const v = cleanTerm(src[lg]); if (v) names[lg] = v; }
  if (!names.ko) return null; // ko 필수(키·타깃)
  return { id: (e.id && String(e.id).slice(0, 40)) || entryId(), category, scope, names, mode };
}

// 구형(terms{}, translationTerms[] with alt) → entries[]
function migrateToEntries(b) {
  const entries = [];
  const airlineKo = new Set(DEFAULT_AIRLINES.map((a) => a.ko));
  const avTermKo = new Set(DEFAULT_TRANSLATION_TERMS.map((r) => r.ko).concat(DEFAULT_TERMS_AVIATION));
  const pairKo = new Set();
  // 구형 {source,target} 또는 다국어 행
  for (const r of Array.isArray(b.translationTerms) ? b.translationTerms : []) {
    if (!r || typeof r !== 'object') continue;
    const names = {};
    if (r.source != null || r.target != null) { if (cleanTerm(r.target)) names.ko = cleanTerm(r.target); if (cleanTerm(r.source)) names.en = cleanTerm(r.source); }
    else for (const lg of TERM_LANGS) { const v = cleanTerm(r[lg]); if (v) names[lg] = v; }
    if (!names.ko) continue;
    pairKo.add(names.ko);
    const category = airlineKo.has(names.ko) ? 'airline' : (avTermKo.has(names.ko) ? 'aviation' : 'etc');
    entries.push({ id: entryId(), category, scope: ['*'], names, mode: 'pair' });
    if (r.alt && typeof r.alt === 'object') for (const lg of TERM_LANGS) for (const v of (Array.isArray(r.alt[lg]) ? r.alt[lg] : [])) {
      const av = cleanTerm(v, 40); if (av) entries.push({ id: entryId(), category, scope: [lg], names: { ko: names.ko, [lg]: av }, mode: 'inputOnly' });
    }
  }
  // 구형 terms(고유명사 문자열) → recognize (번역쌍이 이미 있는 ko 는 제외)
  const t = b.terms;
  const pushRec = (cat, s) => { const v = cleanTerm(s); if (v && !pairKo.has(v)) entries.push({ id: entryId(), category: cat, scope: ['*'], names: { ko: v }, mode: 'recognize' }); };
  if (Array.isArray(t)) for (const s of t) pushRec(DEFAULT_TERMS_AVIATION.includes(cleanTerm(s)) ? 'aviation' : 'etc', s);
  else if (t && typeof t === 'object') {
    for (const s of (Array.isArray(t.aviation) ? t.aviation : [])) pushRec('aviation', s);
    for (const s of (Array.isArray(t.etc) ? t.etc : [])) pushRec('etc', s);
    for (const s of (Array.isArray(t.facility) ? t.facility : [])) pushRec('facility', s);
    // t.airline 은 항공사 ko 이름의 중복이라 번역쌍이 커버 → 무시
  }
  return entries;
}

// 로드·PUT·업로드 공용 정규화 → 항상 v3 shape 반환
function normalizeTermsConfig(b) {
  b = b || {};
  let entries;
  if (Array.isArray(b.entries)) { entries = []; for (const e of b.entries) { const n = normEntry(e); if (n) entries.push(n); if (entries.length >= 4000) break; } }
  else entries = migrateToEntries(b);
  return { version: 3, servedLangs: sanitizeServed(b.servedLangs), categoryScope: sanitizeCatScope(b.categoryScope), entries };
}

await loadStore();
if (!termsConfig.updatedAt) {
  termsConfig = { version: 3, servedLangs: DEFAULT_SERVED_LANGS.slice(), categoryScope: sanitizeCatScope(), entries: seedEntries(), updatedAt: Date.now() };
  try { await persistTermsConfig(); console.log('[terms] 기본 용어 시드 저장 (v3)'); } catch (e) { console.error('[terms] 시드 저장 실패', e); }
} else if (!Array.isArray(termsConfig.entries)) {
  // 구형(terms/translationTerms) → v3 entries 자동 마이그레이션(1회). 시드에만 있고 없는 항목은 병합.
  const mig = normalizeTermsConfig(termsConfig);
  const haveKey = new Set(mig.entries.map((e) => e.category + '|' + e.mode + '|' + (e.names.ko || '') + '|' + (e.scope || []).join(',')));
  for (const se of seedEntries()) { const k = se.category + '|' + se.mode + '|' + (se.names.ko || '') + '|' + (se.scope || []).join(','); if (!haveKey.has(k)) mig.entries.push(se); }
  termsConfig = { ...mig, updatedAt: Date.now() };
  try { await persistTermsConfig(); console.log(`[terms] 구형 → v3 통합모델 마이그레이션 (${termsConfig.entries.length} entries)`); } catch (e) { console.error('[terms] 마이그레이션 저장 실패', e); }
}

/* ---- 용어 기본 번역 병합(부팅 시 1회, 멱등) ----
   저장소(Mongo/파일) 어디에 있든, 아래 표의 한국어 용어에서 en/ja/zh 가 비어 있으면 채운다.
   (파일만 고치면 Mongo 환경에 반영되지 않던 문제 — 코드 레벨 병합으로 로컬·배포 모두 보장) */
const TERM_FILL = {
  '주기장': { ja: '駐機場', zh: '停机坪' }, '램프': { ja: 'ランプ', zh: '机坪' }, '슬롯': { ja: 'スロット', zh: '时刻' },
  '터미널': { ja: 'ターミナル', zh: '航站楼' }, '탑승구': { ja: '搭乗口', zh: '登机口' }, '항공기 유도': { ja: 'マーシャリング', zh: '飞机引导' },
  '토잉': { ja: 'トーイング', zh: '拖曳' }, '토잉카': { ja: 'トーイングカー', zh: '拖车' }, '푸시백': { ja: 'プッシュバック', zh: '推出' },
  '허브 공항': { ja: 'ハブ空港', zh: '枢纽机场' }, '커브사이드': { ja: 'カーブサイド', zh: '路边区' }, '랜드사이드': { ja: 'ランドサイド', zh: '陆侧' },
  '에어사이드': { ja: 'エアサイド', zh: '空侧' }, '수하물 수취대': { ja: '手荷物受取台', zh: '行李转盘' },
  '방빙유지시간': { ja: '防氷持続時間', zh: '防冰保持时间' }, '제빙 작업': { ja: '除氷作業', zh: '除冰作业' },
  '지상 활주': { ja: '地上走行', zh: '滑行' }, '유도로': { ja: '誘導路', zh: '滑行道' }, '활주로': { ja: '滑走路', zh: '跑道' },
  '주기장 번호': { ja: 'スポット番号', zh: '机位号' }, '보안검색': { ja: '保安検査', zh: '安检' }, '촉수검색': { ja: '接触検査', zh: '人身检查' },
  '회항': { ja: 'ダイバート', zh: '备降' }, '체크인': { ja: 'チェックイン', zh: '值机' }, '탑승동': { ja: 'コンコース', zh: '登机廊' },
  '턴어라운드': { ja: 'ターンアラウンド', zh: '过站' }, '지상조업 시간': { ja: 'ターンアラウンドタイム', zh: '过站时间' },
  '세관': { ja: '税関', zh: '海关' }, '출입국심사': { ja: '出入国審査', zh: '边检' }, '검역': { ja: '検疫', zh: '检疫' },
  '에어로케이': { zh: 'Aero K' }, '타이에어아시아엑스': { zh: '泰国亚洲航空长途' },
  '섬에어': { en: 'Sum Air', ja: 'サムエア', zh: 'Sum Air' }, // 기존에 ko 만 있던 항목도 채움(추가 목록만으론 스킵됨)
};
const TERM_FILL_ADD = [ // 없으면 추가되는 항목
  { category: 'airline', scope: ['*'], names: { ko: '섬에어', en: 'Sum Air', ja: 'サムエア', zh: 'Sum Air' }, mode: 'pair' },
];
{
  let filled = 0, added = 0;
  for (const e of termsConfig.entries || []) {
    if (e.mode !== 'pair' || !e.names) continue;
    const f = TERM_FILL[e.names.ko];
    if (!f) continue;
    for (const [lg, v] of Object.entries(f)) if (!e.names[lg]) { e.names[lg] = v; filled++; }
  }
  for (const add of TERM_FILL_ADD) {
    if (!(termsConfig.entries || []).some((e) => e.mode === 'pair' && e.names && e.names.ko === add.names.ko)) {
      termsConfig.entries.push({ id: 'fill' + Math.random().toString(36).slice(2, 8), ...add });
      added++;
    }
  }
  if (filled || added) {
    termsConfig.updatedAt = Date.now();
    try { await persistTermsConfig(); console.log(`[terms] 기본 번역 병합 — ${filled}칸 채움, ${added}항목 추가`); } catch (e) { console.error('[terms] 병합 저장 실패', e); }
  }
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
    writeDataFile(SUMMARIES_FILE, JSON.stringify(summaries, null, 2));
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
    writeDataFile(TERMS_FILE, JSON.stringify(termsConfig, null, 2));
  }
}
// 데스크 모드 전용 general context — Soniox 에 "이 자리가 어떤 상황인지" 배경을 줘서
// 저빈도·동음이의 단어(예 喫煙室=きつえんしつ) 인식률을 끌어올린다. context.general = [{key,value}].
// 흡연실처럼 STT 가 자꾸 헷갈리는 단어는 value 에 일본어 표기를 괄호로 병기.
const DESK_GENERAL_CONTEXT = [
  { key: 'location', value: 'Airport information desk' },
  { key: 'airport', value: 'Gimpo International Airport' },
  { key: 'facilities', value: 'smoking room (喫煙室 / きつえんしつ), restroom, currency exchange, convenience store, subway station, boarding gate' },
];
// Soniox 세션 context 조립(통합 v3 entries 기반). langs=이 세션 활성 언어, opts.desk=데스크 세션 여부.
//  - mode 'pair'      : 활성 언어쌍 양방향 번역 + 인식
//  - mode 'inputOnly' : 외국어 표기 → 한국어(ko) 단방향 번역 + 인식 (약칭·오인식 교정)
//  - mode 'recognize' : 언어무관 인식 힌트만
//  - scope: '*' 아니면 그 언어가 활성일 때만 주입 / categoryScope: 데스크·일반세션 적용 여부
//  - 데스크 세션은 general(공항 안내데스크 배경)도 함께 주입 — 저빈도 단어 인식 보정.
//  - 폴백(en→ko) 없음: 명시된 언어 표기만 사용. 전체 한도(8,000토큰≈10,000자) 방어는 유지.
function buildSonioxContextRaw(langs, opts = {}) {
  const desk = !!opts.desk;
  const L = [...new Set((langs || []).filter((c) => TERM_LANGS.includes(c)))];
  if (!L.length) L.push('ko', 'en');
  const cs = termsConfig.categoryScope || {};
  const terms = new Set();
  const pairs = [];
  const seen = new Set();
  const addPair = (a, b) => {
    if (!a || !b || a === b) return;
    const k = a + '||' + b;
    if (!seen.has(k)) { seen.add(k); pairs.push({ source: a, target: b }); }
  };
  // 표기 결정: 한·영·일은 명시 표기만(비면 없음), 그 외 언어(zh 포함 미입력 시·es/fr/ru 등)는
  // 영어 표기로 폴백 — 어떤 세션 언어에서도 고유명사가 최소 영어 브랜드명으로 일관 번역되도록 보장.
  const nameFor = (names, lg) => {
    const v = String(names[lg] || '').trim();
    if (v) return v;
    if (lg === 'ko' || lg === 'en' || lg === 'ja') return '';
    return String(names.en || '').trim();
  };
  for (const e of termsConfig.entries || []) {
    if (!e || !e.names || !e.names.ko) continue;
    const scope = cs[e.category] || { desk: true, session: true };
    if (desk ? scope.desk === false : scope.session === false) continue; // 카테고리 적용대상(데스크 항공용어 제외 등)
    const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
    if (scoped && !e.scope.some((sl) => L.includes(sl))) continue;       // 언어 스코프
    if (e.mode === 'recognize') { const v = String(e.names.ko || '').trim(); if (v) terms.add(v); continue; }
    for (const lg of L) { const v = nameFor(e.names, lg); if (v) terms.add(v); } // 활성 언어 표기 → 인식 힌트
    const ko = String(e.names.ko || '').trim();
    if (e.mode === 'inputOnly') {
      if (!ko || !L.includes('ko')) continue;
      for (const lg of L) { if (lg === 'ko') continue; addPair(String(e.names[lg] || '').trim(), ko); } // 외국어 → ko 단방향(약칭은 폴백 없음)
    } else { // pair
      for (const a of L) for (const b of L) { if (a !== b) addPair(nameFor(e.names, a), nameFor(e.names, b)); }
    }
  }
  const ctx = {};
  if (desk && DESK_GENERAL_CONTEXT.length) ctx.general = DESK_GENERAL_CONTEXT; // 데스크 배경(공항 안내데스크)
  if (terms.size) ctx.terms = [...terms];
  if (pairs.length) ctx.translation_terms = pairs;
  return Object.keys(ctx).length ? ctx : null;
}
function buildSonioxContext(langs, opts = {}) {
  const ctx = buildSonioxContextRaw(langs, opts);
  if (!ctx) return null;
  // 한도 방어: 초과 시 번역쌍부터, 다음 인식 힌트를 뒤에서부터 잘라낸다(전부 잘리면 경고만).
  // 초과분에 비례해 청크로 제거 — 대용량 업로드(수천 항목)여도 몇 번의 stringify 로 반드시 한도 안에 들어오고,
  // 항목 1개씩 pop×전체 재직렬화로 이벤트루프를 수초 막던 문제도 없음.
  let dropped = 0;
  for (let pass = 0; pass < 60; pass++) {
    const len = JSON.stringify(ctx).length;
    if (len <= 9500) break;
    const excess = len - 9500;
    const arr = (ctx.translation_terms && ctx.translation_terms.length) ? ctx.translation_terms : ctx.terms;
    if (!arr || !arr.length) break;
    const avg = Math.max(8, Math.floor(len / (((ctx.translation_terms || []).length + (ctx.terms || []).length) || 1)));
    const n = Math.min(arr.length, Math.max(1, Math.ceil(excess / avg)));
    arr.splice(-n);
    dropped += n;
    if (ctx.translation_terms && !ctx.translation_terms.length) delete ctx.translation_terms;
    if (ctx.terms && !ctx.terms.length) delete ctx.terms;
  }
  if (dropped > 0) console.warn(`[terms] Soniox context 한도 초과 — ${dropped}개 항목 잘림(langs=${(langs || []).join(',')}${opts.desk ? ',desk' : ''})`);
  return Object.keys(ctx).length ? ctx : null;
}

function getSession(id) {
  // 소프트 삭제된 세션은 일반 경로(목록·뷰어·WS·수정)에서 존재하지 않는 것으로 취급
  return sessions.find((s) => s.id === id && !s.deletedAt);
}
// 삭제된 세션 포함 조회 — 관리자 로그·통계 전용(세션을 지워도 대화 기록은 보존·열람)
function getSessionAny(id) {
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
/* ---- 경량 모니터링: 프로세스 상태 + 최근 오류(서버·클라이언트) ---- */
const metrics = { startedAt: Date.now(), errors: [], clientErrors: [] };
function logErr(scope, err) {
  const e = { at: Date.now(), scope, msg: String((err && err.message) || err).slice(0, 300) };
  metrics.errors.push(e);
  if (metrics.errors.length > 100) metrics.errors.shift();
  console.error(`[${scope}]`, (err && err.stack) || err);
}
process.on('uncaughtException', (e) => logErr('uncaught', e));
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
  res.json({ startedAt: e.startedAt || null, endedAt: e.endedAt || null, lang: e.lang || null, stats: e.stats || null, items: e.items || [] });
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
  s.deskLog.splice(i, 1);
  saveSessions();
  res.json({ ok: true, remaining: s.deskLog.length });
});
// 소프트 삭제된 세션의 로그까지 지우면 남는 게 없으므로 껍데기도 완전 제거(저장소 포함)
const purgeIfDeleted = (s) => {
  if (!s.deletedAt) return false;
  sessions = sessions.filter((x) => x.id !== s.id);
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

/* ---- 관리자: 자주 묻는 질문 분석 — 데스크 응대 로그의 손님 질문을 GPT 로 주제 클러스터링 ----
   시범운영 보고서용: "이번에 손님들이 무엇을 물었나" TOP 주제·건수·예시. 결과는 저장(자체 누적)해
   분석 실행 없이도 마지막 결과를 다시 볼 수 있다. (OpenAI 과금 — 버튼으로만 실행) */
app.get('/api/admin/faq-report', requireAdmin, (req, res) => {
  res.json(faqReport || { at: 0, checked: 0, topics: [] });
});
app.post('/api/admin/faq-analyze', requireAdmin, async (req, res) => {
  if (!OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY 미설정' });
  // 손님 발화만 수집: 데스크 응대 로그에서 lang!==ko 인 화자(손님)의 한국어 번역(texts.ko) 우선
  const questions = [];
  for (const s of sessions) {
    if (s.pipeline !== 'desk' || !Array.isArray(s.deskLog)) continue;
    for (const e of s.deskLog) {
      for (const it of e.items || []) {
        const staff = it.lang ? it.lang === 'ko' : it.side === 'right';
        if (staff) continue;
        const q = ((it.texts && it.texts.ko) || it.source || '').trim();
        if (q.length >= 2) questions.push(q.slice(0, 120));
      }
    }
  }
  const recent = questions.slice(-400); // 최근 위주
  if (recent.length < 3) return res.json({ at: Date.now(), checked: recent.length, topics: [], note: '분석할 손님 발화가 부족합니다(3건 미만).' });
  const sys =
    '너는 공항 안내데스크 운영 분석가다. 아래는 손님 발화(한국어 번역) 목록이다. ' +
    '비슷한 질문·요청을 주제로 묶어 자주 묻는 질문 TOP 을 만들어라. 인사말·잡담·불완전한 조각은 제외한다. ' +
    '반드시 JSON 하나만 출력: {"topics":[{"topic":"주제(간결한 한국어 한 줄)","count":해당 발화 수,"examples":["대표 예시 1","대표 예시 2"]}]} ' +
    'count 큰 순으로 최대 12개. examples 는 목록에 실제로 있는 문장에서 고른다.';
  try {
    const body = {
      model: REFINE_MODEL,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: recent.join('\n').slice(0, 14000) }],
      max_completion_tokens: 1200,
      response_format: { type: 'json_object' },
    };
    const re = reasoningEffort(REFINE_MODEL);
    if (re) body.reasoning_effort = re;
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(500).json({ error: '분석 호출 실패: HTTP ' + r.status });
    const d = await r.json();
    const obj = JSON.parse(d?.choices?.[0]?.message?.content || '{}');
    const topics = (Array.isArray(obj.topics) ? obj.topics : [])
      .filter((t) => t && t.topic && (Number(t.count) || 0) > 0) // 0건 주제(모델 노이즈) 제거
      .slice(0, 12)
      .map((t) => ({ topic: String(t.topic).slice(0, 80), count: Number(t.count) || 0, examples: (Array.isArray(t.examples) ? t.examples : []).slice(0, 2).map((x) => String(x).slice(0, 120)) }));
    faqReport = { at: Date.now(), checked: recent.length, topics };
    try { await persistFaqReport(); } catch (e) { logErr('faq-persist', e); }
    res.json(faqReport);
  } catch (e) {
    logErr('faq-analyze', e);
    res.status(500).json({ error: '분석 실패' });
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
app.get('/api/canned', requireAuth, (req, res) => res.json(cannedConfig));
app.put('/api/canned', requireAdmin, async (req, res) => {
  const b = req.body || {};
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 50).map((it, i) => ({
    id: String(it.id || 'c' + i + Math.random().toString(36).slice(2, 6)).slice(0, 24),
    title: String(it.title || '').trim().slice(0, 40),
    texts: Object.fromEntries(['ko', 'en', 'ja', 'zh'].map((lg) => [lg, String((it.texts && it.texts[lg]) || '').trim().slice(0, 300)]).filter(([, v]) => v)),
  })).filter((it) => it.title && it.texts.ko);
  cannedConfig = { items };
  try { await persistCanned(); } catch (e) { logErr('canned-persist', e); return res.status(500).json({ error: '저장 실패' }); }
  res.json(cannedConfig);
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
  if (id === ADMIN_ID) return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
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

/* ---- 벤더 실사용량: Soniox / Cartesia / OpenAI 사용량 API 를 직접 조회해 일별 집계 ----
   - Soniox: GET /v1/usage-logs (일반 API 키) — 요청별 오디오시간·비용(cost_usd)
   - Cartesia: GET /usage/credits (⚠ 관리자 키 CARTESIA_ADMIN_API_KEY = sk_car_admin_… 필요) — 일별 크레딧
   - OpenAI: GET /v1/organization/costs (⚠ 관리자 키 OPENAI_ADMIN_API_KEY = sk-admin-… 필요) — 일별 비용(USD)
   키가 없는 벤더는 configured=false 로 내려 UI 가 내부 집계 폴백을 안내한다. 10분 캐시(과금·쿼터 보호). */
const CARTESIA_ADMIN_API_KEY = process.env.CARTESIA_ADMIN_API_KEY || '';
const OPENAI_ADMIN_API_KEY = process.env.OPENAI_ADMIN_API_KEY || '';
const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

// 벤더 사용량 API 공용 fetch — 429(레이트리밋)면 Retry-After 만큼 기다렸다 1회 재시도.
// (OpenAI costs API 는 30req/min 제한 — 재배포 직후 부팅 갱신이 겹치면 429 가 났다가 10분간 오류로 남던 문제)
async function vendorFetch(url, opts) {
  let r = await fetch(url, opts);
  if (r.status === 429) {
    const ra = Math.min(65, Math.max(2, Number(r.headers.get('retry-after')) || 20));
    await new Promise((ok) => setTimeout(ok, ra * 1000));
    r = await fetch(url, opts);
  }
  return r;
}

// 각 fetch 는 { byDay: {date: metrics} } 또는 { error } 를 반환. 미설정이면 null.
async function fetchSonioxRange(startMs, endMs) {
  const byDay = {};
  let cursor = null;
  for (let page = 0; page < 40; page++) { // 안전 상한(최대 40,000건)
    const qs = new URLSearchParams({ start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString(), limit: '1000' });
    if (cursor) qs.set('cursor', cursor);
    const r = await vendorFetch('https://api.soniox.com/v1/usage-logs?' + qs, { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } });
    if (!r.ok) return { error: `Soniox ${r.status}: ${(await r.text()).slice(0, 120)}` };
    const d = await r.json();
    for (const e of d.usage_logs || []) {
      const day = kstDay(Date.parse(e.end_time || e.start_time || 0) || startMs);
      const b = byDay[day] || (byDay[day] = { audioMs: 0, costUsd: 0, requests: 0, byUser: {} });
      b.audioMs += Number(e.input_audio_duration_ms) || 0;
      b.costUsd += Number(e.cost_usd) || 0;
      b.requests += 1;
      // client_reference_id('u:<id>') → 유저별 집계 (미태깅 과거 요청은 'anon')
      const ref = String(e.client_reference_id || '');
      const uid = ref.startsWith('u:') ? ref.slice(2) : 'anon';
      const u = b.byUser[uid] || (b.byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
      u.audioMs += Number(e.input_audio_duration_ms) || 0;
      u.costUsd += Number(e.cost_usd) || 0;
      u.requests += 1;
    }
    cursor = d.next_page_cursor;
    if (!cursor) break;
  }
  for (const k of Object.keys(byDay)) {
    byDay[k].costUsd = +byDay[k].costUsd.toFixed(4);
    for (const u of Object.values(byDay[k].byUser || {})) u.costUsd = +u.costUsd.toFixed(4);
  }
  return { byDay };
}
// Soniox 는 요청당 31일 창 제한 → 30일씩 잘라 요청(최대 90일까지 보관분 backfill)
async function fetchSoniox(spanDays) {
  if (!SONIOX_API_KEY) return null;
  const endMs = Date.now();
  const byDay = {};
  const CH = 30 * 86400e3;
  // 청크 경계(임의 시각)에 걸친 KST 하루는 두 청크에 부분합으로 나뉨 → 덮어쓰지 말고 합산 병합
  const mergeDay = (into, m) => {
    into.audioMs += m.audioMs; into.costUsd += m.costUsd; into.requests += m.requests;
    for (const [uid, u] of Object.entries(m.byUser || {})) {
      const t = into.byUser[uid] || (into.byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
      t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
    }
  };
  for (let s = endMs - spanDays * 86400e3; s < endMs; s += CH) {
    const r = await fetchSonioxRange(s, Math.min(s + CH, endMs));
    if (r.error) return r; // 에러면 저장분 보존
    for (const [date, m] of Object.entries(r.byDay)) {
      if (byDay[date]) mergeDay(byDay[date], m);
      else byDay[date] = m;
    }
  }
  for (const d of Object.values(byDay)) { d.costUsd = +d.costUsd.toFixed(4); for (const u of Object.values(d.byUser || {})) u.costUsd = +u.costUsd.toFixed(4); }
  return { byDay };
}
async function fetchCartesia(spanDays) {
  if (!CARTESIA_ADMIN_API_KEY) return null;
  const endMs = Date.now();
  const qs = new URLSearchParams({ start_ts: new Date(endMs - spanDays * 86400e3).toISOString(), end_ts: new Date(endMs).toISOString(), interval: 'day' });
  const r = await vendorFetch('https://api.cartesia.ai/usage/credits?' + qs, { headers: { Authorization: `Bearer ${CARTESIA_ADMIN_API_KEY}`, 'Cartesia-Version': '2025-04-16' } });
  if (!r.ok) return { error: `Cartesia ${r.status}: ${(await r.text()).slice(0, 120)}` };
  const d = await r.json();
  const byDay = {};
  for (const b of d.data || []) byDay[kstDay(Date.parse(b.start_ts))] = { credits: b.credits || 0 };
  return { byDay };
}
async function fetchOpenai(spanDays) {
  if (!OPENAI_ADMIN_API_KEY) return null;
  const endMs = Date.now();
  const byDay = {};
  let pageToken = null;
  // limit=기간 전체(최대 180 버킷) — 페이지네이션 왕복을 없애 30req/min 레이트리밋(429)을 피한다
  const limit = String(Math.min(180, spanDays + 2));
  for (let page = 0; page < 8; page++) {
    const qs = new URLSearchParams({ start_time: String(Math.floor((endMs - spanDays * 86400e3) / 1000)), end_time: String(Math.floor(endMs / 1000)), bucket_width: '1d', limit });
    if (pageToken) qs.set('page', pageToken);
    const r = await vendorFetch('https://api.openai.com/v1/organization/costs?' + qs, { headers: { Authorization: `Bearer ${OPENAI_ADMIN_API_KEY}` } });
    if (!r.ok) return { error: `OpenAI ${r.status}: ${(await r.text()).slice(0, 120)}` };
    const d = await r.json();
    for (const b of d.data || []) {
      const day = kstDay((b.start_time || 0) * 1000);
      // amount.value 가 문자열로 오면 합계가 문자열 연결이 돼 .toFixed 크래시 → 숫자 강제
      byDay[day] = { costUsd: +(b.results || []).reduce((a, x) => a + (Number(x.amount && x.amount.value) || 0), 0).toFixed(4) };
    }
    if (!d.has_more) break;
    pageToken = d.next_page;
    if (!pageToken) break;
  }
  return { byDay };
}

// 벤더 API 조회 → 저장소에 병합(무기한 누적). 상태(configured/error)는 메모리에 최신값 유지.
const vendorStatus = { soniox: {}, cartesia: {}, openai: {} };
let vendorRefreshAt = 0;
let vendorRefreshing = null;
async function refreshVendorUsage(spanDays = 90) {
  const jobs = { soniox: fetchSoniox, cartesia: fetchCartesia, openai: fetchOpenai };
  let changed = false;
  await Promise.all(Object.entries(jobs).map(async ([k, fn]) => {
    let r; try { r = await fn(spanDays); } catch (e) { r = { error: String(e.message || e) }; }
    if (r === null) { vendorStatus[k] = { configured: false }; return; }
    if (r.error) { vendorStatus[k] = { configured: true, error: r.error }; return; } // 저장분은 보존
    vendorStatus[k] = { configured: true };
    for (const [date, m] of Object.entries(r.byDay)) { vendorUsage[k][date] = m; changed = true; } // 최근일은 갱신(덮어쓰기)
  }));
  vendorRefreshAt = Date.now();
  if (changed) { try { await persistVendorUsage(); } catch (e) { logErr('vendor-usage-persist', e); } }
}
// 갱신 단일화 — 라우트/부팅/주기 타이머가 모두 이 함수로 진입해 동시 실행(429 유발)을 막는다
function kickVendorRefresh() {
  if (!vendorRefreshing) vendorRefreshing = refreshVendorUsage().finally(() => { vendorRefreshing = null; });
  return vendorRefreshing;
}
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
      return { totalCostUsd: +ds.reduce((a, d) => a + (d.costUsd || 0), 0).toFixed(4), totalAudioMin: +(ds.reduce((a, d) => a + (d.audioMs || 0), 0) / 60000).toFixed(1), totalRequests: ds.reduce((a, d) => a + (d.requests || 0), 0), users };
    }),
    cartesia: build('cartesia', (ds) => ({ totalCredits: ds.reduce((a, d) => a + (d.credits || 0), 0) })),
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
  termsConfig = { ...normalizeTermsConfig(req.body || {}), updatedAt: Date.now() };
  try { await persistTermsConfig(); } catch (e) { console.error('[terms] 저장 실패', e); }
  res.json({ version: 3, servedLangs: termsConfig.servedLangs, categoryScope: termsConfig.categoryScope, entries: termsConfig.entries, langs: TERM_LANGS, categories: TERM_CATEGORIES, updatedAt: termsConfig.updatedAt });
});

/* ---- 용어 설정 실검증: 저장된 설정을 실제 soniox 에 던져 언어쌍별 수락/거부 확인 ----
   글자수 추정(≈10,000자)은 토큰≠글자라 부정확 → 각 운영 언어쌍(ko↔L) context 로 soniox WS 를
   열어 config 만 보내고 수락/에러(용량초과 등)를 판정한 뒤 즉시 닫는다(오디오 미전송 → 과금 최소). */
function validateSonioxPair(a, b, ctx) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(r); };
    let ws;
    try { ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket'); }
    catch (e) { return resolve({ ok: false, error: String(e.message || e) }); }
    const timer = setTimeout(() => finish({ ok: true }), 3000); // 수락되면 오디오 대기로 무응답 → 통과
    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
          enable_language_identification: true, enable_endpoint_detection: true,
          language_hints: [a, b], translation: { type: 'two_way', language_a: a, language_b: b },
          ...(ctx ? { context: ctx } : {}),
        }));
      } catch (e) { finish({ ok: false, error: String(e.message || e) }); }
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.error_code || m.error_message) finish({ ok: false, error: `${m.error_code || ''} ${m.error_message || ''}`.trim() });
      else finish({ ok: true }); // 정상 응답(토큰/메타) → 수락
    });
    ws.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
    ws.on('close', (code, reason) => finish(code === 1000 ? { ok: true } : { ok: false, error: `closed ${code} ${String(reason || '').slice(0, 80)}`.trim() }));
  });
}
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

/* (평가 러너는 제거됨 — 평가는 데스크 응대 로그의 '평가 JSON' 내려받기 + eval/score.mjs --auto 로 진행) */

/* ================================================================== */
/*  AI 요약 (gpt-5-nano) — 세션 전문을 체계적으로 요약                   */
/* ================================================================== */
const SUMMARY_MODEL = 'gpt-5-nano';
const SUMMARY_SYS =
  `너는 회의·대화 기록 요약 전문가다. 주어진 전사/번역 전문을 바탕으로 체계적이고 자세한 요약을 작성한다.\n` +
  `규칙:\n` +
  `- 전문이 어떤 언어이든 요약은 반드시 한국어로만 작성한다.\n` +
  `- 요약 본문만 출력한다. "다음은 요약입니다" 같은 머리말·맺음말·메타발언을 절대 넣지 않는다.\n` +
  `- 맨 위에 "## 한눈에 보기"로 전체를 3줄 이내로 압축한 뒤, 아래에 상세 요약을 이어간다.\n` +
  `- 소제목(## )과 불릿(- )으로 체계적으로 정리한다. 핵심 주제, 주요 논의·결정사항, 수치·일정·담당자·고유명사 등 구체 정보, 후속 조치를 담는다.\n` +
  `- 전문에 등장한 논의 항목은 사소해 보여도 빠뜨리지 말고 모두 포함한다. 축약하더라도 언급 자체를 누락하지 않는다.\n` +
  `- 전문이 "* [화자] : 발언" 형식이면 각 발언이 누구 것인지 구분해, 발언자별 입장·주장·담당 사항을 명확히 반영한다.\n` +
  `- 전문에 없는 내용을 지어내지 않는다. 불확실한 건 추정하지 않는다.`;
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
// 세션 내 즉시 AI 요약(구조화: 핵심 요점 + 주요 용어 원어·한국어). 확정 자막 기준.
app.post('/api/sessions/:id/summary', requireAuth, async (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  if (s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  const transcript = sessionTranscript(s);
  if (!transcript.trim()) return res.json({ points: [], terms: [] });
  try {
    const sys = '너는 회의·대화 전문을 분석하는 도우미다. 반드시 JSON 하나만 출력한다. 코드펜스와 설명을 금지한다. 형식: {"points": string[], "terms": {"src": string, "ko": string}[]}. points=대화 전체를 빠짐없이 포괄하는 요점 목록으로, 전문이 어떤 언어이든 반드시 한국어로 작성하고, 언급된 주제는 사소해도 누락하지 않으며 필요한 만큼(보통 8~15개) 각 한두 문장으로 구체적으로 쓴다. terms=등장한 전문용어·고유명사의 원어(src)와 한국어 대응(ko) 최대 12개(없으면 []).';
    let raw = await chatComplete(sys, `전문:\n\n${transcript.slice(0, SUMMARY_MAX_INPUT)}`, 1500);
    raw = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    let obj = {}; try { obj = JSON.parse(raw); } catch { obj = {}; }
    const points = Array.isArray(obj.points) ? obj.points.filter((x) => typeof x === 'string' && x.trim()).slice(0, 20) : [];
    const terms = Array.isArray(obj.terms) ? obj.terms.filter((t) => t && t.src).map((t) => ({ src: String(t.src), ko: String(t.ko || '') })).slice(0, 12) : [];
    res.json({ points, terms });
  } catch (e) {
    res.status(500).json({ error: (e && e.message) ? String(e.message).slice(0, 200) : '요약 실패' });
  }
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
  const list = sessions
    .filter((s) => !s.deletedAt)
    // 일반 세션은 본인 것만. 안내데스크 세션은 관리자가 만들고 전 직원이 공용으로 운영 → 모두에게 노출.
    .filter((s) => (s.pipeline === 'desk' ? true : s.owner === req.user.id))
    .filter((s) => (q ? matches(s) : true))
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length, pipeline: s.pipeline || 'whisper', preset: s.preset || null }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/sessions', requireAuth, (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  const pipeline = ['translate', 'deepgram', 'soniox', 'desk'].includes(b.pipeline) ? b.pipeline : 'soniox'; // whisper(구) 지원 종료 — 기본 soniox
  // 안내데스크 세션은 관리자만 생성(공용 인프라) — 직원은 운영만
  if (pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 만들 수 있습니다.' });
  // translate 는 단일 출력 언어. desk 는 ko 시작(감지로 동적 확장). soniox·deepgram 다국어.
  const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
  const langs = pipeline === 'translate' ? [outLang] : (pipeline === 'desk' ? ['ko'] : ALL_LANGS.slice());
  // 통역 용도 프리셋(대면/온라인/현장) — 클라가 소스·방향 기본값을 매핑
  const preset = ['live', 'oneway', 'twoway', 'mobile', 'meeting', 'online', 'field'].includes(b.preset) ? b.preset : undefined;
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
  // 참여자 발화(PTT)는 양방향 모드의 기본 기능(토글 폐지) — 양방향 계열 preset 에서만 제공
  const twoway = (s.pipeline === 'soniox') && ['twoway', 'mobile', 'field', 'meeting'].includes(s.preset || '');
  // 공개 라우트(뷰어용) — 필요한 필드만 화이트리스트로 반환.
  // 전체 스프레드 금지: deskLog(지난 손님 응대 기록)·wayfindLog·owner 등이 노출됐던 문제 수정.
  res.json({
    id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
    pipeline: s.pipeline || 'whisper', preset: s.preset || null,
    langs: s.langs || [], outLang: s.outLang, inLang: s.inLang,
    sxInfo: s.sxInfo || null, speakers: s.speakers || {},
    deskFloor: s.deskFloor || null, deskSide: s.deskSide || null,
    items: s.items || [],
    viewerPTT: twoway,
  });
});

// 데스크 뷰어 랜딩(공개): 안내데스크 세션 목록(id·제목만) — 뷰어가 방을 선택해 접속
app.get('/api/desk-sessions', (req, res) => {
  const list = sessions
    .filter((s) => s.pipeline === 'desk' && !s.deletedAt)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    // active = 호스트(안내원)가 마이크 캡처 중(대기 가능). 비활성이면 손님이 선택 못 함.
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
  if (typeof b.preset === 'string' && ['live', 'oneway', 'twoway'].includes(b.preset) && s.pipeline === 'soniox' && activeHosts === 0 && (!Array.isArray(s.items) || s.items.length === 0)) {
    s.preset = b.preset;
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
  if (typeof b.viewerPTT === 'boolean') { s.viewerPTT = b.viewerPTT; broadcast(req.params.id, { type: 'viewerPTT', on: b.viewerPTT }); }
  s.updatedAt = Date.now();
  saveSessions();
  res.json(s);
});

app.delete('/api/sessions/:id', requireAuth, (req, res) => {
  const s = getSession(req.params.id);
  if (s) {
    // 안내데스크 세션 삭제(관리 행위)는 관리자만
    if (s.pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 삭제할 수 있습니다.' });
    if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    // 소프트 삭제: 목록·뷰어에서만 사라지고 대화 기록(items·deskLog)은 관리자 로그·통계에 보존.
    // 기록까지 지우려면 관리자 페이지의 로그 삭제를 사용.
    s.deletedAt = Date.now();
    saveSessions();
  }
  // 연결된 소켓을 먼저 정리 — rooms 만 지우면 이미 접속한 소켓들이 고아 room 상태를 들고
  // 좀비 스트리밍(비용)·발화 락 오염을 일으킨다.
  const r = rooms.get(req.params.id);
  if (r) {
    for (const cx of [...r.hosts, ...r.viewers]) {
      try { cx.send(JSON.stringify({ type: 'status', message: '세션이 삭제되어 연결을 종료합니다.' })); } catch {}
      try { cx.close(); } catch {}
    }
  }
  rooms.delete(req.params.id);
  roomCfg.delete(req.params.id);
  recentTts.delete(req.params.id);
  deskCtrl.delete(req.params.id);
  res.json({ ok: true });
});

/* ================================================================== */
/*  실시간 방(room) : 세션ID 기준. 호스트(여러 소스) + 뷰어 N           */
/* ================================================================== */
const rooms = new Map(); // sessionId -> { viewers:Set<ws>, hosts:Set<ws> }
const roomCfg = new Map(); // sessionId -> 호스트가 시작한 soniox 설정(폰 PTT가 재사용)
const deskCtrl = new Map(); // sessionId -> { start(lang), end() } — 데스크: 뷰어(손님)의 통역 시작/종료를 호스트 파이프라인에 전달
function getRoom(sessionId) {
  if (!rooms.has(sessionId)) rooms.set(sessionId, { viewers: new Set(), hosts: new Set(), speaking: null, hostTalking: false });
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

/* ---- 발화 배타(PTT 락): 호스트가 발화 중이거나 다른 뷰어가 발화 중이면 새 발화 불가 ---- */
function pttBusy(room) { return !!(room && (room.hostTalking || room.speaking)); }
function broadcastPttState(sessionId) {
  const room = rooms.get(sessionId);
  if (!room) return;
  const msg = JSON.stringify({ type: 'ptt-state', busy: pttBusy(room) });
  for (const v of room.viewers) if (v.readyState === WebSocket.OPEN) v.send(msg);
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
/* ---- 추임새(간투사·filler) 제거 ----
   실시간 STT 가 잡아내는 "yeah, umm, 어…, えっと" 류 무의미 간투사를 인식 결과에서 뺀다.
   2단계로 분리 — 오답 위험을 최소화:
   ① 순수 잡음(um/uh/음/えっと 등): 항상 제거. 발화 전체가 이것뿐이면 카드째 사라진다.
   ② 소프트 간투사(yeah/well 등): 제거 후에도 '실질 내용'이 남을 때만 제거.
      발화 전체가 "Yeah." 처럼 소프트 간투사 하나면 실제 대답이므로 보존한다.
   원문(모든 언어)·번역문 공통 적용. 라이브(비확정) 중엔 두지 않고 확정 시점에만 정리(깜빡임 방지). */
// 순수 잡음: 영어 um/uh/hmm/mm/erm, 한국어 음/어/으음(조사로 흔한 '에'는 오작동 위험 → 제외),
//            일본어 えっと/えー/あー/うー/んー, 중국어 嗯/呃/唔
const FILLER_NOISE_RE = /\b(?:u+m+|u+h+|uh+m+|hm+|mm+|mhm|e+r+m*)\b|(?<![가-힣])(?:음+|어+|으+음*)(?![가-힣])|(?:え[ーっ]?と|えー+|あー+|うー+|んー+)|(?:嗯+|呃+|唔+)/gi;
// 소프트 간투사: 영어 yeah/yep/yup/y'know (발화 전체면 보존). 'well'은 실단어 의미가 있어 제외.
const FILLER_SOFT_RE = /\b(?:yeah|yep|yup|y'?know)\b/gi;
function cleanFillerSpacing(s) {
  return String(s)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?。、！？…])/g, '$1')       // 구두점 앞 공백 제거
    .replace(/([,、])\s*(?=[,、])/g, '')            // 연속 쉼표 정리
    .replace(/^[\s,.、。，！？!?：；…·\-]+/, '')       // 앞쪽에 남은 구두점/공백 제거(전각 포함)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
function stripFillers(text) {
  const original = String(text == null ? '' : text);
  if (!original.trim()) return original;
  let s = original.replace(FILLER_NOISE_RE, ' ');       // ① 순수 잡음 — 항상 제거
  const soft = s.replace(FILLER_SOFT_RE, ' ');          // ② 소프트 간투사 — 내용이 남을 때만
  if (/[\p{L}\p{N}]/u.test(cleanFillerSpacing(soft))) s = soft;
  s = cleanFillerSpacing(s);
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1); // 앞 간투사 제거로 소문자 시작이면 첫 글자 복원
  return s;
}

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
const catById = (id) => CATEGORIES.find((c) => c.id === id);
// 카테고리 ID → 목적지 배열. 보안구역(in_secure) 시설은 안내 대상에서 제외(일반구역만).
// 데스크 층 우선(그 층 일반구역 시설 전부), 없으면 층번호상 가까운 층 순.
function resolveCategoryDests(catId, deskFloor) {
  const cat = catById(catId);
  if (!cat) return null;
  const fac = loadFacilities();
  const base = DESK_FLOORS.includes(deskFloor) ? deskFloor : '1F';
  const order = DESK_FLOORS.slice().sort((a, b) => Math.abs(DESK_FLOORS.indexOf(a) - DESK_FLOORS.indexOf(base)) - Math.abs(DESK_FLOORS.indexOf(b) - DESK_FLOORS.indexOf(base)));
  for (const fk of order) {
    const list = (fac[fk] || []).filter((f) => !f.in_secure && cat.match.some((m) => String(f.name).includes(m)));
    if (list.length) {
      // 같은(또는 거의 같은) 좌표의 중복 데이터 제거 — 지도에 경로가 겹쳐 2개 그려지던 문제
      const seen = new Set();
      const dests = [];
      for (const f of list) {
        const k = Math.round(f.x / 5) + ',' + Math.round(f.y / 5);
        if (seen.has(k)) continue;
        seen.add(k);
        dests.push({ floor: fk, x: f.x, y: f.y, name: f.name });
      }
      return { category: cat.id, ko: cat.ko, floor: fk, sameFloor: fk === base, dests };
    }
  }
  return null; // 일반구역에 해당 시설 없음 → 안내 안 함
}
// 직매칭 실패 + 위치 의도어 있을 때만 호출: gpt-5.4-mini 로 카테고리 분류(닫힌 집합)
// questionKo(직전 손님 질문의 한국어 번역)를 함께 주면 "저쪽 끝에 있어요"류 시설명 생략 답변도 분류 가능.
async function classifyFacility(koText, questionKo) {
  if (!OPENAI_API_KEY) return null;
  const enumList = CATEGORIES.map((c) => `${c.id}(${c.ko})`).join(', ');
  const sys = `공항 안내 대화에서 언급된 시설을 아래 목록 중 하나의 id로만 분류한다.\n목록: ${enumList}\n부정("없다", "~말고")된 시설이나 해당 없음이면 none. 출력은 JSON {"id":"..."} 하나만.`;
  const user = questionKo ? `손님 질문: ${questionKo}\n안내원 답변: ${koText}` : koText;
  try {
    const body = { model: 'gpt-5.4-mini', messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], max_completion_tokens: 20, response_format: { type: 'json_object' }, reasoning_effort: 'none' };
    const r = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` }, body: JSON.stringify(body) });
    if (!r.ok) return null;
    const d = await r.json();
    const id = (JSON.parse(d?.choices?.[0]?.message?.content || '{}').id || '').trim();
    return catById(id) ? id : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ */
/*  WebSocket 라우팅                                                     */
/*   /ws/host?session=ID&src=mic|system&out=ko                          */
/*   /ws/viewer?session=ID                                              */
/* ------------------------------------------------------------------ */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
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
      ws._deskGuestSens = searchParams.get('deskGuestSens'); // desk 여객 태블릿 마이크 민감도(0~100)
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
  ws.on('pong', () => { ws._alive = true; });
  if (ws._kind === 'viewer') return handleViewer(ws);
  return handleHost(ws);
});

// 하트비트: 절전·망 단절로 FIN 없이 사라진 소켓을 주기 감지·정리.
// 없으면 죽은 연결이 발화 락(hostTalking/speaking)과 데스크 active 표시를 영구 점유한다.
const HEARTBEAT_MS = 30000;
const hbTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws._alive === false) { try { ws.terminate(); } catch {} continue; } // pong 미응답 → 강제 종료(close 핸들러가 락 해제)
    ws._alive = false;
    try { ws.ping(); } catch {}
  }
}, HEARTBEAT_MS);
hbTimer.unref();

// 빈 room 정리: 마지막 연결이 떠나면 세션별 부속 상태도 회수(메모리 누수 방지)
function maybeGcRoom(sessionId) {
  const r = rooms.get(sessionId);
  if (r && r.hosts.size === 0 && r.viewers.size === 0) {
    rooms.delete(sessionId);
    roomCfg.delete(sessionId);
    recentTts.delete(sessionId);
  }
}

/* 폰 PTT(누르고 말하기) 파이프라인: 폰 마이크 오디오 → Soniox 양방향 번역 →
   호스트·뷰어에 브로드캐스트(+TTS). 호스트 설정(roomCfg)을 재사용. */
function startTalkPipeline(sessionId, side) {
  if (!SONIOX_API_KEY) return null;
  const cfg = roomCfg.get(sessionId) || {};
  const a = SONIOX_LANGS.includes(cfg.sxA) ? cfg.sxA : 'ko';
  const b = SONIOX_LANGS.includes(cfg.sxB) ? cfg.sxB : (cfg.sxMode === 'one' && SONIOX_LANGS.includes(cfg.sxTarget) ? cfg.sxTarget : 'en');
  const config = {
    api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
    enable_language_identification: true, enable_endpoint_detection: true,
    endpoint_sensitivity: cfg.sens || 0, max_endpoint_delay_ms: cfg.maxDelay || 2000, endpoint_latency_adjustment_level: cfg.latency || 0,
    language_hints: [a, b], translation: { type: 'two_way', language_a: a, language_b: b },
    client_reference_id: 'u:' + ((getSession(sessionId) || {}).owner || 'anon'), // 유저별 사용량(발화자는 익명 뷰어 → 세션 소유자로 귀속)
    ...((() => { const c = buildSonioxContext([a, b]); return c ? { context: c } : {}; })()), // 고유명사/번역 설정(활성 쌍)
  };
  const sx = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
  let ready = false; const pending = [];
  let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommit = '', lastCommitAt = 0;
  const targetKeyFor = (src) => (src === a ? b : a);
  const clearCard = (id) => { const m0 = { type: 'sentence', id, side, source: null, texts: {} }; broadcast(sessionId, m0); sendToHosts(sessionId, m0); };
  const commit = () => {
    const id = curId, txt = finalText.trim(), src = curSrc, tgt = (finalTrans.trim() || lastTrans).trim();
    curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = '';
    if (!id || !txt) { if (id) clearCard(id); return; } // 비확정만 있던 고스트 카드 제거
    // TTS 자기음성 재입력(에코) → 버리고 화면에서도 제거
    if (isSelfEcho(sessionId, txt)) { clearCard(id); return; }
    const out = tgt || txt;
    if (out === lastCommit && Date.now() - lastCommitAt < 5000) return;
    lastCommit = out;
    lastCommitAt = Date.now();
    const target = targetKeyFor(src || a);
    const msg = applyItem(sessionId, id, side, { [target]: out }, txt);
    broadcast(sessionId, msg); sendToHosts(sessionId, msg);
    if (cfg.ttsOn) {
      const voiceId = cartesiaVoiceId(target, cfg.gender || 'f');
      noteTts(sessionId, out); // 에코 필터 등록
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
    if (endHit) commit(); // 길이 기반 강제 확정 제거 — 문장 중간 절단이 오역·언어 오인식 유발
  });
  sx.on('error', () => {});
  return {
    feed: (data) => { if (ready) { try { sx.send(data); } catch {} } else { pending.push(data); if (pending.length > 24) pending.shift(); } }, // 연결 전 큐는 최근 ~2초만
    stop: () => { try { sx.send(''); } catch {} try { sx.close(); } catch {} },
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
  ws.send(JSON.stringify({ type: 'ptt-state', busy: pttBusy(room) })); // 발화 가능 여부(배타 락)
  {
    const dc = deskCtrl.get(ws._session);
    const gs = dc && dc.guestSens ? dc.guestSens() : undefined;
    if (s && s.sxInfo) ws.send(JSON.stringify({ type: 'meta', sxInfo: s.sxInfo, ...(gs != null ? { guestSens: gs } : {}) })); // 접속/재접속 시 현재 상태 동기화
  }
  broadcast(ws._session, { type: 'viewers', count: room.viewers.size }); // 뷰어 수(랜딩 표시)
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // 데스크 여객 태블릿 마이크(2채널) — desk-mic on 을 보낸 뷰어의 오디오는 여객 채널로
      if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.feedGuest) { dc.feedGuest(data, ws); return; } }
      if (talk) talk.feed(data);
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'audioSub') ws._audioWanted = !!m.on;
      else if (m.type === 'ptt') {
        // 뷰어 PTT 는 GET /api/sessions 가 viewerPTT=true 로 알려주는 세션(soniox 양방향 계열)에서만.
        // 서버에서도 동일 조건을 강제 — 조작된 클라이언트가 임의/존재하지 않는 세션에 유료 엔진을 열거나
        // 타인 세션 기록에 문장을 주입하는 것 차단.
        const sess = getSession(ws._session);
        const pttAllowed = sess && sess.pipeline === 'soniox' && ['twoway', 'mobile', 'field', 'meeting'].includes(sess.preset || '');
        if (!pttAllowed) return;
        const r = getRoom(ws._session);
        if (m.on) {
          // 발화 배타: 호스트가 말하는 중이거나 다른 뷰어가 발화 중이면 거절
          if (r.hostTalking || (r.speaking && r.speaking !== ws)) { ws.send(JSON.stringify({ type: 'ptt-denied' })); return; }
          r.speaking = ws;
          broadcastPttState(ws._session);
          if (!talk) talk = startTalkPipeline(ws._session, 'right');
          if (!talk) ws.send(JSON.stringify({ type: 'status', message: '음성 입력 불가 — SONIOX_API_KEY 미설정' }));
        } else {
          if (r.speaking === ws) { r.speaking = null; broadcastPttState(ws._session); }
          if (talk) { talk.stop(); talk = null; }
        }
      } else if (m.type === 'desk-start') {
        // 데스크: 손님이 태블릿에서 언어 선택 → 호스트 파이프라인에서 soniox 양방향 통역 시작
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl) ctrl.start(String(m.lang || '').toLowerCase());
        else ws.send(JSON.stringify({ type: 'status', message: '안내원이 아직 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.' }));
      } else if (m.type === 'desk-end') {
        // 데스크: 손님 화면의 종료(✕) — 대화 종료 후 대기 모드로
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl) ctrl.end();
      } else if (m.type === 'desk-keepalive') {
        // 데스크: 종료 예고 배너 터치 → 무음 타이머 연장
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.keepalive) ctrl.keepalive();
      } else if (m.type === 'desk-mic') {
        // 데스크: 여객 태블릿 마이크 채널 on/off — 2채널 화자 귀속
        ws._deskMic = !!m.on;
        const ctrl = deskCtrl.get(ws._session);
        if (ctrl && ctrl.guestMic) ctrl.guestMic(!!m.on, ws);
      }
    } catch {}
  });
  ws.on('close', () => {
    room.viewers.delete(ws);
    if (talk) { talk.stop(); talk = null; }
    if (room.speaking === ws) { room.speaking = null; broadcastPttState(ws._session); } // 발화 중 이탈 → 락 해제
    if (ws._deskMic) { const dc = deskCtrl.get(ws._session); if (dc && dc.guestMic) dc.guestMic(false, ws); } // 여객 마이크 이탈 → 단일 채널 폴백
    broadcast(ws._session, { type: 'viewers', count: room.viewers.size });
    maybeGcRoom(ws._session);
  });
}

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
function handleHost(ws) {
  const sessionId = ws._session;
  const side = ws._src === 'system' ? 'left' : 'right'; // 시스템=좌, 마이크=우
  const session = getSession(sessionId);
  // 동시접속 충돌 방지: 같은 세션·같은 소스로 이미 녹음 중인 연결이 있으면 그쪽을 종료하고 새 연결이 승계.
  // (같은 계정으로 다른 기기/탭에서 시작하거나, 새로고침 후 좀비 연결이 남은 경우 — 나중 연결 우선)
  for (const h of [...getRoom(sessionId).hosts]) {
    if (h !== ws && h._src === ws._src) {
      try { h.send(JSON.stringify({ type: 'takeover' })); } catch {}
      try { h.close(); } catch {}
    }
  }
  // 폰 PTT 결과를 이 호스트 화면에도 보내기 위해 room.hosts 에 등록 + 활성 신호
  getRoom(sessionId).hosts.add(ws);
  broadcast(sessionId, { type: 'host', active: true });
  // 마이크 캡처 연결 = 호스트 발화 상태(발화 배타 락). '발화 멈춤' 토글은 micState 메시지로 갱신.
  if (side === 'right') { getRoom(sessionId).hostTalking = true; broadcastPttState(sessionId); }
  ws.on('close', () => {
    const r = rooms.get(sessionId);
    if (r) {
      r.hosts.delete(ws);
      // 승계된 새 연결이 남아 있으면 발화 상태 유지(takeover 시 구 연결 close 가 늦게 도착하는 경우)
      if (side === 'right' && ![...r.hosts].some((h) => h._src !== 'system')) { r.hostTalking = false; broadcastPttState(sessionId); }
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
  // lang = 발화(원문) 언어 — 데스크 뷰어가 말풍선 좌우(안내원/손님)를 번역 도착 전에 판단하는 데 사용.
  // sideOv = 채널별 side 오버라이드(데스크 여객 마이크 채널='left', 기본은 이 연결의 소스 기준).
  const buildMsg = (id, item) => ({ type: 'sentence', id, side: item.side || side, source: item.source || null, texts: item.texts, speaker: item.speaker || null, ...(item.lang ? { lang: item.lang } : {}) });
  // 화면에만 보냄(저장 안 함) — translate 스트리밍/whisper 진행표시용
  const liveSend = (id, langTexts, source, speaker, lang, sideOv) => {
    const m = { type: 'sentence', id, side: sideOv || side, source: source || null, texts: langTexts, speaker: speaker || null, ...(lang ? { lang } : {}) };
    toHost(m);
    broadcast(sessionId, m);
  };
  // 확정: 세션 저장 + 전송. 언어별로 병합.
  const upsertItem = (id, langTexts, source, speaker, lang, sideOv) => {
    let item;
    if (session) {
      item = session.items.find((x) => x.id === id);
      if (item) {
        item.texts = { ...(item.texts || {}), ...langTexts };
        if (source) item.source = source;
        if (speaker) item.speaker = speaker;
        if (lang) item.lang = lang;
      } else {
        item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, speaker: speaker || null, ...(lang ? { lang } : {}) };
        session.items.push(item);
      }
      if (session.title === '새 세션' && session.items.length === 1) {
        const first = Object.values(item.texts)[0] || '';
        if (first) session.title = first.slice(0, 40);
      }
      session.updatedAt = Date.now();
      saveSessions();
    } else {
      // 세션이 삭제된 뒤에도 채널 귀속(side/lang)이 유지되도록 폴백에도 오버라이드 반영
      item = { id, side: sideOv || side, source: source || null, texts: { ...langTexts }, ...(lang ? { lang } : {}) };
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  if (pipeline === 'translate') runTranslate();
  else if (pipeline === 'deepgram') runDeepgram();
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
    const L4 = ['ko', 'en', 'ja', 'zh']; // 미지정 시 기본 언어 힌트
    const okL = (c) => SONIOX_LANGS.includes(c); // 선택지는 soniox 지원 언어 전체
    const sxMode = ws._sxMode === 'two' ? 'two' : 'one';
    const sxTarget = okL(ws._sxTarget) ? ws._sxTarget : 'en';
    const sxA = okL(ws._sxA) ? ws._sxA : 'ko';
    const sxB = okL(ws._sxB) ? ws._sxB : 'en';
    let ttsOn = ws._tts === '1' && !!CARTESIA_API_KEY; // 확정 문장마다 Cartesia TTS 음성 출력(녹음 중 토글 가능)
    let gender = ws._gender === 'm' ? 'm' : 'f'; // 음성 성별(출력언어별 보이스 자동 선택)
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
      client_reference_id: 'u:' + (ws._userId || 'anon'), // 유저별 사용량 집계(usage-logs 에 기록)
      // 고유명사/번역 설정 주입 — 이 세션에서 쓰이는 언어의 표기·번역쌍만 조립
      ...((() => { const c = buildSonioxContext(sxMode === 'two' ? [sxA, sxB] : [sxTarget, ...(inLang ? [inLang] : L4)]); return c ? { context: c } : {}; })()),
    };

    let sx = null;          // 현재 엔진 소켓(예기치 않은 끊김 시 자동 재연결)
    let sxReady = false;
    let sxClosed = false;   // 사용자 중지/유휴 종료 — 재연결 금지
    let pending = [];
    idleClose = () => { sxClosed = true; try { sx && sx.close(); } catch {} };
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
    let curSrc = '';      // 감지된 입력 언어(토큰 다수결 — 첫 단어 오인식 교정)
    let langVotes = {};   // 언어별 토큰 수
    let curSpeaker = '';  // 현재 발화 화자(diarization)
    let lastCommitText = ''; // 직전 확정 텍스트(연속 중복 카드 방지)
    let lastCommitAt = 0;    // 직전 확정 시각 — 중복 판정은 5초 창 안에서만
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
      noteTts(sessionId, tx); // 자기음성(에코) 필터에 등록 — 재입력 시 인식 결과를 버림
      // 뷰어(음성 듣기 구독자) + 호스트(TTS 켠 경우)에게 재생. 재입력은 AEC + 에코 필터로 차단.
      ttsChain = ttsChain.then(() => cartesiaTTSStream(tx, voiceId, lang, (b64) => {
        broadcastAudio(sessionId, b64);
        if (ws._audioOut) sendAudioToHosts(sessionId, b64);
      }).catch(() => {}));
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
      const id = curId, txt = stripFillers(finalText.trim()), src = curSrc, spk = curSpeaker;
      const tgt = stripFillers((finalTrans.trim() || lastTrans).trim());
      const tail = ttsPending;            // 종결부호 없이 남은 마지막 조각
      const hadFinal = !!finalTrans.trim(); // 발화 중 확정 번역이 흘러갔는지
      curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; curSpeaker = ''; ttsPending = ''; langVotes = {};
      // 화자 구분 켰는데 엔진이 화자 정보를 한 번도 안 줬으면 1회 안내(진단)
      if (diar && !sawSpeaker && !noSpkWarned) { noSpkWarned = true; toHost({ type: 'status', message: '화자 구분: 엔진이 화자 정보를 반환하지 않음(번역/엔드포인트와 동시 사용 시 발생 가능)' }); }
      if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던 고스트 카드 제거
      // TTS 자기음성 재입력(에코) → 확정하지 않고 화면 표시도 제거
      if (isSelfEcho(sessionId, txt)) { liveSend(id, {}, null, null); return; }
      const out = tgt || txt;
      // 직전 카드와 동일한 내용이 '5초 안에' 반복되면 중복(에코)으로 스킵 — 시간이 지난 의도적 반복 발화는 허용
      if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
      lastCommitText = out;
      lastCommitAt = Date.now();
      const target = targetKeyFor(src);
      upsertItem(id, { [target]: out }, txt, spkLabel(spk));
      // 실시간 TTS: 발화 중 문장 단위로 이미 흘려보냈고, 여기선 남은 꼬리만 합성.
      //  재입력은 브라우저 AEC(마이크 경로) + 서버 에코 텍스트 필터(시스템 캡처·기기 간 경로)로 차단.
      if (ttsOn) {
        ttsLang = target;
        const tl = tail.trim();
        if (tl) speakTts(tl);                       // 종결부호 없이 남은 번역 꼬리
        else if (!hadFinal) speakTts(out);          // 발화 중 합성된 게 없으면(번역 미확정) 전체 합성
      }
    };

    // 엔진 연결(끊기면 자동 재연결 — 이전에는 재연결이 없어 '진행 중'처럼 보이며 무음이 지속됐음)
    function connectEngine() {
      if (sxClosed || idleStopped) return;
      const cur = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
      sx = cur;
      cur.on('open', () => {
      if (sx !== cur) return;
      try { cur.send(JSON.stringify(config)); } catch {} // config 먼저
      sxReady = true;
      if (pending.length > 24) pending = pending.slice(-24); // 연결 대기 중 쌓인 오디오는 최근 ~2초만
      while (pending.length) { try { cur.send(pending.shift()); } catch {} }
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
          // 입력 언어는 첫 토큰이 아니라 '다수결'로 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
          const lg = t.language ? String(t.language).split('-')[0].toLowerCase() : '';
          if (lg) { langVotes[lg] = (langVotes[lg] || 0) + 1; if (!curSrc || langVotes[lg] > (langVotes[curSrc] || 0)) curSrc = lg; } // 동률에선 유지(방향 플립 방지)
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
      if (endHit) commit(); // 길이 기반 강제 확정 제거
    });
    cur.on('error', (e) => { if (sx === cur) toHost({ type: 'status', message: 'Soniox 오류: ' + (e && e.message || e) }); });
    cur.on('close', () => {
      if (sx !== cur) return;
      sxReady = false; // 끊긴 소켓으로 send 하지 않도록(이전엔 true 로 남아 조용히 버려졌음)
      if (!sxClosed && !idleStopped) {
        toHost({ type: 'status', message: '엔진 재연결 중…' });
        setTimeout(() => { if (sx === cur && !sxClosed && !idleStopped) connectEngine(); }, 800);
      } else {
        toHost({ type: 'status', message: '엔진 연결 종료 (Soniox)' });
      }
    });
    }
    connectEngine();

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (sxReady && sx) { try { sx.send(data); } catch {} }
        else { pending.push(data); if (pending.length > 24) pending.shift(); } // 재연결 중 큐는 최근 ~2초만(지연 누적 방지)
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') {
          sxClosed = true;
          try { sx && sx.send(''); } catch {} // 빈 프레임 = graceful end
          try { sx && sx.close(); } catch {}
        } else if (m.type === 'tts') {
          // 녹음 중 TTS 토글: 호스트 재생 여부 + 합성 on/off
          ws._audioOut = !!m.on;
          ttsOn = !!m.on && !!CARTESIA_API_KEY;
          if (m.gender === 'm' || m.gender === 'f') gender = m.gender;
          if (!!m.on && !CARTESIA_API_KEY) toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 재생을 사용할 수 없습니다.' });
          if (ttsOn) { const wLang = sxMode === 'two' ? 'ko' : sxTarget; cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then(() => {}).catch(() => {}); }
        } else if (m.type === 'micState') {
          // 호스트 발화/멈춤 → 발화 배타 락 갱신(뷰어 발화 버튼 활성/비활성)
          const r = getRoom(sessionId);
          r.hostTalking = !m.muted;
          broadcastPttState(sessionId);
        }
      } catch {}
    });
    ws.on('close', () => { sxClosed = true; try { sx && sx.close(); } catch {} });
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
    const GUEST_LANGS = ['en', 'ja', 'zh', 'vi', 'th', 'id', 'ru']; // 손님(또는 호스트)이 고르는 언어(soniox two_way 지원, 한국어 제외)
    let deskIdleMs = Math.min(120000, Math.max(5000, Number(ws._deskIdle) || 30000)); // 무음 → 대화 종료(기본 30초). 'desk-idle' 메시지로 응대 중에도 변경 가능
    // 여객 태블릿 마이크 민감도(0~100, 50=기존 고정값과 동일) — 뷰어의 근접 게이트 임계로 변환돼 적용
    let guestSens = Math.min(100, Math.max(0, Number(ws._deskGuestSens) >= 0 ? Number(ws._deskGuestSens) : 50));
    const sendGuestSens = () => { const m = { type: 'desk-guest-sens', value: guestSens }; broadcast(sessionId, m); };

    let phase = 'idle';     // 'idle'(대기, soniox 없음) | 'active'(통역 중)
    let lockedB = null;     // 손님 언어
    let sx = null, sxReady = false;
    let closed = false;     // 호스트 중지/종료 — 자동 재연결 금지 플래그
    let pending = [];
    let foreignTimer = null;
    let warnTimer = null;       // 무음 종료 10초 전 예고
    let pendingWayfind = null;  // 호스트 승인 대기 중인 길안내 제안
    let convStartedAt = 0;      // 현재 응대 시작 시각(통계용)

    // ---- 여객(뷰어 태블릿) 마이크 채널 — 2채널 화자 귀속 프로토타입 ----
    // 뷰어가 desk-mic on 을 보내고 바이너리 오디오를 올리면 별도 soniox one_way(선택언어→ko)로 처리.
    // 채널 자체가 화자 귀속이므로 언어 추정이 필요 없고, 동시 발화도 채널별로 독립 인식된다.
    let guestMicOn = false;
    let gsx = null, gsxReady = false;
    let gPending = [];
    let gCurId = null, gFinalText = '', gFinalTrans = '', gLastTrans = '', gLastCommitText = '';
    let gLastCommitAt = 0;
    let gCurSrc = '', gLangVotes = {}; // 여객 채널 감지 언어(다수결) — 안내원(ko) 누화 판정용
    const recentCommits = [];   // 교차 중복(누화) 필터: [{ n, at, ch }]
    const chStats = { staff: 0, guest: 0, crossDrops: 0 }; // 누화율 측정용(deskLog 에 저장)

    // 교차 채널 누화 판정: 반대 채널이 8초 내 유사 문장을 확정했으면 누화(마이크로 샌 소리)로 드랍.
    // 근접 게이트·언어 소유권을 통과한 잔여 누화의 마지막 방어선.
    // (두 엔진의 endpoint 시점이 벌어져 5초 창을 새던 문제 → 8초, 짧은 발화도 → 4자)
    // 원문뿐 아니라 번역문도 교차 대조 — 한 발화가 양쪽 마이크에 비슷한 음량으로 들어가 언어 판별까지
    // 엇갈린 경우(예: 손님 발화가 데스크 채널에서 한국어로 오인식), 원문 문자는 서로 달라도
    // "손님 채널의 한국어 번역 ↔ 데스크 채널의 한국어 원문"이 유사해 여기서 걸린다.
    const crossDup = (ch, txt, tgt) => {
      const n = echoNorm(txt);
      const nt = echoNorm(tgt || '');
      const now = Date.now();
      while (recentCommits.length && now - recentCommits[0].at > 8000) recentCommits.shift();
      const hit = recentCommits.some((e) => e.ch !== ch && (
        (n.length >= 4 && (echoMatch(n, e.n) || (e.nt.length >= 4 && echoMatch(n, e.nt)))) ||
        (nt.length >= 4 && (echoMatch(nt, e.n) || (e.nt.length >= 4 && echoMatch(nt, e.nt))))
      ));
      if (hit) return true;
      recentCommits.push({ n, nt, at: now, ch });
      return false;
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
    const baseConfig = (langs) => ({
      api_key: SONIOX_API_KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
      client_reference_id: 'u:' + (ws._userId || 'anon'), // 유저별 사용량 집계
      enable_language_identification: true, enable_endpoint_detection: true,
      endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
      max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
      endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
      ...((() => { const c = buildSonioxContext(langs, { desk: true }); return c ? { context: c } : {}; })()), // 데스크: 항공용어 카테고리 제외
    });
    // 손님이 한국어를 고르면 two_way 가 성립하지 않으므로 전부 한국어로 표기(one_way→ko)
    // 2채널(여객 태블릿 마이크 on)에서는 이 채널이 안내원 전용 → one_way(ko→손님 언어) + 힌트 ko 고정.
    //   기기=채널로 화자가 물리적으로 확정돼 있어 two_way 언어 자동판별의 방향 뒤집힘이 사라지고,
    //   언어 힌트가 집중돼 인식도 좋아진다. 여객 채널(gsx)은 원래 one_way(손님 언어→ko) → 합쳐서 one_way×2.
    //   단일 마이크 폴백(여객 마이크 off)은 한 스트림에 두 언어가 섞이므로 two_way 유지(그게 올바른 용처).
    const configFor = () => {
      if (lockedB && lockedB !== A) {
        return guestMicOn
          ? { ...baseConfig([A, lockedB]), language_hints: [A], translation: { type: 'one_way', target_language: lockedB } }
          : { ...baseConfig([A, lockedB]), language_hints: [A, lockedB], translation: { type: 'two_way', language_a: A, language_b: lockedB } };
      }
      // 자동 감지 중: 언어 미정 → one_way(→ko) + 광역 힌트로 첫 발화 언어를 파악
      return { ...baseConfig([A]), language_hints: autoDetect ? [A, ...GUEST_LANGS] : [A], translation: { type: 'one_way', target_language: A } };
    };

    const setMeta = () => {
      const sxInfo = phase === 'active'
        ? (lockedB && lockedB !== A ? { mode: 'two', a: A, b: lockedB } : (autoDetect ? { mode: 'detect' } : { mode: 'one', target: A }))
        : { mode: 'idle' };
      if (session) { session.sxInfo = sxInfo; if (phase === 'active' && lockedB) session.langs = [A, lockedB]; saveSessions(); }
      broadcast(sessionId, { type: 'meta', sxInfo, guestSens });
      toHost({ type: 'meta', sxInfo, guestSens });
    };

    let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommitText = '';
    let lastCommitAt = 0; // 중복 판정은 5초 창 안에서만(의도적 반복 발화 허용)
    let autoDetect = false; // 'Other languages' 시작 — 첫 발화의 언어를 감지해 two_way 로 전환
    let langVotes = {}; // 입력 언어 다수결(첫 단어 오인식 교정)
    const targetKeyFor = (src) => (lockedB && lockedB !== A ? (src === A ? lockedB : A) : A);
    const resetUtterance = () => { curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; langVotes = {}; };

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
      resetUtterance();
      if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던(또는 추임새뿐인) 고스트 카드 제거
      // 자동 감지: 소유권·누화 판정으로 드랍되더라도 언어는 먼저 잠근다(첫 발화 유실 방지)
      lockDetected(src);
      // 언어 소유권: 2채널 모드에서 손님 언어 발화는 여객 채널 소유 → 데스크 마이크 누화로 드랍
      if (!staffOwns(src)) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
      // 여객 채널이 이미 확정한 문장과 유사 → 데스크 마이크로 샌 누화, 드랍(화면 카드도 제거)
      if (guestMicOn && crossDup('staff', txt, tgt)) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
      chStats.staff++;
      const out = tgt || txt;
      if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
      lastCommitText = out;
      lastCommitAt = Date.now();
      upsertItem(id, { [targetKeyFor(src)]: out }, txt, null, src || null);
      // 길안내: 안내원(한국어) '답변'에서 시설 언급 감지 → 목적지 전송.
      // 외국인 질문이 아니라 직원 답변 기준 — 직원의 현장판단(보안구역·특정 시설 지목)을 반영하고,
      // 기계번역이 아닌 원어민 한국어 원문(txt)에서 매칭하므로 정확도가 높다.
      if (phase === 'active' && src === A && txt) {
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
                saveSessions();
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
    const endConversation = () => {
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      pendingWayfind = null;
      // 종료 절차 중 commit() 의 자동감지 분기(양방향 재체결·desk-active 브로드캐스트)가 발동하지 않도록
      autoDetect = false;
      // 승계(takeover)로 밀려난 구 파이프라인의 지연 close/타이머가 새 호스트의 진행 중 응대를
      // 아카이브·리셋하지 못하게 — 현재 등록된 컨트롤러만 공유 세션을 만진다.
      if (deskCtrl.get(sessionId) !== ctrl) { phase = 'idle'; lockedB = null; resetUtterance(); closeSx(); closeGuest(); return; }
      // 사용량: 실제 통역(active) 시간만 누적 — 대기(idle) 시간이 사용량으로 집계되던 문제 수정
      if (phase === 'active' && convStartedAt) ws._deskActiveMs = (ws._deskActiveMs || 0) + (Date.now() - convStartedAt);
      ws._deskActiveStart = 0;
      guestCommit(); // 손님의 마지막 미확정 발화도 기록에 남김
      commit();
      if (session) {
        if (Array.isArray(session.items) && session.items.length) {
          session.deskLog = session.deskLog || [];
          // stats: 채널별 확정 수 + 누화 드랍 수 — 2채널 프로토타입 누화율 측정용
          session.deskLog.push({ startedAt: convStartedAt || null, endedAt: Date.now(), lang: lockedB, items: session.items, stats: { ...chStats } });
          if (session.deskLog.length > 200) session.deskLog = session.deskLog.slice(-200); // 보존 상한
          session.items = [];
        }
        saveSessions();
      }
      if (chStats.staff + chStats.guest + chStats.crossDrops > 0) console.log(`[desk] 채널 통계 staff=${chStats.staff} guest=${chStats.guest} crossDrops=${chStats.crossDrops}`);
      chStats.staff = 0; chStats.guest = 0; chStats.crossDrops = 0;
      recentCommits.length = 0;
      gLastCommitText = '';
      lastCommitText = '';
      phase = 'idle'; lockedB = null; autoDetect = false; resetUtterance();
      pending = [];
      closeSx();
      closeGuest(); // 여객 채널 종료(guestMicOn 플래그는 유지 — 다음 응대에서 재연결)
      broadcast(sessionId, { type: 'desk-reset' });
      toHost({ type: 'desk-reset' });
      broadcast(sessionId, { type: 'snapshot', items: [] });
      setMeta();
      toHost({ type: 'status', message: '대화 종료 — 대기 중(언어 선택 대기)' });
    };

    // 통역 시작: 손님(뷰어)이 언어를 고르거나 호스트가 수동 시작 — 이때 처음 soniox 연결
    const startConversation = (B) => {
      if (closed) return;
      const auto = B === 'auto'; // 'Other languages' — 첫 발화 언어를 감지해 two_way 전환
      const lang = auto ? null : (GUEST_LANGS.includes(B) ? B : 'en');
      if (phase === 'active' && !auto && lang === lockedB) return;
      if (phase !== 'active') { convStartedAt = Date.now(); ws._deskActiveStart = convStartedAt; } // 응대 시작 시각(통계·사용량용)
      phase = 'active'; lockedB = lang; autoDetect = auto; lastCommitText = ''; resetUtterance();
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
      const next = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
      sx = next;
      next.on('open', () => {
        try { next.send(JSON.stringify(configFor())); } catch {}
        sxReady = true;
        while (pending.length) { try { next.send(pending.shift()); } catch {} }
      });
      // 종료(idle)·소켓 교체 후 늦게 도착한 토큰이 다음 응대 화면·기록에 새지 않도록 가드
      next.on('message', (raw) => { if (sx === next && phase === 'active') onSxMessage(raw); });
      next.on('error', (e) => toHost({ type: 'status', message: 'Soniox 오류: ' + ((e && e.message) || e) }));
      // 통역 중 연결이 예기치 않게 끊기면 자동 재연결 — 응대 중 멈춤 방지
      next.on('close', () => {
        if (sx === next && !closed && phase === 'active') {
          sxReady = false; // 죽은 소켓으로 send 하지 않고 재연결까지 pending 큐에 쌓이도록(발화 앞부분 유실 방지)
          toHost({ type: 'status', message: '엔진 재연결 중…' });
          setTimeout(() => { if (sx === next && !closed && phase === 'active') connectSx(); }, 800);
        }
      });
      try { if (old && old !== next) old.close(); } catch {}
    }

    function onSxMessage(raw) {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
      const toks = ev.tokens || [];
      if (!toks.length) return;
      if (phase === 'active') armForeignTimer(); // 어떤 발화든(안내원 한국어 포함) 들리면 무음 타이머 리셋
      let endHit = false, nonFinal = '', nonFinalTrans = '';
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        if (t.translation_status === 'translation') {
          if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text;
        } else {
          // 입력 언어는 토큰 다수결 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
          const lang = t.language ? String(t.language).split('-')[0].toLowerCase() : '';
          if (lang) { langVotes[lang] = (langVotes[lang] || 0) + 1; if (!curSrc || langVotes[lang] > (langVotes[curSrc] || 0)) curSrc = lang; } // 동률에선 유지(방향 플립 방지)
          if (t.is_final) finalText += t.text; else nonFinal += t.text;
        }
      }
      const shownSrc = (finalText + nonFinal).trim();
      const shownTgt = (finalTrans + nonFinalTrans).trim();
      if (shownTgt) lastTrans = shownTgt;
      if (!curId && (shownSrc || shownTgt)) curId = newId();
      // 2채널 모드: 손님 언어로 감지된 진행 중 발화는 표시하지 않음(커밋 시 드랍될 누화의 이중 표시 방지)
      if (curId) {
        if (!staffOwns(curSrc)) liveSend(curId, {}, null, null);
        else liveSend(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null, null, curSrc || null);
      }
      if (endHit) commit(); // 길이 기반 강제 확정 제거
    }

    /* ---- 여객 채널(2채널 프로토타입): 뷰어 태블릿 마이크 → 별도 soniox one_way(선택언어→ko) ----
       언어 힌트를 손님 언어로 고정해 인식 정확도를 높이고, side='left'/lang=손님언어로 결정적 귀속.
       누화 방어: ① 뷰어 근접 게이트(작은 소리는 무음 전송) ② crossDup(교차 중복 필터). */
    const guestConfig = () => ({
      ...baseConfig(lockedB && lockedB !== A ? [A, lockedB] : [A]),
      // 자동 감지 중엔 여객 채널이 외국어를 소유 — 광역 힌트로 첫 발화 언어를 파악(ko 고정이면 감지 불가)
      language_hints: lockedB && lockedB !== A ? [lockedB] : (autoDetect ? GUEST_LANGS : [A]),
      translation: { type: 'one_way', target_language: A },
    });
    function closeGuest() {
      const old = gsx; gsx = null; gsxReady = false; gPending = [];
      gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes = {};
      if (old) { try { old.send(''); } catch {} try { old.close(); } catch {} }
    }
    function connectGuest() {
      if (closed || phase !== 'active' || !guestMicOn) return;
      const old = gsx;
      gsxReady = false;
      const next = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket');
      gsx = next;
      next.on('open', () => {
        try { next.send(JSON.stringify(guestConfig())); } catch {}
        gsxReady = true;
        // 연결 대기 중 쌓인 오디오는 최근 2초만 전송(오래된 프레임을 밀어넣으면 이후 내내 지연됨)
        if (gPending.length > 24) gPending = gPending.slice(-24);
        while (gPending.length) { try { next.send(gPending.shift()); } catch {} }
      });
      // 종료·소켓 교체 후 늦게 도착한 토큰 차단(다음 응대로 새는 문제 방지)
      next.on('message', (raw) => { if (gsx === next && phase === 'active') onGuestMsg(raw); });
      next.on('error', () => {});
      next.on('close', () => {
        if (gsx === next && !closed && phase === 'active' && guestMicOn) {
          gsxReady = false; // 재연결까지 gPending 큐에 쌓이도록(여객 발화 앞부분 유실 방지)
          setTimeout(() => { if (gsx === next && !closed && phase === 'active' && guestMicOn) connectGuest(); }, 800);
        }
      });
      try { if (old && old !== next) old.close(); } catch {}
    }
    const guestCommit = () => {
      const id = gCurId, txt = stripFillers(gFinalText.trim()), gSrc = gCurSrc;
      const tgt = stripFillers((gFinalTrans.trim() || gLastTrans).trim());
      gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes = {};
      if (!id || !txt) { if (id) liveSend(id, {}, null, null, null, 'left'); return; } // 고스트(또는 추임새뿐인) 카드 제거
      // 자동 감지(Other languages): 손님은 여객 태블릿에 대고 말하므로 이 채널에서 감지되는 게 정상 경로
      lockDetected(gSrc);
      // 언어 소유권: 한국어로 감지된 발화는 안내원 채널 소유 → 여객 마이크 누화로 드랍
      if (!guestOwns(gSrc)) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
      // 안내원 채널이 이미 확정한 문장과 유사 → 여객 마이크로 샌 누화, 드랍
      if (crossDup('guest', txt, tgt)) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
      chStats.guest++;
      const out = tgt || txt;
      if (out && out === gLastCommitText && Date.now() - gLastCommitAt < 5000) return;
      gLastCommitText = out;
      gLastCommitAt = Date.now();
      upsertItem(id, { [A]: out }, txt, null, lockedB || null, 'left');
    };
    function onGuestMsg(raw) {
      let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
      if (ev.error_code) return;
      const toks = ev.tokens || [];
      if (!toks.length) return;
      if (phase === 'active') armForeignTimer();
      let endHit = false, nonFinal = '', nonFinalTrans = '';
      for (const t of toks) {
        if (t.text === '<end>') { endHit = true; continue; }
        if (t.translation_status === 'translation') { if (t.is_final) gFinalTrans += t.text; else nonFinalTrans += t.text; }
        else {
          const lang = t.language ? String(t.language).split('-')[0].toLowerCase() : '';
          if (lang) { gLangVotes[lang] = (gLangVotes[lang] || 0) + 1; if (!gCurSrc || gLangVotes[lang] > (gLangVotes[gCurSrc] || 0)) gCurSrc = lang; }
          if (t.is_final) gFinalText += t.text; else nonFinal += t.text;
        }
      }
      const shownSrc = (gFinalText + nonFinal).trim();
      const shownTgt = (gFinalTrans + nonFinalTrans).trim();
      if (shownTgt) gLastTrans = shownTgt;
      if (!gCurId && (shownSrc || shownTgt)) gCurId = newId();
      // 한국어(안내원 누화)로 감지된 진행 중 발화는 표시하지 않음
      if (gCurId) {
        if (!guestOwns(gCurSrc)) liveSend(gCurId, {}, null, null, null, 'left');
        else liveSend(gCurId, { [A]: shownTgt }, shownSrc || null, null, lockedB || null, 'left');
      }
      if (endHit) guestCommit(); // 길이 기반 강제 확정 제거
    }
    // 뷰어의 여객 마이크 채널 on/off — 켜지면 응대 중일 때 즉시 엔진 연결, 꺼지면 단일 채널로 폴백.
    // fromWs 로 소유 소켓을 추적: 뷰어 재접속 시 구 소켓의 close 가 새 소켓의 채널을 끄지 않도록.
    let guestWs = null;
    const guestMic = (on, fromWs) => {
      if (on) guestWs = fromWs || guestWs;
      else if (fromWs && guestWs && fromWs !== guestWs) return; // 소유자가 아닌(이전) 소켓의 해제는 무시
      if (guestMicOn === !!on) return;
      guestMicOn = !!on;
      const m = { type: 'desk-guest-mic', on: guestMicOn };
      toHost(m); broadcast(sessionId, m);
      if (guestMicOn && phase === 'active') connectGuest();
      if (!guestMicOn) closeGuest();
      // 채널별 언어 고정 전환: 2채널이 되면 호스트 채널을 one_way(ko→손님 언어)로, 해제되면 two_way 로 재체결
      if (phase === 'active' && lockedB && lockedB !== A) { commit(); closeSx(); connectSx(); }
      toHost({ type: 'status', message: guestMicOn ? '여객 태블릿 마이크 연결 — 2채널(채널별 언어 고정, 단방향×2)로 동작합니다.' : '여객 태블릿 마이크 해제 — 데스크 마이크 단일 채널(양방향)로 동작합니다.' });
    };

    ws.on('message', (data, isBinary) => {
      // 대기(idle) 중에는 오디오를 버림(STT 세션 없음 — 비용 0). 통역 중에만 soniox 로 전달.
      if (isBinary) {
        if (phase !== 'active') return;
        if (sxReady && sx) { try { sx.send(data); } catch {} } else { pending.push(data); if (pending.length > 24) pending.shift(); } // 연결 전 큐는 최근 ~2초만
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
            if (session && Array.isArray(session.wayfindLog) && session.wayfindLog.length) { session.wayfindLog[session.wayfindLog.length - 1].shown = true; saveSessions(); }
            pendingWayfind = null;
          }
        }
        else if (m.type === 'wayfind-dismiss') { pendingWayfind = null; } // 제안 무시
      } catch {}
    });
    ws.on('close', () => {
      const wasActive = phase === 'active';
      closed = true;
      clearTimeout(foreignTimer);
      clearTimeout(warnTimer);
      if (deskCtrl.get(sessionId) === ctrl) deskCtrl.delete(sessionId);
      if (wasActive) endConversation(); // 응대 중 호스트 이탈 → 기록 보존 + 뷰어를 터치 화면으로
      else { closeSx(); closeGuest(); }
    });

    // 뷰어(손님)의 통역 시작/종료/연장/여객 마이크 요청을 이 파이프라인으로 전달받기 위한 컨트롤러 등록
    const ctrl = {
      start: startConversation,
      guestSens: () => guestSens, // 뷰어 접속 시 현재 여객 마이크 민감도 동기화용
      end: endConversation,
      keepalive: () => { if (phase === 'active') armForeignTimer(); },
      guestMic,
      feedGuest: (data, fromWs) => {
        if (phase !== 'active' || !guestMicOn) return; // 대기 중 여객 오디오는 버림(비용 0)
        if (guestWs && fromWs && fromWs !== guestWs) return; // 소유 태블릿 외 스트림 거절(두 태블릿 동시 desk-mic 시 오염 방지)
        if (gsxReady && gsx) {
          // 백프레셔: 엔진 쪽으로 못 내보내고 쌓이면 오래된 오디오 대신 현재 프레임을 버려 실시간 유지
          if (gsx.bufferedAmount > 262144) return;
          try { gsx.send(data); } catch {}
        } else {
          gPending.push(data);
          if (gPending.length > 24) gPending.shift(); // 연결 전 큐는 최근 ~2초만(지연 누적 방지)
        }
      },
    };
    deskCtrl.set(sessionId, ctrl);

    // 승계 복구: 응대 도중 호스트가 새로고침하면 구 파이프라인은 (컨트롤러 불일치 가드로) 세션을 못 만져
    // 진행 중이던 items 가 아카이브되지 않은 채 남는다 → 여기서 '중단된 응대'로 보존하고 뷰어를 초기화.
    // (방치하면 다음 손님의 deskLog 한 건에 이전 손님 대화가 섞여 기록됨)
    if (session && Array.isArray(session.items) && session.items.length) {
      session.deskLog = session.deskLog || [];
      session.deskLog.push({ startedAt: null, endedAt: Date.now(), lang: null, interrupted: true, items: session.items, stats: null });
      if (session.deskLog.length > 200) session.deskLog = session.deskLog.slice(-200);
      session.items = [];
      saveSessions();
      broadcast(sessionId, { type: 'desk-reset' });
      broadcast(sessionId, { type: 'snapshot', items: [] });
      toHost({ type: 'status', message: '이전 호스트의 진행 중 응대를 기록에 보존하고 대기 모드로 초기화했습니다.' });
    }

    setMeta();
    toHost({ type: 'status', message: `데스크 대기 중 — 손님이 태블릿에서 언어를 선택하면 통역이 시작됩니다. (무음 ${deskIdleMs / 1000}초 시 자동 종료)` });
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
    dg.on('close', () => { dgReady = false; toHost({ type: 'status', message: '엔진 연결 종료 (Deepgram)' }); }); // 죽은 소켓으로 send 방지

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        if (dgReady) dg.send(data);
        else { pending.push(data); if (pending.length > 24) pending.shift(); } // 연결 전 큐 상한(무한 증가 방지)
        return;
      }
      try {
        const m = JSON.parse(data.toString());
        if (m.type === 'stop') { try { dg.send(JSON.stringify({ type: 'CloseStream' })); } catch {}; try { dg.close(); } catch {} }
      } catch {}
    });
    ws.on('close', () => { try { dg.close(); } catch {} });
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
    oa.on('close', () => { oaReady = false; toHost({ type: 'status', message: '엔진 연결 종료' }); }); // 죽은 소켓으로 send 방지

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
