/* 안내데스크 파이프라인 — 대기(엔진 없음) → 손님 언어 선택 시 soniox 통역, 2채널(여객 마이크)·누화 판정·길안내·응대 기록.
   handleHost(realtime/host.js)가 runDesk(h) 를 호출한다(h = 연결 컨텍스트). runDeskGuestFeed = PC 호스트의 여객 마이크 공급 연결. */
import { WebSocket } from 'ws';
import { SONIOX_API_KEY, SONIOX_LANGS, SX_MAX_FAILS, sxRetryDelay } from '../config.js';
import { saveSessions } from '../store/index.js';
import { newId, capDeskLog } from '../store/sessions.js';
import { rooms, deskCtrl, getRoom, broadcast } from '../realtime/rooms.js';
import { openSonioxWs, buildSonioxContext, langJudge } from '../vendors/soniox.js';
import { resolveCategoryDests, classifyFacility } from '../desk/wayfind.js';
import { detectCategory, isLocationAnswer, parseAnswerFloor } from '../desk/wayfind_dict.js';
import { echoNorm, echoMatch } from '../util/security_util.js';
import { isAckOnly, stripFillers } from '../util/pipeline_util.js';

/* ---- 데스크 2마이크(PC 호스트): 여객 마이크 오디오 공급 전용 연결 ----
   호스트 PC 가 지향성 마이크 2대를 직접 잡아 두 번째 장치를 src=guestmic 연결로 스트리밍한다.
   컨트롤러·사용량·발화 락·유휴 타이머 등 일반 호스트 파이프라인은 만들지 않고,
   기존 데스크 파이프라인의 여객 채널(guestMic/feedGuest — 뷰어 desk-mic 와 동일 경로)에 오디오만 흘린다. */
export function runDeskGuestFeed(ws) {
  const sessionId = ws._session;
  ws._deskGuestFeed = true; // guestMic 소유권 우선순위 판단용(호스트 공급 > 뷰어 태블릿)
  // room.hosts 에 넣지 않는다 — host active 계산을 오염시키지 않기 위해
  // 전용 슬롯(guestFeeder)로만 추적. 하트비트는 wss.clients 전체를 돌므로 좀비 감지엔 문제 없음.
  const room = getRoom(sessionId);
  if (room.guestFeeder && room.guestFeeder !== ws) {
    // 같은 세션의 이전 여객 공급 연결은 승계(새로고침 좀비 정리 — 일반 호스트 takeover 와 동일 규칙)
    try { room.guestFeeder.send(JSON.stringify({ type: 'takeover' })); } catch {}
    try { room.guestFeeder.close(); } catch {}
  }
  room.guestFeeder = ws;
  // 데스크 컨트롤러(본 호스트 연결)가 아직 없을 수 있음(두 파이프 동시 오픈 레이스) — 잠시 재시도
  let attachTries = 0;
  const attach = () => {
    const dc = deskCtrl.get(sessionId);
    if (dc && dc.guestMic) { dc.guestMic(true, ws); return true; }
    return false;
  };
  const attachTimer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN || attach() || ++attachTries > 20) clearInterval(attachTimer);
  }, 500);
  attach();
  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      const dc = deskCtrl.get(sessionId);
      if (dc && dc.feedGuest) dc.feedGuest(data, ws);
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'stop') { try { ws.close(); } catch {} }
      // commit/activity 등 일반 호스트 제어는 여객 채널에 해당 없음(soniox 엔드포인트가 확정) — 무시
    } catch {}
  });
  ws.on('close', () => {
    clearInterval(attachTimer);
    const r = rooms.get(sessionId);
    if (r && r.guestFeeder === ws) r.guestFeeder = null;
    const dc = deskCtrl.get(sessionId);
    if (dc && dc.guestMic) dc.guestMic(false, ws); // 소유자였으면 단일 채널 폴백(내부 소유권 체크)
  });
}

/* ---------- 데스크 안내 모드: 대기(idle) → 언어 선택 시 soniox two_way(ko↔X) ----------
   · 호스트 '대기 시작' = 마이크 캡처만(STT 세션 없음 — 대기 중 비용 0, 오디오는 버림).
   · 손님(뷰어 태블릿)이 언어(한·영·일·중)를 선택하거나 호스트가 언어를 골라 시작하면 그때 soniox 연결.
   · 무음 deskIdleMs(기본 30초) → 대화 종료: items 를 deskLog 에 보존, soniox 종료 → 대기(idle) 복귀.
   · TTS/화자분리 없음. 클라(호스트=ko / 뷰어=X)는 source+texts+meta(sxInfo)로 색/표시 결정. */
export function runDesk(h) {
  const { ws, sessionId, session, toHost, liveSend, upsertItem, polishCommit, maybeConfFix } = h;
  if (!SONIOX_API_KEY) { toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — 데스크 모드 사용 불가' }); return; }
  const sens = Number(ws._sxSens), maxDelay = Number(ws._sxMaxDelay), latency = Number(ws._sxLatency);
  const A = 'ko'; // 안내원 언어(고정)
  // 손님(또는 호스트)이 고르는 언어(soniox 지원, 한국어 제외).
  // es·fr·de 추가: '기타 언어'(자동 감지) 힌트로도 쓰이는데 빠져 있으면 해당 언어 첫 발화가
  // 번역되지 않고 원문이 그대로 표시된다(2026-07-29 스페인어 사례).
  const GUEST_LANGS = ['en', 'ja', 'zh', 'vi', 'th', 'id', 'ru', 'es', 'fr', 'de'];
  let deskIdleMs = Math.min(120000, Math.max(5000, Number(ws._deskIdle) || 30000)); // 무음 → 대화 종료(기본 30초). 'desk-idle' 메시지로 응대 중에도 변경 가능
  // 여객 태블릿 마이크 민감도(0~100, 50=기존 고정값과 동일) — 뷰어의 근접 게이트 임계로 변환돼 적용
  let guestSens = Math.min(100, Math.max(0, Number(ws._deskGuestSens) >= 0 ? Number(ws._deskGuestSens) : 50));
  const sendGuestSens = () => { const m = { type: 'desk-guest-sens', value: guestSens }; broadcast(sessionId, m); };

  let phase = 'idle';     // 'idle'(대기, soniox 없음) | 'active'(통역 중)
  let lockedB = null;     // 손님 언어
  let sx = null, sxReady = false;
  // 예기치 않은 종료만 누적 — 토큰 수신·새 응대 시작 시 0. 의도적 재체결(언어 감지·2채널 전환·
  // 여객 마이크 토글)은 closeSx() 가 sx 를 먼저 null 로 만들어 close 핸들러가 걸러내므로 세지 않는다.
  // 상한이 없으면 엔진이 연결 즉시 끊는 상황에서 800ms 무한 재시도가 돌고, 재연결마다 context 가
  // input_text_tokens 로 재청구돼 데스크 1대당 시간 수만원이 나간다(PROJECT_NOTES 2026-07-15 와 동일 사유).
  let sxFails = 0;
  let closed = false;     // 호스트 중지/종료 — 자동 재연결 금지 플래그
  let pending = [];       // 리플레이 버퍼(마지막 확정 이후 프레임, 상한 ~2초) — 재체결 시 재전송
  let lastVoiceArm = 0;   // 음량 기반 무음타이머 리셋 스로틀
  let foreignTimer = null;
  let warnTimer = null;       // 무음 종료 10초 전 예고
  // (삭제됨) 무음 시 양 채널 조용한 재연결(컨텍스트 플러시) — 재연결마다 context 가
  // input_text_tokens 로 재청구돼 비용 폭증(runSoniox 와 동일 사유, PROJECT_NOTES 2026-07-15).
  let staffTm = null, guestTm = null; // 채널별 발화 레이턴시 타임스탬프 { s, e } (커밋 시 c 추가)
  let pendingWayfind = null;  // 호스트 승인 대기 중인 길안내 제안
  let wayfindOn = ws._wayfind !== '0'; // 길안내 지도 기능(기본 on) — 끄면 감지·GPT 분류 자체를 생략
  let convStartedAt = 0;      // 현재 응대 시작 시각(통계용)
  let convConsentAt = null;   // 현재 응대의 손님 동의 시각(고지 모달 '동의하고 시작')

  // ---- 여객(뷰어 태블릿) 마이크 채널 — 2채널 화자 귀속 프로토타입 ----
  // 뷰어가 desk-mic on 을 보내고 바이너리 오디오를 올리면 별도 soniox one_way(선택언어→ko)로 처리.
  // 채널 자체가 화자 귀속이므로 언어 추정이 필요 없고, 동시 발화도 채널별로 독립 인식된다.
  let guestMicOn = false;
  let gsx = null, gsxReady = false;
  let gsxFails = 0;       // 여객 채널 재연결 실패 누적(데스크 채널과 독립) — 한쪽만 죽어도 상한이 걸리게
  let gPending = [];
  let gCurId = null, gFinalText = '', gFinalTrans = '', gLastTrans = '', gLastCommitText = '';
  let gLastCommitAt = 0;
  let gCurSrc = ''; const gLangVotes = langJudge(); // 여객 채널 감지 언어 — 안내원(ko) 누화 판정용
  let gToks = []; // 여객 채널 원문 확정 토큰 [[text, confidence], ...]
  const recentCommits = [];   // 교차 중복(누화) 필터: [{ n, at, ch }]
  const chStats = { staff: 0, guest: 0, crossDrops: 0 }; // 누화율 측정용(deskLog 에 저장)

  // 교차 채널 누화 판정: 반대 채널이 8초 내 유사 문장을 확정했으면 누화(마이크로 샌 소리)로 드랍.
  // 근접 게이트·언어 소유권을 통과한 잔여 누화의 마지막 방어선.
  // (두 엔진의 endpoint 시점이 벌어져 5초 창을 새던 문제 → 8초, 짧은 발화도 → 4자)
  // 원문뿐 아니라 번역문도 교차 대조 — 한 발화가 양쪽 마이크에 비슷한 음량으로 들어가 언어 판별까지
  // 엇갈린 경우(예: 손님 발화가 데스크 채널에서 한국어로 오인식), 원문 문자는 서로 달라도
  // "손님 채널의 한국어 번역 ↔ 데스크 채널의 한국어 원문"이 유사해 여기서 걸린다.
  // 판정(hit)과 기록(note)을 분리 — 음량 중재로 '살린' 발화도 기록해야 반대 채널의 진짜 누화가 걸린다.
  const crossDupHit = (ch, txt, tgt) => {
    const n = echoNorm(txt);
    const nt = echoNorm(tgt || '');
    const now = Date.now();
    while (recentCommits.length && now - recentCommits[0].at > 8000) recentCommits.shift();
    return recentCommits.some((e) => e.ch !== ch && (
      (n.length >= 4 && (echoMatch(n, e.n) || (e.nt.length >= 4 && echoMatch(n, e.nt)))) ||
      (nt.length >= 4 && (echoMatch(nt, e.n) || (e.nt.length >= 4 && echoMatch(nt, e.nt))))
    ));
  };
  const crossDupNote = (ch, txt, tgt) => { recentCommits.push({ n: echoNorm(txt), nt: echoNorm(tgt || ''), at: Date.now(), ch }); };

  /* ---- 음량 중재: 채널별 수신 프레임 RMS 로 '진짜 화자'를 판정 ----
     누화는 원거리 소리라 원 채널보다 항상 작다. 발화 시간창에서 자기 채널 평균 RMS 가
     반대 채널보다 확실히(1.3배) 크면, 언어 소유권·crossDup 이 누화로 판정했더라도 실제
     발화로 보고 살린다 — 겹침 발화 전체 드랍·직원의 외국어 응대 드랍·외래어 오귀속을 완화.
     표본이 없으면(테스트·단일 채널 순간 등) null → 기존 판정 유지. */
  const volLog = { staff: [], guest: [] }; // [{ t, r }] 최근 12초
  const noteVol = (ch, buf) => {
    try {
      const n = buf.length >> 1;
      if (!n) return 0;
      let sum = 0, cnt = 0;
      for (let i = 0; i < n; i += 4) { const v = buf.readInt16LE(i * 2) / 32768; sum += v * v; cnt++; } // 4샘플 간격 서브샘플(CPU 절약)
      const r = Math.sqrt(sum / (cnt || 1));
      const arr = volLog[ch];
      const now = Date.now();
      arr.push({ t: now, r });
      while (arr.length && now - arr[0].t > 12000) arr.shift();
      return r;
    } catch { return 0; }
  };
  const meanVol = (ch, t0, t1) => {
    const arr = volLog[ch].filter((e) => e.t >= t0 && e.t <= t1);
    if (arr.length < 3) return null; // 표본 부족 → 판정 불가
    return arr.reduce((a, e) => a + e.r, 0) / arr.length;
  };
  const volOwn = (ch, t0, t1) => {
    const own = meanVol(ch, t0, t1);
    if (own == null) return null;
    const other = meanVol(ch === 'staff' ? 'guest' : 'staff', t0, t1);
    if (other == null) return own > 0.008 ? true : null; // 반대 채널 무데이터(단일 공급 순간)
    return own >= other * 1.3 && own > 0.008; // 명백히 우세 + 절대 최소음량
  };
  // 채널-언어 소유권(2채널 모드의 1차 방어): 여객 태블릿 마이크가 켜져 있으면
  // 손님 언어 발화는 여객 채널이, 한국어 발화는 데스크 채널이 소유한다.
  // 같은 발화가 반대쪽 마이크에 새어 들어와 문장이 조금 다르게 전사되면 crossDup(유사도)이
  // 놓칠 수 있는데, 언어 기준 소유권은 전사 차이와 무관하게 결정적으로 걸러 준다.
  // (손님이 한국어를 고른 단일언어 응대에서는 언어로 구분 불가 → crossDup 만 사용)
  // 자동 감지(Other languages) 중에도 적용: 언어가 아직 잠기지 않았을 뿐 '외국어=손님, 한국어=안내원'
  // 원칙은 동일 — 미적용 시 같은 발화가 두 채널에 동시에 라이브 표시(2줄)됐다가 커밋에서 합쳐지는 문제.
  const staffOwns = (src) => !(guestMicOn && src && src !== A && (autoDetect || (lockedB && lockedB !== A)));
  const guestOwns = (src) => !(src === A && (autoDetect || (lockedB && lockedB !== A)));

  // langs = 이번 응대의 활성 언어(ko + 손님 언어) — 해당 언어의 용어 표기·번역쌍만 context 로 주입
  // target = 단방향 세션의 타깃 언어(주면 번역쌍을 X→타깃 방향만 생성 — context 한도 절약)
  const baseConfig = (langs, target) => ({
    model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
    client_reference_id: 'u:' + (ws._userId || 'anon') + '|p:desk', // 유저별+파이프라인(안내데스크) 사용량 집계
    enable_language_identification: true, enable_endpoint_detection: true,
    endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
    max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
    endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
    ...((() => { const c = buildSonioxContext(langs, { desk: true, target }); return c ? { context: c } : {}; })()), // 데스크: 항공용어 카테고리 제외
  });
  // 손님이 한국어를 고르면 two_way 가 성립하지 않으므로 전부 한국어로 표기(one_way→ko)
  // 2채널(여객 태블릿 마이크 on)에서는 이 채널이 안내원 전용 → one_way(ko→손님 언어) + 힌트 ko 고정.
  //   기기=채널로 화자가 물리적으로 확정돼 있어 two_way 언어 자동판별의 방향 뒤집힘이 사라지고,
  //   언어 힌트가 집중돼 인식도 좋아진다. 여객 채널(gsx)은 원래 one_way(손님 언어→ko) → 합쳐서 one_way×2.
  //   단일 마이크 폴백(여객 마이크 off)은 한 스트림에 두 언어가 섞이므로 two_way 유지(그게 올바른 용처).
  const configFor = () => {
    if (lockedB && lockedB !== A) {
      return guestMicOn
        ? { ...baseConfig([A, lockedB], lockedB), language_hints: [A], translation: { type: 'one_way', target_language: lockedB } }
        : { ...baseConfig([A, lockedB]), language_hints: [A, lockedB], translation: { type: 'two_way', language_a: A, language_b: lockedB } };
    }
    // 자동 감지 중: 언어 미정 → one_way(→ko) + 광역 힌트로 첫 발화 언어를 파악
    return { ...baseConfig([A], A), language_hints: autoDetect ? [A, ...GUEST_LANGS] : [A], translation: { type: 'one_way', target_language: A } };
  };

  const setMeta = () => {
    const sxInfo = phase === 'active'
      ? (lockedB && lockedB !== A ? { mode: 'two', a: A, b: lockedB } : (autoDetect ? { mode: 'detect' } : { mode: 'one', target: A }))
      : { mode: 'idle' };
    if (session) { session.sxInfo = sxInfo; if (phase === 'active' && lockedB) session.langs = [A, lockedB]; saveSessions(session.id); }
    broadcast(sessionId, { type: 'meta', sxInfo, guestSens, mic2: hostFed() });
    toHost({ type: 'meta', sxInfo, guestSens, mic2: hostFed() });
  };

  let curId = null, finalText = '', finalTrans = '', lastTrans = '', curSrc = '', lastCommitText = '';
  let lastCommitAt = 0; // 중복 판정은 5초 창 안에서만(의도적 반복 발화 허용)
  let autoDetect = false; // 'Other languages' 시작 — 첫 발화의 언어를 감지해 two_way 로 전환
  const langVotes = langJudge(); // 입력 언어 판정(첫 단어 오인식 교정)
  let srcToks = []; // 원문 확정 토큰 [[text, confidence], ...] — 저신뢰 하이라이트 + 추후 평가용
  let dropAcks = ws._dropAcks === '1'; // 고급옵션: 단독 응답어 기록 생략(라이브 토글 가능)
  let confFix = ws._confFix === '1'; // 고급옵션: 저신뢰 자동 교정(라이브 토글 가능)
  const targetKeyFor = (src) => (lockedB && lockedB !== A ? (src === A ? lockedB : A) : A);
  const resetUtterance = () => { curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; langVotes.reset(); srcToks = []; };

  // 자동 감지 완료(Other languages): 첫 발화가 한국어가 아니면 그 언어로 잠그고 채널 재체결.
  // 데스크·여객 어느 채널이 먼저 확정하든 여기로 모인다 — 표시 여부(소유권·누화 드랍)와 무관하게 언어부터 잠근다.
  const lockDetected = (src) => {
    if (!(autoDetect && phase === 'active' && src && src !== A && SONIOX_LANGS.includes(src))) return;
    autoDetect = false;
    lockedB = src;
    setMeta();
    armForeignTimer();
    const m2 = { type: 'desk-active', lang: src };
    broadcast(sessionId, m2); toHost(m2);
    toHost({ type: 'status', message: `언어 감지: ${src} — ${guestMicOn ? '채널별 언어 고정(단방향×2)' : `양방향 통역(ko↔${src})`}으로 전환` });
    closeSx(); connectSx();                       // 잠긴 언어 설정으로 재연결
    if (guestMicOn) { closeGuest(); connectGuest(); } // 여객 채널도 감지 언어 힌트로 재연결
  };

  const commit = () => {
    const id = curId, txt = stripFillers(finalText.trim()), src = curSrc;
    const tgt = stripFillers((finalTrans.trim() || lastTrans).trim());
    const toks = srcToks; // 이 발화의 원문 토큰(신뢰도 포함) — resetUtterance 전에 캡처
    const tm = { ...(staffTm || {}), c: Date.now() }; // 레이턴시: s(첫 토큰)/e(<end>)/c(확정)
    staffTm = null;
    resetUtterance();
    pending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외
    if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던(또는 추임새뿐인) 고스트 카드 제거
    // 자동 감지: 소유권·누화 판정으로 드랍되더라도 언어는 먼저 잠근다(첫 발화 유실 방지)
    lockDetected(src);
    // 음량 중재: 이 발화 시간창에서 데스크 마이크가 여객 마이크보다 명백히 큰 소리였다면
    // 언어·유사도 판정과 무관하게 실제 직원 발화로 본다(겹침·외국어 응대·복창을 드랍하지 않음).
    const louder = volOwn('staff', (tm.s || tm.c - 4000) - 300, tm.c);
    // 언어 소유권: 2채널 모드에서 손님 언어 발화는 여객 채널 소유 → 데스크 마이크 누화로 드랍
    if (!staffOwns(src) && louder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
    // 여객 채널이 이미 확정한 문장과 유사 → 데스크 마이크로 샌 누화, 드랍(화면 카드도 제거)
    if (guestMicOn && crossDupHit('staff', txt, tgt) && louder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null); return; }
    crossDupNote('staff', txt, tgt);
    // 고급옵션: 단독 응답어(네/Yes 단독 발화) 기록 생략
    if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null); return; }
    chStats.staff++;
    const out = tgt || txt;
    if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
    lastCommitText = out;
    lastCommitAt = Date.now();
    upsertItem(id, { [targetKeyFor(src)]: out }, txt, null, src || null, undefined, toks, tm);
    if (tgt) polishCommit(id, targetKeyFor(src), txt, tgt); // 번역 다듬기(nano) — 직역투 후교정
    if (confFix) maybeConfFix(id, toks, txt, src, targetKeyFor(src)); // 저신뢰 자동 교정(고급옵션)
    // 길안내: 안내원(한국어) '답변'에서 시설 언급 감지 → 목적지 전송.
    // 외국인 질문이 아니라 직원 답변 기준 — 직원의 현장판단(보안구역·특정 시설 지목)을 반영하고,
    // 기계번역이 아닌 원어민 한국어 원문(txt)에서 매칭하므로 정확도가 높다.
    if (wayfindOn && phase === 'active' && src === A && txt) {
      const dfl = (session && session.deskFloor) || '1F';
      const dsd = (session && session.deskSide) || 'S';
      // 답변에 '목적지 층'이 있으면(예: "1층으로 내려가세요") 데스크 기본 층 우선순위를 덮어씀(직원 현장판단 반영).
      const destFloor = parseAnswerFloor(txt, dfl) || dfl;
      // 오탐 방지: 즉시 뷰어에 쏘지 않고 호스트에 '제안'만 → 호스트가 표시/무시(또는 자동 표시 설정).
      const fire = (catId, via) => {
        try {
          const wf = resolveCategoryDests(catId, destFloor);
          if (wf && wf.dests.length) {
            pendingWayfind = { type: 'wayfind', ...wf, deskFloor: dfl, deskSide: dsd };
            toHost({ ...pendingWayfind, type: 'wayfind-suggest' });
            if (session) { // 운영 로그: 감지 발화·경로(직매칭/GPT)·표시 여부 — 사전·프롬프트 튜닝용
              session.wayfindLog = session.wayfindLog || [];
              session.wayfindLog.push({ at: Date.now(), catId, via, txt: txt.slice(0, 80), shown: false });
              if (session.wayfindLog.length > 200) session.wayfindLog = session.wayfindLog.slice(-200);
              saveSessions(session.id);
            }
          }
        } catch {}
      };
      // 직전 손님 질문(한국어 번역) — 시설명이 답변에 없어도 질문에서 분류할 수 있게 컨텍스트로 전달
      const lastGuestQ = session && Array.isArray(session.items)
        ? [...session.items].reverse().find((it) => it.lang && it.lang !== A && it.texts && it.texts[A])
        : null;
      const NEG = /없|말고|아니/; // 부정·비교 표지 → 직매칭 신뢰 불가, GPT 분류로
      const direct = detectCategory(txt);            // 1) 사전 직매칭(원어민 한국어 → 신뢰도 높음, 무료)
      if (direct.length && !NEG.test(txt)) fire(direct[0].id, 'direct');
      else if (direct.length || isLocationAnswer(txt) || (lastGuestQ && isLocationAnswer(lastGuestQ.texts[A]))) {
        const gen = convStartedAt; // 비동기 분류가 응대 종료 후 도착하면 다음 손님에게 이전 지도가 제안되는 것 방지
        classifyFacility(txt, lastGuestQ ? lastGuestQ.texts[A] : null)
          .then((id) => { if (id && phase === 'active' && gen === convStartedAt) fire(id, 'gpt'); })
          .catch(() => {}); // 2) gpt-5.4-mini
      }
    }
  };

  // 무음 자동종료: 발화가 들릴 때마다 리셋 → deskIdleMs 동안 '아무 말도' 없으면 대화 종료 → 대기(idle)
  // 종료 10초 전 예고(desk-idle-warn) — 뷰어가 카운트다운을 보여주고 터치(keepalive)로 연장 가능
  const armForeignTimer = () => {
    clearTimeout(foreignTimer);
    clearTimeout(warnTimer);
    foreignTimer = setTimeout(() => { if (phase === 'active') endConversation(); }, deskIdleMs);
    const warnAt = deskIdleMs - 10000;
    if (warnAt > 2000) warnTimer = setTimeout(() => {
      if (phase === 'active') { const w = { type: 'desk-idle-warn', secondsLeft: 10 }; broadcast(sessionId, w); toHost(w); }
    }, warnAt);
  };
  let ending = false;      // 그레이스 종료 진행 중(중복 방지)
  let endTimer = null;     // 그레이스 마감 타이머(언어 전환 시 즉시 마감에 사용)
  const endConversation = (graceful = true) => {
    clearTimeout(foreignTimer);
    clearTimeout(warnTimer);
    pendingWayfind = null;
    // 종료 절차 중 commit() 의 자동감지 분기(양방향 재체결·desk-active 브로드캐스트)가 발동하지 않도록
    autoDetect = false;
    // 승계(takeover)로 밀려난 구 파이프라인의 지연 close/타이머가 새 호스트의 진행 중 응대를
    // 아카이브·리셋하지 못하게 — 현재 등록된 컨트롤러만 공유 세션을 만진다.
    if (deskCtrl.get(sessionId) !== ctrl) { phase = 'idle'; lockedB = null; resetUtterance(); closeSx(); closeGuest(); return; }
    if (ending) {
      // 그레이스 대기 중 즉시 마감 요청(언어 전환 등) → 지금 바로 마감해 새 응대와 겹치지 않게
      if (!graceful) { clearTimeout(endTimer); finishEnd(); }
      return;
    }
    if (!graceful || (!sx && !gsx)) { finishEnd(); return; }
    // 그레이스 마감: finalize('') 요청 후 0.9초간 in-flight 토큰을 계속 수신(<end> 도착 시 정상
    // 커밋)한 뒤 마감 — 즉시 close 하면 endpoint 대기 중이던 마지막 문장이 기록에서 유실된다.
    ending = true;
    try { sx && sx.send(''); } catch {}
    try { gsx && gsx.send(''); } catch {}
    endTimer = setTimeout(finishEnd, 900);
  };
  function finishEnd() {
    ending = false;
    clearTimeout(endTimer);
    clearTimeout(foreignTimer);
    clearTimeout(warnTimer);
    // 그레이스 중 호스트 이탈로 deskCtrl 이 지워졌어도 아카이브는 수행한다(기록 보존).
    // 단 '승계'(새 호스트 등록)면 뷰어 방송·메타는 새 파이프라인 몫이라 건드리지 않는다.
    const now2 = deskCtrl.get(sessionId);
    const superseded = !!(now2 && now2 !== ctrl);
    // 사용량: 실제 통역(active) 시간만 누적 — 대기(idle) 시간이 사용량으로 집계되던 문제 수정
    if (phase === 'active' && convStartedAt) ws._deskActiveMs = (ws._deskActiveMs || 0) + (Date.now() - convStartedAt);
    ws._deskActiveStart = 0;
    guestCommit(); // 손님의 마지막 미확정 발화도 기록에 남김
    commit();
    pendingWayfind = null; // commit() 의 길안내 감지가 종료 직전 발화로 제안을 재설정하는 경우 제거(다음 손님 오표시 방지)
    if (session) {
      if (Array.isArray(session.items) && session.items.length) {
        session.deskLog = session.deskLog || [];
        // stats: 채널별 확정 수 + 누화 드랍 수 — 2채널 프로토타입 누화율 측정용
        // 응대 언어: 잠긴 언어(lockedB) 우선, 미잠금 종료(감지 전 이탈 등)면 발화 items 에서 유추 — 로그 '미상' 방지
        const convLang = lockedB || (session.items.find((x) => x.lang && x.lang !== 'ko') || {}).lang || null;
        session.deskLog.push({ startedAt: convStartedAt || null, endedAt: Date.now(), lang: convLang, ...(convConsentAt ? { consentAt: convConsentAt } : {}), items: session.items, stats: { ...chStats } });
        capDeskLog(session);
        session.items = [];
      }
      saveSessions(session.id);
    }
    if (chStats.staff + chStats.guest + chStats.crossDrops > 0) console.log(`[desk] 채널 통계 staff=${chStats.staff} guest=${chStats.guest} crossDrops=${chStats.crossDrops}`);
    chStats.staff = 0; chStats.guest = 0; chStats.crossDrops = 0;
    recentCommits.length = 0;
    gLastCommitText = '';
    lastCommitText = '';
    phase = 'idle'; lockedB = null; autoDetect = false; resetUtterance();
    pending = []; gPending = [];
    closeSx();
    closeGuest(); // 여객 채널 종료(guestMicOn 플래그는 유지 — 다음 응대에서 재연결)
    if (!superseded) {
      broadcast(sessionId, { type: 'desk-reset' });
      toHost({ type: 'desk-reset' });
      broadcast(sessionId, { type: 'snapshot', items: [] });
      setMeta();
      toHost({ type: 'status', message: '대화 종료 — 대기 중(언어 선택 대기)' });
    }
  }

  // 통역 시작: 손님(뷰어)이 언어를 고르거나 호스트가 수동 시작 — 이때 처음 soniox 연결
  const startConversation = (B, consentAt) => {
    if (closed) return;
    // 명시 선택은 엔진 지원 전체(SONIOX_LANGS 60개)로 검증한다. 미지원 값이면 영어로 바꾸지 않고
    // 자동감지로 넘긴다 — 손님이 고른 언어가 아닌 언어로 조용히 통역되는 것보다 낫다.
    // (GUEST_LANGS 는 자동감지 language_hints 전용이라 여기 쓰지 않는다. 늘리면 힌트가 희석된다.)
    const lang = B !== 'auto' && SONIOX_LANGS.includes(B) ? B : null;
    const auto = !lang; // 'auto' 선택 또는 미지원 값 → 첫 발화로 감지
    if (phase === 'active' && !auto && lang === lockedB) return;
    // 응대 중 다른 언어 선택 = 새 손님 — 이전 응대를 먼저 마감(아카이브)해 두 손님의 기록이
    // 한 deskLog 항목으로 병합되지 않게 한다(즉시 마감 — 새 손님을 기다리게 하지 않음).
    if (phase === 'active') endConversation(false);
    if (phase !== 'active') { convStartedAt = Date.now(); ws._deskActiveStart = convStartedAt; } // 응대 시작 시각(통계·사용량용)
    phase = 'active'; lockedB = lang; autoDetect = auto; lastCommitText = ''; resetUtterance();
    sxFails = 0; gsxFails = 0; // 새 손님 응대는 이전 응대의 실패 이력을 물려받지 않는다
    convConsentAt = consentAt || null; // 이 응대의 손님 동의 시각(아카이브에 함께 저장)
    pending = [];
    setMeta();
    armForeignTimer();
    const m = { type: 'desk-active', lang: lang || 'auto' };
    broadcast(sessionId, m); toHost(m);
    toHost({ type: 'status', message: auto ? `통역 시작 — 손님의 첫 발화로 언어를 감지합니다 (무음 ${deskIdleMs / 1000}초 시 자동 종료)` : `통역 시작 (ko↔${lang}) — 무음 ${deskIdleMs / 1000}초 시 자동 종료` });
    connectSx();
    if (guestMicOn) connectGuest(); // 여객 마이크가 이미 연결돼 있으면 여객 채널도 시작
  };

  function closeSx() {
    const old = sx; sx = null; sxReady = false;
    if (old) { try { old.send(''); } catch {} try { old.close(); } catch {} }
  }
  function connectSx() {
    if (closed || phase !== 'active') return;
    const old = sx;
    sxReady = false;
    const next = openSonioxWs();
    sx = next;
    next.on('open', () => {
      if (sx !== next) return; // 빠른 재체결 시 구 소켓의 늦은 open 이 준비 상태를 오염시키지 않게
      try { next.send(JSON.stringify(configFor())); } catch {}
      sxReady = true;
      // 리플레이: 마지막 확정 이후 프레임을 재전송(버퍼 유지) — 구 소켓으로 나갔던 진행 중 발화 복구
      for (const f of pending) { try { next.send(f); } catch {} }
    });
    // 종료(idle)·소켓 교체 후 늦게 도착한 토큰이 다음 응대 화면·기록에 새지 않도록 가드
    next.on('message', (raw) => { if (sx === next && phase === 'active') onSxMessage(raw); });
    next.on('error', (e) => toHost({ type: 'status', message: 'Soniox 오류: ' + ((e && e.message) || e) }));
    // 통역 중 연결이 예기치 않게 끊기면 자동 재연결 — 응대 중 멈춤 방지
    next.on('close', () => {
      if (sx === next && !closed && phase === 'active') {
        sxReady = false; // 죽은 소켓으로 send 하지 않고 재연결까지 pending 큐에 쌓이도록(발화 앞부분 유실 방지)
        sxFails++;
        if (sxFails >= SX_MAX_FAILS) {
          // 상한 도달: 재시도만 멈춘다. endConversation 은 부르지 않는다 — 손님 앞에서 응대를 강제
          // 종료시키는 것보다, 안내원이 상황을 알고 판단하게 두는 편이 낫다(유인 데스크).
          sx = null;
          toHost({ type: 'status', message: `엔진 연결에 ${SX_MAX_FAILS}회 연속 실패해 자동 재연결을 멈췄습니다. 응대를 종료했다가 다시 시작해 주세요.` });
          broadcast(sessionId, { type: 'desk-engine-down' });
          return;
        }
        const delay = sxRetryDelay(sxFails);
        toHost({ type: 'status', message: `엔진 재연결 중… (${sxFails}/${SX_MAX_FAILS})` });
        setTimeout(() => { if (sx === next && !closed && phase === 'active') connectSx(); }, delay);
      }
    });
    try { if (old && old !== next) old.close(); } catch {}
  }

  function onSxMessage(raw) {
    let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
    const toks = ev.tokens || [];
    if (!toks.length) return;
    sxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
    if (phase === 'active') armForeignTimer(); // 어떤 발화든(안내원 한국어 포함) 들리면 무음 타이머 리셋
    let endHit = false, nonFinal = '', nonFinalTrans = '';
    langVotes.begin();
    for (const t of toks) {
      if (t.text === '<end>') { endHit = true; continue; }
      if (t.translation_status === 'translation') {
        langVotes.token(t); curSrc = langVotes.pick(curSrc);
        if (t.is_final) finalTrans += t.text; else nonFinalTrans += t.text;
      } else {
        // 입력 언어는 확정 토큰 다수결 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
        langVotes.token(t); curSrc = langVotes.pick(curSrc); // 동률에선 유지(방향 플립 방지)
        if (t.is_final) {
          finalText += t.text;
          if (t.text.trim()) srcToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]); // 신뢰도 기록
        } else nonFinal += t.text;
      }
    }
    const shownSrc = (finalText + nonFinal).trim();
    const shownTgt = (finalTrans + nonFinalTrans).trim();
    if (shownTgt) lastTrans = shownTgt;
    if (!curId && (shownSrc || shownTgt)) { curId = newId(); staffTm = { s: Date.now() }; } // 레이턴시: 발화 시작
    // 2채널 모드: 손님 언어로 감지된 진행 중 발화는 표시하지 않음(커밋 시 드랍될 누화의 이중 표시 방지)
    if (curId) {
      if (!staffOwns(curSrc)) liveSend(curId, {}, null, null);
      else liveSend(curId, { [targetKeyFor(curSrc)]: shownTgt }, shownSrc || null, null, curSrc || null);
    }
    if (endHit) { if (staffTm && staffTm.e == null) staffTm.e = Date.now(); commit(); } // 길이 기반 강제 확정 제거
  }

  /* ---- 여객 채널(2채널 프로토타입): 뷰어 태블릿 마이크 → 별도 soniox one_way(선택언어→ko) ----
     언어 힌트를 손님 언어로 고정해 인식 정확도를 높이고, side='left'/lang=손님언어로 결정적 귀속.
     누화 방어: ① 뷰어 근접 게이트(작은 소리는 무음 전송) ② crossDup(교차 중복 필터). */
  const guestConfig = () => ({
    ...baseConfig(lockedB && lockedB !== A ? [A, lockedB] : [A], A), // 여객 채널은 항상 one_way→ko
    // 자동 감지 중엔 여객 채널이 외국어를 소유 — 광역 힌트로 첫 발화 언어를 파악(ko 고정이면 감지 불가)
    language_hints: lockedB && lockedB !== A ? [lockedB] : (autoDetect ? GUEST_LANGS : [A]),
    translation: { type: 'one_way', target_language: A },
  });
  function closeGuest() {
    // gPending(리플레이 버퍼)은 비우지 않는다 — 언어 감지 직후 closeGuest→connectGuest 재체결에서
    // 진행 중 발화의 앞부분을 새 소켓에 재전송하기 위함(확정 시 guestCommit 이 비움).
    const old = gsx; gsx = null; gsxReady = false;
    gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes.reset(); gToks = [];
    if (old) { try { old.send(''); } catch {} try { old.close(); } catch {} }
  }
  function connectGuest() {
    if (closed || phase !== 'active' || !guestMicOn) return;
    const old = gsx;
    gsxReady = false;
    const next = openSonioxWs();
    gsx = next;
    next.on('open', () => {
      if (gsx !== next) return; // 구 소켓의 늦은 open 가드(connectSx 와 동일)
      try { next.send(JSON.stringify(guestConfig())); } catch {}
      gsxReady = true;
      // 리플레이: 마지막 확정 이후 프레임(최근 ~2초)을 재전송(버퍼 유지) — 재체결 중 발화 앞부분 복구
      for (const f of gPending) { try { next.send(f); } catch {} }
    });
    // 종료·소켓 교체 후 늦게 도착한 토큰 차단(다음 응대로 새는 문제 방지)
    next.on('message', (raw) => { if (gsx === next && phase === 'active') onGuestMsg(raw); });
    next.on('error', () => {});
    next.on('close', () => {
      if (gsx === next && !closed && phase === 'active' && guestMicOn) {
        gsxReady = false; // 재연결까지 gPending 큐에 쌓이도록(여객 발화 앞부분 유실 방지)
        gsxFails++;
        if (gsxFails >= SX_MAX_FAILS) {
          // 여객 채널만 죽은 경우 — 데스크(안내원) 채널은 그대로 두고 단일 채널로 계속 응대한다.
          gsx = null;
          toHost({ type: 'status', message: `여객 마이크 엔진이 ${SX_MAX_FAILS}회 연속 실패했습니다. 데스크 마이크만으로 계속됩니다.` });
          return;
        }
        const delay = sxRetryDelay(gsxFails);
        setTimeout(() => { if (gsx === next && !closed && phase === 'active' && guestMicOn) connectGuest(); }, delay);
      }
    });
    try { if (old && old !== next) old.close(); } catch {}
  }
  const guestCommit = () => {
    const id = gCurId, txt = stripFillers(gFinalText.trim()), gSrc = gCurSrc;
    const tgt = stripFillers((gFinalTrans.trim() || gLastTrans).trim());
    const toks = gToks; // 이 발화의 원문 토큰(신뢰도 포함)
    const tm = { ...(guestTm || {}), c: Date.now() }; // 레이턴시: s/e/c
    guestTm = null;
    gCurId = null; gFinalText = ''; gFinalTrans = ''; gLastTrans = ''; gCurSrc = ''; gLangVotes.reset(); gToks = [];
    gPending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외
    if (!id || !txt) { if (id) liveSend(id, {}, null, null, null, 'left'); return; } // 고스트(또는 추임새뿐인) 카드 제거
    // 자동 감지(Other languages): 손님은 여객 태블릿에 대고 말하므로 이 채널에서 감지되는 게 정상 경로
    lockDetected(gSrc);
    // 음량 중재: 발화 시간창에서 여객 마이크가 명백히 우세하면 실제 손님 발화로 보고 살린다
    const gLouder = volOwn('guest', (tm.s || tm.c - 4000) - 300, tm.c);
    // 언어 소유권: 한국어로 감지된 발화는 안내원 채널 소유 → 여객 마이크 누화로 드랍
    if (!guestOwns(gSrc) && gLouder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
    // 안내원 채널이 이미 확정한 문장과 유사 → 여객 마이크로 샌 누화, 드랍
    if (crossDupHit('guest', txt, tgt) && gLouder !== true) { chStats.crossDrops++; liveSend(id, {}, null, null, null, 'left'); return; }
    crossDupNote('guest', txt, tgt);
    // 고급옵션: 단독 응답어 기록 생략
    if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null, null, 'left'); return; }
    chStats.guest++;
    const out = tgt || txt;
    if (out && out === gLastCommitText && Date.now() - gLastCommitAt < 5000) return;
    gLastCommitText = out;
    gLastCommitAt = Date.now();
    upsertItem(id, { [A]: out }, txt, null, lockedB || null, 'left', toks, tm);
    if (tgt) polishCommit(id, A, txt, tgt); // 번역 다듬기(nano) — 손님 발화의 한국어 직역투 후교정
    if (confFix) maybeConfFix(id, toks, txt, gSrc, A); // 저신뢰 자동 교정(고급옵션) — 여객 채널
  };
  function onGuestMsg(raw) {
    let ev; try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (ev.error_code) return;
    const toks = ev.tokens || [];
    if (!toks.length) return;
    gsxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
    if (phase === 'active') armForeignTimer();
    let endHit = false, nonFinal = '', nonFinalTrans = '';
    gLangVotes.begin();
    for (const t of toks) {
      if (t.text === '<end>') { endHit = true; continue; }
      if (t.translation_status === 'translation') { gLangVotes.token(t); gCurSrc = gLangVotes.pick(gCurSrc); if (t.is_final) gFinalTrans += t.text; else nonFinalTrans += t.text; }
      else {
        gLangVotes.token(t); gCurSrc = gLangVotes.pick(gCurSrc);
        if (t.is_final) {
          gFinalText += t.text;
          if (t.text.trim()) gToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]); // 신뢰도 기록
        } else nonFinal += t.text;
      }
    }
    const shownSrc = (gFinalText + nonFinal).trim();
    const shownTgt = (gFinalTrans + nonFinalTrans).trim();
    if (shownTgt) gLastTrans = shownTgt;
    if (!gCurId && (shownSrc || shownTgt)) { gCurId = newId(); guestTm = { s: Date.now() }; } // 레이턴시: 발화 시작
    // 한국어(안내원 누화)로 감지된 진행 중 발화는 표시하지 않음
    if (gCurId) {
      if (!guestOwns(gCurSrc)) liveSend(gCurId, {}, null, null, null, 'left');
      else liveSend(gCurId, { [A]: shownTgt }, shownSrc || null, null, lockedB || null, 'left');
    }
    if (endHit) { if (guestTm && guestTm.e == null) guestTm.e = Date.now(); guestCommit(); } // 길이 기반 강제 확정 제거
  }
  // 여객 마이크 채널 on/off — 켜지면 응대 중일 때 즉시 엔진 연결, 꺼지면 단일 채널로 폴백.
  // fromWs 로 소유 소켓을 추적: 뷰어 재접속 시 구 소켓의 close 가 새 소켓의 채널을 끄지 않도록.
  // 공급원 2종: 뷰어 태블릿(desk-mic) / PC 호스트 직결(src=guestmic, _deskGuestFeed) — 호스트 공급 우선.
  let guestWs = null;
  let lastMic2 = false; // 뷰어에 알린 '호스트(PC) 여객 마이크 공급' 상태 — 변화 시에만 브로드캐스트
  const hostFed = () => !!(guestMicOn && guestWs && guestWs._deskGuestFeed);
  const pushMic2 = () => {
    const v = hostFed();
    if (v === lastMic2) return;
    lastMic2 = v;
    // on: 뷰어 태블릿은 자기 마이크 캡처를 멈추고 표출 전용으로 / off: (응대 중이면) 태블릿 마이크로 자동 복귀
    broadcast(sessionId, { type: 'desk-mic2', on: v });
  };
  const guestMic = (on, fromWs) => {
    if (on) {
      // PC 호스트가 여객 마이크를 직접 공급 중이면 뷰어 태블릿의 desk-mic 요청은 무시(호스트 공급 우선).
      // 소유 소켓이 이미 죽어 있으면(절전 등) 즉시 넘겨받게 readyState 를 함께 확인.
      if (guestWs && guestWs !== fromWs && guestWs._deskGuestFeed && !(fromWs && fromWs._deskGuestFeed) && guestWs.readyState === WebSocket.OPEN) return;
      guestWs = fromWs || guestWs;
    } else if (fromWs && guestWs && fromWs !== guestWs) return; // 소유자가 아닌(이전) 소켓의 해제는 무시
    if (guestMicOn === !!on) { pushMic2(); return; } // 소유권만 바뀐 경우(태블릿→PC)도 뷰어에 알림
    guestMicOn = !!on;
    const m = { type: 'desk-guest-mic', on: guestMicOn };
    toHost(m); broadcast(sessionId, m);
    gsxFails = 0; // 안내원이 직접 켠 것 = 재시도 의사 — 이전 장애의 실패 이력을 물려받지 않는다
    if (guestMicOn && phase === 'active') connectGuest();
    if (!guestMicOn) closeGuest();
    // 채널별 언어 고정 전환: 2채널이 되면 호스트 채널을 one_way(ko→손님 언어)로, 해제되면 two_way 로 재체결
    if (phase === 'active' && lockedB && lockedB !== A) { commit(); closeSx(); connectSx(); }
    pushMic2();
    toHost({
      type: 'status',
      message: guestMicOn
        ? `여객 마이크(${hostFed() ? 'PC 직결' : '태블릿'}) 연결 — 2채널(채널별 언어 고정, 단방향×2)로 동작합니다.`
        : '여객 마이크 해제 — 데스크 마이크 단일 채널(양방향)로 동작합니다.',
    });
  };

  ws.on('message', (data, isBinary) => {
    // 대기(idle) 중에는 오디오를 버림(STT 세션 없음 — 비용 0). 통역 중에만 soniox 로 전달.
    if (isBinary) {
      if (phase !== 'active') return;
      const r = noteVol('staff', data); // 음량 중재용 RMS 기록
      // 무음 타이머는 '토큰'뿐 아니라 '들리는 소리'로도 리셋 — 게이트/엔진 장애로 토큰이 안 와도
      // 손님·직원이 말하는 중이면 응대가 끊기지 않게 한다(2초 스로틀).
      if (r > 0.02 && Date.now() - lastVoiceArm > 2000) { lastVoiceArm = Date.now(); armForeignTimer(); }
      // 리플레이 버퍼: 마지막 확정 이후 프레임(최근 ~2초)을 유지 — 재체결(언어 감지·여객 마이크
      // 전환·엔진 재연결) 시 새 소켓에 재전송해 진행 중 발화의 앞부분 유실을 복구한다.
      pending.push(data); if (pending.length > 24) pending.shift();
      if (sxReady && sx) { try { sx.send(data); } catch {} }
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'stop') { closed = true; clearTimeout(foreignTimer); clearTimeout(warnTimer); closeSx(); closeGuest(); }
      else if (m.type === 'desk-start') { startConversation(String(m.lang || '').toLowerCase()); } // 호스트 수동 시작(언어 선택)
      else if (m.type === 'desk-reset-now') { endConversation(); } // 호스트 수동 '대기모드로' — 대화 종료·뷰어 터치화면 복귀
      else if (m.type === 'desk-guest-sens') { // 여객 태블릿 마이크 민감도 변경(호스트 고급 설정)
        const v = Number(m.value);
        if (Number.isFinite(v)) { guestSens = Math.min(100, Math.max(0, v)); sendGuestSens(); }
      }
      else if (m.type === 'dropAcks') { dropAcks = !!m.on; } // 고급옵션: 단독 응답어 생략 라이브 토글
      else if (m.type === 'confFix') { confFix = !!m.on; } // 고급옵션: 저신뢰 자동 교정 라이브 토글
      else if (m.type === 'desk-idle') { // 무음 자동 종료 시간 변경 — 데스크는 상시 캡처라 세션 중 변경을 허용
        const v = Number(m.value);
        if (Number.isFinite(v)) {
          deskIdleMs = Math.min(120000, Math.max(5000, v));
          if (phase === 'active') armForeignTimer(); // 진행 중이면 새 시간으로 타이머 재장전
          toHost({ type: 'status', message: `무음 자동 종료: ${deskIdleMs / 1000}초` });
        }
      }
      else if (m.type === 'wayfind-show') { // 호스트가 길안내 제안 승인 → 뷰어에 지도 표시
        if (pendingWayfind) {
          broadcast(sessionId, pendingWayfind);
          if (session && Array.isArray(session.wayfindLog) && session.wayfindLog.length) { session.wayfindLog[session.wayfindLog.length - 1].shown = true; saveSessions(session.id); }
          pendingWayfind = null;
        }
      }
      else if (m.type === 'wayfind-dismiss') { pendingWayfind = null; } // 제안 무시
      else if (m.type === 'wayfind-on') { wayfindOn = !!m.on; if (!wayfindOn) pendingWayfind = null; } // 길안내 지도 기능 on/off(라이브)
    } catch {}
  });
  ws.on('close', () => {
    const wasActive = phase === 'active';
    closed = true;
    clearTimeout(foreignTimer);
    clearTimeout(warnTimer);
    // 순서 중요: endConversation() 의 좀비 가드는 '등록 컨트롤러 = 나'일 때만 아카이브를 허용한다.
    // deskCtrl 을 먼저 지우면 자기 자신을 좀비로 판정해 응대 기록·뷰어 리셋이 전부 생략된다(회귀 이력).
    const isCur = deskCtrl.get(sessionId) === ctrl;
    if (wasActive && isCur) endConversation(); // 응대 중 호스트 이탈 → 기록 보존 + 뷰어를 터치 화면으로
    else { closeSx(); closeGuest(); }
    if (isCur) deskCtrl.delete(sessionId);
  });

  // 뷰어(손님)의 통역 시작/종료/연장/여객 마이크 요청을 이 파이프라인으로 전달받기 위한 컨트롤러 등록
  const ctrl = {
    start: startConversation,
    state: () => ({ phase, lang: lockedB || null }), // 데스크 현황판용(응대 중 여부·손님 언어)
    guestSens: () => guestSens, // 뷰어 접속 시 현재 여객 마이크 민감도 동기화용
    mic2: hostFed, // 뷰어 접속 시 '호스트(PC) 여객 마이크 공급 중' 동기화용 — true 면 뷰어는 표출 전용
    end: endConversation,
    keepalive: () => { if (phase === 'active') armForeignTimer(); },
    guestMic,
    feedGuest: (data, fromWs) => {
      if (phase !== 'active' || !guestMicOn) return; // 대기 중 여객 오디오는 버림(비용 0)
      if (guestWs && fromWs && fromWs !== guestWs) return; // 소유 태블릿 외 스트림 거절(두 태블릿 동시 desk-mic 시 오염 방지)
      const r = noteVol('guest', data); // 음량 중재용 RMS 기록
      if (r > 0.02 && Date.now() - lastVoiceArm > 2000) { lastVoiceArm = Date.now(); armForeignTimer(); } // 소리 기반 무음타이머 리셋
      // 리플레이 버퍼(마지막 확정 이후, 상한 ~2초) — 언어 감지·재연결로 소켓이 바뀌어도 발화 앞부분 복구
      gPending.push(data);
      if (gPending.length > 24) gPending.shift();
      if (gsxReady && gsx) {
        // 백프레셔: 엔진 쪽으로 못 내보내고 쌓이면 오래된 오디오 대신 현재 프레임을 버려 실시간 유지
        if (gsx.bufferedAmount > 262144) return;
        try { gsx.send(data); } catch {}
      }
    },
  };
  deskCtrl.set(sessionId, ctrl);

  // 승계 복구: 응대 도중 호스트가 새로고침하면 구 파이프라인은 (컨트롤러 불일치 가드로) 세션을 못 만져
  // 진행 중이던 items 가 아카이브되지 않은 채 남는다 → 여기서 '중단된 응대'로 보존하고 뷰어를 초기화.
  // (방치하면 다음 손님의 deskLog 한 건에 이전 손님 대화가 섞여 기록됨)
  if (session && Array.isArray(session.items) && session.items.length) {
    session.deskLog = session.deskLog || [];
    session.deskLog.push({ startedAt: null, endedAt: Date.now(), lang: (session.items.find((x) => x.lang && x.lang !== 'ko') || {}).lang || null, interrupted: true, items: session.items, stats: null });
    capDeskLog(session);
    session.items = [];
    saveSessions(session.id);
    broadcast(sessionId, { type: 'desk-reset' });
    broadcast(sessionId, { type: 'snapshot', items: [] });
    toHost({ type: 'status', message: '이전 호스트의 진행 중 응대를 기록에 보존하고 대기 모드로 초기화했습니다.' });
  }

  setMeta();
  toHost({ type: 'status', message: `데스크 대기 중 — 손님이 태블릿에서 언어를 선택하면 통역이 시작됩니다. (무음 ${deskIdleMs / 1000}초 시 자동 종료)` });
}
