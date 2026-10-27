/* 구 translate 파이프라인 — gpt-realtime-translate 스트리밍 + 띄어쓰기만 교정. handleHost 가 runTranslate(h) 를 호출한다. */
import { WebSocket } from 'ws';
import { OPENAI_API_KEY, TRANSLATE_MODEL } from '../config.js';
import { newId } from '../store/sessions.js';
import { broadcastAudio } from '../realtime/rooms.js';
import { spacingPolish } from '../vendors/openai.js';
import { stripFillers } from '../util/pipeline_util.js';

/* ---------- gpt-realtime-translate -> gpt 다듬기 ---------- */
export function runTranslate(h) {
  const { ws, sessionId, targetLang, idle, toHost, liveSend, upsertItem, bumpIdle } = h;
  const oa = new WebSocket(
    `wss://api.openai.com/v1/realtime/translations?model=${encodeURIComponent(TRANSLATE_MODEL)}`,
    { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
  );
  idle.close = () => { try { oa.close(); } catch {} };
  let oaReady = false;
  let closing = false;
  let buf = '';
  let curId = null;
  let idleTimer = null;
  let audioOut = ws._audioOut; // 번역 음성 재생 여부(클라 토글로 변경 가능)
  const pending = [];

  // translate 출력은 이미 자연스러운 번역이라, 카드에 바로 스트리밍해서 보여준다.
  const IDLE_MS = 1200; // 이만큼 새 글자가 없으면(말이 멈추면) 그 카드를 확정
  const MAX_BUF = 280; // 너무 길어지면 강제 확정(폭주 방지)
  // 스트리밍 중간 업데이트(저장 안 함): 같은 id 로 보내 카드 텍스트가 실시간으로 자라남
  const liveUpdate = () => {
    if (!curId) curId = newId();
    liveSend(curId, { [targetLang]: buf }, null);
  };
  // 확정: 세션에 저장하고, 다듬기 켜져 있으면 다듬어 교체
  const finalize = () => {
    clearTimeout(idleTimer);
    const text = stripFillers(buf.trim()); // 추임새(간투사) 제거
    const id = curId;
    buf = '';
    curId = null;
    if (!text || !id) return;
    upsertItem(id, { [targetLang]: text }, null);
    // translate 다듬기: 띄어쓰기만 교정 (단어·어순·내용 보존)
    spacingPolish(text).then((p) => p && upsertItem(id, { [targetLang]: stripFillers(p.trim()) }, null));
  };

  oa.on('open', () => {
    oa.send(
      JSON.stringify({
        type: 'session.update',
        session: { audio: { output: { language: targetLang } } },
      })
    );
    // 세션 준비 전 오디오는 버려지므로, 준비 이벤트(또는 1.5s 폴백) 후 전송.
    setTimeout(markReady, 1500);
  });
  function markReady() {
    if (oaReady) return;
    // 1.5s 폴백 타이머가 그 사이 죽은 소켓을 '연결됨'으로 되살리지 않게 — close 가 oaReady=false 로
    // 리셋한 뒤 폴백이 다시 true 로 만들면 이후 모든 오디오가 죽은 소켓으로 조용히 버려졌다.
    if (!oa || oa.readyState !== WebSocket.OPEN) return;
    oaReady = true;
    while (pending.length) oa.send(pending.shift());
    toHost({ type: 'status', message: '엔진 연결됨 (translate)' });
    bumpIdle(); // 무입력 카운트다운 시작
  }

  oa.on('message', (raw) => {
    let ev;
    try {
      ev = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!oaReady && /session\.(created|updated)/.test(ev.type || '')) markReady(); // 준비됨 → 버퍼 오디오 전송
    if (ev.type === 'session.output_audio.delta') {
      if (ev.delta) {
        if (audioOut) toHost({ type: 'audio', b64: ev.delta }); // 호스트: 자체 토글
        broadcastAudio(sessionId, ev.delta); // 모바일 뷰어: '음성 듣기' 켠 사람에게만 전송
      }
      return;
    }
    if (ev.type === 'session.output_transcript.delta') {
      bumpIdle(); // 번역 활동 → 유휴 타이머 리셋
      buf += ev.delta || '';
      liveUpdate(); // 카드에 바로 스트리밍
      if (buf.length >= MAX_BUF) {
        finalize();
      } else {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finalize, IDLE_MS); // 말이 멈추면 그 카드 확정
      }
    } else if (ev.type === 'session.closed') {
      finalize();
      try {
        oa.close();
      } catch {}
    } else if (ev.type && ev.type.includes('error')) {
      console.error('[translate error]', JSON.stringify(ev));
      toHost({ type: 'status', message: '엔진 오류: ' + (ev.error?.message || ev.type) });
    }
  });
  oa.on('error', (e) => toHost({ type: 'status', message: 'OpenAI 연결 오류: ' + (e?.message || e) }));
  // 죽은 소켓으로 send 방지 + translate 는 자동 재연결이 없으므로 캡처를 명시적으로 멈춰
  // '진행 중처럼 보이며 오디오가 조용히 버려지는' 상태를 만들지 않는다.
  oa.on('close', () => {
    oaReady = false;
    toHost({ type: 'idle-stop' });
    toHost({ type: 'status', message: '엔진 연결 종료 — 다시 시작해 주세요.' });
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const msg = JSON.stringify({ type: 'session.input_audio_buffer.append', audio: Buffer.from(data).toString('base64') });
      if (oaReady) oa.send(msg);
      else { pending.push(msg); if (pending.length > 400) pending.shift(); } // 연결 전 큐 상한(~30초) — 엔진 미연결 장기화 시 메모리 폭증 방지
      return;
    }
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (m.type === 'audioOut') {
      audioOut = !!m.on; // 토글 실시간 반영
      return;
    }
    if (m.type === 'stop' && !closing) {
      closing = true;
      try {
        if (oaReady) oa.send(JSON.stringify({ type: 'session.close' }));
        else oa.close();
      } catch {}
    }
  });
  ws.on('close', () => {
    finalize(); // 남은 스트리밍 확정/저장
    try {
      oa.close();
    } catch {}
  });
}
