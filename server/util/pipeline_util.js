/* 파이프라인 순수 로직 유틸 — server.js 에서 분리(security_util.js 와 동일 패턴).
   목적: 상태(세션·소켓·termsConfig)에 묶이지 않은 판정/정제 함수를 테스트에서 직접 임포트할 수 있게.
   여기 함수들은 부작용이 없어야 한다(파일·네트워크·전역 상태 접근 금지). */

/* ── KST 일자 버킷 ── */
export const kstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);

/* ── 저신뢰 자동 교정(confFix) 트리거 — 임계 근거는 PROJECT_NOTES 2026-07-14(5) ── */
export const CONFFIX = {
  REAL_MIN: 3, // 가드: 실단어(문자·숫자 포함 토큰) 최소 개수 — 인사·응답어 등 짧은 발화 제외
  RUN_CONF: 0.4, // 연속 저신뢰 판정 임계
  RUN_LEN: 2, // 이 개수 이상 '연속'되면 발동(단발 저신뢰는 구조적 편향이라 무시)
  EXTREME: 0.12, // 단발이라도 이 이하면 발동(극단값 — 3세션 기준 정상 최소값 0.05 존재하므로 GPT 거름망 필수)
  LOW: 0.55, // '저신뢰 단어' 마킹·비율 계산 임계(UI 하이라이트 0.6과 별도)
  NOISE_RATIO: 0.7, // 저신뢰 실단어 비율이 이걸 넘으면 발동 안 함(횡설수설/소음 — 교정 시 GPT 가 지어냄)
};
export const confFixReal = (toks) => (toks || []).filter(([t, c]) => typeof c === 'number' && /[\p{L}\p{N}]/u.test(String(t || '').trim()));
export function confFixTrigger(toks) {
  const real = confFixReal(toks);
  if (real.length < CONFFIX.REAL_MIN) return false;
  const lowN = real.filter(([, c]) => c < CONFFIX.LOW).length;
  if (lowN / real.length > CONFFIX.NOISE_RATIO) return false; // 상한 가드
  let run = 0;
  let minC = 1;
  for (const [, c] of real) {
    if (c < CONFFIX.RUN_CONF) { run++; if (run >= CONFFIX.RUN_LEN) return true; } else run = 0;
    if (c < minC) minC = c;
  }
  return minC <= CONFFIX.EXTREME;
}
// 저신뢰 구간을 «»로 마킹한 원문(토큰 원본 이어붙임 — 표시용 source 와 미세하게 다를 수 있음)
export const confFixMark = (toks) => (toks || [])
  .map(([t, c]) => (typeof c === 'number' && c < CONFFIX.LOW && /[\p{L}\p{N}]/u.test(String(t || '').trim()) ? `«${t}»` : t))
  .join('');

/* ── 간투사(음/어/uh)·단독 응답어 필터 ── */
const FILLER_NOISE_RE = /\b(?:u+m+|u+h+|uh+m+|hm+|mm+|mhm|e+r+m*|o+h+|a+h+|h+u+h+)\b|(?<![가-힣])(?:음+|어+|아+|으+음*|앗|핫|헉|흠+)(?![가-힣])|(?:え[ーっ]?と|えー+|あー+|うー+|んー+)|(?:嗯+|呃+|唔+)/gi;
// 소프트 간투사: 영어 yeah/yep/yup/y'know (발화 전체면 보존). 'well'은 실단어 의미가 있어 제외.
const FILLER_SOFT_RE = /\b(?:yeah|yep|yup|y'?know)\b/gi;
// 전체 발화 전용 잡음: 문장 중간에선 실단어일 수 있어 못 지우지만, '발화 전체'가 이것뿐이면 잡음 확정.
// (일본어 단독 あ/え/ん, 중국어 단독 啊/哦/唉 — 가나·한자 단어 내부에 흔해 부분 제거는 위험)
const FILLER_WHOLE_RE = /^(?:あ+|え+|ん+|は+ぁ*|啊+|哦+|唉+|嗯+)[\s。、.,!?！？…~〜]*$/;
// 단독 응답어(ACK): "네./Yes./Okay." 류 실제 대답 — 기본은 보존.
// 고급옵션 '단독 응답어 생략'을 켠 세션에서만 기록에서 제외(회의록 간소화용).
// 주의: 정보성 단답과 겹치는 단어는 넣지 않는다 — 'right'(방향 안내 "오른쪽입니다"),
// '글쎄요'(유보 의사 표시)는 생략되면 실질 내용이 유실돼 제외했다.
const ACK_WORDS = new Set([
  '네', '예', '넵', '응', '그래', '그래요', '맞아', '맞아요', '맞습니다', '알겠습니다', '알겠어요', '좋아요', '좋습니다',
  '아니', '아니요', '아니오', '아뇨',
  'yes', 'yeah', 'yep', 'no', 'nope', 'okay', 'ok', 'sure', 'alright', 'exactly', 'correct',
  'はい', 'ええ', 'いいえ', 'うん', 'そう', 'そうです', 'わかりました',
  '是', '是的', '好', '好的', '对', '不是', '不',
]);
export const isAckOnly = (text) => {
  const n = String(text || '').toLowerCase().replace(/[\s。、.,!?！？…~〜'"]+/g, '');
  return !!n && ACK_WORDS.has(n);
};
function cleanFillerSpacing(s) {
  return String(s)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.!?。、！？…])/g, '$1')       // 구두점 앞 공백 제거
    .replace(/([,、])\s*(?=[,、])/g, '')            // 연속 쉼표 정리
    .replace(/^[\s,.、。，！？!?：；…·\-]+/, '')       // 앞쪽에 남은 구두점/공백 제거(전각 포함)
    .replace(/\s{2,}/g, ' ')
    .trim();
}
export function stripFillers(text) {
  const original = String(text == null ? '' : text);
  if (!original.trim()) return original;
  if (FILLER_WHOLE_RE.test(original.trim())) return ''; // 발화 전체가 잡음(단독 あ/啊 등) → 카드째 드롭
  let s = original.replace(FILLER_NOISE_RE, ' ');       // ① 순수 잡음 — 항상 제거
  const soft = s.replace(FILLER_SOFT_RE, ' ');          // ② 소프트 간투사 — 내용이 남을 때만
  if (/[\p{L}\p{N}]/u.test(cleanFillerSpacing(soft))) s = soft;
  s = cleanFillerSpacing(s);
  if (/^[a-z]/.test(s)) s = s[0].toUpperCase() + s.slice(1); // 앞 간투사 제거로 소문자 시작이면 첫 글자 복원
  return s;
}

/* ── GPT 번역 출력 정제 ── */
export function sanitizeTranslation(out) {
  let s = String(out || '').trim();
  if (!s) return '';
  // 코드블록 제거
  s = s.replace(/^```[a-zA-Z]*\s*/, '').replace(/```$/, '').trim();
  // 문두 머리말 제거: "…(옮기면/번역하면) 다음과 같습니다:" 류 접두를 통째로 잘라냄
  s = s.replace(/^[^\n]*?다음과\s*같습니다\s*[:：.]?\s*/, '');
  // 화살표(원문 → 번역) 형식이면 화살표 뒤(번역)만 취함
  if (/→|->/.test(s)) {
    s = s
      .split(/\n+/)
      .map((ln) => {
        const parts = ln.split(/\s*(?:→|->)\s*/);
        return parts.length > 1 ? parts[parts.length - 1] : ln;
      })
      .join('\n');
  }
  const DROP = /^\s*(?:참고|제안|주의|노트|note)\s*[:：]/i; // 줄 전체가 메타면 버림
  const META_TAIL = /\s*[\(（]?\s*(?:참고|제안|주의|노트|note)\s*[:：].*$/i; // 줄 중간부터 시작하는 메타(괄호 포함) 꼬리 제거
  const lines = s
    .split(/\n+/)
    .map((ln) => ln.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()) // 불릿/번호 제거
    .map((ln) => (DROP.test(ln) ? '' : ln.replace(META_TAIL, '').trim()))
    .filter(Boolean);
  s = lines.join('\n').trim();
  // 끝에 붙는 메타 괄호주석(번역/의역/정중체 등 키워드 포함)만 제거
  s = s.replace(/\s*[\(（][^)）]*(번역|의역|정중체|매끄럽|자연스럽|문장\s*단위|note|참고)[^)）]*[\)）]\s*$/i, '').trim();
  return s;
}

/* ── 공개 뷰어의 데스크 제어(desk-start/end/mic) 남용 가드 ──
   start/end/mic 는 유료 엔진 체결(context 재과금)을 직접 유발하므로 소켓당·세션당 분당 횟수 제한 +
   start/end 는 세션당 0.8초 간격. 정상 손님 조작(언어 선택, 종료 후 재선택, 재접속 시 desk-mic
   재동기화)은 걸리지 않는 수준. micOnly=true 면 간격 제한 제외.
   holder(ws/room)에 _deskCtl 상태를 기록한다 — now 주입으로 테스트 가능. */
export function deskCtlAllowed(ws, room, micOnly, now = Date.now()) {
  const bump = (holder, max) => {
    let st = holder._deskCtl;
    if (!st || now - st.t > 60000) st = holder._deskCtl = { t: now, n: 0 };
    return ++st.n <= max;
  };
  if (!bump(ws, 20)) return false;
  if (room) {
    if (!bump(room, 40)) return false;
    if (!micOnly) {
      if (now - (room.lastDeskStartEnd || 0) < 800) return false;
      room.lastDeskStartEnd = now;
    }
  }
  return true;
}
