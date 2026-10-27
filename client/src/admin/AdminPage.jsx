// 관리자 화면 — 위 탭으로 이동한다. 탭 내용은 같은 폴더의 *Tab.jsx(사용량·계정·로그·시스템)와 TermsConfigPage(용어).
import React from 'react';
import Box from '@mui/material/Box';
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { useTheme } from '@mui/material/styles';
import { ACCENT } from '../shared/theme.js';
import { ADMIN_TABS } from './tabs.js';
import TermsConfigPage from './TermsConfigPage.jsx';
import UsageTab from './UsageTab.jsx';
import AccountsTab from './AccountsTab.jsx';
import LogsTab from './LogsTab.jsx';
import SystemTab from './SystemTab.jsx';

export default function AdminPage({ user, tab = 'usage', onTab }) {
  const theme = useTheme();
  const brand = ACCENT[theme.palette.mode] || ACCENT.light; // 시그니처 보라 — 그래프 전용
  return (
    <Box sx={{ flex: 1, overflowY: 'auto', px: { xs: 2, sm: 4 }, pb: { xs: 2, sm: 4 } }}>
      {/* 컨텐츠 전폭 사용(시안): 탭 아래 넓은 영역 */}
      <Box sx={{ maxWidth: 1240, mx: 'auto' }}>
        <Tabs value={tab} onChange={(e, v) => onTab && onTab(v)} variant="scrollable" scrollButtons={false} aria-label="관리자 메뉴"
          sx={{ mb: 3, minHeight: 44, borderBottom: 1, borderColor: 'divider', '& .MuiTab-root': { minHeight: 44, px: 1.5, mr: 1, fontSize: 14, fontWeight: 700, textTransform: 'none' } }}>
          {ADMIN_TABS.map((t) => <Tab key={t.v} value={t.v} label={t.label} />)}
        </Tabs>
        {tab === 'usage' && <UsageTab brand={brand} />}
        {tab === 'accounts' && <AccountsTab />}
        {tab === 'logs' && <LogsTab />}
        {tab === 'terms' && <TermsConfigPage user={user} embedded />}
        {tab === 'system' && <SystemTab />}
      </Box>
    </Box>
  );
}
