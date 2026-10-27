// 관리자 화면 — 탭 전환만 한다. 탭 내용은 같은 폴더의 *Tab.jsx(사용량·안내데스크·계정·로그·시스템)와 TermsConfigPage(용어).
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { ACCENT } from '../shared/theme.js';
import { ADMIN_TABS } from '../pc/Nav.jsx';
import TermsConfigPage from './TermsConfigPage.jsx';
import UsageTab from './UsageTab.jsx';
import DesksTab from './DesksTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import LogsTab from './LogsTab.jsx';
import SystemTab from './SystemTab.jsx';

// 상단 탭은 제거 — 이동은 좌측 nav 의 관리자 하위메뉴에서. 제목은 Nav 의 ADMIN_TABS 에서 파생(중복 정의 drift 방지).
const PAGE_TITLES = Object.fromEntries(ADMIN_TABS.map((t) => [t.v, t.label]));

export default function AdminPage({ user, tab = 'usage' }) {
  const theme = useTheme();
  const brand = ACCENT[theme.palette.mode] || ACCENT.light; // 시그니처 보라 — 그래프 전용
  return (
    <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
      {/* 컨텐츠 전폭 사용(시안): 제목 아래 넓은 영역 */}
      <Box sx={{ maxWidth: 1240, mx: 'auto' }}>
        {/* 페이지 제목 — 사용량 화면은 기간 세그먼트와 함께 자체 렌더링 */}
        {tab !== 'usage' && (
          <Typography component="h1" sx={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', mb: 2.5 }}>{PAGE_TITLES[tab]}</Typography>
        )}
        {tab === 'usage' && <UsageTab brand={brand} />}
        {tab === 'desks' && <DesksTab brand={brand} />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'terms' && <TermsConfigPage user={user} embedded />}
        {tab === 'system' && <SystemTab />}
      </Box>
    </Box>
  );
}
