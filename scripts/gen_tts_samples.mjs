// 언어별 TTS 테스트 문장 → mp3 저장 (tts_samples/<lang>/<lang>_female|male.mp3)
// 사용: CARTESIA_API_KEY=sk_car_... node scripts/gen_tts_samples.mjs
//  (또는 .env 에 CARTESIA_API_KEY 가 있으면 자동 인식)
// 문장: 서버 미리듣기 문장(TTS_TEST_PHRASE) 기준 + ru/es 추가. '라틴어'는 라틴어권(스페인어)로 해석.
import fs from 'fs';

let KEY = process.env.CARTESIA_API_KEY || '';
if (!KEY && fs.existsSync('.env')) KEY = (fs.readFileSync('.env', 'utf8').match(/CARTESIA_API_KEY=(.+)/) || [])[1]?.trim() || '';
if (!KEY) { console.error('CARTESIA_API_KEY 필요 — 환경변수 또는 .env 에 설정 후 실행'); process.exit(1); }

const MODEL = 'sonic-3.5', VER = '2025-04-16';
const VOICES = { // 서버 CARTESIA_VOICES 와 동일 + ru/es 는 다국어 보이스(skylar/ronald) 재사용
  en: { f: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', m: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' },
  ja: { f: 'd0ff6870-dd30-420d-8568-d756d806ea62', m: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' },
  zh: { f: '6eb8965c-e295-47bd-a9e4-3eeebb3abcff', m: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' },
  ru: { f: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', m: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' },
  es: { f: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4', m: '5ee9feff-1265-424a-9d7f-8e4d431a12c7' },
};
const PHRASE = {
  en: 'Hello, this is a voice test.',
  ja: 'こんにちは、音声テストです。',
  zh: '你好，这是语音测试。',
  ru: 'Здравствуйте, это голосовой тест.',
  es: 'Hola, esta es una prueba de voz.',
};

for (const [lang, text] of Object.entries(PHRASE)) {
  fs.mkdirSync(`tts_samples/${lang}`, { recursive: true });
  for (const g of ['f', 'm']) {
    const r = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: { 'X-API-Key': KEY, 'Cartesia-Version': VER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_id: MODEL, transcript: text, voice: { mode: 'id', id: VOICES[lang][g] }, language: lang,
        output_format: { container: 'mp3', bit_rate: 128000, sample_rate: 44100 },
      }),
    });
    if (!r.ok) { console.error(lang, g, 'FAIL', r.status, (await r.text()).slice(0, 120)); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    const f = `tts_samples/${lang}/${lang}_${g === 'f' ? 'female' : 'male'}.mp3`;
    fs.writeFileSync(f, buf);
    console.log(f, Math.round(buf.length / 1024) + 'KB');
  }
}
console.log('완료 — tts_samples/ 아래 언어별 폴더 확인');
