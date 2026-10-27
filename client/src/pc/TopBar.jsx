// PC 위 띠 — 왼쪽 로고(누르면 세션 목록), 오른쪽 개인설정 아이콘. 폰 목록 화면의 위 띠와 같은 구성.
import React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Wordmark from '../shared/Wordmark.jsx';
import AccountMenu from './AccountMenu.jsx';

export default function TopBar({ onHome, ...menu }) {
  return (
    <Box component="header" sx={{ flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 60, pl: { xs: 2, sm: 3 }, pr: { xs: 1, sm: 2 } }}>
      <ButtonBase onClick={onHome} aria-label="세션 목록" sx={{ borderRadius: 1.5, px: 0.5, py: 0.5 }}>
        <Wordmark size={24} />
      </ButtonBase>
      <AccountMenu {...menu} />
    </Box>
  );
}
