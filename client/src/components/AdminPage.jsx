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
    <Box sx={{ flex: '1 1 180px', minWidth: 160, bgcolor: (t) => alpha(t.palette.text.primary, 0.02), border: 1, borderColor: 'divider', borderRadius: 2, p: 2 }}>
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
  { v: 'desk', label: '데스크 통계' },
  { v: 'logs', label: '로그' },
  { v: 'accounts', label: '계정 관리' },
  { v: 'terms', label: '용어 설정' },
  { v: 'system', label: '시스템·보안' },
];

const fmtTime = (ts) => (ts ? new Date(ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// 대화 전문 렌더링(공용): 데스크 응대(안내원/손님) 또는 일반 세션(마이크/시스템)
function TranscriptView({ items, deskMode }) {
  if (!items || !items.length) return <Typography sx={{ fontSize: 13, color: 'text.disabled', py: 1 }}>기록된 대화가 없습니다.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: 1 }}>
      {items.map((it, i) => {
        const staff = deskMode ? (it.lang ? it.lang === 'ko' : it.side === 'right') : it.side === 'right';
        const who = deskMode ? (staff ? '안내원' : '손님') : (staff ? '마이크' : '시스템');
        const main = it.texts ? (Object.values(it.texts).find(Boolean) || '') : (it.text || '');
        return (
          <Box key={it.id || i} sx={{ display: 'flex', gap: 1.25, alignItems: 'baseline' }}>
            <Chip size="small" label={who} color={staff ? 'primary' : 'default'} variant={staff ? 'filled' : 'outlined'} sx={{ height: 20, fontSize: 11, fontWeight: 700, flex: 'none', minWidth: 56 }} />
            <Box sx={{ minWidth: 0 }}>
              {it.source && <Typography sx={{ fontSize: 13.5 }}>{it.source}</Typography>}
              {main && main !== it.source && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{main}</Typography>}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

// 로그 탭: 데스크 응대 로그(건당 시각·길이·언어·문장수) + 일반 세션 대화 로그 — 클릭 시 전문 열람
function LogsPanel() {
  const [data, setData] = useState(null); // { desks, sessions }
  const [open, setOpen] = useState(null); // { kind:'desk'|'session', key, loading, detail }
  useEffect(() => { api.adminLogs().then(setData).catch(() => setData({ desks: [], sessions: [] })); }, []);
  const openDesk = async (sid, idx) => {
    const key = `d:${sid}:${idx}`;
    if (open && open.key === key) { setOpen(null); return; }
    setOpen({ kind: 'desk', key, loading: true });
    try { setOpen({ kind: 'desk', key, detail: await api.adminDeskLog(sid, idx) }); }
    catch (e) { setOpen({ kind: 'desk', key, error: e.message || '불러오기 실패' }); } // 조용히 접히지 않고 실패를 표시
  };
  const openSession = async (id) => {
    const key = `s:${id}`;
    if (open && open.key === key) { setOpen(null); return; }
    setOpen({ kind: 'session', key, loading: true });
    try { setOpen({ kind: 'session', key, detail: await api.adminSessionLog(id) }); }
    catch (e) { setOpen({ kind: 'session', key, error: e.message || '불러오기 실패' }); }
  };
  if (!data) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;
  const durOf = (e) => (e.startedAt && e.endedAt ? fmtDuration(e.endedAt - e.startedAt) : '—');
  return (
    <>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1 }}>안내데스크 응대 로그</Typography>
      {data.desks.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.disabled', mb: 2 }}>안내데스크 세션이 없습니다.</Typography>}
      {data.desks.map((d) => (
        <Paper key={d.id} variant="outlined" sx={{ borderRadius: 2, p: 2, mb: 2 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1 }}>{d.title} <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 12.5 }}>· 응대 {d.logs.length}건</Box></Typography>
          {d.logs.length === 0 && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>아직 응대 기록이 없습니다.</Typography>}
          {d.logs.map((e) => (
            <Box key={e.idx}>
              <Box onClick={() => openDesk(d.id, e.idx)}
                sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.75, px: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.04) } }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', minWidth: 96 }}>{fmtTime(e.endedAt)}</Typography>
                <Chip size="small" label={LANG_KO[e.lang] || e.lang || '미상'} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                  {durOf(e)} · {e.count}문장{e.stats ? ` · 누화드랍 ${e.stats.crossDrops}` : ''}
                </Typography>
              </Box>
              {open && open.key === `d:${d.id}:${e.idx}` && (
                <Box sx={{ ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                  {open.loading ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 1 }}>불러오는 중…</Typography>
                    : open.error ? <Typography sx={{ fontSize: 12.5, color: 'error.main', py: 1 }}>{open.error}</Typography>
                    : <TranscriptView items={open.detail?.items} deskMode />}
                </Box>
              )}
            </Box>
          ))}
        </Paper>
      ))}

      <Typography sx={{ fontWeight: 800, fontSize: 15, mt: 3, mb: 1 }}>세션 대화 로그</Typography>
      {data.sessions.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>세션이 없습니다.</Typography>}
      {data.sessions.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 1.5 }}>
          {data.sessions.map((s) => (
            <Box key={s.id}>
              <Box onClick={() => openSession(s.id)}
                sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.75, px: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.04) } }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{s.title}</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 1, whiteSpace: 'nowrap' }}>
                  {s.owner || '—'} · {s.count}문장 · {fmtTime(s.updatedAt)}
                </Typography>
              </Box>
              {open && open.key === `s:${s.id}` && (
                <Box sx={{ ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                  {open.loading ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 1 }}>불러오는 중…</Typography>
                    : open.error ? <Typography sx={{ fontSize: 12.5, color: 'error.main', py: 1 }}>{open.error}</Typography>
                    : <TranscriptView items={open.detail?.items} />}
                </Box>
              )}
            </Box>
          ))}
        </Paper>
      )}
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1.5 }}>
        대화 로그에는 개인정보가 포함될 수 있습니다. 열람은 운영 목적으로만 하고, 보존 기간 정책에 따라 정리하세요.
      </Typography>
    </>
  );
}

const LANG_KO = { en: '영어', ja: '일본어', zh: '중국어', vi: '베트남어', th: '태국어', id: '인도네시아어', ru: '러시아어', ko: '한국어', unknown: '미상' };

// 데스크 통계: 데스크별 응대 건수·언어 분포·평균 응대 시간·일별 추이 (대화 내용은 조회하지 않음)
function DeskStats() {
  const [stats, setStats] = useState(null);
  useEffect(() => { api.adminDeskStats().then(setStats).catch(() => setStats([])); }, []);
  if (!stats) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;
  if (!stats.length) return <EmptyTab icon={<ForumOutlinedIcon sx={{ fontSize: 34 }} />} title="데스크 통계" desc="안내데스크 세션이 아직 없습니다. 데스크 안내에서 세션을 만들면 응대 통계가 집계됩니다." />;
  const total = stats.reduce((a, d) => a + d.count, 0);
  return (
    <>
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
        <StatCard icon={<ForumOutlinedIcon fontSize="small" />} label="총 응대 건수" value={total} />
        <StatCard icon={<PeopleAltOutlinedIcon fontSize="small" />} label="안내데스크 수" value={stats.length} />
        <StatCard icon={<ScheduleOutlinedIcon fontSize="small" />} label="평균 응대 시간" value={fmtDuration(stats.reduce((a, d) => a + d.avgMs * d.count, 0) / Math.max(1, total))} />
      </Box>
      {stats.map((d) => {
        const langEntries = Object.entries(d.langs || {}).sort((a, b) => b[1] - a[1]);
        const maxDay = Math.max(1, ...(d.daily || []).map((x) => x.count));
        return (
          <Paper key={d.id} variant="outlined" sx={{ borderRadius: 2, p: 3, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
              <Typography sx={{ fontWeight: 800, fontSize: 16 }}>{d.title}</Typography>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                응대 {d.count}건 · 평균 {fmtDuration(d.avgMs)} · 길안내 감지 {d.wayfindDetected}건 중 표시 {d.wayfindShown}건
              </Typography>
            </Box>
            {langEntries.length > 0 && (
              <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1.5 }}>
                {langEntries.map(([lang, n]) => (
                  <Chip key={lang} size="small" label={`${LANG_KO[lang] || lang} ${n}건`} sx={{ height: 22, fontSize: 12, fontWeight: 700 }} />
                ))}
              </Box>
            )}
            {(d.daily || []).length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: 70 }}>
                {d.daily.map((x) => (
                  <Tooltip key={x.date} title={`${x.date} · ${x.count}건`}>
                    <Box sx={{ flex: 1, maxWidth: 46, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4 }}>
                      <Box sx={{ width: '65%', height: `${Math.max(3, (x.count / maxDay) * 46)}px`, borderRadius: 0.75, bgcolor: 'primary.main', opacity: 0.75 }} />
                      <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>{x.date.slice(5)}</Typography>
                    </Box>
                  </Tooltip>
                ))}
              </Box>
            )}
          </Paper>
        );
      })}
    </>
  );
}

// 시스템 상태 + 관리자 2FA 설정
function SystemPanel() {
  const [health, setHealth] = useState(null);
  const [tfa, setTfa] = useState(null); // { enabled, viaEnv }
  const [setup, setSetup] = useState(null); // { secret, qr }
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const load = () => {
    api.adminHealth().then(setHealth).catch(() => {});
    api.admin2fa().then(setTfa).catch(() => {});
  };
  useEffect(() => { load(); }, []);
  const beginSetup = async () => { setMsg(''); try { setSetup(await api.admin2faSetup()); setCode(''); } catch (e) { setMsg(e.message); } };
  const confirmSetup = async () => { setMsg(''); try { await api.admin2faVerify(code); setSetup(null); setCode(''); load(); setMsg('2FA가 활성화되었습니다. 다음 로그인부터 인증 코드가 필요합니다.'); } catch (e) { setMsg(e.message); } };
  const disable = async () => { setMsg(''); try { await api.admin2faDisable(code); setCode(''); load(); setMsg('2FA가 해제되었습니다.'); } catch (e) { setMsg(e.message); } };
  const fmtUp = (s) => (s >= 86400 ? `${Math.floor(s / 86400)}일 ` : '') + `${Math.floor((s % 86400) / 3600)}시간 ${Math.floor((s % 3600) / 60)}분`;
  return (
    <>
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 3, mb: 2 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1.5 }}>시스템 상태</Typography>
        {!health ? <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>불러오는 중…</Typography> : (
          <>
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
              <StatCard icon={<ScheduleOutlinedIcon fontSize="small" />} label="가동 시간" value={fmtUp(health.uptimeSec)} sub={`메모리 ${health.memoryMB}MB · ${health.node}`} />
              <StatCard icon={<ForumOutlinedIcon fontSize="small" />} label="실시간 연결" value={`${health.liveHosts} 호스트`} sub={`${health.liveViewers} 뷰어 · 세션 ${health.sessions}개`} />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mb: 1 }}>
              <Chip size="small" color={health.dataEncrypted ? 'success' : 'default'} label={health.dataEncrypted ? '저장 데이터 암호화 켜짐' : '저장 데이터 암호화 꺼짐 — DATA_KEY 미설정'} />
              <Chip size="small" color={health.twoFaEnabled ? 'success' : 'default'} label={health.twoFaEnabled ? '관리자 2FA 켜짐' : '관리자 2FA 꺼짐'} />
              <Chip size="small" color={health.forceHttps ? 'success' : 'default'} label={health.forceHttps ? 'HTTPS 강제 켜짐' : 'HTTPS 강제 꺼짐 — FORCE_HTTPS 미설정'} />
            </Box>
            {(health.recentErrors.length > 0 || health.clientErrors.length > 0) && (
              <Box sx={{ mt: 2 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: 'text.secondary', mb: 0.75 }}>최근 오류</Typography>
                {[...health.recentErrors.map((e) => ({ ...e, from: '서버' })), ...health.clientErrors.map((e) => ({ ...e, from: '브라우저' }))]
                  .sort((a, b) => b.at - a.at).slice(0, 10).map((e, i) => (
                    <Typography key={i} sx={{ fontSize: 12, color: 'text.secondary', fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      [{new Date(e.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}] {e.from} · {e.msg}
                    </Typography>
                  ))}
              </Box>
            )}
            {health.recentErrors.length === 0 && health.clientErrors.length === 0 && (
              <Typography sx={{ fontSize: 12.5, color: 'success.main', mt: 1 }}>최근 기록된 오류가 없습니다.</Typography>
            )}
          </>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 0.5 }}>관리자 2단계 인증</Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
          Google Authenticator 같은 인증 앱을 등록하면 관리자 로그인 시 비밀번호에 더해 6자리 코드를 요구합니다.
        </Typography>
        {msg && <Alert severity={msg.includes('활성화') || msg.includes('해제') ? 'success' : 'error'} sx={{ mb: 2 }}>{msg}</Alert>}
        {tfa && tfa.viaEnv && <Alert severity="info" sx={{ mb: 2 }}>2FA 시크릿이 서버 환경변수 ADMIN_TOTP_SECRET 으로 관리되고 있어 여기서 변경할 수 없습니다.</Alert>}
        {tfa && !tfa.enabled && !setup && (
          <Button variant="contained" onClick={beginSetup}>2FA 설정 시작</Button>
        )}
        {setup && (
          <Box>
            <Typography sx={{ fontSize: 13.5, mb: 1 }}>1. 인증 앱에서 아래 QR을 스캔하세요.</Typography>
            <Box component="img" src={setup.qr} alt="2FA QR" sx={{ width: 180, bgcolor: '#fff', borderRadius: 2, p: 1, display: 'block', mb: 1 }} />
            <Typography sx={{ fontSize: 12, color: 'text.disabled', mb: 2, wordBreak: 'break-all' }}>수동 입력 키: {setup.secret}</Typography>
            <Typography sx={{ fontSize: 13.5, mb: 1 }}>2. 앱에 표시된 6자리 코드를 입력해 활성화를 완료하세요.</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField size="small" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 코드" sx={{ width: 140 }} />
              <Button variant="contained" onClick={confirmSetup} disabled={code.length !== 6}>활성화</Button>
              <Button onClick={() => { setSetup(null); setCode(''); }}>취소</Button>
            </Box>
          </Box>
        )}
        {tfa && tfa.enabled && !tfa.viaEnv && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <TextField size="small" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6자리 코드" sx={{ width: 140 }} />
            <Button variant="outlined" color="error" onClick={disable} disabled={code.length !== 6}>2FA 해제</Button>
          </Box>
        )}
      </Paper>
    </>
  );
}

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
    try { await api.adminDeleteUser(u.id); } catch (e) { alert('삭제 실패: ' + (e.message || '네트워크 오류')); }
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

              <Paper variant="outlined" sx={{ borderRadius: 2, p: 3 }}>
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
            <Paper variant="outlined" sx={{ borderRadius: 2, overflowX: 'auto' }}>
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
            </>
          )}

          {/* ── 데스크 통계 ── */}
          {tab === 'desk' && <DeskStats />}

          {/* ── 로그(데스크 응대·세션 대화 세부) ── */}
          {tab === 'logs' && <LogsPanel />}

          {/* ── 용어 설정 (이관) ── */}
          {tab === 'terms' && <TermsConfigPage user={user} embedded />}

          {/* ── 시스템 상태 + 보안(2FA) ── */}
          {tab === 'system' && <SystemPanel />}
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
