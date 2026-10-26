import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Wordmark from './Wordmark.jsx';
import Alert from '@mui/material/Alert';
import { api } from '../api.js';
import { BRAND, BRAND_DARK } from '../brand.js';
import { appReady } from './mobile/env.js';

// 아이디·비밀번호는 폰 키보드가 첫 글자를 대문자로 바꾸거나 자동 수정하지 않게
const PLAIN_INPUT = { autoCapitalize: 'none', autoCorrect: 'off', spellCheck: false };

export default function Login({ onSuccess }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [need2fa, setNeed2fa] = useState(false); // 관리자 2FA 활성 시 인증 코드 입력
  const [otp, setOtp] = useState('');
  useEffect(() => { appReady(); }, []); // 앱: 로그인 화면이 그려졌으면 시작 화면 닫기

  const submit = async (e) => {
    e.preventDefault();
    if (!id || !pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      // 자동 로그인 항상(아이디 저장·자동 로그인 선택 삭제, 2026-10-21) — 쿠키 30일 유지
      const { user } = await api.login(id, pw, true, need2fa ? otp : undefined);
      onSuccess(user);
    } catch (e) {
      if (e.need2fa) {
        // 비밀번호는 맞음 — 인증 앱 코드 단계로 전환. 첫 진입에도 서버 안내문을 보여준다.
        setNeed2fa(true);
        setOtp('');
        setErr(e.message || '인증 앱의 6자리 코드를 입력하세요.');
      } else if (need2fa && e.status === 429) {
        // 코드 단계에서 시도 초과 잠금 — 코드 입력 단계를 유지한 채 잠금 안내(비밀번호 재입력으로 오인하지 않게)
        setErr(e.message || '시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
      } else {
        setNeed2fa(false);
        setErr(e.message || '로그인 실패');
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
        {err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
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
      </Box>
    </Box>
  );
}
