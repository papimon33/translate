// 관리자 > 시스템 탭: 서버 상태·관리자 2단계 인증·전체 백업·전체 초기화
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
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
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import Snackbar from '@mui/material/Snackbar';
import { api } from '../shared/api.js';

function StatCard({ icon, label, value, sub }) {
  return (
    <Box sx={{ flex: '1 1 180px', minWidth: 160, bgcolor: (t) => alpha(t.palette.text.primary, 0.02), border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary', mb: 1 }}>
        <Box sx={{ display: 'grid', placeItems: 'center', width: 30, height: 30, borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main' }}>{icon}</Box>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{label}</Typography>
      </Box>
      <Typography sx={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25 }}>{sub}</Typography>}
    </Box>
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
      <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3, mb: 2 }}>
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
              {/* 저장이 죽으면 화면은 정상으로 보이므로 여기서만 알 수 있다 — 응대 기록이 유실되는 중이라는 뜻 */}
              {health.saveFail && (
                <Chip size="small" color="error" label={`기록 저장 실패 ${health.saveFail.count}회 — ${health.saveFail.msg}`} />
              )}
            </Box>
            {/* 응대 보존 상한 초과: 오래된 응대 전문이 잘려 나갔다(되돌릴 수 없음) */}
            {health.deskLogFull && health.deskLogFull.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 800, color: 'warning.main', mb: 0.5 }}>
                  응대 기록 보존 상한({health.deskLogCap}건) 초과 — 오래된 응대가 삭제되었습니다
                </Typography>
                {health.deskLogFull.map((d, i) => (
                  <Typography key={i} sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {d.title || d.id} · {d.dropped}건 삭제 · {new Date(d.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </Typography>
                ))}
                <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
                  기록이 더 필요하면 관리자 &gt; 시스템·보안의 <b>전체 데이터 백업</b>을 먼저 내려받으세요.
                </Typography>
              </Box>
            )}
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

      <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3 }}>
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
            <Box component="img" src={setup.qr} alt="2FA QR" sx={{ width: 180, bgcolor: '#fff', borderRadius: 1.5, p: 1, display: 'block', mb: 1 }} />
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

// 백업·전체 초기화 버튼 + 시스템 상태·2FA
export default function SystemTab() {
  const [pageSnack, setPageSnack] = useState('');
  // 전체 초기화(위험): 관리자 비밀번호 재확인 모달
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipePw, setWipePw] = useState('');
  const [wipeErr, setWipeErr] = useState('');
  const [wipeBusy, setWipeBusy] = useState(false);
  const doResetAll = async () => {
    if (!wipePw || wipeBusy) return;
    setWipeBusy(true); setWipeErr('');
    try {
      const r = await api.adminResetAll(wipePw);
      setWipeOpen(false);
      setPageSnack(`전체 초기화 완료 — 세션 ${r.removedSessions}개(응대 로그 포함)와 요약을 삭제했습니다.`);
    } catch (e) { setWipeErr(e.message || '초기화 실패'); }
    finally { setWipeBusy(false); }
  };

  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Tooltip title="세션(대화·응대 로그)·안내데스크 정의·용어·정형 안내를 JSON 한 파일로 내려받습니다">
          <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={() => { window.location.href = '/api/admin/export'; }}>
            전체 데이터 백업(JSON)
          </Button>
        </Tooltip>
        <Tooltip title="모든 대화·응대 기록을 비웁니다. 안내데스크 세션은 유지되어 인쇄한 QR 을 계속 쓸 수 있습니다 (계정·데스크 정의·용어·사용량도 유지)">
          <Button variant="outlined" color="error" startIcon={<DeleteOutlineIcon />} onClick={() => { setWipePw(''); setWipeErr(''); setWipeOpen(true); }}>
            전체 초기화
          </Button>
        </Tooltip>
      </Box>
      <SystemPanel />

      {/* 전체 초기화 — 관리자 비밀번호 재확인(로그인 세션과 별개) */}
      <Dialog open={wipeOpen} onClose={() => !wipeBusy && setWipeOpen(false)} PaperProps={{ sx: { width: 440, maxWidth: 440 } }}>
        <DialogTitle sx={{ fontWeight: 800, color: 'error.main' }}>전체 초기화</DialogTitle>
        <DialogContent>
          <Alert severity="warning" sx={{ mb: 2 }}>
            모든 <b>대화·응대 기록</b>이 영구 삭제됩니다. <b>안내데스크 세션은 유지</b>되어 인쇄한 QR 을 다시 발급할 필요가 없습니다. 되돌릴 수 없습니다.
            <br />계정·안내데스크 정의·용어 설정·정형 안내·사용량 통계는 유지됩니다.
            <br />필요하면 먼저 '전체 데이터 백업(JSON)'을 받아 두세요.
          </Alert>
          {wipeErr && <Alert severity="error" sx={{ mb: 2 }}>{wipeErr}</Alert>}
          <TextField autoFocus fullWidth type="password" label="관리자 비밀번호 확인" value={wipePw}
            onChange={(e) => setWipePw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && doResetAll()} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setWipeOpen(false)} disabled={wipeBusy} sx={{ color: 'text.secondary' }}>취소</Button>
          <Button variant="contained" color="error" onClick={doResetAll} disabled={!wipePw || wipeBusy}>
            {wipeBusy ? '초기화 중…' : '전부 삭제'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!pageSnack} autoHideDuration={4000} onClose={() => setPageSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={pageSnack} />
    </>
  );
}
