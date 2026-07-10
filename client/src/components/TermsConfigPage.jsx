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
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import LinearProgress from '@mui/material/LinearProgress';
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
const MODES = [
  { v: 'pair', label: '양방향 번역', hint: '두 언어가 서로 번역됩니다(정식 용어).' },
  { v: 'inputOnly', label: '입력 전용(약칭·오인식)', hint: '외국어 표기 → 한국어 한 방향만. 약칭(东航)·오인식 교정(キチン室)에. 한국어→외국어로는 안 나갑니다.' },
  { v: 'recognize', label: '인식 전용', hint: '번역 없이 음성 인식 힌트로만(약어·고유명사, 예: ICAO).' },
];
const MODE_LABEL = Object.fromEntries(MODES.map((m) => [m.v, m.label]));
const CTX_LIMIT = 10000;
const DEFAULT_CAT_SCOPE = {
  airline: { desk: true, session: true }, aviation: { desk: false, session: true },
  facility: { desk: true, session: true }, etc: { desk: true, session: true },
};

let _uid = 0;
const uid = () => 'c' + (_uid++).toString(36) + Math.random().toString(36).slice(2, 6);
const cleanStr = (v) => String(v == null ? '' : v).trim().slice(0, 80);

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

// 미완성: pair=scope∩served 언어 중 빈 칸 / inputOnly=ko + scope 언어값 하나 이상 / recognize=ko
function isIncomplete(e, served) {
  if (!e.names || !cleanStr(e.names.ko)) return true;
  if (e.mode === 'recognize') return false;
  const scopeLangs = (Array.isArray(e.scope) && !e.scope.includes('*')) ? e.scope : served;
  if (e.mode === 'inputOnly') return !scopeLangs.some((lg) => lg !== 'ko' && cleanStr(e.names[lg]));
  return scopeLangs.filter((lg) => served.includes(lg)).some((lg) => !cleanStr(e.names[lg]));
}

function normalizeUploadEntries(b) {
  // 신 스키마(entries) 우선, 아니면 서버가 구형→entries 변환하도록 그대로 전달
  if (Array.isArray(b.entries)) return b;
  return b; // 서버 PUT 의 normalize 가 구형(terms/translationTerms) 처리
}

export default function TermsConfigPage({ user, embedded }) {
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState([]);
  const [served, setServed] = useState(['ko', 'en', 'ja', 'zh']);
  const [catScope, setCatScope] = useState(DEFAULT_CAT_SCOPE);
  const [tab, setTab] = useState('airline');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [q, setQ] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [val, setVal] = useState(null); // { results:[{lang,ok,bytes,error}] }
  const [validating, setValidating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    api.termsConfig().then((c) => {
      setEntries((c.entries || []).map((e) => ({ ...e, _k: uid() })));
      if (Array.isArray(c.servedLangs) && c.servedLangs.length) setServed(c.servedLangs);
      if (c.categoryScope) setCatScope({ ...DEFAULT_CAT_SCOPE, ...c.categoryScope });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const mark = () => { setDirty(true); setOkMsg(''); setVal(null); };
  const servedForeign = served.filter((l) => l !== 'ko');

  const setEntry = (k, patch) => { setEntries((arr) => arr.map((e) => (e._k === k ? { ...e, ...patch } : e))); mark(); };
  const setName = (k, lg, v) => setEntries((arr) => arr.map((e) => (e._k === k ? { ...e, names: { ...e.names, [lg]: v } } : e))) || mark();
  const addEntry = () => { setEntries((arr) => [{ _k: uid(), id: uid(), category: tab, scope: ['*'], names: { ko: '' }, mode: 'pair' }, ...arr]); mark(); };
  const removeEntry = (k) => { setEntries((arr) => arr.filter((e) => e._k !== k)); mark(); };

  const gauge = useMemo(() => servedForeign.map((lg) => ({ lang: lg, bytes: contextSizeFor(entries, catScope, lg, false) })), [entries, catScope, servedForeign]);
  const maxBytes = Math.max(0, ...gauge.map((g) => g.bytes));

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return entries.filter((e) => e.category === tab)
      .filter((e) => !onlyIncomplete || isIncomplete(e, served))
      .filter((e) => !kw || ALL_LANGS.some((lg) => cleanStr(e.names[lg]).toLowerCase().includes(kw)));
  }, [entries, tab, onlyIncomplete, q, served]);
  const incompleteCount = useMemo(() => entries.filter((e) => isIncomplete(e, served)).length, [entries, served]);

  const save = async () => {
    setSaving(true); setErr(''); setOkMsg('');
    try {
      const clean = entries.map((e) => {
        const names = {}; for (const lg of ALL_LANGS) { const v = cleanStr(e.names[lg]); if (v) names[lg] = v; }
        return { id: e.id, category: e.category, scope: e.scope && e.scope.length ? e.scope : ['*'], names, mode: e.mode };
      }).filter((e) => e.names.ko);
      const c = await api.saveTermsConfig({ version: 3, servedLangs: served, categoryScope: catScope, entries: clean });
      setEntries((c.entries || []).map((e) => ({ ...e, _k: uid() })));
      setDirty(false); setOkMsg('저장되었습니다. 다음 세션 시작부터 적용됩니다.');
    } catch (e) { setErr(e.message || '저장 실패'); } finally { setSaving(false); }
  };
  const validate = async () => {
    setValidating(true); setErr('');
    try { setVal(await api.validateTermsConfig()); }
    catch (e) { setErr(e.message || '검증 실패 (SONIOX_API_KEY 확인)'); } finally { setValidating(false); }
  };
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ version: 3, servedLangs: served, categoryScope: catScope, entries: entries.map(({ _k, ...e }) => e) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'terms-config.json'; a.click(); URL.revokeObjectURL(a.href);
  };
  const uploadJson = async (file) => {
    if (!file) return;
    try {
      const parsed = normalizeUploadEntries(JSON.parse(await file.text()));
      const c = await api.saveTermsConfig(parsed); // 서버가 구형·신형 모두 정규화
      setEntries((c.entries || []).map((e) => ({ ...e, _k: uid() })));
      if (Array.isArray(c.servedLangs)) setServed(c.servedLangs);
      if (c.categoryScope) setCatScope({ ...DEFAULT_CAT_SCOPE, ...c.categoryScope });
      setDirty(false); setOkMsg('JSON 을 불러와 저장했습니다.');
    } catch (e) { setErr('JSON 을 읽을 수 없습니다: ' + (e.message || '')); } finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  // 오탈자·오번역 검사 → 채택 시 entry 생성
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
    // 외국어→ko 오인식/약칭 성격 → inputOnly, scope 는 현재 탭이 언어면 그 언어, 아니면 전체
    setEntries((arr) => [{ _k: uid(), id: uid(), category: tab === 'aviation' ? 'aviation' : 'facility', scope: ['*'], names: { ko, en: other }, mode: 'inputOnly' }, ...arr]);
    setSugResult((r) => r && { ...r, suggestions: r.suggestions.filter((x) => x !== s) });
    mark();
  };

  const gaugeBar = (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
      {gauge.map((g) => {
        const over = g.bytes > CTX_LIMIT;
        const v = val && val.results && val.results.find((r) => r.lang === g.lang);
        return (
          <Tooltip key={g.lang} title={`${LANG_LABEL[g.lang]} 세션(ko↔${g.lang}) context ${g.bytes.toLocaleString()}자 / ${CTX_LIMIT.toLocaleString()}${v ? (v.ok ? ' · soniox 검증 통과' : ' · 검증 실패: ' + (v.error || '')) : ''}`}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.4, borderRadius: 1.5, border: 1, borderColor: over ? 'error.main' : 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.02) }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700 }}>{LANG_LABEL[g.lang]}</Typography>
              <Typography sx={{ fontSize: 11.5, color: over ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{g.bytes.toLocaleString()}</Typography>
              {v && (v.ok ? <CheckCircleIcon sx={{ fontSize: 14, color: 'success.main' }} /> : <ErrorOutlineIcon sx={{ fontSize: 14, color: 'error.main' }} />)}
            </Box>
          </Tooltip>
        );
      })}
      {isAdmin && <Button size="small" onClick={validate} disabled={validating} sx={{ fontSize: 11.5, py: 0.2, color: 'text.secondary' }}>{validating ? '검증 중…' : 'soniox 실검증'}</Button>}
    </Box>
  );

  const headerBtns = isAdmin && (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Button size="small" onClick={() => setSettingsOpen(true)} sx={{ color: 'text.secondary' }}>언어·적용대상</Button>
      <Button size="small" startIcon={<FileDownloadIcon />} onClick={downloadJson} sx={{ color: 'text.secondary' }}>JSON</Button>
      <Button size="small" startIcon={<FileUploadIcon />} onClick={() => fileRef.current && fileRef.current.click()} sx={{ color: 'text.secondary' }}>업로드</Button>
      <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={save} disabled={saving || !dirty}>{saving ? '저장 중…' : '저장'}</Button>
    </Box>
  );

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
        <Box sx={{ maxWidth: embedded ? '100%' : 960, mx: 'auto' }}>
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
                  {CATS.map((c) => <Tab key={c.key} value={c.key} label={`${c.label} (${entries.filter((e) => e.category === c.key).length})`} />)}
                </Tabs>
                <Box sx={{ flex: 1 }} />
                <TextField size="small" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} sx={{ width: 140 }} />
                <Chip size="small" label={`미완성 ${incompleteCount}`} color={onlyIncomplete ? 'warning' : 'default'} variant={onlyIncomplete ? 'filled' : 'outlined'} onClick={() => setOnlyIncomplete((v) => !v)} sx={{ cursor: 'pointer' }} />
                {isAdmin && <Button size="small" startIcon={<AddIcon />} onClick={addEntry}>추가</Button>}
              </Box>

              <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mb: 1 }}>
                {tab === 'aviation' && !catScope.aviation.desk && '항공용어는 안내데스크 세션에는 주입되지 않습니다(손님 응대 무관). '}
                입력 전용(약칭·오인식)은 외국어→한국어 한 방향만 적용됩니다. 비워 둔 언어는 대체되지 않습니다(필수).
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {shown.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 2, textAlign: 'center' }}>항목이 없습니다.</Typography>}
                {shown.map((e) => {
                  const scoped = Array.isArray(e.scope) && !e.scope.includes('*');
                  const langsToShow = e.mode === 'recognize' ? ['ko'] : (scoped ? ['ko', ...e.scope.filter((s) => s !== 'ko')] : served);
                  const incomplete = isIncomplete(e, served);
                  return (
                    <Paper key={e._k} variant="outlined" sx={{ borderRadius: 1.5, p: 1.5, borderColor: incomplete ? 'warning.main' : 'divider' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <Select size="small" value={e.mode} disabled={!isAdmin} onChange={(ev) => setEntry(e._k, { mode: ev.target.value })} sx={{ minWidth: 160, fontSize: 13 }}>
                          {MODES.map((m) => <MenuItem key={m.v} value={m.v} sx={{ fontSize: 13 }}>{m.label}</MenuItem>)}
                        </Select>
                        {e.mode !== 'recognize' && (
                          <Select size="small" multiple={false} value={scoped ? (e.scope[0] || '*') : '*'} disabled={!isAdmin}
                            onChange={(ev) => setEntry(e._k, { scope: ev.target.value === '*' ? ['*'] : [ev.target.value] })} sx={{ minWidth: 120, fontSize: 13 }}>
                            <MenuItem value="*" sx={{ fontSize: 13 }}>전체 언어</MenuItem>
                            {servedForeign.map((lg) => <MenuItem key={lg} value={lg} sx={{ fontSize: 13 }}>{LANG_LABEL[lg]}만</MenuItem>)}
                          </Select>
                        )}
                        <Tooltip title={MODES.find((m) => m.v === e.mode)?.hint || ''}><Chip size="small" label="?" sx={{ height: 20, width: 20, fontSize: 11, cursor: 'help' }} /></Tooltip>
                        {incomplete && <Chip size="small" color="warning" label="미완성" sx={{ height: 20, fontSize: 11 }} />}
                        <Box sx={{ flex: 1 }} />
                        {isAdmin && <IconButton size="small" onClick={() => removeEntry(e._k)}><DeleteOutlineIcon fontSize="small" /></IconButton>}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {langsToShow.map((lg) => (
                          <TextField key={lg} size="small" label={LANG_LABEL[lg] + (lg === 'ko' ? (e.mode === 'recognize' ? ' (표기)' : ' (필수·타깃)') : '')}
                            value={e.names[lg] || ''} disabled={!isAdmin} onChange={(ev) => setName(e._k, lg, ev.target.value)}
                            sx={{ flex: '1 1 180px', minWidth: 150 }} InputLabelProps={{ sx: { fontSize: 12 } }} />
                        ))}
                      </Box>
                    </Paper>
                  );
                })}
              </Box>

              {/* 오탈자·오번역 검사 */}
              {isAdmin && (
                <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>오탈자·오번역 검사</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>대화 로그를 AI 로 단어 단위 대조해 오탈자·오역 후보를 찾습니다. 채택 시 현재 탭에 '입력 전용' 항목으로 추가됩니다. (OpenAI 전송)</Typography>
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
          <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 1 }}>선택한 언어는 모든 양방향 용어에서 필수로 채워야 합니다. 한국어는 항상 포함.</Typography>
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
