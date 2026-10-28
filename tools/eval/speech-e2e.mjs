/* 발표·연설 음성 → 우리 서버(실제 Soniox 인식·번역 + 다듬기) 끝까지 번역 확인.
   스크립트(txt) → 문단별 Cartesia 음성(캐시) → 로컬 서버(격리 DATA_DIR, 운영 DB 안 씀)에 앱과 같은 방식으로 실시간 속도로 흘려 넣기
   → 문단별 [스크립트 원문 / 인식 원문 / 번역] 보고서(md·json). 화면에 실제로 보이는 문장(다듬기·용어집 반영)을 그대로 모은다.
   사용: node tools/eval/speech-e2e.mjs <script.txt> [--from ko] [--to zh] [--parts N] [--name 이름] [--dry(문단 나누기만 확인)]
     · 스크립트: 빈 줄 = 문단, '[1P] 제목' 줄 = 쪽 표시(읽지 않음), '====' 줄·이모지는 무시, '질문 N.'·'✅ 답변' 은 따로 읽는다.
     · --parts: 세션을 나눠 동시에 돌린다(기본: 한 묶음 9분 이하가 되게). 쪽 경계에서 나눈다.
   출력: tools/eval/out/<이름>.md·.json (git 무시). 음성 캐시: tools/eval/tts-audio/speech/
   ⚠ 과금: Cartesia(처음 합성만, 이후 캐시)·Soniox(실시간 인식·번역)·OpenAI(다듬기). */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { bootServer, loginAdmin } from '../../test/helpers/boot.mjs';
import { langScriptOk } from '../../server/util/pipeline_util.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(DIR, '..', '..');
const CACHE = path.join(DIR, 'tts-audio', 'speech');
const OUT = path.join(DIR, 'out');
const RATE = 24000;
const VOICE = { ko: '4dd4630e-19e0-4243-bca0-676ff85119b7' /* Haeun — server/vendors/cartesia.js 와 같음 */ };
const GAP_ITEM_S = 0.9, GAP_PAGE_S = 2.0, PART_MAX_S = 9 * 60;

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const file = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--'));
if (!file) { console.error('사용: node tools/eval/speech-e2e.mjs <script.txt> [--to zh]'); process.exit(1); }
const FROM = opt('from', 'ko'), TO = opt('to', 'zh');
const NAME = opt('name', path.basename(file).replace(/\.[^.]+$/, '') + '-' + TO);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')
  .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
for (const k of ['CARTESIA_API_KEY', 'SONIOX_API_KEY', 'OPENAI_API_KEY']) if (!env[k]) { console.error(`❌ .env 에 ${k} 없음`); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- 스크립트 → 읽을 문단 ---- */
function clean(t) {
  return t.replace(/\p{Extended_Pictographic}/gu, '').replace(/[✅👉“”"]/g, '').replace(/^\s*답변\s*:?\s*/, '')
    .replace(/\s*→\s*/g, ', ').replace(/\(중요\)\s*/g, '').replace(/\s+/g, ' ').trim();
}
function parse(text) {
  const items = [];
  let page = '', buf = [];
  const flush = () => { const t = clean(buf.join(' ')); if (t && /[가-힣A-Za-z0-9]/.test(t)) items.push({ page, text: t }); buf = []; };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || /^=+$/.test(line)) { flush(); continue; }
    const pm = line.match(/^\[\s*([^\]]+?)\s*\]\s*(.*)$/);
    if (pm) { flush(); page = (pm[1] + (pm[2] ? ' ' + pm[2] : '')).trim(); continue; }
    if (/^\p{Extended_Pictographic}/u.test(line) && !page) continue; // 맨 위 제목 줄
    if (/^질문\s*\d+/.test(line) || /^✅/.test(line)) flush();
    buf.push(line);
  }
  flush();
  return items.map((it, i) => ({ ...it, i }));
}

/* ---- Cartesia 합성(캐시) ---- */
async function tts(text) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, crypto.createHash('sha1').update(FROM + ':' + text).digest('hex').slice(0, 16) + '.pcm');
  if (fs.existsSync(f)) return { pcm: fs.readFileSync(f), cached: true };
  for (let a = 0; a < 3; a++) {
    const r = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': env.CARTESIA_API_KEY, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model_id: 'sonic-3.5', transcript: text, voice: { mode: 'id', id: VOICE[FROM] }, language: FROM, output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
    }).catch((e) => ({ ok: false, status: e.message, text: async () => '' }));
    if (r.ok) { const b = Buffer.from(await r.arrayBuffer()); fs.writeFileSync(f, b); return { pcm: b, cached: false }; }
    console.error(`  ! Cartesia ${r.status} ${(await r.text()).slice(0, 120)}`);
    await sleep(1500);
  }
  throw new Error('Cartesia 합성 실패: ' + text.slice(0, 30));
}

/* ---- 묶음 하나: 세션 만들고 실시간 속도로 흘려 넣기 ---- */
async function runPart(base, cookie, part, k) {
  const sess = await fetch(base + '/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ title: `${NAME} #${k + 1}`, pipeline: 'soniox', preset: 'oneway', src: 'mic', inLang: FROM }) }).then((r) => r.json());
  const q = `session=${sess.id}&src=mic&out=${TO}&in=${FROM}&pipeline=soniox&audioOut=0&sxSens=0&sxMaxDelay=2000&sxLatency=0&sxMode=one&sxTarget=${TO}`;
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/host?${q}`, { headers: { Cookie: cookie } });
  const sent = new Map(); // id -> { id, firstAt, source, texts, final }
  const statuses = [];
  let lastMsg = Date.now();
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(d.toString()); } catch { return; }
    lastMsg = Date.now();
    if (m.type === 'status') statuses.push(m.message);
    if (m.type !== 'sentence') return;
    const s = sent.get(m.id) || { id: m.id, firstAt: Date.now() };
    s.source = m.source || s.source; s.texts = m.texts || s.texts;
    if (!m.draft && !s.final) { s.final = true; s.rawTexts = m.texts; } // 첫 확정 = 다듬기 전 기계 번역(다듬기는 같은 id 로 나중에 다시 온다)
    sent.set(m.id, s);
  });
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
  const CH = RATE / 10; // 100ms
  const t0 = Date.now();
  let samples = 0, lastAct = 0;
  const sendPcm = async (buf) => {
    for (let off = 0; off < buf.length; off += CH * 2) {
      ws.send(buf.subarray(off, Math.min(buf.length, off + CH * 2)));
      samples += Math.min(CH, (buf.length - off) / 2);
      if (Date.now() - lastAct > 4000) { lastAct = Date.now(); ws.send(JSON.stringify({ type: 'activity' })); }
      const ahead = t0 + (samples / RATE) * 1000 - Date.now();
      if (ahead > 0) await sleep(ahead);
    }
  };
  const silence = (s) => Buffer.alloc(Math.round(RATE * s) * 2);
  for (let j = 0; j < part.length; j++) {
    const it = part[j];
    it.startAt = Date.now();
    await sendPcm(it.pcm);
    it.endAt = Date.now();
    await sendPcm(silence(part[j + 1] && part[j + 1].page !== it.page ? GAP_PAGE_S : GAP_ITEM_S));
    process.stdout.write(`  #${k + 1} ${j + 1}/${part.length}\r`);
  }
  await sendPcm(silence(3));
  ws.send(JSON.stringify({ type: 'stop' }));
  const until = Date.now() + 40000; // 확정·다듬기 도착 대기(8초 조용하면 끝)
  while (Date.now() < until && Date.now() - lastMsg < 8000) await sleep(500);
  ws.close();
  // 문장 → 문단: 처음 보인 시각이 그 문단 시작(+0.4초) 뒤인 마지막 문단
  const list = [...sent.values()].sort((a, b) => a.firstAt - b.firstAt);
  for (const s of list) {
    let owner = part[0];
    for (const it of part) if (it.startAt <= s.firstAt - 400) owner = it;
    (owner.out = owner.out || []).push(s);
  }
  return { session: sess.id, statuses, sentences: list.length };
}

/* ---- 비교용: 공백·문장부호 뺀 글자 기준 편집 거리 비율 ---- */
function cer(ref, hyp) {
  const n = (s) => (s || '').replace(/[\s\p{P}\p{S}]/gu, '');
  const a = n(ref), b = n(hyp);
  if (!a.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] / a.length;
}

const items = parse(fs.readFileSync(file, 'utf8'));
const chars = items.reduce((a, it) => a + it.text.length, 0);
if (args.includes('--dry')) { for (const it of items) console.log(`[${it.page}] ${it.text}`); console.log(`문단 ${items.length}개 · ${chars}자`); process.exit(0); }
console.log(`문단 ${items.length}개 · ${chars}자 — Cartesia 합성 중…`);
let fresh = 0;
for (const it of items) { const r = await tts(it.text); it.pcm = r.pcm; it.sec = r.pcm.length / 2 / RATE; if (!r.cached) fresh += it.text.length; }
const totalSec = items.reduce((a, it) => a + it.sec, 0);
console.log(`음성 ${(totalSec / 60).toFixed(1)}분 (새로 합성 ${fresh}자)`);

// 쪽 경계에서 묶음 나누기
const want = Number(opt('parts', 0)) || Math.max(1, Math.ceil(totalSec / PART_MAX_S));
const parts = [];
{
  const per = totalSec / want;
  let cur = [], acc = 0;
  for (const it of items) {
    if (cur.length && acc >= per && parts.length < want - 1 && it.page !== cur[cur.length - 1].page) { parts.push(cur); cur = []; acc = 0; }
    cur.push(it); acc += it.sec;
  }
  if (cur.length) parts.push(cur);
}
console.log(`세션 ${parts.length}개로 동시에 실시간 재생 — 약 ${(Math.max(...parts.map((p) => p.reduce((a, it) => a + it.sec + GAP_ITEM_S, 0))) / 60).toFixed(1)}분`);

const srv = await bootServer({ SONIOX_API_KEY: env.SONIOX_API_KEY, OPENAI_API_KEY: env.OPENAI_API_KEY, CARTESIA_API_KEY: '' });
let runs;
try {
  const cookie = await loginAdmin(srv.base);
  runs = await Promise.all(parts.map((p, k) => runPart(srv.base, cookie, p, k)));
} finally {
  await srv.stop();
}

/* ---- 보고서 ---- */
fs.mkdirSync(OUT, { recursive: true });
const rows = items.map((it) => {
  const out = it.out || [];
  const heard = out.map((s) => s.source || '').join(' ');
  const tr = (s, k) => (s[k] && s[k][TO]) || '';
  return {
    i: it.i, page: it.page, script: it.text, heard, translated: out.map((s) => tr(s, 'texts')).join(' '), raw: out.map((s) => tr(s, 'rawTexts') || tr(s, 'texts')).join(' '),
    cer: +cer(it.text, heard).toFixed(3), sentences: out.length, notFinal: out.filter((s) => !s.final).length,
    polished: out.filter((s) => tr(s, 'rawTexts') && tr(s, 'rawTexts') !== tr(s, 'texts')).length,
    badScript: out.filter((s) => !langScriptOk(tr(s, 'texts'), '', TO)).length, // 목표 언어가 아닌 글자(한글·중국어 번체)가 섞인 문장
  };
});
const avgCer = rows.reduce((a, r) => a + r.cer * r.script.length, 0) / chars;
// 문단 경계에서 문장이 합쳐지면 문단별 오류율이 부풀므로 전체를 이어 붙인 오류율도 낸다
const allCer = cer(rows.map((r) => r.script).join(''), rows.map((r) => r.heard).join(''));
const nPolished = rows.reduce((a, r) => a + r.polished, 0), nBad = rows.reduce((a, r) => a + r.badScript, 0);
fs.writeFileSync(path.join(OUT, NAME + '.json'), JSON.stringify({ from: FROM, to: TO, audioMin: +(totalSec / 60).toFixed(1), chars, avgCer: +avgCer.toFixed(3), allCer: +allCer.toFixed(4), polished: nPolished, badScript: nBad, runs, rows }, null, 1));
let md = `# ${NAME}\n\n- ${FROM} → ${TO}, 음성 ${(totalSec / 60).toFixed(1)}분, 문단 ${items.length}개, 세션 ${parts.length}개\n- 인식 글자 오류율(공백·문장부호 제외): 전체 ${(allCer * 100).toFixed(2)}% (문단별 평균 ${(avgCer * 100).toFixed(1)}% — 문단이 합쳐지면 부풂)\n- 다듬기로 바뀐 문장 ${nPolished}개 · 목표 언어가 아닌 글자가 섞인 번역 ${nBad}개\n\n`;
let lastPage = null;
for (const r of rows) {
  if (r.page !== lastPage) { md += `\n## ${r.page || '(시작)'}\n\n`; lastPage = r.page; }
  md += `**원문** ${r.script}\n\n**인식** ${r.heard || '(없음)'}${r.cer > 0.1 ? ` ⚠ 오류율 ${(r.cer * 100).toFixed(0)}%` : ''}\n\n**번역** ${r.translated || '(없음)'}${r.badScript ? ' ⚠ 목표 언어가 아닌 글자' : ''}\n\n${r.raw && r.raw !== r.translated ? `**다듬기 전** ${r.raw}\n\n` : ''}---\n\n`;
}
fs.writeFileSync(path.join(OUT, NAME + '.md'), md);
console.log(`\n완료: tools/eval/out/${NAME}.md · 인식 오류율 ${(allCer * 100).toFixed(2)}% · 문장 ${runs.reduce((a, r) => a + r.sentences, 0)}개 · 다듬기 ${nPolished}개 · 목표 언어 아닌 글자 ${nBad}개`);
for (const [k, r] of runs.entries()) console.log(`  #${k + 1} 상태: ${r.statuses.filter((s) => !/엔진 연결됨/.test(s)).slice(-3).join(' | ') || '정상'}`);
