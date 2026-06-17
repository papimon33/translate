import React, { useState, useMemo, useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { buildTheme } from './theme.js';
import Nav from './components/Nav.jsx';
import SessionList from './components/SessionList.jsx';
import TranslateView from './components/TranslateView.jsx';
import AdminPage from './components/AdminPage.jsx';
import Login from './components/Login.jsx';
import { api } from './api.js';

export default function App() {
  const [mode, setMode] = useState(localStorage.getItem('kac-theme') || 'dark');
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kac-nav') === '1');
  const [session, setSession] = useState(null); // 열린 세션(null=목록)
  const [view, setView] = useState('sessions'); // 'sessions' | 'admin'
  const [user, setUser] = useState(undefined); // undefined=확인중, null=로그아웃
  const theme = useMemo(() => buildTheme(mode), [mode]);

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
    ) : view === 'admin' && user.role === 'admin' ? (
      <AdminPage />
    ) : (
      <SessionList onOpen={setSession} />
    );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Nav
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onToggleTheme={toggleTheme}
          mode={mode}
          user={user}
          view={session ? 'sessions' : view}
          onHome={() => {
            setSession(null);
            setView('sessions');
          }}
          onAdmin={() => {
            setSession(null);
            setView('admin');
          }}
          onLogout={logout}
        />
        <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {main}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
