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
const detectLang = (s) =>
  /[ぁ-んァ-ヶー]/.test(s) ? 'ja' : /[가-힣]/.test(s) ? 'ko' : /[一-鿿]/.test(s) ? 'zh' : /[؀-ۿ]/.test(s) ? 'ar' : 'en';

/* ---- 화면 모델: 행(용어) + 키텀 ↔ 서버 entries(pair/inputOnly/recognize) 변환 ---- */
// 서버 entries → 행 묶음. 같은 카테고리·한국어 표기를 한 행으로 합치고, inputOnly 는 해당 언어의 약칭 칩으로.
function groupEntries(list) {
  const rows = []; const keyterms = []; const byKey = new Map();
  for (const e of list || []) {
    const ko = cleanStr(e.names && e.names.ko);
    if (!ko) continue;
    if (e.mode === 'recognize') { keyterms.push({ _k: uid(), id: e.id || uid(), category: e.category, text: ko }); continue; }
    const key = e.category + '||' + ko;
    let r = byKey.get(key);
    if (!r) { r = { _k: uid(), id: e.id || uid(), category: e.category, scope: ['*'], names: { ko }, alts: {} }; byKey.set(key, r); rows.push(r); }
    if (e.mode === 'inputOnly') {
      for (const lg of ALL_LANGS) {
        if (lg === 'ko') continue;
        const v = cleanStr(e.names[lg]);
        if (v && !(r.alts[lg] || []).includes(v)) r.alts[lg] = [...(r.alts[lg] || []), v];
      }
    } else {
      for (const lg of ALL_LANGS) { const v = cleanStr(e.names[lg]); if (v && !r.names[lg]) r.names[lg] = v; }
      if (Array.isArray(e.scope) && !e.scope.includes('*')) r.scope = e.scope;
    }
  }
  return { rows, keyterms };
}

// 행 묶음 → 서버 entries. 정식 명칭=pair(양방향), 약칭 칩=inputOnly(그 언어→ko 단방향), 키텀=recognize.
function toEntries(rows, keyterms) {
  const out = [];
  for (const r of rows) {
    const names = {}; for (const lg of ALL_LANGS) { const v = cleanStr(r.names[lg]); if (v) names[lg] = v; }
    if (!names.ko) continue;
    if (ALL_LANGS.some((lg) => lg !== 'ko' && names[lg]))
      out.push({ id: r.id, category: r.category, scope: r.scope && r.scope.length ? r.scope : ['*'], names, mode: 'pair' });
    for (const lg of ALL_LANGS) (r.alts[lg] || []).forEach((alt, i) => {
      const v = cleanStr(alt); if (!v) return;
      out.push({ id: `${r.id}_a_${lg}${i}`, category: r.category, scope: [lg], names: { ko: names.ko, [lg]: v }, mode: 'inputOnly' });
    });
  }
  for (const t of keyterms) { const v = cleanStr(t.text); if (v) out.push({ id: t.id, category: t.category, scope: ['*'], names: { ko: v }, mode: 'recognize' }); }
  return out;
}

// 서버 buildSonioxContextRaw 와 동일 규칙으로 언어쌍(ko↔lang) context 바이트 추정
function contextSizeFor(entries, catScope, lang, desk) {
  const L = lang === 'ko' ? ['ko'] : ['ko', lang];
  const terms = new Set();
  const pairs = [];
  const seen = new Set();
  const add = (a, b) => { if (!a || !b || a === b) return; const k = a + '||' + b; if (!seen.has(k)) { seen.add(k); pairs.push([a, b]); } };
  for (const e of entries) {
    if (!e.names || !e.names.ko) continue;
    const cs = catScope[e.category] || { desk: true, session: true };
    if (desk ? cs.desk === false : cs.session === false) continue;
    const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
    if (scoped && !e.scope.some((s) => L.includes(s))) continue;
    if (e.mode === 'recognize') { const v = cleanStr(e.names.ko); if (v) terms.add(v); continue; }
    for (const lg of L) { const v = cleanStr(e.names[lg]); if (v) terms.add(v); }
    const ko = cleanStr(e.names.ko);
    if (e.mode === 'inputOnly') { if (!ko || !L.includes('ko')) continue; for (const lg of L) { if (lg === 'ko') continue; add(cleanStr(e.names[lg]), ko); } }
    else { for (const a of L) for (const b of L) if (a !== b) add(cleanStr(e.names[a]), cleanStr(e.names[b])); }
  }
  const ctx = {};
  if (terms.size) ctx.terms = [...terms];
  if (pairs.length) ctx.translation_terms = pairs.map(([source, target]) => ({ source, target }));
  return JSON.stringify(ctx).length;
}

// 미완성: 정식 외국어가 하나라도 있으면 운영 언어 전부 필수. 약칭만 있는 행(오인식 교정 전용)은 완성으로 본다.
function isIncompleteRow(r, served) {
  if (!cleanStr(r.names.ko)) return true;
  const hasFormal = ALL_LANGS.some((lg) => lg !== 'ko' && cleanStr(r.names[lg]));
  const hasAlt = ALL_LANGS.some((lg) => (r.alts[lg] || []).some((a) => cleanStr(a)));
  if (!hasFormal) return !hasAlt;
  const scopeLangs = (Array.isArray(r.scope) && !r.scope.includes('*')) ? r.scope : served;
  return scopeLangs.filter((lg) => lg !== 'ko' && served.includes(lg)).some((lg) => !cleanStr(r.names[lg]));
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
  const [altEdit, setAltEdit] = useState(null); // { k, lang } — 약칭 입력 중인 칸
  const [altInput, setAltInput] = useState('');
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

  const mark = () => { setDirty(true); setOkMsg(''); setVal(null); };
  const servedForeign = served.filter((l) => l !== 'ko');

  /* ---- 행/키텀 조작 ---- */
  const patchRow = (k, fn) => { setRows((arr) => arr.map((r) => (r._k === k ? fn(r) : r))); mark(); };
  const setRowName = (k, lg, v) => patchRow(k, (r) => ({ ...r, names: { ...r.names, [lg]: v } }));
  const addAlt = (k, lg, v) => patchRow(k, (r) => (r.alts[lg] || []).includes(v) ? r : { ...r, alts: { ...r.alts, [lg]: [...(r.alts[lg] || []), v] } });
  const removeAlt = (k, lg, i) => patchRow(k, (r) => ({ ...r, alts: { ...r.alts, [lg]: (r.alts[lg] || []).filter((_, j) => j !== i) } }));
  const addRow = () => { setRows((arr) => [{ _k: uid(), id: uid(), category: tab, scope: ['*'], names: { ko: '' }, alts: {} }, ...arr]); mark(); };
  const removeRow = (k) => { setRows((arr) => arr.filter((r) => r._k !== k)); mark(); };
  const addKeyterm = () => {
    const v = cleanStr(ktInput); if (!v) return;
    setKeyterms((arr) => arr.some((t) => t.category === tab && t.text === v) ? arr : [...arr, { _k: uid(), id: uid(), category: tab, text: v }]);
    setKtInput(''); mark();
  };
  const removeKeyterm = (k) => { setKeyterms((arr) => arr.filter((t) => t._k !== k)); mark(); };
  const commitAlt = () => {
    const v = cleanStr(altInput);
    if (altEdit && v) addAlt(altEdit.k, altEdit.lang, v);
    setAltEdit(null); setAltInput('');
  };

  const flatEntries = useMemo(() => toEntries(rows, keyterms), [rows, keyterms]);
  const gauge = useMemo(() => servedForeign.map((lg) => ({ lang: lg, bytes: contextSizeFor(flatEntries, catScope, lg, false) })), [flatEntries, catScope, servedForeign]);
  const maxBytes = Math.max(0, ...gauge.map((g) => g.bytes));

  const kw = q.trim().toLowerCase();
  const rowMatches = (r) => !kw ||
    ALL_LANGS.some((lg) => cleanStr(r.names[lg]).toLowerCase().includes(kw)) ||
    ALL_LANGS.some((lg) => (r.alts[lg] || []).some((a) => a.toLowerCase().includes(kw)));
  const shownRows = useMemo(() => rows.filter((r) => r.category === tab)
    .filter((r) => !onlyIncomplete || isIncompleteRow(r, served))
    .filter(rowMatches), [rows, tab, onlyIncomplete, kw, served]);
  const shownKeyterms = useMemo(() => keyterms.filter((t) => t.category === tab && (!kw || t.text.toLowerCase().includes(kw))), [keyterms, tab, kw]);
  const incompleteCount = useMemo(() => rows.filter((r) => isIncompleteRow(r, served)).length, [rows, served]);

  /* ---- 저장(→ 자동 soniox 검증) ---- */
  const doSave = async (payload) => {
    setSaving(true); setErr(''); setOkMsg(''); setVal(null);
    try {
      const c = await api.saveTermsConfig(payload);
      applyConfig(c);
      setDirty(false); setSaving(false);
      setValidating(true);
      try {
        const v = await api.validateTermsConfig(); setVal(v);
        const bad = (v.results || []).filter((x) => !x.ok);
        if (bad.length) setErr(`저장은 됐지만 soniox 검증에 실패한 언어가 있습니다: ${bad.map((b) => LANG_LABEL[b.lang] || b.lang).join(', ')} — 해당 언어의 항목 수를 줄여 주세요.`);
        else setOkMsg('저장 완료 · soniox 검증 통과 — 다음 세션 시작부터 적용됩니다.');
      } catch (e) { setOkMsg('저장되었습니다. (soniox 검증 생략: ' + (e.message || '연결 실패') + ')'); }
      finally { setValidating(false); }
    } catch (e) { setErr(e.message || '저장 실패'); setSaving(false); }
  };
  const save = () => doSave({ version: 3, servedLangs: served, categoryScope: catScope, entries: flatEntries });
  const busy = saving || validating;

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ version: 3, servedLangs: served, categoryScope: catScope, entries: flatEntries }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'terms-config.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  const uploadJson = async (file) => {
    if (!file) return;
    try { await doSave(JSON.parse(await file.text())); } // 서버가 구형·신형 모두 정규화
    catch (e) { setErr('JSON 을 읽을 수 없습니다: ' + (e.message || '')); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  /* ---- 오탈자·오번역 검사 → 채택 시 해당 용어의 약칭(단방향)으로 추가 ---- */
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
    const lg0 = detectLang(other);
    const lg = lg0 === 'ko' ? 'en' : lg0;
    setRows((arr) => {
      const idx = arr.findIndex((r) => cleanStr(r.names.ko) === ko);
      if (idx >= 0) {
        const r = arr[idx]; const list = r.alts[lg] || [];
        if (list.includes(other)) return arr;
        const next = [...arr]; next[idx] = { ...r, alts: { ...r.alts, [lg]: [...list, other] } }; return next;
      }
      return [{ _k: uid(), id: uid(), category: tab, scope: ['*'], names: { ko }, alts: { [lg]: [other] } }, ...arr];
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

              {/* ---- 번역 용어 표 ---- */}
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>
                <b>번역 용어</b> — 각 언어의 정식 명칭은 서로 양방향 번역됩니다. 칸 아래 <b>약칭·오인식 칩</b>은 그 언어 → 한국어 <b>한 방향</b>으로만 적용됩니다(예: 东航→동방항공, キチン室→흡연실).
                {tab === 'aviation' && !catScope.aviation.desk && ' · 항공용어는 안내데스크 세션에는 주입되지 않습니다.'}
              </Typography>
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
                      const hasFormal = ALL_LANGS.some((lg) => lg !== 'ko' && cleanStr(r.names[lg]));
                      return (
                        <Box key={r._k} sx={{
                          display: 'grid', gridTemplateColumns: gridCols, gap: 1, px: 1.5, py: 1, alignItems: 'start',
                          borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 },
                          bgcolor: incomplete ? (t) => alpha(t.palette.warning.main, 0.05) : 'transparent',
                          '& .altAdd': { opacity: 0, transition: 'opacity .12s' }, '&:hover .altAdd': { opacity: 1 },
                          '& .altEmpty': { display: 'none' }, '&:hover .altEmpty': { display: 'flex' },
                        }}>
                          {/* 한국어 */}
                          <TextField size="small" placeholder="한국어(필수)" value={r.names.ko || ''} disabled={!isAdmin}
                            onChange={(ev) => setRowName(r._k, 'ko', ev.target.value)} error={!cleanStr(r.names.ko)}
                            inputProps={{ style: { fontSize: 13.5, padding: '7px 10px' } }} />
                          {/* 외국어(정식 + 약칭 칩) */}
                          {servedForeign.map((lg) => {
                            const alts = r.alts[lg] || [];
                            const editing = altEdit && altEdit.k === r._k && altEdit.lang === lg;
                            return (
                              <Box key={lg} sx={{ minWidth: 0 }}>
                                <TextField fullWidth size="small" placeholder={LANG_LABEL[lg]} value={r.names[lg] || ''} disabled={!isAdmin}
                                  onChange={(ev) => setRowName(r._k, lg, ev.target.value)}
                                  error={incomplete && hasFormal && !cleanStr(r.names[lg])}
                                  inputProps={{ style: { fontSize: 13.5, padding: '7px 10px' } }} />
                                <Box className={(alts.length || editing) ? undefined : 'altEmpty'} sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                  {alts.map((a, i) => (
                                    <Tooltip key={i} title={`${a} → ${cleanStr(r.names.ko) || '한국어'} (한 방향)`}>
                                      <Chip size="small" label={a} onDelete={isAdmin ? () => removeAlt(r._k, lg, i) : undefined}
                                        sx={{ height: 20, fontSize: 11, bgcolor: (t) => alpha(t.palette.info.main, 0.08) }} />
                                    </Tooltip>
                                  ))}
                                  {editing ? (
                                    <TextField autoFocus size="small" placeholder="약칭·오인식 표기" value={altInput}
                                      onChange={(ev) => setAltInput(ev.target.value)}
                                      onKeyDown={(ev) => { if (ev.key === 'Enter') commitAlt(); if (ev.key === 'Escape') { setAltEdit(null); setAltInput(''); } }}
                                      onBlur={commitAlt}
                                      inputProps={{ style: { fontSize: 11.5, padding: '2px 8px' } }} sx={{ width: 130 }} />
                                  ) : (isAdmin && (
                                    <Chip className={alts.length ? undefined : 'altAdd'} size="small" variant="outlined" label="+ 약칭"
                                      onClick={() => { setAltEdit({ k: r._k, lang: lg }); setAltInput(''); }}
                                      sx={{ height: 20, fontSize: 11, cursor: 'pointer', borderStyle: 'dashed', color: 'text.secondary' }} />
                                  ))}
                                </Box>
                              </Box>
                            );
                          })}
                          {isAdmin ? <IconButton size="small" onClick={() => removeRow(r._k)} sx={{ mt: 0.25 }}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton> : <Box />}
                        </Box>
                      );
                    })}
                  </Box>
                </Box>
              </Paper>

              {/* ---- 키텀(인식 전용) ---- */}
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 0.75 }}>
                <b>키텀 (인식 전용)</b> — 번역 없이 음성 인식 힌트로만 사용됩니다(약어·고유명사, 예: ICAO).
              </Typography>
              <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center' }}>
                {shownKeyterms.length === 0 && !isAdmin && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>항목이 없습니다.</Typography>}
                {shownKeyterms.map((t) => (
                  <Chip key={t._k} size="small" label={t.text} onDelete={isAdmin ? () => removeKeyterm(t._k) : undefined} sx={{ fontSize: 12 }} />
                ))}
                {isAdmin && (
                  <TextField size="small" placeholder="키텀 입력 후 Enter" value={ktInput}
                    onChange={(e) => setKtInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addKeyterm(); }}
                    inputProps={{ style: { fontSize: 12.5, padding: '4px 10px' } }} sx={{ width: 170 }} />
                )}
              </Paper>

              {/* ---- 오탈자·오번역 검사 ---- */}
              {isAdmin && (
                <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>오탈자·오번역 검사</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>대화 로그를 AI 로 단어 단위 대조해 오탈자·오역 후보를 찾습니다. 채택 시 해당 용어의 약칭·오인식 칩으로 추가됩니다. (OpenAI 전송)</Typography>
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
          <Typography sx={{ fontWeight: 700, fontSize: 13.5, mb: 0.5 }}>운영 언어(필수 입력 대상)</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1 }}>선택한 언어는 번역 용어에서 필수로 채워야 합니다. 한국어는 항상 포함.</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2.5 }}>
            {ALL_LANGS.map((lg) => (
              <Chip key={lg} label={LANG_LABEL[lg]} size="small" color={served.includes(lg) ? 'primary' : 'default'} variant={served.includes(lg) ? 'filled' : 'outlined'}
                onClick={() => { if (lg === 'ko' || !isAdmin) return; setServed((s) => s.includes(lg) ? s.filter((x) => x !== lg) : [...s, lg]); mark(); }}
                sx={{ cursor: lg === 'ko' ? 'default' : 'pointer' }} />
            ))}
          </Box>
          <Typography sx={{ fontWeight: 700, fontSize: 13.5, mb: 0.5 }}>카테고리 적용 대상</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1 }}>해당 카테고리를 어떤 세션에 주입할지. (항공용어는 데스크 손님 응대엔 불필요)</Typography>
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
