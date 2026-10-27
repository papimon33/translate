// 관리자 > 로그 탭: 데스크 응대 로그·세션 대화 로그(행 클릭 시 전문)
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import { alpha } from '@mui/material/styles';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import Snackbar from '@mui/material/Snackbar';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { api } from '../shared/api.js';
import { fmtDuration, fmtTime, LANG_KO } from './format.js';
import { EmptyHint } from './EmptyHint.jsx';

// 대화 전문 렌더링(공용): 데스크 응대(안내원/손님) 또는 일반 세션(마이크/시스템)
function TranscriptView({ items, deskMode }) {
  if (!items || !items.length) return <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 1 }}>기록된 대화가 없습니다.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: 1 }}>
      {items.map((it, i) => {
        const staff = deskMode ? (it.lang ? it.lang === 'ko' : it.side === 'right') : it.side === 'right';
        const who = deskMode ? (staff ? '안내원' : '손님') : (staff ? '마이크' : '시스템');
        const main = it.texts ? (Object.values(it.texts).find(Boolean) || '') : (it.text || '');
        return (
          <Box key={it.id || i} sx={{ display: 'flex', gap: 1.25, alignItems: 'baseline' }}>
            <Chip size="small" label={who} color={staff ? 'primary' : 'default'} variant={staff ? 'filled' : 'outlined'} sx={{ height: 20, fontSize: 11, fontWeight: 700, flex: 'none', minWidth: 56 }} />
            <Box sx={{ minWidth: 0 }}>
              {it.source && <Typography sx={{ fontSize: 13.5 }}>{it.source}</Typography>}
              {main && main !== it.source && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{main}</Typography>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// 데스크 응대 상세 → 평가 JSON(records) 변환: 안내원(ko)=답변(a), 손님=질문(q).
// eval/score.mjs --auto 가 시나리오를 자동 매칭하므로 scenario_id 태깅이 필요 없다.
function deskEvalRecords(detail) {
  const lang = detail.lang && detail.lang !== 'ko' ? detail.lang : 'en';
  return (detail.items || [])
    .map((it) => {
      const staff = it.lang ? it.lang === 'ko' : it.side === 'right';
      const texts = it.texts || {};
      const mt = staff
        ? (texts[lang] || Object.entries(texts).find(([k, v]) => v && k !== 'ko')?.[1] || '')
        : (texts.ko || '');
      return { direction: staff ? 'a' : 'q', lang, stt: it.source || '', mt };
    })
    .filter((r) => r.stt || r.mt);
}

function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 로그 탭: 데스크 응대 로그(건당 시각·길이·언어·문장수) + 일반 세션 대화 로그 — 클릭 시 전문 열람
const LOG_TABS = [{ v: 'desk', label: '안내데스크 응대' }, { v: 'session', label: '세션 대화' }];

// 로그 — OpenAI 플랫폼 스타일: 상단 탭·검색, 컬럼 테이블, 행 클릭 시 상세(대화 전문 + 속성) 마스터-디테일
function LogsPanel() {
  const [data, setData] = useState(null); // { desks, sessions }
  const [mode, setMode] = useState('desk'); // 'desk' | 'session'
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null); // 상세: { kind, key, loading, error, detail, meta }
  const [confirmReq, setConfirmReq] = useState(null);
  const [snack, setSnack] = useState('');
  const load = () => api.adminLogs().then(setData).catch(() => setData({ desks: [], sessions: [] }));
  useEffect(() => { load(); }, []);

  const backToList = () => setSel(null);
  const delDeskLog = (r) => setConfirmReq({
    title: '응대 기록 삭제', message: '이 응대 기록을 삭제합니다. 되돌릴 수 없습니다.',
    onOk: async () => { try { await api.adminDeleteDeskLog(r.deskId, r.idx, r.endedAt); setSel(null); await load(); } catch (e) { setSnack(e.message || '삭제 실패'); await load(); } },
  });
  const clearSessionLog = (r) => setConfirmReq({
    title: '대화 기록 삭제', message: '이 세션의 대화 기록을 삭제합니다. 세션 자체는 유지됩니다. 되돌릴 수 없습니다.',
    onOk: async () => { try { await api.adminClearSessionLog(r.id); setSel(null); await load(); } catch (e) { setSnack(e.message || '삭제 실패'); } },
  });

  const openRow = async (kind, r) => {
    const key = kind === 'desk' ? `d:${r.deskId}:${r.idx}` : `s:${r.id}`;
    setSel({ kind, key, loading: true, meta: r });
    try {
      const detail = kind === 'desk' ? await api.adminDeskLog(r.deskId, r.idx) : await api.adminSessionLog(r.id);
      setSel((c) => (c && c.key === key ? { ...c, loading: false, detail } : c));
    } catch (e) {
      setSel((c) => (c && c.key === key ? { ...c, loading: false, error: e.message || '불러오기 실패' } : c));
    }
  };

  if (!data) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;

  // ── 상세 뷰(대화 전문 + 속성) ──
  if (sel) {
    const isDesk = sel.kind === 'desk';
    const m = sel.meta || {};
    const items = sel.detail?.items || [];
    const propRow = (k, v) => (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.9, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 'none' }}>{k}</Typography>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</Typography>
      </Box>
    );
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Button size="small" onClick={backToList} startIcon={<Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" sx={{ width: 15, height: 15 }}><path d="M15 6l-6 6 6 6" /></Box>} sx={{ color: 'text.secondary' }}>로그</Button>
          <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>/</Typography>
          <Typography sx={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isDesk ? `${m.deskTitle} · ${fmtTime(m.endedAt)}` : m.title}
          </Typography>
          <Box sx={{ flex: 1 }} />
          {isDesk && items.length > 0 && (
            <Button size="small" sx={{ fontSize: 12, color: 'text.secondary' }}
              onClick={() => downloadJson({ records: deskEvalRecords(sel.detail) }, `records-${m.deskId}-${m.idx}.json`)}>평가 JSON</Button>
          )}
          <Button size="small" color="error" sx={{ fontSize: 12 }} onClick={() => (isDesk ? delDeskLog(m) : clearSessionLog(m))}>삭제</Button>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 260px' }, gap: 2, alignItems: 'start' }}>
          <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, minHeight: 200 }}>
            {sel.loading ? <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>
              : sel.error ? <Typography sx={{ fontSize: 13, color: 'error.main', py: 4, textAlign: 'center' }}>{sel.error}</Typography>
              : <TranscriptView items={items} deskMode={isDesk} />}
          </Paper>
          <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.25 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled', textTransform: 'uppercase', mb: 1 }}>속성</Typography>
            {isDesk ? (
              <>
                {propRow('종료 시각', fmtTime(m.endedAt))}
                {propRow('데스크', m.deskTitle + (m.deskDeleted ? ' (삭제됨)' : ''))}
                {propRow('손님 언어', LANG_KO[m.lang] || m.lang || '미상')}
                {propRow('응대 시간', m.startedAt && m.endedAt ? fmtDuration(m.endedAt - m.startedAt) : '—')}
                {propRow('문장 수', `${m.count}문장`)}
                {m.stats && propRow('누화 드랍', `${m.stats.crossDrops}건`)}
              </>
            ) : (
              <>
                {propRow('수정 시각', fmtTime(m.updatedAt))}
                {propRow('소유자', m.owner || '—')}
                {propRow('문장 수', `${m.count}문장`)}
                {m.preset && propRow('유형', m.preset)}
                {m.deleted && propRow('상태', '삭제된 세션')}
              </>
            )}
          </Paper>
        </Box>
        <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
        <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={snack} />
      </>
    );
  }

  // ── 목록(테이블) ──
  const ql = q.trim().toLowerCase();
  const deskRows = (data.desks || []).flatMap((d) => (d.logs || []).map((e) => ({ ...e, deskId: d.id, deskTitle: d.title, deskDeleted: d.deleted })))
    .sort((a, b) => (b.endedAt || 0) - (a.endedAt || 0))
    .filter((r) => !ql || (r.deskTitle || '').toLowerCase().includes(ql) || (LANG_KO[r.lang] || r.lang || '').toLowerCase().includes(ql));
  const sessionRows = (data.sessions || [])
    .filter((r) => !ql || (r.title || '').toLowerCase().includes(ql) || (r.owner || '').toLowerCase().includes(ql));
  const rows = mode === 'desk' ? deskRows : sessionRows;
  const grid = mode === 'desk' ? '150px 1fr 90px 90px 70px 32px' : '150px 1fr 130px 80px 32px';
  const headCells = mode === 'desk' ? ['시각', '데스크', '언어', '응대 시간', '문장', ''] : ['시각', '제목', '소유자', '문장', ''];
  const cellSx = { fontSize: 13, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

  return (
    <>
      {/* 툴바: 탭 + 검색 + 개수 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {LOG_TABS.map((t) => (
            <Box key={t.v} onClick={() => { setMode(t.v); }}
              sx={{ px: 1.5, py: 0.6, borderRadius: 1.25, cursor: 'pointer', fontSize: 13.5, fontWeight: 700,
                color: mode === t.v ? 'text.primary' : 'text.secondary',
                bgcolor: mode === t.v ? (th) => alpha(th.palette.text.primary, 0.07) : 'transparent',
                '&:hover': { bgcolor: (th) => alpha(th.palette.text.primary, 0.05) } }}>
              {t.label} <Box component="span" sx={{ fontWeight: 500, color: 'text.disabled' }}>{t.v === 'desk' ? deskRows.length : sessionRows.length}</Box>
            </Box>
          ))}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box component="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색 (데스크·제목·언어·소유자)"
          sx={{ width: { xs: '100%', sm: 260 }, px: 1.5, py: 0.8, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', fontSize: 13, fontFamily: 'inherit', outline: 'none', '&:focus': { borderColor: 'text.disabled' } }} />
        <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 'none' }}>{rows.length}개</Typography>
      </Box>

      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflow: 'hidden' }}>
        {/* 헤더 */}
        <Box sx={{ display: 'grid', gridTemplateColumns: grid, gap: 1.5, alignItems: 'center', px: 2, py: 1, borderBottom: 1, borderColor: 'divider', bgcolor: (th) => alpha(th.palette.text.primary, 0.015) }}>
          {headCells.map((h, i) => <Typography key={i} sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary' }}>{h}</Typography>)}
        </Box>
        {/* 본문 */}
        {rows.length === 0 && (
          <EmptyHint icon={<RecordVoiceOverIcon sx={{ fontSize: 22 }} />} title={ql ? '검색 결과가 없습니다' : (mode === 'desk' ? '응대 기록이 없습니다' : '세션이 없습니다')}
            desc={ql ? '다른 검색어를 시도해 보세요.' : (mode === 'desk' ? "'데스크 안내'에서 세션을 만들면 응대별 대화가 여기에 쌓입니다." : '세션이 생기면 대화 로그가 여기에 표시됩니다.')} />
        )}
        {rows.map((r, i) => (
          <Box key={mode === 'desk' ? `${r.deskId}:${r.idx}` : r.id}
            onClick={() => openRow(mode, r)}
            sx={{ display: 'grid', gridTemplateColumns: grid, gap: 1.5, alignItems: 'center', px: 2, py: 1.15, cursor: 'pointer',
              borderBottom: i < rows.length - 1 ? 1 : 0, borderColor: 'divider',
              '&:hover': { bgcolor: (th) => alpha(th.palette.text.primary, 0.04) }, '&:hover .delBtn': { opacity: 1 } }}>
            <Typography sx={{ ...cellSx, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(mode === 'desk' ? r.endedAt : r.updatedAt)}</Typography>
            <Typography sx={{ ...cellSx, fontWeight: 600 }}>
              {mode === 'desk' ? r.deskTitle : r.title}
              {(mode === 'desk' ? r.deskDeleted : r.deleted) && <Box component="span" sx={{ ml: 0.75, color: 'warning.main', fontWeight: 700, fontSize: 11 }}>삭제됨</Box>}
            </Typography>
            {mode === 'desk' ? (
              <>
                <Box><Chip size="small" label={LANG_KO[r.lang] || r.lang || '미상'} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} /></Box>
                <Typography sx={{ ...cellSx, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{r.startedAt && r.endedAt ? fmtDuration(r.endedAt - r.startedAt) : '—'}</Typography>
                <Typography sx={{ ...cellSx, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{r.count}</Typography>
              </>
            ) : (
              <>
                <Typography sx={{ ...cellSx, color: 'text.secondary' }}>{r.owner || '—'}</Typography>
                <Typography sx={{ ...cellSx, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{r.count}</Typography>
              </>
            )}
            <IconButton size="small" className="delBtn" sx={{ opacity: 0, transition: 'opacity .12s', justifySelf: 'end' }}
              onClick={(ev) => { ev.stopPropagation(); (mode === 'desk' ? delDeskLog(r) : clearSessionLog(r)); }}>
              <DeleteOutlineIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        ))}
      </Paper>
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1.5 }}>
        대화 로그에는 개인정보가 포함될 수 있습니다. 열람은 운영 목적으로만 하고, 보존 기간 정책에 따라 정리하세요.
      </Typography>
      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={snack} />
    </>
  );
}

export default LogsPanel;
