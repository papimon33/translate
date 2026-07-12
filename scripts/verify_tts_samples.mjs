// tts_samples/ 의 mp3 를 Soniox 비동기 전사 API 에 넣어 "TTS 음성이 STT 로 제대로 인식되는지" 검증하고
// tts_samples/VERIFICATION.md 리포트를 남긴다. (ffmpeg 불필요 — mp3 를 서버측에서 디코딩)
// 사용: node scripts/verify_tts_samples.mjs   (.env 의 SONIOX_API_KEY 사용)
import fs from 'fs';
import path from 'path';
import { cer, normalize } from '../eval/score_core.mjs';

let KEY = process.env.SONIOX_API_KEY || '';
if (!KEY && fs.existsSync('.env')) KEY = (fs.readFileSync('.env', 'utf8').match(/SONIOX_API_KEY=(.+)/) || [])[1]?.trim() || '';
if (!KEY) { console.error('SONIOX_API_KEY 필요'); process.exit(1); }

const PHRASE = {
  en: 'Hello, this is a voice test.',
  ja: 'こんにちは、音声テストです。',
  zh: '你好，这是语音测试。',
  ru: 'Здравствуйте, это голосовой тест.',
  es: 'Hola, esta es una prueba de voz.',
};
const API = 'https://api.soniox.com';
const H = { Authorization: `Bearer ${KEY}` };

async function uploadFile(fp) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(fp)]), path.basename(fp));
  const r = await fetch(`${API}/v1/files`, { method: 'POST', headers: H, body: form });
  if (!r.ok) throw new Error(`upload ${r.status}: ${(await r.text()).slice(0, 120)}`);
  return (await r.json()).id;
}
async function transcribe(fileId, lang) {
  const r = await fetch(`${API}/v1/transcriptions`, {
    method: 'POST',
    headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId, model: 'stt-async-preview', language_hints: [lang] }),
  });
  if (!r.ok) throw new Error(`transcribe ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const id = (await r.json()).id;
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 1500));
    const s = await fetch(`${API}/v1/transcriptions/${id}`, { headers: H }).then((x) => x.json());
    if (s.status === 'completed') {
      const t = await fetch(`${API}/v1/transcriptions/${id}/transcript`, { headers: H }).then((x) => x.json());
      return t.text || (t.tokens || []).map((k) => k.text).join('');
    }
    if (s.status === 'error') throw new Error('전사 실패: ' + (s.error_message || ''));
  }
  throw new Error('전사 타임아웃');
}

const rows = [];
for (const lang of Object.keys(PHRASE)) {
  for (const g of ['female', 'male']) {
    const fp = `tts_samples/${lang}/${lang}_${g}.mp3`;
    if (!fs.existsSync(fp)) continue;
    process.stdout.write(`${fp} ... `);
    try {
      const fileId = await uploadFile(fp);
      const text = (await transcribe(fileId, lang)).trim();
      const c = cer(PHRASE[lang], text);
      const ok = c <= 0.10;
      rows.push({ fp, lang, g, expected: PHRASE[lang], got: text, cer: c, ok });
      console.log(`CER ${(c * 100).toFixed(1)}% ${ok ? 'PASS' : 'FAIL'} | "${text}"`);
    } catch (e) {
      rows.push({ fp, lang, g, expected: PHRASE[lang], got: '(오류: ' + e.message + ')', cer: 1, ok: false });
      console.log('ERROR', e.message);
    }
  }
}

const pass = rows.filter((r) => r.ok).length;
const md = [
  '# TTS 샘플 음성 검증 리포트',
  '',
  `- 생성: Cartesia sonic-3.5 (tts_samples/) · 검증: Soniox stt-async-preview (언어 힌트 지정)`,
  `- 판정: 원문 대비 CER ≤ 10% = PASS (문장부호·공백 무시 정규화 후 비교)`,
  `- 결과: **${pass}/${rows.length} PASS** · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
  '',
  '| 파일 | 기대 문장 | 인식 결과 | CER | 판정 |',
  '|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.fp.replace('tts_samples/', '')} | ${r.expected} | ${r.got} | ${(r.cer * 100).toFixed(1)}% | ${r.ok ? '✅ PASS' : '❌ FAIL'} |`),
  '',
  '정규화 비교 기준: ' + `normalize("${PHRASE.en}") → "${normalize(PHRASE.en)}"`,
].join('\n');
fs.writeFileSync('tts_samples/VERIFICATION.md', md);
console.log(`\n완료 — ${pass}/${rows.length} PASS → tts_samples/VERIFICATION.md`);
