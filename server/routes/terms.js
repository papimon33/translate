/* 용어(고유명사/번역 설정) 라우트 — 관리자 오번역 검사·적중 분석 / 설정 열람·수정·실검증 */
import { OPENAI_API_KEY, REFINE_MODEL, SONIOX_API_KEY } from '../config.js';
import { sessions, termsConfig, setTermsConfig, persistTermsConfig } from '../store/index.js';
import { TERM_LANGS, TERM_CATEGORIES, DEFAULT_SERVED_LANGS, sanitizeCatScope, normalizeTermsConfig } from '../store/terms.js';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { reasoningEffort } from '../vendors/openai.js';
import { buildSonioxContextRaw, validateSonioxPair } from '../vendors/soniox.js';
import { logErr } from '../metrics.js';

export function registerTermsAdminRoutes(app) {
  /* ---- 관리자: 오탈자·오번역 검사 — 최근 대화의 원문·번역 쌍을 GPT 로 단어 단위 대조 검수 ----
     문장 전체가 아니라 개별 단어 단위로 오탈자(맞춤법·깨진 표기)·잘못 번역된 고유명사/시설명/전문용어를
     찾아 용어 설정(translation_terms) 후보로 반환. */
  app.post('/api/admin/terms-suggest', requireAdmin, async (req, res) => {
    if (!OPENAI_API_KEY) return res.status(400).json({ error: 'OPENAI_API_KEY 미설정' });
    // sessionIds 지정 시 해당 세션(일반 대화 + 데스크 응대 로그)만 검사, 미지정 시 최근 전체
    const bq = req.body || {};
    const wanted = Array.isArray(bq.sessionIds) && bq.sessionIds.length ? new Set(bq.sessionIds.map(String)) : null;
    const pairs = [];
    const sorted = [...sessions].filter((s) => !wanted || wanted.has(s.id)).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    for (const s of sorted) {
      const items = [
        ...(Array.isArray(s.items) ? s.items : []),
        ...(Array.isArray(s.deskLog) ? s.deskLog.flatMap((e) => e.items || []) : []), // 데스크 응대 기록 포함
      ];
      for (const it of items) {
        if (!it || !it.source || !it.texts) continue;
        const tx = Object.entries(it.texts).find(([, v]) => v && v !== it.source);
        if (!tx) continue;
        pairs.push(`[${tx[0]}] ${String(it.source).slice(0, 180)} => ${String(tx[1]).slice(0, 180)}`);
        if (pairs.length >= 200) break;
      }
      if (pairs.length >= 200) break;
    }
    if (pairs.length < 3) return res.json({ checked: pairs.length, suggestions: [] });
    const existing = (termsConfig.entries || [])
      .map((e) => TERM_LANGS.filter((lg) => e.names && e.names[lg]).map((lg) => e.names[lg]).join('/'))
      .filter(Boolean).join(', ');
    const sys =
      '너는 공항 안내 통역 품질 검수자다. 아래 "원문 => 기계번역" 쌍 목록을 문장 전체가 아니라 단어 단위로 대조하여, 개별 단어의 오류만 찾아라. ' +
      '검출 대상은 두 가지다: (1) 오탈자 — 맞춤법 오류·깨진 표기·잘못된 글자가 섞인 단어, (2) 잘못 번역된 단어 — 고유명사·시설명·전문용어가 원문과 다르게 옮겨졌거나 대화마다 다르게 번역된 경우. ' +
      '각 오류 항목은 반드시 정확히 하나의 단어(또는 「제1여객터미널」처럼 한 덩어리로 취급되는 용어) 여야 한다. 문장 전체의 어색함·문체·어순·의역 여부는 무시한다. ' +
      '반드시 JSON 하나만 출력한다: ' +
      '{"suggestions":[{"source":"원문의 해당 단어","target":"올바른 단어","wrong":"현재 잘못된 단어","lang":"외국어 쪽 언어코드(en/ja/zh/es/fr/pt/ar) — 목록의 [코드] 참고","reason":"짧은 이유"}]} ' +
      'source·target·wrong 은 각각 문장이 아니라 단어(또는 한 덩어리 용어) 하나여야 한다. lang 은 각 쌍 맨 앞의 [언어코드]를 그대로 쓴다(한자만으로 된 일본어를 중국어로 오판하지 말 것). 확실한 것만 최대 12개. 이미 등록된 용어는 제외: ' + (existing || '없음');
    try {
      const body = {
        model: REFINE_MODEL,
        messages: [{ role: 'system', content: sys }, { role: 'user', content: pairs.join('\n').slice(0, 14000) }],
        max_completion_tokens: 900,
        response_format: { type: 'json_object' },
      };
      const re = reasoningEffort(REFINE_MODEL);
      if (re) body.reasoning_effort = re;
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: JSON.stringify(body),
      });
      if (!r.ok) return res.status(500).json({ error: '검사 호출 실패: HTTP ' + r.status });
      const d = await r.json();
      const obj = JSON.parse(d?.choices?.[0]?.message?.content || '{}');
      const suggestions = (Array.isArray(obj.suggestions) ? obj.suggestions : [])
        .filter((x) => x && x.source && x.target)
        .slice(0, 12)
        .map((x) => ({ source: String(x.source).slice(0, 80), target: String(x.target).slice(0, 80), wrong: String(x.wrong || '').slice(0, 80), reason: String(x.reason || '').slice(0, 120) }));
      res.json({ checked: pairs.length, suggestions });
    } catch (e) {
      logErr('terms-suggest', e);
      res.status(500).json({ error: '검사 실패' });
    }
  });

  /* ---- 관리자: 용어 적중 분석 — 등록 용어가 실제 대화에서 몇 번 등장했는지(문자열 매칭, GPT 미사용) ----
     0회 용어 = 정리 후보. 대상 코퍼스: 데스크 응대 로그 + 일반 세션 대화(원문·번역 텍스트). */
  app.get('/api/admin/terms-hit', requireAdmin, (req, res) => {
    const corpus = [];
    for (const s of sessions) {
      const push = (it) => {
        if (!it) return;
        if (it.source) corpus.push(String(it.source));
        if (it.texts) for (const v of Object.values(it.texts)) if (v) corpus.push(String(v));
      };
      (Array.isArray(s.items) ? s.items : []).forEach(push);
      (Array.isArray(s.deskLog) ? s.deskLog : []).forEach((e) => (e.items || []).forEach(push));
    }
    const text = corpus.join('\n');
    const lower = text.toLowerCase();
    const countOf = (needle) => {
      const n = String(needle || '').trim();
      if (n.length < 2) return 0;
      const hay = /[a-z]/i.test(n) ? lower : text; // 라틴 표기는 대소문자 무시
      const nn = /[a-z]/i.test(n) ? n.toLowerCase() : n;
      let cnt = 0, i = 0;
      while ((i = hay.indexOf(nn, i)) !== -1) { cnt++; i += nn.length; }
      return cnt;
    };
    const rows = (termsConfig.entries || []).map((e) => {
      const byLang = {};
      let hits = 0;
      for (const [lg, name] of Object.entries(e.names || {})) {
        const c = countOf(name);
        if (c > 0) byLang[lg] = c;
        hits += c;
      }
      return { ko: (e.names && e.names.ko) || '', category: e.category, mode: e.mode, hits, byLang };
    });
    // 같은 ko(정식+약칭 행)를 합쳐 보기 좋게
    const merged = new Map();
    for (const r of rows) {
      const m = merged.get(r.ko) || { ko: r.ko, category: r.category, hits: 0, byLang: {} };
      m.hits += r.hits;
      for (const [lg, c] of Object.entries(r.byLang)) m.byLang[lg] = (m.byLang[lg] || 0) + c;
      merged.set(r.ko, m);
    }
    const out = [...merged.values()].sort((a, b) => b.hits - a.hits);
    res.json({ at: Date.now(), corpusLines: corpus.length, terms: out, zeroCount: out.filter((t) => t.hits === 0).length });
  });
}

export function registerTermsConfigRoutes(app) {
  // 용어 설정(통합 v3): 열람(로그인 누구나) + 수정(관리자만). Soniox context로 주입됨.
  app.get('/api/terms-config', requireAuth, (req, res) => {
    res.json({
      version: 3,
      servedLangs: termsConfig.servedLangs || DEFAULT_SERVED_LANGS.slice(),
      categoryScope: sanitizeCatScope(termsConfig.categoryScope),
      entries: termsConfig.entries || [],
      langs: TERM_LANGS, categories: TERM_CATEGORIES, // UI 참고용
      updatedAt: termsConfig.updatedAt || 0,
    });
  });
  app.put('/api/terms-config', requireAdmin, async (req, res) => {
    // 신 스키마(entries) + 구형(terms/translationTerms/alt, JSON 업로드) 모두 정규화 수용
    setTermsConfig({ ...normalizeTermsConfig(req.body || {}), updatedAt: Date.now() });
    try { await persistTermsConfig(); }
    catch (e) {
      // 저장 실패를 200 으로 숨기지 않는다 — 관리자는 저장된 줄 알지만 재기동 시 유실되던 문제
      console.error('[terms] 저장 실패', e);
      return res.status(500).json({ error: '저장소 기록 실패 — 변경이 재시작 후 유실될 수 있습니다. 다시 시도해 주세요.' });
    }
    res.json({ version: 3, servedLangs: termsConfig.servedLangs, categoryScope: termsConfig.categoryScope, entries: termsConfig.entries, langs: TERM_LANGS, categories: TERM_CATEGORIES, updatedAt: termsConfig.updatedAt });
  });
  // 용어 설정 실검증 — validateSonioxPair(vendors/soniox.js) 설명 참고
  app.post('/api/terms-config/validate', requireAdmin, async (req, res) => {
    if (!SONIOX_API_KEY) return res.status(400).json({ error: 'SONIOX_API_KEY 미설정 — 실검증 불가' });
    const served = (termsConfig.servedLangs || DEFAULT_SERVED_LANGS).filter((l) => l !== 'ko');
    const results = await Promise.all(served.map(async (L) => {
      const ctx = buildSonioxContextRaw(['ko', L], { desk: false }); // 일반세션(항공용어 포함)이 더 큼 → 최악 케이스 검증
      const bytes = ctx ? JSON.stringify(ctx).length : 0;
      const terms = ctx && ctx.terms ? ctx.terms.length : 0;
      const pairs = ctx && ctx.translation_terms ? ctx.translation_terms.length : 0;
      let r; try { r = await validateSonioxPair('ko', L, ctx); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
      return { lang: L, ok: r.ok, error: r.error || null, bytes, terms, pairs };
    }));
    res.json({ at: Date.now(), results });
  });
}

/* (평가 러너는 제거됨 — 평가는 데스크 응대 로그의 '평가 JSON' 내려받기 + tools/eval/score.mjs --auto 로 진행) */
