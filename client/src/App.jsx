import React, { useState, useMemo } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import { buildTheme } from './theme.js';
import Nav from './components/Nav.jsx';
import SessionList from './components/SessionList.jsx';
import TranslateView from './components/TranslateView.jsx';

export default function App() {
  const [mode, setMode] = useState(localStorage.getItem('kac-theme') || 'dark');
  const [collapsed, setCollapsed] = useState(localStorage.getItem('kac-nav') === '1');
  const [session, setSession] = useState(null); // 열린 세션(null=목록)
  const theme = useMemo(() => buildTheme(mode), [mode]);

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
