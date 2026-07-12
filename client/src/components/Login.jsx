import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [id, setId] = useState(() => localStorage.getItem('kac-saved-id') || '');
  const [pw, setPw] = useState('');
  const [saveId, setSaveId] = useState(() => !!localStorage.getItem('kac-saved-id'));
  const [remember, setRemember] = useState(() => localStorage.getItem('kac-remember') === '1');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [need2fa, setNeed2fa] = useState(false); // 관리자 2FA 활성 시 인증 코드 입력
  const [otp, setOtp] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!id || !pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      const { user } = await api.login(id, pw, remember, need2fa ? otp : undefined);
      // ID 저장 / 자동 로그인 설정 기억
      if (saveId) localStorage.setItem('kac-saved-id', id);
      else localStorage.removeItem('kac-saved-id');
      localStorage.setItem('kac-remember', remember ? '1' : '0');
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
    <Box
      sx={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Paper
        component="form"
        onSubmit={submit}
        variant="outlined"
        sx={{ p: 4, width: '100%', maxWidth: 380, borderRadius: 2 }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <Box component="img" src="/favicon.svg" alt="KAC" sx={{ width: 52, height: 52, borderRadius: 1.5, mb: 1.5 }} />
          <Typography sx={{ fontWeight: 800, fontSize: 21, letterSpacing: '-0.02em' }}>
            AirTalk
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            ID와 비밀번호로 로그인하세요
          </Typography>
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
          sx={{ mb: 2 }}
        />
        <TextField
          type="password"
          label="비밀번호"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          fullWidth
          disabled={busy}
          sx={{ mb: 1 }}
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
            sx={{ mb: 1 }}
          />
        )}
        <Box sx={{ display: 'flex', flexDirection: 'column', mb: 1.5 }}>
          <FormControlLabel
            control={<Checkbox size="small" checked={saveId} onChange={(e) => setSaveId(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13.5 }}>아이디 저장</Typography>}
          />
          <FormControlLabel
            control={<Checkbox size="small" checked={remember} onChange={(e) => setRemember(e.target.checked)} />}
            label={<Typography sx={{ fontSize: 13.5 }}>자동 로그인 (브라우저를 닫아도 유지)</Typography>}
          />
        </Box>
        <Button type="submit" variant="contained" fullWidth size="large" disabled={busy || !id || !pw || (need2fa && otp.length !== 6)}>
          {busy ? '확인 중…' : need2fa ? '코드 확인' : '입장'}
        </Button>
      </Paper>
    </Box>
  );
}
