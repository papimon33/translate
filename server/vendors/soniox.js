/* Soniox 실시간 STT — 연결(헤더 인증)·세션 context(용어집) 조립·용어 실검증·발화 언어 판정 */
import { WebSocket } from 'ws';
import { SONIOX_WS_URL, SONIOX_API_KEY } from '../config.js';
import { termsConfig } from '../store/index.js';
import { TERM_LANGS } from '../store/terms.js';

// Soniox 실시간 STT 연결 — 키는 연결 요청의 Authorization 헤더로 보낸다.
// start(config) 메시지의 api_key 는 2027-01-15 에 중단되므로 config 에는 키를 넣지 않는다.
export const openSonioxWs = () => new WebSocket(SONIOX_WS_URL, { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } });

// 데스크 모드 전용 general context — Soniox 에 "이 자리가 어떤 상황인지" 배경을 줘서
// 저빈도·동음이의 단어(예 喫煙室=きつえんしつ) 인식률을 끌어올린다. context.general = [{key,value}].
// 흡연실처럼 STT 가 자꾸 헷갈리는 단어는 value 에 일본어 표기를 괄호로 병기.
const DESK_GENERAL_CONTEXT = [
  { key: 'location', value: 'Airport information desk' },
  { key: 'airport', value: 'Gimpo International Airport' },
  { key: 'facilities', value: 'smoking room (喫煙室 / きつえんしつ), restroom, currency exchange, convenience store, subway station, boarding gate' },
];
// Soniox 세션 context 조립(통합 v3 entries 기반). langs=이 세션 활성 언어, opts.desk=데스크 세션 여부.
//  - mode 'pair'      : 활성 언어쌍 양방향 번역 + 인식
//  - mode 'inputOnly' : 외국어 표기 → 한국어(ko) 단방향 번역 + 인식 (약칭·오인식 교정)
//  - mode 'recognize' : 언어무관 인식 힌트만
//  - scope: '*' 아니면 그 언어가 활성일 때만 주입 / categoryScope: 데스크·일반세션 적용 여부
//  - 데스크 세션은 general(공항 안내데스크 배경)도 함께 주입 — 저빈도 단어 인식 보정.
//  - 폴백(en→ko) 없음: 명시된 언어 표기만 사용. 전체 한도(8,000토큰≈10,000자) 방어는 유지.
/* opts.target — 단방향(one_way) 세션의 타깃 언어. 주면 번역쌍을 'X→타깃' 방향만 만든다.
   이전에는 활성 언어 전 조합(4언어=12쌍/항목)을 만들어 ja→zh 처럼 그 세션에서 절대 쓰이지 않는
   쌍이 자리를 차지했고, context 가 한도(9500자)를 1.9배 초과해 뒤쪽 항목(항공사 번역쌍 전체)이
   잘려 'Jeju Air→제주에어' 같은 오역이 났다. 2026-07-29 세션 로그 분석 근거. */
export function buildSonioxContextRaw(langs, opts = {}) {
  const desk = !!opts.desk;
  const target = opts.target && TERM_LANGS.includes(opts.target) ? opts.target : null;
  const L = [...new Set((langs || []).filter((c) => TERM_LANGS.includes(c)))];
  if (!L.length) L.push('ko', 'en');
  const cs = termsConfig.categoryScope || {};
  const terms = new Set();
  const pairs = [];
  const seen = new Set();
  const addPair = (a, b) => {
    if (!a || !b || a === b) return;
    const k = a + '||' + b;
    if (!seen.has(k)) { seen.add(k); pairs.push({ source: a, target: b }); }
  };
  // 표기 결정: 한·영·일은 명시 표기만(비면 없음), 그 외 언어(zh 포함 미입력 시·es/fr/ru 등)는
  // 영어 표기로 폴백 — 어떤 세션 언어에서도 고유명사가 최소 영어 브랜드명으로 일관 번역되도록 보장.
  const nameFor = (names, lg) => {
    const v = String(names[lg] || '').trim();
    if (v) return v;
    if (lg === 'ko' || lg === 'en' || lg === 'ja') return '';
    return String(names.en || '').trim();
  };
  for (const e of termsConfig.entries || []) {
    if (!e || !e.names || !e.names.ko) continue;
    const scope = cs[e.category] || { desk: true, session: true };
    if (desk ? scope.desk === false : scope.session === false) continue; // 카테고리 적용대상(데스크 항공용어 제외 등)
    const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
    if (scoped && !e.scope.some((sl) => L.includes(sl))) continue;       // 언어 스코프
    if (e.mode === 'recognize') { const v = String(e.names.ko || '').trim(); if (v) terms.add(v); continue; }
    for (const lg of L) { const v = nameFor(e.names, lg); if (v) terms.add(v); } // 활성 언어 표기 → 인식 힌트
    const ko = String(e.names.ko || '').trim();
    if (e.mode === 'inputOnly') {
      if (!ko || !L.includes('ko')) continue;
      for (const lg of L) { if (lg === 'ko') continue; addPair(String(e.names[lg] || '').trim(), ko); } // 외국어 → ko 단방향(약칭은 폴백 없음)
    } else if (target) { // pair + 단방향 세션: 실제 번역 방향(X→타깃)만 생성
      for (const a of L) { if (a !== target) addPair(nameFor(e.names, a), nameFor(e.names, target)); }
    } else { // pair + 양방향(또는 타깃 미지정): 활성 언어 간 전 방향
      for (const a of L) for (const b of L) { if (a !== b) addPair(nameFor(e.names, a), nameFor(e.names, b)); }
    }
  }
  const ctx = {};
  if (desk && DESK_GENERAL_CONTEXT.length) ctx.general = DESK_GENERAL_CONTEXT; // 데스크 배경(공항 안내데스크)
  if (terms.size) ctx.terms = [...terms];
  if (pairs.length) ctx.translation_terms = pairs;
  return Object.keys(ctx).length ? ctx : null;
}
export function buildSonioxContext(langs, opts = {}) {
  const ctx = buildSonioxContextRaw(langs, opts);
  if (!ctx) return null;
  // 한도 방어: 초과 시 번역쌍부터, 다음 인식 힌트를 뒤에서부터 잘라낸다(전부 잘리면 경고만).
  // 초과분에 비례해 청크로 제거 — 대용량 업로드(수천 항목)여도 몇 번의 stringify 로 반드시 한도 안에 들어오고,
  // 항목 1개씩 pop×전체 재직렬화로 이벤트루프를 수초 막던 문제도 없음.
  let dropped = 0;
  for (let pass = 0; pass < 60; pass++) {
    const len = JSON.stringify(ctx).length;
    if (len <= 9500) break;
    const excess = len - 9500;
    const arr = (ctx.translation_terms && ctx.translation_terms.length) ? ctx.translation_terms : ctx.terms;
    if (!arr || !arr.length) break;
    const avg = Math.max(8, Math.floor(len / (((ctx.translation_terms || []).length + (ctx.terms || []).length) || 1)));
    const n = Math.min(arr.length, Math.max(1, Math.ceil(excess / avg)));
    arr.splice(-n);
    dropped += n;
    if (ctx.translation_terms && !ctx.translation_terms.length) delete ctx.translation_terms;
    if (ctx.terms && !ctx.terms.length) delete ctx.terms;
  }
  if (dropped > 0) console.warn(`[terms] Soniox context 한도 초과 — ${dropped}개 항목 잘림(langs=${(langs || []).join(',')}${opts.desk ? ',desk' : ''})`);
  return Object.keys(ctx).length ? ctx : null;
}

/* ---- 용어 설정 실검증: 저장된 설정을 실제 soniox 에 던져 언어쌍별 수락/거부 확인 ----
   글자수 추정(≈10,000자)은 토큰≠글자라 부정확 → 각 운영 언어쌍(ko↔L) context 로 soniox WS 를
   열어 config 만 보내고 수락/에러(용량초과 등)를 판정한 뒤 즉시 닫는다(오디오 미전송 → 과금 최소). */
export function validateSonioxPair(a, b, ctx) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} resolve(r); };
    let ws;
    try { ws = openSonioxWs(); }
    catch (e) { return resolve({ ok: false, error: String(e.message || e) }); }
    const timer = setTimeout(() => finish({ ok: true }), 3000); // 수락되면 오디오 대기로 무응답 → 통과
    ws.on('open', () => {
      try {
        ws.send(JSON.stringify({
          model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 24000, num_channels: 1,
          enable_language_identification: true, enable_endpoint_detection: true,
          language_hints: [a, b], translation: { type: 'two_way', language_a: a, language_b: b },
          ...(ctx ? { context: ctx } : {}),
        }));
      } catch (e) { finish({ ok: false, error: String(e.message || e) }); }
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.error_code || m.error_message) finish({ ok: false, error: `${m.error_code || ''} ${m.error_message || ''}`.trim() });
      else finish({ ok: true }); // 정상 응답(토큰/메타) → 수락
    });
    ws.on('error', (e) => finish({ ok: false, error: String((e && e.message) || e) }));
    ws.on('close', (code, reason) => finish(code === 1000 ? { ok: true } : { ok: false, error: `closed ${code} ${String(reason || '').slice(0, 80)}`.trim() }));
  });
}

/* 발화 언어 판정(양방향·채널 분리 공용). 예전엔 응답마다 비확정 토큰까지 다시 세서, 초기 오판(일본어 'スマートフォン…'을
   처음엔 한국어 '스마트폰…'으로 들음)이 수십 번 반복 집계돼 확정된 정답을 이겼다 — 카드가 '한국어 발화'로 저장되고 번역 칸(ja)에
   한국어 문장이 들어가 뷰어에 뒤집혀 보였다(2026-10-21 모노 양방향 측정에서 재현).
   우선순위: ① 확정 번역 토큰의 source_language — 엔진이 실제로 번역한 방향이라 카드의 번역 칸과 항상 맞는다
   ② 확정 원문 토큰 다수결 ③ 아직 확정이 없으면 이번 응답의 비확정 토큰 다수결(누적하지 않음). 동률이면 직전 판정 유지. */
export function langJudge() {
  let votes = {}, trSrc = '', resp = {};
  const lg = (x) => (x ? String(x).split('-')[0].toLowerCase() : '');
  const lead = (m, prev) => { let best = prev && m[prev] ? prev : ''; for (const k of Object.keys(m)) if (!best || m[k] > (m[best] || 0)) best = k; return best; };
  return {
    reset() { votes = {}; trSrc = ''; resp = {}; },
    begin() { resp = {}; }, // 응답 하나 시작 — 비확정 토큰은 응답마다 다시 오므로 그 응답 안에서만 센다
    token(t) {
      if (t.translation_status === 'translation') { if (t.is_final && t.source_language) trSrc = lg(t.source_language); return; }
      const l = lg(t.language);
      if (!l) return;
      if (t.is_final) votes[l] = (votes[l] || 0) + 1; else resp[l] = (resp[l] || 0) + 1;
    },
    pick(prev) {
      if (trSrc) return trSrc;
      if (Object.keys(votes).length) return lead(votes, prev);
      if (Object.keys(resp).length) return lead(resp, prev);
      return prev;
    },
  };
}
