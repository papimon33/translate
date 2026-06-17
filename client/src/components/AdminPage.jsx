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
import Tooltip from '@mui/material/Tooltip';
import { alpha } from '@mui/material/styles';
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
function fmtCost(usd) {
  return '$' + (usd || 0).toFixed(usd >= 1 ? 2 : 4);
}
function fmtNum(n) {
  return (n || 0).toLocaleString('en-US');
}

function DailyChart({ daily }) {
  const data = (daily || []).slice(-14);
  if (!data.length) {
    return (
      <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 4, textAlign: 'center' }}>
        아직 사용량 데이터가 없습니다. 번역을 실행하면 집계됩니다.
      </Typography>
    );
  }
  const max = Math.max(...data.map((d) => d.cost), 1e-9);
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 160, mt: 1 }}>
      {data.map((d) => (
        <Box key={d.date} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtCost(d.cost)}</Typography>
          <Tooltip title={`${d.date} · ${fmtNum(d.tokens)} 토큰 · ${fmtCost(d.cost)}`}>
            <Box
              sx={{
                width: '70%',
                height: `${Math.max(2, (d.cost / max) * 110)}px`,
                borderRadius: 1,
                background: (t) => `linear-gradient(180deg, ${t.palette.primary.main}, ${alpha(t.palette.primary.main, 0.5)})`,
              }}
            />
          </Tooltip>
          <Typography sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}>{d.date.slice(5)}</Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function AdminPage() {
  const [list, setList] = useState(null);
  const [usage, setUsage] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState({ id: '', username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api.adminUsers().then(setList).catch(() => setList([]));
    api.adminUsage().then(setUsage).catch(() => setUsage(null));
  };
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
          {/* 토큰 사용 비용 대시보드 */}
          <Paper variant="outlined" sx={{ borderRadius: 3, p: 3, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 4, flexWrap: 'wrap' }}>
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>총 토큰 사용 비용</Typography>
                <Typography sx={{ fontSize: 32, fontWeight: 800, color: 'primary.main', lineHeight: 1.2 }}>
                  {usage ? fmtCost(usage.totalCost) : '—'}
                </Typography>
                <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                  {usage ? `${fmtNum(usage.totalTokens)} 토큰` : ''}
                </Typography>
              </Box>
              <Box sx={{ flex: 1, minWidth: 280 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>일별 사용 비용 (최근 14일)</Typography>
                <DailyChart daily={usage?.daily} />
              </Box>
            </Box>
            {usage && (
              <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 2 }}>
                ※ GPT 번역 토큰 기준 추정치 (입력 ${usage.priceIn}/1M · 출력 ${usage.priceOut}/1M). 실시간 음성 비용은 별도이며 미포함.
              </Typography>
            )}
          </Paper>

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
