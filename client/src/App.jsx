import React, { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { ThemeProvider, CssBaseline } from '@mui/material';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { buildTheme } from './shared/theme.js';
import TopBar from './pc/TopBar.jsx';
import SessionList from './pc/SessionList.jsx';
import Login from './auth/Login.jsx';
import CommandPalette from './pc/CommandPalette.jsx';
import { api } from './shared/api.js';
import { MOBILE_UI, PHONE_BROWSER, IS_IPHONE, PC_V2 } from './shared/env.js';
import AppDownload from './phone/AppDownload.jsx';
import { getPrefs, subscribePrefs, resolveTheme } from './shared/prefs.js';
import { isAdminTab } from './admin/tabs.js';
import { setPerms, onAuthLost } from './shared/authState.js';

// 무거운 화면은 코드 스플리팅(필요할 때 로드) — 초기 번들 축소
const TranslateView = lazy(() => import('./session/TranslateView.jsx'));
const AdminPage = lazy(() => import('./admin/AdminPage.jsx'));
// 안드로이드 앱 전용 폰 화면(메뉴바 없음) — 앱에서만 로드
const MobileApp = lazy(() => import('./phone/MobileApp.jsx'));

export default function App() {
  // 폰 화면은 설정의 테마(라이트/다크/시스템)를 따른다 — 시스템이면 기기 설정 변경에도 바로 반응
  const [mode, setMode] = useState(() => (MOBILE_UI ? resolveTheme(getPrefs().theme) : localStorage.getItem('kac-theme') || 'light'));
  useEffect(() => {
    if (!MOBILE_UI) return undefined;
    const sync = () => setMode(resolveTheme(getPrefs().theme));
    const un = subscribePrefs(sync);
    let mq = null;
    try { mq = window.matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', sync); } catch {}
    return () => { un(); try { mq && mq.removeEventListener('change', sync); } catch {} };
  }, []);
  const [session, setSession] = useState(null); // 열린 세션(null=목록)
  const [view, setView] = useState('sessions'); // 'sessions' | 'admin'
  const [adminTab, setAdminTab] = useState('usage'); // 관리자 화면 탭
  const [user, setUser] = useState(undefined); // undefined=확인중, null=로그아웃
  const [lostReason, setLostReason] = useState(''); // 다른 기기 로그인·비밀번호 변경으로 로그아웃된 이유(로그인 화면 안내)
  setPerms(user && user.perms); // 권한(음성 재생·안내데스크) — 화면들이 can() 으로 읽는다
  const [isFs, setIsFs] = useState(false); // 전체화면(안내데스크) — 위 띠 숨김
  const theme = useMemo(() => buildTheme(mode, { brand: PC_V2 }), [mode]);

  useEffect(() => {
    const h = () => setIsFs(!!(document.fullscreenElement || document.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', h);
    document.addEventListener('webkitfullscreenchange', h);
    return () => { document.removeEventListener('fullscreenchange', h); document.removeEventListener('webkitfullscreenchange', h); };
  }, []);

  useEffect(() => {
    api
      .me()
      .then((r) => { if (!r.user && r.reason) setLostReason(r.reason); setUser(r.user || null); })
      .catch(() => setUser(null));
  }, []);
  // 다른 기기에서 같은 종류로 로그인했거나 비밀번호가 바뀜 → 로그인 화면(번역 중이면 중지한 뒤에 온다)
  useEffect(() => onAuthLost((reason) => {
    setLostReason(reason);
    setUser(null);
    setSession(null);
    setView('sessions');
    if (!MOBILE_UI) { try { window.history.replaceState({ view: 'sessions', session: null }, '', '/'); } catch {} }
  }), []);

  const toggleTheme = () => {
    const next = mode === 'dark' ? 'light' : 'dark';
    setMode(next);
    localStorage.setItem('kac-theme', next);
  };
  const logout = async () => {
    try {
      await api.logout();
    } catch {}
    setUser(null);
    setSession(null);
    setView('sessions');
    if (!MOBILE_UI) { try { window.history.replaceState({ view: 'sessions', session: null }, '', '/'); } catch {} }
  };

  // PC 화면 주소(2026-10-27): / 목록(실시간 번역·안내데스크 세션 함께) · /s/<세션> · /admin/<탭>.
  // 새로고침·즐겨찾기·링크 공유가 된다. 폰 화면(MobileApp)은 주소를 쓰지 않는다(앱 WebView).
  const pathOf = (st) => (st.session ? `/s/${st.session.id}` : st.view === 'admin' ? `/admin/${st.adminTab || 'usage'}` : '/');
  // 첫 진입 주소 → 화면(로그인 뒤에 한 번). 세션 주소는 세션 정보를 받아 와서 연다.
  const routeDone = useRef(false);
  useEffect(() => {
    if (MOBILE_UI || !user || routeDone.current) return;
    routeDone.current = true;
    const p = window.location.pathname;
    const m = /^\/s\/([^/]+)/.exec(p);
    if (m) {
      api.get(decodeURIComponent(m[1])).then((sess) => {
        if (!sess || !sess.id) throw new Error('not found');
        const st = { session: sess, view: 'sessions' };
        try { window.history.replaceState(st, '', pathOf(st)); } catch {}
        setSession(sess); setView(st.view);
      }).catch(() => { try { window.history.replaceState({ view: 'sessions', session: null }, '', '/'); } catch {} });
      return;
    }
    const a = /^\/admin(?:\/([^/]+))?/.exec(p);
    const st = a && user.role === 'admin' ? { view: 'admin', adminTab: isAdminTab(a[1]) ? a[1] : 'usage', session: null } : { view: 'sessions', session: null };
    try { window.history.replaceState(st, '', pathOf(st)); } catch {}
    setView(st.view);
    if (st.view === 'admin') setAdminTab(st.adminTab);
  }, [user]);
  // 브라우저 뒤로가기(popstate) ↔ 앱 화면 연동: 세션 안에서 뒤로가기 → 목록
  useEffect(() => {
    if (MOBILE_UI) return undefined; // 폰 화면은 MobileApp 이 히스토리를 직접 관리
    const onPop = (e) => {
      const st = (e && e.state) || { view: 'sessions', session: null };
      setSession(st.session || null);
      setView(st.view || 'sessions');
      if (st.view === 'admin') setAdminTab(st.adminTab || 'usage'); // 뒤로가기 시 관리자 탭도 복원
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // 화면 이동 시 히스토리에 push(뒤로가기로 직전 화면 복귀) — 주소도 함께
  const navTo = (next) => {
    try { window.history.pushState(next, '', pathOf(next)); } catch {}
    setSession(next.session || null);
    setView(next.view || 'sessions');
  };
  const openSession = (s) => navTo({ session: s, view: 'sessions' });
  const openAdmin = (tab) => { const t = isAdminTab(tab) ? tab : 'usage'; setAdminTab(t); navTo({ view: 'admin', adminTab: t }); };

  // ⌘K/Ctrl+K 명령 팔레트 — 세션 검색·이동·새 세션
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createSignal, setCreateSignal] = useState(0); // 팔레트에서 '새 세션' 선택 시 SessionList 모달 열기
  useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setPaletteOpen((v) => !v); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const paletteNav = (next) => {
    if (next.openCreate) { navTo({ view: 'sessions' }); setCreateSignal((n) => n + 1); }
    else if (next.view === 'admin') openAdmin(next.adminTab);
    else navTo(next);
  };

  // 인터넷 연결 감지 — 끊기면 상단에 안내 배너(끊긴 줄 모르고 무한 대기하는 문제 방지)
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const offlineBanner = offline && (
    <Box sx={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2000, bgcolor: '#e8912d', color: '#fff', textAlign: 'center', py: 0.6, fontSize: 13, fontWeight: 700 }}>
      인터넷 연결이 끊겼습니다. 연결되면 자동으로 이어집니다.
    </Box>
  );

  // 휴대폰 브라우저: 로그인 대신 앱 설치 화면(폰은 앱으로만). iPhone 은 앱이 없어 '웹으로 계속' 허용(이 탭 동안).
  const [webOk, setWebOk] = useState(() => { try { return sessionStorage.getItem('kac-web-ok') === '1'; } catch { return false; } });
  if (PHONE_BROWSER && !(IS_IPHONE && webOk)) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <AppDownload iphone={IS_IPHONE} onContinueWeb={() => { try { sessionStorage.setItem('kac-web-ok', '1'); } catch {} setWebOk(true); }} />
      </ThemeProvider>
    );
  }

  if (user === undefined) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* 폰: 빈 흰 화면(앱은 이 동안 시작 화면이 덮고 있다) / PC: 로딩 표시 */}
        {MOBILE_UI ? <Box sx={{ height: '100dvh', bgcolor: '#fff' }} /> : (
          <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress />
          </Box>
        )}
      </ThemeProvider>
    );
  }
  if (!user) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <Login lostReason={lostReason} onSuccess={(u) => { setLostReason(''); routeDone.current = false; setUser(u); }} />
      </ThemeProvider>
    );
  }

  // 안드로이드 앱: 안내데스크·관리자 없이 폰 전용 화면
  if (MOBILE_UI) {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {offlineBanner}
        <Suspense fallback={<Box sx={{ height: '100dvh', bgcolor: '#fff' }} />}>
          <MobileApp user={user} onUser={setUser} onLogout={logout} />
        </Suspense>
      </ThemeProvider>
    );
  }

  const main =
    session ? (
      // key: 세션을 바꾸면 화면을 새로 만든다 — 세션 화면은 상태를 첫 렌더의 세션 값으로 초기화하므로,
      // 키가 없으면 다른 세션을 골라도 이전 세션의 모드·언어·녹음 대상이 그대로 남았다.
      <TranslateView key={session.id} session={session} onBack={() => window.history.back()} />
    ) : view === 'admin' && user.role === 'admin' ? (
      <AdminPage user={user} tab={adminTab} onTab={openAdmin} />
    ) : (
      <SessionList onOpen={openSession} user={user} createSignal={createSignal} />
    );

  // PC: 위 띠(로고 · 개인설정) + 본문. 세션 화면은 자체 위 띠(뒤로·제목)가 있어 숨긴다.
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {offlineBanner}
        {!session && !isFs && (
          <TopBar onHome={() => navTo({ view: 'sessions' })} user={user} mode={mode} onToggleTheme={toggleTheme}
            onAdmin={() => openAdmin()} onLogout={logout} onUserUpdate={(u) => setUser(u)} />
        )}
        <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <Suspense
            fallback={
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CircularProgress />
              </Box>
            }
          >
            {main}
          </Suspense>
        </Box>
        <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} user={user} onNavigate={paletteNav} />
      </Box>
    </ThemeProvider>
  );
}
