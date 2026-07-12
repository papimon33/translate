import React, { useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import InputBase from '@mui/material/InputBase';
import Chip from '@mui/material/Chip';
import Avatar from '@mui/material/Avatar';
import { alpha } from '@mui/material/styles';
import SearchIcon from '@mui/icons-material/Search';
import TranslateIcon from '@mui/icons-material/Translate';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import AddIcon from '@mui/icons-material/Add';
import { api } from '../api.js';
import { TYPE_NAME, MODE_ICON, IconMode2 } from './SessionList.jsx';

/* ⌘K / Ctrl+K 명령 팔레트 — 세션 검색·이동 + 화면 이동 액션.
   App 에서 전역 키 리스너로 열고, 선택 시 navTo 로 이동한다. */
export default function CommandPalette({ open, onClose, user, onNavigate }) {
  const [q, setQ] = useState('');
  const [sessions, setSessions] = useState([]);
  const [idx, setIdx] = useState(0);
  const listRef = useRef(null);
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (!open) return;
    setQ(''); setIdx(0);
    api.list().then((l) => setSessions(l || [])).catch(() => setSessions([]));
  }, [open]);

  const items = useMemo(() => {
    const kw = q.trim().toLowerCase();
    const acts = [
      { kind: 'act', key: 'go-sessions', label: '실시간 번역으로 이동', icon: <TranslateIcon sx={{ fontSize: 18 }} />, run: () => onNavigate({ view: 'sessions' }) },
      { kind: 'act', key: 'go-desk', label: '데스크 안내로 이동', icon: <RecordVoiceOverIcon sx={{ fontSize: 18 }} />, run: () => onNavigate({ view: 'desk' }) },
      ...(isAdmin ? [{ kind: 'act', key: 'go-admin', label: '관리자 페이지로 이동', icon: <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 18 }} />, run: () => onNavigate({ view: 'admin' }) }] : []),
      { kind: 'act', key: 'new-session', label: '새 세션 만들기', icon: <AddIcon sx={{ fontSize: 18 }} />, run: () => onNavigate({ view: 'sessions', openCreate: true }) },
    ].filter((a) => !kw || a.label.toLowerCase().includes(kw));
    const sess = sessions
      .filter((s) => !kw || String(s.title || '').toLowerCase().includes(kw))
      .slice(0, 8)
      .map((s) => ({ kind: 'session', key: s.id, session: s }));
    return [...sess, ...acts];
  }, [q, sessions, isAdmin, onNavigate]);

  useEffect(() => { if (idx >= items.length) setIdx(Math.max(0, items.length - 1)); }, [items, idx]);

  const runItem = (it) => {
    onClose();
    if (!it) return;
    if (it.kind === 'session') onNavigate({ session: it.session, view: it.session.pipeline === 'desk' ? 'desk' : 'sessions' });
    else it.run();
  };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runItem(items[idx]); }
  };
  useEffect(() => {
    const el = listRef.current && listRef.current.children[idx];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { width: 560, maxWidth: 'calc(100vw - 32px)', mt: '-18vh', alignSelf: 'flex-start' } }}
      sx={{ '& .MuiDialog-container': { alignItems: 'flex-start', pt: '18vh' } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
        <SearchIcon sx={{ fontSize: 20, color: 'text.disabled' }} />
        <InputBase autoFocus fullWidth placeholder="세션 검색 또는 이동…" value={q}
          onChange={(e) => { setQ(e.target.value); setIdx(0); }} onKeyDown={onKey}
          sx={{ fontSize: 15 }} />
        <Chip size="small" label="ESC" sx={{ height: 20, fontSize: 10.5, color: 'text.disabled' }} />
      </Box>
      {/* 고정 높이 — 검색 결과 수에 따라 팔레트가 늘었다 줄었다 하지 않도록 */}
      <Box ref={listRef} sx={{ height: 360, overflowY: 'auto', py: 0.75 }}>
        {items.length === 0 && <Typography sx={{ fontSize: 13.5, color: 'text.disabled', textAlign: 'center', py: 3 }}>결과가 없습니다.</Typography>}
        {items.map((it, i) => {
          const active = i === idx;
          if (it.kind === 'session') {
            const s = it.session;
            const Ic = MODE_ICON[s.preset] || IconMode2;
            return (
              <Box key={it.key} onClick={() => runItem(it)} onMouseEnter={() => setIdx(i)}
                sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, cursor: 'pointer', bgcolor: active ? (t) => alpha(t.palette.primary.main, 0.09) : 'transparent' }}>
                <Avatar variant="rounded" sx={{ width: 30, height: 30, borderRadius: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>
                  {s.pipeline === 'desk' ? <RecordVoiceOverIcon sx={{ fontSize: 16 }} /> : <Ic sx={{ width: 16, height: 16 }} />}
                </Avatar>
                <Typography sx={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || '(제목 없음)'}</Typography>
                <Typography sx={{ fontSize: 11.5, color: 'text.disabled', flex: 'none' }}>{s.pipeline === 'desk' ? '안내데스크' : (TYPE_NAME[s.preset] || '세션')}</Typography>
              </Box>
            );
          }
          return (
            <Box key={it.key} onClick={() => runItem(it)} onMouseEnter={() => setIdx(i)}
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1, cursor: 'pointer', color: 'text.secondary', bgcolor: active ? (t) => alpha(t.palette.primary.main, 0.09) : 'transparent' }}>
              <Box sx={{ width: 30, display: 'grid', placeItems: 'center' }}>{it.icon}</Box>
              <Typography sx={{ fontSize: 14, fontWeight: 600, color: 'text.primary' }}>{it.label}</Typography>
            </Box>
          );
        })}
      </Box>
    </Dialog>
  );
}
