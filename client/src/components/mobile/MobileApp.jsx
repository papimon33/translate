/* 안드로이드 앱 폰 화면 — 홈(세션 목록) · 새 세션 시트 · 세션 화면 전환.
   메뉴바·안내데스크·관리자 화면은 폰에 필요 없어 두지 않는다(데스크·관리는 PC 웹에서). */
import React, { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Divider from '@mui/material/Divider';
import InputBase from '@mui/material/InputBase';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import GlobalStyles from '@mui/material/GlobalStyles';
import { alpha } from '@mui/material/styles';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CheckIcon from '@mui/icons-material/Check';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import LogoutIcon from '@mui/icons-material/Logout';
import MicNoneIcon from '@mui/icons-material/MicNone';
import TranslateView from '../TranslateView.jsx';
import { api } from '../../api.js';
import { BottomSheet, LangSheet, langName, rel, useMicLabel } from './common.jsx';
import UpdateSheet from './UpdateSheet.jsx';

// 새 세션: 모드 2종. 설명 문구는 2026-10-20 요청 그대로.
const MODES = [
  { v: 'oneway', title: '실시간 번역', desc: '시스템 혹은 마이크 입력 음성을 실시간으로 번역합니다.', Icon: ArrowForwardIcon },
  { v: 'twoway', title: '양방향 통역', desc: '지정한 두 언어를 상대방 언어로 통역합니다.', Icon: SwapHorizIcon },
];
const MODE_LABEL = { oneway: '실시간 번역', live: '실시간 번역', online: '실시간 번역', twoway: '양방향 통역', mobile: '양방향 통역', field: '양방향 통역', meeting: '양방향 통역' };
const isTwo = (preset) => ['twoway', 'mobile', 'field', 'meeting'].includes(preset);

// 언어 목록은 TranslateView 와 같은 Soniox 지원 언어 — 중복 정의를 피하려고 거기서 받지 않고 짧은 주요 목록 + 전체는 시트에서.
// (새 세션에서 고르는 건 출력/상대 언어 하나뿐. 세션 화면의 언어 시트가 전체 60개를 보여준다.)
const QUICK_LANGS = [
  { code: 'en', label: 'English', sub: '영어' },
  { code: 'ja', label: '日本語', sub: '일본어' },
  { code: 'zh', label: '中文', sub: '중국어' },
  { code: 'ko', label: '한국어', sub: '한국어 그대로 기록' },
  { code: 'es', label: 'Español', sub: '스페인어' },
  { code: 'fr', label: 'Français', sub: '프랑스어' },
  { code: 'de', label: 'Deutsch', sub: '독일어' },
  { code: 'ru', label: 'Русский', sub: '러시아어' },
  { code: 'vi', label: 'Tiếng Việt', sub: '베트남어' },
  { code: 'th', label: 'ไทย', sub: '태국어' },
  { code: 'id', label: 'Bahasa Indonesia', sub: '인도네시아어' },
];

function uniqueTitle(base, titles) {
  if (!titles.includes(base)) return base;
  for (let i = 2; i < 999; i++) { const t = `${base} ${i}`; if (!titles.includes(t)) return t; }
  return base;
}

function ModeIcon({ preset, size = 46 }) {
  const two = isTwo(preset);
  const Icon = two ? SwapHorizIcon : ArrowForwardIcon;
  return (
    <Box sx={{ width: size, height: size, flex: 'none', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (t) => (two ? alpha(t.palette.accent.main, t.palette.mode === 'dark' ? 0.22 : 0.1) : alpha(t.palette.text.primary, 0.06)), color: (t) => (two ? (t.palette.mode === 'dark' ? t.palette.accent.main : '#1F5BBF') : t.palette.text.primary) }}>
      <Icon sx={{ fontSize: 22 }} />
    </Box>
  );
}

function NewSessionSheet({ open, onClose, onCreated, titles }) {
  const [mode, setMode] = useState('oneway');
  const [target, setTarget] = useState('en'); // 실시간: 출력 언어 / 양방향: 상대 언어
  const [name, setName] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) return;
    setName(''); setErr(''); setBusy(false);
    try { setTarget((mode === 'twoway' ? localStorage.getItem('kac-sx-b') : localStorage.getItem('kac-sx-target')) || 'en'); } catch {}
    // eslint-disable-next-line
  }, [open]);

  useEffect(() => { if (mode === 'twoway' && target === 'ko') setTarget('en'); }, [mode, target]);

  const create = async () => {
    if (busy) return;
    setBusy(true); setErr('');
    const base = MODE_LABEL[mode];
    const title = name.trim() || uniqueTitle(base, titles);
    try {
      const s = await api.create({ title, pipeline: 'soniox', preset: mode, src: 'mic', inLang: 'auto' });
      if (!s || !s.id) throw new Error((s && s.error) || '세션을 만들지 못했습니다');
      try {
        localStorage.setItem(mode === 'twoway' ? 'kac-sx-b' : 'kac-sx-target', target);
        if (mode === 'oneway') localStorage.setItem('kac-sx-target:' + s.id, target); // 다시 열 때 이 세션의 출력 언어 복원
      } catch {}
      onCreated({ ...s, _target: mode === 'oneway' ? target : undefined, _autoStart: true });
    } catch (e) {
      setErr('세션 생성 실패: ' + (e.message || '네트워크 오류'));
      setBusy(false);
    }
  };

  return (
    <>
      <BottomSheet open={open} onClose={onClose} title="새 세션" subtitle="어떻게 통역할지 고르세요">
        <Box sx={{ px: 2.5, pb: 3, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          <Box role="radiogroup" aria-label="모드" sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {MODES.map((m) => {
              const on = mode === m.v;
              return (
                <ButtonBase key={m.v} role="radio" aria-checked={on} onClick={() => setMode(m.v)}
                  sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75, p: 2, textAlign: 'left', borderRadius: '18px', border: on ? 2 : 1, borderColor: on ? 'text.primary' : 'divider', bgcolor: 'background.paper', justifyContent: 'flex-start' }}>
                  <ModeIcon preset={m.v} size={44} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{m.title}</Typography>
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.5, mt: 0.4, wordBreak: 'keep-all' }}>{m.desc}</Typography>
                  </Box>
                  <Box sx={{ width: 24, height: 24, flex: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: on ? 'text.primary' : 'transparent', border: on ? 0 : 2, borderColor: 'divider' }}>
                    {on && <CheckIcon sx={{ fontSize: 15, color: 'background.paper' }} />}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>

          <Box sx={{ borderRadius: '18px', bgcolor: (t) => alpha(t.palette.text.primary, 0.035) }}>
            <ButtonBase onClick={() => setLangOpen(true)} sx={{ width: '100%', minHeight: 56, px: 2, justifyContent: 'space-between', borderRadius: '18px 18px 0 0' }}>
              <Typography sx={{ fontSize: 15, fontWeight: 500 }}>{mode === 'twoway' ? '상대 언어' : '출력 언어'}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{langName(target, QUICK_LANGS)}</Typography>
                <ChevronRightIcon sx={{ color: 'text.secondary' }} />
              </Box>
            </ButtonBase>
            <Divider sx={{ mx: 2 }} />
            <Box component="label" sx={{ display: 'flex', flexDirection: 'column', px: 2, pt: 1.25, pb: 1.5 }}>
              <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, color: 'text.secondary' }}>세션 이름</Typography>
              <InputBase value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 외국인 방문객 안내" inputProps={{ 'aria-label': '세션 이름' }} sx={{ fontSize: 16, py: 0.25 }} />
            </Box>
          </Box>

          {err && <Typography sx={{ fontSize: 13.5, color: 'error.main' }}>{err}</Typography>}

          <ButtonBase onClick={create} disabled={busy}
            sx={{ height: 56, borderRadius: '16px', bgcolor: 'text.primary', color: 'background.paper', gap: 1.25, fontSize: 16, fontWeight: 700, opacity: busy ? 0.7 : 1 }}>
            {busy ? <CircularProgress size={20} sx={{ color: 'background.paper' }} /> : <MicNoneIcon />}
            시작하기
          </ButtonBase>
        </Box>
      </BottomSheet>
      <LangSheet
        open={langOpen}
        onClose={() => setLangOpen(false)}
        title={mode === 'twoway' ? '상대 언어' : '출력 언어'}
        subtitle={mode === 'twoway' ? '내 언어(한국어 기본)는 세션 화면에서 바꿀 수 있습니다' : '더 많은 언어는 세션 화면에서 고를 수 있습니다'}
        tabs={[{ key: 't', label: '', value: target, options: mode === 'twoway' ? QUICK_LANGS.filter((l) => l.code !== 'ko') : QUICK_LANGS, onPick: setTarget }]}
      />
    </>
  );
}

export default function MobileApp({ user, mode, onToggleTheme, onLogout }) {
  const [list, setList] = useState(null);
  const [session, setSession] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [acct, setAcct] = useState(null);
  const [toast, setToast] = useState('');
  const mic = useMicLabel();

  const reload = useCallback(() => {
    api.list().then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList((l) => l || []));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // 뒤로가기(안드로이드 하드웨어 버튼 포함) = 세션 → 홈. 네이티브는 웹 히스토리가 있으면 goBack 한다.
  useEffect(() => {
    try { window.history.replaceState({ m: 'home' }, ''); } catch {}
    const onPop = (e) => {
      const st = (e && e.state) || {};
      if (st.m !== 'session') { setSession(null); reload(); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reload]);
  const open = (s) => {
    try { window.history.pushState({ m: 'session' }, ''); } catch {}
    let saved = null;
    try { saved = localStorage.getItem('kac-sx-target:' + s.id); } catch {}
    setSession(s._target || !saved ? s : { ...s, _target: saved }); // 실시간 번역: 이 세션에서 마지막으로 쓴 출력 언어
  };

  // 상태바·내비게이션바 색을 화면 테마에 맞춘다(네이티브)
  useEffect(() => {
    try { if (window.AndroidApp && window.AndroidApp.setDarkUi) window.AndroidApp.setDarkUi(mode === 'dark'); } catch {}
  }, [mode]);

  // 폰 화면에선 웹 티 나는 동작을 끈다: 길게 눌러 글자 선택, 탭 번쩍임, 확대, 끝에서 튕김
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    const prev = meta && meta.getAttribute('content');
    if (meta) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
    return () => { if (meta && prev) meta.setAttribute('content', prev); };
  }, []);
  const globals = (
    <GlobalStyles styles={{
      'html, body': { overscrollBehavior: 'none', WebkitTapHighlightColor: 'transparent', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' },
      'input, textarea': { WebkitUserSelect: 'text', userSelect: 'text' },
    }} />
  );

  if (session) {
    return (
      <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {globals}
        <TranslateView key={session.id} session={session} mobile onBack={() => window.history.back()} />
      </Box>
    );
  }

  const sessions = (list || []).filter((s) => (s.pipeline || 'soniox') === 'soniox'); // 안내데스크·구 파이프라인은 폰에서 숨김
  const titles = sessions.map((s) => s.title);

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default', position: 'relative' }}>
      {globals}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pl: 3, pr: 2, pt: 3, pb: 0.5 }}>
        <Typography component="h1" sx={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em' }}>AirTalk</Typography>
        <IconButton aria-label="내 계정" onClick={(e) => setAcct(e.currentTarget)} sx={{ width: 44, height: 44, bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }}>
          <PersonOutlineIcon />
        </IconButton>
      </Box>

      <Box sx={{ px: 3, pt: 1.5, pb: 1, display: 'flex' }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, px: 1.75, py: 1, borderRadius: '999px', bgcolor: 'background.paper', border: 1, borderColor: 'divider', fontSize: 13, fontWeight: 500, maxWidth: '100%' }}>
          <Box sx={{ width: 8, height: 8, flex: 'none', borderRadius: '999px', bgcolor: mic.external ? 'success.main' : 'text.disabled' }} />
          <Typography noWrap sx={{ fontSize: 13, fontWeight: 500 }}>{mic.external ? `${mic.name} 연결됨` : mic.name}</Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, pt: 1.5, pb: 14, overscrollBehavior: 'contain' }}>
        {list === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={28} /></Box>
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 10, px: 3 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>아직 세션이 없습니다</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.75 }}>오른쪽 아래 '새 세션'으로 시작하세요.</Typography>
          </Box>
        ) : sessions.map((s) => (
          <ButtonBase key={s.id} onClick={() => open(s)}
            sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.75, px: 1.5, py: 1.75, borderRadius: '16px', justifyContent: 'flex-start', textAlign: 'left' }}>
            <ModeIcon preset={s.preset} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 16, fontWeight: 700 }}>{s.title || '제목 없음'}</Typography>
              <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
                {[MODE_LABEL[s.preset] || '실시간 번역', rel(s.updatedAt)].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
            <ChevronRightIcon sx={{ color: 'text.disabled' }} />
          </ButtonBase>
        ))}
      </Box>

      <ButtonBase onClick={() => setSheet(true)}
        sx={{ position: 'absolute', right: 20, bottom: 'calc(32px + env(safe-area-inset-bottom))', height: 58, pl: 2.5, pr: 3, gap: 1.25, borderRadius: '18px', bgcolor: 'text.primary', color: 'background.paper', fontSize: 16, fontWeight: 700, boxShadow: '0 6px 18px rgba(0,0,0,0.22)' }}>
        <AddIcon />
        새 세션
      </ButtonBase>

      {/* 앱 본체 새 버전 알림(홈에서만 — 번역 중에는 방해하지 않는다) */}
      <UpdateSheet />

      <NewSessionSheet open={sheet} onClose={() => setSheet(false)} titles={titles} onCreated={(s) => { setSheet(false); open(s); }} />

      <Menu anchorEl={acct} open={!!acct} onClose={() => setAcct(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { minWidth: 220, '& .MuiMenuItem-root': { fontSize: 15, minHeight: 48 } } } }}>
        <Box sx={{ px: 2, py: 1.25 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 700 }}>{user.name || user.id}</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{user.id}</Typography>
        </Box>
        <Divider />
        <MenuItem onClick={() => { setAcct(null); onToggleTheme(); }}>
          <ListItemIcon>{mode === 'dark' ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}</ListItemIcon>
          {mode === 'dark' ? '밝은 화면' : '어두운 화면'}
        </MenuItem>
        {window.AndroidApp && window.AndroidApp.openMenu && (
          <MenuItem onClick={() => { setAcct(null); try { window.AndroidApp.openMenu(); } catch {} }}>
            <ListItemIcon><SettingsOutlinedIcon fontSize="small" /></ListItemIcon>
            앱 설정
          </MenuItem>
        )}
        <MenuItem onClick={() => { setAcct(null); onLogout(); }}>
          <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>
          로그아웃
        </MenuItem>
      </Menu>
      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} />
    </Box>
  );
}
