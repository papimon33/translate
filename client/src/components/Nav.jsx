import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { alpha } from '@mui/material/styles';
import ViewSidebarOutlinedIcon from '@mui/icons-material/ViewSidebarOutlined';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import TranslateIcon from '@mui/icons-material/Translate';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';

const W = 248;
const WC = 72;

export default function Nav({ collapsed, onToggleCollapsed, onToggleTheme, mode, onHome }) {
  const width = collapsed ? WC : W;
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
      {/* 로고 + 접기 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: collapsed ? 0 : 0.5, py: 0.5, mb: 1.5, justifyContent: collapsed ? 'center' : 'flex-start' }}>
        <Box
          sx={{
            width: 38, height: 38, borderRadius: 2.5, flex: 'none',
            display: 'grid', placeItems: 'center', color: '#fff',
            background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${mode === 'dark' ? '#9b87ff' : '#6366f1'})`,
            boxShadow: (t) => `0 6px 16px ${alpha(t.palette.primary.main, 0.4)}`,
          }}
        >
          <GraphicEqIcon fontSize="small" />
        </Box>
        {!collapsed && (
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 15, lineHeight: 1.1, whiteSpace: 'nowrap' }}>KAC Translator</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', whiteSpace: 'nowrap' }}>실시간 음성 번역</Typography>
          </Box>
        )}
      </Box>

      {!collapsed && (
        <Typography sx={{ px: 1.5, mb: 0.5, fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.04em' }}>
          메뉴
        </Typography>
      )}
      <NavItem collapsed={collapsed} icon={<TranslateIcon fontSize="small" />} label="실시간 번역" active onClick={onHome} />

      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <NavItem
          collapsed={collapsed}
          icon={mode === 'dark' ? <LightModeIcon fontSize="small" /> : <DarkModeIcon fontSize="small" />}
          label={mode === 'dark' ? '라이트 모드' : '다크 모드'}
          onClick={onToggleTheme}
          muted
        />
        <Tooltip title={collapsed ? '메뉴 펼치기' : '메뉴 접기'} placement="right">
          <IconButton onClick={onToggleCollapsed} sx={{ alignSelf: collapsed ? 'center' : 'flex-start', ml: collapsed ? 0 : 0.5 }}>
            <ViewSidebarOutlinedIcon fontSize="small" sx={{ transform: collapsed ? 'scaleX(-1)' : 'none' }} />
          </IconButton>
        </Tooltip>
      </Box>
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
