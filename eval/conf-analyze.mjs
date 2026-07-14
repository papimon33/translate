/* 저신뢰 자동 교정(confFix) 임계 재튜닝용 분석 스크립트.
   저장된 전체 세션·데스크 응대 로그의 토큰 confidence(item.toks)를 훑어
   ① 분포(백분위·히스토그램) ② 트리거 규칙별 발동률을 세션별로 출력한다.

   왜 이 스크립트가 있나(2026-07-14 결정 근거 — PROJECT_NOTES '2026-07-14 (5)' 참고):
   - '단발 최소 conf' 트리거는 세션별 발동률 15%/24%/58% 로 편차 극심 → 폐기.
     soniox 는 한국어 어절 첫 음절·조사·언어 전환 경계에 정상 인식인데도 낮은 conf 를 준다.
   - 진짜 오인식은 저신뢰가 '연속'됨 → 규칙 C(연속 2+ <0.4) 채택(0%/0%/8% 로 안정).
   - 당시 표본은 전부 한국어 지배 발화 — 데스크 외국어 손님 발화가 쌓이면 이 스크립트로 재측정하고
     server.js 의 CONFFIX 상수를 조정할 것(rules 의 'PROD' 가 현행 규칙과 동기).

   사용법: 서버 실행 중에  node eval/conf-analyze.mjs [BASE] [ID] [PW]
           (기본 http://localhost:3000 admin/admin) */

const BASE = process.argv[2] || 'http://localhost:3000';
const ID = process.argv[3] || 'admin';
const PW = process.argv[4] || 'admin';

// ⚠ server.js CONFFIX 와 동기 유지 (수정 시 양쪽 함께)
const CONFFIX = { REAL_MIN: 3, RUN_CONF: 0.4, RUN_LEN: 2, EXTREME: 0.12, LOW: 0.55, NOISE_RATIO: 0.7 };

const isReal = (t) => /[\p{L}\p{N}]/u.test(String(t || '').trim());
const realConfs = (toks) => (toks || []).filter(([t, c]) => isReal(t) && typeof c === 'number').map(([, c]) => c);

// 비교용 트리거 규칙들 — PROD 가 현행(server.js confFixTrigger 와 동일 논리)
const rules = {
  'min<=0.35 (폐기안)': (cs) => Math.min(...cs) <= 0.35,
  'min<=0.15': (cs) => Math.min(...cs) <= 0.15,
  '연속2+ <0.4': (cs) => { let r = 0; for (const c of cs) { r = c < 0.4 ? r + 1 : 0; if (r >= 2) return true; } return false; },
  'PROD: 연속2+<0.4 OR min<=0.12 (+상한)': (cs) => {
    const lowRatio = cs.filter((c) => c < CONFFIX.LOW).length / cs.length;
    if (lowRatio > CONFFIX.NOISE_RATIO) return false;
    let r = 0;
    for (const c of cs) { r = c < CONFFIX.RUN_CONF ? r + 1 : 0; if (r >= CONFFIX.RUN_LEN) return true; }
    return Math.min(...cs) <= CONFFIX.EXTREME;
  },
};

const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ id: ID, password: PW }) });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
if (!cookie) { console.error('로그인 실패'); process.exit(1); }
const H = { Cookie: cookie };

const sessions = await fetch(BASE + '/api/sessions', { headers: H }).then((r) => r.json());
if (!Array.isArray(sessions)) { console.error('세션 조회 실패:', JSON.stringify(sessions).slice(0, 200)); process.exit(1); }

async function itemsOf(s) {
  const d = await fetch(`${BASE}/api/admin/logs/session/${s.id}`, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  let arr = (d && d.items) || [];
  if (s.pipeline === 'desk') {
    for (let i = 0; i < 200; i++) {
      const e = await fetch(`${BASE}/api/admin/logs/desk/${s.id}/${i}`, { headers: H }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (!e) break;
      arr = arr.concat(e.items || []);
    }
  }
  return arr;
}

const globalConfs = [];
console.log(`세션 ${sessions.length}개 스캔 중…\n`);
for (const s of sessions) {
  const items = await itemsOf(s);
  const withToks = items.filter((it) => (it.toks || []).length);
  if (!withToks.length) continue;
  const cnt = {}; for (const k in rules) cnt[k] = 0;
  let evalN = 0;
  const lowSamples = [];
  for (const it of withToks) {
    const cs = realConfs(it.toks);
    for (const c of cs) globalConfs.push(c);
    if (cs.length < CONFFIX.REAL_MIN) continue;
    evalN++;
    for (const k in rules) if (rules[k](cs)) cnt[k]++;
    if (lowSamples.length < 3 && Math.min(...cs) < 0.3) {
      const marked = it.toks.map(([t, c]) => (isReal(t) && typeof c === 'number' && c < CONFFIX.LOW ? `«${t}»` : t)).join('');
      lowSamples.push(marked.replace(/\n/g, ' ').slice(0, 70));
    }
  }
  if (!evalN) continue;
  console.log(`[${(s.title || '').slice(0, 24)}] ${s.pipeline}/${s.preset || '-'} — 평가발화 ${evalN}`);
  for (const k in rules) console.log(`  ${k}: ${cnt[k]} (${((cnt[k] / evalN) * 100).toFixed(0)}%)`);
  for (const m of lowSamples) console.log(`  예) ${m}`);
}

globalConfs.sort((a, b) => a - b);
if (globalConfs.length) {
  const pct = (p) => globalConfs[Math.min(globalConfs.length - 1, Math.floor(globalConfs.length * p))];
  console.log(`\n=== 전체 실단어 토큰 분포 (${globalConfs.length}개) ===`);
  console.log(`mean ${(globalConfs.reduce((a, b) => a + b, 0) / globalConfs.length).toFixed(3)} | min ${globalConfs[0]} | p5 ${pct(0.05)} | p10 ${pct(0.1)} | median ${pct(0.5)}`);
  for (const th of [0.12, 0.3, 0.4, 0.55, 0.7]) {
    const n = globalConfs.filter((c) => c < th).length;
    console.log(`  conf < ${th}: ${((n / globalConfs.length) * 100).toFixed(1)}%`);
  }
} else {
  console.log('\ntoks 포함 발화 없음 — 2026-07-14 이후 실발화 세션이 필요합니다.');
}
