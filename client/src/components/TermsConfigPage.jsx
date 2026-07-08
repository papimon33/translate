import React, { useEffect, useState } from 'react';
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
import AddIcon from '@mui/icons-material/Add';
import SaveIcon from '@mui/icons-material/Save';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { alpha } from '@mui/material/styles';
import { api } from '../api.js';

// 고유명사(terms) + 번역 설정(translation_terms). 세션(Soniox) 연결 시 context로 주입.
// 전원 열람, 관리자만 수정.
export default function TermsConfigPage({ user, embedded }) {
  const isAdmin = user?.role === 'admin';
  const [loading, setLoading] = useState(true);
  const [terms, setTerms] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [input, setInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState('');
  const [okMsg, setOkMsg] = useState('');

  useEffect(() => {
    api
      .termsConfig()
      .then((c) => {
        setTerms(c.terms || []);
        setPairs(c.translationTerms || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const mark = () => { setDirty(true); setOkMsg(''); };

  const addTerm = () => {
    const v = input.trim();
    if (!v) return;
    setInput('');
    setTerms((arr) => (arr.includes(v) ? arr : [...arr, v]));
    mark();
  };
  const removeTerm = (t) => { setTerms((arr) => arr.filter((x) => x !== t)); mark(); };
  const onInputKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTerm(); }
    else if (e.key === 'Backspace' && !input && terms.length) removeTerm(terms[terms.length - 1]);
  };

  const addPair = () => { setPairs((arr) => [...arr, { source: '', target: '' }]); mark(); };
  const setPair = (i, k, v) => { setPairs((arr) => arr.map((p, j) => (j === i ? { ...p, [k]: v } : p))); mark(); };
  const removePair = (i) => { setPairs((arr) => arr.filter((_, j) => j !== i)); mark(); };

  // 오번역 검사: 대화(일반 세션 + 데스크 응대 로그)의 원문·번역을 AI 로 검수해 용어 후보 추천(관리자)
  const [sugBusy, setSugBusy] = useState(false);
  const [sugResult, setSugResult] = useState(null); // { checked, suggestions: [{source,target,wrong,reason}] }
  const [pickOpen, setPickOpen] = useState(false); // 검사 대상 선택 다이얼로그
  const [pickList, setPickList] = useState(null); // [{ id, title, kind, count }]
  const [selIds, setSelIds] = useState([]);
  const runSuggest = async (ids) => {
    setPickOpen(false); setSugBusy(true); setErr('');
    try { setSugResult(await api.adminTermsSuggest(ids && ids.length ? ids : undefined)); }
    catch (e) { setErr(e.message || '오번역 검사 실패'); }
    finally { setSugBusy(false); }
  };
  const openPick = async () => {
    setPickOpen(true);
    if (pickList) return;
    try {
      const d = await api.adminLogs();
      setPickList([
        ...(d.desks || []).map((x) => ({ id: x.id, title: x.title, kind: '안내데스크', count: x.logs.reduce((a, e) => a + (e.count || 0), 0) })),
        ...(d.sessions || []).map((x) => ({ id: x.id, title: x.title, kind: '세션', count: x.count || 0 })),
      ]);
    } catch { setPickList([]); }
  };
  const togglePick = (id) => setSelIds((arr) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]));
  const adoptSuggestion = (s) => {
    setPairs((arr) => (arr.some((p) => p.source === s.source) ? arr : [...arr, { source: s.source, target: s.target }]));
    setSugResult((r) => r && { ...r, suggestions: r.suggestions.filter((x) => x !== s) });
    mark();
  };

  const save = async () => {
    setSaving(true); setErr(''); setOkMsg('');
    try {
      const clean = pairs.map((p) => ({ source: (p.source || '').trim(), target: (p.target || '').trim() })).filter((p) => p.source && p.target);
      const c = await api.saveTermsConfig({ terms, translationTerms: clean });
      setTerms(c.terms || []);
      setPairs(c.translationTerms || []);
      setDirty(false);
      setOkMsg('저장되었습니다. 다음 세션 시작부터 적용됩니다.');
    } catch (e) {
      setErr(e.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {!embedded && (
        <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">용어 설정</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
              세션 시작 시 음성인식·번역에 반영됩니다{isAdmin ? '' : ' · 수정은 관리자만 가능'}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          {isAdmin && (
            <Button variant="contained" startIcon={<SaveIcon />} onClick={save} disabled={saving || !dirty}>
              {saving ? '저장 중…' : '저장'}
            </Button>
          )}
        </Box>
      )}

      <Box sx={{ flex: embedded ? 'none' : 1, minHeight: 0, overflow: embedded ? 'visible' : 'auto', p: embedded ? 0 : { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: embedded ? '100%' : 880, mx: 'auto' }}>
          {embedded && (
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                세션 시작 시 음성인식·번역에 반영됩니다{isAdmin ? '' : ' · 수정은 관리자만 가능'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              {isAdmin && (
                <Button variant="contained" size="small" startIcon={<SaveIcon />} onClick={save} disabled={saving || !dirty}>
                  {saving ? '저장 중…' : '저장'}
                </Button>
              )}
            </Box>
          )}
          {okMsg && <Alert severity="success" sx={{ mb: 2 }}>{okMsg}</Alert>}
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 8, gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={18} /> <Typography sx={{ fontSize: 14 }}>불러오는 중…</Typography>
            </Box>
          ) : (
            <>
              {/* 고유명사 */}
              <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mb: 3 }}>
                <Typography sx={{ fontWeight: 800, fontSize: 15 }}>고유명사</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25, mb: 2 }}>
                  자주 등장하는 약어·기관명·전문용어. 인식 정확도를 높입니다. (예: ICAO, NOTAM)
                </Typography>
                <Box
                  sx={{
                    display: 'flex', flexWrap: 'wrap', gap: 0.75, alignItems: 'center',
                    p: 1.25, borderRadius: 2, minHeight: 52,
                    border: 1, borderColor: 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.015),
                  }}
                >
                  {terms.map((t) => (
                    <Chip key={t} label={t} size="small" onDelete={isAdmin ? () => removeTerm(t) : undefined} sx={{ fontWeight: 600 }} />
                  ))}
                  {isAdmin && (
                    <Box
                      component="input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onInputKey}
                      onBlur={addTerm}
                      placeholder={terms.length ? '입력 후 Enter' : '용어 입력 후 Enter (예: ICAO)'}
                      sx={{
                        flex: 1, minWidth: 160, border: 'none', outline: 'none', background: 'transparent',
                        color: 'text.primary', fontSize: 14, py: 0.5, px: 0.5, fontFamily: 'inherit',
                      }}
                    />
                  )}
                  {!isAdmin && !terms.length && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>등록된 고유명사가 없습니다.</Typography>}
                </Box>
                {isAdmin && <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1 }}>Enter 또는 쉼표로 추가 · 칩의 ✕ 또는 빈 입력에서 Backspace로 삭제</Typography>}
              </Paper>

              {/* 번역 설정 */}
              <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 15 }}>번역 설정</Typography>
                    <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                      특정 단어를 지정한 번역으로 고정합니다. (예: apron → 주기장)
                    </Typography>
                  </Box>
                  {isAdmin && (
                    <Button size="small" startIcon={<AddIcon />} onClick={addPair}>추가</Button>
                  )}
                </Box>

                {pairs.length === 0 && (
                  <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 1 }}>등록된 번역 설정이 없습니다.</Typography>
                )}

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {pairs.map((p, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TextField
                        size="small" placeholder="원문 (source)" value={p.source}
                        onChange={(e) => setPair(i, 'source', e.target.value)}
                        disabled={!isAdmin} sx={{ flex: 1 }}
                      />
                      <ArrowForwardIcon sx={{ fontSize: 18, color: 'text.disabled', flex: 'none' }} />
                      <TextField
                        size="small" placeholder="번역 (target)" value={p.target}
                        onChange={(e) => setPair(i, 'target', e.target.value)}
                        disabled={!isAdmin} sx={{ flex: 1 }}
                      />
                      {isAdmin && (
                        <IconButton size="small" onClick={() => removePair(i)} sx={{ flex: 'none' }}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      )}
                    </Box>
                  ))}
                </Box>
              </Paper>

              {/* 오번역 검사(관리자): 최근 대화 원문·번역을 AI 로 검수 → 용어 추천 */}
              {isAdmin && (
                <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mt: 3 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontWeight: 800, fontSize: 15 }}>오번역 검사</Typography>
                      <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>
                        대화의 원문과 번역을 AI 가 검수해 잘못 번역된 고유명사·시설명을 찾고 용어 후보로 추천합니다.
                        안내데스크 응대 기록도 포함됩니다.
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
                      최근 대화 {sugResult.checked}건을 확인했지만 추천할 오번역을 찾지 못했습니다.
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
                      <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>추가한 항목은 위 번역 설정에 들어갑니다 — 저장을 눌러야 반영됩니다.</Typography>
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
