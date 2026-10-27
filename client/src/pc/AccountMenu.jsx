// 개인설정(PC 오른쪽 위 아이콘) — 테마·정보 변경·관리자·앱 설치·로그아웃
import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
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
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import InstallDesktopOutlinedIcon from '@mui/icons-material/InstallDesktopOutlined';
import { SettingsIcon } from '../shared/icons.jsx';
import { api } from '../shared/api.js';
import DesktopAppDialog from './DesktopAppDialog.jsx';

export default function AccountMenu({ user, mode, onToggleTheme, onAdmin, onLogout, onUserUpdate }) {
  const [menu, setMenu] = useState(null);
  const [edit, setEdit] = useState(false);
  const [desktopApp, setDesktopApp] = useState(false); // 데스크톱 앱 안내·다운로드 모달
  const isAdmin = user?.role === 'admin';
  const pick = (fn) => () => { setMenu(null); fn(); };
  return (
    <>
      <Tooltip title="개인설정">
        <IconButton aria-label="개인설정" onClick={(e) => setMenu(e.currentTarget)} sx={{ width: 44, height: 44, '& svg': { fontSize: 22 } }}>
          <SettingsIcon />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220, '& .MuiMenuItem-root': { fontSize: 13 } } } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{user?.username || user?.id}</Typography>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{user?.id}{isAdmin ? ' · 관리자' : ''}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={pick(onToggleTheme)}>
          <ListItemIcon>{mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}</ListItemIcon>
          {mode === 'dark' ? '라이트 모드' : '다크 모드'}
        </MenuItem>
        {!isAdmin && (
          <MenuItem onClick={pick(() => setEdit(true))}>
            <ListItemIcon><ManageAccountsOutlinedIcon fontSize="small" /></ListItemIcon>
            정보 변경
          </MenuItem>
        )}
        {isAdmin && (
          <MenuItem onClick={pick(onAdmin)}>
            <ListItemIcon><AdminPanelSettingsOutlinedIcon fontSize="small" /></ListItemIcon>
            관리자 페이지
          </MenuItem>
        )}
        <MenuItem onClick={pick(() => setDesktopApp(true))}>
          <ListItemIcon><InstallDesktopOutlinedIcon fontSize="small" /></ListItemIcon>
          앱 설치 (PC·태블릿)
        </MenuItem>
        <MenuItem onClick={pick(onLogout)}>
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
      <DesktopAppDialog open={desktopApp} onClose={() => setDesktopApp(false)} />
    </>
  );
}

function ProfileEditDialog({ open, user, onClose, onSaved }) {
  const [username, setUsername] = useState('');
  const [curPw, setCurPw] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    if (open) {
      setUsername(user?.username || '');
      setCurPw('');
      setPw('');
      setPw2('');
      setErr('');
    }
  }, [open, user]);

  const save = async () => {
    if (pw && !curPw) {
      setErr('현재 비밀번호를 입력하세요.');
      return;
    }
    if (pw && pw !== pw2) {
      setErr('비밀번호가 일치하지 않습니다.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const body = { username };
      if (pw) {
        body.currentPassword = curPw; // 서버가 현재 비밀번호를 확인해야 변경된다
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
          fullWidth type="password" label="현재 비밀번호" value={curPw}
          onChange={(e) => setCurPw(e.target.value)} sx={{ mb: 2 }}
          required={!!pw} autoComplete="current-password"
          helperText={pw && !curPw ? '비밀번호를 바꾸려면 현재 비밀번호를 입력하세요.' : ''}
        />
        <TextField
          fullWidth type="password" label="새 비밀번호 (변경 시에만)" value={pw}
          onChange={(e) => setPw(e.target.value)} sx={{ mb: 2 }} autoComplete="new-password"
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
