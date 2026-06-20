import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import FormControlLabel from '@mui/material/FormControlLabel';
import Checkbox from '@mui/material/Checkbox';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [id, setId] = useState(() => localStorage.getItem('kac-saved-id') || '');
  const [pw, setPw] = useState('');
  const [saveId, setSaveId] = useState(() => !!localStorage.getItem('kac-saved-id'));
  const [remember, setRemember] = useState(() => localStorage.getItem('kac-remember') === '1');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!id || !pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      const { user } = await api.login(id, pw, remember);
      // ID 저장 / 자동 로그인 설정 기억
      if (saveId) localStorage.setItem('kac-saved-id', id);
      else localStorage.removeItem('kac-saved-id');
      localStorage.setItem('kac-remember', remember ? '1' : '0');
      onSuccess(user);
    } catch (e) {
      setErr(e.message || '로그인 실패');
      setPw('');
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
        elevation={3}
        sx={{ p: 4, width: '100%', maxWidth: 360, borderRadius: 3 }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 3 }}>
          <LockOutlinedIcon sx={{ fontSize: 40, color: 'primary.main', mb: 1 }} />
          <Typography variant="h6" fontWeight={800}>
            KAC Translator
          </Typography>
          <Typography variant="body2" color="text.secondary">
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
        <Button type="submit" variant="contained" fullWidth size="large" disabled={busy || !id || !pw}>
          {busy ? '확인 중…' : '입장'}
        </Button>
      </Paper>
    </Box>
  );
}
