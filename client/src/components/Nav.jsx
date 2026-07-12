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
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined';
import { SIDEBAR } from '../theme.js';
import { api } from '../api.js';

const W = 248;
const WC = 72;

/* 메뉴 아이콘 — 얇은 스트로크 아웃라인(모던, Claude 계열) */
const strokeProps = { component: 'svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
export function IcoGlobe(props) { // 실시간 번역: 지구본(언어)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.8 2.5 2.8 14.5 0 17M12 3.5c-2.8 2.5-2.8 14.5 0 17" />
    </Box>
  );
}
export function IcoHeadset(props) { // 데스크 안내: 헤드셋(대면 상담)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <path d="M4.5 13.5v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="12.5" width="4" height="6" rx="2" />
      <rect x="16.5" y="12.5" width="4" height="6" rx="2" />
      <path d="M19.5 18.5v.7a2.8 2.8 0 0 1-2.8 2.8H14" />
    </Box>
  );
}
export function IcoSliders(props) { // 관리자: 조절 슬라이더(운영 설정)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <path d="M4 7.5h4.5M12.5 7.5H20M4 16.5h7.5M15.5 16.5H20" />
      <circle cx="10.5" cy="7.5" r="2" />
      <circle cx="13.5" cy="16.5" r="2" />
    </Box>
  );
}

export default function Nav({ collapsed, mobile, onToggleCollapsed, onToggleTheme, mode, user, view, onHome, onDesk, onSummaries, onTerms, onAdmin, onLogout, onUserUpdate }) {
  const width = collapsed ? WC : W;
  const [menu, setMenu] = useState(null);
  const [edit, setEdit] = useState(false);
  const isAdmin = user?.role === 'admin';
  const initial = (user?.username || user?.id || '?').trim().charAt(0).toUpperCase();
  const S = SIDEBAR[mode] || SIDEBAR.light; // 사이드바는 테마를 따라감(라이트=밝게, 다크=어둡게)

  return (
    <Box
      sx={{
        width,
        minWidth: width,
        transition: 'width .2s ease, min-width .2s ease',
        bgcolor: S.bg,
        color: S.text,
        borderRight: 1,
        borderColor: S.border,
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
              <Typography sx={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2, whiteSpace: 'nowrap', color: S.textStrong, letterSpacing: '-0.01em' }}>AirTalk</Typography>
            </Box>
          </>
        )}
        {!mobile && (
          <Tooltip title={collapsed ? '메뉴 펼치기' : '메뉴 접기'} placement="right">
            <IconButton onClick={onToggleCollapsed} sx={{ flex: 'none', '&:hover': { bgcolor: S.hover } }}>
              <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" sx={{ width: 20, height: 20, color: S.muted }}>
                <rect x="3" y="4" width="18" height="16" rx="2.5" />
                <path d="M9 4v16" />
              </Box>
            </IconButton>
          </Tooltip>
        )}
      </Box>

      <NavItem S={S} collapsed={collapsed} icon={<IcoGlobe />} label="실시간 번역" active={view === 'sessions'} onClick={onHome} />
      <NavItem S={S} collapsed={collapsed} icon={<IcoHeadset />} label="데스크 안내" active={view === 'desk'} onClick={onDesk} />
      {isAdmin && (
        <NavItem S={S} collapsed={collapsed} icon={<IcoSliders />} label="관리자" active={view === 'admin'} onClick={onAdmin} />
      )}

      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {/* 프로필 (좌측 최하단) — 클릭 메뉴에 테마 토글 포함 */}
        <Box
          onClick={(e) => setMenu(e.currentTarget)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, cursor: 'pointer',
            px: collapsed ? 0 : 1, py: 1, borderRadius: 1.25,
            justifyContent: collapsed ? 'center' : 'flex-start',
            '&:hover': { bgcolor: S.hover },
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
              <Typography sx={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: S.textStrong }}>
                {user?.username || user?.id}
              </Typography>
              <Typography sx={{ fontSize: 11, color: S.muted, whiteSpace: 'nowrap' }}>
                {user?.id}{isAdmin ? ' · 관리자' : ''}
              </Typography>
            </Box>
          )}
        </Box>
      </Box>

      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} transformOrigin={{ vertical: 'bottom', horizontal: 'left' }} anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { '& .MuiMenuItem-root': { fontSize: 13 } } } }}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 13 }}>{user?.username || user?.id}</Typography>
          <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{user?.id}{isAdmin ? ' · 관리자' : ''}</Typography>
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

function NavItem({ S, collapsed, icon, label, active, muted, onClick }) {
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: collapsed ? 0 : 1.5,
        py: 1.05,
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 1.25,
        cursor: 'pointer',
        color: active ? S.textStrong : muted ? S.muted : S.text,
        fontWeight: active ? 800 : 600,
        bgcolor: active ? S.active : 'transparent',
        '&:hover': { bgcolor: active ? S.active : S.hover },
        whiteSpace: 'nowrap',
        transition: 'background .12s',
      }}
    >
      {icon}
      {!collapsed && <span style={{ fontSize: 13 }}>{label}</span>}
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
