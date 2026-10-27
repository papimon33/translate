/* 안드로이드 앱 폰 화면 — 홈(세션 목록) · 새 세션 시트 · 설정/계정(전체 화면) · 세션 화면 전환.
   메뉴바·안내데스크·관리자 화면은 폰에 필요 없어 두지 않는다(데스크·관리는 PC 웹에서). */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import CircularProgress from '@mui/material/CircularProgress';
import GlobalStyles from '@mui/material/GlobalStyles';
import Snackbar from '@mui/material/Snackbar';
import { alpha, createTheme, useTheme, ThemeProvider } from '@mui/material/styles';
import TranslateView, { SX_LANGS } from '../session/TranslateView.jsx';
import { LANGS } from '../shared/theme.js';
import { api } from '../shared/api.js';
import { BottomSheet, LangSheet, ConfirmDialog, FormSheet, langOptions } from './common.jsx';
import { OptionsScreen, AccountScreen } from './OptionsScreen.jsx';
import { usePrefs, syncWithAccount } from '../shared/prefs.js';
import { useT } from '../shared/i18n.js';
import UpdateSheet from './UpdateSheet.jsx';
import { pushNav, backNav } from './backstack.js';
import { ModeIcon, shortDate, sessionLangs } from '../shared/sessionMeta.jsx';
import { appReady } from '../shared/env.js';
import { ArrowRightIcon, CheckIcon, ChevronRightIcon, PencilIcon, PlusIcon, SettingsIcon, SwapIcon, TrashIcon } from '../shared/icons.jsx';
import { BRAND } from '../shared/brand.js';
import Wordmark from '../shared/Wordmark.jsx';

const SX_CODES = SX_LANGS.map((l) => l.code);
const IN_CODES = LANGS.map((l) => l.code); // 'auto'(자동 감지) 포함 — 실시간 번역의 입력 언어 힌트

// 세션 이름 기본값 '10/22 14:30 양방향 통역' — 현장에서 매번 입력하지 않게 미리 채워 두고 고칠 수 있게(필수는 유지)
function defaultName(mode, t) {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())} ${mode === 'twoway' ? t('modeTwoway') : t('modeOneway')}`;
}

// 언어 알약 — 위 작은 글씨(역할) + 언어 이름. 누르면 언어 시트.
function LangPill({ caption, value, onClick, t }) {
  return (
    <ButtonBase onClick={onClick} aria-label={`${caption}: ${t.lang(value)}`}
      sx={{ flex: 1, minWidth: 0, height: 58, px: 1.5, borderRadius: '14px', border: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 0.1 }}>
      <Typography component="span" sx={{ fontSize: 11.5, color: 'text.secondary', fontWeight: 500 }}>{caption}</Typography>
      <Typography component="span" noWrap sx={{ fontSize: 16, fontWeight: 800, maxWidth: '100%' }}>{t.lang(value)}</Typography>
    </ButtonBase>
  );
}

// 세션 목록 한 줄 — 누르면 열기, 길게 누르면(0.5초, 손가락이 거의 안 움직일 때) 이름 바꾸기·삭제 시트. PC 우클릭도 같음.
function SessionRow({ s, t, onOpen, onActions }) {
  const lp = useRef({ timer: null, fired: false, x: 0, y: 0 });
  const cancel = () => clearTimeout(lp.current.timer);
  useEffect(() => cancel, []);
  return (
    <ButtonBase
      onPointerDown={(e) => {
        const r = lp.current;
        r.fired = false; r.x = e.clientX; r.y = e.clientY;
        cancel();
        r.timer = setTimeout(() => { r.fired = true; try { navigator.vibrate && navigator.vibrate(12); } catch {} onActions(s); }, 500);
      }}
      onPointerMove={(e) => { const r = lp.current; if (Math.abs(e.clientX - r.x) > 10 || Math.abs(e.clientY - r.y) > 10) cancel(); }}
      onPointerUp={cancel} onPointerCancel={cancel} onPointerLeave={cancel}
      onContextMenu={(e) => { e.preventDefault(); cancel(); if (!lp.current.fired) { lp.current.fired = true; onActions(s); } }}
      onClick={() => { if (lp.current.fired) { lp.current.fired = false; return; } onOpen(s); }}
      sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.75, px: 1.5, py: 1.75, borderRadius: '16px', justifyContent: 'flex-start', textAlign: 'left' }}>
      <ModeIcon preset={s.preset} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 16, fontWeight: 700 }}>{s.title || t('untitled')}</Typography>
        <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
          {[shortDate(s.updatedAt || s.createdAt, t.locale), sessionLangs(s, t.lang, { two: t('modeTwoway'), one: t('modeOneway') })].filter(Boolean).join(' · ')}
        </Typography>
      </Box>
      <ChevronRightIcon sx={{ color: 'text.disabled' }} />
    </ButtonBase>
  );
}

function NewSessionSheet({ open, onClose, onCreated }) {
  const t = useT();
  const prefs = usePrefs();
  const [mode, setMode] = useState('oneway');
  const [src, setSrc] = useState('auto');   // 실시간 번역: 입력 언어(자동 감지 기본)
  const [target, setTarget] = useState('ko'); // 실시간 번역: 출력 언어(모국어 기본)
  const [a, setA] = useState('ko');           // 양방향: 내 언어(모국어 기본)
  const [b, setB] = useState('en');           // 양방향: 상대 언어(지난번 값)
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false); // 직접 고치기 전엔 기본 이름이 모드를 따라간다
  const [touched, setTouched] = useState(false);
  const [pick, setPick] = useState(null);     // 'src' | 'target' | 'a' | 'b'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const nameRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    setName(defaultName(mode, t)); setNameEdited(false); setTouched(false); setErr(''); setBusy(false);
    const nat = prefs.nativeLang || 'ko';
    let lastB = null;
    try { lastB = localStorage.getItem('kac-sx-b'); } catch {}
    setTarget(nat);  // 실시간 번역: 입력은 항상 자동 감지, 출력은 모국어
    setSrc('auto');
    setA(nat);
    setB(lastB && lastB !== nat ? lastB : nat === 'en' ? 'ko' : 'en');
    // eslint-disable-next-line
  }, [open]);

  const empty = !name.trim();
  const pickLang = (k, v) => {
    if (k === 'src') setSrc(v);
    if (k === 'target') setTarget(v);
    // 양방향은 두 언어가 같을 수 없다 — 같은 걸 고르면 서로 바꾼다
    if (k === 'a') { if (v === b) setB(a); setA(v); }
    if (k === 'b') { if (v === a) setA(b); setB(v); }
  };
  const create = async () => {
    if (busy) return;
    if (empty) { setTouched(true); try { nameRef.current && nameRef.current.focus(); } catch {} return; }
    setBusy(true); setErr('');
    try {
      const s = await api.create({ title: name.trim(), pipeline: 'soniox', preset: mode, src: 'mic', inLang: mode === 'oneway' ? src : 'auto' });
      if (!s || !s.id) throw new Error((s && s.error) || t('netError'));
      try {
        if (mode === 'oneway') {
          localStorage.setItem('kac-sx-target', target);
          localStorage.setItem('kac-sx-target:' + s.id, target); // 다시 열 때 이 세션의 출력 언어 복원
        } else {
          localStorage.setItem('kac-sx-a', a);
          localStorage.setItem('kac-sx-b', b);
          localStorage.setItem('kac-sx-pair:' + s.id, `${a}|${b}`); // 다시 열 때 이 세션의 두 언어 복원
        }
      } catch {}
      onCreated({ ...s, _target: mode === 'oneway' ? target : undefined });
    } catch (e) {
      setErr(t('createFail', { msg: e.message || t('netError') }));
      setBusy(false);
    }
  };

  // 모드를 바꾸면(이름을 직접 고치지 않았을 때만) 기본 이름도 그 모드로
  useEffect(() => { if (open && !nameEdited) setName(defaultName(mode, t)); }, [mode]); // eslint-disable-line

  const modes = [
    { v: 'oneway', title: t('modeOneway'), desc: t('modeOnewayDesc') },
    { v: 'twoway', title: t('modeTwoway'), desc: t('modeTwowayDesc') },
  ];
  const sheetMeta = {
    src: { title: t('inputLang'), value: src, codes: IN_CODES },
    target: { title: t('outputLang'), value: target, codes: SX_CODES },
    a: { title: t('myLang'), value: a, codes: SX_CODES },
    b: { title: t('otherLang'), value: b, codes: SX_CODES },
  }[pick || 'src'];

  return (
    <>
      <BottomSheet open={open} onClose={onClose}>
        <Box sx={{ px: 2.5, pb: 3, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          <Box role="radiogroup" aria-label={t('newSession')} sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {modes.map((m) => {
              const on = mode === m.v;
              return (
                <ButtonBase key={m.v} role="radio" aria-checked={on} onClick={() => setMode(m.v)}
                  sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.75, p: 2, textAlign: 'left', borderRadius: '18px', border: on ? 2 : 1, borderColor: on ? BRAND : 'divider', bgcolor: 'background.paper', justifyContent: 'flex-start' }}>
                  <ModeIcon preset={m.v} size={44} />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{m.title}</Typography>
                    <Typography sx={{ fontSize: 13.5, color: 'text.secondary', lineHeight: 1.5, mt: 0.4, wordBreak: 'keep-all' }}>{m.desc}</Typography>
                  </Box>
                  <Box sx={{ width: 24, height: 24, flex: 'none', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: on ? BRAND : 'transparent', border: on ? 0 : 2, borderColor: 'divider' }}>
                    {on && <CheckIcon sx={{ fontSize: 15, color: '#fff', strokeWidth: 2.5 }} />}
                  </Box>
                </ButtonBase>
              );
            })}
          </Box>

          {mode === 'oneway' ? (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LangPill t={t} caption={t('inputLang')} value={src} onClick={() => setPick('src')} />
              <ArrowRightIcon aria-hidden="true" sx={{ color: 'text.secondary', flex: 'none' }} />
              <LangPill t={t} caption={t('outputLang')} value={target} onClick={() => setPick('target')} />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <LangPill t={t} caption={t('myLang')} value={a} onClick={() => setPick('a')} />
              <IconButton aria-label={t('swapLangs')} onClick={() => { setA(b); setB(a); }} sx={{ flex: 'none', width: 44, height: 44 }}>
                <SwapIcon />
              </IconButton>
              <LangPill t={t} caption={t('otherLang')} value={b} onClick={() => setPick('b')} />
            </Box>
          )}

          <Box component="label" sx={{ display: 'flex', flexDirection: 'column', px: 2, pt: 1.25, pb: 1.5, borderRadius: '18px', bgcolor: (th) => alpha(th.palette.text.primary, 0.035), border: 1, borderColor: touched && empty ? 'error.main' : 'transparent' }}>
            <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 500, color: touched && empty ? 'error.main' : 'text.secondary' }}>{t('sessionName')}</Typography>
            <InputBase inputRef={nameRef} value={name} onChange={(e) => { setName(e.target.value); setNameEdited(true); }} onBlur={() => setTouched(true)} placeholder={t('sessionNamePh')}
              inputProps={{ 'aria-label': t('sessionName'), 'aria-required': true, 'aria-invalid': touched && empty, maxLength: 80 }} sx={{ fontSize: 16, py: 0.25 }} />
          </Box>
          {touched && empty && <Typography role="alert" sx={{ fontSize: 13, color: 'error.main', mt: -1, px: 0.5 }}>{t('nameRequired')}</Typography>}
          {err && <Typography role="alert" sx={{ fontSize: 13.5, color: 'error.main' }}>{err}</Typography>}

          <ButtonBase onClick={create} disabled={busy} aria-disabled={empty}
            sx={{ height: 56, borderRadius: '16px', bgcolor: BRAND, color: '#fff', gap: 1.25, fontSize: 16, fontWeight: 700, opacity: busy || empty ? 0.45 : 1 }}>
            {busy ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : t('create')}
          </ButtonBase>
        </Box>
      </BottomSheet>
      <LangSheet
        open={!!pick}
        onClose={() => setPick(null)}
        title={sheetMeta.title}
        tabs={[{ key: 't', label: '', value: sheetMeta.value, options: langOptions(sheetMeta.codes, t), onPick: (v) => pickLang(pick, v) }]}
      />
    </>
  );
}

// 폰 화면은 바탕을 순백으로(2026-10-26 디스코드 스타일) — 대화·목록은 흰색, 조작판·설정 묶음은 옅은 회색. PC 웹은 #FAFAF8 그대로.
export default function MobileApp(props) {
  const outer = useTheme();
  // 화면 언어를 문서 언어로 — 일본어 화면이면 index.html 의 [lang|="ja"] 규칙으로 일본어 글꼴(Pretendard JP)
  const { sysLang } = usePrefs();
  useEffect(() => { try { document.documentElement.lang = sysLang || 'ko'; } catch {} }, [sysLang]);
  const theme = useMemo(() => (outer.palette.mode === 'dark' ? outer : createTheme(outer, { palette: { background: { default: '#FFFFFF' } } })), [outer]);
  return <ThemeProvider theme={theme}><MobileHome {...props} /></ThemeProvider>;
}

function MobileHome({ user, onUser, onLogout }) {
  const t = useT();
  const theme = useTheme();
  const [list, setList] = useState(null);
  const [session, setSession] = useState(null);
  const [sheet, setSheet] = useState(false);
  const [actFor, setActFor] = useState(null);       // 길게 누른 세션 — 이름 바꾸기·삭제 시트
  const [actStep, setActStep] = useState(null);     // null | 'rename' | 'delete'
  const [actTarget, setActTarget] = useState(null); // 시트를 닫은 뒤에도 이름 바꾸기·삭제 창이 쓸 세션
  const [actBusy, setActBusy] = useState(false);
  const [toast, setToast] = useState('');
  const pickAct = (step) => { setActTarget(actFor); setActFor(null); setActStep(step); };
  const closeAct = () => { setActStep(null); };
  const doDelete = async () => {
    if (!actTarget) return;
    setActBusy(true);
    try { await api.remove(actTarget.id); setActStep(null); setToast(t('sessionDeleted')); reload(); }
    catch (e) { setToast(t('failMsg', { msg: e.message || t('netError') })); }
    finally { setActBusy(false); }
  };
  const [screen, setScreen] = useState(null); // null | 'options' | 'account'
  const [backAsk, setBackAsk] = useState(0); // 세션 화면에서 하드웨어 뒤로가기 → 종료 확인 신호
  const sessionRef = useRef(null);
  const leaveOk = useRef(false);
  sessionRef.current = session;

  const reload = useCallback(() => {
    api.list().then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList((l) => l || []));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { if (list !== null) appReady(); }, [list]); // 앱: 목록까지 그려졌으면 시작 화면 닫기(목록 로딩 표시가 비치지 않게)
  useEffect(() => { syncWithAccount(user); /* 다른 기기에서 바꾼 설정 반영(1회) */ }, []); // eslint-disable-line

  // 뒤로가기(안드로이드 하드웨어 버튼 포함) = 화면 하나씩 뒤로. 네이티브는 웹 히스토리가 있으면 goBack 한다.
  useEffect(() => {
    try { window.history.replaceState({ m: 'home' }, ''); } catch {}
    const onPop = (e) => {
      const m = ((e && e.state) || {}).m;
      if (m !== 'session' && sessionRef.current) {
        // 세션 화면의 뒤로가기는 바로 나가지 않고 종료 확인('종료' 버튼과 같게) — 화면을 다시 붙잡고 신호만
        if (!leaveOk.current) {
          try { window.history.pushState({ m: 'session' }, ''); } catch {}
          setBackAsk((n) => n + 1);
          return;
        }
        leaveOk.current = false;
        setSession(null);
        reload();
      }
      setScreen(m === 'options' || m === 'account' ? m : null);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [reload]);
  const go = (m) => pushNav({ m }); // 시트가 남긴 history 항목이 있으면 그 자리를 덮어쓴다(backstack.js)
  const open = (s) => {
    go('session');
    let saved = null;
    try { saved = localStorage.getItem('kac-sx-target:' + s.id); } catch {}
    setSession(s._target || !saved ? s : { ...s, _target: saved }); // 실시간 번역: 이 세션에서 마지막으로 쓴 출력 언어
  };
  const openOptions = () => { go('options'); setScreen('options'); };
  const openAccount = () => { go('account'); setScreen('account'); };

  // 상태바·내비게이션바 색을 화면 테마에 맞춘다(네이티브)
  const dark = theme.palette.mode === 'dark';
  useEffect(() => {
    try { if (window.AndroidApp && window.AndroidApp.setDarkUi) window.AndroidApp.setDarkUi(dark); } catch {}
  }, [dark]);

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
        <TranslateView key={session.id} session={session} mobile backAsk={backAsk} onBack={() => { leaveOk.current = true; backNav(); }} />
      </Box>
    );
  }

  const sessions = (list || []).filter((s) => (s.pipeline || 'soniox') === 'soniox'); // 안내데스크·구 파이프라인은 폰에서 숨김

  return (
    <Box sx={{ height: '100dvh', display: 'flex', flexDirection: 'column', overflow: 'hidden', bgcolor: 'background.default', position: 'relative' }}>
      {globals}
      {/* 위 띠: 세션 화면 위 띠와 같은 높이·여백(위 10px + 44px 줄) — 로고가 세션 제목과 같은 높이에 온다 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, pl: 2.5, pr: 1.5, pt: 'calc(10px + env(safe-area-inset-top))', pb: 0.5 }}>
        <Typography component="h1" sx={{ lineHeight: 1 }}><Wordmark size={26} /></Typography>
        <IconButton aria-label={t('settings')} onClick={openOptions} sx={{ width: 44, height: 44, '& svg': { fontSize: 22 } }}>
          <SettingsIcon />
        </IconButton>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.5, pt: 1, pb: 14, overscrollBehavior: 'contain' }}>
        {list === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress size={28} /></Box>
        ) : sessions.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 10, px: 3 }}>
            <Typography sx={{ fontSize: 17, fontWeight: 700 }}>{t('emptyTitle')}</Typography>
            <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.75 }}>{t('emptyHint')}</Typography>
          </Box>
        ) : sessions.map((s) => <SessionRow key={s.id} s={s} t={t} onOpen={open} onActions={setActFor} />)}
      </Box>

      <ButtonBase onClick={() => setSheet(true)} aria-label={t('newSession')}
        sx={{ position: 'absolute', right: 22, bottom: 'calc(30px + env(safe-area-inset-bottom))', width: 60, height: 60, borderRadius: '18px', bgcolor: BRAND, color: '#fff', boxShadow: '0 6px 18px rgba(91,79,232,0.35)' }}>
        <PlusIcon strokeWidth={2.4} sx={{ fontSize: 28 }} />
      </ButtonBase>

      {/* 앱 본체 새 버전 알림(홈에서만 — 번역 중에는 방해하지 않는다) */}
      <UpdateSheet />

      {/* 길게 누른 세션: 이름 바꾸기·삭제 */}
      <BottomSheet open={!!actFor} onClose={() => setActFor(null)} title={(actFor && actFor.title) || t('untitled')}>
        <Box sx={{ px: 1.5, pb: 2.5, display: 'flex', flexDirection: 'column' }}>
          <ButtonBase onClick={() => pickAct('rename')} sx={{ minHeight: 56, px: 2, gap: 1.75, borderRadius: '16px', justifyContent: 'flex-start' }}>
            <PencilIcon sx={{ fontSize: 21 }} />
            <Typography sx={{ fontSize: 16.5, fontWeight: 700 }}>{t('renameShort')}</Typography>
          </ButtonBase>
          <ButtonBase onClick={() => pickAct('delete')} sx={{ minHeight: 56, px: 2, gap: 1.75, borderRadius: '16px', justifyContent: 'flex-start', color: 'error.main' }}>
            <TrashIcon sx={{ fontSize: 21 }} />
            <Typography sx={{ fontSize: 16.5, fontWeight: 700 }}>{t('deleteSession')}</Typography>
          </ButtonBase>
        </Box>
      </BottomSheet>
      <FormSheet open={actStep === 'rename'} onClose={closeAct} title={t('rename')}
        fields={[{ key: 'title', label: t('sessionName') }]} initial={{ title: (actTarget && actTarget.title) || '' }}
        validate={(v) => (String(v.title || '').trim() ? '' : t('nameRequired'))}
        onSubmit={async (v) => { await api.patch(actTarget.id, { title: String(v.title).trim() }); reload(); }} />
      <ConfirmDialog open={actStep === 'delete'} title={t('deleteSession')} desc={t('deleteConfirm', { name: (actTarget && actTarget.title) || t('untitled') })}
        okLabel={t('delete')} danger busy={actBusy} onClose={closeAct} onOk={doDelete} />
      <Snackbar open={!!toast} autoHideDuration={2400} onClose={(e, reason) => { if (reason !== 'clickaway') setToast(''); }} message={toast} />

      <NewSessionSheet open={sheet} onClose={() => setSheet(false)} onCreated={(s) => { setSheet(false); open(s); }} />

      <OptionsScreen open={screen === 'options' || screen === 'account'} onBack={backNav} user={user} onAccount={openAccount} onLogout={onLogout} />
      <AccountScreen open={screen === 'account'} onBack={backNav} user={user} onUser={onUser} onDeleted={onLogout} />
    </Box>
  );
}
