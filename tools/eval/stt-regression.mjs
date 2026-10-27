/* STT 회귀 루프 — 스크립트(한국어 정답) → Cartesia TTS(ko, raw PCM) → Soniox 전사 → 기대 vs 인식 대조.
 *
 * 무엇을 재나:
 *   · 각 문장을 TTS(깨끗한 발음)로 만들어 Soniox 에 흘려보내고, 인식한 원문을 정답과 비교한다.
 *   · 문장 CER(문자 오류율) + 개별 외래어(terms) 적중 여부를 채점한다.
 *   · 용어집(Soniox context) 적용 전(base) / 후(terms) 를 함께 돌려 "용어 등록이 실제로 개선되나"를 본다.
 *
 * 한계(중요): TTS 는 정석 발음이라 사람 발화보다 잘 인식된다. 여기서 '깨끗해도 틀리는' 단어
 *   (고유명사·희귀 외래어)는 실제로도 취약하다는 강한 신호지만, TTS 가 맞혔다고 현장이 맞는다는
 *   보장은 아니다. 발굴은 사람 녹음/실로그로, 검증(전후 비교)은 이 루프로 — 하이브리드 권장.
 *
 * 사용:
 *   node tools/eval/stt-regression.mjs                      # 기본 스크립트(stt-script.json), base+terms 둘 다
 *   node tools/eval/stt-regression.mjs my-script.json       # 다른 스크립트
 *   node tools/eval/stt-regression.mjs --base               # 용어 미적용만(빠른 baseline)
 *   node tools/eval/stt-regression.mjs --terms              # 용어 적용만
 *
 * 키: CARTESIA_API_KEY(TTS), SONIOX_API_KEY(전사) — .env 또는 환경변수.
 * ⚠ Soniox 는 실호출 과금. TTS 는 sha1 캐시(eval/tts-audio/regression/*.pcm) — 재실행 시 무과금.
 * 출력: 콘솔 리포트 + eval/stt-regression.out.json(상세).
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

const CKEY = process.env.CARTESIA_API_KEY;
const SKEY = process.env.SONIOX_API_KEY;
const RATE = 24000;
const KO_VOICE = '4dd4630e-19e0-4243-bca0-676ff85119b7'; // Haeun (server.js 매핑)
const SX_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
if (!SKEY) { console.error('❌ SONIOX_API_KEY 없음 (.env)'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.error('❌ node 18+ 필요(전역 WebSocket)'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Cartesia TTS(ko) → s16le PCM Buffer, sha1 디스크 캐시 ---
async function ttsPCM(text) {
  const key = crypto.createHash('sha1').update('ko:' + text).digest('hex').slice(0, 16);
  const file = path.join(CACHE, key + '.pcm');
  if (fs.existsSync(file)) return { buf: fs.readFileSync(file), cached: true };
  if (!CKEY) { console.error('❌ CARTESIA_API_KEY 없음 — TTS 합성 불가(캐시도 없음).'); process.exit(1); }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { 'X-API-Key': CKEY, 'Cartesia-Version': '2025-04-16', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: 'sonic-3.5', transcript: text, voice: { mode: 'id', id: KO_VOICE }, language: 'ko', output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
      });
      if (!r.ok) { await sleep(1000); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      fs.writeFileSync(file, buf);
      return { buf, cached: false };
    } catch { await sleep(1000); }
  }
  throw new Error('TTS 실패: ' + text.slice(0, 30));
}

// --- Soniox 전사(원문만) — 필요 시 context.terms 주입 ---
function transcribe(pcmBuf, terms) {
  return new Promise((resolve) => {
    const ws = new WebSocket(SX_URL);
    const finals = [];
    let settled = false;
    const finish = () => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve(finals.join('').trim()); };
    const guard = setTimeout(finish, 20000);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      const cfg = {
        api_key: SKEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: RATE, num_channels: 1,
        enable_language_identification: true, enable_endpoint_detection: true, language_hints: ['ko'],
      };
      if (terms && terms.length) cfg.context = { terms };
      ws.send(JSON.stringify(cfg));
      let off = 0; const chunk = 4800; // ~100ms
      const iv = setInterval(() => {
        if (off >= pcmBuf.length) { clearInterval(iv); try { ws.send(''); } catch {} return; } // '' = 종료(플러시)
        ws.send(pcmBuf.subarray(off, off + chunk)); off += chunk;
      }, 100);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.error_code) { console.error('  ! soniox', m.error_code, m.error_message || ''); finish(); return; }
      for (const t of (m.tokens || [])) {
        if (!t || t.translation_status === 'translation') continue;
        if (typeof t.text !== 'string' || t.text.startsWith('<')) continue; // <end>/<fin> 등 제어토큰 제외
        if (t.is_final) finals.push(t.text);
      }
      if (m.finished) { clearTimeout(guard); finish(); }
    };
    ws.onclose = () => { clearTimeout(guard); finish(); };
    ws.onerror = () => {};
  });
}

// --- 채점 ---
const norm = (s) => String(s || '').replace(/[.,!?·…"'()]/g, '').replace(/\s+/g, ' ').trim();
function cer(ref, hyp) { // 문자 오류율(레벤슈타인/기대길이)
  const a = norm(ref).replace(/\s/g, ''), b = norm(hyp).replace(/\s/g, '');
  if (!a.length) return b.length ? 1 : 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length] / a.length;
}
const termHit = (hyp, term) => norm(hyp).replace(/\s/g, '').includes(norm(term).replace(/\s/g, ''));

// --- 실행 ---
const args = process.argv.slice(2);
const modeBase = !args.includes('--terms');
const modeTerms = !args.includes('--base');
const scriptPath = args.find((a) => !a.startsWith('--')) || path.join(DIR, 'stt-script.json');
const script = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
const lines = script.lines || [];
const allTerms = [...new Set(lines.flatMap((l) => l.terms || []))];
console.log(`스크립트: ${path.basename(scriptPath)} · ${lines.length}문장 · 용어 ${allTerms.length}개`);
console.log(`모드: ${[modeBase && 'base(용어 미적용)', modeTerms && 'terms(용어 적용)'].filter(Boolean).join(' + ')}`);
console.log(modeTerms ? '⚠ Soniox 실호출 과금 발생. TTS 는 캐시 사용(재실행 무과금).\n' : '');

const out = { script: path.basename(scriptPath), at: new Date().toISOString().slice(0, 19), rows: [] };
let ttsNew = 0;
const agg = { base: { pass: 0, cerSum: 0, hit: 0, miss: 0 }, terms: { pass: 0, cerSum: 0, hit: 0, miss: 0 } };

for (let i = 0; i < lines.length; i++) {
  const { ko, terms = [] } = lines[i];
  const { buf, cached } = await ttsPCM(ko);
  if (!cached) ttsNew++;
  const row = { ko, terms };
  console.log(`\n[${i + 1}/${lines.length}] 기대: ${ko}`);
  for (const [mode, on, ctx] of [['base', modeBase, null], ['terms', modeTerms, allTerms]]) {
    if (!on) continue;
    const hyp = await transcribe(buf, ctx);
    const c = cer(ko, hyp);
    const missed = terms.filter((t) => !termHit(hyp, t));
    row[mode] = { hyp, cer: +c.toFixed(3), missed };
    agg[mode].cerSum += c;
    if (c <= 0.10) agg[mode].pass++;
    agg[mode].hit += terms.length - missed.length;
    agg[mode].miss += missed.length;
    const mark = c <= 0.10 && !missed.length ? '✓' : '✗';
    console.log(`   ${mode === 'base' ? '용어X' : '용어O'} ${mark} CER ${(c * 100).toFixed(0)}%${missed.length ? '  놓친 용어: ' + missed.join(', ') : ''}`);
    console.log(`        인식: ${hyp}`);
  }
  out.rows.push(row);
}

// --- 요약 ---
console.log('\n' + '='.repeat(60));
const totTerms = agg.base.hit + agg.base.miss || agg.terms.hit + agg.terms.miss;
function summary(mode, label) {
  const a = agg[mode]; const n = lines.length;
  const th = a.hit + a.miss;
  console.log(`${label}: 문장통과 ${a.pass}/${n} · 평균 CER ${((a.cerSum / n) * 100).toFixed(1)}% · 용어적중 ${a.hit}/${th} (${th ? ((a.hit / th) * 100).toFixed(0) : 0}%)`);
}
if (modeBase) summary('base', '용어 미적용');
if (modeTerms) summary('terms', '용어 적용  ');
if (modeBase && modeTerms) {
  const gained = out.rows.flatMap((r) => (r.base?.missed || []).filter((t) => !(r.terms?.missed || []).includes(t)));
  const still = [...new Set(out.rows.flatMap((r) => r.terms?.missed || []))];
  console.log(`\n용어 등록으로 회복된 단어: ${gained.length ? [...new Set(gained)].join(', ') : '없음'}`);
  console.log(`용어 등록해도 여전히 실패: ${still.length ? still.join(', ') : '없음'}  ← 깨끗한 발음에도 취약(고착·희귀어)`);
}
console.log(`\nTTS 신규 합성 ${ttsNew}건(나머지 캐시). 상세 → eval/stt-regression.out.json`);
fs.writeFileSync(path.join(DIR, 'stt-regression.out.json'), JSON.stringify(out, null, 2));
