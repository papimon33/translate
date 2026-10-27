/* 채점 코어(순수 로직) — CLI(score.mjs)와 서버(/api/eval/score)가 공유.
   외부 의존 없음. OpenAI 호출은 fetch(글로벌) 사용. */

export const CER_OK = 0.10;   // 이하면 원문 인식 정상
export const ADQ_OK = 4;      // 이상(5점 만점)이면 번역 정상
export const TAG_VOCAB = ['proper_noun', 'gate_code', 'flight_code', 'number', 'currency', 'time', 'omission', 'addition', 'mistranslation', 'grammar', 'register', 'untranslated'];
export const LANG_NAME = { en: '영어', zh: '중국어', ja: '일본어', es: '스페인어', fr: '프랑스어', pt: '포르투갈어', ar: '아랍어', ko: '한국어' };

/* ---- CER: 정규화 후 문자 단위 편집거리 / 정답 길이 ---- */
export function normalize(s) {
  return (s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, '')                 // 아랍어 발음기호 제거
    .replace(/\s/g, '')                                    // 공백 제거(띄어쓰기 차이 무시)
    .replace(/[.,!?;:¿¡'"“”‘’·…、。！？，،؟\-()\[\]]/gu, ''); // 구두점 제거
}
export function levenshtein(a, b) {
  const s = [...a], t = [...b];
  const n = s.length, m = t.length;
  if (!n) return m; if (!m) return n;
  let prev = Array.from({ length: m + 1 }, (_, i) => i);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[m];
}
export function cer(gold, hyp) {
  const g = normalize(gold), h = normalize(hyp);
  if (!g.length) return h.length ? 1 : 0;
  return levenshtein(g, h) / g.length;
}

/* ---- OpenAI 적합성 심사 ---- */
export async function judge({ srcText, srcLang, refText, candText, tgtLang }, { apiKey, model }) {
  const sys = '너는 통역 품질 평가관이다. 원문의 의미가 후보 번역에 정확히 전달되었는지 평가한다. ' +
    '모범 번역(reference)은 참고용이며, 표현이 달라도 의미가 정확하면 높은 점수를 줘라. ' +
    '고유명사·게이트번호·편명·숫자·금액·시간의 오류는 치명적으로 취급하라. ' +
    'JSON만 출력: {"adequacy":1-5,"fluency":1-5,"critical":true|false,"error_tags":[...],"note":"한 줄 사유"}. ' +
    `error_tags 는 다음에서만 고른다: ${TAG_VOCAB.join(', ')}.`;
  const user =
    `원문 언어: ${LANG_NAME[srcLang] || srcLang}\n원문: ${srcText}\n\n` +
    `목표 언어: ${LANG_NAME[tgtLang] || tgtLang}\n모범 번역(reference): ${refText}\n후보 번역(system): ${candText}\n\n` +
    'adequacy=의미 전달 정확도, fluency=목표 언어 유창성. 위 JSON 형식으로만 답하라.';

  const body = { model, messages: [{ role: 'system', content: sys }, { role: 'user', content: user }], response_format: { type: 'json_object' } };
  if (/^gpt-5/.test(model)) { body.reasoning_effort = 'low'; body.max_completion_tokens = 400; }
  else { body.temperature = 0; body.max_tokens = 400; }

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const txt = j.choices?.[0]?.message?.content || '{}';
  let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { adequacy: null, fluency: null, error_tags: [], note: 'parse_error' }; }
  return {
    adequacy: Number(parsed.adequacy) || null,
    fluency: Number(parsed.fluency) || null,
    critical: !!parsed.critical,
    error_tags: Array.isArray(parsed.error_tags) ? parsed.error_tags.filter((t) => TAG_VOCAB.includes(t)) : [],
    note: String(parsed.note || '').slice(0, 200),
  };
}

/* ---- 정답 매칭 ---- */
export function goldFor(dataset, r) {
  const sc = dataset.scenarios.find((s) => s.id === r.scenario_id);
  if (!sc) return null;
  if (r.direction === 'q') return { srcLang: r.lang, tgtLang: 'ko', goldSrc: sc.question.src[r.lang], refText: sc.question.ko_ref, traps: sc.traps };
  return { srcLang: 'ko', tgtLang: r.lang, goldSrc: sc.answer.ko_src, refText: sc.answer.ref[r.lang], traps: sc.traps };
}

/* ---- 병렬 실행(동시성 제한) ---- */
export async function pool(items, fn, n) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length || 1) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

/* ---- 발화 1건 채점 ---- */
export async function scoreRecord(dataset, r, { dry, apiKey, model }) {
  const g = goldFor(dataset, r);
  if (!g) return { ...r, error: 'unknown scenario_id: ' + r.scenario_id };
  if (!g.goldSrc || !g.refText) return { ...r, error: `정답 누락(scenario=${r.scenario_id}, lang=${r.lang})` };
  const cerVal = cer(g.goldSrc, r.stt);
  let jr = null;
  if (!dry) { try { jr = await judge({ srcText: g.goldSrc, srcLang: g.srcLang, refText: g.refText, candText: r.mt, tgtLang: g.tgtLang }, { apiKey, model }); } catch (e) { jr = { error: String(e.message || e) }; } }
  const sttOk = cerVal <= CER_OK;
  const adq = jr && jr.adequacy;
  const mtOk = adq != null ? adq >= ADQ_OK : null;
  let fault = 'ok';
  if (dry) fault = sttOk ? 'ok' : 'stt';
  else if (mtOk === null) fault = 'unknown';
  else if (sttOk && !mtOk) fault = 'mt';
  else if (!sttOk && mtOk) fault = 'stt_recovered';
  else if (!sttOk && !mtOk) fault = 'stt';
  return { ...r, gold_src: g.goldSrc, ref: g.refText, traps: g.traps, cer: +cerVal.toFixed(3), stt_ok: sttOk, judge: jr, mt_ok: mtOk, fault };
}

/* ---- 전체 채점 + 집계 (서버 리포트용 구조화 결과) ---- */
export async function scoreAll(dataset, records, { dry, apiKey, model, concurrency = 4 }) {
  const scored = await pool(records, (r) => scoreRecord(dataset, r, { dry, apiKey, model }), concurrency);
  const valid = scored.filter((s) => !s.error);
  const errored = scored.filter((s) => s.error);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

  const group = (keyFn) => {
    const g = {};
    for (const s of valid) { const k = keyFn(s); (g[k] ||= []).push(s); }
    return Object.entries(g).map(([k, arr]) => ({
      key: k, n: arr.length,
      cer: mean(arr.map((x) => x.cer)),
      adq: mean(arr.map((x) => x.judge?.adequacy).filter((v) => v != null)),
      sttOk: arr.filter((x) => x.stt_ok).length / arr.length,
      mtOk: arr.filter((x) => x.mt_ok === true).length / (arr.filter((x) => x.mt_ok != null).length || 1),
    })).sort((a, b) => a.key.localeCompare(b.key));
  };

  const faults = {};
  for (const s of valid) faults[s.fault] = (faults[s.fault] || 0) + 1;
  const tags = {};
  for (const s of valid) for (const t of (s.judge?.error_tags || [])) tags[t] = (tags[t] || 0) + 1;
  const trap = {};
  for (const s of valid) for (const t of (s.traps || [])) { (trap[t] ||= []).push(s.judge?.adequacy); }
  const trapAdq = Object.entries(trap).map(([k, arr]) => ({ trap: k, adq: mean(arr.filter((v) => v != null)) })).sort((a, b) => (a.adq ?? 9) - (b.adq ?? 9));
  const worst = [...valid].filter((s) => s.judge?.adequacy != null || s.cer > CER_OK)
    .sort((a, b) => ((a.judge?.adequacy ?? 5) - (b.judge?.adequacy ?? 5)) || (b.cer - a.cer)).slice(0, 8);

  return {
    total: records.length, valid: valid.length,
    byDirection: group((s) => s.direction),
    byLang: group((s) => s.lang),
    faults, tags: Object.entries(tags).sort((a, b) => b[1] - a[1]),
    trapAdq, worst, errored, scored,
  };
}
