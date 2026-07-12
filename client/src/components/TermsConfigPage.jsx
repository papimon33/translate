import React, { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Checkbox from '@mui/material/Checkbox';
import Tooltip from '@mui/material/Tooltip';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import FileDownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadIcon from '@mui/icons-material/FileUploadOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha } from '@mui/material/styles';
import { api } from '../api.js';

const ALL_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'pt', 'ar'];
const LANG_LABEL = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', pt: '포르투갈어', ar: '아랍어' };
const CATS = [
  { key: 'airline', label: '항공사' },
  { key: 'aviation', label: '항공용어' },
  { key: 'facility', label: '시설' },
  { key: 'etc', label: '기타' },
];
const CTX_LIMIT = 10000;
const DEFAULT_CAT_SCOPE = {
  airline: { desk: true, session: true }, aviation: { desk: false, session: true },
  facility: { desk: true, session: true }, etc: { desk: true, session: true },
};

let _uid = 0;
const uid = () => 'c' + (_uid++).toString(36) + Math.random().toString(36).slice(2, 6);
const cleanStr = (v) => String(v == null ? '' : v).trim().slice(0, 80);
// 한 칸에 여러 표기를 쉼표로 병기: 첫 값=정식 명칭(양방향), 나머지=그 언어→한국어 단방향 표기
const splitCell = (v) => String(v == null ? '' : v).split(/[,、，]/).map(cleanStr).filter(Boolean);
const detectLang = (s) =>
  /[ぁ-んァ-ヶー]/.test(s) ? 'ja' : /[가-힣]/.test(s) ? 'ko' : /[一-鿿]/.test(s) ? 'zh' : /[؀-ۿ]/.test(s) ? 'ar' : 'en';

// (i) 설명 아이콘 — 회색 문구 대신 툴팁으로 숨김
function InfoTip({ title }) {
  return (
    <Tooltip title={title} placement="top" enterTouchDelay={0}>
      <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', verticalAlign: 'middle', cursor: 'help' }} />
    </Tooltip>
  );
}

/* 용어 적중 분석 — 등록 용어가 실제 대화(응대 로그·세션)에서 몇 번 등장했는지. 0회 = 정리 후보. */
function TermsHitPanel() {
  const [data, setData] = useState(null); // { corpusLines, terms:[{ko,category,hits,byLang}], zeroCount }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showZero, setShowZero] = useState(false);
  const run = async () => {
    setBusy(true); setErr('');
    try { setData(await api.adminTermsHit()); }
    catch (e) { setErr(e.message || '분석 실패'); }
    finally { setBusy(false); }
  };
  const terms = (data && data.terms) || [];
  const shown = showZero ? terms.filter((t) => t.hits === 0) : terms.filter((t) => t.hits > 0).slice(0, 20);
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>용어 적중 분석</Typography>
        <InfoTip title="등록한 용어가 실제 대화 기록(데스크 응대·세션)에 몇 번 등장했는지 셉니다. 0회 용어는 정리 후보, 자주 나오는데 등록 안 된 용어는 오탈자 검사로 찾으세요. (서버 내 문자열 매칭 — 외부 전송 없음)" />
        <Box sx={{ flex: 1 }} />
        {data && (
          <Chip size="small" label={`0회 ${data.zeroCount}개`} color={showZero ? 'warning' : 'default'} variant={showZero ? 'filled' : 'outlined'}
            onClick={() => setShowZero((v) => !v)} sx={{ cursor: 'pointer', height: 22, fontSize: 11.5 }} />
        )}
        <Button size="small" variant="outlined" onClick={run} disabled={busy}>{busy ? '분석 중…' : '분석'}</Button>
      </Box>
      {err && <Alert severity="error" sx={{ mb: 1 }}>{err}</Alert>}
      {!data && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>'분석'을 누르면 전체 대화 기록과 대조합니다.</Typography>}
      {data && shown.length === 0 && (
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>{showZero ? '0회 용어가 없습니다 — 모두 사용 중입니다.' : '아직 적중된 용어가 없습니다. 응대 로그가 쌓인 뒤 다시 분석하세요.'}</Typography>
      )}
      {data && shown.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {shown.map((t) => (
            <Tooltip key={t.ko} title={Object.entries(t.byLang || {}).map(([lg, c]) => `${LANG_LABEL[lg] || lg} ${c}회`).join(' · ') || '적중 없음'}>
              <Chip size="small"
                label={`${t.ko} ${t.hits > 0 ? t.hits + '회' : '0회'}`}
                sx={{ fontSize: 12, bgcolor: (th) => t.hits > 0 ? alpha(th.palette.primary.main, 0.08) : alpha(th.palette.warning.main, 0.12) }} />
            </Tooltip>
          ))}
        </Box>
      )}
      {data && <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1 }}>대조 코퍼스 {data.corpusLines.toLocaleString()}줄 · 적중 상위 20개 표시{showZero ? ' (0회 필터 중)' : ''}</Typography>}
    </Paper>
  );
}

/* ---- 화면 모델: 행(용어, 언어별 쉼표 병기 텍스트) + 주요 용어 ↔ 서버 entries 변환 ---- */
// 서버 entries → 행. 같은 카테고리·한국어의 pair(정식)와 inputOnly(병기 표기)를 한 칸의 쉼표 목록으로 합침.
function groupEntries(list) {
  const rows = []; const keyterms = []; const byKey = new Map();
  for (const e of list || []) {
    const ko = cleanStr(e.names && e.names.ko);
    if (!ko) continue;
    if (e.mode === 'recognize') { keyterms.push({ _k: uid(), id: e.id || uid(), category: e.category, text: ko }); continue; }
    const key = e.category + '||' + ko;
    let r = byKey.get(key);
    if (!r) { r = { _k: uid(), id: e.id || uid(), category: e.category, scope: ['*'], formal: { ko }, variants: {} }; byKey.set(key, r); rows.push(r); }
    if (e.mode === 'inputOnly') {
      for (const lg of ALL_LANGS) {
        if (lg === 'ko') continue;
        const v = cleanStr(e.names[lg]);
        if (v && !(r.variants[lg] || []).includes(v)) r.variants[lg] = [...(r.variants[lg] || []), v];
      }
    } else {
      for (const lg of ALL_LANGS) { const v = cleanStr(e.names[lg]); if (v && !r.formal[lg]) r.formal[lg] = v; }
      if (Array.isArray(e.scope) && !e.scope.includes('*')) r.scope = e.scope;
    }
  }
  // 편집용 텍스트(쉼표 병기)로 변환
  return {
    rows: rows.map((r) => {
      const texts = {};
      for (const lg of ALL_LANGS) {
        const list2 = lg === 'ko' ? [r.formal.ko] : [r.formal[lg], ...(r.variants[lg] || [])];
        const s = list2.filter(Boolean).join(', ');
        if (s) texts[lg] = s;
      }
      return { _k: r._k, id: r.id, category: r.category, scope: r.scope, texts };
    }),
    keyterms,
  };
}

// 행 → 서버 entries. 각 칸의 첫 표기=pair(양방향), 나머지=inputOnly(그 언어→ko 단방향), 주요 용어=recognize.
function toEntries(rows, keyterms) {
  const out = [];
  for (const r of rows) {
    const ko = splitCell(r.texts.ko)[0] || '';
    if (!ko) continue;
    const names = { ko };
    const variants = [];
    for (const lg of ALL_LANGS) {
      if (lg === 'ko') continue;
      const toks = splitCell(r.texts[lg]);
      if (toks[0]) names[lg] = toks[0];
      toks.slice(1).forEach((v, i) => variants.push({ lg, v, i }));
    }
    if (ALL_LANGS.some((lg) => lg !== 'ko' && names[lg]))
      out.push({ id: r.id, category: r.category, scope: r.scope && r.scope.length ? r.scope : ['*'], names, mode: 'pair' });
    for (const { lg, v, i } of variants)
      out.push({ id: `${r.id}_a_${lg}${i}`, category: r.category, scope: [lg], names: { ko, [lg]: v }, mode: 'inputOnly' });
  }
  for (const t of keyterms) { const v = cleanStr(t.text); if (v) out.push({ id: t.id, category: t.category, scope: ['*'], names: { ko: v }, mode: 'recognize' }); }
  return out;
}

// 서버 buildSonioxContextRaw 와 동일 규칙으로 언어쌍(ko↔lang) context 바이트 추정
// (한·영·일 외 언어는 표기가 비면 영어로 폴백 — 서버와 동일)
function contextSizeFor(entries, catScope, lang, desk) {
  const L = lang === 'ko' ? ['ko'] : ['ko', lang];
  const terms = new Set();
  const pairs = [];
  const seen = new Set();
  const add = (a, b) => { if (!a || !b || a === b) return; const k = a + '||' + b; if (!seen.has(k)) { seen.add(k); pairs.push([a, b]); } };
  const nameFor = (names, lg) => {
    const v = cleanStr(names[lg]);
    if (v) return v;
    if (lg === 'ko' || lg === 'en' || lg === 'ja') return '';
    return cleanStr(names.en);
  };
  for (const e of entries) {
    if (!e.names || !e.names.ko) continue;
    const cs = catScope[e.category] || { desk: true, session: true };
    if (desk ? cs.desk === false : cs.session === false) continue;
    const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
    if (scoped && !e.scope.some((s) => L.includes(s))) continue;
    if (e.mode === 'recognize') { const v = cleanStr(e.names.ko); if (v) terms.add(v); continue; }
    for (const lg of L) { const v = nameFor(e.names, lg); if (v) terms.add(v); }
    const ko = cleanStr(e.names.ko);
    if (e.mode === 'inputOnly') { if (!ko || !L.includes('ko')) continue; for (const lg of L) { if (lg === 'ko') continue; add(cleanStr(e.names[lg]), ko); } }
    else { for (const a of L) for (const b of L) if (a !== b) add(nameFor(e.names, a), nameFor(e.names, b)); }
  }
  const ctx = {};
  if (terms.size) ctx.terms = [...terms];
  if (pairs.length) ctx.translation_terms = pairs.map(([source, target]) => ({ source, target }));
  return JSON.stringify(ctx).length;
}

// 미완성: 한국어가 없거나, 운영 언어(스코프 내) 칸이 비어 있으면
function isIncompleteRow(r, served) {
  if (!splitCell(r.texts.ko).length) return true;
  const scopeLangs = (Array.isArray(r.scope) && !r.scope.includes('*')) ? r.scope : served;
  return scopeLangs.filter((lg) => lg !== 'ko' && served.includes(lg)).some((lg) => !splitCell(r.texts[lg]).length);
}

export default function TermsConfigPage({ user, embedded }) {
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [keyterms, setKeyterms] = useState([]);
  const [served, setServed] = useState(['ko', 'en', 'ja', 'zh']);
  const [catScope, setCatScope] = useState(DEFAULT_CAT_SCOPE);
  const [tab, setTab] = useState('airline');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [val, setVal] = useState(null); // 저장 시 soniox 검증 결과 { results:[{lang,ok,error}] }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ktInput, setKtInput] = useState('');
  const fileRef = useRef(null);

  const applyConfig = (c) => {
    const g = groupEntries(c.entries || []);
    setRows(g.rows); setKeyterms(g.keyterms);
    if (Array.isArray(c.servedLangs) && c.servedLangs.length) setServed(c.servedLangs);
    if (c.categoryScope) setCatScope({ ...DEFAULT_CAT_SCOPE, ...c.categoryScope });
  };
  useEffect(() => {
    api.termsConfig().then(applyConfig).catch(() => {}).finally(() => setLoading(false));
  }, []);

  // 편집 세대 카운터 — 저장 응답이 돌아왔을 때 그 사이 입력이 있었으면 서버 스냅샷으로 덮어쓰지 않는다
  const editGen = useRef(0);
  const mark = () => { editGen.current++; setDirty(true); setOkMsg(''); setVal(null); };
  const servedForeign = served.filter((l) => l !== 'ko');

  /* ---- 행/주요 용어 조작 ---- */
  const setCell = (k, lg, v) => { setRows((arr) => arr.map((r) => (r._k === k ? { ...r, texts: { ...r.texts, [lg]: v } } : r))); mark(); };
  const addRow = () => { setRows((arr) => [{ _k: uid(), id: uid(), category: tab, scope: ['*'], texts: { ko: '' } }, ...arr]); mark(); };
  const removeRow = (k) => { setRows((arr) => arr.filter((r) => r._k !== k)); mark(); };
  const addKeyterm = () => {
    const v = cleanStr(ktInput); if (!v) return;
    setKeyterms((arr) => arr.some((t) => t.category === tab && t.text === v) ? arr : [...arr, { _k: uid(), id: uid(), category: tab, text: v }]);
    setKtInput(''); mark();
  };
  const removeKeyterm = (k) => { setKeyterms((arr) => arr.filter((t) => t._k !== k)); mark(); };

  const flatEntries = useMemo(() => toEntries(rows, keyterms), [rows, keyterms]);
  const gauge = useMemo(() => servedForeign.map((lg) => ({ lang: lg, bytes: contextSizeFor(flatEntries, catScope, lg, false) })), [flatEntries, catScope, servedForeign]);
  const maxBytes = Math.max(0, ...gauge.map((g) => g.bytes));

  const kw = q.trim().toLowerCase();
  const shownRows = useMemo(() => rows.filter((r) => r.category === tab)
    .filter((r) => !onlyIncomplete || isIncompleteRow(r, served))
    .filter((r) => !kw || ALL_LANGS.some((lg) => String(r.texts[lg] || '').toLowerCase().includes(kw))), [rows, tab, onlyIncomplete, kw, served]);
  const shownKeyterms = useMemo(() => keyterms.filter((t) => t.category === tab && (!kw || t.text.toLowerCase().includes(kw))), [keyterms, tab, kw]);
  const incompleteCount = useMemo(() => rows.filter((r) => isIncompleteRow(r, served)).length, [rows, served]);

  /* ---- 저장(→ 자동 soniox 검증) ---- */
  const doSave = async (payload, keepRows) => {
    // 같은 카테고리에 같은 한국어 용어가 2행이면 저장 후 재그룹핑 때 병합돼 표기가 유실됨 → 사전 차단
    const dupKey = new Map();
    for (const r of rows) {
      const ko = splitCell(r.texts.ko)[0]; if (!ko) continue;
      const k = r.category + '||' + ko;
      if (dupKey.has(k)) { setErr(`같은 한국어 용어가 중복입니다: "${ko}" (${(CATS.find((c) => c.key === r.category) || {}).label}) — 한 행으로 합쳐 주세요.`); return; }
      dupKey.set(k, true);
    }
    setSaving(true); setErr(''); setOkMsg(''); setVal(null);
    const genAtSave = editGen.current;
    try {
      const c = await api.saveTermsConfig(payload);
      if (editGen.current === genAtSave) {
        applyConfig(c);
        // 미완성이라 서버 entries 가 안 만들어진 행(한국어 없음/외국어 전무)은 화면에 남겨 이어서 입력하게 함
        const kept = (keepRows || rows).filter((r) => {
          const ko = splitCell(r.texts.ko)[0];
          return !ko || !ALL_LANGS.some((lg) => lg !== 'ko' && splitCell(r.texts[lg]).length);
        }).filter((r) => ALL_LANGS.some((lg) => splitCell(r.texts[lg]).length)); // 완전 빈 행은 버림
        if (kept.length) {
          setRows((arr) => [...kept, ...arr]);
          setOkMsg(`저장되었습니다. 미완성 ${kept.length}행은 저장에서 제외돼 화면에 남아 있습니다 — 채워서 다시 저장하세요.`);
        }
        setDirty(kept.length > 0);
      }
      setSaving(false);
      setValidating(true);
      try {
        const v = await api.validateTermsConfig(); setVal(v);
        const bad = (v.results || []).filter((x) => !x.ok);
        if (bad.length) setErr(`저장은 됐지만 soniox 검증에 실패한 언어가 있습니다: ${bad.map((b) => LANG_LABEL[b.lang] || b.lang).join(', ')} — 해당 언어의 항목 수를 줄여 주세요.`);
        else setOkMsg((m) => m || '저장 완료 · soniox 검증 통과 — 다음 세션 시작부터 적용됩니다.');
      } catch (e) { setOkMsg((m) => m || ('저장되었습니다. (soniox 검증 생략: ' + (e.message || '연결 실패') + ')')); }
      finally { setValidating(false); }
    } catch (e) { setErr(e.message || '저장 실패'); setSaving(false); }
  };
  const save = () => doSave({ version: 3, servedLangs: served, categoryScope: catScope, entries: flatEntries }, rows);
  const busy = saving || validating;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ version: 3, servedLangs: served, categoryScope: catScope, entries: flatEntries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'terms-config.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  const uploadJson = async (file) => {
    if (!file) return;
    try { await doSave(JSON.parse(await file.text()), []); } // 서버가 구형·신형 모두 정규화. 업로드는 화면 행을 남기지 않음
    catch (e) { setErr('JSON 을 읽을 수 없습니다: ' + (e.message || '')); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  /* ---- 오탈자·오번역 검사 → 채택 시 해당 용어 칸에 쉼표 병기로 추가 ---- */
  const [sugBusy, setSugBusy] = useState(false);
  const [sugResult, setSugResult] = useState(null);
  const runSuggest = async () => {
    setSugBusy(true); setErr('');
    try { setSugResult(await api.adminTermsSuggest()); }
    catch (e) { setErr(e.message || '검사 실패'); } finally { setSugBusy(false); }
  };
  const adoptSuggestion = (s) => {
    const hasKo = /[가-힣]/.test(s.source);
    const ko = cleanStr(hasKo ? s.source : s.target);
    const other = cleanStr(hasKo ? s.target : s.source);
    // 언어는 서버가 로그의 [언어코드]로 판정한 값을 우선 — 문자셋 추정은 한자만으로 된 일본어를 중국어로 오판함
    const lg0 = (s.lang && ALL_LANGS.includes(s.lang) && s.lang !== 'ko') ? s.lang : detectLang(other);
    const lg = lg0 === 'ko' ? 'en' : lg0;
    setRows((arr) => {
      const idx = arr.findIndex((r) => splitCell(r.texts.ko)[0] === ko);
      if (idx >= 0) {
        const r = arr[idx];
        if (splitCell(r.texts[lg]).includes(other)) return arr;
        const cur = String(r.texts[lg] || '').trim();
        const next = [...arr];
        next[idx] = { ...r, texts: { ...r.texts, [lg]: cur ? cur + ', ' + other : other } };
        return next;
      }
      return [{ _k: uid(), id: uid(), category: tab, scope: ['*'], texts: { ko, [lg]: other } }, ...arr];
    });
    setSugResult((r) => r && { ...r, suggestions: r.suggestions.filter((x) => x !== s) });
    mark();
  };

  /* ---- 상단: 언어별 용량 + 저장 시 검증 결과 ---- */
  const gaugeBar = (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {gauge.map((g) => {
        const over = g.bytes > CTX_LIMIT;
        const v = val && val.results && val.results.find((r) => r.lang === g.lang);
        return (
          <Tooltip key={g.lang} title={`${LANG_LABEL[g.lang]} 세션(ko↔${g.lang}) 용어 데이터 ${g.bytes.toLocaleString()}자 / ${CTX_LIMIT.toLocaleString()}${v ? (v.ok ? ' · 저장 시 soniox 검증 통과' : ' · 검증 실패: ' + (v.error || '')) : ''}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.4, borderRadius: 1.5, border: 1, borderColor: over ? 'error.main' : 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>{LANG_LABEL[g.lang]}</Typography>
              <Typography sx={{ fontSize: 11.5, color: over ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{g.bytes.toLocaleString()}</Typography>
              {validating && <CircularProgress size={11} sx={{ ml: 0.25 }} />}
              {!validating && v && (v.ok ? <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} /> : <ErrorOutlineIcon sx={{ fontSize: 14, color: 'error.main' }} />)}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );

  const headerBtns = isAdmin && (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button size="small" onClick={() => setSettingsOpen(true)} sx={{ color: 'text.secondary' }}>언어·적용대상</Button>
      <Button size="small" startIcon={<FileDownloadIcon />} onClick={downloadJson} sx={{ color: 'text.secondary' }}>JSON</Button>
      <Button size="small" startIcon={<FileUploadIcon />} onClick={() => fileRef.current && fileRef.current.click()} sx={{ color: 'text.secondary' }}>업로드</Button>
      <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={save} disabled={busy || !dirty}>
        {saving ? '저장 중…' : validating ? '검증 중…' : '저장'}
      </Button>
    </Box>
  );

  const gridCols = `150px repeat(${servedForeign.length}, minmax(150px, 1fr)) 36px`;
  const tableMinWidth = 150 + servedForeign.length * 160 + 36;

  return (
    <>
      <Box component="input" type="file" accept=".json,application/json" ref={fileRef} onChange={(e) => uploadJson(e.target.files && e.target.files[0])} sx={{ display: 'none' }} />
      {!embedded && (
        <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="h6">용어 설정</Typography><Box sx={{ flex: 1 }} />{headerBtns}
          </Box>
          <Box sx={{ mt: 1.5 }}>{gaugeBar}</Box>
        </Box>
      )}

      <Box sx={{ flex: embedded ? 'none' : 1, minHeight: 0, overflow: embedded ? 'visible' : 'auto', p: embedded ? 0 : { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: embedded ? '100%' : 1040, mx: 'auto' }}>
          {embedded && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>{gaugeBar}</Box>{headerBtns}
            </Box>
          )}
          {okMsg && <Alert severity="success" sx={{ mb: 2 }}>{okMsg}</Alert>}
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          {maxBytes > CTX_LIMIT && <Alert severity="warning" sx={{ mb: 2 }}>일부 언어가 한도({CTX_LIMIT.toLocaleString()}자)를 초과합니다. 초과분은 전송 시 잘립니다 — 사용 빈도 낮은 항목을 정리하거나 카테고리 적용대상을 조정하세요.</Alert>}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8, gap: 1, color: 'text.secondary' }}><CircularProgress size={18} /> <Typography sx={{ fontSize: 14 }}>불러오는 중…</Typography></Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, textTransform: 'none', fontWeight: 700, fontSize: 13.5 } }}>
                  {CATS.map((c) => <Tab key={c.key} value={c.key} label={`${c.label} (${rows.filter((r) => r.category === c.key).length + keyterms.filter((t) => t.category === c.key).length})`} />)}
                </Tabs>
                <Box sx={{ flex: 1 }} />
                <TextField size="small" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 140 }} />
                <Chip size="small" label={`미완성 ${incompleteCount}`} color={onlyIncomplete ? 'warning' : 'default'} variant={onlyIncomplete ? 'filled' : 'outlined'} onClick={() => setOnlyIncomplete((v) => !v)} sx={{ cursor: 'pointer' }} />
                {isAdmin && <Button size="small" startIcon={<AddIcon />} onClick={addRow}>용어 추가</Button>}
              </Box>

              {/* ---- 번역 설정 표 ---- */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800 }}>번역 설정</Typography>
                <InfoTip title={
                  <>각 언어의 표기는 서로 양방향 번역됩니다. 한 칸에 쉼표로 여러 표기를 적으면 첫 표기가 정식 명칭(양방향), 나머지는 그 언어 → 한국어 한 방향으로만 인식·번역됩니다(약칭·오인식 교정). 예: 中国东方航空, 东航 · 喫煙室, きつえんしつ{tab === 'aviation' && !catScope.aviation.desk ? ' · 항공용어는 안내데스크 세션에는 주입되지 않습니다.' : ''}</>
                } />
              </Box>
              <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden', mb: 3 }}>
                <Box sx={{ overflowX: 'auto' }}>
                  <Box sx={{ minWidth: tableMinWidth }}>
                    {/* 헤더 */}
                    <Box sx={{ display: 'grid', gridTemplateColumns: gridCols, gap: 1, px: 1.5, py: 0.75, borderBottom: 1, borderColor: 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.025) }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 800 }}>한국어</Typography>
                      {servedForeign.map((lg) => <Typography key={lg} sx={{ fontSize: 12, fontWeight: 800 }}>{LANG_LABEL[lg]}</Typography>)}
                      <Box />
                    </Box>
                    {shownRows.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 2.5, textAlign: 'center' }}>항목이 없습니다.</Typography>}
                    {shownRows.map((r) => {
                      const incomplete = isIncompleteRow(r, served);
                      return (
                        <Box key={r._k} sx={{
                          display: 'grid', gridTemplateColumns: gridCols, gap: 1, px: 1.5, py: 0.75, alignItems: 'center',
                          borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 },
                          bgcolor: incomplete ? (t) => alpha(t.palette.warning.main, 0.05) : 'transparent',
                        }}>
                          <TextField size="small" placeholder="한국어(필수)" value={r.texts.ko || ''} disabled={!isAdmin}
                            onChange={(ev) => setCell(r._k, 'ko', ev.target.value)} error={!splitCell(r.texts.ko).length}
                            inputProps={{ style: { fontSize: 13.5, padding: '7px 10px' } }} />
                          {servedForeign.map((lg) => (
                            <TextField key={lg} fullWidth size="small" placeholder={LANG_LABEL[lg]} value={r.texts[lg] || ''} disabled={!isAdmin}
                              onChange={(ev) => setCell(r._k, lg, ev.target.value)}
                              error={incomplete && !splitCell(r.texts[lg]).length}
                              inputProps={{ style: { fontSize: 13.5, padding: '7px 10px' } }} />
                          ))}
                          {isAdmin ? <IconButton size="small" onClick={() => removeRow(r._k)}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton> : <Box />}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Paper>

              {/* ---- 주요 용어(인식 힌트) ---- */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                <Typography sx={{ fontSize: 13.5, fontWeight: 800 }}>주요 용어</Typography>
                <InfoTip title="번역 없이 음성 인식 힌트로만 사용됩니다(약어·고유명사, 예: ICAO)." />
              </Box>
              <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                {shownKeyterms.length === 0 && !isAdmin && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>항목이 없습니다.</Typography>}
                {shownKeyterms.map((t) => (
                  <Chip key={t._k} size="small" label={t.text} onDelete={isAdmin ? () => removeKeyterm(t._k) : undefined} sx={{ fontSize: 12 }} />
                ))}
                {isAdmin && (
                  <TextField size="small" placeholder="용어 입력 후 Enter" value={ktInput}
                    onChange={(e) => setKtInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addKeyterm(); }}
                    inputProps={{ style: { fontSize: 12.5, padding: '4px 10px' } }} sx={{ width: 170 }} />
                )}
              </Paper>

              {/* ---- 용어 적중 분석 ---- */}
              {isAdmin && <TermsHitPanel />}

              {/* ---- 오탈자·오번역 검사 ---- */}
              {isAdmin && (
                <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>오탈자·오번역 검사</Typography>
                      <InfoTip title="대화 로그를 AI 로 단어 단위 대조해 오탈자·오역 후보를 찾습니다. 채택하면 해당 용어의 칸에 쉼표 병기 표기로 추가됩니다. (OpenAI 전송)" />
                    </Box>
                    <Button size="small" variant="outlined" onClick={runSuggest} disabled={sugBusy}>{sugBusy ? '검사 중…' : '검사'}</Button>
                  </Box>
                  {sugResult && sugResult.suggestions.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>추천할 항목을 찾지 못했습니다. ({sugResult.checked}건 확인)</Typography>}
                  {sugResult && sugResult.suggestions.length > 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sugResult.suggestions.map((s, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: 1.5, border: 1, borderColor: 'divider' }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>{s.source} → {s.target}{s.wrong && <Box component="span" sx={{ fontWeight: 500, color: 'error.main', fontSize: 12.5, ml: 1 }}>현재: {s.wrong}</Box>}</Typography>
                            {s.reason && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{s.reason}</Typography>}
                          </Box>
                          <Button size="small" variant="contained" disableElevation onClick={() => adoptSuggestion(s)}>추가</Button>
                        </Box>
                      ))}
                    </Box>
                  )}
                </Paper>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* 언어·적용대상 설정 */}
      <Dialog open={settingsOpen} onClose={() => setSettingsOpen(false)} PaperProps={{ sx: { width: 460, maxWidth: 460 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>운영 언어 · 카테고리 적용대상</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>운영 언어</Typography>
            <InfoTip title="선택한 언어는 번역 설정에서 필수로 채워야 합니다. 한국어는 항상 포함." />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
            {ALL_LANGS.map((lg) => (
              <Chip key={lg} label={LANG_LABEL[lg]} size="small" color={served.includes(lg) ? 'primary' : 'default'} variant={served.includes(lg) ? 'filled' : 'outlined'}
                onClick={() => { if (lg === 'ko' || !isAdmin) return; setServed((s) => s.includes(lg) ? s.filter((x) => x !== lg) : [...s, lg]); mark(); }}
                sx={{ cursor: lg === 'ko' ? 'default' : 'pointer' }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1 }}>
            <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>카테고리 적용 대상</Typography>
            <InfoTip title="해당 카테고리를 어떤 세션에 주입할지. (항공용어는 데스크 손님 응대엔 불필요)" />
          </Box>
          {CATS.map((c) => (
            <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, width: 90 }}>{c.label}</Typography>
              {['desk', 'session'].map((kind) => (
                <Box key={kind} sx={{ display: 'flex', alignItems: 'center' }}>
                  <Checkbox size="small" checked={(catScope[c.key] || {})[kind] !== false} disabled={!isAdmin}
                    onChange={(e) => { setCatScope((cs) => ({ ...cs, [c.key]: { ...cs[c.key], [kind]: e.target.checked } })); mark(); }} sx={{ p: 0.5 }} />
                  <Typography sx={{ fontSize: 13 }}>{kind === 'desk' ? '안내데스크' : '일반세션'}</Typography>
                </Box>
              ))}
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}><Button variant="contained" onClick={() => setSettingsOpen(false)}>닫기</Button></DialogActions>
      </Dialog>
    </>
  );
}
