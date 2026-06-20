import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Drawer from '@mui/material/Drawer';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import MenuIcon from '@mui/icons-material/Menu';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import { alpha } from '@mui/material/styles';
import { buildTheme } from './theme.js';
import Nav from './components/Nav.jsx';
import SessionList from './components/SessionList.jsx';
import Login from './components/Login.jsx';
import { api } from './api.js';

// 무거운 화면은 코드 스플리팅(필요할 때 로드) — 초기 번들 축소
const TranslateView = lazy(() => import('./components/TranslateView.jsx'));
const AdminPage = lazy(() => import('./components/AdminPage.jsx'));
const SummaryPage = lazy(() => import('./components/SummaryPage.jsx'));
const GlossaryPage = lazy(() => import('./components/GlossaryPage.jsx'));

export default function App() {
  const [mode, setMode] = useState(localStorage.getItem('kac-theme') || 'dark');
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kac-nav') === '1');
  const [session, setSession] = useState(null); // 열린 세션(null=목록)
  const [view, setView] = useState('sessions'); // 'sessions' | 'admin'
  const [user, setUser] = useState(undefined); // undefined=확인중, null=로그아웃
  const [drawer, setDrawer] = useState(false); // 모바일 네비 드로어
  const theme = useMemo(() => buildTheme(mode), [mode]);
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  useEffect(() => {
    api
      .me()
      .then((r) => setUser(r.user || null))
      .catch(() => setUser(null));
  }, []);

  const toggleTheme = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    localStorage.setItem('kac-theme', next);
  };
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('kac-nav', next ? '1' : '0');
  };
  const logout = async () => {
    try {
      await api.logout();
    } catch {}
    setUser(null);
    setSession(null);
    setView('sessions');
    setDrawer(false);
  };

  if (user === undefined) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }
  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Login onSuccess={(u) => setUser(u)} />
      </ThemeProvider>
    );
  }

  const main =
    session ? (
      <TranslateView session={session} onBack={() => setSession(null)} />
    ) : view === 'summaries' ? (
      <SummaryPage />
    ) : view === 'glossary' ? (
      <GlossaryPage />
    ) : view === 'admin' && user.role === 'admin' ? (
      <AdminPage />
    ) : (
      <SessionList onOpen={setSession} user={user} />
    );
  const mainEl = (
    <Suspense
      fallback={
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      }
    >
      {main}
    </Suspense>
  );

  const nav = (
    <Nav
      collapsed={isMobile ? false : collapsed}
      mobile={isMobile}
      onToggleCollapsed={toggleCollapsed}
      onToggleTheme={toggleTheme}
      mode={mode}
      user={user}
      view={session ? 'sessions' : view}
      onHome={() => {
        setSession(null);
        setView('sessions');
        setDrawer(false);
      }}
      onSummaries={() => {
        setSession(null);
        setView('summaries');
        setDrawer(false);
      }}
      onGlossary={() => {
        setSession(null);
        setView('glossary');
        setDrawer(false);
      }}
      onAdmin={() => {
        setSession(null);
        setView('admin');
        setDrawer(false);
      }}
      onLogout={logout}
      onUserUpdate={(u) => setUser(u)}
    />
  );

  // 모바일: 상단 AppBar + 햄버거 드로어
  if (isMobile) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
          <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider', bgcolor: 'background.paper' }}>
            <Toolbar sx={{ gap: 1, minHeight: 56 }}>
              <IconButton edge="start" onClick={() => setDrawer(true)} aria-label="메뉴">
                <MenuIcon />
              </IconButton>
              <Box
                sx={{
                  width: 30, height: 30, borderRadius: 2, display: 'grid', placeItems: 'center', color: '#fff',
                  background: (t) => `linear-gradient(135deg, ${t.palette.primary.main}, ${mode === 'dark' ? '#9b87ff' : '#6366f1'})`,
                }}
              >
                <GraphicEqIcon sx={{ fontSize: 18 }} />
              </Box>
              <Typography sx={{ fontWeight: 800, fontSize: 16 }}>KAC Translator</Typography>
            </Toolbar>
          </AppBar>
          <Drawer open={drawer} onClose={() => setDrawer(false)} PaperProps={{ sx: { width: 268 } }}>
            {nav}
          </Drawer>
          <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {mainEl}
          </Box>
        </Box>
      </ThemeProvider>
    );
  }

  // 데스크톱: 고정 사이드바
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {nav}
        <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {mainEl}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
