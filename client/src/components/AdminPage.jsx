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
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver';
import Snackbar from '@mui/material/Snackbar';
import TermsConfigPage from './TermsConfigPage.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
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

function EmptyTab({ icon, title, desc }) {
  return (
    <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 72, height: 72, mx: 'auto', mb: 2, borderRadius: '50%', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>{icon}</Box>
      <Typography sx={{ fontSize: 18, fontWeight: 800, color: 'text.primary' }}>{title}</Typography>
      <Typography sx={{ fontSize: 14, mt: 0.75 }}>{desc}</Typography>
    </Box>
  );
}

/* ---- 벤더 실사용량: Soniox(STT·번역) / Cartesia(TTS) / OpenAI(GPT) 사용량 API 직접 조회 ---- */
function MiniBars({ days, valueOf, tipOf }) {
  const rows = days || [];
  if (!rows.length) return <Box sx={{ height: 56, mt: 1.5, display: 'grid', placeItems: 'center' }}><Typography sx={{ fontSize: 12, color: 'text.disabled' }}>기간 내 사용 기록 없음</Typography></Box>;
  const val = (d) => Number(valueOf(d)) || 0;
  const max = Math.max(...rows.map(val), 1e-9);
  const labelEvery = Math.max(1, Math.ceil(rows.length / 10)); // 라벨은 최대 ~10개만(90일 겹침 방지)
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: rows.length > 40 ? 0.25 : 0.5, height: 56, mt: 1.5 }}>
      {rows.map((d, i) => (
        <Tooltip key={d.date} title={tipOf(d)}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.3, height: '100%', justifyContent: 'flex-end' }}>
            <Box sx={{ width: '68%', height: `${Math.max(2, (val(d) / max) * 40)}px`, borderRadius: 0.5, bgcolor: 'primary.main', opacity: val(d) ? 0.75 : 0.2 }} />
            <Typography sx={{ fontSize: 9, color: 'text.disabled', whiteSpace: 'nowrap', height: 12 }}>{i % labelEvery === 0 ? d.date.slice(8) : ''}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
function VendorCard({ name, desc, v, keyHint, totalOf, subOf, valueOf, tipOf, extra }) {
  const body = () => {
    if (!v) return <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 2 }}>불러오는 중…</Typography>;
    if (!v.configured) return (
      <>
        <Chip size="small" label="사용량 조회 키 미설정" sx={{ height: 20, fontSize: 11, my: 1 }} />
        <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>
          {v.serviceKey && <>서비스 동작용 키는 설정되어 있어 {desc}는 정상 동작합니다.<br /></>}
          사용량 조회는 별도의 <b>{keyHint}</b> 환경변수가 필요합니다{v.serviceKey ? ' (일반 키로는 벤더가 사용량 조회를 허용하지 않음)' : ''}.
        </Typography>
      </>
    );
    // 조회 실패여도 자체 누적분이 있으면 데이터는 계속 보여준다(최신 갱신만 실패)
    if (v.error && !(v.days || []).length) return (
      <>
        <Chip size="small" color="warning" label="조회 실패" sx={{ height: 20, fontSize: 11, my: 1 }} />
        <Typography sx={{ fontSize: 11.5, color: 'text.disabled', wordBreak: 'break-all' }}>{v.error}</Typography>
      </>
    );
    return (
      <>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, mt: 0.5 }}>{totalOf(v)}</Typography>
          {v.error && <Tooltip title={`최신 갱신 실패(저장분 표시 중): ${v.error}`}><Chip size="small" color="warning" label="갱신 실패" sx={{ height: 18, fontSize: 10.5 }} /></Tooltip>}
        </Box>
        {/* 카드 간 차트 기준선 정렬: 보조 문구 줄은 항상 렌더링(비어도 높이 유지) */}
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.25, minHeight: 18 }}>{subOf ? subOf(v) : ' '}</Typography>
        <MiniBars days={v.days} valueOf={valueOf} tipOf={tipOf} />
        {extra && extra(v)}
      </>
    );
  };
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.25, flex: '1 1 240px', minWidth: 220 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 14 }}>{name} <Box component="span" sx={{ fontWeight: 500, fontSize: 12, color: 'text.secondary' }}>· {desc}</Box></Typography>
      {body()}
    </Paper>
  );
}
function VendorUsage() {
  const [days, setDays] = useState(7); // 토글(7/30/90일)과 일치하는 기본값 — 선택 표시 항상 있음
  const [data, setData] = useState(null);
  useEffect(() => {
    // 기간 빠른 전환 시 늦게 도착한 이전 기간 응답이 화면을 덮지 않도록(stale 가드)
    let cancelled = false;
    setData(null);
    api.adminVendorUsage(days)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ error: true }); });
    return () => { cancelled = true; };
  }, [days]);
  const v = (k) => (data && !data.error ? data[k] : null);
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>벤더 실사용량</Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={days} onChange={(e, x) => x && setDays(x)}>
          {[7, 30, 90].map((d) => <ToggleButton key={d} value={d} sx={{ py: 0.2, px: 1.2, fontSize: 11, textTransform: 'none' }}>{d}일</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>
      {data && data.error && <Alert severity="error" sx={{ mb: 1 }}>벤더 사용량을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>}
      {/* 요청 실패 시 '불러오는 중…' 카드가 영구히 남지 않도록 카드 영역 자체를 숨김 */}
      <Box sx={{ display: data && data.error ? 'none' : 'flex', gap: 1.5, flexWrap: 'wrap' }}>
        <VendorCard name="Soniox" desc="음성인식·실시간 번역" v={v('soniox')} keyHint="SONIOX_API_KEY"
          totalOf={(x) => fmtCost(x.totalCostUsd || 0)} subOf={(x) => `오디오 ${fmtMin(x.totalAudioMin || 0)} · ${x.totalRequests || 0}회 연결`}
          valueOf={(d) => d.costUsd} tipOf={(d) => `${d.date} · ${fmtMin((d.audioMs || 0) / 60000)} · ${fmtCost(d.costUsd)}`}
          extra={(x) => (x.users || []).length > 0 && (
            <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}>
              <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>유저별 사용량 <Box component="span" sx={{ fontWeight: 400, color: 'text.disabled' }}>· {x.users.length}명</Box></Typography>
              {/* 유저가 많아져도 카드가 늘어나지 않도록 — 비용순 정렬 목록을 고정 높이 스크롤 박스에 */}
              <Box sx={{ maxHeight: 150, overflowY: 'auto', pr: 0.5 }}>
                {x.users.map((u) => (
                  <Box key={u.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.2 }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.id === 'anon' ? '(미태깅·과거)' : u.id}</Typography>
                    <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(u.costUsd)} · {fmtMin(u.audioMin)}</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )} />
        <VendorCard name="Cartesia" desc="음성 합성(TTS)" v={v('cartesia')} keyHint="CARTESIA_ADMIN_API_KEY (sk_car_admin_…)"
          totalOf={(x) => `${(x.totalCredits || 0).toLocaleString()} 크레딧`}
          subOf={(x) => `일평균 ${Math.round((x.totalCredits || 0) / Math.max(1, (x.days || []).length)).toLocaleString()} 크레딧`}
          valueOf={(d) => d.credits} tipOf={(d) => `${d.date} · ${(d.credits || 0).toLocaleString()} 크레딧`} />
        <VendorCard name="OpenAI" desc="GPT (요약·다듬기·검사)" v={v('openai')} keyHint="OPENAI_ADMIN_API_KEY (sk-admin-…)"
          totalOf={(x) => fmtCost(x.totalCostUsd || 0)}
          subOf={(x) => `일평균 ${fmtCost((x.totalCostUsd || 0) / Math.max(1, (x.days || []).length))}`}
          valueOf={(d) => d.costUsd} tipOf={(d) => `${d.date} · ${fmtCost(d.costUsd)}`} />
      </Box>
      {data && !data.error && (v('soniox')?.earliest || v('cartesia')?.earliest || v('openai')?.earliest) && (
        <Typography sx={{ fontSize: 11, color: 'text.disabled', mt: 1.5 }}>
          기록 시작일 {[['Soniox', v('soniox')], ['Cartesia', v('cartesia')], ['OpenAI', v('openai')]].filter(([, x]) => x?.earliest).map(([n, x]) => `${n} ${x.earliest}`).join(' · ')} — 12시간마다 자동 갱신·누적.
        </Typography>
      )}
    </Paper>
  );
}

const TABS = [
  { v: 'usage', label: '사용량' },
  { v: 'logs', label: '로그' },
  { v: 'accounts', label: '계정 관리' },
  { v: 'terms', label: '용어 설정' },
  { v: 'canned', label: '정형 안내' },
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

// 데스크 응대 상세 → 평가 JSON(records) 변환: 안내원(ko)=답변(a), 손님=질문(q).
// eval/score.mjs --auto 가 시나리오를 자동 매칭하므로 scenario_id 태깅이 필요 없다.
function deskEvalRecords(detail) {
  const lang = detail.lang && detail.lang !== 'ko' ? detail.lang : 'en';
  return (detail.items || [])
    .map((it) => {
      const staff = it.lang ? it.lang === 'ko' : it.side === 'right';
      const texts = it.texts || {};
      const mt = staff
        ? (texts[lang] || Object.entries(texts).find(([k, v]) => v && k !== 'ko')?.[1] || '')
        : (texts.ko || '');
      return { direction: staff ? 'a' : 'q', lang, stt: it.source || '', mt };
    })
    .filter((r) => r.stt || r.mt);
}
function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// 로그 탭: 데스크 응대 로그(건당 시각·길이·언어·문장수) + 일반 세션 대화 로그 — 클릭 시 전문 열람
const LOGS_DESK_CAP = 8;   // 데스크별 최초 표시 응대 수(과도한 스크롤 방지 — '더 보기'로 확장)
const LOGS_SESS_CAP = 15;  // 세션 목록 최초 표시 수
function LogsPanel() {
  const [data, setData] = useState(null); // { desks, sessions }
  const [open, setOpen] = useState(null); // { kind:'desk'|'session', key, loading, detail }
  const [deskMore, setDeskMore] = useState({}); // { [deskId]: 표시 수 }
  const [sessCap, setSessCap] = useState(LOGS_SESS_CAP);
  const [confirmReq, setConfirmReq] = useState(null); // 공용 확인 다이얼로그
  const [snack, setSnack] = useState('');
  const load = () => api.adminLogs().then(setData).catch(() => setData({ desks: [], sessions: [] }));
  useEffect(() => { load(); }, []);
  // 로그 정리(삭제) — 시범운영 데이터 관리용. 삭제 후 목록·열람 상태 갱신
  const delDeskLog = (sid, idx) => setConfirmReq({
    title: '응대 기록 삭제', message: '이 응대 기록을 삭제합니다. 되돌릴 수 없습니다.',
    onOk: async () => { try { await api.adminDeleteDeskLog(sid, idx); setOpen(null); await load(); } catch (e) { setSnack(e.message || '삭제 실패'); } },
  });
  const clearDeskLogs = (sid, n) => setConfirmReq({
    title: '로그 전체 삭제', message: `이 데스크의 응대 기록 ${n}건을 모두 삭제합니다. 운영 통계도 초기화됩니다. 되돌릴 수 없습니다.`,
    onOk: async () => { try { await api.adminClearDeskLogs(sid); setOpen(null); await load(); } catch (e) { setSnack(e.message || '삭제 실패'); } },
  });
  const clearSessionLog = (id) => setConfirmReq({
    title: '대화 기록 삭제', message: '이 세션의 대화 기록을 삭제합니다. 세션 자체는 유지됩니다. 되돌릴 수 없습니다.',
    onOk: async () => { try { await api.adminClearSessionLog(id); setOpen(null); await load(); } catch (e) { setSnack(e.message || '삭제 실패'); } },
  });
  // 늦게 도착한 응답이 현재 선택(다른 항목/닫힘)을 덮지 않도록 — 여전히 같은 key 가 열려 있을 때만 반영
  const settleOpen = (key, next) => setOpen((cur) => (cur && cur.key === key ? next : cur));
  const openDesk = async (sid, idx) => {
    const key = `d:${sid}:${idx}`;
    if (open && open.key === key) { setOpen(null); return; }
    setOpen({ kind: 'desk', key, loading: true });
    try { const detail = await api.adminDeskLog(sid, idx); settleOpen(key, { kind: 'desk', key, detail }); }
    catch (e) { settleOpen(key, { kind: 'desk', key, error: e.message || '불러오기 실패' }); } // 조용히 접히지 않고 실패를 표시
  };
  const openSession = async (id) => {
    const key = `s:${id}`;
    if (open && open.key === key) { setOpen(null); return; }
    setOpen({ kind: 'session', key, loading: true });
    try { const detail = await api.adminSessionLog(id); settleOpen(key, { kind: 'session', key, detail }); }
    catch (e) { settleOpen(key, { kind: 'session', key, error: e.message || '불러오기 실패' }); }
  };
  if (!data) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;
  const durOf = (e) => (e.startedAt && e.endedAt ? fmtDuration(e.endedAt - e.startedAt) : '—');
  return (
    <>
      <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1 }}>안내데스크 응대 로그</Typography>
      {data.desks.length === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 1.5, mb: 2 }}>
          <EmptyHint icon={<RecordVoiceOverIcon sx={{ fontSize: 22 }} />} title="안내데스크 세션이 없습니다"
            desc="'데스크 안내'에서 세션을 만들면 응대별 대화 기록이 여기에 쌓입니다." />
        </Paper>
      )}
      {data.desks.map((d) => {
        const cap = deskMore[d.id] || LOGS_DESK_CAP;
        const shown = d.logs.slice(0, cap);
        return (
        <Paper key={d.id} variant="outlined" sx={{ borderRadius: 1.5, p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14, flex: 1 }}>
              {d.title}
              {d.deleted && <Box component="span" sx={{ ml: 0.75, color: 'warning.main', fontWeight: 700, fontSize: 11.5 }}>삭제된 세션</Box>}
              {' '}<Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 12.5 }}>· 응대 {d.logs.length}건</Box>
            </Typography>
            {d.logs.length > 0 && (
              <Button size="small" color="error" onClick={() => clearDeskLogs(d.id, d.logs.length)} sx={{ fontSize: 11.5, py: 0 }}>로그 전체 삭제</Button>
            )}
          </Box>
          {d.logs.length === 0 && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>아직 응대 기록이 없습니다.</Typography>}
          {shown.map((e) => (
            <Box key={e.idx}>
              <Box onClick={() => openDesk(d.id, e.idx)}
                sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.75, px: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.04) }, '&:hover .delBtn': { opacity: 1 } }}>
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', minWidth: 96 }}>{fmtTime(e.endedAt)}</Typography>
                <Chip size="small" label={LANG_KO[e.lang] || e.lang || '미상'} sx={{ height: 20, fontSize: 11, fontWeight: 700 }} />
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 1 }}>
                  {durOf(e)} · {e.count}문장{e.stats ? ` · 누화드랍 ${e.stats.crossDrops}` : ''}
                </Typography>
                <IconButton size="small" className="delBtn" sx={{ opacity: 0, transition: 'opacity .12s' }}
                  onClick={(ev) => { ev.stopPropagation(); delDeskLog(d.id, e.idx); }}>
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
              {open && open.key === `d:${d.id}:${e.idx}` && (
                <Box sx={{ ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                  {open.loading ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 1 }}>불러오는 중…</Typography>
                    : open.error ? <Typography sx={{ fontSize: 12.5, color: 'error.main', py: 1 }}>{open.error}</Typography>
                    : (
                      <>
                        {/* 통역 평가용: 이 응대의 인식원문·번역을 records JSON 으로 — eval/score.mjs --auto 로 바로 채점 */}
                        <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.5 }}>
                          <Button size="small" sx={{ fontSize: 11.5, color: 'text.secondary', py: 0 }}
                            onClick={(ev) => { ev.stopPropagation(); downloadJson({ records: deskEvalRecords(open.detail) }, `records-${d.id}-${e.idx}.json`); }}>
                            평가 JSON 내려받기
                          </Button>
                        </Box>
                        <Box sx={{ maxHeight: 340, overflowY: 'auto' }}>
                          <TranscriptView items={open.detail?.items} deskMode />
                        </Box>
                      </>
                    )}
                </Box>
              )}
            </Box>
          ))}
          {d.logs.length > cap && (
            <Button size="small" onClick={() => setDeskMore((m) => ({ ...m, [d.id]: cap + 20 }))} sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              더 보기 ({d.logs.length - cap}건 남음)
            </Button>
          )}
        </Paper>
        );
      })}

      <Typography sx={{ fontWeight: 800, fontSize: 15, mt: 3, mb: 1 }}>세션 대화 로그</Typography>
      {data.sessions.length === 0 && <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>세션이 없습니다.</Typography>}
      {data.sessions.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 1.5 }}>
          {data.sessions.slice(0, sessCap).map((s) => (
            <Box key={s.id}>
              <Box onClick={() => openSession(s.id)}
                sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 0.75, px: 1, borderRadius: 1.5, cursor: 'pointer', '&:hover': { bgcolor: (t) => alpha(t.palette.text.primary, 0.04) } }}>
                <Typography sx={{ fontWeight: 700, fontSize: 13.5, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 260 }}>{s.title}</Typography>
                {s.deleted && <Typography sx={{ flex: 'none', color: 'warning.main', fontWeight: 700, fontSize: 11.5 }}>삭제된 세션</Typography>}
                <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 1, whiteSpace: 'nowrap' }}>
                  {s.owner || '—'} · {s.count}문장 · {fmtTime(s.updatedAt)}
                </Typography>
              </Box>
              {open && open.key === `s:${s.id}` && (
                <Box sx={{ ml: 2, pl: 2, borderLeft: 2, borderColor: 'divider' }}>
                  {open.loading ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary', py: 1 }}>불러오는 중…</Typography>
                    : open.error ? <Typography sx={{ fontSize: 12.5, color: 'error.main', py: 1 }}>{open.error}</Typography>
                    : (
                      <>
                        {(open.detail?.items || []).length > 0 && (
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', pt: 0.5 }}>
                            <Button size="small" color="error" sx={{ fontSize: 11.5, py: 0 }} onClick={() => clearSessionLog(s.id)}>대화 기록 삭제</Button>
                          </Box>
                        )}
                        <Box sx={{ maxHeight: 340, overflowY: 'auto' }}><TranscriptView items={open.detail?.items} /></Box>
                      </>
                    )}
                </Box>
              )}
            </Box>
          ))}
          {data.sessions.length > sessCap && (
            <Button size="small" onClick={() => setSessCap((c) => c + 30)} sx={{ fontSize: 12, color: 'text.secondary', mt: 0.5 }}>
              더 보기 ({data.sessions.length - sessCap}건 남음)
            </Button>
          )}
        </Paper>
      )}
      <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 1.5 }}>
        대화 로그에는 개인정보가 포함될 수 있습니다. 열람은 운영 목적으로만 하고, 보존 기간 정책에 따라 정리하세요.
      </Typography>
      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={snack} />
    </>
  );
}

const LANG_KO = { en: '영어', ja: '일본어', zh: '중국어', vi: '베트남어', th: '태국어', id: '인도네시아어', ru: '러시아어', ko: '한국어', unknown: '미상' };

// 데스크 운영 통계(v2): 시범운영 보고서용 — 셀렉터로 데스크를 고르면 그 데스크의 상세 지표만 표출.
// 지표: 응대 건수(중단 포함)·평균/중앙값 응대시간·평균 문장수·누화 드랍율·길안내 감지→표시율,
// 일별 추이·시간대 분포·언어별 상세. 원자료는 CSV 로 내려받아 외부 분석/보고서에 사용.
function BarRow({ items, height = 64, labelOf, valueOf, tipOf, labelEvery = 1 }) {
  const max = Math.max(1e-9, ...items.map(valueOf));
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height }}>
      {items.map((x, i) => (
        <Tooltip key={i} title={tipOf(x, i)}>
          <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.4, height: '100%', justifyContent: 'flex-end' }}>
            <Box sx={{ width: '64%', height: `${Math.max(2, (valueOf(x) / max) * (height - 20))}px`, borderRadius: 0.75, bgcolor: 'primary.main', opacity: valueOf(x) ? 0.75 : 0.18 }} />
            <Typography sx={{ fontSize: 9.5, color: 'text.disabled', whiteSpace: 'nowrap', height: 12 }}>{i % labelEvery === 0 ? labelOf(x, i) : ''}</Typography>
          </Box>
        </Tooltip>
      ))}
    </Box>
  );
}
function MetricBox({ label, value, sub, tip }) {
  return (
    <Box sx={{ flex: '1 1 130px', minWidth: 120, p: 1.5, borderRadius: 1.25, border: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
        {tip && (
          <Tooltip title={tip} placement="top" enterTouchDelay={0}>
            <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} />
          </Tooltip>
        )}
      </Box>
      <Typography sx={{ fontSize: 19, fontWeight: 800, lineHeight: 1.3, mt: 0.25 }}>{value}</Typography>
      {sub && <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>{sub}</Typography>}
    </Box>
  );
}
// '전체' 선택용: 모든 데스크의 통계를 합산(평균류는 건수 가중, 중앙값은 rows 재계산)
function aggregateDeskStats(stats) {
  const agg = { id: '__all', title: '전체', count: 0, interrupted: 0, avgMs: 0, medianMs: 0, byLang: {}, sentences: { total: 0, avgPerConv: 0, staff: 0, guest: 0 }, crossDrops: 0, crossDropRate: 0, wayfindDetected: 0, wayfindShown: 0, wayfindTop: [], daily: [], hourly: Array(24).fill(0), rows: [] };
  const dailyMap = {}; const wtop = {}; const lang = {};
  for (const d of stats) {
    agg.count += d.count; agg.interrupted += d.interrupted || 0;
    agg.sentences.total += (d.sentences && d.sentences.total) || 0;
    agg.sentences.staff += (d.sentences && d.sentences.staff) || 0;
    agg.sentences.guest += (d.sentences && d.sentences.guest) || 0;
    agg.crossDrops += d.crossDrops || 0;
    agg.wayfindDetected += d.wayfindDetected || 0; agg.wayfindShown += d.wayfindShown || 0;
    for (const [lg, b] of Object.entries(d.byLang || {})) { const t = lang[lg] || (lang[lg] = { count: 0, dur: 0, sent: 0 }); t.count += b.count; t.dur += b.avgMs * b.count; t.sent += b.avgSent * b.count; }
    for (const x of d.daily || []) dailyMap[x.date] = (dailyMap[x.date] || 0) + x.count;
    (d.hourly || []).forEach((n, h) => { agg.hourly[h] += n; });
    for (const w of d.wayfindTop || []) wtop[w.catId] = (wtop[w.catId] || 0) + w.count;
    for (const r of d.rows || []) agg.rows.push({ ...r, desk: d.title });
  }
  agg.byLang = Object.fromEntries(Object.entries(lang).map(([lg, t]) => [lg, { count: t.count, avgMs: t.count ? Math.round(t.dur / t.count) : 0, avgSent: t.count ? +(t.sent / t.count).toFixed(1) : 0 }]));
  agg.daily = Object.entries(dailyMap).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
  agg.wayfindTop = Object.entries(wtop).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([catId, count]) => ({ catId, count }));
  const durs = agg.rows.map((r) => r.durMs).filter((v) => v != null).sort((a, b) => a - b);
  agg.avgMs = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
  agg.medianMs = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
  agg.sentences.avgPerConv = agg.count ? +(agg.sentences.total / agg.count).toFixed(1) : 0;
  const denom = agg.sentences.staff + agg.sentences.guest + agg.crossDrops;
  agg.crossDropRate = denom > 0 ? +((agg.crossDrops / denom) * 100).toFixed(1) : 0;
  agg.rows.sort((a, b) => (a.endedAt || 0) - (b.endedAt || 0));
  return agg;
}
const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
// 빈 상태 안내(아이콘+제목+설명) — 텅 빈 회색 문구 대신 다음 행동을 알려준다
function EmptyHint({ icon, title, desc }) {
  return (
    <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, mx: 'auto', mb: 1.25, borderRadius: '50%', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>{icon}</Box>
      <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: 'text.primary' }}>{title}</Typography>
      <Typography sx={{ fontSize: 12.5, mt: 0.5 }}>{desc}</Typography>
    </Box>
  );
}
function DeskStats() {
  const [stats, setStats] = useState(null);
  const [sel, setSel] = useState('__all');
  const [period, setPeriod] = useState(7);   // 7 | 30 | 90 | 'all'
  const [gran, setGran] = useState('day');   // 'day' | 'month'
  useEffect(() => { api.adminDeskStats().then(setStats).catch(() => setStats([])); }, []);
  if (!stats) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;
  if (!stats.length) {
    return (
      <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15, mb: 1 }}>데스크 운영 통계</Typography>
        <EmptyHint icon={<ForumOutlinedIcon sx={{ fontSize: 22 }} />} title="아직 응대 기록이 없습니다"
          desc="좌측 메뉴의 '데스크 안내'에서 안내데스크 세션을 만들어 응대를 시작하면 여기에 통계가 쌓입니다." />
      </Paper>
    );
  }
  const d = sel === '__all' ? aggregateDeskStats(stats) : (stats.find((x) => x.id === sel) || stats[0]);
  const langRows = Object.entries(d.byLang || {}).sort((a, b) => b[1].count - a[1].count);
  const hourly = (d.hourly || []).map((count, hour) => ({ hour, count }));

  // 기간별 통계: 기간(7/30/90일/전체) 필터 + 일별/월별 그룹핑. 일별 뷰는 빈 날짜를 0으로 채워 축 유지.
  let series = d.daily || [];
  if (period !== 'all') {
    const cut = new Date(Date.now() + 9 * 3600e3 - (period - 1) * 86400e3).toISOString().slice(0, 10);
    series = series.filter((x) => x.date >= cut);
    if (gran === 'day') {
      const map = Object.fromEntries(series.map((x) => [x.date, x.count]));
      series = [];
      for (let i = period - 1; i >= 0; i--) {
        const date = new Date(Date.now() + 9 * 3600e3 - i * 86400e3).toISOString().slice(0, 10);
        series.push({ date, count: map[date] || 0 });
      }
    }
  }
  if (gran === 'month') {
    const m = {};
    for (const x of series) { const k = x.date.slice(0, 7); m[k] = (m[k] || 0) + x.count; }
    series = Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count }));
  }

  const downloadCsv = () => {
    const all = sel === '__all';
    const head = (all ? 'desk,' : '') + 'date,startedAt,endedAt,durSec,lang,sentences,staff,guest,crossDrops,interrupted';
    const lines = (d.rows || []).map((r) => [
      ...(all ? [r.desk || ''] : []),
      r.date, r.startedAt ? new Date(r.startedAt).toISOString() : '', r.endedAt ? new Date(r.endedAt).toISOString() : '',
      r.durMs != null ? Math.round(r.durMs / 1000) : '', r.lang, r.sentences, r.staff ?? '', r.guest ?? '', r.crossDrops ?? '', r.interrupted ? 1 : 0,
    ].join(','));
    const blob = new Blob(['﻿' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }); // BOM: 엑셀 한글 인코딩
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `desk-stats-${all ? 'all' : d.id}-${kstToday()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  const selStyle = { px: 1.25, py: 0.9, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', fontSize: 13.5, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3 }}>
      {/* 헤더 — 벤더 실사용량과 동일하게 박스 안에 제목 배치 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>데스크 운영 통계</Typography>
        {/* 네이티브 select — MUI Select 가 일부 환경에서 클릭이 안 되던 문제로 교체 */}
        <Box component="select" value={sel} onChange={(e) => setSel(e.target.value)} sx={{ ...selStyle, minWidth: 150 }}>
          <option value="__all">전체</option>
          {stats.map((x) => <option key={x.id} value={x.id}>{x.title}{x.deleted ? ' (삭제됨)' : ''}</option>)}
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="응대 원자료 CSV 내려받기 (응대 1건 = 1행)">
          <IconButton size="small" onClick={downloadCsv}><FileDownloadOutlinedIcon sx={{ fontSize: 20 }} /></IconButton>
        </Tooltip>
      </Box>

      {/* 핵심 지표 */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
        <MetricBox label="응대 건수" value={d.count} sub={d.interrupted ? `중단 ${d.interrupted}건 포함` : undefined} />
        <MetricBox label="평균 응대 시간" value={fmtDuration(d.avgMs)} sub={`중앙값 ${fmtDuration(d.medianMs)}`} />
        <MetricBox label="응대당 평균 문장" value={(d.sentences && d.sentences.avgPerConv) || 0} sub={d.sentences ? `안내원 ${d.sentences.staff} · 손님 ${d.sentences.guest}` : undefined} />
        <MetricBox label="누화 드랍율" value={`${d.crossDropRate || 0}%`} sub={`드랍 ${d.crossDrops || 0}건`}
          tip="2채널(안내원 마이크 + 여객 태블릿) 운영 시 한 발화가 반대쪽 마이크에도 새어 들어와 중복 인식된 것을 서버가 걸러낸 비율입니다. 값이 높으면 두 마이크가 너무 가깝거나 민감도가 높다는 신호입니다." />
        <MetricBox label="길안내" value={`${d.wayfindShown}/${d.wayfindDetected}`} sub="표시/감지" />
      </Box>

      {/* 기간별 통계 — 기간·단위 선택 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary' }}>기간별 통계</Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={period} onChange={(e, v) => v != null && setPeriod(v)}>
          {[[7, '7일'], [30, '30일'], [90, '90일'], ['all', '전체']].map(([v, l]) => (
            <ToggleButton key={l} value={v} sx={{ py: 0.1, px: 1.1, fontSize: 11 }}>{l}</ToggleButton>
          ))}
        </ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={gran} onChange={(e, v) => v && setGran(v)}>
          <ToggleButton value="day" sx={{ py: 0.1, px: 1.1, fontSize: 11 }}>일별</ToggleButton>
          <ToggleButton value="month" sx={{ py: 0.1, px: 1.1, fontSize: 11 }}>월별</ToggleButton>
        </ToggleButtonGroup>
      </Box>
      {series.length > 0 ? (
        <BarRow items={series} labelOf={(x) => gran === 'month' ? x.date.slice(2) : x.date.slice(5)} valueOf={(x) => x.count}
          tipOf={(x) => `${x.date} · ${x.count}건`} labelEvery={Math.max(1, Math.ceil(series.length / 10))} />
      ) : (
        <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 2, textAlign: 'center' }}>선택한 기간에 응대 기록이 없습니다.</Typography>
      )}

      {/* 시간대별(좌) + 언어별(우) — 1열 배치 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 3, mt: 2.5 }}>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', mb: 0.5 }}>시간대별 분포 (KST)</Typography>
          {hourly.some((h) => h.count > 0)
            ? <BarRow items={hourly} height={64} labelOf={(x) => String(x.hour).padStart(2, '0')} valueOf={(x) => x.count} tipOf={(x) => `${x.hour}시 · ${x.count}건`} labelEvery={3} />
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 2, textAlign: 'center' }}>기록 없음</Typography>}
        </Box>
        <Box>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', mb: 0.5 }}>언어별 분포</Typography>
          {langRows.length > 0
            ? <BarRow items={langRows} height={64} labelOf={([lang]) => LANG_KO[lang] || lang} valueOf={([, b]) => b.count} tipOf={([lang, b]) => `${LANG_KO[lang] || lang} · ${b.count}건`} />
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 2, textAlign: 'center' }}>기록 없음</Typography>}
        </Box>
      </Box>

      {/* 길안내 상위 시설 */}
      {(d.wayfindTop || []).length > 0 && (
        <Box sx={{ mt: 2.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', mb: 0.75 }}>길안내 상위 시설</Typography>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {d.wayfindTop.map((w) => <Chip key={w.catId} size="small" label={`${w.catId} ${w.count}건`} sx={{ height: 22, fontSize: 12 }} />)}
          </Box>
        </Box>
      )}
    </Paper>
  );
}

/* 자주 묻는 질문 — 데스크 응대 로그의 손님 질문을 GPT 로 주제 클러스터링(버튼 실행, 결과 저장) */
function FaqPanel() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api.adminFaqReport().then(setReport).catch(() => setReport({ topics: [] })); }, []);
  const run = async () => {
    setBusy(true); setErr('');
    try { setReport(await api.adminFaqAnalyze()); }
    catch (e) { setErr(e.message || '분석 실패'); }
    finally { setBusy(false); }
  };
  const topics = (report && report.topics) || [];
  const maxCount = Math.max(1, ...topics.map((t) => t.count || 0));
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 3, mt: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>자주 묻는 질문</Typography>
        <Tooltip title="데스크 응대 로그의 손님 발화(한국어 번역)를 AI 로 주제별 클러스터링합니다. 안내판 개선·인력 배치의 근거 데이터로 사용하세요. (OpenAI 전송·과금 — 버튼으로만 실행)" placement="top">
          <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', cursor: 'help' }} />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {report && report.at > 0 && <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>{fmtTime(report.at)} · {report.checked}건 분석</Typography>}
        <Button size="small" variant="outlined" onClick={run} disabled={busy}>{busy ? '분석 중…' : '분석 실행'}</Button>
      </Box>
      {err && <Alert severity="error" sx={{ mb: 1.5 }}>{err}</Alert>}
      {report && report.note && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>{report.note}</Typography>}
      {topics.length === 0 && !report?.note && (
        <EmptyHint icon={<ForumOutlinedIcon sx={{ fontSize: 22 }} />} title="아직 분석 결과가 없습니다"
          desc="응대 로그가 쌓인 뒤 '분석 실행'을 누르면 손님 질문 TOP 주제가 여기에 표시됩니다." />
      )}
      {topics.map((t, i) => (
        <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.9, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.disabled', width: 20, flex: 'none' }}>{i + 1}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{t.topic}</Typography>
            {(t.examples || []).length > 0 && (
              <Typography sx={{ fontSize: 11.5, color: 'text.disabled', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                “{t.examples.join('” · “')}”
              </Typography>
            )}
          </Box>
          <Box sx={{ width: 120, flex: 'none', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: (th) => alpha(th.palette.primary.main, 0.15) }}>
              <Box sx={{ width: `${Math.round(((t.count || 0) / maxCount) * 100)}%`, height: '100%', borderRadius: 3, bgcolor: 'primary.main', opacity: 0.8 }} />
            </Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', width: 34, textAlign: 'right' }}>{t.count}건</Typography>
          </Box>
        </Box>
      ))}
    </Paper>
  );
}

/* 정형 안내 멘트 설정 — 데스크 원터치 재생용 문안(제목 + 언어별 텍스트) CRUD */
const CANNED_LANGS = [['ko', '한국어'], ['en', '영어'], ['ja', '일본어'], ['zh', '중국어']];
function CannedPanel() {
  const [items, setItems] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.canned().then((c) => setItems((c.items || []).map((it, i) => ({ ...it, _k: 'k' + i })))).catch(() => setItems([])); }, []);
  const mark = () => { setDirty(true); setMsg(''); };
  const patch = (k, fn) => { setItems((arr) => arr.map((it) => (it._k === k ? fn(it) : it))); mark(); };
  const add = () => { setItems((arr) => [{ _k: 'k' + Date.now(), id: 'c' + Date.now().toString(36), title: '', texts: {} }, ...arr]); mark(); };
  const remove = (k) => { setItems((arr) => arr.filter((it) => it._k !== k)); mark(); };
  const save = async () => {
    setSaving(true); setErr('');
    try {
      const c = await api.saveCanned(items.map(({ _k, ...it }) => it));
      setItems((c.items || []).map((it, i) => ({ ...it, _k: 'k' + i })));
      setDirty(false); setMsg('저장되었습니다.');
    } catch (e) { setErr(e.message || '저장 실패'); }
    finally { setSaving(false); }
  };
  if (!items) return <Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography>;
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 1.5 }}>
        <Typography sx={{ fontWeight: 800, fontSize: 15 }}>정형 안내 멘트</Typography>
        <Tooltip title="반복 안내(수하물 규정·교통편 등)를 미리 문안으로 등록해 두는 곳입니다. 제목과 한국어는 필수, 외국어 문안은 손님 언어에 맞춰 표시·재생에 사용됩니다. 데스크 화면의 원터치 재생 버튼은 다음 단계에서 연결됩니다." placement="top">
          <InfoOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled', cursor: 'help' }} />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<AddIcon />} onClick={add}>멘트 추가</Button>
        <Button size="small" variant="contained" onClick={save} disabled={saving || !dirty}>{saving ? '저장 중…' : '저장'}</Button>
      </Box>
      {msg && <Alert severity="success" sx={{ mb: 1.5 }}>{msg}</Alert>}
      {err && <Alert severity="error" sx={{ mb: 1.5 }}>{err}</Alert>}
      {items.length === 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
          <EmptyHint icon={<ForumOutlinedIcon sx={{ fontSize: 22 }} />} title="등록된 멘트가 없습니다"
            desc="'멘트 추가'로 자주 쓰는 안내 문안(예: 수하물 규정, 공항버스 안내)을 등록해 두세요." />
        </Paper>
      )}
      {items.map((it) => (
        <Paper key={it._k} variant="outlined" sx={{ borderRadius: 1.5, p: 2, mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <TextField size="small" placeholder="제목 (예: 수하물 규정 안내)" value={it.title}
              onChange={(e) => patch(it._k, (x) => ({ ...x, title: e.target.value }))} sx={{ width: 280 }}
              inputProps={{ style: { fontSize: 13.5, fontWeight: 700 } }} />
            <Box sx={{ flex: 1 }} />
            <IconButton size="small" onClick={() => remove(it._k)}><DeleteOutlineIcon sx={{ fontSize: 18 }} /></IconButton>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}>
            {CANNED_LANGS.map(([lg, label]) => (
              <TextField key={lg} size="small" multiline minRows={2} label={label + (lg === 'ko' ? ' (필수)' : '')}
                value={(it.texts && it.texts[lg]) || ''}
                onChange={(e) => patch(it._k, (x) => ({ ...x, texts: { ...x.texts, [lg]: e.target.value } }))}
                InputProps={{ sx: { fontSize: 13 } }} />
            ))}
          </Box>
        </Paper>
      ))}
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

export default function AdminPage({ user }) {
  const [tab, setTab] = useState('usage');
  const [list, setList] = useState(null);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState({ id: '', username: '', password: '' });
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
      {/* 서브탭(가운데) */}
      <Box sx={{ px: { xs: 2, sm: 4 }, pt: { xs: 1, sm: 1.5 }, borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
          sx={{ minHeight: 40, '& .MuiTabs-flexContainer': { justifyContent: 'center' }, '& .MuiTab-root': { minHeight: 40, textTransform: 'none', fontWeight: 700, fontSize: 14 } }}>
          {TABS.map((t) => <Tab key={t.v} value={t.v} label={t.label} />)}
        </Tabs>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        <Box sx={{ maxWidth: 960, mx: 'auto' }}>
          {/* ── 사용량: 벤더 실사용량(API 기반) + 데스크 운영 통계 ── */}
          {tab === 'usage' && (
            <>
              <VendorUsage />
              <Box sx={{ mt: 3 }}><DeskStats /></Box>
              <FaqPanel />
            </>
          )}

          {/* ── 정형 안내 멘트 ── */}
          {tab === 'canned' && <CannedPanel />}

          {/* ── 계정 관리 ── */}
          {tab === 'accounts' && (
            <>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={openDlg}>사용자 추가</Button>
            </Box>
            <Paper variant="outlined" sx={{ borderRadius: 1.5, overflowX: 'auto' }}>
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

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
      <Snackbar open={!!pageSnack} autoHideDuration={4000} onClose={() => setPageSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={pageSnack} />
    </>
  );
}
