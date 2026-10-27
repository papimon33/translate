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
import Switch from '@mui/material/Switch';
import Snackbar from '@mui/material/Snackbar';
import CircularProgress from '@mui/material/CircularProgress';
import { api } from '../shared/api.js';
import { can } from '../shared/authState.js';
import { SX_LANGS } from '../session/TranslateView.jsx';
import { usePrefs, setPref } from '../shared/prefs.js';
import { useT } from '../shared/i18n.js';
import { Group, OptionRow, PickSheet, ConfirmDialog, FormSheet, SensSlider, MicSheet, langOptions, useBackClose, useIdleMeter, useMicInputs, micCurrentName } from './common.jsx';
import UpdateSheet, { useAppVersion } from './UpdateSheet.jsx';
import { Line, Bubble } from './MobileLive.jsx';
import { ArrowLeftIcon, ChevronRightIcon, LogOutIcon, PlayIcon } from '../shared/icons.jsx';
import { BRAND, BRAND_SOFT } from '../shared/brand.js';

const SlideLeft = forwardRef(function SlideLeft(props, ref) { return <Slide direction="left" ref={ref} {...props} />; });
const UI_NAMES = { ko: '한국어', en: 'English', ja: '日本語' };

// 전체 화면 틀(뒤로 + 제목 + 스크롤 본문)
export function Screen({ open, onBack, title, children, footer, bg }) {
  const t = useT();
  return (
    <Dialog fullScreen open={open} onClose={onBack} slots={{ transition: SlideLeft }}
      slotProps={{ paper: { sx: { borderRadius: 0, border: 0, backgroundImage: 'none', bgcolor: (th) => (bg ? (bg === 'background.default' ? th.palette.background.default : bg) : th.palette.mode === 'dark' ? th.palette.background.default : '#F4F3EF') } } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 'calc(12px + env(safe-area-inset-top))', pb: 0.5, flex: 'none' }}>
        <IconButton onClick={onBack} aria-label={t('back')} sx={{ width: 48, height: 48 }}><ArrowLeftIcon /></IconButton>
        <Typography component="h1" sx={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.015em' }}>{title}</Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: 2, pt: 0.75, pb: footer ? 2 : 'calc(28px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {children}
      </Box>
      {footer}
    </Dialog>
  );
}

/* 텍스트 크기 — 세션 화면처럼 예시 대화를 보여 주고 아래 막대로 조절(바로 반영). 뒤로가기 = 닫기. */
function TextSizeScreen({ open, onBack }) {
  const t = useT();
  const prefs = usePrefs();
  useBackClose(open, onBack);
  const scale = prefs.fontScale;
  return (
    <Screen open={open} onBack={onBack} title={t('textSize')} bg="background.default"
      footer={(
        <Box sx={{ borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper', px: 3, pt: 1.5, pb: 'calc(20px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Typography sx={{ textAlign: 'center', fontSize: 14.5, fontWeight: 700, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{Math.round(scale * 100)}%</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography aria-hidden="true" sx={{ fontSize: 14, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
            <Slider value={scale} min={0.8} max={1.6} step={0.1} marks aria-label={t('textSize')}
              onChange={(e, v) => setPref('fontScale', Math.round(v * 10) / 10)}
              sx={{ color: 'text.primary', '& .MuiSlider-thumb': { width: 26, height: 26, bgcolor: 'background.paper', border: 2, borderColor: 'text.primary' }, '& .MuiSlider-mark': { width: 4, height: 4, borderRadius: '999px' } }} />
            <Typography aria-hidden="true" sx={{ fontSize: 24, fontWeight: 700, color: 'text.secondary' }}>{t('sampleGlyph')}</Typography>
          </Box>
        </Box>
      )}>
      <Box sx={{ flex: 1 }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, px: 0.5 }}>
        <Bubble mine={false} label={`${t.lang('ja')} → ${t.lang('ko')}`} text="이 공장은 몇 년에 지어졌나요?" source="この工場は何年に建てられましたか。" scale={scale} lang="ko" srcLang="ja" />
        <Bubble mine label={`${t.lang('ko')} → ${t.lang('ja')}`} text="1995年に建てられ、2018年に増築しました。" source="1995년에 지어졌고, 2018년에 증축했습니다." scale={scale} lang="ja" srcLang="ko" />
        <Box sx={{ pt: 1.5 }}>
          <Line text="다음은 3층 출국장으로 이동하겠습니다." source="Next, we will move to the departure hall on the third floor." scale={scale} t={t} lang="ko" srcLang="en" />
        </Box>
      </Box>
    </Screen>
  );
}

function Avatar({ user, size = 48 }) {
  const ch = String(user.username || user.id || '?').trim().charAt(0).toUpperCase();
  return (
    <Box aria-hidden="true" sx={{ width: size, height: size, flex: 'none', borderRadius: '999px', bgcolor: BRAND, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 800 }}>{ch}</Box>
  );
}

export function OptionsScreen({ open, onBack, user, onAccount, onLogout }) {
  const t = useT();
  const prefs = usePrefs();
  const [pick, setPick] = useState(null); // 'sys' | 'native' | 'voice' | 'theme' | 'mic' | 'size' | 'update'
  const [meterOn, setMeterOn] = useState(false);
  const mic = useMicInputs();
  const ver = useAppVersion();
  const [logoutAsk, setLogoutAsk] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const [toast, setToast] = useState('');
  const { l: level } = useIdleMeter(open && meterOn);
  useEffect(() => { if (!open) setMeterOn(false); }, [open]);

  const native = !!window.AndroidAudio;
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
      sx={{ width: 44, height: 44, mr: 1, flex: 'none', bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(91,79,232,0.28)' : BRAND_SOFT), color: BRAND, '&:hover': { bgcolor: (th) => (th.palette.mode === 'dark' ? 'rgba(91,79,232,0.28)' : BRAND_SOFT) } }}>
      {previewing === g ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <PlayIcon />}
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
        <OptionRow label={t('connectedDevice')} value={micCurrentName(mic, t)} onClick={() => setPick('mic')} />
        <OptionRow toggle label={t('autoSens')} onClick={() => setPref('micAuto', !prefs.micAuto)}
          value={<Switch edge="end" checked={prefs.micAuto} tabIndex={-1} slotProps={{ input: { 'aria-label': t('autoSens') } }}
            sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#fff' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: BRAND, opacity: 1 } }} />} />
        {prefs.micAuto ? (
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 2.25, py: 1.5, lineHeight: 1.5 }}>{t('autoSensHint')}</Typography>
        ) : (
          <Box onPointerDown={() => setMeterOn(true)}>
            <SensSlider label={t('inputSens')} value={prefs.micSens} native={native} level={level}
              hint={t('inputSensHint')}
              onChange={(v) => setPref('micSens', v)} />
          </Box>
        )}
        {can('tts') && <OptionRow label={t('ttsVoice')} value={voiceName(prefs.ttsGender)} onClick={() => setPick('voice')} />}
      </Group>

      <Group title={t('secDisplay')}>
        <OptionRow label={t('theme')} value={themeName(prefs.theme)} onClick={() => setPick('theme')} />
        <OptionRow label={t('textSize')} value={`${Math.round(prefs.fontScale * 100)}%`} onClick={() => setPick('size')} />
      </Group>

      {ver.cur && (
        <Group>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 54, pl: 2.25, pr: 1.25 }}>
            <Typography sx={{ flex: 1, fontSize: 16, fontWeight: 700 }}>{t('version')} <Box component="span" sx={{ fontWeight: 500, color: 'text.secondary', ml: 0.75, fontVariantNumeric: 'tabular-nums' }}>{ver.cur}</Box></Typography>
            {ver.hasNew ? (
              <ButtonBase onClick={() => setPick('update')} sx={{ height: 36, px: 1.5, borderRadius: '10px', fontSize: 14.5, fontWeight: 700, color: BRAND }}>
                {t('updateTo', { v: ver.latest })}
              </ButtonBase>
            ) : (
              <Typography sx={{ fontSize: 14.5, color: 'text.secondary', pr: 1 }}>{ver.latest ? t('latestVersion') : ''}</Typography>
            )}
          </Box>
        </Group>
      )}

      <Group>
        <OptionRow label={t('logout')} danger icon={<LogOutIcon sx={{ color: 'error.main', fontSize: 21 }} />} onClick={() => setLogoutAsk(true)} />
      </Group>

      <PickSheet open={pick === 'sys'} onClose={() => setPick(null)} title={t('sysLang')} value={prefs.sysLang}
        options={['ko', 'en', 'ja'].map((c) => ({ code: c, label: UI_NAMES[c] }))} onPick={(v) => setPref('sysLang', v)} />
      <PickSheet open={pick === 'native'} onClose={() => setPick(null)} title={t('nativeLang')} value={prefs.nativeLang}
        options={langOptions(SX_LANGS.map((l) => l.code), t)} onPick={(v) => setPref('nativeLang', v)} />
      <PickSheet open={pick === 'voice'} onClose={() => setPick(null)} title={t('ttsVoice')} subtitle={t('ttsVoiceDesc')} value={prefs.ttsGender} keepOpen
        options={['f', 'm'].map((g) => ({ code: g, label: voiceName(g), extra: playBtn(g) }))} onPick={(v) => setPref('ttsGender', v)} />
      <PickSheet open={pick === 'theme'} onClose={() => setPick(null)} title={t('theme')} value={prefs.theme}
        options={['light', 'dark', 'system'].map((v) => ({ code: v, label: themeName(v) }))} onPick={(v) => setPref('theme', v)} />

      <MicSheet open={pick === 'mic'} onClose={() => setPick(null)} mic={mic} />
      <TextSizeScreen open={pick === 'size'} onBack={() => setPick(null)} />
      <UpdateSheet manual open={pick === 'update'} onClose={() => setPick(null)} />
      <ConfirmDialog open={logoutAsk} title={t('logoutConfirm')} okLabel={t('logout')} danger onClose={() => setLogoutAsk(false)} onOk={() => { setLogoutAsk(false); onLogout(); }} />
      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} />
    </Screen>
  );
}

export function AccountScreen({ open, onBack, user, onUser, onDeleted }) {
  const t = useT();
  const [form, setForm] = useState(null); // 'name' | 'pw' | 'delete' (이메일은 쓰는 곳이 없어 화면에서 뺐다 — 서버 필드는 유지)
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
      </Group>
      <Group>
        <OptionRow label={t('changePassword')} onClick={() => setForm('pw')} disabled={isAdmin} />
      </Group>
      <Group>
        <OptionRow label={t('deleteAccount')} danger onClick={() => setForm('delete')} disabled={isAdmin} />
      </Group>

      <FormSheet open={form === 'name'} onClose={() => setForm(null)} title={t('username')}
        fields={[{ key: 'username', label: t('username'), autoComplete: 'nickname' }]} initial={{ username: user.username || '' }}
        validate={(v) => (String(v.username || '').trim() ? '' : t('required', { f: t('username') }))}
        onSubmit={async (v) => { await saveMe({ username: String(v.username).trim() }); setToast(t('saved')); }} />
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
