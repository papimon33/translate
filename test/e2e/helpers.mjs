// 화면 테스트 공용 — 로그인·세션 만들기·안드로이드 앱 마이크 흉내
export async function login(request) {
  const r = await request.post('/api/login', { data: { id: 'admin', password: 'admin', replace: true } });
  if (!r.ok()) throw new Error('login failed ' + r.status());
}
export async function createSession(request, body) {
  const r = await request.post('/api/sessions', { data: { pipeline: 'soniox', src: 'mic', inLang: 'auto', ...body } });
  return r.json();
}
export async function qrOf(request, id) {
  return (await request.get(`/api/qr?session=${id}`)).json();
}
// 폰 앱(WebView)의 네이티브 마이크 브리지 흉내 — 조용한 잡음 프레임을 흘린다(2채널: 좌우 독립)
export const androidAudioStub = () => {
  let tm = null;
  const frame = (ch) => {
    const n = 480 * ch; const b = new Uint8Array(n * 2);
    for (let i = 0; i < n; i++) { let v = Math.round((Math.random() * 2 - 1) * 0.003 * 32767); if (v < 0) v += 65536; b[2 * i] = v & 255; b[2 * i + 1] = v >> 8; }
    let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s);
  };
  const run = (ch) => { clearInterval(tm); tm = setInterval(() => { if (ch === 2 && window.__kacNA2) window.__kacNA2(frame(2)); else if (window.__kacNA) window.__kacNA(frame(1)); }, 40); };
  window.AndroidAudio = { start() { run(1); return true; }, startStereo() { run(2); return 2; }, stop() { clearInterval(tm); }, inputLabel() { return 'USB 마이크 (TEST)'; }, inputs() { return '[]'; }, setInput() { return true; } };
};
// 가짜 엔진 조작(test/e2e/server.mjs 의 :3013)
const ENGINE = 'http://127.0.0.1:3013';
export const engine = {
  conns: async () => (await fetch(ENGINE + '/conns')).json(),
  say: async (tokens) => { const r = await fetch(ENGINE + '/tok', { method: 'POST', body: JSON.stringify({ tokens }) }); if (!r.ok) throw new Error('engine ' + r.status); },
  end: async () => { await fetch(ENGINE + '/end', { method: 'POST' }); },
};
