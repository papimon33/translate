import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Avatar from '@mui/material/Avatar';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogTitle from '@mui/material/DialogTitle';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Select from '@mui/material/Select';
import Checkbox from '@mui/material/Checkbox';
import Skeleton from '@mui/material/Skeleton';
import Fab from '@mui/material/Fab';
import { alpha } from '@mui/material/styles';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import ConfirmDialog from './ConfirmDialog.jsx';
import { api } from '../api.js';
import { RADIUS } from '../theme.js';

function rel(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

// 모드 아이콘(첨부 SVG → currentColor. 배경색에 맞춰 색 상속). 1=스피커, 2=화면, 3=양방향.
export function IconMode1(props) {
  return (
    <Box component="svg" viewBox="-0.5 0 25 25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12.5493 4.50005C11.3193 4.04005 8.70926 5.49996 6.54926 7.40996H4.94922C3.88835 7.40996 2.87093 7.83145 2.12079 8.58159C1.37064 9.33174 0.949219 10.3491 0.949219 11.41V13.41C0.949219 14.4708 1.37064 15.4883 2.12079 16.2385C2.87093 16.9886 3.88835 17.41 4.94922 17.41H6.54926C8.65926 19.35 11.2693 20.78 12.5493 20.33C14.6493 19.55 14.9992 15.33 14.9992 12.41C14.9992 9.48996 14.6493 5.28005 12.5493 4.50005Z" />
      <path d="M20.6602 6.71997C22.1593 8.22011 23.0015 10.2542 23.0015 12.375C23.0015 14.4958 22.1593 16.5299 20.6602 18.03" />
      <path d="M18.5391 15.95C19.4764 15.0123 20.003 13.7407 20.003 12.4149C20.003 11.0891 19.4764 9.81764 18.5391 8.88" />
    </Box>
  );
}
export function IconMode2(props) {
  return (
    <Box component="svg" viewBox="0 0 32 32" fill="currentColor" {...props}>
      <path d="M23,28L23,28c-1.1,0-2.1-0.7-2.5-1.8c0-0.1,0-0.2-0.1-0.2h-8.9c0,0.1,0,0.2-0.1,0.2C11.1,27.3,10.1,28,9,28h0 c-0.6,0-1,0.4-1,1s0.4,1,1,1h14c0.6,0,1-0.4,1-1S23.6,28,23,28z" />
      <path d="M15.6,10.2c-0.3-0.2-0.7-0.3-1.1-0.1C14.2,10.3,14,10.6,14,11v5c0,0.4,0.2,0.7,0.6,0.9C14.7,17,14.9,17,15,17 c0.2,0,0.5-0.1,0.6-0.2l3-2.5c0.2-0.2,0.4-0.5,0.4-0.8s-0.1-0.6-0.4-0.8L15.6,10.2z" />
      <path d="M27,3H5C3.3,3,2,4.3,2,6v15c0,1.7,1.3,3,3,3h6.9h8.1H27c1.7,0,3-1.3,3-3V6C30,4.3,28.7,3,27,3z M26,19c0,0.6-0.4,1-1,1H7 c-0.6,0-1-0.4-1-1V8c0-0.6,0.4-1,1-1h18c0.6,0,1,0.4,1,1V19z" />
    </Box>
  );
}
export function IconMode3(props) {
  return (
    <Box component="svg" viewBox="0 0 45.363 45.363" fill="currentColor" {...props}>
      <path d="M1.788,16.945c0.388,0.385,0.913,0.601,1.459,0.601l27.493-0.035v3.831c0.003,0.836,0.556,1.586,1.329,1.904 c0.771,0.314,1.658,0.135,2.246-0.459l9.091-9.18c1.062-1.071,1.06-2.801-0.009-3.868l-9.137-9.134 c-0.59-0.591-1.479-0.768-2.25-0.446c-0.77,0.319-1.271,1.074-1.27,1.908L30.74,5.9L3.219,5.937 C2.08,5.94,1.161,6.864,1.163,8.004l0.018,7.483C1.182,16.034,1.401,16.56,1.788,16.945z" />
      <path d="M42.146,27.901l-27.522-0.035l-0.001-3.834c0.002-0.835-0.5-1.587-1.27-1.907c-0.771-0.321-1.66-0.146-2.25,0.445 l-9.136,9.135c-1.067,1.064-1.071,2.796-0.009,3.866l9.09,9.181c0.588,0.596,1.475,0.772,2.247,0.458 c0.772-0.316,1.326-1.066,1.329-1.904v-3.83l27.493,0.035c0.547,0,1.072-0.216,1.459-0.602s0.605-0.91,0.607-1.456L44.2,29.97 C44.203,28.83,43.284,27.903,42.146,27.901z" />
    </Box>
  );
}
// 새 세션 모달 — 상황 4종.
export const SITUATIONS = [
  { v: 'live', title: '라이브 청취', badge: '강의·컨퍼런스', example: '스피커로 들어온 현장 음성을 지정한 언어로 번역', Icon: IconMode1 },
  { v: 'oneway', title: '온라인 회의', badge: '줌 회의 등', example: 'PC 시스템 음성을 지정한 언어로 번역', Icon: IconMode2 },
  { v: 'twoway', title: '양방향 번역', badge: '온·오프라인 회의', example: '지정한 2개 언어를 서로의 언어로 번역', Icon: IconMode3 },
];
// 세션 모드 표시명(라이브 헤더·목록 배지). 레거시(mobile/online/field/meeting) 매핑 포함.
export const TYPE_NAME = { live: '라이브 청취', oneway: '온라인 회의', twoway: '양방향 번역', mobile: '양방향 번역', online: '온라인 회의', field: '양방향 번역', meeting: '양방향 번역' };
// 세션 모드 → 아이콘(목록·모달 공용)
export const MODE_ICON = { live: IconMode1, oneway: IconMode2, twoway: IconMode3, mobile: IconMode3, online: IconMode2, field: IconMode3, meeting: IconMode3 };

// 중복되지 않는 기본 제목: "새 세션", "새 세션 1", "새 세션 2" ...
function uniqueName(base, titles) {
  if (!titles.includes(base)) return base;
  let i = 1;
  while (titles.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export default function SessionList({ onOpen, user, deskMode, createSignal }) {
  const isAdmin = user?.role === 'admin';
  // 안내데스크 세션은 관리자만 생성·삭제(직원은 운영만)
  const canManage = !deskMode || isAdmin;
  const [list, setList] = useState(null);
  const [q, setQ] = useState(''); // 검색어 — 제목+대화 내용(서버 검색)
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const [editName, setEditName] = useState(false); // 새 세션 모달 제목 편집
  const [preset, setPreset] = useState('live'); // 세션 모드(live=라이브 청취 / oneway=온라인 회의 / twoway=양방향)
  const [deskStat, setDeskStat] = useState({}); // 데스크 현황판: id → { hostOn, active, lang, viewers }
  const [regDesks, setRegDesks] = useState(null); // 안내데스크 레지스트리(관리자 사전 정의) — 데스크 세션 생성 시 선택
  const [deskId, setDeskId] = useState('');
  const [menu, setMenu] = useState(null);
  const [snack, setSnack] = useState(null);
  const [rename, setRename] = useState(null); // { id, val } 제목 변경
  const [selMode, setSelMode] = useState(false); // 일괄 선택 모드
  const [selIds, setSelIds] = useState(() => new Set());
  const [confirmReq, setConfirmReq] = useState(null); // 공용 확인 다이얼로그(브라우저 confirm 대체)
  const [showOnboard, setShowOnboard] = useState(() => localStorage.getItem('kac-onboard-v1') !== '1'); // 첫 사용 안내
  const dismissOnboard = () => { setShowOnboard(false); localStorage.setItem('kac-onboard-v1', '1'); };

  const reload = () => api.list(q.trim()).then(setList).catch(() => {});
  // 데스크 현황판: 전 데스크 상태(호스트 연결·응대 중·뷰어 수)를 10초 주기로 — 어느 데스크가 살아있는지 한눈에
  useEffect(() => {
    if (!deskMode) return;
    let dead = false;
    const tick = () => api.deskStatus().then((rows) => {
      if (dead || !Array.isArray(rows)) return;
      const m = {};
      rows.forEach((r) => { m[r.id] = r; });
      setDeskStat(m);
    }).catch(() => {});
    tick();
    const iv = setInterval(tick, 10000);
    return () => { dead = true; clearInterval(iv); };
  }, [deskMode]);

  // 검색어 변경 시 디바운스 재조회(내용 검색은 서버에서)
  useEffect(() => {
    const t = setTimeout(() => { api.list(q.trim()).then(setList).catch(() => {}); }, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  // 명령 팔레트(⌘K)의 '새 세션 만들기' → 생성 모달 열기
  useEffect(() => { if (createSignal) openDlg(); }, [createSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = deskMode ? '안내데스크' : '새 세션';
  const openDlg = () => {
    const titles = (list || []).map((s) => s.title);
    setName(uniqueName(base, titles));
    setEditName(false);
    setPreset('live');
    if (deskMode) {
      // 레지스트리(관리자 사전 정의)에서 데스크 목록 로드 — 세션은 '데스크 선택 + 세션명'으로만 생성
      api.deskRegistry().then((r) => {
        const ds = (r && r.desks) || [];
        setRegDesks(ds);
        setDeskId((prev) => (ds.some((d) => d.id === prev) ? prev : (ds[0] ? ds[0].id : '')));
      }).catch(() => setRegDesks([]));
    }
    setDlg(true);
  };

  const [creating, setCreating] = useState(false); // 만들기 연타 → 세션 2개 생성 방지
  const create = async () => {
    if (creating) return;
    const titles = (list || []).map((s) => s.title);
    const title = name.trim() || uniqueName(base, titles);
    if (deskMode && !deskId) { setSnack({ ok: false, msg: '안내데스크를 먼저 선택하세요. (관리자 페이지 > 안내데스크에서 등록)' }); return; }
    const body = deskMode
      ? { title, pipeline: 'desk', inLang: 'auto', deskId }
      : { title, pipeline: 'soniox', preset, inLang: 'auto' };
    setCreating(true);
    try {
      const s = await api.create(body);
      setDlg(false);
      onOpen(s);
    } catch (e) {
      setSnack({ ok: false, msg: '세션 생성 실패: ' + (e.message || '네트워크 오류') });
    } finally {
      setCreating(false);
    }
  };

  const exportSession = async (sess) => {
    let s;
    try { s = await api.get(sess.id); }
    catch (e) { setMenu(null); setSnack({ ok: false, msg: '내보내기 실패: ' + (e.message || '네트워크 오류') }); return; }
    setMenu(null);
    const lines = s.items.map((it) => {
      const who = it.side === 'left' ? '[시스템]' : '[마이크]';
      const txt = it.texts ? Object.values(it.texts).join(' / ') : it.text || '';
      return who + ' ' + txt + (it.source ? `  (${it.source})` : '');
    });
    const text = `${s.title}\n${new Date(s.createdAt).toLocaleString('ko-KR')}\n\n` + lines.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (s.title || 'session').replace(/[\\/:*?"<>|]/g, '_') + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const removeSession = (sess) => {
    setMenu(null);
    setConfirmReq({
      title: '세션 삭제',
      message: `'${sess.title || '(제목 없음)'}' 세션을 삭제합니다. 목록에서 사라지며, 대화 기록은 관리자 로그에 보존됩니다.`,
      onOk: async () => {
        try { await api.remove(sess.id); } catch (e) { setSnack({ ok: false, msg: '삭제 실패: ' + (e.message || '네트워크 오류') }); }
        reload();
      },
    });
  };
  const startRename = (sess) => { setRename({ id: sess.id, val: sess.title || '' }); setMenu(null); };
  // 일괄 선택 삭제
  const toggleSel = (id) => setSelIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exitSel = () => { setSelMode(false); setSelIds(new Set()); };
  const bulkDelete = () => {
    const ids = [...selIds];
    if (!ids.length) return;
    setConfirmReq({
      title: '선택 세션 삭제',
      message: `선택한 ${ids.length}개 세션을 삭제합니다. 목록에서 사라지며, 대화 기록은 관리자 로그에 보존됩니다.`,
      onOk: async () => {
        const results = await Promise.allSettled(ids.map((id) => api.remove(id)));
        const fail = results.filter((r) => r.status === 'rejected').length;
        if (fail) setSnack({ ok: false, msg: `${fail}개 삭제 실패` });
        else setSnack({ ok: true, msg: `${ids.length}개 세션을 삭제했습니다.` });
        exitSel();
        reload();
      },
    });
  };
  const saveRename = async () => {
    const { id, val } = rename;
    setRename(null);
    try { await api.patch(id, { title: (val || '').trim() || '제목 없음' }); }
    catch (e) { setSnack({ ok: false, msg: '제목 변경 실패: ' + (e.message || '네트워크 오류') }); }
    reload();
  };
  // 데스크 메뉴는 desk 세션만, 실시간 번역 메뉴는 desk 외 세션만
  const shown = (list || []).filter((s) => (deskMode ? s.pipeline === 'desk' : s.pipeline !== 'desk'));
  const empty = list && shown.length === 0;

  return (
    <>
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>
          {/* 페이지 제목 — 좌측 정렬, 24px */}
          <Typography sx={{ textAlign: 'left', fontWeight: 800, fontSize: 24, letterSpacing: '-0.02em', mt: { xs: 1.5, sm: 2.5 }, mb: { xs: 1.5, sm: 2.5 } }}>
            {deskMode ? '데스크 안내' : '실시간 번역'}
          </Typography>
          {/* 상단 툴바: 선택(일괄 삭제) + 새 세션 — 데스크는 관리자만(직원은 운영만) */}
          {canManage && (
          <Box sx={{ display: { xs: selMode ? 'flex' : 'none', sm: 'flex' }, alignItems: 'center', gap: 1, mb: 1.5, minHeight: 36 }}>
            {selMode ? (
              <>
                <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.secondary' }}>{selIds.size}개 선택</Typography>
                <Box sx={{ flex: 1 }} />
                <Button size="small" onClick={exitSel} sx={{ color: 'text.secondary' }}>취소</Button>
                <Button size="small" variant="contained" color="error" disabled={!selIds.size} onClick={bulkDelete} startIcon={<DeleteOutlineIcon />}>삭제</Button>
              </>
            ) : (
              <>
                <Box sx={{ flex: 1 }} />
                {shown.length > 0 && <Button size="small" onClick={() => setSelMode(true)} sx={{ color: 'text.secondary' }}>선택</Button>}
                <Button variant="contained" startIcon={<AddIcon />} onClick={openDlg} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
                  새 세션
                </Button>
              </>
            )}
          </Box>
          )}
          {/* 모바일: 선택 모드 진입 버튼(목록 위 얇은 줄) */}
          {canManage && !selMode && shown.length > 0 && (
            <Box sx={{ display: { xs: 'flex', sm: 'none' }, justifyContent: 'flex-end', mb: 1 }}>
              <Button size="small" onClick={() => setSelMode(true)} sx={{ color: 'text.secondary', py: 0 }}>선택</Button>
            </Box>
          )}

          {/* 검색 — 제목·대화 내용(서버 검색, Claude 스타일) */}
          {list && (shown.length > 0 || q.trim()) && (
            <TextField
              fullWidth
              size="small"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="대화 검색 (제목·내용)"
              InputProps={{ startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 20, color: 'text.disabled' }} /></InputAdornment>) }}
              sx={{ mb: 2, '& .MuiOutlinedInput-root': { borderRadius: RADIUS.panel, bgcolor: 'background.paper' } }}
            />
          )}

          {/* 첫 사용 온보딩: 모드 3종 안내(1회 표시) */}
          {!deskMode && showOnboard && (
            <Card sx={{ p: 2.5, mb: 2.5, border: 1, borderColor: 'divider' }}>
              <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1 }}>처음이신가요? 상황에 맞는 모드를 고르세요</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mb: 1.5 }}>
                {SITUATIONS.map((p) => (
                  <Typography key={p.v} sx={{ fontSize: 13.5, color: 'text.secondary' }}>
                    <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{p.title}</Box> — {p.example}
                  </Typography>
                ))}
              </Box>
              <Typography sx={{ fontSize: 12.5, color: 'text.disabled', mb: 1.5 }}>
                모드는 세션을 만든 뒤에도 번역을 시작하기 전이라면 세션 안에서 바꿀 수 있습니다.
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="contained" onClick={() => { dismissOnboard(); openDlg(); }}>첫 세션 만들기</Button>
                <Button size="small" onClick={dismissOnboard} sx={{ color: 'text.secondary' }}>닫기</Button>
              </Box>
            </Card>
          )}

          {empty && q.trim() && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 700, color: 'text.primary' }}>‘{q.trim()}’ 검색 결과가 없습니다</Typography>
              <Typography sx={{ fontSize: 13, mt: 0.75 }}>제목과 대화 내용에서 찾습니다. 다른 검색어를 시도해 보세요.</Typography>
            </Box>
          )}
          {empty && !q.trim() && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Avatar
                sx={{
                  width: 76, height: 76, mx: 'auto', mb: 2.5,
                  bgcolor: (t) => alpha(t.palette.text.primary, 0.06),
                  color: 'text.secondary',
                }}
              >
                <RecordVoiceOverIcon sx={{ fontSize: 38 }} />
              </Avatar>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>
                {deskMode ? '안내데스크가 없어요' : '아직 세션이 없어요'}
              </Typography>
              <Typography sx={{ fontSize: 14, mt: 0.75, mb: 3 }}>
                {deskMode
                  ? (canManage ? '안내데스크를 만들어 대면 통역을 시작하세요. (데스크마다 별도 세션)' : '관리자가 안내데스크를 만들면 여기에 표시됩니다.')
                  : '새 세션을 만들고 외국어를 실시간으로 번역해 보세요.'}
              </Typography>
              {canManage && (
                <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
                  새 세션 만들기
                </Button>
              )}
            </Box>
          )}

          {/* 로딩 중(첫 조회) — 빈 화면/빈 상태 오표시 대신 스켈레톤 행 */}
          {list === null && [0, 1, 2, 3].map((i) => (
            <Box key={'sk' + i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75 }}>
              <Skeleton variant="text" sx={{ flex: 1, fontSize: 15 }} />
              <Skeleton variant="text" width={64} sx={{ display: { xs: 'none', sm: 'block' } }} />
              <Skeleton variant="text" width={48} />
            </Box>
          ))}

          {/* 목록 — Claude 스타일 플랫 행: 제목 · 유형 · 일자만(아이콘 없음), hover 하이라이트 */}
          {shown.map((s) => {
            const checked = selIds.has(s.id);
            return (
            <Box
              key={s.id}
              onClick={() => (selMode ? toggleSel(s.id) : onOpen(s))}
              sx={{
                display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.75,
                borderRadius: 2, cursor: 'pointer', position: 'relative',
                bgcolor: selMode && checked ? (t) => alpha(t.palette.text.primary, 0.06) : 'transparent',
                '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.05) },
                '&:hover .rowActs': { opacity: 1, pointerEvents: 'auto' },
                transition: 'background .12s',
              }}
            >
              {selMode && (
                <Checkbox checked={checked} onChange={() => toggleSel(s.id)} onClick={(e) => e.stopPropagation()} size="small" sx={{ p: 0.25, ml: -0.75 }} />
              )}
              <Typography sx={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title || '(제목 없음)'}
              </Typography>
              {deskMode && (() => {
                const st = deskStat[s.id];
                if (!st) return null;
                const label = st.active ? `응대 중${st.lang ? ' · ' + st.lang.toUpperCase() : ''}` : st.hostOn ? '대기' : '오프라인';
                const color = st.active ? 'accent.main' : st.hostOn ? 'success.main' : 'text.disabled';
                return (
                  <Tooltip title={`호스트 ${st.hostOn ? '연결됨' : '없음'} · 뷰어 ${st.viewers}대`}>
                    <Box sx={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 0.6, fontSize: 12, color: 'text.secondary' }}>
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color }} />
                      {label}{st.viewers > 0 ? ` · 뷰어 ${st.viewers}` : ''}
                    </Box>
                  </Tooltip>
                );
              })()}
              {deskMode && s.deskName && (
                <Typography sx={{ flex: 'none', fontSize: 12.5, color: 'text.secondary', display: { xs: 'none', sm: 'block' }, overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                  {s.deskName}
                </Typography>
              )}
              {s.preset && TYPE_NAME[s.preset] && (
                <Typography sx={{ flex: 'none', fontSize: 12.5, color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}>
                  {TYPE_NAME[s.preset]}
                </Typography>
              )}
              <Typography sx={{ flex: 'none', fontSize: 13, color: 'text.secondary', minWidth: 52, textAlign: 'right' }}>{rel(s.updatedAt)}</Typography>
              {!selMode && (
                <>
                  {/* 데스크톱: hover 시 우측 오버레이 액션(자리 차지 없음 — 제목 공간 확보) */}
                  <Box
                    className="rowActs"
                    onClick={(e) => e.stopPropagation()}
                    sx={{
                      display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 0.25,
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      px: 0.5, py: 0.25, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: 'background.paper',
                      opacity: 0, pointerEvents: 'none', transition: 'opacity .12s',
                    }}
                  >
                    {canManage && <Tooltip title="제목 변경"><IconButton size="small" onClick={() => startRename(s)}><EditOutlinedIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>}
                    <Tooltip title="대화내역 저장"><IconButton size="small" onClick={() => exportSession(s)}><DownloadIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
                    {canManage && <Tooltip title="삭제"><IconButton size="small" onClick={() => removeSession(s)}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>}
                  </Box>
                  {/* 모바일: 케밥 메뉴 유지(hover 없음) */}
                  <IconButton size="small" sx={{ display: { xs: 'inline-flex', sm: 'none' }, flex: 'none' }} onClick={(e) => { e.stopPropagation(); setMenu({ anchor: e.currentTarget, session: s }); }}>
                    <MoreVertIcon sx={{ fontSize: 20 }} />
                  </IconButton>
                </>
              )}
            </Box>
            );
          })}
        </Box>
      </Box>

      {/* 모바일: 우하단 고정 + 버튼(화면 이동해도 위치 유지) — 데스크는 관리자만 */}
      {canManage && (
        <Fab
          color="primary"
          aria-label="새 세션"
          onClick={openDlg}
          sx={{ position: 'fixed', right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))', display: { xs: 'flex', sm: 'none' }, zIndex: 1200 }}
        >
          <AddIcon />
        </Fab>
      )}

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        {canManage && (
          <MenuItem onClick={() => startRename(menu.session)}>
            <ListItemIcon>
              <EditOutlinedIcon fontSize="small" />
            </ListItemIcon>
            제목 변경
          </MenuItem>
        )}
        <MenuItem onClick={() => exportSession(menu.session)}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          대화내역 저장
        </MenuItem>
        {canManage && (
          <MenuItem onClick={() => removeSession(menu.session)} sx={{ color: 'error.main' }}>
            <ListItemIcon>
              <DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            삭제
          </MenuItem>
        )}
      </Menu>

      {/* 새 세션 모달: 상단 제목칸(펜으로 수정) + 모드 선택 */}
      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 440, maxWidth: 440 } }}>
        <DialogContent sx={{ pt: 3 }}>
          {editName ? (
            <TextField
              autoFocus
              fullWidth
              size="small"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditName(false)}
              onKeyDown={(e) => { if (e.key === 'Enter') setEditName(false); }}
              sx={{ mb: 1 }}
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 20, minWidth: 0, maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </Typography>
              <Tooltip title="제목 수정">
                <IconButton onClick={() => setEditName(true)} sx={{ width: 32, height: 32, flex: 'none', borderRadius: '9px', border: 1, borderColor: 'divider', color: 'text.secondary' }}>
                  <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" sx={{ width: 16, height: 16 }}>
                    <path d="M4 20h4L19 9l-4-4L4 16v4z" />
                  </Box>
                </IconButton>
              </Tooltip>
            </Box>
          )}

          {!deskMode && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mt: 2 }}>
              {SITUATIONS.map((p) => {
                const sel = preset === p.v;
                const Ic = p.Icon;
                return (
                  <Box
                    key={p.v}
                    onClick={() => setPreset(p.v)}
                    role="button"
                    sx={{
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 2, borderRadius: 3.5, p: 1.75,
                      border: 2, borderColor: sel ? 'primary.main' : 'divider',
                      bgcolor: (t) => (sel ? alpha(t.palette.primary.main, 0.08) : 'transparent'),
                      transition: 'border-color .12s, background .12s',
                      '&:hover': { borderColor: sel ? 'primary.main' : 'text.disabled' },
                    }}
                  >
                    <Avatar variant="rounded" sx={{ width: 44, height: 44, borderRadius: 3, flex: 'none', bgcolor: (t) => (sel ? t.palette.primary.main : alpha(t.palette.primary.main, 0.12)), color: sel ? '#fff' : 'primary.main' }}>
                      <Ic sx={{ width: 23, height: 23 }} />
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{p.title}</Typography>
                        <Chip size="small" label={p.badge} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }} />
                      </Box>
                      <Typography sx={{ fontSize: 13, color: 'text.secondary', lineHeight: 1.4 }}>{p.example}</Typography>
                    </Box>
                    <Box sx={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', border: 2, borderColor: sel ? 'primary.main' : 'divider', bgcolor: sel ? 'primary.main' : 'transparent', display: 'grid', placeItems: 'center' }}>
                      {sel && <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" sx={{ width: 12, height: 12 }}><path d="M5 13l4 4 10-11" /></Box>}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
          {deskMode && (
            <>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mt: 2.5, mb: 1 }}>안내데스크 선택 (위치는 관리자 등록값 사용)</Typography>
              {regDesks && regDesks.length === 0 ? (
                <Typography sx={{ fontSize: 13, color: 'warning.main' }}>
                  등록된 안내데스크가 없습니다. 관리자 페이지 &gt; 안내데스크에서 먼저 등록하세요.
                </Typography>
              ) : (
                <Select size="small" fullWidth value={deskId} onChange={(e) => setDeskId(e.target.value)} displayEmpty>
                  {(regDesks || []).map((d) => (
                    <MenuItem key={d.id} value={d.id}>{d.name} · {d.floor} {({ E: '동', W: '서', S: '남', N: '북' })[d.side] || d.side}</MenuItem>
                  ))}
                </Select>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDlg(false)}>취소</Button>
          <Button variant="contained" onClick={create}>만들기</Button>
        </DialogActions>
      </Dialog>

      {/* 제목 변경 */}
      <Dialog open={!!rename} onClose={() => setRename(null)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>제목 변경</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={rename?.val || ''}
            onChange={(e) => setRename((r) => ({ ...r, val: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRename(null)}>취소</Button>
          <Button variant="contained" onClick={saveRename}>저장</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <MuiAlert elevation={6} variant="filled" severity={snack.ok ? 'success' : 'error'} onClose={() => setSnack(null)}>
            {snack.msg}
          </MuiAlert>
        ) : undefined}
      </Snackbar>
    </>
  );
}
