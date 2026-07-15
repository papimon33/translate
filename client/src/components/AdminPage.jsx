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
import MenuItem from '@mui/material/MenuItem';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { alpha, useTheme } from '@mui/material/styles';
import { ACCENT } from '../theme.js';
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
import { Sparkline, BarTrend } from './charts.jsx';

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

/* ---- 벤더 실사용량: Soniox(STT·번역) / Cartesia(TTS) / OpenAI(GPT) 사용량 API 직접 조회 ----
   차트는 recharts(시그니처 보라, 다크 모드 자동 대응) — charts.jsx 공용 래퍼 사용. */
function VendorCard({ name, desc, v, keyHint, totalOf, subOf, valueOf, valFmt, extra, brand }) {
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
          <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.2, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{totalOf(v)}</Typography>
          {v.error && <Tooltip title={`최신 갱신 실패(저장분 표시 중): ${v.error}`}><Chip size="small" color="warning" label="갱신 실패" sx={{ height: 18, fontSize: 10.5 }} /></Tooltip>}
        </Box>
        {/* 카드 간 차트 기준선 정렬: 보조 문구 줄은 항상 렌더링(비어도 높이 유지) */}
        <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.25, minHeight: 18, fontVariantNumeric: 'tabular-nums' }}>{subOf ? subOf(v) : ' '}</Typography>
        {(v.days || []).length
          ? <Sparkline brand={brand} formatValue={(val) => (valFmt ? valFmt(val) : val)}
              data={(v.days || []).map((d) => ({ label: d.date.slice(5), full: d.date, value: Number(valueOf(d)) || 0 }))} />
          : <Box sx={{ height: 44, mt: 1, display: 'grid', placeItems: 'center' }}><Typography sx={{ fontSize: 12, color: 'text.disabled' }}>기간 내 사용 기록 없음</Typography></Box>}
        {extra && extra(v)}
      </>
    );
  };
  const ok = v && v.configured && !v.error;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.25, flex: '1 1 240px', minWidth: 220 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 12.5, color: 'text.secondary' }}>{name} <Box component="span" sx={{ fontWeight: 500, fontSize: 12 }}>· {desc}</Box></Typography>
        {ok && <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: 'success.main', flex: 'none' }}>정상</Typography>}
      </Box>
      {body()}
    </Paper>
  );
}
function VendorUsage({ brand }) {
  const [period, setPeriod] = useState(30); // 7 | 14 | 30 | 'month'
  const [data, setData] = useState(null);
  const days = period === 'month' ? 365 : period;
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
  // 일별 총 비용(USD): Soniox + OpenAI 합산(같은 KST 일자 축) — Cartesia 는 크레딧 단위라 카드에서 확인
  const dailyMap = {};
  for (const k of ['soniox', 'openai']) for (const d of (v(k) || {}).days || []) dailyMap[d.date] = (dailyMap[d.date] || 0) + (d.costUsd || 0);
  const dailyEntries = Object.entries(dailyMap).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const totalUsd = dailyEntries.reduce((a, [, c]) => a + c, 0);
  // 막대 데이터: 월별이면 YYYY-MM 로 합산(1월·2월…), 아니면 일별
  let costBars;
  if (period === 'month') {
    const m = {};
    for (const [date, c] of dailyEntries) { const k = date.slice(0, 7); m[k] = (m[k] || 0) + c; }
    costBars = Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([ym, c]) => ({ label: Number(ym.slice(5)) + '월', full: ym.replace('-', '. ') + '.', value: +c.toFixed(4) }));
  } else {
    costBars = dailyEntries.map(([date, c]) => ({ label: date.slice(5).replace('-', '/'), full: date, value: +c.toFixed(4) }));
  }
  const PERIODS = [[7, '7일'], [14, '14일'], [30, '30일'], ['month', '월별']];
  return (
    <>
      {/* 페이지 제목 + 기간 세그먼트(활성=시그니처 보라) */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        <Typography component="h1" sx={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em' }}>사용량</Typography>
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={period} onChange={(e, x) => x && setPeriod(x)}
          sx={{ '& .MuiToggleButton-root': { py: 0.35, px: 1.6, fontSize: 12, fontWeight: 700, textTransform: 'none', '&.Mui-selected': { bgcolor: brand, color: '#fff', '&:hover': { bgcolor: brand } } } }}>
          {PERIODS.map(([val, lab]) => <ToggleButton key={val} value={val}>{lab}</ToggleButton>)}
        </ToggleButtonGroup>
      </Box>
      {data && data.error && <Alert severity="error" sx={{ mb: 1 }}>벤더 사용량을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</Alert>}
      {/* 요청 실패 시 '불러오는 중…' 카드가 영구히 남지 않도록 카드 영역 자체를 숨김 */}
      <Box sx={{ display: data && data.error ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 1.5, mb: 1.75 }}>
        <VendorCard brand={brand} name="Soniox" desc="음성인식·실시간 번역" v={v('soniox')} keyHint="SONIOX_API_KEY"
          totalOf={(x) => fmtCost(x.totalCostUsd || 0)} subOf={(x) => `오디오 ${fmtMin(x.totalAudioMin || 0)} · ${x.totalRequests || 0}회 연결`}
          valueOf={(d) => d.costUsd} valFmt={(c) => fmtCost(c)}
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
        <VendorCard brand={brand} name="Cartesia" desc="음성 합성(TTS)" v={v('cartesia')} keyHint="CARTESIA_ADMIN_API_KEY (sk_car_admin_…)"
          totalOf={(x) => `${(x.totalCredits || 0).toLocaleString()} 크레딧`}
          subOf={(x) => `일평균 ${Math.round((x.totalCredits || 0) / Math.max(1, (x.days || []).length)).toLocaleString()} 크레딧`}
          valueOf={(d) => d.credits} valFmt={(c) => `${(c || 0).toLocaleString()} 크레딧`} />
        <VendorCard brand={brand} name="OpenAI" desc="GPT (요약·다듬기·검사)" v={v('openai')} keyHint="OPENAI_ADMIN_API_KEY (sk-admin-…)"
          totalOf={(x) => fmtCost(x.totalCostUsd || 0)}
          subOf={(x) => `일평균 ${fmtCost((x.totalCostUsd || 0) / Math.max(1, (x.days || []).length))}`}
          valueOf={(d) => d.costUsd} valFmt={(c) => fmtCost(c)} />
      </Box>
      {/* 총 비용 막대 그래프 — 일별(7/14/30) 또는 월별 */}
      {!(data && data.error) && (
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 1.25, flexWrap: 'wrap' }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>총 비용 (USD) <Box component="span" sx={{ fontWeight: 500, fontSize: 12, color: 'text.secondary' }}>· Soniox + OpenAI</Box></Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
              {period === 'month' ? '기간' : `${period}일`} 합계 <Box component="b" sx={{ color: brand, fontVariantNumeric: 'tabular-nums' }}>{fmtCost(totalUsd)}</Box>
            </Typography>
          </Box>
          {!data ? <Typography sx={{ fontSize: 13, color: 'text.secondary', py: 6, textAlign: 'center' }}>불러오는 중…</Typography>
            : costBars.length ? <BarTrend data={costBars} brand={brand} height={220} barSize={period === 'month' ? 40 : 26}
                tickEvery={period === 30 ? 3 : 1} formatValue={(c) => (typeof c === 'number' ? fmtCost(c) : c)} />
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 6, textAlign: 'center' }}>기간 내 사용 기록이 없습니다.</Typography>}
        </Paper>
      )}
    </>
  );
}

// 상단 탭은 제거 — 이동은 좌측 nav 의 관리자 하위메뉴(Nav.jsx ADMIN_TABS)에서. 여기는 페이지 제목만.
const PAGE_TITLES = { logs: '로그', desks: '안내데스크', accounts: '계정 관리', terms: '용어 설정', canned: '정형 안내', system: '시스템·보안' };

/* ── 안내데스크 관리(레지스트리): 이름·층·방향을 사전 정의 — 관리자 전용.
     세션은 여기서 만들지 않는다: 데스크 목록 화면에서 '등록된 데스크 선택 + 세션명'으로 생성.
     (기존 데스크 세션 삭제는 데스크 목록 화면의 행 액션으로 — 응대 로그는 '로그' 탭에 보존) ── */
const DESK_FLOORS = ['1F', '2F', '3F', '4F'];
const DESK_SIDES = [{ v: 'E', label: '동' }, { v: 'W', label: '서' }, { v: 'S', label: '남' }, { v: 'N', label: '북' }];
function DeskManagePanel() {
  const [reg, setReg] = useState(null); // null=로딩, [{id,name,floor,side}]
  const [dlg, setDlg] = useState(false);
  const [name, setName] = useState('');
  const [floor, setFloor] = useState('1F');
  const [side, setSide] = useState('S');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [snack, setSnack] = useState('');
  const reload = () => api.deskRegistry().then((r) => setReg((r && r.desks) || [])).catch(() => setReg([]));
  useEffect(() => { reload(); }, []);
  const save = async (desks, okMsg) => {
    setBusy(true);
    try {
      const r = await api.saveDeskRegistry({ desks });
      setReg((r && r.desks) || desks);
      if (okMsg) setSnack(okMsg);
    } catch (e) { setSnack('저장 실패: ' + (e.message || '오류')); }
    setBusy(false);
  };
  const add = async () => {
    if (!name.trim() || busy) return;
    await save([...(reg || []), { name: name.trim(), floor, side }], '데스크가 등록되었습니다');
    setDlg(false); setName('');
  };
  const askDelete = (d) => setConfirm({
    title: '안내데스크 정의 삭제',
    message: `'${d.name}' 데스크 정의를 삭제합니다. 이미 만들어진 세션·응대 로그는 그대로 남습니다.`,
    onOk: () => save((reg || []).filter((x) => x.id !== d.id), '삭제되었습니다'),
  });
  return (
    <>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          안내데스크의 이름·층·방향을 여기서 미리 등록합니다. 세션은 '데스크 안내' 화면에서 등록된 데스크를 선택해 만듭니다.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setDlg(true)}>데스크 등록</Button>
      </Box>
      <Paper variant="outlined" sx={{ borderRadius: 1.5, overflowX: 'auto' }}>
        <Table sx={{ minWidth: 420 }}>
          <TableHead>
            <TableRow sx={{ '& th': { fontWeight: 800, fontSize: 13 } }}>
              <TableCell>데스크명</TableCell>
              <TableCell>층 (길안내 출발점)</TableCell>
              <TableCell>방향</TableCell>
              <TableCell align="right">삭제</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(reg || []).map((d) => (
              <TableRow key={d.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{d.name}</TableCell>
                <TableCell>{d.floor}</TableCell>
                <TableCell>{(DESK_SIDES.find((s) => s.v === d.side) || {}).label || d.side}</TableCell>
                <TableCell align="right">
                  <IconButton size="small" disabled={busy} onClick={() => askDelete(d)}><DeleteOutlineIcon fontSize="small" /></IconButton>
                </TableCell>
              </TableRow>
            ))}
            {reg && reg.length === 0 && (
              <TableRow><TableCell colSpan={4} sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>등록된 안내데스크가 없습니다. '데스크 등록'으로 추가하세요.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Paper>
      <Dialog open={dlg} onClose={() => setDlg(false)} PaperProps={{ sx: { width: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>안내데스크 등록</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '8px !important' }}>
          <TextField autoFocus label="데스크명" placeholder="예: 국제선 2층 안내데스크" size="small" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TextField select label="층(길안내 출발점)" size="small" value={floor} onChange={(e) => setFloor(e.target.value)} sx={{ flex: 1 }}>
              {DESK_FLOORS.map((f) => <MenuItem key={f} value={f}>{f}</MenuItem>)}
            </TextField>
            <TextField select label="방향" size="small" value={side} onChange={(e) => setSide(e.target.value)} sx={{ flex: 1 }}>
              {DESK_SIDES.map((s) => <MenuItem key={s.v} value={s.v}>{s.label} ({s.v})</MenuItem>)}
            </TextField>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDlg(false)} sx={{ color: 'text.secondary' }}>취소</Button>
          <Button variant="contained" disabled={!name.trim() || busy} onClick={add}>등록</Button>
        </DialogActions>
      </Dialog>
      <ConfirmDialog req={confirm} onClose={() => setConfirm(null)} />
      <Snackbar open={!!snack} autoHideDuration={3500} onClose={() => setSnack('')} message={snack} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

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

/* 데스크 운영 통계(v3, 시안 2 + 콘솔 참고): KPI 타일 4 + 일별 응대 막대 + 언어 분포 + 시간대별 분포.
   차트는 recharts(호버 툴팁), 데스크 선택은 select, 원자료 CSV 유지. */
const kstDayStr = (offset = 0) => new Date(Date.now() + 9 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10);
const fmtClock = (ms) => { const s = Math.round((ms || 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function KpiCard({ label, value, unit, sub, tip }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2, pb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography sx={{ fontSize: 12, fontWeight: 700, color: 'text.secondary' }}>{label}</Typography>
        {tip && <Tooltip title={tip} placement="top" enterTouchDelay={0}><InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} /></Tooltip>}
      </Box>
      <Typography sx={{ fontSize: 24, fontWeight: 800, lineHeight: 1.25, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        {value}{unit ? <Box component="span" sx={{ fontSize: 13, fontWeight: 600, color: 'text.secondary' }}> {unit}</Box> : null}
      </Typography>
      <Typography component="div" sx={{ fontSize: 11.5, color: 'text.disabled', fontVariantNumeric: 'tabular-nums', minHeight: 17 }}>{sub || '\u00a0'}</Typography>
    </Paper>
  );
}
function HBar({ label, pct, right, brand, opacity = 1 }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: '72px 1fr 88px', alignItems: 'center', gap: 1.25, my: 1.1, fontSize: 12.5 }}>
      <span>{label}</span>
      <Box sx={{ height: 10, borderRadius: 1, bgcolor: (t) => alpha(t.palette.text.primary, 0.06), overflow: 'hidden' }}>
        <Box sx={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 1, bgcolor: brand, opacity }} />
      </Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{right}</Typography>
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
function DeskStats({ brand }) {
  const [stats, setStats] = useState(null);
  const [sel, setSel] = useState('__all');
  useEffect(() => { api.adminDeskStats().then(setStats).catch(() => setStats([])); }, []);
  const selStyle = { px: 1.25, py: 0.7, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
  const header = (right) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 5, mb: 2, flexWrap: 'wrap' }}>
      <Typography component="h2" sx={{ fontSize: 21, fontWeight: 800, letterSpacing: '-0.02em' }}>데스크 운영 통계</Typography>
      {right}
    </Box>
  );
  if (!stats) return <>{header(null)}<Typography sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>불러오는 중…</Typography></>;
  if (!stats.length) {
    return (
      <>
        {header(null)}
        <Paper variant="outlined" sx={{ borderRadius: 1.5 }}>
          <EmptyHint icon={<ForumOutlinedIcon sx={{ fontSize: 22 }} />} title="아직 응대 기록이 없습니다"
            desc="좌측 메뉴의 '데스크 안내'에서 안내데스크 세션을 만들어 응대를 시작하면 여기에 통계가 쌓입니다." />
        </Paper>
      </>
    );
  }
  const d = sel === '__all' ? aggregateDeskStats(stats) : (stats.find((x) => x.id === sel) || stats[0]);

  // KPI: 오늘 응대(어제 대비) · 평균 응대 시간(중앙값) · 응대당 문장(안내원/손님) · 누화 드랍율
  const dayMap = Object.fromEntries((d.daily || []).map((x) => [x.date, x.count]));
  const todayN = dayMap[kstDayStr(0)] || 0;
  const yestN = dayMap[kstDayStr(1)] || 0;
  const diffPct = yestN > 0 ? Math.round(((todayN - yestN) / yestN) * 100) : null;
  const per = (n) => (d.count ? +(n / d.count).toFixed(1) : 0);
  // 일별 응대(최근 14일, 빈 날 0 채움 — 축 유지)
  const series = [];
  for (let i = 13; i >= 0; i--) { const date = kstDayStr(i); series.push({ date, count: dayMap[date] || 0 }); }
  const sum14 = series.reduce((a, x) => a + x.count, 0);
  // 언어 분포: 상위 4 + 기타
  const langAll = Object.entries(d.byLang || {}).sort((a, b) => b[1].count - a[1].count);
  const langTotal = Math.max(1, langAll.reduce((a, [, b]) => a + b.count, 0));
  const rest = langAll.slice(4).reduce((a, [, b]) => a + b.count, 0);
  const langRows = [...langAll.slice(0, 4).map(([lg, b]) => [LANG_KO[lg] || lg, b.count]), ...(rest ? [['기타', rest]] : [])];
  const OP = [1, 0.8, 0.6, 0.45, 0.35];
  // 일별 응대 막대(recharts)
  const dailyBars = series.map((x, i) => ({ label: i === series.length - 1 ? '오늘' : x.date.slice(5).replace('-', '/'), full: x.date, value: x.count }));
  // 시간대별 분포(0~23시)
  const hourly = (d.hourly || []);
  const hourlyBars = hourly.map((count, h) => ({ label: String(h).padStart(2, '0'), full: `${h}시`, value: count }));
  const hourlyTotal = hourly.reduce((a, b) => a + b, 0);

  const downloadCsv = () => {
    const all = sel === '__all';
    const head = (all ? 'desk,' : '') + 'date,startedAt,endedAt,durSec,lang,sentences,staff,guest,crossDrops,interrupted';
    const lines = (d.rows || []).map((r) => [
      ...(all ? [r.desk || ''] : []),
      r.date, r.startedAt ? new Date(r.startedAt).toISOString() : '', r.endedAt ? new Date(r.endedAt).toISOString() : '',
      r.durMs != null ? Math.round(r.durMs / 1000) : '', r.lang, r.sentences, r.staff ?? '', r.guest ?? '', r.crossDrops ?? '', r.interrupted ? 1 : 0,
    ].join(','));
    const blob = new Blob(['\ufeff' + [head, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }); // BOM: 엑셀 한글 인코딩
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `desk-stats-${all ? 'all' : d.id}-${kstToday()}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <>
      {header(
        <>
          {/* 데스크 선택 — 네이티브 select(MUI Select 가 일부 환경에서 클릭이 안 되던 문제로 유지) */}
          <Box component="select" value={sel} onChange={(e) => setSel(e.target.value)} sx={{ ...selStyle, minWidth: 150 }}>
            <option value="__all">전체</option>
            {stats.map((x) => <option key={x.id} value={x.id}>{x.title}{x.deleted ? ' (삭제됨)' : ''}</option>)}
          </Box>
          <Box sx={{ flex: 1 }} />
          <Tooltip title="응대 원자료 CSV 내려받기 (응대 1건 = 1행)">
            <IconButton size="small" onClick={downloadCsv}><FileDownloadOutlinedIcon sx={{ fontSize: 20 }} /></IconButton>
          </Tooltip>
        </>
      )}

      {/* KPI 타일 4 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1.5, mb: 1.5 }}>
        <KpiCard label="오늘 응대" value={todayN} unit="건"
          sub={<>어제 {yestN}건{diffPct != null && <> · <Box component="b" sx={{ color: diffPct >= 0 ? 'success.main' : 'warning.main' }}>{diffPct >= 0 ? '+' : ''}{diffPct}%</Box></>}</>} />
        <KpiCard label="평균 응대 시간" value={fmtClock(d.avgMs)} sub={`중앙값 ${fmtClock(d.medianMs)}`} />
        <KpiCard label="응대당 문장" value={d.sentences ? d.sentences.avgPerConv : 0}
          sub={d.sentences ? `안내원 ${per(d.sentences.staff)} · 손님 ${per(d.sentences.guest)}` : undefined} />
        <KpiCard label="누화 드랍" value={d.crossDropRate || 0} unit="%" sub="2채널 마이크 간섭 지표"
          tip="2채널(안내원 마이크 + 여객 태블릿) 운영 시 한 발화가 반대쪽 마이크에도 새어 들어와 중복 인식된 것을 서버가 걸러낸 비율입니다. 값이 높으면 두 마이크가 너무 가깝거나 민감도가 높다는 신호입니다." />
      </Box>

      {/* 일별 응대 추이(좌) + 언어 분포(우) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.6fr 1fr' }, gap: 1.5 }}>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>일별 응대 건수</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>14일 합계 {sum14}건</Typography>
          </Box>
          {sum14 > 0 ? <BarTrend data={dailyBars} brand={brand} height={200} barSize={26} tickEvery={2} emphasizeLast formatValue={(n) => `${n}건`} />
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 7, textAlign: 'center' }}>최근 14일간 응대 기록이 없습니다.</Typography>}
        </Paper>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 0.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>언어 분포</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>손님 언어</Typography>
          </Box>
          {langRows.length > 0
            ? langRows.map(([label, count], i) => (
              <HBar key={label} label={label} pct={(count / langTotal) * 100} right={`${count}건 · ${Math.round((count / langTotal) * 100)}%`} brand={brand} opacity={OP[i] || 0.35} />
            ))
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 2, textAlign: 'center' }}>기록 없음</Typography>}
        </Paper>
      </Box>

      {/* 시간대별 분포(KST, 0~23시) */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14 }}>시간대별 분포 <Box component="span" sx={{ fontWeight: 500, fontSize: 12, color: 'text.secondary' }}>· KST</Box></Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>합계 {hourlyTotal}건</Typography>
        </Box>
        {hourlyTotal > 0 ? <BarTrend data={hourlyBars} brand={brand} height={180} barSize={18} tickEvery={3} formatValue={(n) => `${n}건`} />
          : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 6, textAlign: 'center' }}>기록 없음</Typography>}
      </Paper>
    </>
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

export default function AdminPage({ user, tab = 'usage' }) {
  const theme = useTheme();
  const brand = ACCENT[theme.palette.mode] || ACCENT.light; // 시그니처 보라 — 그래프 전용
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
      <Box sx={{ flex: 1, overflowY: 'auto', p: { xs: 2, sm: 4 } }}>
        {/* 컨텐츠 전폭 사용(시안): 제목 아래 넓은 영역 */}
        <Box sx={{ maxWidth: 1240, mx: 'auto' }}>
          {/* 페이지 제목 — 사용량 화면은 기간 세그먼트와 함께 자체 렌더링 */}
          {tab !== 'usage' && (
            <Typography component="h1" sx={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.02em', mb: 2.5 }}>{PAGE_TITLES[tab]}</Typography>
          )}

          {/* ── 사용량: 벤더 실사용량(보라 스파크라인·일별 총비용) + 데스크 운영 통계(시안 2) ── */}
          {tab === 'usage' && (
            <>
              <VendorUsage brand={brand} />
              <DeskStats brand={brand} />
            </>
          )}

          {/* ── 안내데스크 관리 ── */}
          {tab === 'desks' && <DeskManagePanel />}

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
          {tab === 'system' && (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Tooltip title="세션(대화·응대 로그)·안내데스크 정의·용어·정형 안내를 JSON 한 파일로 내려받습니다">
                  <Button variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={() => { window.location.href = '/api/admin/export'; }}>
                    전체 데이터 백업(JSON)
                  </Button>
                </Tooltip>
              </Box>
              <SystemPanel />
            </>
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

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />
      <Snackbar open={!!pageSnack} autoHideDuration={4000} onClose={() => setPageSnack('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} message={pageSnack} />
    </>
  );
}
