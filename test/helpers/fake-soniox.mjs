/* 가짜 Soniox 엔진(WS 서버) — 파이프라인 테스트용.
   서버(server.js)를 SONIOX_WS_URL=이곳 으로 띄우면 실 엔진 대신 여기에 붙는다(무과금·결정적).
   프로토콜(서버가 기대하는 것만 최소 구현):
   - 연결 직후 서버가 config JSON(텍스트 1건)을 보낸다 → conn.config 로 캡처
   - 이후 바이너리 = 오디오(집계만), 빈 텍스트 = 종료 신호
   - 테스트가 conn.sendTokens([...]) 로 토큰 이벤트를 재생: { text, is_final, language, confidence, translation_status }
   - conn.end() = <end> 토큰(발화 확정 트리거) */
import { WebSocketServer } from 'ws';

export async function startFakeSoniox() {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((res) => wss.once('listening', res));
  const connections = [];
  const waiters = [];
  wss.on('connection', (ws) => {
    let resolveConfig;
    const conn = {
      ws,
      config: null,
      audioBytes: 0,
      closed: false,
      waitConfig: null,
      sendTokens(tokens) { ws.send(JSON.stringify({ tokens })); },
      end() { ws.send(JSON.stringify({ tokens: [{ text: '<end>', is_final: true }] })); },
      error(code, msg) { ws.send(JSON.stringify({ error_code: code, error_message: msg || '' })); },
      close() { try { ws.close(); } catch {} },
    };
    conn.waitConfig = new Promise((r) => { resolveConfig = r; });
    ws.on('message', (data) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      if (!conn.config) {
        try { conn.config = JSON.parse(buf.toString()); resolveConfig(conn.config); return; } catch {}
      }
      conn.audioBytes += buf.length;
    });
    ws.on('close', () => { conn.closed = true; });
    ws.on('error', () => {});
    connections.push(conn);
    if (waiters.length) waiters.shift()(conn);
  });
  let claimed = 0; // nextConnection() 이 같은 연결을 두 번 반환하지 않게
  return {
    url: `ws://127.0.0.1:${wss.address().port}`,
    connections,
    nextConnection(timeoutMs = 8000) {
      if (claimed < connections.length) return Promise.resolve(connections[claimed++]);
      return new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('fake-soniox: 연결 대기 시간 초과')), timeoutMs);
        waiters.push((c) => { clearTimeout(to); claimed++; res(c); });
      });
    },
    close: () => new Promise((r) => { for (const c of connections) c.close(); wss.close(() => r()); }),
  };
}
