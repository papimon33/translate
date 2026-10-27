/* 오디오 캡처 + 무음감지(VAD) + 서버 WS 송신.
   mic=오른쪽, system=왼쪽. system 은 전체화면+시스템오디오 공유로 PC 전체 소리. */

/* ---- RNNoise(신경망 잡음 억제, 옵션) ----
   브라우저 기본 NS 대신 사용한다(이중 적용 금지 — 켜면 getUserMedia noiseSuppression:false).
   48kHz·480샘플 프레임 전용이라 AudioContext 를 48kHz 로 강제해 리샘플 없이 처리한다.
   wasm(≈1.9MB 별도 청크)은 옵션을 켠 세션에서만 동적 로드. 마이크 계열 소스에만 적용(시스템 오디오 제외). */
let rnnModP = null;
function loadRnnoise() {
  if (!rnnModP) {
    rnnModP = import('@jitsi/rnnoise-wasm/dist/rnnoise-sync.js').then(async (m) => {
      const mod = m.default();
      try { await mod.ready; } catch {}
      return mod;
    });
    rnnModP.catch(() => { rnnModP = null; }); // 로드 실패 시 다음 시작에서 재시도
  }
  return rnnModP;
}
const RNN_FRAME = 480; // RNNoise 고정 프레임(48kHz 기준 10ms)
function createDenoiser(mod) {
  const st = mod._rnnoise_create(0);
  const inPtr = mod._malloc(RNN_FRAME * 4);
  const outPtr = mod._malloc(RNN_FRAME * 4);
  let carry = new Float32Array(0);
  let dead = false;
  return {
    // 입력 Float32(±1) → 정제된 Float32(±1). 480샘플 정렬 잔여분은 다음 호출로 이월(≤10ms 지연)
    process(input) {
      if (dead) return input;
      const buf = new Float32Array(carry.length + input.length);
      buf.set(carry);
      buf.set(input, carry.length);
      const nFrames = Math.floor(buf.length / RNN_FRAME);
      const out = new Float32Array(nFrames * RNN_FRAME);
      for (let f = 0; f < nFrames; f++) {
        // RNNoise 는 ±32768 스케일 float 를 기대. HEAPF32 는 메모리 증가 시 바뀌므로 매 프레임 새로 잡는다
        const ih = mod.HEAPF32.subarray(inPtr >> 2, (inPtr >> 2) + RNN_FRAME);
        for (let i = 0; i < RNN_FRAME; i++) ih[i] = buf[f * RNN_FRAME + i] * 32768;
        mod._rnnoise_process_frame(st, outPtr, inPtr);
        const oh = mod.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + RNN_FRAME);
        for (let i = 0; i < RNN_FRAME; i++) out[f * RNN_FRAME + i] = oh[i] / 32768;
      }
      carry = buf.slice(nFrames * RNN_FRAME);
      return out;
    },
    destroy() {
      if (dead) return;
      dead = true;
      try { mod._rnnoise_destroy(st); } catch {}
      try { mod._free(inPtr); mod._free(outPtr); } catch {}
    },
  };
}

async function getSources(mode, agcOff, mic2, nsOff, micId, stereoWanted) {
  const list = [];
  if (mode === 'mic' || mode === 'both') {
    if (window.AndroidAudio) {
      // 안드로이드 앱: 네이티브 AudioRecord(AGC 를 OS 레벨에서 차단)가 마이크를 대신한다.
      // WebView 의 getUserMedia 는 AGC off 요청을 기기에 따라 무시하므로 쓰지 않는다.
      list.push({ src: 'mic', stream: null, native: true });
    } else if (mic2 && mic2.guest) {
      // 데스크 2마이크(PC): 직원·여객 지향성 마이크를 각각의 입력 장치로 연다 —
      // 여객 오디오는 별도 WS(src=guestmic)로 서버 여객 채널에 공급(뷰어 태블릿 마이크와 동일 경로).
      // nsOff(RNNoise 사용 시): 브라우저 NS 를 꺼서 이중 잡음처리로 음성이 뭉개지는 것 방지
      const base = { echoCancellation: true, noiseSuppression: !nsOff };
      let staff;
      try {
        staff = await navigator.mediaDevices.getUserMedia({
          audio: { ...base, autoGainControl: !agcOff, ...(mic2.staff ? { deviceId: { exact: mic2.staff } } : {}) },
        });
      } catch {
        // 지정한 직원 마이크가 뽑힌 경우 기본 장치로 폴백(캡처 전체가 죽는 것 방지)
        staff = await navigator.mediaDevices.getUserMedia({ audio: { ...base, autoGainControl: !agcOff } });
        list.micFallback = true; // 사용자에게 알림(모르고 내장 마이크로 녹음되는 것 방지)
      }
      list.push({ src: 'mic', stream: staff });
      try {
        // 여객 마이크: 근접 게이트가 음량으로 판별하므로 AGC 는 항상 끈다(데스크톱 크롬은 준수)
        const guest = await navigator.mediaDevices.getUserMedia({
          audio: { ...base, autoGainControl: false, deviceId: { exact: mic2.guest } },
        });
        list.push({ src: 'guestmic', stream: guest });
      } catch {
        list.guestFail = true; // 여객 장치를 못 열면 단일 채널로 폴백(뷰어 태블릿 마이크 경로는 유지)
      }
    } else {
      // autoGainControl(AGC): 볼륨 게이트(민감도<100) 사용 시엔 반드시 꺼야 한다 —
      // 브라우저 AGC 가 속삭임·먼 소리를 보통 음량으로 증폭한 '뒤에' 게이트에 도달해
      // RMS 임계를 아무리 낮춰도(1이어도) 걸러지지 않던 원인. 100(게이트 없음)이면 기존대로 켠다.
      const base = { echoCancellation: true, noiseSuppression: !nsOff, autoGainControl: !agcOff };
      let mic;
      try {
        // micId: 사용자가 고른 마이크 장치(실시간 번역 옵션) — 뽑혀 있으면 기본 장치로 폴백
        mic = await navigator.mediaDevices.getUserMedia({ audio: { ...base, ...(micId ? { deviceId: { exact: micId } } : {}) } });
      } catch (e) {
        if (!micId) throw e;
        mic = await navigator.mediaDevices.getUserMedia({ audio: base });
        list.micFallback = true; // 선택 장치가 뽑힘 — 기본 마이크 폴백 사실을 사용자에게 알림
      }
      // 양방향 통역 + 2채널 가능 기기(스테레오 무선 수신기 등): 원음 2채널로 다시 연다.
      // 크롬은 에코 제거·잡음 억제를 켜면 스테레오를 모노로 합치므로 끈다(대신 채널별 게이트·서버 필터가 역할).
      // 모노 모드 수신기도 2채널(같은 소리 복사)로 보고하므로 진짜 분리 여부는 소리로 판별한다(setupStereo).
      if (stereoWanted) {
        const tr = mic.getAudioTracks()[0];
        let maxCh = 1;
        try { const c = tr && tr.getCapabilities ? tr.getCapabilities() : null; maxCh = (c && c.channelCount && c.channelCount.max) || 1; } catch {}
        const key = 'kac-stereo:' + ((tr && tr.label) || '');
        let cached = null;
        try { cached = localStorage.getItem(key); } catch {}
        if (maxCh >= 2 && cached !== 'mono') {
          const devId = tr && tr.getSettings ? tr.getSettings().deviceId : undefined;
          try {
            const st = await navigator.mediaDevices.getUserMedia({ audio: { ...(devId ? { deviceId: { exact: devId } } : {}), channelCount: { exact: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
            mic.getTracks().forEach((t) => t.stop());
            mic = st;
            list.stereo = { key, cached };
          } catch {} // 2채널로 못 열면 기존 1채널 그대로
        }
      }
      list.push({ src: 'mic', stream: mic });
    }
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
      list.forEach(({ stream }) => stream && stream.getTracks().forEach((t) => t.stop()));
      throw e;
    }
    if (sys.getAudioTracks().length === 0) {
      sys.getTracks().forEach((t) => t.stop());
      list.forEach(({ stream }) => stream && stream.getTracks().forEach((t) => t.stop()));
      throw new Error('시스템 오디오가 선택되지 않았습니다. "전체 화면" 선택 후 "시스템 오디오 공유"를 켜세요.');
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

/* opts: { sessionId, mode, inLang, outLang, pipeline, onMessage, onMeter } */
// 마이크 민감도(0~100) → 절대 하한(RMS). 100 = 게이트 없음(0).
//  · 브라우저: 0.004~0.034 선형(기존 그대로 — PC·데스크에서 맞춰 둔 값이 바뀌지 않게).
//  · 안드로이드 앱(native): 0.004~0.2 지수 곡선. AGC 없는 원음이라 무선 핀마이크 등은 신호가 커서
//    브라우저 상한(0.034)으로는 50cm 떨어진 말도 통과했다(2026-10-20 현장 보고). 낮은 값일수록 확실히 엄격해지도록 넓힌다.
//    (민감도 70≈0.013, 50≈0.028, 30≈0.062, 10≈0.13, 1≈0.19)
export function micGateAbs(sens, native) {
  if (!(typeof sens === 'number' && sens < 100)) return 0;
  const k = (100 - sens) / 100;
  return native ? 0.004 * Math.pow(50, k) : 0.004 + k * 0.03;
}

const AUTO_GATE_RATIO = 2.5; // 자동 감도: 소음 바닥의 2.5배(약 +8dB) 이상만 말소리로

export async function startRecorder(opts) {
  const { sessionId, mode, inLang, outLang, pipeline, onMessage, onMeter, audioOut, volume, micSens, sxSens, sxMaxDelay, sxLatency, sxMode, sxTarget, sxA, sxB, tts, gender, diar, deskLangs, deskIdle, deskGuestSens } = opts;
  // 마이크 음성인식 민감도(0~100): 100=가장 민감(게이트 없음), 낮출수록 조용한 소리를 무시.
  //  · 게이트 기준은 RMS(프레임 평균 음량) — peak(순간 최대) 는 속삭임의 자음(ㅅ·ㅌ) 스파이크에도
  //    열려 버려 소용없었다. RMS 는 '지속적으로 일정 음량 이상'일 때만 열려 속삭임·주변소음을 잘 거른다.
  //  · 임계 범위 0~0.05(RMS): 보통 대화(≈0.03~0.1)는 통과, 속삭임(≈0.005~0.02)·실내소음은 차단.
  //  · 녹음 중에도 setMicSens 로 실시간 변경 가능(데스크는 상시 캡처라 이 경로가 유일한 조절 수단).
  //  · 적응형 게이트: 절대 RMS 임계는 기기·AGC(iOS 는 off 요청 무시)마다 값이 제각각이라 무의미했다.
  //    대신 '주변 소음 바닥(noiseFloor) 대비 몇 배 큰가'로 판정 → 기기 게인과 무관하게 근접/원거리 구분.
  //    슬라이더(민감도)는 '바닥 대비 배수(ratio)'와 '절대 하한(absMin)'을 조절. 100=게이트 없음.
  let micSensVal = typeof micSens === 'number' ? micSens : 100;
  // 자동 감도(폰 설정 '자동으로 감도 조절'): 슬라이더 대신 '주변 소음 바닥보다 확실히(약 8dB) 큰 소리'만 인식.
  // 바닥(noiseFloor)은 조용할 때 빠르게 따라가므로 장소가 바뀌어도 기준이 저절로 맞춰진다. 절대 하한은 최소값.
  let micAutoVal = !!opts.micAuto;
  let micRatio = 0, micAbsMin = 0, micAbsMinNative = 0;
  // 감도 → [바닥 대비 배수, 절대 하한(브라우저), 절대 하한(앱 원음)]
  const gateOf = (v) => {
    if (micAutoVal) return [AUTO_GATE_RATIO, 0.004, 0.004];
    if (!(typeof v === 'number' && v < 100)) return [0, 0, 0];
    const k = (100 - v) / 100;         // 0(민감)~1(엄격)
    return [
      1 + k * 7,                       // 바닥의 1~8배 이상이어야 열림
      micGateAbs(v, false),            // 절대 하한 0.004~0.034(완전 무음·미세잡음 차단)
      micGateAbs(v, true),             // 안드로이드 앱(원음): 0.004~0.2
    ];
  };
  const calcGate = (v) => { [micRatio, micAbsMin, micAbsMinNative] = gateOf(v); };
  calcGate(micSensVal);
  // 송신기 2(오른쪽) 감도 — 2채널 스테레오로 나눠 들을 때만 쓴다(그 외엔 위 감도 하나). 따로 정한 적 없으면 위와 같은 값.
  let micSens2Val = typeof opts.micSens2 === 'number' ? opts.micSens2 : micSensVal;
  let micRatio2 = 0, micAbsMin2 = 0, micAbsMinNative2 = 0;
  const calcGate2 = (v) => { [micRatio2, micAbsMin2, micAbsMinNative2] = gateOf(v); };
  calcGate2(micSens2Val);
  // 데스크 2마이크(PC): 직원/여객 장치 지정 — 데스크 파이프라인 + 브라우저 환경에서만
  const mic2 = pipeline === 'desk' && !window.AndroidAudio && opts.mic2 && opts.mic2.guest ? opts.mic2 : null;
  // 스테레오 2채널(양방향 통역 + 마이크): 송신기 1번(왼쪽)=나, 2번(오른쪽)=상대로 채널을 나눠 언어 오판을 없앤다.
  // 기기가 진짜로 분리해 보내는지는 소리로 판별하고 결과를 기기별로 기억한다(setupStereo).
  const stereoWanted = !!opts.stereo && pipeline === 'soniox' && sxMode === 'two' && !!sxA && !!sxB && sxA !== sxB && mode === 'mic';
  // RNNoise(옵션): 마이크 캡처에만 적용(네이티브 앱 제외). 로드 실패 시 브라우저 NS 유지로 폴백
  let rnnMod = null;
  if (opts.rnnoise && !window.AndroidAudio && (mode === 'mic' || mode === 'both')) {
    try { rnnMod = await loadRnnoise(); }
    catch { try { onMessage({ type: 'status', message: 'RNNoise 로드 실패 — 브라우저 기본 잡음 억제로 동작합니다.' }); } catch {} }
  }
  // RNNoise 는 48kHz·480샘플 고정 — AudioContext 를 48kHz 로 강제(미지원이면 RNNoise 포기, NS 복귀)
  const AC = window.AudioContext || window.webkitAudioContext;
  let audioCtx;
  try { audioCtx = rnnMod ? new AC({ sampleRate: 48000 }) : new AC(); } catch { audioCtx = new AC(); }
  // 제스처 콘텍스트 소실(RNNoise wasm 로드 지연·iOS 등)로 suspended 로 생성되면 onaudioprocess 가
  // 아예 안 돌아 '진행 중' 표시인 채 무음이 된다 — viewer/desk.html·join.html 과 동일한 resume 방어.
  try { audioCtx.resume && audioCtx.resume().catch(() => {}); } catch {}
  // 모바일 탭 전환·절전 복귀 시 AudioContext 가 suspended 로 남는 경우 자동 재개
  const onVisResume = () => { if (document.visibilityState === 'visible') { try { audioCtx.resume && audioCtx.resume().catch(() => {}); } catch {} } };
  document.addEventListener('visibilitychange', onVisResume);
  if (rnnMod && audioCtx.sampleRate !== 48000) {
    rnnMod = null;
    try { onMessage({ type: 'status', message: '이 브라우저는 48kHz 캡처를 지원하지 않아 RNNoise 없이 동작합니다.' }); } catch {}
  }
  let sources;
  try {
    sources = await getSources(mode, micRatio > 0, mic2, !!rnnMod, opts.micId, stereoWanted && !window.AndroidAudio); // 권한 거부 시 throw. 게이트 사용 시 AGC off 시도
  } catch (e) {
    try { audioCtx.close(); } catch {} // 먼저 만든 오디오 컨텍스트 회수(권한 거부 시 누수 방지)
    throw e;
  }
  const nativeMic = sources.some((s) => s.native); // 안드로이드 앱 네이티브 마이크 사용 여부
  // 스테레오 계획: 브라우저는 getSources 가 2채널로 연 경우, 앱은 네이티브가 스테레오 캡처를 지원하는 경우(1.3.0~)
  let stereoPlan = null;
  if (stereoWanted) {
    if (nativeMic && window.AndroidAudio && window.AndroidAudio.startStereo) {
      let label = '';
      try { label = window.AndroidAudio.inputLabel ? String(window.AndroidAudio.inputLabel() || '') : ''; } catch {}
      const key = 'kac-stereo:native:' + label;
      let cached = null;
      try { cached = localStorage.getItem(key); } catch {}
      // stereoKnown: 시작 전 마이크 확인(또는 대기 중 판별)에서 송신기 2가 따로 들어오는 걸 확인함 → 판별 없이 바로 2채널
      if (opts.stereoKnown) { cached = 'stereo'; try { localStorage.setItem(key, 'stereo'); } catch {} }
      // stereoForget: 시작 전 확인에서 좌우가 같은 소리(모노 모드)로 보임 → 예전 '스테레오' 기억을 버리고 판별부터
      else if (opts.stereoForget) { cached = null; try { localStorage.removeItem(key); } catch {} }
      if (cached !== 'mono') stereoPlan = { native: true, key, cached };
    } else if (sources.stereo) {
      stereoPlan = { native: false, key: sources.stereo.key, cached: opts.stereoKnown ? 'stereo' : opts.stereoForget ? null : sources.stereo.cached };
    }
  }
  if (sources.guestFail) {
    try { onMessage({ type: 'status', message: '여객 마이크 장치를 열지 못했습니다 — 단일 채널(또는 태블릿 마이크)로 동작합니다.' }); } catch {}
  }
  if (sources.micFallback) {
    try { onMessage({ type: 'status', message: '선택한 마이크 장치를 찾지 못해 기본 마이크로 시작합니다.' }); } catch {}
  }
  // 마이크 트랙(민감도 변경 시 AGC 실시간 토글용) — 네이티브 마이크는 트랙이 없다(항상 AGC off)
  const micTrack = (() => { const m = sources.find((s) => s.src === 'mic'); return m && m.stream ? m.stream.getAudioTracks()[0] : null; })();
  let noiseFloor = 0.005; // 적응형 소음 바닥(조용할 때로 빠르게 수렴, 소리날 때 아주 느리게 상승)
  // 여객 마이크(2마이크 모드) 근접 게이트 — 뷰어 태블릿(viewer/desk.html gmCalc)과 동일 공식, 여객 민감도(0~100)로 조절
  let gRatio = 4, gAbsMin = 0.017, gFloor = 0.005;
  const calcGuestGate = (v) => {
    const n = Number(v);
    const s = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
    if (s >= 100) { gRatio = 0; gAbsMin = 0; return; }
    const k = (100 - s) / 100;
    gRatio = 1 + k * 7;
    gAbsMin = 0.004 + k * 0.03;
  };
  calcGuestGate(deskGuestSens != null ? deskGuestSens : 50);

  const inRate = audioCtx.sampleRate;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  // over: 채널별 덮어쓰기 { in, sxMode, sxTarget, role, drop, pair } — 양방향 통역을 채널별 단방향으로 나눌 때
  const makeQ = (over = {}) => `session=${sessionId}&out=${encodeURIComponent(outLang)}&in=${encodeURIComponent(
    over.in != null ? over.in : inLang
  )}&pipeline=${pipeline}&audioOut=${audioOut ? '1' : '0'}${
    pipeline === 'soniox'
      ? `&sxSens=${encodeURIComponent(sxSens)}&sxMaxDelay=${encodeURIComponent(sxMaxDelay)}&sxLatency=${encodeURIComponent(sxLatency)}&sxMode=${encodeURIComponent(over.sxMode || sxMode || 'one')}&sxTarget=${encodeURIComponent(over.sxTarget || sxTarget || 'en')}&sxA=${encodeURIComponent(sxA || 'ko')}&sxB=${encodeURIComponent(sxB || 'en')}${
          tts ? `&tts=1&gender=${encodeURIComponent(gender || 'f')}` : ''
        }${diar ? '&diar=1' : ''}${over.role ? `&role=${over.role}` : ''}${over.drop ? `&drop=${encodeURIComponent(over.drop)}` : ''}${over.pair ? `&pair=${encodeURIComponent(over.pair)}` : ''}`
      : ''
  }${opts.dropAcks ? '&dropAcks=1' : ''}${opts.confFix ? '&confFix=1' : ''}${
    pipeline === 'desk'
      ? `&sxSens=${encodeURIComponent(sxSens)}&sxMaxDelay=${encodeURIComponent(sxMaxDelay)}&sxLatency=${encodeURIComponent(sxLatency)}${
          deskLangs ? `&deskLangs=${encodeURIComponent(deskLangs)}` : ''
        }${deskIdle ? `&deskIdle=${encodeURIComponent(deskIdle)}` : ''}${deskGuestSens != null ? `&deskGuestSens=${encodeURIComponent(deskGuestSens)}` : ''}`
      : ''
  }`;
  // 양방향 통역의 채널 분리: 채널마다 언어가 정해져 있으면 엔진이 언어를 추측할 필요가 없다(오판 제거).
  //  · me(내 채널): 내 언어(A) → 상대 언어(B), 상대 언어가 들리면 샌 소리로 버림
  //  · them(상대 채널): 무엇이든 → 내 언어(A). 시스템 소리(원격 회의)는 제3 언어도 섞이므로 버리지 않고,
  //    스테레오 상대 마이크는 내 언어(옆 사람 핀마이크로 샌 내 말)를 버린다.
  const canSplit = pipeline === 'soniox' && sxMode === 'two' && sxA && sxB && sxA !== sxB;
  const pairQ = `${sxA},${sxB}`;
  const meOver = { sxMode: 'one', sxTarget: sxB, in: sxA, role: 'me', drop: sxB, pair: pairQ };
  const themOver = (stereoThem) => ({ sxMode: 'one', sxTarget: sxA, in: sxB, role: 'them', pair: pairQ, ...(stereoThem ? { drop: sxA } : {}) });
  const q = makeQ();

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
  const cleanupAec = () => { // PeerConnection·오디오 엘리먼트 회수(시작 실패·중지 경로 공용)
    if (!aecParts) return;
    try { aecParts.audioEl.pause(); } catch {}
    try { aecParts.pc1.close(); } catch {}
    try { aecParts.pc2.close(); } catch {}
    aecParts = null;
  };
  async function setupAecLoopback() {
    let pc1, pc2, audioEl;
    try {
      const dest = audioCtx.createMediaStreamDestination();
      pc1 = new RTCPeerConnection();
      pc2 = new RTCPeerConnection();
      pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {}); };
      pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {}); };
      audioEl = new Audio();
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
      if (stopped) cleanupAec(); // 셋업 완료 전에 stop()/시작 실패가 지나간 경우 — 즉시 회수(누수 방지)
    } catch {
      // 실패 시 기존 직접 재생 유지(+ 재생 중 자동 음소거 폴백) — 만들다 만 자원은 회수
      try { pc1 && pc1.close(); } catch {}
      try { pc2 && pc2.close(); } catch {}
      try { audioEl && audioEl.pause(); } catch {}
      try { outGain.disconnect(); } catch {}
      try { outGain.connect(audioCtx.destination); } catch {}
      aecActive = false;
    }
  }
  // TTS 를 나중에 켤 수도 있으므로(녹음 중 토글) 음성 재생 가능 파이프라인이면 미리 준비.
  // 네이티브 마이크는 브라우저 AEC 참조 경로 밖이라 루프백이 무의미 — 기기 자체 AEC + 재생 중 자동 음소거 폴백을 쓴다.
  if (!nativeMic && (audioOut || opts.tts || pipeline === 'soniox' || pipeline === 'translate')) setupAecLoopback();
  // AEC 미동작 폴백(루프백 실패·협상 전)에서 TTS 재생 중 사용자가 크게 말하면(barge-in)
  // 재생을 눌러 끊고 마이크 음소거를 해제한다 — 이전엔 긴 TTS 가 끝날 때까지 발화 전체가
  // 무음으로 나가 통째로 유실됐다. 볼륨은 다음 TTS 재생에서 복원.
  let bargeStreak = 0;
  let bargedVol = null;
  const ttsBargeIn = () => {
    try { bargedVol = outGain.gain.value; outGain.gain.setValueAtTime(0, audioCtx.currentTime); } catch {}
    outCursor = 0;
    ttsMutedUntil = 0;
  };
  const playPcm24 = (b64) => {
    try {
      if (bargedVol != null) { try { outGain.gain.setValueAtTime(bargedVol, audioCtx.currentTime); } catch {} bargedVol = null; }
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
  let nativeMicUsed = false; // 네이티브 캡처가 실제로 시작됐는지(stop 에서 브리지 정지용)
  // 녹음 중 변경된 제어 상태 — 자동 재연결 시 새 소켓은 시작 시점 URL 파라미터로 초기화되므로
  // 변경분(TTS on/off, 발화멈춤, 여객 민감도)을 재전송해 서버 상태가 되돌아가는 문제를 막는다
  const ctlState = { audioOut: null, tts: null, guestSens: null, deskIdle: null, dropAcks: null, confFix: null };
  const resendState = (sock) => {
    try {
      if (ctlState.tts != null) sock.send(JSON.stringify({ type: 'tts', on: ctlState.tts.on, local: ctlState.tts.local !== false, ...(ctlState.tts.gender ? { gender: ctlState.tts.gender } : {}) }));
      if (ctlState.audioOut != null) sock.send(JSON.stringify({ type: 'audioOut', on: ctlState.audioOut }));
      if (ctlState.guestSens != null) sock.send(JSON.stringify({ type: 'desk-guest-sens', value: ctlState.guestSens }));
      if (ctlState.deskIdle != null) sock.send(JSON.stringify({ type: 'desk-idle', value: ctlState.deskIdle }));
      if (ctlState.dropAcks != null) sock.send(JSON.stringify({ type: 'dropAcks', on: ctlState.dropAcks }));
      if (ctlState.confFix != null) sock.send(JSON.stringify({ type: 'confFix', on: ctlState.confFix }));
    } catch {}
  };

  // 소켓 배선 — 초기 연결·자동 재연결·채널 재설정(스테레오 전환)이 공용. pipe.wsUrl 로 다시 연다.
  function wirePipe(pipe, sock) {
    sock.binaryType = 'arraybuffer';
    // 열리면 변경된 제어 상태 복원 + 끊김·연결 대기 동안 보관한 오디오를 먼저 흘려보내 발화 연속성 복구
    // (초기 소켓은 이미 OPEN 이라 안 걸리고, 재연결·나중에 연 채널에서 동작)
    sock.onopen = () => {
      resendState(sock);
      if (pipe.gapBuf && pipe.gapBuf.length) {
        for (const f of pipe.gapBuf) { try { sock.send(f); } catch {} }
        pipe.gapBuf = [];
      }
    };
    sock.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; } // 비정상 프레임 1건이 핸들러를 죽이지 않게
      // 중지 후 결과 수신 창(1.8초) 동안엔 자막 병합만 허용 — 구 소켓이 받은 takeover 등
      // 제어 메시지가 새로 시작한 녹음을 죽이는 레이스 차단
      if (stopped && m.type !== 'sentence' && m.type !== 'partial') return;
      // 이 파이프가 이미 새 소켓으로 바뀐 경우(스테레오 전환 재설정) 구 소켓은 자막만 — 새 소켓이 일으킨
      // takeover 를 구 소켓이 받아 녹음 전체를 멈추던 일을 막는다
      if (pipe.ws !== sock && m.type !== 'sentence' && m.type !== 'partial') return;
      if (m.type === 'audio') {
        // m.lang: 음성 언어 — 지금은 이 기기에서 모두 재생(대면 1대 사용). 같은 음성이 채널마다 오므로 첫 파이프만 재생
        if (audioOutOn && pipe.isAudioPipe) playPcm24(m.b64);
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
        const re = new WebSocket(pipe.wsUrl);
        pipe.ws = re;
        wirePipe(pipe, re);
        // 초기 연결과 동일한 타임아웃 — half-open 이면 닫아서 onclose 재시도 루프로 복귀
        setTimeout(() => { if (!stopped && pipe.ws === re && re.readyState !== WebSocket.OPEN) { try { re.close(); } catch {} } }, 12000);
      }, 2000);
    };
  }
  // 파이프를 다른 설정(URL)으로 다시 연다 — 구 소켓은 마지막 결과를 받도록 stop 후 잠시 뒤 닫는다
  function reopenPipe(pipe, url) {
    const old = pipe.ws;
    pipe.wsUrl = url;
    const re = new WebSocket(url);
    pipe.ws = re;
    wirePipe(pipe, re);
    try { if (old && old.readyState === WebSocket.OPEN) old.send(JSON.stringify({ type: 'stop' })); } catch {}
    setTimeout(() => { try { old && old.close(); } catch {} }, 1800);
  }

  /* ---- 스테레오 2채널(양방향 통역): 왼쪽(송신기 1)=나, 오른쪽(2)=상대 ----
     ① 기본은 지금과 같은 1채널(왼쪽 소리 → 양방향 엔진, 언어 추측). 판별은 뒤에서 조용히:
        · 좌우가 사실상 같다(상관 0.985 초과) → 모노 모드 수신기(복사본)·백업 트랙 → 기억('mono')
        · 오른쪽에서 왼쪽보다 확연히 큰 말소리가 나온다 → 송신기 2가 따로 들어온다 → 2채널로 전환·기억('stereo')
        한쪽만 쓰는 장치·조용한 백업 복사본은 '오른쪽이 더 큰 말소리'를 만들지 못하므로 2채널로 오판되지 않는다.
     ② 2채널: 내 채널을 단방향(내 언어→상대 언어, 상대 언어 버림)으로 다시 열고, 상대 채널을 오른쪽 프리롤(약 0.7초)과
        함께 연다. 오른쪽 소리는 그 전까지 엔진에 보내지 않으므로 조각 중복도 없다.
        이미 스테레오로 알고 시작하면(지난번 기억 또는 시작 전 마이크 확인 = opts.stereoKnown) 상대 채널도 처음부터 연다 —
        송신기 2의 첫 문장이 연결 대기로 늦지 않게(대신 처음부터 연결 2개·요금 2배).
     ③ 게이트(민감도) 슬라이더 하나를 두 채널에 똑같이, 소음 바닥만 채널별. 원음이라 앱 곡선(micAbsMinNative). */
  function setupStereo(p0, stream) {
    const plan = stereoPlan;
    let st = plan.cached === 'stereo' ? 'stereo' : 'detect'; // 'detect'(1채널로 동작하며 판별) | 'mono' | 'stereo'
    let themPipe = null;
    let monoProcessed = false; // 모노 판정 후 브라우저 에코 제거를 다시 켰는지(그러면 브라우저 곡선·AEC 규칙)
    const report = () => { try { opts.onStereo && opts.onStereo({ state: st, them: !!themPipe, raw: !monoProcessed }); } catch {} };
    const save = (v) => { try { localStorage.setItem(plan.key, v); } catch {} };
    const mkGate = () => ({ floor: 0.005, openUntil: 0, prev: null, ring: [] });
    const gMe = mkGate(), gThem = mkGate();
    const rmsOf = (f) => { let sum = 0, peak = 0; for (let i = 0; i < f.length; i++) { const v = f[i]; sum += v * v; const a = v < 0 ? -v : v; if (a > peak) peak = a; } return [Math.sqrt(sum / (f.length || 1)), peak]; };
    const dB = (x) => 20 * Math.log10(x + 1e-9);
    const stat = () => ({ n: 0, sLL: 0, sRR: 0, sLR: 0, rDom: 0 });
    let det = stat(), ver = stat();
    const acc = (o, L, R, rl, rr) => {
      if (Math.max(rl, rr) < 0.012) return;
      o.n++;
      for (let i = 0; i < L.length; i += 2) { o.sLL += L[i] * L[i]; o.sRR += R[i] * R[i]; o.sLR += L[i] * R[i]; }
      if (rr >= 0.012 && dB(rr) - dB(rl) > 8) o.rDom++; // 오른쪽이 확연히 큰 말소리 = 송신기 2가 따로 들어옴
    };
    const corrOf = (o) => o.sLR / (Math.sqrt(o.sLL * o.sRR) || 1);
    const sendTo = (pipe, buf) => {
      const w = pipe.ws;
      if (w && w.readyState === WebSocket.OPEN) { if (w.bufferedAmount < 262144) { try { w.send(buf); } catch {} } }
      else { (pipe.gapBuf || (pipe.gapBuf = [])).push(buf); if (pipe.gapBuf.length > 70) pipe.gapBuf.shift(); }
    };
    // 새로 연 소켓이 12초 안에 안 열리면 닫아 재연결 루프로(초기 연결·재연결과 같은 보호)
    const guard = (pipe) => { const sock = pipe.ws; setTimeout(() => { if (!stopped && pipe.ws === sock && sock.readyState !== WebSocket.OPEN) { try { sock.close(); } catch {} } }, 12000); };
    // 채널 한 프레임: 계측 → 음소거/TTS 보호 → 게이트 → 전송. pipe 가 없으면(상대 채널 열기 전) 말소리 여부만 돌려준다.
    const feed = (g, f, pipe, isMe, ttsGuard) => {
      const [rms, peak] = rmsOf(f);
      if (onMeter) onMeter(rms, peak, isMe ? 'mic' : 'mic2');
      const pcm = floatTo16BitPCM(f);
      const silence = () => new ArrayBuffer(f.length * 2);
      if ((isMe && muted) || ttsGuard) { if (pipe) sendTo(pipe, silence()); return false; }
      // 채널별 감도: 송신기 1(나)=micSens, 송신기 2(상대)=micSens2
      const ratio = isMe ? micRatio : micRatio2;
      const absMin = monoProcessed ? (isMe ? micAbsMin : micAbsMin2) : (isMe ? micAbsMinNative : micAbsMinNative2);
      const openNow = Date.now() < g.openUntil;
      let voiced;
      if (ratio > 0) {
        if (rms < g.floor) g.floor += (rms - g.floor) * 0.3; else if (!openNow) g.floor += (rms - g.floor) * 0.002;
        if (g.floor < 0.0003) g.floor = 0.0003;
        voiced = rms >= absMin && rms >= g.floor * ratio;
      } else voiced = rms > 0.012; // 게이트 없음: 상대 채널 열기 판단용 말소리 감지만
      if (voiced) { if (!openNow && g.prev && pipe) sendTo(pipe, g.prev); g.openUntil = Date.now() + 300; }
      const open = Date.now() < g.openUntil;
      g.ring.push(pcm); if (g.ring.length > 8) g.ring.shift(); // 열기 직전 프리롤(약 0.7초)
      if (!pipe) return open;
      const pass = ratio <= 0 || open;
      sendTo(pipe, pass ? pcm : silence());
      g.prev = pass ? null : pcm;
      if (peak > 0.015) notifyActivityAll();
      return open;
    };
    const meUrl = () => `${proto}://${location.host}/ws/host?src=mic&${makeQ(meOver)}`;
    const oneUrl = () => `${proto}://${location.host}/ws/host?src=mic&${q}`; // 1채널(양방향, 언어 추측)
    const openThem = () => {
      themPipe = { src: 'mic2', ws: null, proc: null, isAudioPipe: false, gapBuf: gThem.ring.slice(),
        wsUrl: `${proto}://${location.host}/ws/host?src=mic2&${makeQ(themOver(true))}` };
      gThem.ring = [];
      const sock = new WebSocket(themPipe.wsUrl);
      themPipe.ws = sock;
      wirePipe(themPipe, sock);
      guard(themPipe);
      pipes.push(themPipe); // 중지·TTS 토글 등 전체 제어에 포함
      report();
    };
    const closeThem = () => {
      if (!themPipe) return;
      const tp = themPipe;
      themPipe = null;
      const i = pipes.indexOf(tp); if (i >= 0) pipes.splice(i, 1);
      try { if (tp.ws.readyState === WebSocket.OPEN) tp.ws.send(JSON.stringify({ type: 'stop' })); } catch {}
      setTimeout(() => { try { tp.ws.close(); } catch {} }, 1800);
    };
    const toStereo = () => {
      st = 'stereo';
      save('stereo');
      reopenPipe(p0, meUrl()); guard(p0); // 1채널로 열려 있던 연결을 내 채널(단방향)로
      try { onMessage({ type: 'status', message: '스테레오 마이크 감지 — 송신기 1번=나, 2번=상대로 나눠 통역합니다.' }); } catch {}
      report();
    };
    const toMono = (persist) => {
      const wasStereo = st === 'stereo';
      st = 'mono';
      if (persist) save('mono');
      if (wasStereo) { closeThem(); reopenPipe(p0, oneUrl()); guard(p0); } // 2채널로 시작했는데 모노면 1채널(양방향)로 되돌림
      // 브라우저: 원음으로 열었던 트랙에 에코 제거·잡음 억제를 다시 켠다(1채널 대면 통역의 TTS 에코 방지)
      const tr = stream && stream.getAudioTracks ? stream.getAudioTracks()[0] : null;
      if (persist && tr && tr.applyConstraints) tr.applyConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: micRatio <= 0 }).then(() => { monoProcessed = true; report(); }).catch(() => {});
      report();
    };
    const onFrame = (L, R) => {
      if (stopped) return;
      const [rl] = rmsOf(L), [rr] = rmsOf(R);
      // 이 기기 TTS 재생 중: 원음(2채널·판별 중)은 에코 제거가 없으니 무음. 크게 말하면(barge-in) 재생을 끊고 살린다 — 채널 중 큰 쪽 기준
      const ttsGuard = audioCtx.currentTime < ttsMutedUntil && !(monoProcessed && aecActive);
      if (ttsGuard) { if (Math.max(rl, rr) > 0.06) { if (++bargeStreak >= 2) { bargeStreak = 0; ttsBargeIn(); } } else bargeStreak = 0; }
      if (st === 'stereo') {
        feed(gMe, L, p0, true, ttsGuard);
        if (themPipe) feed(gThem, R, themPipe, false, ttsGuard);
        else if (feed(gThem, R, null, false, ttsGuard)) openThem();
        // 2채널 중에도 계속 검증 — 사실은 같은 소리(모노 모드)면 다음부터 1채널로 시작
        acc(ver, L, R, rl, rr);
        if (ver.n >= 60) { if (ver.rDom === 0 && corrOf(ver) > 0.985) save('mono'); ver = stat(); }
        return;
      }
      // 판별 중·모노: 왼쪽 소리로 1채널 동작(오른쪽은 엔진에 보내지 않음 — 2채널 전환 시 조각 중복 방지)
      feed(gMe, L, p0, true, ttsGuard);
      if (onMeter) { const [, pr] = rmsOf(R); onMeter(rr, pr, 'mic2'); }
      if (st !== 'detect') return;
      gThem.ring.push(floatTo16BitPCM(R)); if (gThem.ring.length > 8) gThem.ring.shift(); // 전환 시 상대 채널 프리롤
      acc(det, L, R, rl, rr);
      if (det.rDom >= 3) { toStereo(); openThem(); return; }
      if (det.n >= 12 && det.rDom === 0 && corrOf(det) > 0.985) toMono(true); // 복사본·백업 트랙 → 다음부터 바로 1채널
    };
    if (st === 'stereo') openThem(); // 스테레오로 알고 시작 — 상대 채널도 바로
    report();
    if (plan.native) {
      const decode = (b64) => { const bin = atob(b64); const n = bin.length >> 1; const out = new Float32Array(n); for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 0x8000) v -= 0x10000; out[i] = v / 32768; } return out; };
      window.__kacNA2 = (b64) => { const x = decode(b64); const n = x.length >> 1; const L = new Float32Array(n), R = new Float32Array(n); for (let i = 0; i < n; i++) { L[i] = x[2 * i]; R[i] = x[2 * i + 1]; } onFrame(L, R); };
      // 모노 프레임(수신기 분리 등으로 기기가 1채널이 됨): 이번 세션은 1채널로(기억은 안 바꿈 — 일시적일 수 있다)
      window.__kacNA = (b64) => { if (st !== 'mono') toMono(false); const m = decode(b64); onFrame(m, m); };
      let ch = 0;
      try { ch = Number(window.AndroidAudio.startStereo()) || 0; } catch {}
      if (!ch) throw new Error('마이크를 사용할 수 없습니다. 마이크 권한을 허용한 뒤 다시 시도하세요.');
      if (ch === 1) toMono(false);
      nativeMicUsed = true;
      return;
    }
    const node = audioCtx.createMediaStreamSource(stream);
    const proc = audioCtx.createScriptProcessor(4096, 2, 1);
    node.connect(proc);
    const g = audioCtx.createGain();
    g.gain.value = 0;
    proc.connect(g);
    g.connect(audioCtx.destination);
    proc.onaudioprocess = (e) => {
      const ib = e.inputBuffer;
      const L = downsampleTo24k(ib.getChannelData(0), inRate);
      const R = ib.numberOfChannels > 1 ? downsampleTo24k(ib.getChannelData(1), inRate) : L;
      onFrame(L, R);
    };
    p0.proc = proc;
    stream.getTracks().forEach((t) => (t.onended = () => {
      const wasLive = !stopped;
      stop();
      if (wasLive) { try { opts.onEnded && opts.onEnded(); } catch {} }
    }));
  }

  for (const { src, stream, native } of sources) {
    if (stream) streams.push(stream);
    const isAudioPipe = pipes.length === 0; // 서버 TTS 음성은 첫 연결에서만 재생(모두 모드 이중 재생 방지)
    // 채널 분리: 시스템+마이크 → 각자 단방향 / 스테레오(이미 판별된 기기) → 내 채널 단방향으로 시작
    const stereoHere = src === 'mic' && stereoPlan && stereoPlan.cached === 'stereo';
    const over = canSplit && mode === 'both' ? (src === 'system' ? themOver(false) : meOver)
      : (canSplit && stereoHere ? meOver : null);
    const wsUrl = `${proto}://${location.host}/ws/host?src=${src}&${over ? makeQ(over) : q}`;
    const pipe = { src, ws: null, proc: null, wsUrl, isAudioPipe };
    const wire = (sock) => wirePipe(pipe, sock);

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
      stopped = true; // 진행 중인 비동기 셋업(AEC 등)이 완료돼도 자원을 잡지 않게
      cleanupAec();
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      pipes.forEach((p) => { try { p.ws.close(); } catch {} });
      try { audioCtx.close(); } catch {}
      throw e;
    }
    wire(ws0);

    // 스테레오 2채널 후보(양방향 통역 마이크) — 판별·채널 분리는 setupStereo 가 맡는다
    if (src === 'mic' && stereoPlan) {
      try { setupStereo(pipe, stream); }
      catch (e) {
        stopped = true;
        cleanupAec();
        streams.forEach((s2) => s2.getTracks().forEach((t) => t.stop()));
        pipes.forEach((p) => { try { p.ws.close(); } catch {} });
        try { ws0.close(); } catch {}
        try { audioCtx.close(); } catch {}
        throw e;
      }
      pipes.push(pipe);
      continue;
    }

    if (native) {
      // 네이티브 마이크(안드로이드 앱): AudioRecord(AGC 없음)가 24kHz PCM16 청크를 base64 로 전달.
      // 게이트·VAD·음소거는 브라우저 경로와 동일 로직 — 카운터만 프레임 수 대신 ms 로 센다(청크 길이 가변).
      const TH = 0.015;
      let lastActivitySent = 0;
      let gateOpenUntil = 0;
      let prevRaw = null; // 직전 무음화 프레임(게이트 온셋 프리롤용)
      window.__kacNA = (b64) => {
        const bin = atob(b64);
        const nb = bin.length & ~1;
        if (!nb) return;
        const ab = new ArrayBuffer(nb);
        const u8 = new Uint8Array(ab);
        for (let i = 0; i < nb; i++) u8[i] = bin.charCodeAt(i);
        const i16 = new Int16Array(ab); // ARM=리틀엔디언, 서버 규격(LE) 그대로
        const n = i16.length;
        let sum = 0, peak = 0;
        for (let i = 0; i < n; i++) { const v = Math.abs(i16[i]) / 32768; sum += v * v; if (v > peak) peak = v; }
        const rms = Math.sqrt(sum / n);
        if (onMeter) onMeter(rms, peak);
        const frameMs = (n / 24000) * 1000;
        const w = pipe.ws;
        const wOpen = w && w.readyState === WebSocket.OPEN;
        if (muted || (!aecActive && audioCtx.currentTime < ttsMutedUntil)) {
          // TTS 자동 음소거 중 barge-in: 크게 말하면 재생을 끊고 마이크를 살린다(발화 통째 유실 방지)
          if (!muted) { if (rms > 0.06) { if (++bargeStreak >= 2) { bargeStreak = 0; ttsBargeIn(); } } else bargeStreak = 0; }
          if (wOpen) {
            w.send(new ArrayBuffer(n * 2));
            const t = Date.now();
            if (t - lastActivitySent > 5000) { lastActivitySent = t; notifyActivityAll(); }
          }
          return;
        }
        let gated = false;
        if (micRatio > 0) {
          const openNow = Date.now() < gateOpenUntil;
          if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.3;
          else if (!openNow) noiseFloor += (rms - noiseFloor) * 0.002; // 발화(게이트 열림) 중 바닥 상승 동결 — 연속 발화 중간 절단 방지
          if (noiseFloor < 0.0003) noiseFloor = 0.0003;
          if (rms >= micAbsMinNative && rms >= noiseFloor * micRatio) {
            // 온셋 프리롤: 닫힘→열림 전이면 직전(무음으로 나간) 프레임을 재전송해 첫 음절을 복구
            if (!openNow && prevRaw && wOpen) { try { w.send(prevRaw); } catch {} }
            gateOpenUntil = Date.now() + 300;
          }
          if (Date.now() >= gateOpenUntil) gated = true;
        }
        if (wOpen) w.send(gated ? new ArrayBuffer(n * 2) : ab);
        prevRaw = gated ? ab : null; // 무음화된 프레임만 보관(프리롤 후보)
        if (peak > TH) notifyActivityAll();
      };
      if (!window.AndroidAudio.start()) {
        // 시작 실패(권한 미허용 등) — 이미 연 자원을 정리하고 getUserMedia 거부와 동일하게 실패 전파
        window.__kacNA = null;
        stopped = true;
        cleanupAec();
        streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
        pipes.forEach((p) => { try { p.ws.close(); } catch {} });
        try { ws0.close(); } catch {}
        try { audioCtx.close(); } catch {}
        throw new Error('마이크를 사용할 수 없습니다. 마이크 권한을 허용한 뒤 다시 시도하세요.');
      }
      nativeMicUsed = true;
      pipes.push(pipe);
      continue;
    }

    const node = audioCtx.createMediaStreamSource(stream);
    const proc = audioCtx.createScriptProcessor(4096, 1, 1);
    // RNNoise: 마이크 계열 소스만 정제(시스템 오디오는 음악·회의음이라 잡음 억제 부적합)
    if (rnnMod && src !== 'system') pipe.den = createDenoiser(rnnMod);
    node.connect(proc);
    const g = audioCtx.createGain();
    g.gain.value = 0;
    proc.connect(g);
    g.connect(audioCtx.destination);

    const frameMs = (4096 / inRate) * 1000;
    // 클라이언트는 자주 커밋해 원문을 흘려보내고, 표시 단위는 서버의 N초 배칭이 결정
    const TH = 0.015;
    let lastActivitySent = 0;
    let gateOpenUntil = 0; // 게이트가 열려 있는(전송) 시한 — 마지막 큰 소리 이후 hold
    let prevRaw = null;    // 직전 무음화 프레임(게이트 온셋 프리롤용)
    pipe.gapBuf = [];      // WS 끊김(재연결) 동안 프레임 버퍼(최근 ~2초) — 재연결 시 flush 해 발화 유실 축소

    proc.onaudioprocess = (e) => {
      // RNNoise 사용 시 정제된 신호로 게이트·VAD·전송을 판단(480샘플 정렬 잔여분은 다음 콜백으로 이월)
      const input = pipe.den ? pipe.den.process(e.inputBuffer.getChannelData(0)) : e.inputBuffer.getChannelData(0);
      if (!input.length) return;
      let sum = 0,
        peak = 0;
      for (let i = 0; i < input.length; i++) {
        const v = Math.abs(input[i]);
        sum += input[i] * input[i];
        if (v > peak) peak = v;
      }
      const rms = Math.sqrt(sum / input.length);
      if ((src === 'mic' || src === 'guestmic') && onMeter) onMeter(rms, peak, src);

      const w = pipe.ws; // 재연결로 소켓이 바뀌어도 항상 현재 소켓 사용
      const wOpen = w && w.readyState === WebSocket.OPEN;

      // 여객 마이크(2마이크 모드): 근접 게이트+백프레셔로 상시 스트림 — 커밋 없음(soniox 엔드포인트가 확정).
      // 발화멈춤(muted)은 직원 마이크 전용(손님 말은 호스트 일시정지와 무관), TTS 재생 중 음소거는 공유
      // (PC 스피커의 TTS 가 여객 마이크로도 들어가므로).
      if (src === 'guestmic') {
        if (!wOpen) return;
        if (w.bufferedAmount > 131072) return; // 백프레셔: 밀린 오디오는 버림(지연 누적 방지)
        const ds = downsampleTo24k(input, inRate);
        if (!aecActive && audioCtx.currentTime < ttsMutedUntil) { w.send(new ArrayBuffer(ds.length * 2)); return; }
        const gOpenNow = Date.now() < (pipe.gOpenUntil || 0);
        if (rms < gFloor) gFloor += (rms - gFloor) * 0.3;
        else if (!gOpenNow) gFloor += (rms - gFloor) * 0.002; // 발화(게이트 열림) 중 바닥 상승 동결
        if (gFloor < 0.0003) gFloor = 0.0003;
        if (gRatio <= 0 || (rms >= gAbsMin && rms >= gFloor * gRatio)) {
          if (!gOpenNow && pipe.gPrevRaw) { try { w.send(pipe.gPrevRaw); } catch {} } // 온셋 프리롤
          pipe.gOpenUntil = Date.now() + 300;
        }
        const gOpen = Date.now() < (pipe.gOpenUntil || 0);
        const pcm = floatTo16BitPCM(ds);
        w.send(gOpen ? pcm : new ArrayBuffer(ds.length * 2));
        pipe.gPrevRaw = gOpen ? null : pcm; // 무음화된 프레임만 보관(프리롤 후보)
        if (peak > TH) notifyActivityAll();
        return;
      }

      // 발화 일시정지(mute), 또는 (AEC 미지원 폴백일 때만) TTS 재생 중 자동 음소거: 무음 전송 + keepalive
      // AEC 루프백이 켜져 있으면 재생음이 마이크에서 제거되므로 TTS 중에도 발화 가능(음소거 안 함)
      // '발화 멈춤'은 내 마이크만 끈다 — PC 소리(system) 채널은 상대 발화라 계속 번역해야 한다
      // (양방향 통역 'PC 소리+마이크'에서 누르면 상대 말 번역까지 멈추던 버그).
      const micOff = muted && src !== 'system';
      if (micOff || (!aecActive && audioCtx.currentTime < ttsMutedUntil)) {
        // TTS 자동 음소거 중 barge-in: 크게 말하면 재생을 끊고 마이크를 살린다(발화 통째 유실 방지)
        if (!micOff) { if (rms > 0.06) { if (++bargeStreak >= 2) { bargeStreak = 0; ttsBargeIn(); } } else bargeStreak = 0; }
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
        const openNow = Date.now() < gateOpenUntil;
        if (rms < noiseFloor) noiseFloor += (rms - noiseFloor) * 0.3; // 조용 → 빠르게 수렴
        // 게이트 열림(발화) 중엔 바닥 상승 동결 — 이전엔 0.002/프레임씩 올라 쉼 없는 5~12초
        // 연속 발화의 한가운데서 게이트가 되닫혀 문장 중간이 무음화됐다(폴란드 시연 끊김 원인).
        else if (!openNow) noiseFloor += (rms - noiseFloor) * 0.002;
        if (noiseFloor < 0.0003) noiseFloor = 0.0003;
        if (rms >= micAbsMin && rms >= noiseFloor * micRatio) {
          // 온셋 프리롤: 닫힘→열림 전이면 직전(무음으로 나간) 프레임을 재전송해 첫 음절(~85ms)을 복구
          if (!openNow && prevRaw && wOpen) { try { w.send(prevRaw); } catch {} }
          gateOpenUntil = Date.now() + 300;
        }
        if (Date.now() >= gateOpenUntil) gated = true;
      }
      if (wOpen) {
        const ds = downsampleTo24k(input, inRate);
        const pcm = floatTo16BitPCM(ds);
        w.send(gated ? new ArrayBuffer(ds.length * 2) : pcm);
        prevRaw = gated ? pcm : null; // 무음화된 프레임만 보관(프리롤 후보)
        if (pipe.gapBuf.length) pipe.gapBuf = []; // 연결 정상 — 끊김 버퍼 비움
      } else {
        // WS 끊김(재연결 대기) 동안 프레임 보관 — 재연결 onopen 에서 flush 해 발화 유실을 ~2초로 제한
        const ds = downsampleTo24k(input, inRate);
        pipe.gapBuf.push(floatTo16BitPCM(ds));
        if (pipe.gapBuf.length > 24) pipe.gapBuf.shift();
      }

      // 소리(시스템 오디오 포함)가 들리면 유휴 자동종료 방지 신호 — 모든 연결에 전송(전역)
      if (peak > TH) notifyActivityAll();
    };
    pipe.proc = proc;

    // 장치 뽑힘·화면공유 중지 등 트랙 자체 종료 → 캡처 정지 + 호출자(UI)에 통지('진행 중' 고착 방지)
    stream.getTracks().forEach((t) => (t.onended = () => {
      const wasLive = !stopped;
      stop();
      if (wasLive) { try { opts.onEnded && opts.onEnded(); } catch {} }
    }));
    pipes.push(pipe);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('visibilitychange', onVisResume);
    const closing = pipes.slice();
    for (const p of closing) {
      try {
        if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'stop' }));
      } catch {}
      if (p.proc) p.proc.onaudioprocess = null;
      if (p.den) p.den.destroy(); // RNNoise 상태·wasm 힙 반납
    }
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    if (nativeMicUsed) { try { window.AndroidAudio.stop(); } catch {} window.__kacNA = null; window.__kacNA2 = null; }
    cleanupAec();
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

  // 발화 on/off (세션 유지). on=true 면 내 마이크만 일시정지(무음 전송), PC 소리 채널은 계속.
  function setMuted(on) {
    muted = !!on;
  }

  // 녹음 중 TTS(음성 재생) 토글 — 로컬 재생 + 서버 합성/호스트 전송 on/off
  // local=false: '뷰어에게만' — 서버는 합성해 뷰어에게 보내고 이 기기에서는 재생하지 않는다
  function setTts(on, genderSel, local = true) {
    audioOutOn = !!on && local !== false;
    ctlState.tts = { on: !!on, local: local !== false, gender: genderSel || (ctlState.tts && ctlState.tts.gender) || null };
    for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'tts', on: !!on, local: local !== false, ...(genderSel ? { gender: genderSel } : {}) })); } catch {} }
  }

  // 데스크: 호스트 수동 '대기모드로' — 현재 대화 종료(뷰어를 터치화면으로)
  function deskReset() { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-reset-now' })); } catch {} } }
  // 데스크: 호스트 수동 통역 시작(손님 언어 지정) — soniox 세션이 이때 열림
  function deskStart(lang) { for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-start', lang })); } catch {} } }
  // 녹음 중 마이크 민감도 실시간 변경(0~100) — 클라이언트 볼륨 게이트만 조정, 연결 유지
  function setMicSens(v) {
    micSensVal = Number(v);
    calcGate(micSensVal);
    // 게이트 사용 중엔 AGC(자동 게인) off 시도 — 켜져 있으면 원거리음까지 증폭해 근접 판별을 흐린다. 100이면 원복.
    // 스테레오 원음 트랙은 건드리지 않는다(제약을 바꾸면 크롬이 처리 경로로 되돌려 1채널로 합칠 수 있다)
    if (micTrack && micTrack.applyConstraints && !stereoPlan) micTrack.applyConstraints({ autoGainControl: !(micSensVal < 100) }).catch(() => {});
  }
  // 송신기 2(오른쪽) 감도 실시간 변경 — 스테레오로 나눠 들을 때만 효과
  function setMicSens2(v) {
    micSens2Val = Number(v);
    calcGate2(micSens2Val);
  }
  // 자동 감도 켜기/끄기(녹음 중에도) — 켜면 슬라이더 값은 무시하고 주변 소음 기준으로(두 채널 모두)
  function setMicAuto(on) {
    micAutoVal = !!on;
    calcGate(micSensVal);
    calcGate2(micSens2Val);
    if (micTrack && micTrack.applyConstraints && !stereoPlan) micTrack.applyConstraints({ autoGainControl: !(micRatio > 0) }).catch(() => {});
  }
  // 데스크: 여객 마이크 민감도(0~100) — 뷰어 태블릿엔 서버 경유로, 2마이크 모드의 로컬 여객 게이트엔 즉시 반영
  function setGuestSens(v) { ctlState.guestSens = Number(v); calcGuestGate(v); for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-guest-sens', value: Number(v) })); } catch {} } }
  // 데스크: 무음 자동 종료 시간(ms) 실시간 변경 — 상시 캡처 중에도 설정 가능
  function setDeskIdle(ms) { ctlState.deskIdle = Number(ms); for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'desk-idle', value: Number(ms) })); } catch {} } }
  // 고급옵션: 단독 응답어(네/Yes) 기록 생략 — 녹음 중 실시간 토글
  function setDropAcks(on) { ctlState.dropAcks = !!on; for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'dropAcks', on: !!on })); } catch {} } }
  // 고급옵션: 저신뢰 자동 교정(GPT) — 녹음 중 실시간 토글
  function setConfFix(on) { ctlState.confFix = !!on; for (const p of pipes) { try { if (p.ws.readyState === WebSocket.OPEN) p.ws.send(JSON.stringify({ type: 'confFix', on: !!on })); } catch {} } }

  return { stop, setAudioOut, setVolume, setMuted, setTts, deskReset, deskStart, setMicSens, setMicSens2, setMicAuto, setGuestSens, setDeskIdle, setDropAcks, setConfFix };
}
