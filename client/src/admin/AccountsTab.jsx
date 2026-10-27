// 관리자 > 계정 탭
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
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import Snackbar from '@mui/material/Snackbar';
import Switch from '@mui/material/Switch';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { api } from '../shared/api.js';
import { fmtDuration } from './format.js';

// 사용자별 기능 권한 — 관리자는 항상 전부 가능. 안내데스크 만들기·이름 변경·삭제는 권한과 무관하게 관리자만.
const PERMS = [
  { k: 'tts', label: '음성 재생', hint: '번역 음성을 읽어 줍니다. 읽은 글자 수만큼 비용이 듭니다.' },
  { k: 'desk', label: '안내데스크', hint: '목록에 안내데스크 세션이 보이고 운영할 수 있습니다.' },
];
const EMPTY_FORM = { id: '', username: '', password: '', perms: { tts: false, desk: false } };

// 사용자 목록·추가·권한·비밀번호 재설정·삭제
export default function AccountsTab() {
  const [list, setList] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwDlg, setPwDlg] = useState(null); // { id, name }
  const [pwVal, setPwVal] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [confirmReq, setConfirmReq] = useState(null); // 공용 확인 다이얼로그(브라우저 confirm 대체)
  const [pageSnack, setPageSnack] = useState('');

  const reload = () => {
    api.adminUsers().then(setList).catch(() => setList([]));
  };
  useEffect(() => { reload(); }, []);

  const openDlg = () => { setForm(EMPTY_FORM); setErr(''); setDlg(true); };
  const togglePerm = async (u, k) => {
    const next = { ...(u.perms || {}), [k]: !(u.perms && u.perms[k]) };
    setList((l) => l.map((x) => (x.id === u.id ? { ...x, perms: next } : x))); // 바로 반영, 실패하면 되돌린다
    try { await api.adminSetPerms(u.id, next); }
    catch (e) { setPageSnack('권한을 바꾸지 못했습니다. ' + (e.message || '다시 시도하세요.')); reload(); }
  };
  const openPwDlg = (target) => { setPwVal(''); setPwErr(''); setPwDlg(target); };
  const resetPw = async () => {
    if (!pwVal) { setPwErr('새 비밀번호를 입력하세요.'); return; }
    try { await api.adminResetPassword(pwDlg.id, pwVal); setPwDlg(null); }
    catch (e) { setPwErr(e.message || '재설정 실패'); }
  };
  const create = async () => {
    if (!form.id.trim() || !form.password) { setErr('ID와 비밀번호는 필수입니다.'); return; }
    setBusy(true); setErr('');
    try {
      await api.adminCreateUser({ id: form.id.trim(), username: form.username.trim(), password: form.password, perms: form.perms });
      setDlg(false); reload();
    } catch (e) { setErr(e.message || '생성 실패'); }
    finally { setBusy(false); }
  };
  const remove = (u) => setConfirmReq({
    title: '사용자 삭제',
    message: `'${u.username || u.id}' 사용자와 해당 사용자의 모든 세션을 삭제합니다. 되돌릴 수 없습니다.`,
    onOk: async () => {
      try { await api.adminDeleteUser(u.id); } catch (e) { setPageSnack('삭제 실패: ' + (e.message || '네트워크 오류')); }
      reload();
    },
  });
  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openDlg}>사용자 추가</Button>
      </Box>
      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 680 }}>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 800, fontSize: 13 } }}>
              <TableCell>사용자명</TableCell>
              <TableCell>ID</TableCell>
              <TableCell align="right">세션 수</TableCell>
              <TableCell align="right">총 이용 시간</TableCell>
              {PERMS.map((p) => (
                <TableCell key={p.k} align="center"><Tooltip title={p.hint}><span>{p.label}</span></Tooltip></TableCell>
              ))}
              <TableCell align="right">관리</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {list && list.length === 0 && (
              <TableRow>
                <TableCell colSpan={5 + PERMS.length} align="center" sx={{ color: 'text.secondary', py: 5 }}>아직 생성된 사용자가 없습니다.</TableCell>
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
                {PERMS.map((p) => (
                  <TableCell key={p.k} align="center" sx={{ py: 0 }}>
                    {u.role === 'admin'
                      ? <Typography component="span" sx={{ fontSize: 12.5, color: 'text.secondary' }}>항상</Typography>
                      : <Switch size="small" checked={!!(u.perms && u.perms[p.k])} onChange={() => togglePerm(u, p.k)} slotProps={{ input: { 'aria-label': `${u.username || u.id} ${p.label}` } }} />}
                  </TableCell>
                ))}
                <TableCell align="right">
                  {u.role !== 'admin' && (
                    <Tooltip title="비밀번호 재설정">
                      <IconButton size="small" onClick={() => openPwDlg({ id: u.id, name: u.username || u.id })}>
                        <LockResetIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {u.role !== 'admin' && (
                    <IconButton size="small" onClick={() => remove(u)} sx={{ color: 'error.main' }}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 420, maxWidth: 420 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>사용자 추가</DialogTitle>
        <DialogContent>
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          <TextField autoFocus fullWidth label="ID" value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth label="사용자명" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth type="password" label="비밀번호" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.secondary', mt: 2.5, mb: 0.5 }}>권한</Typography>
          {PERMS.map((p) => (
            <FormControlLabel key={p.k} sx={{ display: 'flex', alignItems: 'flex-start', mr: 0, mb: 0.5 }}
              control={<Checkbox size="small" checked={!!form.perms[p.k]} onChange={(e) => setForm((f) => ({ ...f, perms: { ...f.perms, [p.k]: e.target.checked } }))} sx={{ pt: 0.5 }} />}
              label={<Box><Typography sx={{ fontSize: 14, fontWeight: 700 }}>{p.label}</Typography><Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{p.hint}</Typography></Box>} />
          ))}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDlg(false)}>취소</Button>
          <Button variant="contained" onClick={create} disabled={busy}>만들기</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!pwDlg} onClose={() => setPwDlg(null)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>비밀번호 재설정</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}><b>{pwDlg?.name}</b> 사용자의 새 비밀번호를 입력하세요. 재설정하면 이 사용자의 모든 기기가 로그아웃됩니다.</Typography>
          {pwErr && <Alert severity="error" sx={{ mb: 2 }}>{pwErr}</Alert>}
          <TextField autoFocus fullWidth type="password" label="새 비밀번호" value={pwVal} onChange={(e) => setPwVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && resetPw()} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPwDlg(null)}>취소</Button>
          <Button variant="contained" onClick={resetPw}>재설정</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
      <Snackbar open={!!pageSnack} autoHideDuration={4000} onClose={() => setPageSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={pageSnack} />
    </>
  );
}
