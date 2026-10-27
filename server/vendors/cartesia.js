/* Cartesia Sonic 실시간 TTS — 보이스 매핑 + 상시 WebSocket(실패 시 HTTP 스트리밍 폴백) + 워밍업 */
import { WebSocket } from 'ws';
import { CARTESIA_TTS_WS_BASE, CARTESIA_API_KEY, CARTESIA_VERSION, CARTESIA_MODEL } from '../config.js';

// 출력 언어 × 성별 고정 보이스 매핑 (Cartesia voice id)
const _RONALD = '5ee9feff-1265-424a-9d7f-8e4d431a12c7';
const CARTESIA_VOICES = {
  ko: { male: '89f4372f-1f73-4b85-8e1e-5d24ed8bc826' /*jaewon*/, female: '4dd4630e-19e0-4243-bca0-676ff85119b7' /*Haeun*/ },
  en: { male: _RONALD, female: 'db6b0ed5-d5d3-463d-ae85-518a07d3c2b4' /*skylar*/ },
  ja: { male: _RONALD, female: 'd0ff6870-dd30-420d-8568-d756d806ea62' /*hinata*/ },
  zh: { male: _RONALD, female: '6eb8965c-e295-47bd-a9e4-3eeebb3abcff' /*Jing*/ },
};
export function cartesiaVoiceId(lang, gender) {
  const m = CARTESIA_VOICES[lang] || CARTESIA_VOICES.en;
  return gender === 'm' ? m.male : m.female;
}
// 미리듣기용 짧은 테스트 문장(언어별)
export const TTS_TEST_PHRASE = { ko: '안녕하세요, 음성 테스트입니다.', en: 'Hello, this is a voice test.', ja: 'こんにちは、音声テストです。', zh: '你好，这是语音测试。' };

/* ------------------------------------------------------------------ */
/*  Cartesia Sonic 실시간 TTS (텍스트 → 24kHz PCM16 스트리밍)            */
/*   bytes 엔드포인트의 스트리밍 본문을 청크 단위로 받아 즉시 흘려보냄.   */
/* ------------------------------------------------------------------ */
/* ---- Cartesia 상시 WebSocket ----
   문장마다 새 HTTP POST(/tts/bytes)를 열면 TLS 핸드셰이크 등 연결 비용(~100-300ms)을
   매 문장 지불한다 → 프로세스 전역 WS 1개를 유지하고 context_id 로 문장 요청을 다중화.
   실패(연결 불가·요청 에러·유휴 종료)하면 기존 HTTP 스트리밍으로 자동 폴백. */
let cartesiaSock = null;       // OPEN 상태의 전역 소켓(또는 null)
let cartesiaConnecting = null; // 연결 진행 중 프라미스(동시 호출 합류)
const cartesiaCtx = new Map(); // context_id -> { chunk(buf), done(), fail(err) }
let cartesiaCtxSeq = 0;

function cartesiaConnect() {
  if (cartesiaSock && cartesiaSock.readyState === WebSocket.OPEN) return Promise.resolve(cartesiaSock);
  if (cartesiaConnecting) return cartesiaConnecting;
  cartesiaConnecting = new Promise((resolve, reject) => {
    let settled = false;
    const fin = (fn, arg) => { if (settled) return; settled = true; cartesiaConnecting = null; fn(arg); };
    let ws;
    try {
      ws = new WebSocket(`${CARTESIA_TTS_WS_BASE}?api_key=${encodeURIComponent(CARTESIA_API_KEY)}&cartesia_version=${encodeURIComponent(CARTESIA_VERSION)}`);
    } catch (e) { fin(reject, e); return; }
    const to = setTimeout(() => { try { ws.close(); } catch {} fin(reject, new Error('cartesia ws connect timeout')); }, 8000);
    ws.on('open', () => { clearTimeout(to); cartesiaSock = ws; fin(resolve, ws); });
    ws.on('error', (e) => { clearTimeout(to); fin(reject, e); });
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      const h = m.context_id && cartesiaCtx.get(m.context_id);
      if (!h) return;
      if (m.type === 'chunk' && m.data) h.chunk(Buffer.from(m.data, 'base64'));
      else if (m.type === 'done') h.done();
      else if (m.type === 'error') h.fail(new Error(String(m.error || 'cartesia ws error').slice(0, 160)));
      // timestamps/flush_done 등 기타 타입은 무시
    });
    ws.on('close', () => {
      clearTimeout(to);
      if (cartesiaSock === ws) cartesiaSock = null;
      // 진행 중이던 요청은 실패 처리 → 호출부가 HTTP 로 폴백(유휴 서버 종료 등)
      for (const h of cartesiaCtx.values()) { try { h.fail(new Error('cartesia ws closed')); } catch {} }
      cartesiaCtx.clear();
      fin(reject, new Error('cartesia ws closed'));
    });
  });
  return cartesiaConnecting;
}

function cartesiaTTSWs(text, voiceId, language, onAudio) {
  return cartesiaConnect().then((ws) => new Promise((resolve, reject) => {
    const ctxId = `s${Date.now().toString(36)}x${++cartesiaCtxSeq}`;
    const MIN = 9600; // 24k * 2byte * 0.2s — HTTP 경로와 동일한 청크 정렬
    let carry = Buffer.alloc(0);
    let settled = false;
    const finish = (fn, arg) => { if (settled) return; settled = true; clearTimeout(to); cartesiaCtx.delete(ctxId); fn(arg); };
    // 응답 없는 요청 = 겉으로만 열린 죽은 연결로 보고 버린다 — 다음 문장은 새 연결(예전엔 30초 기다린 뒤에도 그 연결을
    // 계속 써서 문장마다 30초씩 밀렸고, 풀리는 순간 쌓인 문장이 몰아서 재생됐다). 버리면 같은 연결의 다른 요청은 HTTP 로 폴백.
    const to = setTimeout(() => {
      if (cartesiaSock === ws) cartesiaSock = null;
      try { ws.terminate(); } catch {}
      finish(reject, new Error('cartesia ws request timeout'));
    }, 10000);
    cartesiaCtx.set(ctxId, {
      chunk: (buf) => {
        carry = Buffer.concat([carry, buf]);
        if (carry.length >= MIN) {
          const even = carry.length - (carry.length % 2);
          onAudio(carry.subarray(0, even).toString('base64'));
          carry = carry.subarray(even);
        }
      },
      done: () => {
        if (carry.length >= 2) onAudio(carry.subarray(0, carry.length - (carry.length % 2)).toString('base64'));
        finish(resolve);
      },
      fail: (e) => finish(reject, e),
    });
    try {
      ws.send(JSON.stringify({
        model_id: CARTESIA_MODEL,
        transcript: text,
        voice: { mode: 'id', id: voiceId },
        language,
        context_id: ctxId,
        output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
      }));
    } catch (e) { finish(reject, e); }
  }));
}

export async function cartesiaTTSStream(text, voiceId, language, onAudio) {
  if (!CARTESIA_API_KEY || !text || !text.trim()) return;
  // 상시 WS 우선 — 실패 시(오디오를 아직 하나도 못 내보낸 경우에만) HTTP 폴백으로 재시도.
  // 오디오가 일부 나간 뒤 실패하면 재시도 시 문장이 겹쳐 들리므로 그대로 중단한다.
  let sent = false;
  try {
    await cartesiaTTSWs(text, voiceId, language, (b64) => { sent = true; onAudio(b64); });
    return;
  } catch (e) {
    if (sent) { console.error('[cartesia] ws 중단(부분 재생됨):', e.message); return; }
    console.error('[cartesia] ws 실패 → HTTP 폴백:', e.message);
  }
  await cartesiaTTSHttp(text, voiceId, language, onAudio);
}

async function cartesiaTTSHttp(text, voiceId, language, onAudio) {
  if (!CARTESIA_API_KEY || !text || !text.trim()) return;
  const body = {
    model_id: CARTESIA_MODEL,
    transcript: text,
    voice: { mode: 'id', id: voiceId },
    language,
    output_format: { container: 'raw', encoding: 'pcm_s16le', sample_rate: 24000 },
  };
  let res;
  try {
    res = await fetch('https://api.cartesia.ai/tts/bytes', {
      method: 'POST',
      headers: {
        'X-API-Key': CARTESIA_API_KEY,
        'Cartesia-Version': CARTESIA_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) { console.error('[cartesia] error', e.message); return; }
  if (!res.ok || !res.body) { console.error('[cartesia] HTTP', res.status, (await res.text().catch(() => '')).slice(0, 160)); return; }
  // 스트리밍 raw PCM16 → ~0.2초 단위로 짝수바이트 정렬해 전송(끊김 없는 순차 재생)
  const MIN = 9600; // 24k * 2byte * 0.2s
  let carry = Buffer.alloc(0);
  try {
    for await (const chunk of res.body) {
      carry = Buffer.concat([carry, Buffer.from(chunk)]);
      if (carry.length >= MIN) {
        const even = carry.length - (carry.length % 2);
        onAudio(carry.subarray(0, even).toString('base64'));
        carry = carry.subarray(even);
      }
    }
    if (carry.length >= 2) {
      const even = carry.length - (carry.length % 2);
      onAudio(carry.subarray(0, even).toString('base64'));
    }
  } catch (e) { console.error('[cartesia] stream', e.message); }
}

// 시작 시 연결 워밍업 + 키/보이스 검증(첫 음성 지연 단축) — 상시 WS 를 미리 열고
// 짧은 합성 1회로 키/보이스까지 확인한다(오디오는 버림). WS 불가 환경이면 HTTP 폴백으로 검증.
export async function cartesiaWarmup(voiceId, language) {
  if (!CARTESIA_API_KEY) return { ok: false, error: 'CARTESIA_API_KEY 미설정' };
  // 구두점만 있는 transcript 는 거부됨 → 언어별 짧은 단어 사용
  const tx = { ko: '네.', en: 'Hi.', ja: 'はい。', zh: '你好。' }[language] || 'Hi.';
  try {
    let got = false;
    await cartesiaTTSStream(tx, voiceId, language, () => { got = true; });
    return got ? { ok: true } : { ok: false, error: '합성 응답 없음(키/보이스 확인)' };
  } catch (e) { return { ok: false, error: e.message }; }
}
