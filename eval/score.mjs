/* KAC Translator 번역 정확성 채점기 (CLI)
 *
 * 입력: dataset.json(정답셋) + records.json(수집된 발화 결과)
 * 산출: 발화별 CER(원문 인식) + OpenAI 적합성 심사(번역) + 오류 귀속(STT/MT) + 집계 리포트.
 * 채점 로직은 eval/score_core.mjs 공유(서버 /api/eval/score 도 동일 로직 사용).
 *
 * 사용:
 *   node eval/score.mjs eval/records.json                 # 전체 채점(OpenAI 과금)
 *   node eval/score.mjs eval/records.json --dry           # CER·구조만, OpenAI 호출 없음(무료)
 *   node eval/score.mjs eval/records.json --out out.json  # 상세 결과 JSON 저장
 *   OPENAI_JUDGE_MODEL=gpt-5  node eval/score.mjs ...      # 심사 모델 지정(기본 gpt-5-mini)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreAll, LANG_NAME, CER_OK } from './score_core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const outIdx = args.indexOf('--out');
const OUT = outIdx >= 0 ? args[outIdx + 1] : null;
const recPath = args.find((a) => !a.startsWith('--') && a !== OUT);
if (!recPath) { console.error('사용법: node eval/score.mjs <records.json> [--dry] [--out result.json]'); process.exit(1); }

const JUDGE_MODEL = process.env.OPENAI_JUDGE_MODEL || 'gpt-5-mini';

function loadEnvKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    const m = txt.match(/^\s*OPENAI_API_KEY\s*=\s*(.+)\s*$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {}
  return null;
}
const API_KEY = loadEnvKey();
if (!DRY && !API_KEY) { console.error('OPENAI_API_KEY 없음 — --dry 로 실행하거나 .env 설정.'); process.exit(1); }

const dataset = JSON.parse(fs.readFileSync(path.join(HERE, 'dataset.json'), 'utf8'));
const rec = JSON.parse(fs.readFileSync(path.resolve(recPath), 'utf8'));
const records = Array.isArray(rec.records) ? rec.records : rec;

const R = await scoreAll(dataset, records, { dry: DRY, apiKey: API_KEY, model: JUDGE_MODEL, concurrency: 4 });

const fmt = (x, d = 3) => (x == null ? ' - ' : x.toFixed(d));
const dirLabel = { q: '질문(외국어→한)', a: '답변(한→외국어)' };
console.log(`\n=== KAC 번역 정확성 리포트 ===  records=${R.total}  valid=${R.valid}  ${DRY ? '(DRY: CER만)' : 'judge=' + JUDGE_MODEL}`);

console.log('\n[방향별]  n   CER(원문인식)  적합성  STT정상률  번역정상률');
for (const row of R.byDirection)
  console.log(`  ${(dirLabel[row.key] || row.key).padEnd(16)} ${String(row.n).padStart(3)}   ${fmt(row.cer).padStart(6)}       ${fmt(row.adq, 2).padStart(5)}   ${fmt(row.sttOk * 100, 0).padStart(4)}%     ${fmt(row.mtOk * 100, 0).padStart(4)}%`);

console.log('\n[언어별]  n   CER(원문인식)  적합성  STT정상률  번역정상률');
for (const row of R.byLang)
  console.log(`  ${(LANG_NAME[row.key] || row.key).padEnd(8)} ${String(row.n).padStart(3)}   ${fmt(row.cer).padStart(6)}       ${fmt(row.adq, 2).padStart(5)}   ${fmt(row.sttOk * 100, 0).padStart(4)}%     ${fmt(row.mtOk * 100, 0).padStart(4)}%`);

if (!DRY) {
  console.log('\n[오류 귀속]', Object.entries(R.faults).map(([k, v]) => `${k}=${v}`).join('  '),
    '\n  (mt=번역탓, stt=인식탓, stt_recovered=인식오류를 번역이 복원, ok=정상)');
  if (R.tags.length) console.log('\n[번역 오류 유형]', R.tags.map(([k, v]) => `${k}=${v}`).join('  '));
  if (R.trapAdq.length) { console.log('\n[함정유형별 적합성(낮을수록 취약)]'); for (const t of R.trapAdq) console.log(`  ${t.trap.padEnd(12)} ${fmt(t.adq, 2)}`); }
  console.log('\n[최악 사례 Top 8]');
  for (const s of R.worst) {
    console.log(`  · [${s.lang}/${s.direction}] ${s.scenario_id}  CER=${fmt(s.cer, 2)} 적합성=${s.judge?.adequacy ?? '-'} ${s.fault}${s.judge?.error_tags?.length ? ' <' + s.judge.error_tags.join(',') + '>' : ''}`);
    console.log(`     STT: ${s.stt}`);
    console.log(`     MT : ${s.mt}   (ref: ${s.ref})`);
    if (s.judge?.note) console.log(`     심사: ${s.judge.note}`);
  }
}
if (R.errored.length) { console.log(`\n[매칭 실패 ${R.errored.length}건]`); for (const e of R.errored.slice(0, 10)) console.log(`  · ${e.scenario_id}/${e.lang}: ${e.error}`); }

if (OUT) { fs.writeFileSync(path.resolve(OUT), JSON.stringify({ meta: { model: DRY ? null : JUDGE_MODEL }, scored: R.scored }, null, 2)); console.log(`\n상세 결과 저장: ${OUT}`); }
console.log('');
