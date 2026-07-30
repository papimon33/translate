/* 발표 데모 음성 생성 — demo-scripts.json 의 한국어 발표 스크립트를 Cartesia TTS 로 합성해 mp3 로 만든다.
 *
 * 용도: ① 시연·리허설용 발표 음성 ② 시스템 오디오(스피커) 재생으로 실시간 번역 파이프라인 테스트
 *      (마이크 경로까지 태우려면 스피커로 틀고 마이크로 받으면 됨 — 항공/IT 외래어가 다수 포함돼 있다)
 *
 * 사용:
 *   node eval/make-demo-audio.mjs           # 전체(slot, ai)
 *   node eval/make-demo-audio.mjs slot      # 특정 스크립트만
 *
 * 키: CARTESIA_API_KEY (.env). ⚠ 합성은 과금 — 문장별 sha1 캐시(eval/tts-audio/demo-cache/)로 재실행 시 무과금.
 * 출력: eval/tts-audio/demo_<id>.mp3 + demo-manifest.json (문장별 시작 시각 — 인식 결과 대조용)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import lamejs from '@breezystack/lamejs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'tts-audio');
const CACHE = path.join(OUT, 'demo-cache');
fs.mkdirSync(CACHE, { recursive: true });

function loadEnv() {
  try {
    const t = fs.readFileSync(path.join(DIR, '..', '.env'), 'utf8');
    for (const line of t.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv();

const CKEY = process.env.CARTESIA_API_KEY;
if (!CKEY) { console.error('❌ CARTESIA_API_KEY 없음 (.env)'); process.exit(1); }

const RATE = 24000;
const GAP_SEC = 0.7;          // 문장 사이 자연스러운 호흡
// server.js CARTESIA_VOICES.ko 와 동일한 보이스(실서비스와 같은 음색으로 테스트)
const VOICE = { male: '89f4372f-1f73-4b85-8e1e-5d24ed8bc826' /*jaewon*/, female: '4dd4630e-19e0-4243-bca0-676ff85119b7' /*Haeun*/ };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function tts(text, voiceId) {
  const key = crypto.createHash('sha1').update(voiceId + ':' + text).digest('hex').slice(0, 16);
  const file = path.join(CACHE, key + '.pcm');
  if (fs.existsSync(file)) { const b = fs.readFileSync(file); return { pcm: new Int16Array(b.buffer, b.byteOffset, b.length >> 1), cached: true }; }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { 'X-API-Key': CKEY, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: 'sonic-3.5', transcript: text, voice: { mode: 'id', id: voiceId }, language: 'ko', output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
      });
      if (!r.ok) { console.error(`  ! HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`); await sleep(1000); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(file, buf);
      return { pcm: new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1), cached: false };
    } catch (e) { console.error('  !', e.message); await sleep(1000); }
  }
  throw new Error('TTS 실패: ' + text.slice(0, 30));
}

function encodeMp3(segments) {
  const gap = new Int16Array(Math.round(RATE * GAP_SEC));
  const parts = [];
  segments.forEach((seg, i) => { if (i) parts.push(gap); parts.push(seg); });
  const total = parts.reduce((a, s) => a + s.length, 0);
  const pcm = new Int16Array(total);
  let off = 0; for (const s of parts) { pcm.set(s, off); off += s.length; }
  const enc = new lamejs.Mp3Encoder(1, RATE, 128);
  const mp3 = [];
  for (let i = 0; i < pcm.length; i += 1152) {
    const b = enc.encodeBuffer(pcm.subarray(i, i + 1152));
    if (b.length) mp3.push(Buffer.from(b));
  }
  const end = enc.flush();
  if (end.length) mp3.push(Buffer.from(end));
  return Buffer.concat(mp3);
}

const only = process.argv[2];
const { scripts } = JSON.parse(fs.readFileSync(path.join(DIR, 'demo-scripts.json'), 'utf8'));
const targets = only ? scripts.filter((s) => s.id === only) : scripts;
if (!targets.length) { console.error(`❌ 스크립트 없음: ${only} (사용 가능: ${scripts.map((s) => s.id).join(', ')})`); process.exit(1); }

const manifest = { rate: RATE, gapSec: GAP_SEC, scripts: [] };
let newCount = 0;

for (const sc of targets) {
  const voiceId = VOICE[sc.voice] || VOICE.female;
  console.log(`\n[${sc.id}] ${sc.title} · ${sc.lines.length}문장 · ${sc.voice}`);
  const segs = [];
  const lines = [];
  let cursor = 0; // 초 — 문장별 시작 시각(인식 결과 대조용)
  for (let i = 0; i < sc.lines.length; i++) {
    const { pcm, cached } = await tts(sc.lines[i], voiceId);
    if (!cached) newCount++;
    if (i) cursor += GAP_SEC;
    lines.push({ i, at: +cursor.toFixed(2), text: sc.lines[i] });
    cursor += pcm.length / RATE;
    segs.push(pcm);
    process.stdout.write(`${i + 1}${cached ? '·' : '*'} `);
  }
  const mp3 = encodeMp3(segs);
  const fn = `demo_${sc.id}.mp3`;
  fs.writeFileSync(path.join(OUT, fn), mp3);
  manifest.scripts.push({ id: sc.id, title: sc.title, voice: sc.voice, file: fn, durationSec: +cursor.toFixed(1), lines });
  console.log(`\n→ ${fn} (${(mp3.length / 1024).toFixed(0)}KB, ${cursor.toFixed(0)}초)`);
}

fs.writeFileSync(path.join(OUT, 'demo-manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n완료 — 신규 합성 ${newCount}문장(나머지 캐시). 출력: ${OUT}`);
