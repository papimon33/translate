/* 오디오 캡처 + 무음감지(VAD) + 서버 WS 송신.
   mic=오른쪽, system=왼쪽. system 은 전체화면+시스템오디오 공유로 PC 전체 소리. */

async function getSources(mode, agcOff) {
  const list = [];
  if (mode === 'mic' || mode === 'both') {
    // autoGainControl(AGC): 볼륨 게이트(민감도<100) 사용 시엔 반드시 꺼야 한다 —
    // 브라우저 AGC 가 속삭임·먼 소리를 보통 음량으로 증폭한 '뒤에' 게이트에 도달해
    // RMS 임계를 아무리 낮춰도(1이어도) 걸러지지 않던 원인. 100(게이트 없음)이면 기존대로 켠다.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: !agcOff },
    });
    list.push({ src: 'mic', stream: mic });
  }
  if (mode === 'system' || mode === 'both') {
    let sys;
    try {
      sys = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: true,
        systemAudio: 'include',
        monitorTypeSurfaces: 'include',
        surfaceSwitching: 'exclude',
      });
    } catch (e) {
      // '모두' 모드에서 화면공유 취소 시 먼저 획득한 마이크를 방치하지 않는다(녹음 표시등 계속 켜지던 문제)
      list.forEach(({ stream }) => stream.getTracks().forEach((t) => t.stop()));
      throw e;
    }
    if (sys.getAudioTracks().length === 0) {
      sys.getTracks().forEach((t) => t.stop());
      list.forEach(({ stream }) => stream.getTracks().forEach((t) => t.stop()));
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
  const { sessionId, mode, inLang, outLang, pipeline, refine, onMessage, onMeter, audioOut, volume, endpointing, micSens, sxSens, sxMaxDelay, sxLatency, model, sxMode, sxTarget, sxA, sxB, tts, gender, diar, deskLangs, deskIdle, deskGuestSens } = opts;
  // 마이크 음성인식 민감도(0~100): 100=가장 민감(게이트 없음), 낮출수록 조용한 소리를 무시.
  //  · 게이트 기준은 RMS(프레임 평균 음량) — peak(순간 최대) 는 속삭임의 자음(ㅅ·ㅌ) 스파이크에도
  //    열려 버려 소용없었다. RMS 는 '지속적으로 일정 음량 이상'일 때만 열려 속삭임·주변소음을 잘 거른다.
  //  · 임계 범위 0~0.05(RMS): 보통 대화(≈0.03~0.1)는 통과, 속삭임(≈0.005~0.02)·실내소음은 차단.
  //  · 녹음 중에도 setMicSens 로 실시간 변경 가능(데스크는 상시 캡처라 이 경로가 유일한 조절 수단).
  //  · 적응형 게이트: 절대 RMS 임계는 기기·AGC(iOS 는 off 요청 무시)마다 값이 제각각이라 무의미했다.
  //    대신 '주변 소음 바닥(noiseFloor) 대비 몇 배 큰가'로 판정 → 기기 게인과 무관하게 근접/원거리 구분.
  //    슬라이더(민감도)는 '바닥 대비 배수(ratio)'와 '절대 하한(absMin)'을 조절. 100=게이트 없음.
  let micSensVal = typeof micSens === 'number' ? micSens : 100;
  let micRatio = 0, micAbsMin = 0;
  const calcGate = (v) => {
    if (!(typeof v === 'number' && v < 100)) { micRatio = 0; micAbsMin = 0; return; }
    const k = (100 - v) / 100;         // 0(민감)~1(엄격)
    micRatio = 1 + k * 7;              // 바닥의 1~8배 이상이어야 열림
    micAbsMin = 0.004 + k * 0.03;      // 절대 하한 0.004~0.034(완전 무음·미세잡음 차단)
  };
  calcGate(micSensVal);
  const sources = await getSources(mode, micRatio > 0); // 권한 거부 시 throw. 게이트 사용 시 AGC off 시도
  // 마이크 트랙(민감도 변경 시 AGC 실시간 토글용)
  const micTrack = (() => { const m = sources.find((s) => s.src === 'mic'); return m ? m.stream.getAudioTracks()[0] : null; })();
  let noiseFloor = 0.005; // 적응형 소음 바닥(조용할 때로 빠르게 수렴, 소리날 때 아주 느리게 상승)

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const inRate = audioCtx.sampleRate;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const q = `session=${sessionId}&out=${encodeURIComponent(outLang)}&in=${encodeURIComponent(
    inLang
  )}&pipeline=${pipeline}&refine=${refine ? '1' : '0'}&audioOut=${audioOut ? '1' : '0'}${
    pipeline === 'deepgram' && endpointing != null ? `&endpointing=${encodeURIComponent(endpointing)}` : ''
  }${
    pipeline === 'soniox'
      ? `&sxSens=${encodeURIComponent(sxSens)}&sxMaxDelay=${encodeURIComponent(sxMaxDelay)}&sxLatency=${encodeURIComponent(sxLatency)}&sxMode=${encodeURIComponent(sxMode || 'one')}&sxTarget=${encodeURIComponent(sxTarget || 'en')}&sxA=${encodeURIComponent(sxA || 'ko')}&sxB=${encodeURIComponent(sxB || 'en')}${
          tts ? `&tts=1&gender=${encodeURIComponent(gender || 'f')}` : ''
        }${diar ? '&diar=1' : ''}`
      : ''
  }${
    pipeline === 'desk'
      ? `&sxSens=${encodeURIComponent(sxSens)}&sxMaxDelay=${encodeURIComponent(sxMaxDelay)}&sxLatency=${encodeURIComponent(sxLatency)}${
          deskLangs ? `&deskLangs=${encodeURIComponent(deskLangs)}` : ''
        }${deskIdle ? `&deskIdle=${encodeURIComponent(deskIdle)}` : ''}${deskGuestSens != null ? `&deskGuestSens=${encodeURIComponent(deskGuestSens)}` : ''}`
      : ''
  }${model ? `&model=${encodeURIComponent(model)}` : ''}`;

  const pipes = [];
  const streams = [];
  let muted = false; // 발화 일시정지: 연결은 유지하고 마이크 전송만 끔(무음 전송)
  let ttsMutedUntil = 0; // TTS 재생 동안 마이크 자동 음소거(피드백 방지) — audioCtx 시간 기준

  // 번역 음성 재생(translate): 서버가 보내는 24kHz PCM16 청크를 끊김 없이 스케줄링
  let audioOutOn = !!audioOut;
  let outCursor = 0;
  const outGain = audioCtx.createGain();
  outGain.gain.value = typeof volume === 'number' ? volume : 1;
  outGain.connect(audioCtx.destination);

  // TTS 재생을 WebRTC 루프백으로 우회 — 브라우저 AEC(echoCancellation)가 이 재생음을 참조 신호로 잡아
  // 마이크 입력에서 제거하므로, 재생음이 다시 인식되는 피드백 루프를 마이크를 끄지 않고 막는다.
  // (Web Audio 직접 재생은 AEC 참조 경로 밖이라 에코로 인식되지 않음)
  let aecActive = false;
  let aecParts = null;
  async function setupAecLoopback() {
    try {
      const dest = audioCtx.createMediaStreamDestination();
      const pc1 = new RTCPeerConnection();
      const pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {}); };
      pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {}); };
      const audioEl = new Audio();
      audioEl.autoplay = true;
      pc2.ontrack = (e) => { audioEl.srcObject = e.streams[0]; audioEl.play().catch(() => {}); };
      dest.stream.getTracks().forEach((t) => pc1.addTrack(t, dest.stream));
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      outGain.disconnect();
      outGain.connect(dest); // 이후 TTS 는 WebRTC 경로로 재생(AEC 참조 대상)
      aecParts = { pc1, pc2, audioEl };
      aecActive = true;
    } catch {
      // 실패 시 기존 직접 재생 유지(+ 재생 중 자동 음소거 폴백)
      try { outGain.disconnect(); } catch {}
      try { outGain.connect(audioCtx.destination); } catch {}
      aecActive = false;
    }
  }
  // TTS 를 나중에 켤 수도 있으므로(녹음 중 토글) 음성 재생 가능 파이프라인이면 미리 준비
  if (audioOut || opts.tts || pipeline === 'soniox' || pipeline === 'translate') setupAecLoopback();
  const playPcm24 = (b64) => {
    try {
      const bin = atob(b64);
      const n = bin.length >> 1;
      const buf = audioCtx.createBuffer(1, n, 24000);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const lo = bin.charCodeAt(i * 2), hi = bin.charCodeAt(i * 2 + 1);
        let s = (hi << 8) | lo;
        if (s >= 0x8000) s -= 0x10000;
        ch[i] = s / 32768;
      }
      const node = audioCtx.createBufferSource();
      node.buffer = buf;
      node.connect(outGain);
      const now = audioCtx.currentTime;
      if (outCursor < now) outCursor = now + 0.08; // 약간의 버퍼로 초기 끊김 방지
      node.start(outCursor);
      outCursor += buf.duration;
      ttsMutedUntil = outCursor + 0.3; // 재생 끝 + 짧은 꼬리까지 마이크 음소거
    } catch {}
  };

  // 유휴 신호 전역화: 어느 소스(마이크/시스템)든 소리가 있으면 모든 연결에 activity 전송.
  // 소스별로 따로 보내면 '모두' 모드에서 조용한 쪽 연결이 1분 유휴로 세션 전체를 끊는 문제가 생긴다.
  let lastActivityAll = 0;
  const notifyActivityAll = () => {
    const t = Date.now();
    if (t - lastActivityAll < 2000) return;
    lastActivityAll = t;
    for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'activity' })); } catch {} }
  };

  // (TDZ 수정) 루프 안에서 배선되는 onmessage/onended 가 참조하므로 루프보다 먼저 선언 —
  // '모두' 모드에서 두 번째 소스 연결 대기 중 첫 소켓 메시지가 ReferenceError 나던 문제
  let stopped = false;
  // 녹음 중 변경된 제어 상태 — 자동 재연결 시 새 소켓은 시작 시점 URL 파라미터로 초기화되므로
  // 변경분(TTS on/off, 발화멈춤, 여객 민감도)을 재전송해 서버 상태가 되돌아가는 문제를 막는다
  const ctlState = { audioOut: null, tts: null, muted: null, guestSens: null };
  const resendState = (sock) => {
    try {
      if (ctlState.muted != null) sock.send(JSON.stringify({ type: 'micState', muted: ctlState.muted }));
      if (ctlState.tts != null) sock.send(JSON.stringify({ type: 'tts', on: ctlState.tts.on, ...(ctlState.tts.gender ? { gender: ctlState.tts.gender } : {}) }));
      if (ctlState.audioOut != null) sock.send(JSON.stringify({ type: 'audioOut', on: ctlState.audioOut }));
      if (ctlState.guestSens != null) sock.send(JSON.stringify({ type: 'desk-guest-sens', value: ctlState.guestSens }));
    } catch {}
  };

  for (const { src, stream } of sources) {
    streams.push(stream);
    const isAudioPipe = pipes.length === 0; // 서버 TTS 음성은 첫 연결에서만 재생(모두 모드 이중 재생 방지)
    const wsUrl = `${proto}://${location.host}/ws/host?src=${src}&${q}`;
    const pipe = { src, ws: null, proc: null };

    // 소켓 배선 — 초기 연결과 자동 재연결이 공용
    const wire = (sock) => {
      sock.binaryType = 'arraybuffer';
      // 재연결 소켓: 열리면 변경된 제어 상태 복원(초기 소켓 ws0 은 이미 OPEN 이라 안 걸림)
      sock.onopen = () => resendState(sock);
      sock.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        // 중지 후 결과 수신 창(1.8초) 동안엔 자막 병합만 허용 — 구 소켓이 받은 takeover 등
        // 제어 메시지가 새로 시작한 녹음을 죽이는 레이스 차단
        if (stopped && m.type !== 'sentence' && m.type !== 'partial') return;
        if (m.type === 'audio') {
          if (audioOutOn && isAudioPipe) playPcm24(m.b64);
          return;
        }
        onMessage(m);
      };
      sock.onclose = () => {
        if (stopped || pipe.ws !== sock) return;
        // 네트워크 블립·서버 재시작 → 자동 재연결('진행 중' 표시인 채 무음이 지속되던 문제 수정)
        try { onMessage({ type: 'status', message: '연결이 끊겨 재연결 중…' }); } catch {}
        setTimeout(() => {
          if (stopped || pipe.ws !== sock) return;
          const re = new WebSocket(wsUrl);
          pipe.ws = re;
          wire(re);
        }, 2000);
      };
    };

    const ws0 = new WebSocket(wsUrl);
    pipe.ws = ws0;
    try {
      await new Promise((res, rej) => {
        // 연결이 영원히 매달리는(half-open) 경우 방지 — 12초 후 실패 처리
        const to = setTimeout(() => { try { ws0.close(); } catch {} rej(new Error('연결 시간 초과 — 다시 시도해 주세요.')); }, 12000);
        ws0.onopen = () => { clearTimeout(to); res(); };
        ws0.onerror = () => { clearTimeout(to); rej(new Error('연결 실패 — 다시 시도해 주세요.')); };
      });
    } catch (e) {
      // 연결 실패 시 이미 획득한 마이크/스트림·오디오 자원을 정리하고 실패를 알린다(자원 누수 방지)
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      pipes.forEach((p) => { try { p.ws.close(); } catch {} });
      try { audioCtx.close(); } catch {}
      throw e;
    }
    wire(ws0);

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
    let lastActivitySent = 0;
    let gateOpenUntil = 0; // 게이트가 열려 있는(전송) 시한 — 마지막 큰 소리 이후 hold

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0,
        peak = 0;
      for (let i = 0; i < input.length; i++) {
        const v = Math.abs(input[i]);
        sum += input[i] * input[i];
        if (v > peak) peak = v;
      }
      const rms = Math.sqrt(sum / input.length);
      if (src === 'mic' && onMeter) onMeter(rms, peak);

      const w = pipe.ws; // 재연결로 소켓이 바뀌어도 항상 현재 소켓 사용
      const wOpen = w && w.readyState === WebSocket.OPEN;

      // 발화 일시정지(mute), 또는 (AEC 미지원 폴백일 때만) TTS 재생 중 자동 음소거: 무음 전송 + keepalive
      // AEC 루프백이 켜져 있으면 재생음이 마이크에서 제거되므로 TTS 중에도 발화 가능(음소거 안 함)
      if (muted || (!aecActive && audioCtx.currentTime < ttsMutedUntil)) {
        if (wOpen) {
          const ds = downsampleTo24k(input, inRate);
          w.send(new ArrayBuffer(ds.length * 2));
          const t = Date.now();
          if (t - lastActivitySent > 5000) { lastActivitySent = t; notifyActivityAll(); }
        }
        return;
      }

      // 볼륨 게이트(마이크만): 적응형 — 소음 바닥(noiseFloor) 대비 micRatio 배 이상이고 절대 하한도 넘을 때만 열림.
      // 조용할 땐 바닥으로 빠르게 수렴, 소리날 땐 아주 느리게 상승 → 근접 발화(바닥보다 훨씬 큼)만 통과.
      let gated = false;
      if (src === 'mic' && micRatio > 0) {
        if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.3; // 조용 → 빠르게 수렴
        else noiseFloor += (rms - noiseFloor) * 0.002;                // 소리 → 아주 느리게 상승(발화로 바닥이 안 튐)
        if (noiseFloor < 0.0003) noiseFloor = 0.0003;
        if (rms >= micAbsMin && rms >= noiseFloor * micRatio) gateOpenUntil = Date.now() + 300;
        if (Date.now() >= gateOpenUntil) gated = true;
      }
      if (wOpen) {
        const ds = downsampleTo24k(input, inRate);
        w.send(gated ? new ArrayBuffer(ds.length * 2) : floatTo16BitPCM(ds));
      }

      // 소리(시스템 오디오 포함)가 들리면 유휴 자동종료 방지 신호 — 모든 연결에 전송(전역)
      if (peak > TH) notifyActivityAll();

      vad.since++;
      if (peak > TH) {
        vad.speaking = true;
        vad.silence = 0;
      } else vad.silence++;
      if (vad.speaking && (vad.silence >= SIL || vad.since >= MAXF)) {
        if (wOpen) w.send(JSON.stringify({ type: 'commit' }));
        vad.speaking = false;
        vad.silence = 0;
        vad.since = 0;
      }
    };
    pipe.proc = proc;

    stream.getTracks().forEach((t) => (t.onended = () => stop()));
    pipes.push(pipe);
  }

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
    if (aecParts) { try { aecParts.audioEl.pause(); } catch {} try { aecParts.pc1.close(); } catch {} try { aecParts.pc2.close(); } catch {} aecParts = null; }
    if (audioCtx) audioCtx.close();
    // 마지막 발화 결과가 도착하도록 잠시 후 닫기
    setTimeout(() => closing.forEach((p) => {
      try {
        p.ws.close();
      } catch {}
    }), 1800);
  }

  // 녹음 중에도 번역 음성 토글 가능: 로컬 재생 + 서버 전달 on/off
  function setAudioOut(on) {
    audioOutOn = !!on;
    ctlState.audioOut = !!on;
    for (const p of pipes) {
      try {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'audioOut', on: !!on }));
      } catch {}
    }
  }

  function setVolume(v) {
    try { outGain.gain.value = Math.max(0, v); } catch {}
  }

  // 발화 on/off (세션 유지). on=true 면 일시정지(무음), false 면 발화중.
  // 서버에도 알림 → 발화 배타 락(호스트가 멈추면 뷰어가 발화 가능)
  function setMuted(on) {
    muted = !!on;
    ctlState.muted = !!on;
    for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'micState', muted: !!on })); } catch {} }
  }

  // 녹음 중 TTS(음성 재생) 토글 — 로컬 재생 + 서버 합성/호스트 전송 on/off
  function setTts(on, genderSel) {
    audioOutOn = !!on;
    ctlState.tts = { on: !!on, gender: genderSel || (ctlState.tts && ctlState.tts.gender) || null };
    for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'tts', on: !!on, ...(genderSel ? { gender: genderSel } : {}) })); } catch {} }
  }

  // 데스크: 호스트 수동 '대기모드로' — 현재 대화 종료(뷰어를 터치화면으로)
  function deskReset() { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-reset-now' })); } catch {} } }
  // 데스크: 호스트 수동 통역 시작(손님 언어 지정) — soniox 세션이 이때 열림
  function deskStart(lang) { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-start', lang })); } catch {} } }
  // 데스크: 길안내 제안 승인(뷰어에 지도 표시) / 무시
  function wayfindShow() { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'wayfind-show' })); } catch {} } }
  function wayfindDismiss() { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'wayfind-dismiss' })); } catch {} } }
  // 녹음 중 마이크 민감도 실시간 변경(0~100) — 클라이언트 볼륨 게이트만 조정, 연결 유지
  function setMicSens(v) {
    micSensVal = Number(v);
    calcGate(micSensVal);
    // 게이트 사용 중엔 AGC(자동 게인) off 시도 — 켜져 있으면 원거리음까지 증폭해 근접 판별을 흐린다. 100이면 원복.
    if (micTrack && micTrack.applyConstraints) micTrack.applyConstraints({ autoGainControl: !(micSensVal < 100) }).catch(() => {});
  }
  // 데스크: 여객 태블릿 마이크 민감도(0~100) — 서버 경유로 뷰어의 근접 게이트에 실시간 반영
  function setGuestSens(v) { ctlState.guestSens = Number(v); for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-guest-sens', value: Number(v) })); } catch {} } }
  // 데스크: 무음 자동 종료 시간(ms) 실시간 변경 — 상시 캡처 중에도 설정 가능
  function setDeskIdle(ms) { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-idle', value: Number(ms) })); } catch {} } }

  return { stop, setAudioOut, setVolume, setMuted, setTts, deskReset, deskStart, wayfindShow, wayfindDismiss, setMicSens, setGuestSens, setDeskIdle };
}
