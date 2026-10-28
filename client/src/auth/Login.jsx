import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Wordmark from '../shared/Wordmark.jsx';
import Alert from '@mui/material/Alert';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import { api } from '../shared/api.js';
import { BRAND, BRAND_DARK } from '../shared/brand.js';
import { appReady, MOBILE_UI } from '../shared/env.js';

// 데스크톱 앱 설치본 — 이 컴퓨터가 Mac 이면 dmg, 아니면 Windows exe(서버가 최신 릴리스에서 골라 준다)
const DESKTOP_HREF = `/download/desktop?platform=${typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent || '') ? 'mac' : 'win'}`;

// 아이디·비밀번호는 폰 키보드가 첫 글자를 대문자로 바꾸거나 자동 수정하지 않게
const PLAIN_INPUT = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false };

// 로그아웃된 이유(App 이 넘겨준다) — 로그인 화면 위에 한 번 보여 준다
const LOST_MSG = {
  replaced: '다른 기기에서 이 계정으로 로그인해 로그아웃되었습니다.',
  password: '비밀번호가 바뀌어 로그아웃되었습니다. 다시 로그인하세요.',
};

export default function Login({ onSuccess, lostReason }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [need2fa, setNeed2fa] = useState(false); // 관리자 2FA 활성 시 인증 코드 입력
  const [otp, setOtp] = useState('');
  const [askReplace, setAskReplace] = useState(false); // 같은 종류의 다른 기기에서 로그인 중 → 확인 창
  useEffect(() => { appReady(); }, []); // 앱: 로그인 화면이 그려졌으면 시작 화면 닫기

  const submit = async (e, replace) => {
    if (e) e.preventDefault();
    if (!id || !pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      // 자동 로그인 항상(아이디 저장·자동 로그인 선택 삭제, 2026-10-21) — 쿠키 30일 유지
      const { user } = await api.login(id, pw, true, need2fa ? otp : undefined, replace);
      onSuccess(user);
    } catch (e) {
      if (e.confirmReplace) {
        setAskReplace(true);
      } else if (e.need2fa) {
        // 비밀번호는 맞음 — 인증 앱 코드 단계로 전환. 첫 진입에도 서버 안내문을 보여준다.
        setNeed2fa(true);
        setOtp('');
        setErr(e.message || '인증 앱의 6자리 코드를 입력하세요.');
      } else if (need2fa && e.status === 429) {
        // 코드 단계에서 시도 초과 잠금 — 코드 입력 단계를 유지한 채 잠금 안내(비밀번호 재입력으로 오인하지 않게)
        setErr(e.message || '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
      } else {
        setNeed2fa(false);
        setErr(e.message || '로그인하지 못했습니다. 다시 시도하세요.');
        setPw('');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 3, bgcolor: (t) => (t.palette.mode === 'dark' ? t.palette.background.default : '#fff') }}>
      <Box component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 360 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3.5 }}>
          <Typography component="h1" sx={{ lineHeight: 1 }}><Wordmark size={40} /></Typography>
        </Box>
        {err ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        ) : LOST_MSG[lostReason] && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {LOST_MSG[lostReason]}
          </Alert>
        )}
        <TextField
          label="ID"
          value={id}
          onChange={(e) => setId(e.target.value)}
          fullWidth
          autoFocus
          disabled={busy}
          slotProps={{ htmlInput: { ...PLAIN_INPUT, autoComplete: 'username' } }}
          sx={{ mb: 2 }}
        />
        <TextField
          type="password"
          label="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          fullWidth
          disabled={busy}
          slotProps={{ htmlInput: { ...PLAIN_INPUT, autoComplete: 'current-password' } }}
          sx={{ mb: 2.5 }}
        />
        {need2fa && (
          <TextField
            label="인증 코드"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            fullWidth
            autoFocus
            disabled={busy}
            placeholder="인증 앱의 6자리 숫자"
            helperText="Google Authenticator 등 인증 앱에 표시된 코드를 입력하세요"
            slotProps={{ htmlInput: { inputMode: 'numeric', autoComplete: 'one-time-code' } }}
            sx={{ mb: 2.5 }}
          />
        )}
        <Button type="submit" variant="contained" fullWidth size="large" disableElevation disabled={busy || !id || !pw || (need2fa && otp.length !== 6)}
          sx={{ height: 52, borderRadius: '12px', fontSize: 16, fontWeight: 700, bgcolor: BRAND, color: '#fff', '&:hover': { bgcolor: BRAND_DARK }, '&.Mui-disabled': { bgcolor: BRAND, color: '#fff', opacity: 0.4 } }}>
          {busy ? '확인 중…' : need2fa ? '코드 확인' : '로그인'}
        </Button>
        {!MOBILE_UI && (
          <Box sx={{ textAlign: 'center', mt: 2.5 }}>
            <Box component="a" href={DESKTOP_HREF} sx={{ fontSize: 13.5, color: 'text.secondary', textDecoration: 'none', '&:hover, &:focus-visible': { textDecoration: 'underline', color: 'text.primary' } }}>
              데스크톱 앱 받기
            </Box>
          </Box>
        )}
      </Box>
      <Dialog open={askReplace} onClose={() => setAskReplace(false)} PaperProps={{ sx: { width: 400, maxWidth: 'calc(100% - 32px)', borderRadius: '20px' } }}>
        <DialogTitle sx={{ fontWeight: 800, fontSize: 18, pb: 1 }}>다른 기기에서 사용 중인 계정입니다</DialogTitle>
        <DialogContent sx={{ fontSize: 15, color: 'text.secondary', lineHeight: 1.55 }}>
          여기서 로그인하면 다른 기기는 로그아웃됩니다. 그 기기에서 진행 중인 번역은 중지할 때까지 계속됩니다.
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setAskReplace(false)} sx={{ color: 'text.secondary', fontWeight: 700 }}>취소</Button>
          <Button variant="contained" disableElevation onClick={() => { setAskReplace(false); submit(null, true); }}
            sx={{ fontWeight: 700, borderRadius: '10px', bgcolor: BRAND, color: '#fff', '&:hover': { bgcolor: BRAND_DARK } }}>
            로그인
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
