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
import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import LockResetIcon from '@mui/icons-material/LockReset';
import PeopleAltOutlinedIcon from '@mui/icons-material/PeopleAltOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import PaidOutlinedIcon from '@mui/icons-material/PaidOutlined';
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import TermsConfigPage from './TermsConfigPage.jsx';
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
  return '$' + (usd || 0).toFixed(usd >= 1 ? 2 : 3);
}
function fmtMin(m) {
  return (m || 0).toFixed(m >= 10 ? 0 : 1) + '분';
}

function UsageChart({ data, kind }) {
  const rows = (data || []).slice(kind === 'hourly' ? -24 : -14);
  if (!rows.length) {
    return (
      <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 4, textAlign: 'center' }}>
        아직 사용량 데이터가 없습니다. 번역을 실행하면 집계됩니다.
      </Typography>
    );
  }
  const max = Math.max(...rows.map((d) => d.cost), 1e-9);
  const keyOf = (d) => (kind === 'hourly' ? d.hour : d.date);
  const labelOf = (d) => {
    if (kind === 'hourly') return new Date(d.hour + ':00:00Z').getHours() + '시';
    return d.date.slice(5);
  };
  const tipOf = (d) => {
    if (kind === 'hourly') {
      const dt = new Date(d.hour + ':00:00Z');
      return `${dt.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit' })} · ${fmtMin(d.minutes)} · ${fmtCost(d.cost)}`;
    }
    return `${d.date} · ${fmtMin(d.minutes)} (실시간 ${fmtMin(d.translateMin)} / 다국어 ${fmtMin(d.whisperMin)}) · ${fmtCost(d.cost)}`;
  };
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: kind === 'hourly' ? 0.4 : 1, height: 160, mt: 1 }}>
      {rows.map((d) => (
        <Box key={keyOf(d)} sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
          {kind !== 'hourly' && <Typography sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}>{fmtCost(d.cost)}</Typography>}
          <Tooltip title={tipOf(d)}>
            <Box
              sx={{
                width: '70%',
                height: `${Math.max(2, (d.cost / max) * 110)}px`,
                borderRadius: 1,
                background: (t) => `linear-gradient(180deg, ${t.palette.primary.main}, ${alpha(t.palette.primary.main, 0.5)})`,
              }}
            />
          </Tooltip>
          <Typography sx={{ fontSize: 10, color: 'text.secondary', whiteSpace: 'nowrap' }}>{labelOf(d)}</Typography>
        </Box>
      ))}
    </Box>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <Box sx={{ flex: '1 1 180px', minWidth: 160, bgcolor: (t) => alpha(t.palette.text.primary, 0.02), border: 1, borderColor: 'divider', borderRadius: 3, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', mb: 1 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 2, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>{icon}</Box>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
    </Box>
  );
}

function EmptyTab({ icon, title, desc }) {
  return (
    <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 72, height: 72, mx: 'auto', mb: 2, borderRadius: '50%', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>{icon}</Box>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>{title}</Typography>
      <Typography sx={{ fontSize: 14, mt: 0.75 }}>{desc}</Typography>
    </Box>
  );
}

const TABS = [
  { v: 'usage', label: '사용량' },
  { v: 'accounts', label: '계정 관리' },
  { v: 'terms', label: '용어 설정' },
  { v: 'logs', label: '접속 기록' },
  { v: 'alerts', label: '알림 설정' },
];

export default function AdminPage({ user }) {
  const [tab, setTab] = useState('usage');
  const [list, setList] = useState(null);
  const [usage, setUsage] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState({ id: '', username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [pwDlg, setPwDlg] = useState(null); // { id, name }
  const [pwVal, setPwVal] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [usageView, setUsageView] = useState('daily'); // 'daily' | 'hourly'

  const reload = () => {
    api.adminUsers().then(setList).catch(() => setList([]));
    api.adminUsage().then(setUsage).catch(() => setUsage(null));
  };
  useEffect(() => { reload(); }, []);

  const totalSessions = (list || []).reduce((a, u) => a + (u.sessionCount || 0), 0);

  const openDlg = () => { setForm({ id: '', username: '', password: '' }); setErr(''); setDlg(true); };
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
      await api.adminCreateUser({ id: form.id.trim(), username: form.username.trim(), password: form.password });
      setDlg(false); reload();
    } catch (e) { setErr(e.message || '생성 실패'); }
    finally { setBusy(false); }
  };
  const remove = async (u) => {
    if (!confirm(`'${u.username || u.id}' 사용자와 해당 사용자의 모든 세션을 삭제할까요?`)) return;
    await api.adminDeleteUser(u.id);
    reload();
  };

  return (
    <>
      {/* 헤더(제목 가운데) + 서브탭(가운데) */}
      <Box sx={{ px: { xs: 2, sm: 4 }, pt: { xs: 2, sm: 4.5 }, borderBottom: 1, borderColor: 'divider' }}>
        <Typography sx={{ textAlign: 'center', fontWeight: 800, fontSize: { xs: 23, sm: 28 }, letterSpacing: '-0.02em', mb: { xs: 2, sm: 2.5 } }}>관리자</Typography>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
          sx={{ minHeight: 40, '& .MuiTabs-flexContainer': { justifyContent: 'center' }, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 700, fontSize: 14 } }}>
          {TABS.map((t) => <Tab key={t.v} value={t.v} label={t.label} />)}
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 960, mx: 'auto' }}>
          {/* ── 사용량 ── */}
          {tab === 'usage' && (
            <>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
                <StatCard icon={<PeopleAltOutlinedIcon fontSize="small" />} label="사용자" value={list ? list.length : '—'} />
                <StatCard icon={<ForumOutlinedIcon fontSize="small" />} label="총 세션" value={list ? totalSessions : '—'} />
                <StatCard icon={<ScheduleOutlinedIcon fontSize="small" />} label="총 사용 시간" value={usage ? fmtMin(usage.totalMinutes) : '—'} />
                <StatCard icon={<PaidOutlinedIcon fontSize="small" />} label="총 사용 비용" value={usage ? fmtCost(usage.totalCost) : '—'} />
              </Box>

              <Paper variant="outlined" sx={{ borderRadius: 3, p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography sx={{ fontSize: 13, fontWeight: 800 }}>
                    {usageView === 'hourly' ? '시간대별 사용 비용 (최근 24시간)' : '일별 사용 비용 (최근 14일)'}
                  </Typography>
                  <Box sx={{ flex: 1 }} />
                  <ToggleButtonGroup size="small" exclusive value={usageView} onChange={(e, v) => v && setUsageView(v)}>
                    <ToggleButton value="daily" sx={{ py: 0.2, px: 1.2, fontSize: 11, textTransform: 'none' }}>일별</ToggleButton>
                    <ToggleButton value="hourly" sx={{ py: 0.2, px: 1.2, fontSize: 11, textTransform: 'none' }}>시간별</ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <UsageChart data={usageView === 'hourly' ? usage?.hourly : usage?.daily} kind={usageView} />
                {usage && (
                  <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 2 }}>
                    ※ 호스트 사용 시간 기준 — 실시간 번역 ${usage.rateTranslate}/분 · 다국어 번역 ${usage.rateWhisper}/분.
                  </Typography>
                )}
              </Paper>
            </>
          )}

          {/* ── 계정 관리 ── */}
          {tab === 'accounts' && (
            <>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openDlg}>사용자 추가</Button>
            </Box>
            <Paper variant="outlined" sx={{ borderRadius: 3, overflowX: 'auto' }}>
              <Table sx={{ minWidth: 520 }}>
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
                      <TableCell colSpan={5} align="center" sx={{ color: 'text.secondary', py: 5 }}>아직 생성된 사용자가 없습니다.</TableCell>
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
                        {u.role !== 'admin' && (
                          <Tooltip title="비밀번호 재설정">
                            <IconButton size="small" onClick={() => openPwDlg({ id: u.id, name: u.username || u.id })}>
                              <LockResetIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <IconButton size="small" onClick={() => remove(u)} sx={{ color: 'error.main' }}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Paper>
            </>
          )}

          {/* ── 용어 설정 (이관) ── */}
          {tab === 'terms' && <TermsConfigPage user={user} embedded />}

          {/* ── 접속 기록 ── */}
          {tab === 'logs' && (
            <EmptyTab icon={<HistoryOutlinedIcon sx={{ fontSize: 34 }} />} title="접속 기록" desc="로그인·주요 액션 감사 로그입니다. 백엔드 연동 후 표시됩니다." />
          )}

          {/* ── 알림 설정 ── */}
          {tab === 'alerts' && (
            <EmptyTab icon={<NotificationsOutlinedIcon sx={{ fontSize: 34 }} />} title="알림 설정" desc="시스템 알림·사용량 임계치 알림을 설정합니다. 백엔드 연동 후 제공됩니다." />
          )}
        </Box>
      </Box>

      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 420, maxWidth: 420 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>사용자 추가</DialogTitle>
        <DialogContent>
          {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
          <TextField autoFocus fullWidth label="ID" value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth label="사용자명" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} sx={{ mb: 2 }} />
          <TextField fullWidth type="password" label="비밀번호" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && create()} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setDlg(false)}>취소</Button>
          <Button variant="contained" onClick={create} disabled={busy}>만들기</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!pwDlg} onClose={() => setPwDlg(null)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>비밀번호 재설정</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}><b>{pwDlg?.name}</b> 사용자의 새 비밀번호를 입력하세요.</Typography>
          {pwErr && <Alert severity="error" sx={{ mb: 2 }}>{pwErr}</Alert>}
          <TextField autoFocus fullWidth type="password" label="새 비밀번호" value={pwVal} onChange={(e) => setPwVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && resetPw()} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setPwDlg(null)}>취소</Button>
          <Button variant="contained" onClick={resetPw}>재설정</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
