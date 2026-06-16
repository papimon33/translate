import React, { useState, useMemo, useEffect } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { buildTheme } from './theme.js';
import Nav from './components/Nav.jsx';
import SessionList from './components/SessionList.jsx';
import TranslateView from './components/TranslateView.jsx';
import Login from './components/Login.jsx';
import { api } from './api.js';

export default function App() {
  const [mode, setMode] = useState(localStorage.getItem('kac-theme') || 'dark');
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kac-nav') === '1');
  const [session, setSession] = useState(null); // 열린 세션(null=목록)
  const [authed, setAuthed] = useState(null); // null=확인중, true/false
  const theme = useMemo(() => buildTheme(mode), [mode]);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => setAuthed(!s.required || s.authed))
      .catch(() => setAuthed(true)); // 상태 확인 실패 시 막지 않음(서버가 처리)
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

  if (authed === null) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress />
        </Box>
      </ThemeProvider>
    );
  }
  if (!authed) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Login onSuccess={() => setAuthed(true)} />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        <Nav
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onToggleTheme={toggleTheme}
          mode={mode}
          onHome={() => setSession(null)}
        />
        <Box component="main" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {session ? (
            <TranslateView session={session} onBack={() => setSession(null)} />
          ) : (
            <SessionList onOpen={setSession} />
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
