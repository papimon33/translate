/* 실시간 번역(soniox) 파이프라인 — 단방향/양방향·채널 분리·자동 언어 잠금·실시간 TTS·저신뢰 교정.
   handleHost(realtime/host.js)가 연결마다 runSoniox(h) 를 호출한다. h = 연결 컨텍스트(구 handleHost 클로저 값). */
import { SONIOX_API_KEY, SONIOX_LANGS, CARTESIA_API_KEY, SX_MAX_FAILS, sxRetryDelay } from '../config.js';
import { saveSessions, recordTts } from '../store/index.js';
import { newId } from '../store/sessions.js';
import { getRoom, broadcast, broadcastAudio, hasAudioListener, sendAudioToHosts, noteTts, isSelfEcho } from '../realtime/rooms.js';
import { openSonioxWs, buildSonioxContext, langJudge } from '../vendors/soniox.js';
import { cartesiaVoiceId, cartesiaTTSStream, cartesiaWarmup } from '../vendors/cartesia.js';
import { echoNorm, echoMatch } from '../util/security_util.js';
import { isAckOnly, stripFillers } from '../util/pipeline_util.js';

/* ---------- Soniox stt-rt-v5 (전사) -> gpt 번역 [테스트] ---------- */
export function runSoniox(h) {
  const { ws, sessionId, session, pipeline, inLang, idle, toHost, liveSend, upsertItem, polishCommit, maybeConfFix, bumpIdle } = h;
  if (!SONIOX_API_KEY) {
    toHost({ type: 'status', message: 'SONIOX_API_KEY 미설정 — soniox 모드 사용 불가' });
    return;
  }
  // 엔드포인트 튜닝(테스트용, UI에서 선택). 문서 기본값: sensitivity 0, maxDelay 2000, latency 0.
  const sens = Number(ws._sxSens);
  const maxDelay = Number(ws._sxMaxDelay);
  const latency = Number(ws._sxLatency);
  // Soniox 자체 실시간 번역(기본). GPT 경유 없이 전사+번역 토큰을 한 스트림으로 받음.
  //  단방향(one): 타깃 1개 / 양방향(two): A↔B. 지원 언어 ko/en/ja/zh 로 한정.
  // 입력 언어 미지정(auto) 시 기본 언어 힌트. 2026-07-29 세션에서 힌트에 없던 스페인어의
  // 첫 12발화가 번역되지 않고 원문이 그대로 표시된 사례가 있어 실제 취항·관광 언어를 포함한다.
  // (용어 표기가 없는 언어는 영어 표기로 폴백되므로 context 크기는 거의 늘지 않는다)
  const L4 = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'de', 'ru'];
  const okL = (c) => SONIOX_LANGS.includes(c); // 선택지는 soniox 지원 언어 전체
  const sxMode = ws._sxMode === 'two' ? 'two' : 'one';
  const sxTarget = okL(ws._sxTarget) ? ws._sxTarget : 'en';
  const sxA = okL(ws._sxA) ? ws._sxA : 'ko';
  const sxB = okL(ws._sxB) ? ws._sxB : 'en';
  const canTts = !!(ws._perms && ws._perms.tts); // 음성 재생 권한(없으면 켜는 요청을 무시 — 화면은 버튼을 숨긴다)
  let ttsOn = ws._tts === '1' && !!CARTESIA_API_KEY && canTts;
  let gender = ws._gender === 'm' ? 'm' : 'f'; // 음성 성별(출력언어별 보이스 자동 선택)
  const diar = ws._diar === '1'; // 화자 구분(speaker diarization)
  if (ws._tts === '1' && !CARTESIA_API_KEY) {
    toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 출력(TTS) 비활성. 서버 환경변수를 확인하세요.' });
  }
  // 자동 감지(입력 언어 미지정) 세션에서 첫 발화로 확정한 입력 언어.
  // 잠기면 힌트·context 를 그 언어로 좁혀 1회 재연결한다(아래 lockDetected).
  let lockedIn = null;
  const buildConfig = () => ({
    model: 'stt-rt-v5',
    audio_format: 'pcm_s16le',
    sample_rate: 24000,
    num_channels: 1,
    enable_language_identification: true,
    enable_endpoint_detection: true,
    enable_speaker_diarization: diar, // 화자 구분(토글)
    // API 허용범위로 클램프: sensitivity -1~1, maxDelay 500~3000, latency 0~3
    endpoint_sensitivity: Number.isFinite(sens) ? Math.min(1, Math.max(-1, sens)) : 0,
    max_endpoint_delay_ms: Number.isFinite(maxDelay) ? Math.min(3000, Math.max(500, maxDelay)) : 2000,
    endpoint_latency_adjustment_level: Number.isFinite(latency) ? Math.min(3, Math.max(0, Math.round(latency))) : 0,
    language_hints: sxMode === 'two' ? [sxA, sxB] : (inLang ? [inLang] : (lockedIn ? [sxTarget, lockedIn] : L4)),
    translation: sxMode === 'two'
      ? { type: 'two_way', language_a: sxA, language_b: sxB }
      : { type: 'one_way', target_language: sxTarget },
    client_reference_id: 'u:' + (ws._userId || 'anon') + '|p:live', // 유저별+파이프라인(실시간 번역) 사용량 집계
    // 고유명사/번역 설정 주입 — 이 세션에서 쓰이는 언어의 표기·번역쌍만 조립.
    // 자동 감지에서 언어가 잠히면(lockedIn) 그 언어로 좁혀 용어집이 잘리지 않게 한다.
    ...((() => {
      const langs = sxMode === 'two' ? [sxA, sxB] : [sxTarget, ...(inLang ? [inLang] : (lockedIn ? [lockedIn] : L4))];
      const c = buildSonioxContext(langs, sxMode === 'two' ? {} : { target: sxTarget });
      return c ? { context: c } : {};
    })()),
  });

  let sx = null;          // 현재 엔진 소켓(예기치 않은 끊김 시 자동 재연결)
  let sxReady = false;
  let sxClosed = false;   // 사용자 중지/유휴 종료 — 재연결 금지
  let pending = [];
  /* 입력 언어 자동 감지 → 1회 재연결(데스크 lockDetected 와 동일 패턴).
     auto 세션은 광역 힌트(L4 8언어)로 시작하는데, 이 상태로 세션이 끝까지 가면
     ① 힌트가 흩어져 인식 정확도가 떨어지고 ② context 가 커져 용어집 뒤쪽이 잘린다
     (2026-07-29 세션: 번역쌍 전량 삭제 + 스페인어 첫 12발화 미번역).
     첫 확정 발화의 언어로 잠그고 [타깃, 감지언어] 로 좁혀 한 번만 재연결한다.
     재연결 1회는 context 재과금 1회뿐 — 주기적 재연결(2026-07-15 삭제)과 달리 무해하다. */
  const lockDetected = (src) => {
    if (lockedIn || inLang || sxMode === 'two' || sxClosed || idle.stopped) return;
    if (!src || src === sxTarget || !SONIOX_LANGS.includes(src)) return; // 타깃 언어면 좁힐 이유 없음
    lockedIn = src;
    relockPending = true; // close 핸들러가 '실패'로 세지 않고 즉시 재연결하게
    toHost({ type: 'status', message: `입력 언어 감지: ${src} — 해당 언어로 인식 설정을 좁혀 재연결합니다.` });
    try { sx && sx.close(); } catch {} // 새 config(좁힌 힌트·용어집)로 다시 붙는다
  };
  let relockPending = false; // 재감지로 의도적으로 닫는 중인지
  // (삭제됨) 무음 시 '조용한 재연결'(인식 컨텍스트 플러시, 2026-07-13) — 재연결마다 config 의
  // context(용어집, input_text_tokens $4/1M)가 재청구돼 Soniox 비용의 71%를 차지했던 원인이라 제거.
  // 오인식 고착은 confFix(저신뢰 자동 교정)가 완화한다. 상세: PROJECT_NOTES 2026-07-15.
  idle.close = () => { sxClosed = true; try { sx && sx.close(); } catch {} };
  // 번역 방향 정보 — 뷰어(모바일)가 언어 표시에 사용
  // 채널 분리(양방향 통역을 채널별 단방향으로) — 엔진은 단방향이지만 세션은 a↔b 양방향으로 보여야
  // 뷰어가 '내 언어/상대 언어'로 정렬하고 자기 언어 음성만 듣는다.
  const pairLangs = String(ws._pair || '').split(',').filter((c) => okL(c));
  const sxInfo = pairLangs.length === 2
    ? { mode: 'two', target: sxTarget, a: pairLangs[0], b: pairLangs[1], split: true }
    : { mode: sxMode, target: sxTarget, a: sxA, b: sxB };
  if (session) { session.sxInfo = sxInfo; saveSessions(session.id); }
  broadcast(sessionId, { type: 'meta', sxInfo });
  let curId = null;     // 진행 중 발화 카드 id
  let finalText = '';   // 전사(원문) 확정 누적
  let finalTrans = '';  // Soniox 번역(타깃) 확정 누적
  let lastTrans = '';   // 마지막으로 표시한 번역(폴백용)
  let curSrc = '';      // 감지된 입력 언어(토큰 다수결 — 첫 단어 오인식 교정)
  const langVotes = langJudge(); // 발화 언어 판정(확정 번역의 source_language → 확정 원문 다수결)
  let curSpeaker = '';  // 현재 발화 화자(diarization)
  let lastCommitText = ''; // 직전 확정 텍스트(연속 중복 카드 방지)
  let lastCommitted = null; // { id, key, out, at } — 화자 변경 커밋 직후 늦게 도착한 번역 꼬리를 직전 카드에 귀속
  let lastCommitAt = 0;    // 직전 확정 시각 — 중복 판정은 5초 창 안에서만
  let sawSpeaker = false;  // 엔진이 화자 정보를 한 번이라도 반환했는지(진단용)
  let spkNotified = false; // 화자 감지 1회 알림
  let noSpkWarned = false; // 화자 미반환 1회 경고
  let srcToks = [];        // 원문 확정 토큰 [[text, confidence], ...] — 저신뢰 하이라이트 + 추후 평가용
  let dropAcks = ws._dropAcks === '1'; // 고급옵션: 단독 응답어(네/Yes/Okay) 기록 생략(라이브 토글 가능)
  let confFix = ws._confFix === '1'; // 고급옵션: 저신뢰 자동 교정(라이브 토글 가능)

  const targetKeyFor = (src) => (sxMode === 'two' ? (src === sxA ? sxB : sxA) : sxTarget);
  // 채널 분리: 반대 채널의 언어가 이 채널에서 인식되면 샌 소리(스피커→마이크, 옆 사람 핀마이크)로 보고 버린다.
  // 채널마다 언어가 정해져 있어야 쓸 수 있는 결정적 필터 — 같은 언어끼리(dropLang 없음)는 아래 교차 중복이 맡는다.
  // (버릴 언어 = 그 채널의 번역 타깃 — 내 채널은 상대 언어로 번역하므로 상대 언어 발화가 들리면 샌 소리)
  const dropLang = okL(ws._drop) ? ws._drop : null;
  const splitCh = ws._role === 'me' || ws._role === 'them';
  let bleedDrops = 0;
  // 교차 채널 중복(같은 세션의 다른 채널 연결과 공유): 8초 안에 반대 채널이 비슷한 문장을 확정했으면 샌 소리
  const chCommits = () => { const r = getRoom(sessionId); if (!r.chCommits) r.chCommits = []; return r.chCommits; };
  const crossChannelDup = (txt, tgt) => {
    const arr = chCommits();
    const now = Date.now();
    while (arr.length && now - arr[0].at > 8000) arr.shift();
    const n = echoNorm(txt), nt = echoNorm(tgt || '');
    return arr.some((e) => e.src !== ws._src && (
      (n.length >= 4 && (echoMatch(n, e.n) || (e.nt.length >= 4 && echoMatch(n, e.nt)))) ||
      (nt.length >= 4 && (echoMatch(nt, e.n) || (e.nt.length >= 4 && echoMatch(nt, e.nt))))
    ));
  };
  const noteChannelCommit = (txt, tgt) => { chCommits().push({ n: echoNorm(txt), nt: echoNorm(tgt || ''), at: Date.now(), src: ws._src }); };
  const spkLabel = (s) => (s != null && s !== '' ? String(s) : null); // 화자 번호만 전송(표시는 클라가 아이콘+번호)

  // ---- 실시간 TTS: 확정된 번역을 문장 단위로 잘라 즉시 합성(발화가 끝나기 전에도 흘려보냄) ----
  let ttsPending = '';      // 확정됐지만 아직 합성하지 않은 번역 텍스트
  let ttsLang = sxTarget;   // 현재 합성 언어(타깃)
  const SENT_END = /[.!?。！？…]/;
  // 마침표가 문장 끝이 아닌 약어들(영어 타깃에서 오탐 방지)
  const ABBR = new Set(['mr','mrs','ms','dr','prof','sr','jr','st','vs','etc','inc','ltd','co','corp','no','vol','fig','dept','univ','gov','gen','col','sgt','lt','capt','cmdr','rev','hon','pres','approx','mt','ave','rd','blvd','ph','messrs']);
  // 합성을 순차 직렬화: 짧은 뒷문장이 먼저 합성 완료돼 먼저 재생되는 순서 뒤바뀜 방지
  let ttsChain = Promise.resolve();
  let utterTm = null; // 진행 중 발화의 레이턴시 타임스탬프 { s, e, (tq, ta 는 발화 중 TTS 시) }
  // 레이턴시 로그: 카드(id)의 tm 에 시각 병합 — 커밋 전(카드 미생성)이면 utterTm 에 보류.
  // 첫 발생만 기록(문장 여러 개여도 '첫 오디오까지'가 체감 지연).
  const stampTm = (forId, key) => {
    const t = Date.now();
    const it = session && Array.isArray(session.items) ? session.items.find((x) => x.id === forId) : null;
    if (it) { if (!it.tm || it.tm[key] == null) { it.tm = { ...(it.tm || {}), [key]: t }; saveSessions(session && session.id); } }
    else if (utterTm && forId === curId && utterTm[key] == null) utterTm[key] = t;
  };
  const speakTts = (text, forId) => {
    const tx = (text || '').trim();
    if (!ttsOn || !tx) return;
    if (!/[\p{L}\p{N}]/u.test(tx)) return; // 문장부호만 있으면 스킵(Cartesia 400 방지)
    const lang = ttsLang;                  // 호출 시점 타깃 언어 고정
    // 듣는 사람(이 호스트 재생 또는 '듣기' 켠 뷰어)이 없으면 만들지 않는다 — 예전엔 아무도 안 들어도 줄을 세워 합성해
    // 줄이 밀리면 나중에 '듣기'를 켠 사람에게 이전 문장이 몰아서 나갔고, Cartesia 요금도 헛되이 나갔다(2026-10-25)
    const listening = () => !!ws._audioOut || hasAudioListener(sessionId, lang);
    if (!listening()) return;
    const voiceId = cartesiaVoiceId(lang, gender);
    noteTts(sessionId, tx); // 자기음성(에코) 필터에 등록 — 재입력 시 인식 결과를 버림
    // 뷰어(음성 듣기 구독자) + 호스트(TTS 켠 경우)에게 재생. 재입력은 AEC + 에코 필터로 차단.
    let firstAudio = false;
    ttsChain = ttsChain.then(() => {
      if (!listening()) return undefined; // 줄에서 차례가 왔을 때 듣던 사람이 모두 껐으면 건너뜀
      if (forId) stampTm(forId, 'tq'); // 합성 요청 시각 — 직렬 큐 대기 후, 실제 요청 직전(ta−tq=순수 합성 지연)
      recordTts(pipeline === 'desk' ? 'desk' : 'live', tx.length); // 파이프라인별 자체 사용량
      return cartesiaTTSStream(tx, voiceId, lang, (b64) => {
        if (!firstAudio) { firstAudio = true; if (forId) stampTm(forId, 'ta'); } // 첫 오디오 청크 시각
        broadcastAudio(sessionId, b64, lang);
        if (ws._audioOut) sendAudioToHosts(sessionId, b64, lang);
      });
    }).catch(() => {});
  };
  const flushTtsSentences = () => {
    if (!ttsOn) return;
    const buf = ttsPending;
    const out = [];
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const ch = buf[i];
      if (!SENT_END.test(ch)) continue;
      if (ch === '.') {
        const next = buf[i + 1];
        if (next === undefined) break;        // 버퍼 끝의 마침표 → 약어/문장끝 모호, 더 기다림(commit이 처리)
        if (next === '.') continue;           // 줄임표(...) 일부
        if (/[0-9]/.test(next)) continue;     // 소수점 3.14
        let j = i - 1; while (j >= 0 && /[A-Za-z]/.test(buf[j])) j--;
        const word = buf.slice(j + 1, i);     // 마침표 앞 알파벳 덩어리
        if (word.length === 1) continue;      // 이니셜(J.) / e.g.·i.e. 조각
        if (ABBR.has(word.toLowerCase())) continue; // Dr. Mr. etc.
      }
      let end = i + 1;
      while (end < buf.length && /["'”’)\]]/.test(buf[end])) end++; // 닫는 따옴표/괄호 포함
      out.push(buf.slice(start, end));
      start = end;
      i = end - 1;
    }
    ttsPending = buf.slice(start);
    for (const s of out) speakTts(s, curId);
  };

  // 현재 누적분을 한 문장으로 확정 (GPT 호출 없음)
  const commit = () => {
    const id = curId, txt = stripFillers(finalText.trim()), src = curSrc, spk = curSpeaker;
    const tgt = stripFillers((finalTrans.trim() || lastTrans).trim());
    const toks = srcToks;               // 이 발화의 원문 토큰(신뢰도 포함)
    const tm = { ...(utterTm || {}), c: Date.now() }; // 레이턴시: s(첫 토큰)/e(<end>)/c(확정)
    utterTm = null;
    const tail = ttsPending;            // 종결부호 없이 남은 마지막 조각
    const hadFinal = !!finalTrans.trim(); // 발화 중 확정 번역이 흘러갔는지
    curId = null; finalText = ''; finalTrans = ''; lastTrans = ''; curSrc = ''; curSpeaker = ''; ttsPending = ''; langVotes.reset(); srcToks = [];
    pending = []; // 리플레이 버퍼: 확정된 발화의 오디오는 재전송 대상에서 제외(발화 경계에서 비움)
    // 화자 구분 켰는데 엔진이 화자 정보를 한 번도 안 줬으면 1회 안내(진단)
    if (diar && !sawSpeaker && !noSpkWarned) { noSpkWarned = true; toHost({ type: 'status', message: '화자 구분: 엔진이 화자 정보를 반환하지 않음(번역/엔드포인트와 동시 사용 시 발생 가능)' }); }
    if (!id || !txt) { if (id) liveSend(id, {}, null, null); return; } // 비확정만 있던(또는 잡음뿐인) 고스트 카드 제거
    // 고급옵션: 단독 응답어(네/Yes/Okay 단독 발화) 기록 생략
    if (dropAcks && isAckOnly(txt)) { liveSend(id, {}, null, null); return; }
    // TTS 자기음성 재입력(에코) → 확정하지 않고 화면 표시도 제거
    if (isSelfEcho(sessionId, txt)) { liveSend(id, {}, null, null); return; }
    // 채널 분리: 반대 채널 언어(샌 소리) 또는 반대 채널이 방금 확정한 같은 문장 → 버림
    if (dropLang && src === dropLang) { bleedDrops++; liveSend(id, {}, null, null); return; }
    if (splitCh && crossChannelDup(txt, tgt)) { bleedDrops++; liveSend(id, {}, null, null); return; }
    if (splitCh) noteChannelCommit(txt, tgt);
    const out = tgt || txt;
    // 직전 카드와 동일한 내용이 '5초 안에' 반복되면 중복(에코)으로 스킵 — 시간이 지난 의도적 반복 발화는 허용
    if (out && out === lastCommitText && Date.now() - lastCommitAt < 5000) return;
    lastCommitText = out;
    lastCommitAt = Date.now();
    const target = targetKeyFor(src);
    upsertItem(id, { [target]: out }, txt, spkLabel(spk), src || null, undefined, toks, tm); // lang=발화 언어 — 뷰어가 내 말/상대 말 정렬
    lastCommitted = { id, key: target, out, at: Date.now() }; // 커밋 직후 늦게 도착하는 번역 꼬리 귀속용
    lockDetected(src); // 자동 감지: 첫 확정 발화의 언어로 힌트·용어집을 좁혀 1회 재연결
    if (tgt) polishCommit(id, target, txt, tgt); // 번역 다듬기(nano) — 직역투 후교정(비동기 카드 교체)
    if (confFix) maybeConfFix(id, toks, txt, src, target); // 저신뢰 자동 교정(고급옵션)
    // 실시간 TTS: 발화 중 문장 단위로 이미 흘려보냈고, 여기선 남은 꼬리만 합성.
    //  재입력은 브라우저 AEC(마이크 경로) + 서버 에코 텍스트 필터(시스템 캡처·기기 간 경로)로 차단.
    // 출력 언어로 말한 발화는 읽어 줄 번역이 없다 — 방금 한 말을 그대로 되읽지 않는다
    if (ttsOn && !(sxMode === 'one' && src === sxTarget && !tgt)) {
      ttsLang = target;
      const tl = tail.trim();
      if (tl) speakTts(tl, id);                   // 종결부호 없이 남은 번역 꼬리
      else if (!hadFinal) speakTts(out, id);      // 발화 중 합성된 게 없으면(번역 미확정) 전체 합성
    }
  };

  // 엔진 연결(끊기면 자동 재연결 — 이전에는 재연결이 없어 '진행 중'처럼 보이며 무음이 지속됐음)
  // 재연결은 지수 백오프 + 연속 실패 상한: config 거부·쿼터 초과처럼 즉시 닫히는 상황에서
  // 800ms 무한 재시도하면 재연결마다 context(input_text_tokens)가 재과금되므로 8회에서 중지한다.
  let sxFails = 0; // 토큰 수신 시 0 으로 리셋 — 정상 세션의 간헐적 끊김은 누적되지 않음
  function connectEngine() {
    if (sxClosed || idle.stopped) return;
    const cur = openSonioxWs();
    sx = cur;
    cur.on('open', () => {
    if (sx !== cur) return;
    const config = buildConfig(); // 재감지로 언어가 잠혔으면 좁혀진 힌트·context 로 재생성됨
    try { cur.send(JSON.stringify(config)); } catch {} // config 먼저
    sxReady = true;
    // 리플레이: '마지막 확정 이후' 프레임(최근 ~2초)을 새 소켓에 재전송 — 연결 대기 중 큐잉뿐
    // 아니라, 죽은 구 소켓으로 이미 나갔던(=Soniox 가 못 들은) 진행 중 발화의 앞부분도 복구한다.
    for (const f of pending) { try { cur.send(f); } catch {} }
    toHost({ type: 'status', message: `엔진 연결됨 (Soniox stt-rt-v5 · ${sxMode === 'two' ? `양방향 ${sxA}↔${sxB}` : `단방향→${sxTarget}`}${ttsOn ? ' · TTS on' : ''}, sens=${config.endpoint_sensitivity}, maxDelay=${config.max_endpoint_delay_ms}ms, lat=${config.endpoint_latency_adjustment_level})` });
    // TTS 연결 워밍업 + 키/보이스 검증(첫 음성 지연 단축)
    if (ttsOn) {
      const wLang = sxMode === 'two' ? 'ko' : sxTarget;
      cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then((r) => toHost({ type: 'status', message: r.ok ? '음성(Cartesia) 준비됨' : ('음성 준비 실패: ' + r.error) }));
    }
    bumpIdle();
  });
  cur.on('message', (raw) => {
    if (sx !== cur) return; // 교체된 구 소켓의 늦은 토큰 무시
    let ev;
    try { ev = JSON.parse(raw.toString()); } catch { return; }
    if (ev.error_code) { toHost({ type: 'status', message: `Soniox 오류 ${ev.error_code}: ${ev.error_message || ''}`.slice(0, 160) }); return; }
    const toks = ev.tokens || [];
    if (!toks.length) return;
    bumpIdle();
    sxFails = 0; // 실제 토큰 수신 = 정상 연결 — 실패 카운터 리셋
    let endHit = false;
    let nonFinal = '';      // 비확정 전사(원문) — 매 응답마다 새로 구성
    let nonFinalTrans = ''; // 비확정 번역(타깃)
    langVotes.begin();
    for (const t of toks) {
      if (t.text === '<end>') { endHit = true; continue; }
      // 화자 정보는 원문/번역 토큰 어디서 와도 캡처(진단 + 표시용)
      if (diar && t.speaker != null && t.speaker !== '') {
        sawSpeaker = true;
        if (!spkNotified) { spkNotified = true; toHost({ type: 'status', message: '화자 구분 활성 — 화자 ' + t.speaker + ' 감지됨' }); }
      }
      if (t.translation_status === 'translation') {
        if (t.is_final) {
          // 화자 변경 커밋 직후: 새 원문 토큰이 오기 전에 도착한 번역 꼬리는 직전(방금 확정된) 발화의
          // 번역이다 — 새(빈) 발화에 붙이면 남의 번역으로 시작하므로 직전 카드에 이어붙인다.
          if (!curId && !finalText && lastCommitted && Date.now() - lastCommitted.at < 4000) {
            lastCommitted.out += t.text;
            upsertItem(lastCommitted.id, { [lastCommitted.key]: lastCommitted.out });
            continue;
          }
          langVotes.token(t); curSrc = langVotes.pick(curSrc); // 엔진이 번역한 방향이 가장 확실
          finalTrans += t.text;
          ttsLang = targetKeyFor(curSrc); // 현재 타깃 언어로 합성
          ttsPending += t.text;           // 문장 단위 실시간 TTS 큐
        } else nonFinalTrans += t.text;
      } else {
        // 전사(원문) 토큰 (translation_status: none | original | undefined)
        // 입력 언어는 첫 토큰이 아니라 '다수결'로 — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정
        langVotes.token(t); curSrc = langVotes.pick(curSrc); // 동률에선 유지(방향 플립 방지)
        // 화자 변경 시: 누적된 발화가 있으면 먼저 확정하고 새 화자로 시작
        if (diar && t.speaker != null && t.speaker !== '' && t.is_final && curSpeaker && String(t.speaker) !== String(curSpeaker) && finalText.trim()) commit();
        if (diar && t.speaker != null && t.speaker !== '') curSpeaker = t.speaker;
        if (t.is_final) {
          finalText += t.text;
          // 확정 토큰의 신뢰도 기록(2자리 반올림) — 저신뢰 단어 하이라이트 + 추후 인식 품질 평가
          if (t.text.trim()) srcToks.push([t.text, typeof t.confidence === 'number' ? Math.round(t.confidence * 100) / 100 : null]);
        } else nonFinal += t.text;
      }
    }
    flushTtsSentences(); // 완성된 문장은 즉시 합성(발화 종료 기다리지 않음)
    const shownSrc = (finalText + nonFinal).trim();
    const shownTgt = (finalTrans + nonFinalTrans).trim();
    if (shownTgt) lastTrans = shownTgt;
    if (!curId && (shownSrc || shownTgt)) { curId = newId(); utterTm = { s: Date.now() }; }
    if (curId) {
      // 타깃=번역(주 텍스트), 원문은 source 로 동시 표시.
      // 출력 언어로 말한 발화(예: 한국어 회의를 한국어로 기록)는 엔진이 번역하지 않는다 — 원문이 곧 표시 문장.
      // 비워 두면 화면이 확정 때까지 '번역 중…'으로 흐리게 남는다(확정 commit 은 원래 원문으로 폴백).
      const sameLang = sxMode === 'one' && curSrc === sxTarget && !shownTgt;
      if (dropLang && curSrc === dropLang) liveSend(curId, {}, null, null); // 샌 소리로 보이는 동안은 감춤(언어 판정이 바뀌면 다시 뜸)
      else liveSend(curId, { [targetKeyFor(curSrc)]: sameLang ? shownSrc : shownTgt }, shownSrc || null, spkLabel(curSpeaker), curSrc || undefined);
    }
    // 발화 종료(<end>) 또는 과도하게 길면 확정
    if (endHit) { if (utterTm && utterTm.e == null) utterTm.e = Date.now(); commit(); }
  });
  cur.on('error', (e) => { if (sx === cur) toHost({ type: 'status', message: 'Soniox 오류: ' + (e && e.message || e) }); });
  cur.on('close', () => {
    if (sx !== cur) return;
    sxReady = false; // 끊긴 소켓으로 send 하지 않도록(이전엔 true 로 남아 조용히 버려졌음)
    if (!sxClosed && !idle.stopped) {
      // 언어 재감지로 우리가 의도해 닫은 경우는 '실패'가 아니다 — 백오프·8회 상한을 건드리지 않고
      // 즉시 새 config 로 재연결한다(그 사이 발화는 pending 리플레이 버퍼가 복구).
      if (relockPending) {
        relockPending = false;
        connectEngine();
        return;
      }
      sxFails++;
      if (sxFails >= SX_MAX_FAILS) { // 연결 직후 반복 종료 — 재시도할수록 과금만 누적되므로 명시적으로 중지
        idle.stopped = true;
        toHost({ type: 'idle-stop' });
        toHost({ type: 'status', message: '엔진 연결이 반복 실패해 번역을 중지했습니다. 잠시 후 다시 시작해 주세요.' });
        return;
      }
      const delay = sxRetryDelay(sxFails);
      toHost({ type: 'status', message: '엔진 재연결 중…' });
      setTimeout(() => { if (sx === cur && !sxClosed && !idle.stopped) connectEngine(); }, delay);
    } else {
      toHost({ type: 'status', message: '엔진 연결 종료 (Soniox)' });
    }
  });
  }
  connectEngine();

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      // 항상 리플레이 버퍼에 적재(마지막 확정 시 비움, 상한 ~2초) — 재연결 시 새 소켓에 재전송해
      // 백오프/재체결 동안의 발화 앞부분 유실을 복구한다. 연결 전 큐 역할도 겸한다.
      pending.push(data); if (pending.length > 24) pending.shift();
      if (sxReady && sx) { try { sx.send(data); } catch {} }
      return;
    }
    try {
      const m = JSON.parse(data.toString());
      if (m.type === 'stop') {
        sxClosed = true;
        gracefulEngineStop();
      } else if (m.type === 'dropAcks') { // 고급옵션: 단독 응답어 생략 라이브 토글
        dropAcks = !!m.on;
      } else if (m.type === 'confFix') { // 고급옵션: 저신뢰 자동 교정 라이브 토글
        confFix = !!m.on;
      } else if (m.type === 'tts') {
        // 녹음 중 TTS 토글: 합성 on/off + 이 기기(호스트) 재생 여부. local=false 면 '뷰어에게만'(합성은 하되 호스트로 안 보냄)
        ws._audioOut = !!m.on && m.local !== false;
        ttsOn = !!m.on && !!CARTESIA_API_KEY && canTts;
        if (m.gender === 'm' || m.gender === 'f') gender = m.gender;
        if (!!m.on && !CARTESIA_API_KEY) toHost({ type: 'status', message: 'CARTESIA_API_KEY 미설정 — 음성 재생을 사용할 수 없습니다.' });
        if (ttsOn) { const wLang = sxMode === 'two' ? 'ko' : sxTarget; cartesiaWarmup(cartesiaVoiceId(wLang, gender), wLang).then(() => {}).catch(() => {}); }
      }
    } catch {}
  });
  ws.on('close', () => { sxClosed = true; gracefulEngineStop(); });

  // 마지막 발화 보존: 즉시 close 하면 finalize 결과를 받을 기회가 없어 "말 끝내고 2초 안에 중지"한
  // 마지막 문장이 화면에 보였다가 기록에서 사라졌다. finalize('') 요청 후 1초간 토큰을 계속 수신
  // (<end> 도착 시 정상 commit)하고, 그래도 남은 확정분은 강제 commit 한 뒤 닫는다.
  function gracefulEngineStop() {
    const cur = sx;
    if (!cur) return;
    try { cur.send(''); } catch {}
    setTimeout(() => {
      try { if (curId && finalText.trim()) commit(); } catch {}
      try { cur.close(); } catch {}
    }, 1000);
  }
}
