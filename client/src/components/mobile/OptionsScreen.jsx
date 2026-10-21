/* 폰 화면 설정 — 오른쪽에서 밀려 나오는 전체 화면(디스코드 설정 참고). 모든 항목을 한 화면에 두고,
   계정은 맨 위 프로필 카드를 눌러 들어간다. 값은 prefs.js(기기 저장 + 계정 동기화). */
import React, { forwardRef, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Slide from '@mui/material/Slide';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import Slider from '@mui/material/Slider';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LogoutIcon from '@mui/icons-material/Logout';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { api } from '../../api.js';
import { SX_LANGS } from '../TranslateView.jsx';
import { usePrefs, setPref } from './prefs.js';
import { useT } from './i18n.js';
import { Group, OptionRow, PickSheet, ConfirmDialog, FormSheet, SensSlider, langOptions } from './common.jsx';

const SlideLeft = forwardRef(function SlideLeft(props, ref) { return <Slide direction="left" ref={ref} {...props} />; });
const UI_NAMES = { ko: '한국어', en: 'English', ja: '日本語' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 전체 화면 틀(뒤로 + 제목 + 스크롤 본문)
export function Screen({ open, onBack, title, children }) {
  const t = useT();
  return (
    <Dialog fullScreen open={open} onClose={onBack} slots={{ transition: SlideLeft }}
      slotProps={{ paper: { sx: { borderRadius: 0, border: 0, backgroundImage: 'none', bgcolor: (th) => (th.palette.mode === 'dark' ? th.palette.background.default : '#F4F3EF') } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 'calc(12px + env(safe-area-inset-top))', pb: 0.5, flex: 'none' }}>
        <IconButton onClick={onBack} aria-label={t('back')} sx={{ width: 48, height: 48 }}><ArrowBackIcon /></IconButton>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.015em' }}>{title}</Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 2, pt: 0.75, pb: 'calc(28px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
    </Dialog>
  );
}

/* 설정 화면 밖(번역 중이 아닐 때)의 입력 크기 미터 — 슬라이더를 만질 때만 켠다(괜히 마이크가 켜져 있지 않게).
   앱은 네이티브 캡처(번역과 같은 원음 경로), 브라우저(개발 확인용)는 getUserMedia. */
function useIdleMeter(active) {
  const [level, setLevel] = useState(null);
  useEffect(() => {
    if (!active) { setLevel(null); return undefined; }
    let dead = false, stopFn = null, last = 0;
    const put = (rms) => {
      const now = Date.now();
      if (now - last < 80) return;
      last = now;
      setLevel(Math.max(0, Math.min(100, ((20 * Math.log10(rms + 1e-8) + 60) / 60) * 100)));
    };
    const a = window.AndroidAudio;
    if (a && a.start) {
      window.__kacNA = (b64) => {
        const bin = atob(b64);
        const n = bin.length >> 1;
        if (!n) return;
        let s = 0;
        for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 0x8000) v -= 0x10000; const f = v / 32768; s += f * f; }
        put(Math.sqrt(s / n));
      };
      let ok = false;
      try { ok = !!a.start(); } catch {}
      if (!ok) { window.__kacNA = null; return undefined; }
      stopFn = () => { try { a.stop(); } catch {} window.__kacNA = null; };
    } else if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        if (dead) { stream.getTracks().forEach((tr) => tr.stop()); return; }
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let raf = 0;
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          put(Math.sqrt(s / buf.length));
          raf = requestAnimationFrame(tick);
        };
        tick();
        stopFn = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((tr) => tr.stop()); try { ctx.close(); } catch {} };
      }).catch(() => {});
    }
    return () => { dead = true; if (stopFn) stopFn(); };
  }, [active]);
  return level;
}

function Avatar({ user, size = 48 }) {
  const ch = String(user.username || user.id || '?').trim().charAt(0).toUpperCase();
  return (
    <Box aria-hidden="true" sx={{ width: size, height: size, flex: 'none', borderRadius: '999px', bgcolor: 'text.primary', color: 'background.paper', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 800 }}>{ch}</Box>
  );
}

export function OptionsScreen({ open, onBack, user, onAccount, onLogout }) {
  const t = useT();
  const prefs = usePrefs();
  const [pick, setPick] = useState(null); // 'sys' | 'native' | 'voice' | 'theme'
  const [meterOn, setMeterOn] = useState(false);
  const [logoutAsk, setLogoutAsk] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [toast, setToast] = useState('');
  const level = useIdleMeter(open && meterOn);
  useEffect(() => { if (!open) setMeterOn(false); }, [open]);

  const native = !!window.AndroidAudio;
  const version = (() => { try { return window.AndroidApp && window.AndroidApp.version ? String(window.AndroidApp.version()) : ''; } catch { return ''; } })();
  const voiceName = (g) => (g === 'm' ? t('male') : t('female'));
  const themeName = (v) => ({ light: t('themeLight'), dark: t('themeDark'), system: t('themeSystem') }[v]);

  const preview = async (g) => {
    if (previewing) return;
    setPreviewing(g);
    try {
      let blob;
      try { blob = await api.ttsPreview(prefs.nativeLang, g); } catch { blob = await api.ttsPreview('ko', g); } // 음성이 없는 언어면 한국어로
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch { setToast(t('previewFail')); }
    finally { setPreviewing(null); }
  };
  const playBtn = (g) => (
    <IconButton onClick={() => preview(g)} aria-label={t('previewVoice', { v: voiceName(g) })}
      sx={{ width: 44, height: 44, mr: 1, flex: 'none', bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(122,162,247,0.18)' : '#EAF1FC'), color: (th) => (th.palette.mode === 'dark' ? th.palette.accent.main : '#1F5BBF') }}>
      {previewing === g ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <PlayArrowRoundedIcon />}
    </IconButton>
  );

  return (
    <Screen open={open} onBack={onBack} title={t('settings')}>
      <ButtonBase onClick={onAccount} sx={{ display: 'flex', alignItems: 'center', gap: 1.75, p: '14px 12px 14px 16px', borderRadius: '18px', bgcolor: 'background.paper', justifyContent: 'flex-start', textAlign: 'left' }}>
        <Avatar user={user} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 17, fontWeight: 800 }}>{user.username || user.id}</Typography>
          <Typography noWrap sx={{ fontSize: 13, color: 'text.secondary' }}>{user.id} · {t('accountSettings')}</Typography>
        </Box>
        <ChevronRightIcon sx={{ color: 'text.disabled' }} />
      </ButtonBase>

      <Group title={t('secLanguage')}>
        <OptionRow label={t('sysLang')} value={UI_NAMES[prefs.sysLang]} onClick={() => setPick('sys')} />
        <OptionRow label={t('nativeLang')} value={t.lang(prefs.nativeLang)} onClick={() => setPick('native')} />
      </Group>

      <Group title={t('secVoice')}>
        <Box onPointerDown={() => setMeterOn(true)}>
          <SensSlider label={t('inputSens')} value={prefs.micSens} native={native} level={level}
            hint={prefs.micSens >= 100 ? t('inputSensAll') : t('inputSensHint')}
            onChange={(v) => setPref('micSens', v)} />
        </Box>
        <OptionRow label={t('ttsVoice')} value={voiceName(prefs.ttsGender)} onClick={() => setPick('voice')} />
      </Group>

      <Group title={t('secDisplay')}>
        <OptionRow label={t('theme')} value={themeName(prefs.theme)} onClick={() => setPick('theme')} />
        <Box sx={{ px: 2.25, pt: 1.75, pb: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography sx={{ fontSize: 16, fontWeight: 700 }}>{t('textSize')}</Typography>
            <Typography sx={{ fontSize: 14.5, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{Math.round(prefs.fontScale * 100)}%</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography aria-hidden="true" sx={{ fontSize: 13, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
            <Slider value={prefs.fontScale} min={0.8} max={1.6} step={0.1} aria-label={t('textSize')}
              onChange={(e, v) => setPref('fontScale', Math.round(v * 10) / 10)}
              sx={{ color: 'text.primary', '& .MuiSlider-thumb': { width: 24, height: 24, bgcolor: 'background.paper', border: 2, borderColor: 'text.primary' } }} />
            <Typography aria-hidden="true" sx={{ fontSize: 21, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
          </Box>
        </Box>
      </Group>

      <Group>
        <OptionRow label={t('logout')} danger icon={<LogoutIcon sx={{ color: 'error.main', fontSize: 21 }} />} onClick={() => setLogoutAsk(true)} />
      </Group>

      {version && <Typography sx={{ textAlign: 'center', fontSize: 12.5, color: 'text.disabled', pt: 1 }}>AirTalk {version}</Typography>}

      <PickSheet open={pick === 'sys'} onClose={() => setPick(null)} title={t('sysLang')} value={prefs.sysLang}
        options={['ko', 'en', 'ja'].map((c) => ({ code: c, label: UI_NAMES[c] }))} onPick={(v) => setPref('sysLang', v)} />
      <PickSheet open={pick === 'native'} onClose={() => setPick(null)} title={t('nativeLang')} value={prefs.nativeLang}
        options={langOptions(SX_LANGS.map((l) => l.code), t)} onPick={(v) => setPref('nativeLang', v)} />
      <PickSheet open={pick === 'voice'} onClose={() => setPick(null)} title={t('ttsVoice')} subtitle={t('ttsVoiceDesc')} value={prefs.ttsGender} keepOpen
        options={['f', 'm'].map((g) => ({ code: g, label: voiceName(g), extra: playBtn(g) }))} onPick={(v) => setPref('ttsGender', v)} />
      <PickSheet open={pick === 'theme'} onClose={() => setPick(null)} title={t('theme')} value={prefs.theme}
        options={['light', 'dark', 'system'].map((v) => ({ code: v, label: themeName(v) }))} onPick={(v) => setPref('theme', v)} />

      <ConfirmDialog open={logoutAsk} title={t('logoutConfirm')} okLabel={t('logout')} danger onClose={() => setLogoutAsk(false)} onOk={() => { setLogoutAsk(false); onLogout(); }} />
      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} />
    </Screen>
  );
}

export function AccountScreen({ open, onBack, user, onUser, onDeleted }) {
  const t = useT();
  const [form, setForm] = useState(null); // 'name' | 'email' | 'pw' | 'delete'
  const [toast, setToast] = useState('');
  const isAdmin = user.role === 'admin'; // 관리자는 env 계정 — 사용자명·비밀번호·삭제 불가(이메일은 가능)
  const saveMe = async (body) => {
    const r = await api.updateMe(body);
    if (r && r.user) onUser({ ...user, ...r.user });
    return r;
  };
  return (
    <Screen open={open} onBack={onBack} title={t('account')}>
      <Group title={t('accountInfo')}>
        <OptionRow label="ID" value={user.id} />
        <OptionRow label={t('username')} value={user.username || user.id} onClick={isAdmin ? undefined : () => setForm('name')} />
        <OptionRow label={t('email')} value={user.email || t('notSet')} onClick={() => setForm('email')} />
      </Group>
      <Group>
        <OptionRow label={t('changePassword')} onClick={() => setForm('pw')} disabled={isAdmin} />
      </Group>
      <Group>
        <OptionRow label={t('deleteAccount')} danger onClick={() => setForm('delete')} disabled={isAdmin} />
      </Group>
      {isAdmin && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 0.75, lineHeight: 1.5 }}>{t('adminManaged')}</Typography>}

      <FormSheet open={form === 'name'} onClose={() => setForm(null)} title={t('username')}
        fields={[{ key: 'username', label: t('username'), autoComplete: 'nickname' }]} initial={{ username: user.username || '' }}
        validate={(v) => (String(v.username || '').trim() ? '' : t('required', { f: t('username') }))}
        onSubmit={async (v) => { await saveMe({ username: String(v.username).trim() }); setToast(t('saved')); }} />
      <FormSheet open={form === 'email'} onClose={() => setForm(null)} title={t('email')}
        fields={[{ key: 'email', label: t('email'), type: 'email', placeholder: t('emailPh'), autoComplete: 'email' }]} initial={{ email: user.email || '' }}
        validate={(v) => { const e = String(v.email || '').trim(); return !e || EMAIL_RE.test(e) ? '' : t('emailInvalid'); }}
        onSubmit={async (v) => { await saveMe({ email: String(v.email || '').trim() }); setToast(t('saved')); }} />
      <FormSheet open={form === 'pw'} onClose={() => setForm(null)} title={t('changePassword')}
        fields={[
          { key: 'cur', label: t('currentPassword'), type: 'password', autoComplete: 'current-password' },
          { key: 'pw', label: t('newPassword'), type: 'password', autoComplete: 'new-password' },
          { key: 'pw2', label: t('confirmPassword'), type: 'password', autoComplete: 'new-password' },
        ]}
        validate={(v) => (!v.cur ? t('required', { f: t('currentPassword') }) : !v.pw ? t('required', { f: t('newPassword') }) : v.pw !== v.pw2 ? t('pwMismatch') : '')}
        onSubmit={async (v) => { await saveMe({ currentPassword: v.cur, password: v.pw, passwordConfirm: v.pw2 }); setToast(t('pwChanged')); }} />
      <FormSheet open={form === 'delete'} onClose={() => setForm(null)} title={t('deleteAccount')} subtitle={t('deleteAccountDesc')} danger okLabel={t('deleteAccount')}
        fields={[{ key: 'pw', label: t('currentPassword'), type: 'password', autoComplete: 'current-password' }]}
        validate={(v) => (v.pw ? '' : t('required', { f: t('currentPassword') }))}
        onSubmit={async (v) => { await api.deleteMe(v.pw); onDeleted(); }} />
      <Snackbar open={!!toast} autoHideDuration={2400} onClose={() => setToast('')} message={toast} />
    </Screen>
  );
}
