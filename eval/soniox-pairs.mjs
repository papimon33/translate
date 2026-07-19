/* 데스크 모드 검증용 soniox 진단 스크립트 (의존성 없음, node 18+ 전역 WebSocket 사용).
 *
 * 사용법:
 *   node eval/soniox-pairs.mjs
 *       → ko ↔ 각 취항국 언어 two_way 설정 수용 테스트(무음 0.5s 전송, error_code 여부 확인)
 *   node eval/soniox-pairs.mjs audio <file.pcm> [hintLang]
 *       → 24kHz mono s16le PCM 파일을 흘려보내 "감지 모드"(one_way→ko) 동작 확인:
 *         첫 언어감지까지 걸린 시간(ms) + 원문/번역 실시간 출력
 *
 * 키: SONIOX_API_KEY (환경변수 또는 프로젝트 루트 .env). 주의: 호출은 과금됨.
 * PCM 만들기 예: ffmpeg -i sample.mp3 -ac 1 -ar 24000 -f s16le sample.pcm
 */
import fs from 'node:fs';

function loadEnv() {
  try {
    const t = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of t.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv();

const KEY = process.env.SONIOX_API_KEY;
const URL_SX = 'wss://stt-rt.soniox.com/transcribe-websocket';
const CANDIDATES = ['en', 'ja', 'zh', 'vi', 'th', 'tl', 'id', 'ru', 'ms']; // 몽골(mn)·광둥은 미지원

if (!KEY) { console.error('❌ SONIOX_API_KEY 없음 — .env에 넣거나 환경변수로 주세요.'); process.exit(1); }
if (typeof WebSocket === 'undefined') { console.error('❌ 이 node에 전역 WebSocket 없음 — node 18+ 필요.'); process.exit(1); }

const baseCfg = {
  api_key: KEY, model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
  enable_language_identification: true, enable_endpoint_detection: true,
};

function testPair(lang) {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL_SX);
    let settled = false, err = null;
    const done = (status) => { if (settled) return; settled = true; try { ws.close(); } catch {} resolve({ lang, status, err }); };
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      ws.send(JSON.stringify({ ...baseCfg, translation: { type: 'two_way', language_a: 'ko', language_b: lang }, language_hints: ['ko', lang] }));
      ws.send(new Int16Array(12000).buffer); // 0.5s 무음으로 설정 검증 유도
      setTimeout(() => done(err ? 'ERROR' : 'OK (config accepted)'), 2500);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.error_code) { err = `${m.error_code} ${m.error_message || ''}`.trim(); done('ERROR'); }
    };
    ws.onerror = (e) => { err = (e && e.message) || 'ws error'; };
    ws.onclose = () => { if (!settled) done(err ? 'ERROR' : 'CLOSED(no response)'); };
  });
}

async function streamAudio(file) {
  if (!file || !fs.existsSync(file)) { console.error('❌ PCM 파일 경로가 필요합니다 (24kHz mono s16le).'); process.exit(1); }
  const buf = fs.readFileSync(file);
  const ws = new WebSocket(URL_SX);
  const t0 = Date.now();
  let firstLang = null, firstLangT = null;
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    ws.send(JSON.stringify({ ...baseCfg, translation: { type: 'one_way', target_language: 'ko' }, language_hints: ['ko', ...CANDIDATES] }));
    let off = 0; const chunk = 4800; // ~100ms
    const iv = setInterval(() => {
      if (off >= buf.length) { clearInterval(iv); try { ws.send(''); } catch {} return; }
      ws.send(buf.subarray(off, off + chunk)); off += chunk;
    }, 100);
  };
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.error_code) { console.error('\n❌ ERROR', m.error_code, m.error_message || ''); return; }
    const toks = m.tokens || [];
    for (const t of toks) {
      if (t.language && !firstLang && t.translation_status !== 'translation' && t.text !== '<end>') {
        firstLang = String(t.language).split('-')[0]; firstLangT = Date.now() - t0;
        console.log(`\n>> 첫 언어감지: ${firstLang} (+${firstLangT}ms)`);
      }
    }
    const src = toks.filter((t) => t.translation_status !== 'translation' && t.text !== '<end>').map((t) => t.text).join('');
    const tr = toks.filter((t) => t.translation_status === 'translation').map((t) => t.text).join('');
    if (src || tr) process.stdout.write(`\r원문: ${src}   →ko: ${tr}`.slice(0, 160));
  };
  ws.onclose = () => console.log(`\n— 종료. 첫 언어감지=${firstLang || '없음'}${firstLangT != null ? ` (+${firstLangT}ms)` : ''}`);
  ws.onerror = (e) => console.error('\n❌ ws error', (e && e.message) || e);
}

const [, , mode, file] = process.argv;
if (mode === 'audio') {
  await streamAudio(file);
} else {
  console.log('two_way 설정 수용 테스트 (ko ↔ 각 언어):\n');
  for (const l of CANDIDATES) {
    const r = await testPair(l);
    const mark = r.status.startsWith('OK') ? '✅' : '⚠️ ';
    console.log(`  ${mark} ko↔${l}: ${r.status}${r.err ? ' — ' + r.err : ''}`);
  }
  console.log('\n(설정 수용 ≠ 번역 품질 보장. 품질/감지속도는 audio 모드 또는 실사용 검증.)');
}
