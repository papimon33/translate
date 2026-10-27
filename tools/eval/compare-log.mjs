/* 세션 로그 ↔ 원본 스크립트 대조 — TTS 발표 음성을 세션에 흘려보낸 뒤, STT 가 얼마나 정확했는지 채점.
 *
 * 왜 정렬이 필요한가: STT 는 스크립트와 문장 경계가 다르게 끊긴다(한 문장이 2카드로 쪼개지거나
 * 두 문장이 한 카드로 합쳐짐). 그래서 1:1 대응을 가정하지 않고,
 *   ① 전체 텍스트를 이어붙여 총 CER(문자 오류율) — 경계와 무관한 '진짜 인식 정확도'
 *   ② 스크립트 문장별로 STT 스트림에서 최적 구간을 찾아 정렬(순차 탐욕) — 어느 문장이 깨졌는지
 *   ③ 핵심 용어(외래어) 개별 적중 — 용어집 등록 효과 측정
 * 을 각각 낸다.
 *
 * 사용:
 *   1) 관리자 로그에서 세션 JSON 을 받는다:
 *      curl -b cookie.txt 'http://HOST/api/admin/logs/session/<세션ID>' > log.json
 *      (또는 관리자 페이지 로그에서 대화 전문을 복사해 { "items": [{ "source": "..." }] } 형태로 저장)
 *   2) node tools/eval/compare-log.mjs log.json slot
 *
 * 출력: 콘솔 리포트 + eval/compare-log.out.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// ---- 정규화·유사도 ----
const norm = (s) => String(s || '').replace(/[.,!?·…"'’“”()\[\]]/g, '').replace(/\s+/g, ' ').trim();
const bare = (s) => norm(s).replace(/\s/g, '');
function lev(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const cer = (ref, hyp) => { const a = bare(ref), b = bare(hyp); return a.length ? lev(a, b) / a.length : (b.length ? 1 : 0); };

// ---- 입력 ----
const [, , logPath, scriptId] = process.argv;
if (!logPath || !scriptId) {
  console.error('사용: node tools/eval/compare-log.mjs <세션로그.json> <slot|ai>');
  process.exit(1);
}
const { scripts } = JSON.parse(fs.readFileSync(path.join(DIR, 'demo-scripts.json'), 'utf8'));
const sc = scripts.find((s) => s.id === scriptId);
if (!sc) { console.error(`❌ 스크립트 없음: ${scriptId} (가능: ${scripts.map((s) => s.id).join(', ')})`); process.exit(1); }

const log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
// items[].source = STT 원문. source 가 없으면 texts 의 첫 값(번역만 남은 경우) 사용.
const items = (Array.isArray(log.items) ? log.items : Array.isArray(log) ? log : [])
  .map((it) => (it && (it.source || (it.texts && Object.values(it.texts)[0]))) || '')
  .map((t) => String(t).trim())
  .filter(Boolean);
if (!items.length) { console.error('❌ 로그에 발화(items)가 없습니다.'); process.exit(1); }

// ---- ① 전체 CER (문장 경계 무관) ----
const refAll = sc.lines.join(' ');
const hypAll = items.join(' ');
const totalCer = cer(refAll, hypAll);

// ---- ② 문장별 정렬(순차 탐욕): 스크립트 문장마다 STT 스트림에서 최적 구간 탐색 ----
const rows = [];
let pos = 0; // 다음 탐색 시작 인덱스
for (const line of sc.lines) {
  let best = { cer: 1, from: pos, to: pos, text: '' };
  // 최대 4카드까지 이어붙여 비교(쪼개진 문장 흡수). 시작점은 pos 부터 소폭 전진 허용.
  for (let from = pos; from < Math.min(items.length, pos + 3); from++) {
    let acc = '';
    for (let to = from; to < Math.min(items.length, from + 4); to++) {
      acc = acc ? acc + ' ' + items[to] : items[to];
      const c = cer(line, acc);
      if (c < best.cer) best = { cer: c, from, to, text: acc };
    }
  }
  const missed = (sc.terms || []).filter((t) => bare(line).includes(bare(t)) && !bare(best.text).includes(bare(t)));
  rows.push({ ref: line, hyp: best.text, cer: +best.cer.toFixed(3), cards: best.cer < 0.6 ? best.to - best.from + 1 : 0, missed });
  if (best.cer < 0.6) pos = best.to + 1; // 매칭 성공 → 다음 문장은 그 뒤부터
}

// ---- ③ 용어 적중 ----
// 카드 경계와 무관하게 판정: 문장이 두 카드로 쪼개지면서 단어가 잘린 경우(히스|토릭)를
// 미인식으로 오판하지 않도록, 전체 STT 를 이어붙인 텍스트에서 등장 횟수를 센다.
const countIn = (hay, needle) => {
  const h = bare(hay), n = bare(needle);
  if (!n) return 0;
  let c = 0, i = 0;
  while ((i = h.indexOf(n, i)) !== -1) { c++; i += n.length; }
  return c;
};
const termRows = (sc.terms || []).map((t) => {
  const inScript = countIn(refAll, t);
  const inStt = countIn(hypAll, t);
  return { term: t, script: inScript, stt: inStt, ok: inStt >= inScript };
});

// ---- 리포트 ----
console.log(`\n대조: ${sc.title} (${sc.id})`);
console.log(`스크립트 ${sc.lines.length}문장 · STT 카드 ${items.length}개`);
console.log('='.repeat(66));
console.log(`\n■ 전체 인식 정확도(문장 경계 무관)  CER ${(totalCer * 100).toFixed(1)}%  → 정확도 약 ${((1 - totalCer) * 100).toFixed(1)}%\n`);

console.log('■ 문장별 (CER 10% 이하 ✓ / 그 외 ✗)');
let ok = 0, split = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  const good = r.cer <= 0.10;
  if (good) ok++;
  if (r.cards > 1) split++;
  const mark = good ? '✓' : '✗';
  console.log(`\n${String(i + 1).padStart(2)} ${mark} CER ${(r.cer * 100).toFixed(0)}%${r.cards > 1 ? `  [카드 ${r.cards}개로 쪼개짐]` : ''}${r.missed.length ? `  놓친 용어: ${r.missed.join(', ')}` : ''}`);
  if (!good || r.missed.length || r.cards > 1) {
    console.log(`   원본: ${r.ref}`);
    console.log(`   인식: ${r.hyp || '(매칭 실패 — 누락 추정)'}`);
  }
}

console.log('\n' + '='.repeat(66));
console.log('■ 핵심 용어 적중');
for (const t of termRows) console.log(`  ${t.ok ? '✓' : '✗'} ${t.term.padEnd(14)} 스크립트 ${t.script}회 → 인식 ${t.stt}회`);

const termOk = termRows.filter((t) => t.ok).length;
console.log('\n' + '='.repeat(66));
console.log(`요약: 문장 ${ok}/${rows.length} 통과 · 전체 CER ${(totalCer * 100).toFixed(1)}% · 용어 ${termOk}/${termRows.length} 적중 · 쪼개진 문장 ${split}개`);
console.log(`카드 수 ${items.length} vs 스크립트 ${sc.lines.length} → ${items.length > sc.lines.length ? `${items.length - sc.lines.length}개 초과(분절 발생)` : items.length < sc.lines.length ? `${sc.lines.length - items.length}개 부족(병합/누락)` : '일치'}`);

fs.writeFileSync(path.join(DIR, 'compare-log.out.json'), JSON.stringify({ script: sc.id, totalCer, rows, terms: termRows, sttCards: items.length }, null, 2));
console.log('\n상세 → eval/compare-log.out.json');
