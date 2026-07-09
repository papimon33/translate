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
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import FileDownloadIcon from '@mui/icons-material/FileDownloadOutlined';
import FileUploadIcon from '@mui/icons-material/FileUploadOutlined';
import ScienceIcon from '@mui/icons-material/ScienceOutlined';
import { alpha } from '@mui/material/styles';
import { api } from '../api.js';

// 고유명사(카테고리별) + 번역 설정(행당 다국어 표기). 세션(Soniox) 연결 시
// 활성 언어쌍의 표기만 골라 context 로 주입된다. 전원 열람, 관리자만 수정.
const TERM_LANGS = ['ko', 'en', 'ja', 'zh', 'es', 'fr', 'pt', 'ar'];
const LANG_LABEL = { ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어', fr: '프랑스어', pt: '포르투갈어', ar: '아랍어' };
const CATS = [
  { key: 'airline', label: '항공사', hint: '취항 항공사 이름. 인식 정확도를 높입니다. (예: 대한항공)' },
  { key: 'aviation', label: '항공용어', hint: '항공 약어·기관명·전문용어. (예: ICAO, NOTAM)' },
  { key: 'etc', label: '기타', hint: '그 외 자주 등장하는 고유명사·시설명.' },
];
const EMPTY_TERMS = { airline: [], aviation: [], etc: [] };
const CTX_LIMIT = 10000; // Soniox context 한도(8,000토큰 ≈ 10,000자)

// 서버 buildSonioxContext 와 동일한 규칙으로 언어쌍(ko↔lang) 컨텍스트 크기를 추정
function contextSizeFor(terms, rows, lang) {
  const L = lang === 'ko' ? ['ko'] : ['ko', lang];
  const val = (row, lg) => String(row[lg] || (lg !== 'en' && row.en) || row.ko || '').trim();
  const set = new Set(CATS.flatMap((c) => terms[c.key] || []).map((x) => String(x || '').trim()).filter(Boolean));
  const pairs = [];
  const seen = new Set();
  const addPair = (s, t) => { if (!s || !t || s === t) return; const k = s + '||' + t; if (!seen.has(k)) { seen.add(k); pairs.push({ source: s, target: t }); } };
  for (const row of rows) {
    if (!row || !row.ko) continue;
    for (const lg of L) { const v = val(row, lg); if (v) set.add(v); }
    if (row.alt && typeof row.alt === 'object') {
      for (const lg of L) {
        if (lg === 'ko') continue;
        for (const a of (Array.isArray(row.alt[lg]) ? row.alt[lg] : [])) {
          const av = String(a || '').trim();
          if (!av || av === row.ko) continue;
          set.add(av);
          if (L.includes('ko')) addPair(av, row.ko);
        }
      }
    }
    for (const a of L) for (const b of L) { if (a !== b) addPair(val(row, a), val(row, b)); }
  }
  const ctx = {};
  if (set.size) ctx.terms = [...set];
  if (pairs.length) ctx.translation_terms = pairs;
  return JSON.stringify(ctx).length;
}

// 업로드 JSON 정규화(구형 배열/{source,target} 포함) — 서버 normalize 와 동일 규칙
function normalizeUpload(b) {
  const clean = (v) => String(v == null ? '' : v).trim().slice(0, 80);
  const terms = { airline: [], aviation: [], etc: [] };
  if (Array.isArray(b.terms)) terms.etc = b.terms.map(clean).filter(Boolean);
  else if (b.terms && typeof b.terms === 'object') {
    for (const c of Object.keys(terms)) if (Array.isArray(b.terms[c])) terms[c] = b.terms[c].map(clean).filter(Boolean);
  }
  for (const c of Object.keys(terms)) terms[c] = [...new Set(terms[c])];
  const rows = [];
  for (const r of Array.isArray(b.translationTerms) ? b.translationTerms : []) {
    if (!r || typeof r !== 'object') continue;
    const row = {};
    if (r.source != null || r.target != null) {
      if (clean(r.target)) row.ko = clean(r.target);
      if (clean(r.source)) row.en = clean(r.source);
    } else {
      for (const lg of TERM_LANGS) { const v = clean(r[lg]); if (v) row[lg] = v; }
      if (r.alt && typeof r.alt === 'object') {
        const alt = {};
        for (const lg of TERM_LANGS) {
          if (!Array.isArray(r.alt[lg])) continue;
          const arr = [...new Set(r.alt[lg].map((x) => clean(x)).filter(Boolean))];
          if (arr.length) alt[lg] = arr;
        }
        if (Object.keys(alt).length) row.alt = alt;
      }
    }
    if (row.ko) rows.push(row);
  }
  return { terms, translationTerms: rows };
}

// 카테고리별 고유명사 칩 입력
function TermChips({ cat, values, isAdmin, onAdd, onRemove }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    setInput('');
    onAdd(cat, v);
  };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !input && values.length) onRemove(cat, values[values.length - 1]);
  };
  return (
    <Box
      sx={{
        display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center',
        p: 1.25, borderRadius: 2, minHeight: 52,
        border: 1, borderColor: 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.015),
      }}
    >
      {values.map((t) => (
        <Chip key={t} label={t} size="small" onDelete={isAdmin ? () => onRemove(cat, t) : undefined} sx={{ fontWeight: 600 }} />
      ))}
      {isAdmin && (
        <Box
          component="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          onBlur={add}
          placeholder={values.length ? '입력 후 Enter' : '용어 입력 후 Enter'}
          sx={{
            flex: 1, minWidth: 160, border: 'none', outline: 'none', background: 'transparent',
            color: 'text.primary', fontSize: 14, py: 0.5, px: 0.5, fontFamily: 'inherit',
          }}
        />
      )}
      {!isAdmin && !values.length && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>등록된 용어가 없습니다.</Typography>}
    </Box>
  );
}

// 행별 축약/구어 표기(alt) 편집기 — 선택 언어(lang) 기준. (예: 中国国际航空 행에 国航)
function AltChips({ i, lang, values, isAdmin, onAdd, onRemove }) {
  const [input, setInput] = useState('');
  const add = () => { const v = input.trim(); if (!v) return; setInput(''); onAdd(i, lang, v); };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !input && values.length) onRemove(i, lang, values[values.length - 1]);
  };
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, pl: 0.5 }}>
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', flex: 'none', mr: 0.5 }}>약어·구어</Typography>
      {values.map((t) => (
        <Chip key={t} label={t} size="small" variant="outlined" onDelete={isAdmin ? () => onRemove(i, lang, t) : undefined} sx={{ height: 22, fontSize: 12 }} />
      ))}
      {isAdmin && (
        <Box component="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} onBlur={add}
          placeholder={values.length ? '' : '축약형 입력 후 Enter (예: 国航)'}
          sx={{ flex: 1, minWidth: 120, border: 'none', outline: 'none', background: 'transparent', color: 'text.secondary', fontSize: 12.5, py: 0.25, fontFamily: 'inherit' }} />
      )}
    </Box>
  );
}

export default function TermsConfigPage({ user, embedded }) {
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState(EMPTY_TERMS);
  const [rows, setRows] = useState([]); // translationTerms: [{ko,en,ja,...}]
  const [tLang, setTLang] = useState('en'); // 번역 설정에서 편집 중인 언어
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    api
      .termsConfig()
      .then((c) => {
        setTerms(c.terms && !Array.isArray(c.terms) ? { ...EMPTY_TERMS, ...c.terms } : EMPTY_TERMS);
        setRows(Array.isArray(c.translationTerms) ? c.translationTerms : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const mark = () => { setDirty(true); setOkMsg(''); };

  const addTerm = (cat, v) => { setTerms((t) => (t[cat].includes(v) ? t : { ...t, [cat]: [...t[cat], v] })); mark(); };
  const removeTerm = (cat, v) => { setTerms((t) => ({ ...t, [cat]: t[cat].filter((x) => x !== v) })); mark(); };

  const addRow = () => { setRows((arr) => [...arr, { ko: '' }]); mark(); };
  const setRowVal = (i, lg, v) => { setRows((arr) => arr.map((r, j) => (j === i ? { ...r, [lg]: v } : r))); mark(); };
  const removeRow = (i) => { setRows((arr) => arr.filter((_, j) => j !== i)); mark(); };
  // 축약/구어 표기(alt) — 선택 언어(tLang) 기준 추가/삭제. 인식 힌트 + '축약형→한국어' 번역으로 쓰임.
  const addAlt = (i, lg, v) => setRows((arr) => arr.map((r, j) => {
    if (j !== i) return r;
    const cur = (r.alt && r.alt[lg]) || [];
    if (cur.includes(v)) return r;
    return { ...r, alt: { ...(r.alt || {}), [lg]: [...cur, v] } };
  })) || mark();
  const removeAlt = (i, lg, v) => setRows((arr) => arr.map((r, j) => {
    if (j !== i) return r;
    const cur = ((r.alt && r.alt[lg]) || []).filter((x) => x !== v);
    const alt = { ...(r.alt || {}) };
    if (cur.length) alt[lg] = cur; else delete alt[lg];
    return { ...r, alt: Object.keys(alt).length ? alt : undefined };
  })) || mark();

  // 컨텍스트 크기 게이지: 실제 세션은 언어쌍(ko↔선택언어) 단위로 조립되므로 '가장 큰 쌍' 기준으로 표시
  const ctxSize = useMemo(() => {
    let max = 0, maxLang = 'en';
    for (const lg of TERM_LANGS.filter((l) => l !== 'ko')) {
      const n = contextSizeFor(terms, rows, lg);
      if (n > max) { max = n; maxLang = lg; }
    }
    return { max, maxLang };
  }, [terms, rows]);

  // JSON 내려받기/업로드 (고유명사 + 번역 설정 통째)
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify({ terms, translationTerms: rows }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'terms-config.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const uploadJson = async (file) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const norm = normalizeUpload(parsed);
      setTerms(norm.terms);
      setRows(norm.translationTerms);
      mark();
      setOkMsg('JSON 을 불러왔습니다 — 내용 확인 후 저장을 눌러야 반영됩니다.');
    } catch {
      setErr('JSON 파일을 읽을 수 없습니다. 내려받은 형식({terms, translationTerms})인지 확인하세요.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // 오탈자·오번역 검사(관리자)
  const [sugBusy, setSugBusy] = useState(false);
  const [sugResult, setSugResult] = useState(null); // { checked, suggestions: [{source,target,wrong,reason}] }
  const [pickOpen, setPickOpen] = useState(false);
  const [pickList, setPickList] = useState(null);
  const [selIds, setSelIds] = useState([]);
  const runSuggest = async (ids) => {
    setPickOpen(false); setSugBusy(true); setErr('');
    try { setSugResult(await api.adminTermsSuggest(ids && ids.length ? ids : undefined)); }
    catch (e) { setErr(e.message || '오탈자·오번역 검사 실패'); }
    finally { setSugBusy(false); }
  };
  const openPick = async () => {
    setPickOpen(true);
    try {
      const d = await api.adminLogs();
      const list = [
        ...(d.desks || []).map((x) => ({ id: x.id, title: x.title, kind: '안내데스크', count: x.logs.reduce((a, e) => a + (e.count || 0), 0) })),
        ...(d.sessions || []).map((x) => ({ id: x.id, title: x.title, kind: '세션', count: x.count || 0 })),
      ];
      setPickList(list);
      setSelIds((ids) => ids.filter((id) => list.some((p) => p.id === id)));
    } catch { if (!pickList) setPickList([]); }
  };
  const togglePick = (id) => setSelIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  const adoptSuggestion = (s) => {
    // 한글 포함 여부로 방향 판별: 한글 쪽을 ko, 반대쪽을 현재 편집 언어 열에 넣는다
    const hasKo = /[가-힣]/.test(s.source);
    const ko = hasKo ? s.source : s.target;
    const other = hasKo ? s.target : s.source;
    setRows((arr) => (arr.some((r) => r.ko === ko)
      ? arr.map((r) => (r.ko === ko ? { ...r, [tLang]: other } : r))
      : [...arr, { ko, [tLang]: other }]));
    setSugResult((r) => r && { ...r, suggestions: r.suggestions.filter((x) => x !== s) });
    mark();
  };

  const save = async () => {
    setSaving(true); setErr(''); setOkMsg('');
    try {
      const cleanRows = rows
        .map((r) => {
          const o = {};
          for (const lg of TERM_LANGS) { const v = (r[lg] || '').trim(); if (v) o[lg] = v; }
          if (r.alt && typeof r.alt === 'object') o.alt = r.alt; // 축약형(alt) 보존 — 서버가 정규화
          return o;
        })
        .filter((r) => r.ko);
      const c = await api.saveTermsConfig({ terms, translationTerms: cleanRows });
      setTerms(c.terms && !Array.isArray(c.terms) ? { ...EMPTY_TERMS, ...c.terms } : EMPTY_TERMS);
      setRows(Array.isArray(c.translationTerms) ? c.translationTerms : []);
      setDirty(false);
      setOkMsg('저장되었습니다. 다음 세션 시작부터 적용됩니다.');
    } catch (e) {
      setErr(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  // 우상단(저장 아래) 컨텍스트 크기 게이지
  const gauge = (
    <Box sx={{ minWidth: 190, textAlign: 'right' }}>
      <Typography sx={{ fontSize: 11.5, color: ctxSize.max > CTX_LIMIT ? 'error.main' : 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
        {ctxSize.max.toLocaleString()} / {CTX_LIMIT.toLocaleString()}자
        <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>(최대 쌍: {LANG_LABEL[ctxSize.maxLang]})</Box>
      </Typography>
      <LinearProgress
        variant="determinate"
        value={Math.min(100, (ctxSize.max / CTX_LIMIT) * 100)}
        color={ctxSize.max > CTX_LIMIT ? 'error' : ctxSize.max > CTX_LIMIT * 0.8 ? 'warning' : 'primary'}
        sx={{ height: 4, borderRadius: 2, mt: 0.5 }}
      />
    </Box>
  );

  const headerButtons = isAdmin && (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.75 }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" startIcon={<ScienceIcon />} onClick={() => window.open('/eval.html', '_blank')} sx={{ color: 'text.secondary' }}>평가 러너</Button>
        <Button size="small" startIcon={<FileDownloadIcon />} onClick={downloadJson} sx={{ color: 'text.secondary' }}>JSON</Button>
        <Button size="small" startIcon={<FileUploadIcon />} onClick={() => fileRef.current && fileRef.current.click()} sx={{ color: 'text.secondary' }}>업로드</Button>
        <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={save} disabled={saving || !dirty}>
          {saving ? '저장 중…' : '저장'}
        </Button>
      </Box>
      {gauge}
    </Box>
  );

  return (
    <>
      <Box component="input" type="file" accept=".json,application/json" ref={fileRef} onChange={(e) => uploadJson(e.target.files && e.target.files[0])} sx={{ display: 'none' }} />
      {!embedded && (
        <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'flex-start', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">용어 설정</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              세션 시작 시 음성인식·번역에 반영됩니다{isAdmin ? '' : ' · 수정은 관리자만 가능'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {headerButtons}
        </Box>
      )}

      <Box sx={{ flex: embedded ? 'none' : 1, minHeight: 0, overflow: embedded ? 'visible' : 'auto', p: embedded ? 0 : { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: embedded ? '100%' : 880, mx: 'auto' }}>
          {embedded && (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.5 }}>
                세션 시작 시 음성인식·번역에 반영됩니다{isAdmin ? '' : ' · 수정은 관리자만 가능'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {headerButtons}
            </Box>
          )}
          {okMsg && <Alert severity="success" sx={{ mb: 2 }}>{okMsg}</Alert>}
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          {ctxSize.max > CTX_LIMIT && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              설정이 Soniox 한도({CTX_LIMIT.toLocaleString()}자)를 넘어 일부가 잘려 전송됩니다 — 사용 빈도가 낮은 용어를 정리하세요.
            </Alert>
          )}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8, gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={18} /> <Typography sx={{ fontSize: 14 }}>불러오는 중…</Typography>
            </Box>
          ) : (
            <>
              {/* 고유명사 — 항공사/항공용어/기타 3분류 */}
              <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mb: 3 }}>
                <Typography sx={{ fontWeight: 800, fontSize: 15 }}>고유명사</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                  자주 등장하는 이름·약어·전문용어. 음성 인식 정확도를 높입니다.
                </Typography>
                {CATS.map((c) => (
                  <Box key={c.key} sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>{c.label}</Typography>
                      <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>{c.hint} · {(terms[c.key] || []).length}개</Typography>
                    </Box>
                    <TermChips cat={c.key} values={terms[c.key] || []} isAdmin={isAdmin} onAdd={addTerm} onRemove={removeTerm} />
                  </Box>
                ))}
                {isAdmin && <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1 }}>Enter 또는 쉼표로 추가 · 칩의 ✕ 또는 빈 입력에서 Backspace로 삭제</Typography>}
              </Paper>

              {/* 번역 설정 — 언어별 편집(행당 다국어 표기) */}
              <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1, gap: 1, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 15 }}>번역 설정</Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                      용어마다 언어별 표기를 지정합니다. 세션에서는 그 세션의 언어쌍 표기만 적용됩니다.
                    </Typography>
                  </Box>
                  <Select size="small" value={tLang} onChange={(e) => setTLang(e.target.value)} sx={{ minWidth: 130 }}>
                    {TERM_LANGS.filter((l) => l !== 'ko').map((l) => (
                      <MenuItem key={l} value={l}>{LANG_LABEL[l]}</MenuItem>
                    ))}
                  </Select>
                  {isAdmin && <Button size="small" startIcon={<AddIcon />} onClick={addRow}>추가</Button>}
                </Box>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mb: 1.5 }}>
                  비워 둔 언어는 영어 표기로 대체되고, 영어도 없으면 한국어 표기를 그대로 씁니다. (항공사 등 고유명사는 대부분 영어 표기 하나면 충분)
                </Typography>

                {rows.length === 0 && (
                  <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 1 }}>등록된 번역 설정이 없습니다.</Typography>
                )}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                  {rows.map((r, i) => (
                    <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <TextField
                          size="small" placeholder="한국어 표기" value={r.ko || ''}
                          onChange={(e) => setRowVal(i, 'ko', e.target.value)}
                          disabled={!isAdmin} sx={{ flex: 1 }}
                        />
                        <ArrowForwardIcon sx={{ fontSize: 18, color: 'text.disabled', flex: 'none' }} />
                        <TextField
                          size="small"
                          placeholder={`${LANG_LABEL[tLang]} 표기${r.en && tLang !== 'en' ? ` (비면 ${r.en})` : ''}`}
                          value={r[tLang] || ''}
                          onChange={(e) => setRowVal(i, tLang, e.target.value)}
                          disabled={!isAdmin} sx={{ flex: 1 }}
                        />
                        {isAdmin && (
                          <IconButton size="small" onClick={() => removeRow(i)} sx={{ flex: 'none' }}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        )}
                      </Box>
                      {(isAdmin || ((r.alt && r.alt[tLang]) || []).length > 0) && (
                        <AltChips i={i} lang={tLang} values={(r.alt && r.alt[tLang]) || []} isAdmin={isAdmin} onAdd={addAlt} onRemove={removeAlt} />
                      )}
                    </Box>
                  ))}
                </Box>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1.5 }}>
                  약어·구어 표기(예: 中国国际航空 → 国航)는 인식 정확도를 높이고 '축약형 → 한국어 정식명' 번역으로 반영됩니다.
                </Typography>
              </Paper>

              {/* 오탈자·오번역 검사(관리자): 최근 대화 원문·번역을 AI 로 단어 단위 검수 → 용어 추천 */}
              {isAdmin && (
                <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>오탈자·오번역 검사</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                        대화의 원문과 번역을 AI 가 단어 단위로 대조해, 오탈자나 잘못 번역된 고유명사·시설명 단어를 찾아 용어 후보로 추천합니다.
                        안내데스크 응대 기록도 포함됩니다. 검사 시 대화 내용이 외부 AI 서비스(OpenAI)로 전송됩니다.
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, flex: 'none' }}>
                      <Button size="small" onClick={openPick} disabled={sugBusy} sx={{ color: 'text.secondary' }}>대상 선택…</Button>
                      <Button size="small" variant="outlined" onClick={() => runSuggest()} disabled={sugBusy}>
                        {sugBusy ? '검사 중…' : '최근 전체 검사'}
                      </Button>
                    </Box>
                  </Box>
                  {sugResult && sugResult.suggestions.length === 0 && (
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      최근 대화 {sugResult.checked}건을 확인했지만 추천할 오탈자·오번역을 찾지 못했습니다.
                    </Typography>
                  )}
                  {sugResult && sugResult.suggestions.length > 0 && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      {sugResult.suggestions.map((s, i) => (
                        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, borderRadius: 2, border: 1, borderColor: 'divider' }}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography sx={{ fontSize: 14, fontWeight: 700 }}>
                              {s.source} → {s.target}
                              {s.wrong && <Box component="span" sx={{ fontWeight: 500, color: 'error.main', fontSize: 12.5, ml: 1 }}>현재: {s.wrong}</Box>}
                            </Typography>
                            {s.reason && <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{s.reason}</Typography>}
                          </Box>
                          <Button size="small" variant="contained" disableElevation onClick={() => adoptSuggestion(s)}>추가</Button>
                        </Box>
                      ))}
                      <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
                        추가한 항목은 번역 설정의 [{LANG_LABEL[tLang]}] 열에 들어갑니다 — 저장을 눌러야 반영됩니다.
                      </Typography>
                    </Box>
                  )}
                </Paper>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* 검사 대상 선택: 특정 세션·안내데스크(응대 로그 포함)만 골라 검사 */}
      <Dialog open={pickOpen} onClose={() => setPickOpen(false)} PaperProps={{ sx: { width: 440, maxWidth: 440 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>검사 대상 선택</DialogTitle>
        <DialogContent>
          {!pickList && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>목록을 불러오는 중…</Typography>}
          {pickList && pickList.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>검사할 대화가 없습니다.</Typography>}
          {pickList && pickList.map((p) => (
            <Box key={p.id} onClick={() => togglePick(p.id)}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.25, cursor: 'pointer', borderRadius: 1, '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.04) } }}>
              <Checkbox size="small" checked={selIds.includes(p.id)} sx={{ p: 0.75 }} />
              <Typography sx={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.title}</Typography>
              <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 'none' }}>{p.kind} · {p.count}문장</Typography>
            </Box>
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setSelIds([])} disabled={!selIds.length} sx={{ mr: 'auto', color: 'text.secondary' }}>선택 해제</Button>
          <Button onClick={() => setPickOpen(false)}>취소</Button>
          <Button variant="contained" onClick={() => runSuggest(selIds)} disabled={!selIds.length || sugBusy}>선택 대상 검사</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
