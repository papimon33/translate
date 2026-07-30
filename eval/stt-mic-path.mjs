/* STT 마이크 경로 시뮬레이션 — "마이크 인식 문제" 가설 검증.
 *
 * 기존 stt-regression.mjs 는 TTS PCM 을 Soniox 에 '직접' 넣어 마이크 캡처 경로를 건너뛴다.
 * 이 스크립트는 그 사이에 audio.js 의 **실제 RMS 게이트 알고리즘 + 음량 감쇠**를 끼워 넣어,
 * 조용한/원거리 화자가 게이트에 의해 문장 중간에 무음이 삽입되며 조각나는지를 재현·측정한다.
 *   TTS(ko) → [음량 gain 적용] → [audio.js 게이트: 조용하면 무음 삽입] → Soniox → 조각 수(endpoint) 측정
 *
 * 무엇을 알 수 있나:
 *   · 같은 문장을 음량(gain)·민감도(micSens) 조합으로 돌려, 어느 조건에서 문장이 조각나는지.
 *   · 민감도 슬라이더의 방향성: micSens 가 '낮을수록' 게이트가 엄격(micRatio=1+((100-s)/100)*7) → 조용한
 *     발화를 더 잘라낸다. "민감도를 낮췄는데 폴란드어가 끊긴다"가 사실은 방향이 반대였음을 확인.
 *
 * 한계: 게이트 '알고리즘'은 audio.js 와 동일하게 이식했으나, 실제 마이크 하드웨어·AGC·브라우저
 *   리샘플링·RNNoise 는 포함하지 않는다. 그건 음향 루프백(스피커→마이크)이라야 완전. 다만 앞선
 *   분석에서 지목한 '진범'(게이트 무음 삽입)은 이걸로 결정론적으로 격리·측정된다.
 *
 * 사용: node eval/stt-mic-path.mjs [script.json]
 * 키: CARTESIA_API_KEY(최초 TTS, 이후 캐시), SONIOX_API_KEY. ⚠ Soniox 과금.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(DIR, 'tts-audio', 'regression');
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
const CKEY = process.env.CARTESIA_API_KEY, SKEY = process.env.SONIOX_API_KEY, RATE = 24000;
const KO_VOICE = '4dd4630e-19e0-4243-bca0-676ff85119b7';
const SX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
if (!SKEY) { console.error('❌ SONIOX_API_KEY 없음'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ttsPCM(text) { // 캐시는 stt-regression 과 공유(같은 sha1)
  const key = crypto.createHash('sha1').update('ko:' + text).digest('hex').slice(0, 16);
  const file = path.join(CACHE, key + '.pcm');
  if (fs.existsSync(file)) return fs.readFileSync(file);
  if (!CKEY) { console.error('❌ CARTESIA_API_KEY 없음(캐시도 없음)'); process.exit(1); }
  const r = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST', headers: { 'X-API-Key': CKEY, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_id: 'sonic-3.5', transcript: text, voice: { mode: 'id', id: KO_VOICE }, language: 'ko', output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(file, buf);
  return buf;
}

// audio.js 의 게이트를 그대로 이식 — 음량(gain) 적용 후 RMS 로 판정, 닫히면 무음(0) 삽입.
// simMs(오디오 시계)로 300ms hold 처리(실앱은 Date.now, 프레임이 실시간 도착이라 등가).
function applyGate(int16, micSens, gain) {
  const k = (100 - micSens) / 100;
  const micRatio = micSens < 100 ? 1 + k * 7 : 0;
  const micAbsMin = micSens < 100 ? 0.004 + k * 0.03 : 0;
  const out = new Int16Array(int16.length);
  const FR = 480; // 20ms @24k
  let noiseFloor = 0.0003, gateOpenUntil = 0, simMs = 0, gatedFr = 0, totFr = 0;
  for (let off = 0; off < int16.length; off += FR) {
    const end = Math.min(off + FR, int16.length), n = end - off;
    let sum = 0;
    for (let i = off; i < end; i++) { let v = Math.round(int16[i] * gain); if (v > 32767) v = 32767; if (v < -32768) v = -32768; out[i] = v; const a = Math.abs(v) / 32768; sum += a * a; }
    const rms = Math.sqrt(sum / n); simMs += (n / RATE) * 1000; totFr++;
    let gated = false;
    if (micRatio > 0) {
      if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.3; else noiseFloor += (rms - noiseFloor) * 0.002;
      if (noiseFloor < 0.0003) noiseFloor = 0.0003;
      if (rms >= micAbsMin && rms >= noiseFloor * micRatio) gateOpenUntil = simMs + 300;
      if (simMs >= gateOpenUntil) gated = true;
    }
    if (gated) { for (let i = off; i < end; i++) out[i] = 0; gatedFr++; }
  }
  return { pcm: Buffer.from(out.buffer, out.byteOffset, out.byteLength), gatedPct: totFr ? gatedFr / totFr : 0 };
}

// Soniox 전사 + 조각 수(endpoint '<end>' 토큰 수) 측정
function transcribe(pcmBuf) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SX_URL);
    const finals = []; let ends = 0, settled = false;
    const finish = () => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve({ text: finals.join('').trim(), ends }); };
    const guard = setTimeout(finish, 20000);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(JSON.stringify({ api_key: SKEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: RATE, num_channels: 1, enable_language_identification: true, enable_endpoint_detection: true, language_hints: ['ko'] }));
      let off = 0; const chunk = 4800;
      const iv = setInterval(() => { if (off >= pcmBuf.length) { clearInterval(iv); try { ws.send(''); } catch {} return; } ws.send(pcmBuf.subarray(off, off + chunk)); off += chunk; }, 100);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.error_code) { console.error('  ! soniox', m.error_code, m.error_message || ''); finish(); return; }
      for (const t of (m.tokens || [])) {
        if (!t || t.translation_status === 'translation' || typeof t.text !== 'string') continue;
        if (t.text === '<end>') { ends++; continue; }
        if (t.text.startsWith('<')) continue;
        if (t.is_final) finals.push(t.text);
      }
      if (m.finished) { clearTimeout(guard); finish(); }
    };
    ws.onclose = () => { clearTimeout(guard); finish(); };
    ws.onerror = () => {};
  });
}
const norm = (s) => String(s || '').replace(/[.,!?·…"'()]/g, '').replace(/\s+/g, '').trim();
function cer(ref, hyp) {
  const a = norm(ref), b = norm(hyp); if (!a.length) return b.length ? 1 : 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / a.length;
}

// --- 실행: 대표 문장 몇 개 × (민감도 × 음량) 격자 ---
const scriptPath = process.argv.slice(2).find((a) => !a.startsWith('--')) || path.join(DIR, 'stt-script.json');
const lines = JSON.parse(fs.readFileSync(scriptPath, 'utf8')).lines || [];
const picked = [...lines].sort((a, b) => b.ko.length - a.ko.length).slice(0, 3); // 긴 문장 3개(조각 나기 쉬움)
const GRID = [
  { micSens: 100, gain: 1.0, label: '게이트off·정상음량' },
  { micSens: 100, gain: 0.30, label: '게이트off·조용(30%)' },
  { micSens: 45, gain: 1.0, label: '게이트엄격(45)·정상음량' },
  { micSens: 45, gain: 0.30, label: '게이트엄격(45)·조용(30%)' },
];
console.log(`마이크 경로 시뮬레이션 · 문장 ${picked.length}개 × 조건 ${GRID.length}개 (Soniox ${picked.length * GRID.length}콜, 과금)\n`);

for (const line of picked) {
  const raw = new Int16Array((await ttsPCM(line.ko)).buffer.slice());
  const int16 = new Int16Array(raw.buffer, raw.byteOffset, raw.length);
  console.log(`■ 기대: ${line.ko}`);
  for (const g of GRID) {
    const { pcm, gatedPct } = applyGate(int16, g.micSens, g.gain);
    const { text, ends } = await transcribe(pcm);
    const c = cer(line.ko, text);
    console.log(`  ${g.label.padEnd(24)} 조각(endpoint) ${String(ends).padStart(2)} · CER ${(c * 100).toFixed(0).padStart(3)}% · 무음삽입 ${(gatedPct * 100).toFixed(0)}%`);
    console.log(`      → ${text}`);
  }
  console.log('');
}
console.log('해석: 같은 문장이 "게이트엄격·조용" 조건에서 조각(endpoint)이 늘고 CER 이 오르면,');
console.log('      폴란드어 끊김의 원인이 Soniox 가 아니라 마이크 게이트(무음 삽입)임을 뜻한다.');
