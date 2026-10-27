/* 저장소 — 메모리 상태(세션·사용자·프로필·사용량·용어·데스크 정의) + 파일/MongoDB 영속화 + 저장 암호화.
   상태는 이 모듈이 소유한다. 다른 모듈은 import 로 읽고(라이브 바인딩), 재할당이 필요하면 set*() 을 쓴다. */
import fs from 'fs';
import path from 'path';
import { DATA_DIR, MONGODB_URI, MONGODB_DB, PRICE_WHISPER_PER_MIN, PRICE_TRANSLATE_PER_MIN } from '../config.js';
import { deriveDataKey, encryptData, decryptData } from '../util/security_util.js';
import { kstDay } from '../util/pipeline_util.js';
import { metrics } from '../metrics.js';

/* ================================================================== */
/*  세션 영속화 (data/sessions.json)                                   */
/*  세션: { id, title, createdAt, updatedAt, outLang, items:[          */
/*          { id, side:'left'|'right', text } ] }                      */
/* ================================================================== */

/* ---- 저장 데이터 암호화(파일 모드): DATA_KEY 설정 시 AES-256-GCM ----
   DATA_KEY(임의의 긴 문자열)를 scrypt 로 32바이트 키로 파생해 data/*.json 을 암호화 저장.
   기존 평문 파일은 그대로 읽히고, 다음 저장부터 암호문으로 바뀐다(점진 마이그레이션).
   Mongo 사용 시에는 Atlas 저장소 암호화(기본 제공)를 사용 — SECURITY_GUIDE.md 참고. */
const DATA_KEY_RAW = process.env.DATA_KEY || '';
export const dataKey = DATA_KEY_RAW ? deriveDataKey(DATA_KEY_RAW) : null;
export function writeDataFile(file, jsonStr) {
  // 원자적 쓰기(임시파일 → rename): 저장 도중 프로세스가 죽어도 기존 파일이 온전히 남는다.
  // (직접 덮어쓰면 반쯤 쓰인 파일이 다음 부팅에서 파싱 실패 → 세션/사용자 전체가 조용히 초기화됨)
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, dataKey ? encryptData(dataKey, jsonStr) : jsonStr);
  fs.renameSync(tmp, file);
}
export function readDataFile(file) {
  return decryptData(dataKey, fs.readFileSync(file, 'utf8')); // 평문(기존 데이터)은 그대로 — 다음 저장 시 암호화됨
}

const DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const USAGE_HOURLY_FILE = path.join(DATA_DIR, 'usage_hourly.json');
const TERMS_FILE = path.join(DATA_DIR, 'terms_config.json'); // 고유명사/번역 설정(전역, Soniox context)
const VENDOR_USAGE_FILE = path.join(DATA_DIR, 'vendor_usage.json'); // 벤더 실사용량 일별 누적(무기한 보관)
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json'); // 사용자별 프로필(이메일·환경설정) — 관리자(가상 사용자)도 포함

export let sessions = [];  // 메모리 캐시(항상 진실의 원천)
export let users = [];     // 생성된 사용자 { id, username, salt, hash, role, createdAt, usageMs }
export let usageDaily = {}; // { 'YYYY-MM-DD': { whisperMs, translateMs } } — 파이프라인별 사용시간 일별 집계
export let usageHourly = {}; // { 'YYYY-MM-DDTHH': { whisperMs, translateMs } } — 시간대별 집계(UTC)
// 벤더 실사용량 일별 누적 — 벤더 API 는 조회 보관기간(예: Soniox 91일)이 있어 그 뒤엔 못 꺼내므로
// 여기 계속 쌓아 무기한 보관한다. { soniox:{date:{audioMs,costUsd,requests}}, cartesia:{date:{credits}}, openai:{date:{costUsd}} }
export let vendorUsage = { soniox: {}, cartesia: {}, openai: {}, cartesiaSelf: {} }; // cartesiaSelf: 파이프라인별 자체 집계(벤더 API 는 태그 미지원)
// 전역 고유명사/번역 설정 — 세션(Soniox) 연결 시 context로 주입. 관리자만 수정, 전원 열람.
export let termsConfig = { version: 3, servedLangs: [], categoryScope: {}, entries: [], updatedAt: 0 };
// 사용자 프로필: userId -> { id, email, prefs, updatedAt }. users 와 분리한 이유 — 관리자는 env 기반 가상 사용자라
// users 에 없지만 이메일·환경설정(폰 앱 계정 화면)은 저장돼야 한다. Map 인 이유: id 가 '__proto__' 여도 안전.
export let profiles = new Map();
export let col = null;     // Mongo sessions 컬렉션. null 이면 파일 모드.
let usersCol = null;
let usageCol = null;
let usageHourlyCol = null;
let termsConfigCol = null;
let vendorUsageCol = null;
export let profilesCol = null;

// 다른 모듈에서 재할당하는 상태(ESM import 는 읽기 전용) — 구 server.js 의 `sessions = …` 등을 대신한다
export function setSessions(v) { sessions = v; }
export function setTermsConfig(v) { termsConfig = v; }

export async function loadStore() {
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
        vendorUsageCol = db.collection('vendorUsage');
        try { await db.collection('glossary').drop(); console.log('[store] 구 glossary 컬렉션 삭제'); } catch {} // 용어집 폐기
        await col.createIndex({ id: 1 }, { unique: true });
        await usersCol.createIndex({ id: 1 }, { unique: true });
        await usageCol.createIndex({ date: 1 }, { unique: true });
        await usageHourlyCol.createIndex({ hour: 1 }, { unique: true });
        profilesCol = db.collection('profiles');
        await profilesCol.createIndex({ id: 1 }, { unique: true });
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
        if (vu) vendorUsage = { soniox: vu.soniox || {}, cartesia: vu.cartesia || {}, openai: vu.openai || {}, cartesiaSelf: vu.cartesiaSelf || {} };
        profiles = new Map((await profilesCol.find({}, { projection: { _id: 0 } }).toArray()).filter((p) => p && p.id).map((p) => [p.id, p]));
        console.log(`[store] MongoDB 연결됨 — 세션 ${sessions.length} / 사용자 ${users.length}`);
        return;
      } catch (e) {
        console.error(`[store] MongoDB 연결 실패 (시도 ${attempt}/3): ${e.message}`);
        col = usersCol = usageCol = usageHourlyCol = termsConfigCol = vendorUsageCol = profilesCol = null;
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
  // 파일별 개별 로드 — 한 파일이 손상돼도(부분 쓰기·DATA_KEY 불일치 등) 나머지 저장소는 정상 로드한다.
  // 이전에는 단일 try/catch 라 sessions.json 손상 시 이후 파일 전부가 빈 상태로 기동했고,
  // 첫 저장이 멀쩡하던 파일들을 빈 데이터로 덮어썼다. 손상 파일은 .corrupt-<ts> 로 백업해 복구 여지를 남긴다.
  try { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) { console.error('[store] data 디렉터리 생성 실패', e); }
  const loadFile = (file, apply) => {
    if (!fs.existsSync(file)) return;
    try {
      apply(JSON.parse(readDataFile(file)));
    } catch (e) {
      const bak = `${file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(file, bak); } catch {}
      console.error(`[store] ${path.basename(file)} 로드 실패 — 원본을 ${path.basename(bak)} 로 백업 후 빈 상태로 계속`, e.message || e);
    }
  };
  loadFile(DATA_FILE, (v) => { if (Array.isArray(v)) sessions = v; });
  loadFile(USERS_FILE, (v) => { if (Array.isArray(v)) users = v; });
  loadFile(USAGE_FILE, (v) => { if (v && typeof v === 'object') usageDaily = v; });
  loadFile(USAGE_HOURLY_FILE, (v) => { if (v && typeof v === 'object') usageHourly = v; });
  loadFile(TERMS_FILE, (v) => { if (v && typeof v === 'object') termsConfig = { ...v, updatedAt: v.updatedAt || 0 }; }); // 전체 보존, 구형은 부팅 마이그레이션
  loadFile(VENDOR_USAGE_FILE, (v) => { if (v && typeof v === 'object') vendorUsage = { soniox: v.soniox || {}, cartesia: v.cartesia || {}, openai: v.openai || {}, cartesiaSelf: v.cartesiaSelf || {} }; });
  loadFile(PROFILES_FILE, (v) => { if (Array.isArray(v)) profiles = new Map(v.filter((p) => p && p.id).map((p) => [p.id, p])); });
}
// Cartesia 파이프라인별 자체 집계 — 합성 요청 시 문자수·건수 누적(desk=안내데스크, live=실시간 번역)
let ttsUsageTimer = null;
export function recordTts(pipe, chars) {
  try {
    const day = kstDay(Date.now());
    const d = vendorUsage.cartesiaSelf[day] || (vendorUsage.cartesiaSelf[day] = {});
    const b = d[pipe] || (d[pipe] = { chars: 0, req: 0 });
    b.chars += chars; b.req += 1;
    if (!ttsUsageTimer) ttsUsageTimer = setTimeout(() => { ttsUsageTimer = null; persistVendorUsage().catch(() => {}); }, 5000);
  } catch {}
}
export async function persistVendorUsage() {
  if (vendorUsageCol) { await vendorUsageCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...vendorUsage }, { upsert: true }); }
  else { writeDataFile(VENDOR_USAGE_FILE, JSON.stringify(vendorUsage, null, 2)); }
}

let saveTimer = null;
export const dirtySessions = new Set(); // Mongo 모드: 변경 세션만 upsert — 발화 확정마다 전체 재기록하던 쓰기 증폭 방지
export let sessionsFlushInflight = null; // 진행 중 flush 추적 — 삭제가 완료를 기다려 '삭제 후 upsert 부활' 레이스 차단
export function saveSessions(id) {
  if (id) dirtySessions.add(id);
  else for (const s of sessions) dirtySessions.add(s.id); // 인자 없으면 전체(드문 관리자·마이그레이션 경로)
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    sessionsFlushInflight = flushSessions()
      // 저장이 죽어도 화면은 정상으로 보인다 — 관리자 > 시스템·보안(/api/admin/health)에 노출해
      // 응대 기록이 사라지고 있다는 사실을 운영 중에 알 수 있게 한다.
      .then(() => { metrics.saveFail = null; })
      .catch((e) => {
        console.error('[sessions] 저장 실패', e);
        const msg = String((e && e.message) || e).slice(0, 300);
        metrics.saveFail = { at: Date.now(), msg, count: ((metrics.saveFail || {}).count || 0) + 1 };
      })
      .finally(() => { sessionsFlushInflight = null; });
  }, 400);
}
export async function flushSessions() {
  const ids = new Set(dirtySessions);
  dirtySessions.clear();
  if (col) {
    const ops = sessions.filter((s) => ids.has(s.id)).map((s) => ({
      replaceOne: { filter: { id: s.id }, replacement: s, upsert: true },
    }));
    if (!ops.length) return;
    await col.bulkWrite(ops, { ordered: false });
  } else {
    // 파일 모드는 단일 JSON 이라 전체 기록이 불가피 — 대신 동기 쓰기가 오디오 스트리밍을 막지 않게 비동기로
    const tmp = DATA_FILE + '.tmp';
    const body = JSON.stringify(sessions, null, 2);
    await fs.promises.writeFile(tmp, dataKey ? encryptData(dataKey, body) : body);
    await fs.promises.rename(tmp, DATA_FILE);
  }
}
// 삭제는 flush(=upsert)로 반영되지 않으므로 별도 처리(Mongo 모드 한정).
export async function deleteSessionStore(id) {
  dirtySessions.delete(id);
  if (col) {
    try {
      if (sessionsFlushInflight) await sessionsFlushInflight; // 디바운스 flush 의 upsert 가 삭제를 되돌리지 않게 완료 대기
      await col.deleteOne({ id });
    } catch (e) {
      console.error('[sessions] 삭제 실패', e);
    }
  } else {
    saveSessions(); // 파일 모드: 메모리에서 이미 splice 됨 → 전체 재기록
  }
}

let userSaveTimer = null;
export function saveUsers() {
  if (userSaveTimer) return;
  userSaveTimer = setTimeout(() => {
    userSaveTimer = null;
    flushUsers().catch((e) => console.error('[users] 저장 실패', e));
  }, 400);
}
export async function flushUsers() {
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
export async function deleteUserStore(id) {
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

/* ---- 사용자 프로필(이메일·환경설정) 저장 — users 와 같은 디바운스, Mongo 는 변경 문서만 upsert ---- */
let profileSaveTimer = null;
const dirtyProfiles = new Set();
let profilesFlushInflight = null; // 삭제가 진행 중 upsert 완료를 기다려 '삭제 후 부활' 레이스 차단(세션 저장과 동일)
export function saveProfiles(id) {
  if (id) dirtyProfiles.add(id);
  if (profileSaveTimer) return;
  profileSaveTimer = setTimeout(() => {
    profileSaveTimer = null;
    profilesFlushInflight = flushProfiles()
      .catch((e) => console.error('[profiles] 저장 실패', e))
      .finally(() => { profilesFlushInflight = null; });
  }, 400);
}
async function flushProfiles() {
  const ids = new Set(dirtyProfiles);
  dirtyProfiles.clear();
  if (profilesCol) {
    const ops = [...ids].filter((id) => profiles.has(id)).map((id) => ({
      replaceOne: { filter: { id }, replacement: profiles.get(id), upsert: true },
    }));
    if (ops.length) await profilesCol.bulkWrite(ops, { ordered: false });
  } else {
    writeDataFile(PROFILES_FILE, JSON.stringify([...profiles.values()], null, 2));
  }
}
export async function deleteProfileStore(id) {
  dirtyProfiles.delete(id);
  if (profilesCol) {
    try {
      if (profilesFlushInflight) await profilesFlushInflight;
      await profilesCol.deleteOne({ id });
    } catch (e) {
      console.error('[profiles] 삭제 실패', e);
    }
  } else {
    saveProfiles(); // 파일 모드: 메모리에서 이미 지움 → 전체 재기록
  }
}

/* ---- 사용량(일별) 집계 + 비용 ----
   비용은 파이프라인별 '오디오 분당 요금' × 호스트 WS 연결 시간으로 계산. */
export function costOfDay(d) {
  return ((d.whisperMs || 0) / 60000) * PRICE_WHISPER_PER_MIN + ((d.translateMs || 0) / 60000) * PRICE_TRANSLATE_PER_MIN;
}
function dateKey() {
  return new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
}
function hourKey() {
  return new Date().toISOString().slice(0, 13); // UTC YYYY-MM-DDTHH
}
export function recordUsage(pipeline, ms) {
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
export async function flushUsage() {
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

/* ---- 고유명사/번역 설정 저장 (Soniox context 구성은 vendors/soniox.js) ---- */
export async function persistTermsConfig() {
  if (termsConfigCol) {
    await termsConfigCol.replaceOne({ _id: 'singleton' }, { _id: 'singleton', ...termsConfig }, { upsert: true });
  } else {
    writeDataFile(TERMS_FILE, JSON.stringify(termsConfig, null, 2));
  }
}

// 사용자별 사용 시간 누적(호스트 연결 종료 시 — realtime/host.js)
export function addUsage(userId, ms) {
  if (!userId || !ms || ms < 0) return;
  const u = users.find((x) => x.id === userId); // 관리자는 가상 사용자라 집계 대상 아님
  if (!u) return;
  u.usageMs = (u.usageMs || 0) + ms;
  saveUsers();
}
