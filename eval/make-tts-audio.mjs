/* eval 데이터셋(30개)의 질문·답변을 Cartesia TTS 로 합성해 언어별 1개 mp3 로 잇는다.
   - 질문: en / ja / zh / ru / es / fr  (ru 는 데이터셋에 없어 ko_ref 를 GPT 로 번역)
   - 답변: ko (answer.ko_src)
   - 각 발언은 2초 무음을 사이에 두고 한 파일로 연결. raw PCM(24kHz) 로 받아 무음 삽입 후 lamejs 로 mp3 인코딩.
   출력: eval/tts-audio/questions_<lang>.mp3, answers_ko.mp3, manifest.json
   사용: node eval/make-tts-audio.mjs   (.env 의 CARTESIA_API_KEY / OPENAI_API_KEY 필요) */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import lamejs from '@breezystack/lamejs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(DIR, 'tts-audio');
fs.mkdirSync(OUT, { recursive: true });
const env = Object.fromEntries(fs.readFileSync(path.join(DIR, '..', '.env'), 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const CKEY = env.CARTESIA_API_KEY, OKEY = env.OPENAI_API_KEY, VER = '2025-04-16', MODEL = 'sonic-3.5';
if (!CKEY) { console.error('CARTESIA_API_KEY 없음'); process.exit(1); }

const RATE = 24000;
const GAP_SEC = 2;
// 언어별 voice (server.js 매핑 + Cartesia voices 조회 결과)
const VOICE = {
  en: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', // Skylar
  ja: 'd0ff6870-dd30-420d-8568-d756d806ea62', // Hinata
  zh: '6eb8965c-e295-47bd-a9e4-3eeebb3abcff', // Jing
  ru: '1e4176b1-3db9-44d6-a601-4fe68b041942', // Sergei
  es: '15d0c2e2-8d29-44c3-be23-d585d5f154a1', // Pedro
  fr: '0418348a-0ca2-4e90-9986-800fb8b3bbc0', // Antoine
  ko: '4dd4630e-19e0-4243-bca0-676ff85119b7', // Haeun
};
const QLANGS = ['en', 'ja', 'zh', 'ru', 'es', 'fr'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Cartesia raw PCM16(24kHz) 합성 → Int16Array
async function tts(text, lang) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: { 'X-API-Key': CKEY, 'Cartesia-Version': VER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: MODEL, transcript: text, voice: { mode: 'id', id: VOICE[lang] }, language: lang, output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: RATE } }),
      });
      if (!r.ok) { console.error(`  ! ${lang} HTTP ${r.status}: ${(await r.text()).slice(0, 100)}`); await sleep(1000); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      return new Int16Array(buf.buffer, buf.byteOffset, buf.length >> 1);
    } catch (e) { console.error(`  ! ${lang} ${e.message}`); await sleep(1000); }
  }
  return new Int16Array(0);
}

// GPT 번역(러시아어 질문 — 데이터셋에 없음). ko_ref → ru
async function toRussian(koText) {
  if (!OKEY) return koText;
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OKEY}` },
      body: JSON.stringify({ model: 'gpt-5-nano', reasoning_effort: 'minimal', max_completion_tokens: 200,
        messages: [{ role: 'system', content: '한국어 문장을 자연스러운 러시아어로 번역해라. 공항 안내데스크에서 여행객이 하는 질문이다. 번역문만 출력.' }, { role: 'user', content: koText }] }),
    });
    if (!r.ok) return koText;
    const d = await r.json();
    return (d?.choices?.[0]?.message?.content || koText).trim();
  } catch { return koText; }
}

// PCM 세그먼트들을 2초 무음 간격으로 연결 → mp3 인코딩
function encodeMp3(segments) {
  const gap = new Int16Array(RATE * GAP_SEC); // 무음
  const parts = [];
  segments.forEach((seg, i) => { if (i) parts.push(gap); parts.push(seg); });
  const total = parts.reduce((a, s) => a + s.length, 0);
  const pcm = new Int16Array(total);
  let off = 0; for (const s of parts) { pcm.set(s, off); off += s.length; }
  const enc = new lamejs.Mp3Encoder(1, RATE, 128);
  const mp3 = [];
  const BLK = 1152;
  for (let i = 0; i < pcm.length; i += BLK) {
    const chunk = pcm.subarray(i, i + BLK);
    const b = enc.encodeBuffer(chunk);
    if (b.length) mp3.push(Buffer.from(b));
  }
  const end = enc.flush();
  if (end.length) mp3.push(Buffer.from(end));
  return Buffer.concat(mp3);
}

// --- 실행 ---
const ds = JSON.parse(fs.readFileSync(path.join(DIR, 'dataset.json'), 'utf8'));
const scenarios = ds.scenarios;
console.log(`시나리오 ${scenarios.length}개 · 질문 ${QLANGS.length}개 언어 + 답변 ko`);

// 러시아어 질문 미리 번역
console.log('\n러시아어 질문 번역 중…');
const ruQ = [];
for (const s of scenarios) { ruQ.push(await toRussian(s.question.ko_ref)); process.stdout.write('.'); }
console.log(' 완료');

const manifest = { rate: RATE, gapSec: GAP_SEC, count: scenarios.length, voices: VOICE, files: {}, lines: {} };

// 질문 언어별
for (const lang of QLANGS) {
  console.log(`\n[질문 ${lang}] 합성 중…`);
  const segs = [];
  const lines = [];
  for (let i = 0; i < scenarios.length; i++) {
    const text = lang === 'ru' ? ruQ[i] : scenarios[i].question.src[lang];
    lines.push({ id: scenarios[i].id, text });
    segs.push(await tts(text, lang));
    process.stdout.write(`${i + 1} `);
  }
  const mp3 = encodeMp3(segs);
  const fn = `questions_${lang}.mp3`;
  fs.writeFileSync(path.join(OUT, fn), mp3);
  manifest.files[`q_${lang}`] = fn;
  manifest.lines[`q_${lang}`] = lines;
  console.log(`→ ${fn} (${(mp3.length / 1024).toFixed(0)}KB, ${segs.length}발언)`);
}

// 답변 ko
console.log(`\n[답변 ko] 합성 중…`);
const aSegs = [], aLines = [];
for (let i = 0; i < scenarios.length; i++) {
  const text = scenarios[i].answer.ko_src;
  aLines.push({ id: scenarios[i].id, text });
  aSegs.push(await tts(text, 'ko'));
  process.stdout.write(`${i + 1} `);
}
const aMp3 = encodeMp3(aSegs);
fs.writeFileSync(path.join(OUT, 'answers_ko.mp3'), aMp3);
manifest.files.a_ko = 'answers_ko.mp3';
manifest.lines.a_ko = aLines;
console.log(`→ answers_ko.mp3 (${(aMp3.length / 1024).toFixed(0)}KB, ${aSegs.length}발언)`);

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`\n완료 → ${OUT}`);
console.log('파일:', Object.values(manifest.files).join(', '), ', manifest.json');
