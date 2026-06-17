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
import { alpha } from '@mui/material/styles';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import TranslateIcon from '@mui/icons-material/Translate';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';

const W = 248;
const WC = 72;

export default function Nav({ collapsed, onToggleCollapsed, onToggleTheme, mode, user, view, onHome, onAdmin, onLogout }) {
  const width = collapsed ? WC : W;
  const [menu, setMenu] = useState(null);
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
      {/* 상단: (펼침) 프로필 + 로고 + 토글 / (접힘) 토글만 */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          px: collapsed ? 0 : 0.5, py: 0.5, mb: 1.5,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        {!collapsed && (
          <>
            <Tooltip title="프로필">
              <Avatar
                onClick={(e) => setMenu(e.currentTarget)}
                sx={{
                  width: 38, height: 38, flex: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 16, color: '#fff',
                  background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${mode === 'dark' ? '#9b87ff' : '#6366f1'})`,
                  boxShadow: (t) => `0 6px 16px ${alpha(t.palette.primary.main, 0.4)}`,
                }}
              >
                {initial}
              </Avatar>
            </Tooltip>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography sx={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1, whiteSpace: 'nowrap' }}>KAC Translator</Typography>
              <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {user?.username || user?.id}{isAdmin ? ' · 관리자' : ''}
              </Typography>
            </Box>
          </>
        )}
        <Tooltip title={collapsed ? '메뉴 펼치기' : '메뉴 접기'} placement="right">
          <IconButton onClick={onToggleCollapsed} sx={{ flex: 'none' }}>
            <ViewSidebarOutlinedIcon fontSize="small" sx={{ transform: collapsed ? 'scaleX(-1)' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Box>

      {!collapsed && (
        <Typography sx={{ px: 1.5, mb: 0.5, fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em' }}>
          메뉴
        </Typography>
      )}
      <NavItem collapsed={collapsed} icon={<TranslateIcon fontSize="small" />} label="실시간 번역" active={view === 'sessions'} onClick={onHome} />
      {isAdmin && (
        <NavItem collapsed={collapsed} icon={<AdminPanelSettingsOutlinedIcon fontSize="small" />} label="관리자" active={view === 'admin'} onClick={onAdmin} />
      )}

      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <NavItem
          collapsed={collapsed}
          icon={mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          label={mode === 'dark' ? '라이트 모드' : '다크 모드'}
          onClick={onToggleTheme}
          muted
        />
        <NavItem collapsed={collapsed} icon={<LogoutIcon fontSize="small" />} label="로그아웃" onClick={onLogout} muted />
      </Box>

      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        <Box sx={{ px: 2, py: 1 }}>
          <Typography sx={{ fontWeight: 700, fontSize: 14 }}>{user?.username || user?.id}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{user?.id}{isAdmin ? ' · 관리자' : ''}</Typography>
        </Box>
        <Divider />
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
    </Box>
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
