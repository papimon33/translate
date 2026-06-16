import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import QRCode from 'qrcode';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 모델은 코드 고정(환경변수로 안 받음). 바꾸려면 여기서 직접 수정.
const TRANSCRIBE_MODEL = 'gpt-realtime-whisper';
const TRANSLATE_MODEL = 'gpt-realtime-translate';
const REFINE_MODEL = 'gpt-5-mini';
const TARGET_LANG = process.env.TARGET_LANG || 'ko';

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
app.use(express.json());
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
const MONGODB_URI = process.env.MONGODB_URI;                       // 있으면 Mongo, 없으면 로컬 파일
const MONGODB_DB = process.env.MONGODB_DB || 'kac_translator';     // DB 이름(앱이 자동 생성). 코드 기본값.

let sessions = [];  // 메모리 캐시(항상 진실의 원천)
let col = null;     // Mongo 컬렉션. null 이면 파일 모드.

async function loadSessions() {
  if (MONGODB_URI) {
    try {
      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(MONGODB_URI);
      await client.connect();
      col = client.db(MONGODB_DB).collection('sessions');
      await col.createIndex({ id: 1 }, { unique: true });
      sessions = await col.find({}, { projection: { _id: 0 } }).toArray();
      console.log(`[sessions] MongoDB 연결됨 — ${sessions.length}개 세션 로드`);
      return;
    } catch (e) {
      console.error('[sessions] MongoDB 연결 실패 — 로컬 파일 모드로 폴백', e);
      col = null;
    }
  }
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DATA_FILE)) {
      sessions = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (!Array.isArray(sessions)) sessions = [];
    }
  } catch (e) {
    console.error('[sessions] 로드 실패', e);
    sessions = [];
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

await loadSessions();

function getSession(id) {
  return sessions.find((s) => s.id === id);
}
function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---- 세션 REST API ---- */
app.get('/api/sessions', (req, res) => {
  const list = sessions
    .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  res.json(list);
});

app.post('/api/sessions', (req, res) => {
  const now = Date.now();
  const b = req.body || {};
  const pipeline = b.pipeline === 'translate' ? 'translate' : 'whisper';
  // whisper 는 항상 한·영·일·중 전부 번역. translate 는 단일 출력 언어.
  const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
  const langs = pipeline === 'whisper' ? ALL_LANGS.slice() : [outLang];
  const s = {
    id: newId(),
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

app.patch('/api/sessions/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'not found' });
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

app.delete('/api/sessions/:id', (req, res) => {
  const i = sessions.findIndex((s) => s.id === req.params.id);
  if (i >= 0) {
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
- 설명 없이 ${langName} 번역문만 출력한다. 이미 ${langName}면 자연스럽게 교정만 한다.`
      : `너는 번역기다. 입력을 ${langName}로 정확히 옮긴다. 고유명사는 발음을 살리고, 추측성 괄호·부연 없이 ${langName} 번역문만 출력한다. 이미 ${langName}면 그대로 출력한다.`;
    const messages = [{ role: 'system', content: sys }];
    // 이전 맥락을 few-shot 으로 제공해 연속성/용어 일관성 확보
    if (context && context.length) {
      for (const p of context) {
        messages.push({ role: 'user', content: p.src });
        messages.push({ role: 'assistant', content: p.tr });
      }
    }
    messages.push({ role: 'user', content: text });
    const body = { model: REFINE_MODEL, messages, max_completion_tokens: 300 };
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
    return data?.choices?.[0]?.message?.content?.trim() || text;
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
  if (pathname === '/ws/host' || pathname === '/ws/viewer') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws._kind = pathname === '/ws/host' ? 'host' : 'viewer';
      ws._session = searchParams.get('session') || 'default';
      ws._src = searchParams.get('src') || 'mic'; // mic | system
      ws._out = searchParams.get('out') || TARGET_LANG;
      ws._in = searchParams.get('in'); // 입력 언어 코드 | 'auto' | null
      ws._refine = searchParams.get('refine'); // '0' | '1' | null
      ws._pipeline = searchParams.get('pipeline'); // 'whisper' | 'translate' | null
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
  const s = getSession(ws._session);
  ws.send(JSON.stringify({ type: 'snapshot', items: s ? s.items : [] }));
  ws.on('close', () => room.viewers.delete(ws));
}

/* ----------------------------- 호스트 ----------------------------- */
/*  pipeline='whisper'  : 전사(gpt-realtime-whisper) -> gpt 번역 (+원어 동봉) */
/*  pipeline='translate': gpt-realtime-translate -> gpt 다듬기                */
function handleHost(ws) {
  const sessionId = ws._session;
  const side = ws._src === 'system' ? 'left' : 'right'; // 시스템=좌, 마이크=우
  const session = getSession(sessionId);
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
  const buildMsg = (id, item) => ({ type: 'sentence', id, side, source: item.source || null, texts: item.texts });
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
      session.updatedAt = Date.now();
      saveSessions();
    } else {
      item = { id, side, source: source || null, texts: { ...langTexts } };
    }
    toHost(buildMsg(id, item));
    broadcast(sessionId, buildMsg(id, item));
  };

  if (pipeline === 'translate') runTranslate();
  else runWhisper();

  /* ---------- whisper 전사 -> gpt 번역 ---------- */
  function runWhisper() {
    const oa = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    });
    let oaReady = false;
    let appendedSinceCommit = 0;
    let srcBuf = ''; // 현재 커밋의 스트리밍 델타
    let srcAccum = ''; // 표시 단위가 될 때까지 누적되는 원문
    let batchStart = 0; // 현재 배치가 쌓이기 시작한 시각(ms)
    let tailTimer = null;
    const N_MS = 4500; // 최소 표시 단위(이 시간 전엔 번역 보류하고 더 모음 → 도입부 조각이 주절과 붙을 시간)
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
      oaReady = true;
      while (pending.length) oa.send(pending.shift());
      toHost({ type: 'status', message: '엔진 연결됨 (whisper)' });
    });

    oa.on('message', (raw) => {
      let ev;
      try {
        ev = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (ev.type === 'conversation.item.input_audio_transcription.delta') {
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
    let oaReady = false;
    let closing = false;
    let buf = '';
    let curId = null;
    let idleTimer = null;
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
      oaReady = true;
      while (pending.length) oa.send(pending.shift());
      toHost({ type: 'status', message: '엔진 연결됨 (translate)' });
    });

    oa.on('message', (raw) => {
      let ev;
      try {
        ev = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (ev.type === 'session.output_transcript.delta') {
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
