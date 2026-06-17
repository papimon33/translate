import React, { useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Alert from '@mui/material/Alert';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { api } from '../api.js';

export default function Login({ onSuccess }) {
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!id || !pw || busy) return;
    setBusy(true);
    setErr('');
    try {
      const { user } = await api.login(id, pw);
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
          sx={{ mb: 2 }}
        />
        <Button type="submit" variant="contained" fullWidth size="large" disabled={busy || !id || !pw}>
          {busy ? '확인 중…' : '입장'}
        </Button>
      </Paper>
    </Box>
  );
}
