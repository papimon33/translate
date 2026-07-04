import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import IconButton from '@mui/material/IconButton';
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
import Fab from '@mui/material/Fab';
import Collapse from '@mui/material/Collapse';
import { alpha } from '@mui/material/styles';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import { api } from '../api.js';

function rel(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

// 새 세션 모달 — 상황 3종. Aurora 아이콘(paths) 인라인.
export const SITUATIONS = [
  { v: 'live', title: '라이브 청취', badge: '강의·컨퍼런스', example: '스피커로 들어온 현장 음성을 지정한 언어로 번역',
    paths: [<path key="1" d="M11 5L6 9H3v6h3l5 4V5z" />, <path key="2" d="M15.5 8.5a5 5 0 010 7" />] },
  { v: 'oneway', title: '온라인 회의', badge: '줌 회의 등', example: 'PC 시스템 음성을 지정한 언어로 번역',
    paths: [<path key="1" d="M4 12h14" />, <path key="2" d="M13 6l6 6-6 6" />] },
  { v: 'twoway', title: '양방향 번역', badge: '온·오프라인 회의', example: '지정한 2개 언어를 서로의 언어로 번역',
    paths: [<path key="1" d="M7 7l-4 4 4 4" />, <path key="2" d="M3 11h18" />, <path key="3" d="M17 17l4-4-4-4" />] },
];
// 세션 모드 표시명(라이브 헤더·목록 배지). 레거시(mobile/online/field/meeting) 매핑 포함.
export const TYPE_NAME = { live: '라이브 청취', oneway: '온라인 회의', twoway: '양방향 번역', mobile: '양방향 번역', online: '온라인 회의', field: '양방향 번역', meeting: '양방향 번역' };

// 중복되지 않는 기본 제목: "새 세션", "새 세션 1", "새 세션 2" ...
function uniqueName(base, titles) {
  if (!titles.includes(base)) return base;
  let i = 1;
  while (titles.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

export default function SessionList({ onOpen, user, deskMode }) {
  const isAdmin = user?.role === 'admin';
  const [list, setList] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const [editName, setEditName] = useState(false); // 새 세션 모달 제목 편집
  const [preset, setPreset] = useState('live'); // 세션 모드(live=라이브 청취 / oneway=온라인 회의 / twoway=양방향)
  const [deskFloor, setDeskFloor] = useState('1F'); // 안내데스크 출발 층
  const [deskSide, setDeskSide] = useState('S'); // 안내데스크 방향
  const [menu, setMenu] = useState(null);
  const [snack, setSnack] = useState(null);
  const [deskQr, setDeskQr] = useState(null); // 데스크 뷰어 랜딩 QR
  const [qrOpen, setQrOpen] = useState(false); // QR 기본 숨김
  const [rename, setRename] = useState(null); // { id, val } 제목 변경

  const reload = () => api.list().then(setList);
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    if (deskMode) api.deskLandingQr().then(setDeskQr).catch(() => {});
  }, [deskMode]);

  const base = deskMode ? '안내데스크' : '새 세션';
  const openDlg = () => {
    const titles = (list || []).map((s) => s.title);
    setName(uniqueName(base, titles));
    setEditName(false);
    setPreset('live');
    setDlg(true);
  };

  const create = async () => {
    setDlg(false);
    const titles = (list || []).map((s) => s.title);
    const title = name.trim() || uniqueName(base, titles);
    const body = deskMode
      ? { title, pipeline: 'desk', inLang: 'auto', deskFloor, deskSide }
      : { title, pipeline: 'soniox', preset, inLang: 'auto' };
    const s = await api.create(body);
    onOpen(s);
  };

  const exportSession = async () => {
    const s = await api.get(menu.session.id);
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
  const removeSession = async () => {
    const id = menu.session.id;
    setMenu(null);
    if (!confirm('이 세션을 삭제할까요?')) return;
    await api.remove(id);
    reload();
  };
  const startRename = () => { setRename({ id: menu.session.id, val: menu.session.title || '' }); setMenu(null); };
  const saveRename = async () => {
    const { id, val } = rename;
    setRename(null);
    await api.patch(id, { title: (val || '').trim() || '제목 없음' });
    reload();
  };
  // 데스크 메뉴는 desk 세션만, 실시간 번역 메뉴는 desk 외 세션만
  const shown = (list || []).filter((s) => (deskMode ? s.pipeline === 'desk' : s.pipeline !== 'desk'));
  const empty = list && shown.length === 0;

  return (
    <>
      {/* 헤더 */}
      <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="h6">{deskMode ? '데스크 안내' : '실시간 번역'}</Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 860, mx: 'auto' }}>
          {/* 상단 툴바: (데스크) QR 토글 + 새 세션 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, minHeight: 36 }}>
            <Box sx={{ flex: 1 }} />
            {deskMode && (
              <Tooltip title="뷰어 접속 QR">
                <IconButton onClick={() => setQrOpen((o) => !o)} color={qrOpen ? 'primary' : 'default'} sx={{ border: 1, borderColor: 'divider' }}>
                  <QrCode2Icon />
                </IconButton>
              </Tooltip>
            )}
            <Button variant="contained" startIcon={<AddIcon />} onClick={openDlg} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
              새 세션
            </Button>
          </Box>

          {/* 데스크 뷰어 접속용 랜딩 QR (기본 숨김) */}
          {deskMode && (
            <Collapse in={qrOpen && !!deskQr}>
              {deskQr && (
                <Card sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2, mb: 2 }}>
                  <Box component="img" src={deskQr.qr} alt="뷰어 QR" sx={{ width: 96, height: 96, bgcolor: '#fff', borderRadius: 2, p: 0.5, flex: 'none' }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800, fontSize: 15 }}>뷰어 접속 QR (안내데스크 선택 화면)</Typography>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.5 }}>
                      손님 태블릿으로 스캔 → 안내데스크 선택 → 시작 화면(전체화면).
                    </Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.5, wordBreak: 'break-all' }}>{deskQr.url}</Typography>
                  </Box>
                </Card>
              )}
            </Collapse>
          )}

          {empty && (
            <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
              <Avatar
                sx={{
                  width: 76, height: 76, mx: 'auto', mb: 2.5,
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.12),
                  color: 'primary.main',
                }}
              >
                <RecordVoiceOverIcon sx={{ fontSize: 38 }} />
              </Avatar>
              <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>
                {deskMode ? '안내데스크가 없어요' : '아직 세션이 없어요'}
              </Typography>
              <Typography sx={{ fontSize: 14, mt: 0.75, mb: 3 }}>
                {deskMode ? '안내데스크를 만들어 대면 통역을 시작하세요. (데스크마다 별도 세션)' : '새 세션을 만들고 외국어를 실시간으로 번역해 보세요.'}
              </Typography>
              <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
                새 세션 만들기
              </Button>
            </Box>
          )}

          {shown.map((s) => (
            <Card
              key={s.id}
              sx={{
                mb: 1.5,
                display: 'flex',
                alignItems: 'center',
                '&:hover': { transform: 'translateY(-2px)', boxShadow: 6, borderColor: 'primary.main' },
              }}
            >
              <CardActionArea onClick={() => onOpen(s)} sx={{ px: 2, py: 1.75, display: 'flex', justifyContent: 'flex-start', gap: 2 }}>
                <Avatar
                  variant="rounded"
                  sx={{ width: 46, height: 46, borderRadius: 3, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}
                >
                  <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" sx={{ width: 22, height: 22 }}>
                    <path d="M4 5h11a3 3 0 013 3v6a3 3 0 01-3 3H9l-5 4V5z" />
                  </Box>
                </Avatar>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title || '(제목 없음)'}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.6 }}>
                    {s.preset && TYPE_NAME[s.preset] && (
                      <Chip size="small" label={TYPE_NAME[s.preset]} sx={{ height: 20, fontSize: 11, fontWeight: 700, bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }} />
                    )}
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{rel(s.updatedAt)}</Typography>
                  </Box>
                </Box>
              </CardActionArea>
              <IconButton sx={{ mr: 1 }} onClick={(e) => setMenu({ anchor: e.currentTarget, session: s })}>
                <MoreVertIcon />
              </IconButton>
            </Card>
          ))}
        </Box>
      </Box>

      {/* 모바일: 우하단 고정 + 버튼(화면 이동해도 위치 유지) */}
      <Fab
        color="primary"
        aria-label="새 세션"
        onClick={openDlg}
        sx={{ position: 'fixed', right: 20, bottom: 'calc(20px + env(safe-area-inset-bottom))', display: { xs: 'flex', sm: 'none' }, zIndex: 1200 }}
      >
        <AddIcon />
      </Fab>

      <Menu anchorEl={menu?.anchor} open={!!menu} onClose={() => setMenu(null)}>
        <MenuItem onClick={startRename}>
          <ListItemIcon>
            <EditOutlinedIcon fontSize="small" />
          </ListItemIcon>
          제목 변경
        </MenuItem>
        <MenuItem onClick={exportSession}>
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          대화내역 저장
        </MenuItem>
        <MenuItem onClick={removeSession} sx={{ color: 'error.main' }}>
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} />
          </ListItemIcon>
          삭제
        </MenuItem>
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 20, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {name}
              </Typography>
              <Tooltip title="제목 수정">
                <IconButton size="small" onClick={() => setEditName(true)}>
                  <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" sx={{ width: 17, height: 17, color: 'text.secondary' }}>
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
                      <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" sx={{ width: 22, height: 22 }}>{p.paths}</Box>
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
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary', mt: 2.5, mb: 1 }}>안내데스크 위치 (길안내 출발점)</Typography>
              <Box sx={{ display: 'flex', gap: 1.5 }}>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>층</Typography>
                  <Select size="small" fullWidth value={deskFloor} onChange={(e) => setDeskFloor(e.target.value)}>
                    <MenuItem value="1F">1층</MenuItem>
                    <MenuItem value="2F">2층</MenuItem>
                  </Select>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 0.5 }}>방향</Typography>
                  <Select size="small" fullWidth value={deskSide} onChange={(e) => setDeskSide(e.target.value)}>
                    <MenuItem value="E">동</MenuItem>
                    <MenuItem value="W">서</MenuItem>
                    <MenuItem value="S">남</MenuItem>
                    <MenuItem value="N">북</MenuItem>
                  </Select>
                </Box>
              </Box>
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
