/* 오디오 캡처 + 무음감지(VAD) + 서버 WS 송신.
   mic=오른쪽, system=왼쪽. system 은 전체화면+시스템오디오 공유로 PC 전체 소리. */

async function getSources(mode) {
  const list = [];
  if (mode === 'mic' || mode === 'both') {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    list.push({ src: 'mic', stream: mic });
  }
  if (mode === 'system' || mode === 'both') {
    const sys = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'monitor' },
      audio: true,
      systemAudio: 'include',
      monitorTypeSurfaces: 'include',
      surfaceSwitching: 'exclude',
    });
    if (sys.getAudioTracks().length === 0) {
      sys.getTracks().forEach((t) => t.stop());
      throw new Error('시스템 오디오가 선택되지 않았습니다. "전체 화면" 선택 후 "시스템 오디오 공유"를 켜주세요.');
    }
    sys.getVideoTracks().forEach((t) => t.stop());
    list.push({ src: 'system', stream: sys });
  }
  return list;
}

function floatTo16BitPCM(f32) {
  const buf = new ArrayBuffer(f32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < f32.length; i++) {
    let s = Math.max(-1, Math.min(1, f32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s, true);
  }
  return buf;
}
function downsampleTo24k(f32, inRate) {
  if (inRate === 24000) return f32;
  const ratio = inRate / 24000;
  const outLen = Math.round(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio,
      i0 = Math.floor(idx),
      i1 = Math.min(i0 + 1, f32.length - 1);
    out[i] = f32[i0] * (1 - (idx - i0)) + f32[i1] * (idx - i0);
  }
  return out;
}

/* opts: { sessionId, mode, inLang, outLang, pipeline, refine, onMessage, onMeter } */
export async function startRecorder(opts) {
  const { sessionId, mode, inLang, outLang, pipeline, refine, onMessage, onMeter } = opts;
  const sources = await getSources(mode); // 권한 거부 시 throw

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const inRate = audioCtx.sampleRate;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = `session=${sessionId}&out=${encodeURIComponent(outLang)}&in=${encodeURIComponent(
    inLang
  )}&pipeline=${pipeline}&refine=${refine ? '1' : '0'}`;

  const pipes = [];
  const streams = [];

  for (const { src, stream } of sources) {
    streams.push(stream);
    const ws = new WebSocket(`${proto}://${location.host}/ws/host?src=${src}&${q}`);
    ws.binaryType = 'arraybuffer';
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });
    ws.onmessage = (ev) => onMessage(JSON.parse(ev.data));

    const node = audioCtx.createMediaStreamSource(stream);
    const proc = audioCtx.createScriptProcessor(4096, 1, 1);
    node.connect(proc);
    const g = audioCtx.createGain();
    g.gain.value = 0;
    proc.connect(g);
    g.connect(audioCtx.destination);

    const frameMs = (4096 / inRate) * 1000;
    // 클라이언트는 자주 커밋해 원문을 흘려보내고, 표시 단위는 서버의 N초 배칭이 결정
    const SIL = Math.ceil(800 / frameMs); // 약 0.8초 무음 = 커밋
    const MAXF = Math.ceil(2500 / frameMs); // 연속 발화도 2.5초마다 커밋(서버가 모아서 N초 단위로 표시)
    const TH = 0.015;
    const vad = { speaking: false, silence: 0, since: 0 };

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0,
        peak = 0;
      for (let i = 0; i < input.length; i++) {
        const v = Math.abs(input[i]);
        sum += input[i] * input[i];
        if (v > peak) peak = v;
      }
      if (src === 'mic' && onMeter) onMeter(Math.sqrt(sum / input.length), peak);

      if (ws.readyState === WebSocket.OPEN) ws.send(floatTo16BitPCM(downsampleTo24k(input, inRate)));

      vad.since++;
      if (peak > TH) {
        vad.speaking = true;
        vad.silence = 0;
      } else vad.silence++;
      if (vad.speaking && (vad.silence >= SIL || vad.since >= MAXF)) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'commit' }));
        vad.speaking = false;
        vad.silence = 0;
        vad.since = 0;
      }
    };

    stream.getTracks().forEach((t) => (t.onended = () => stop()));
    pipes.push({ ws, proc });
  }

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    const closing = pipes.slice();
    for (const p of closing) {
      try {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'stop' }));
      } catch {}
      if (p.proc) p.proc.onaudioprocess = null;
    }
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    if (audioCtx) audioCtx.close();
    // 마지막 발화 결과가 도착하도록 잠시 후 닫기
    setTimeout(() => closing.forEach((p) => {
      try {
        p.ws.close();
      } catch {}
    }), 1800);
  }

  return { stop };
}
