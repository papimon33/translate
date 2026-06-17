import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Table from '@mui/material/Table';
import TableHead from '@mui/material/TableHead';
import TableBody from '@mui/material/TableBody';
import TableRow from '@mui/material/TableRow';
import TableCell from '@mui/material/TableCell';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { api } from '../api.js';

function fmtDuration(ms) {
  const s = Math.floor((ms || 0) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s % 60}초`;
  return `${s}초`;
}

export default function AdminPage() {
  const [list, setList] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState({ id: '', username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => api.adminUsers().then(setList).catch(() => setList([]));
  useEffect(() => {
    reload();
  }, []);

  const openDlg = () => {
    setForm({ id: '', username: '', password: '' });
    setErr('');
    setDlg(true);
  };
  const create = async () => {
    if (!form.id.trim() || !form.password) {
      setErr('ID와 비밀번호는 필수입니다.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.adminCreateUser({ id: form.id.trim(), username: form.username.trim(), password: form.password });
      setDlg(false);
      reload();
    } catch (e) {
      setErr(e.message || '생성 실패');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (u) => {
    if (!confirm(`'${u.username || u.id}' 사용자와 해당 사용자의 모든 세션을 삭제할까요?`)) return;
    await api.adminDeleteUser(u.id);
    reload();
  };

  return (
    <>
      <Box sx={{ px: 4, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Box>
          <Typography variant="h6">관리자 · 사용자 관리</Typography>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.25 }}>
            사용자를 생성하고 사용량을 확인합니다.
          </Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openDlg}>
          사용자 추가
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 4 }}>
        <Box sx={{ maxWidth: 920, mx: 'auto' }}>
          <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
            <Table>
              <TableHead>
                <TableRow sx={{ '& th': { fontWeight: 800, fontSize: 13 } }}>
                  <TableCell>사용자명</TableCell>
                  <TableCell>ID</TableCell>
                  <TableCell align="right">세션 수</TableCell>
                  <TableCell align="right">총 이용 시간</TableCell>
                  <TableCell align="right">관리</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 5 }}>
                      아직 생성된 사용자가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
                {(list || []).map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell sx={{ fontWeight: 700 }}>
                      {u.username || u.id}
                      {u.role === 'admin' && <Chip size="small" label="관리자" color="primary" sx={{ ml: 1, height: 20, fontSize: 11 }} />}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{u.id}</TableCell>
                    <TableCell align="right">{u.sessionCount}</TableCell>
                    <TableCell align="right">{fmtDuration(u.usageMs)}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => remove(u)} sx={{ color: 'error.main' }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      </Box>

      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 420, maxWidth: 420 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>사용자 추가</DialogTitle>
        <DialogContent>
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          <TextField
            autoFocus fullWidth label="ID" value={form.id}
            onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth label="사용자명" value={form.username}
            onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth type="password" label="비밀번호" value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDlg(false)}>취소</Button>
          <Button variant="contained" onClick={create} disabled={busy}>
            만들기
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
