import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Avatar from '@mui/material/Avatar';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Alert from '@mui/material/Alert';
import { alpha } from '@mui/material/styles';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import { api } from '../api.js';

const W = 248;
const WC = 72;

export default function Nav({ collapsed, mobile, onToggleCollapsed, onToggleTheme, mode, user, view, onHome, onDesk, onSummaries, onTerms, onAdmin, onLogout, onUserUpdate }) {
  const width = collapsed ? WC : W;
  const [menu, setMenu] = useState(null);
  const [edit, setEdit] = useState(false);
  const isAdmin = user?.role === 'admin';
  const initial = (user?.username || user?.id || '?').trim().charAt(0).toUpperCase();

  return (
    <Box
      sx={{
        width,
        minWidth: width,
        transition: 'width .2s ease, min-width .2s ease',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        p: 1.25,
      }}
    >
      {/* 상단: (펼침) 로고 + 제목 + 토글 / (접힘) 토글만 */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25,
          px: collapsed ? 0 : 0.5, py: 0.5, mb: 1.5,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        {!collapsed && (
          <>
            <Box
              component="img"
              src="/favicon.svg"
              alt="KAC"
              sx={{ width: 38, height: 38, borderRadius: 2.5, flex: 'none', display: 'block' }}
            />
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1, whiteSpace: 'nowrap' }}>KAC Translator</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>실시간 음성 번역</Typography>
            </Box>
          </>
        )}
        {!mobile && (
          <Tooltip title={collapsed ? '메뉴 펼치기' : '메뉴 접기'} placement="right">
            <IconButton onClick={onToggleCollapsed} sx={{ flex: 'none' }}>
              <ViewSidebarOutlinedIcon fontSize="small" sx={{ transform: collapsed ? 'scaleX(-1)' : 'none' }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {!collapsed && (
        <Typography sx={{ px: 1.5, mb: 0.5, fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em' }}>
          메뉴
        </Typography>
      )}
      <NavItem collapsed={collapsed} icon={<TranslateIcon fontSize="small" />} label="통역" active={view === 'sessions'} onClick={onHome} />
      <NavItem collapsed={collapsed} icon={<RecordVoiceOverIcon fontSize="small" />} label="데스크 안내" active={view === 'desk'} onClick={onDesk} />
      {isAdmin && (
        <NavItem collapsed={collapsed} icon={<AdminPanelSettingsOutlinedIcon fontSize="small" />} label="관리자" active={view === 'admin'} onClick={onAdmin} />
      )}

      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {/* 프로필 (좌측 최하단) — 클릭 메뉴에 테마 토글 포함 */}
        <Box
          onClick={(e) => setMenu(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer',
            px: collapsed ? 0 : 1, py: 1, borderRadius: 2.5,
            justifyContent: collapsed ? 'center' : 'flex-start',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <Avatar
            sx={{
              width: 32, height: 32, flex: 'none', fontWeight: 800, fontSize: 14, color: '#fff',
              background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${mode === 'dark' ? '#9b8cff' : '#8b7cff'})`,
            }}
          >
            {initial}
          </Avatar>
          {!collapsed && (
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.username || user?.id}
              </Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>
                {user?.id}{isAdmin ? ' · 관리자' : ''}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} anchorOrigin={{ vertical: 'top', horizontal: 'left' }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{user?.username || user?.id}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{user?.id}{isAdmin ? ' · 관리자' : ''}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setMenu(null); onToggleTheme(); }}>
          <ListItemIcon>{mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}</ListItemIcon>
          {mode === 'dark' ? '라이트 모드' : '다크 모드'}
        </MenuItem>
        {!isAdmin && (
          <MenuItem onClick={() => { setMenu(null); setEdit(true); }}>
            <ListItemIcon><ManageAccountsOutlinedIcon fontSize="small" /></ListItemIcon>
            정보 변경
          </MenuItem>
        )}
        {isAdmin && (
          <MenuItem onClick={() => { setMenu(null); onAdmin(); }}>
            <ListItemIcon><AdminPanelSettingsOutlinedIcon fontSize="small" /></ListItemIcon>
            관리자 페이지
          </MenuItem>
        )}
        <MenuItem onClick={() => { setMenu(null); onLogout(); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          로그아웃
        </MenuItem>
      </Menu>

      <ProfileEditDialog
        open={edit}
        user={user}
        onClose={() => setEdit(false)}
        onSaved={(u) => { setEdit(false); onUserUpdate && onUserUpdate(u); }}
      />
    </Box>
  );
}

function ProfileEditDialog({ open, user, onClose, onSaved }) {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (open) {
      setUsername(user?.username || '');
      setPw('');
      setPw2('');
      setErr('');
    }
  }, [open, user]);

  const save = async () => {
    if (pw && pw !== pw2) {
      setErr('비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const body = { username };
      if (pw) {
        body.password = pw;
        body.passwordConfirm = pw2;
      }
      const { user: u } = await api.updateMe(body);
      onSaved(u);
    } catch (e) {
      setErr(e.message || '변경 실패');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
      <DialogTitle sx={{ fontWeight: 800 }}>내 정보 변경</DialogTitle>
      <DialogContent>
        {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
        <TextField fullWidth label="ID" value={user?.id || ''} disabled sx={{ mb: 2 }} />
        <TextField
          fullWidth label="사용자명" value={username}
          onChange={(e) => setUsername(e.target.value)} sx={{ mb: 2 }}
        />
        <TextField
          fullWidth type="password" label="새 비밀번호 (변경 시에만)" value={pw}
          onChange={(e) => setPw(e.target.value)} sx={{ mb: 2 }}
        />
        <TextField
          fullWidth type="password" label="비밀번호 확인" value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          error={!!pw2 && pw !== pw2}
          helperText={!!pw2 && pw !== pw2 ? '비밀번호가 일치하지 않습니다.' : ''}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button onClick={onClose}>취소</Button>
        <Button variant="contained" onClick={save} disabled={busy}>저장</Button>
      </DialogActions>
    </Dialog>
  );
}

function NavItem({ collapsed, icon, label, active, muted, onClick }) {
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: collapsed ? 0 : 1.5,
        py: 1.15,
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 2.5,
        cursor: 'pointer',
        color: active ? 'primary.main' : muted ? 'text.secondary' : 'text.primary',
        fontWeight: active ? 800 : 600,
        bgcolor: (t) => (active ? alpha(t.palette.primary.main, t.palette.mode === 'dark' ? 0.16 : 0.1) : 'transparent'),
        '&:hover': { bgcolor: 'action.hover' },
        whiteSpace: 'nowrap',
        transition: 'background .12s',
      }}
    >
      {icon}
      {!collapsed && <span style={{ fontSize: 14 }}>{label}</span>}
    </Box>
  );
  return collapsed ? (
    <Tooltip title={label} placement="right">
      {content}
    </Tooltip>
  ) : (
    content
  );
}
