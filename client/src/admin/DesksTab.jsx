// 관리자 > 안내데스크 탭: 데스크 정의(레지스트리) 관리 + 운영 통계
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
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { alpha } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import Snackbar from '@mui/material/Snackbar';
import ConfirmDialog from '../shared/ConfirmDialog.jsx';
import { api } from '../shared/api.js';
import { BarTrend } from './charts.jsx';
import { LANG_KO, kstDayStr, fmtClock, kstToday } from './format.js';
import { EmptyHint } from './EmptyHint.jsx';

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
    let ok = true;
    try {
      const r = await api.saveDeskRegistry({ desks });
      setReg((r && r.desks) || desks);
      if (okMsg) setSnack(okMsg);
    } catch (e) { setSnack('저장 실패: ' + (e.message || '오류')); ok = false; }
    setBusy(false);
    return ok;
  };
  const add = async () => {
    if (!name.trim() || busy) return;
    const ok = await save([...(reg || []), { name: name.trim(), floor, side }], '데스크가 등록되었습니다');
    if (ok) { setDlg(false); setName(''); } // 실패 시 다이얼로그·입력값 유지(스낵바로 원인 안내)
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

/* 데스크 운영 통계(v3, 시안 2 + 콘솔 참고): KPI 타일 4 + 일별 응대 막대 + 언어 분포 + 시간대별 분포.
   차트는 recharts(호버 툴팁), 데스크 선택은 select, 원자료 CSV 유지. */
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

function DeskStats({ brand }) {
  const [stats, setStats] = useState(null);
  const [sel, setSel] = useState('__all');
  const [period, setPeriod] = useState(14); // 7 | 14 | 30 | 'month'
  useEffect(() => { api.adminDeskStats().then(setStats).catch(() => setStats([])); }, []);
  const selStyle = { px: 1.25, py: 0.7, borderRadius: 1, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary', fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' };
  const PERIODS = [[7, '7일'], [14, '14일'], [30, '30일'], ['month', '월별']];
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

  // 기간 필터: 응대 원자료(rows, 데스크당 최근 500건)를 기간으로 잘라 KPI·차트 전부 재계산 —
  // 월별은 보존된 전체 원자료를 월 단위로 그룹(500건 초과분은 CSV·로그에만 남음)
  const rows = d.rows || [];
  const rowsIn = period === 'month' ? rows : rows.filter((r) => r.date >= kstDayStr(period - 1));
  const durs = rowsIn.map((r) => r.durMs).filter((v) => v != null).sort((a, b) => a - b);
  const totalMs = durs.reduce((a, b) => a + b, 0);
  const avgMs = durs.length ? Math.round(totalMs / durs.length) : 0;
  const medianMs = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
  const cd = rowsIn.reduce((a, r) => ({ s: a.s + (r.staff || 0), g: a.g + (r.guest || 0), x: a.x + (r.crossDrops || 0) }), { s: 0, g: 0, x: 0 });
  const crossRate = cd.s + cd.g + cd.x > 0 ? +((cd.x / (cd.s + cd.g + cd.x)) * 100).toFixed(1) : 0;
  const fmtTotal = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`; };

  // 응대 추이 막대: 일별(빈 날 0 채움) 또는 월별(연도 라벨)
  const cntBy = {};
  for (const r of rowsIn) { const k = period === 'month' ? r.date.slice(0, 7) : r.date; cntBy[k] = (cntBy[k] || 0) + 1; }
  let trendBars;
  if (period === 'month') {
    const months = Object.entries(cntBy).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const multiYear = new Set(months.map(([ym]) => ym.slice(0, 4))).size > 1;
    trendBars = months.map(([ym, n]) => ({ label: (multiYear ? `${ym.slice(2, 4)}.` : '') + Number(ym.slice(5)) + '월', full: ym.replace('-', '. ') + '.', value: n }));
  } else {
    trendBars = [];
    for (let i = period - 1; i >= 0; i--) {
      const date = kstDayStr(i);
      trendBars.push({ label: i === 0 ? '오늘' : date.slice(5).replace('-', '/'), full: date, value: cntBy[date] || 0 });
    }
  }
  const trendSum = rowsIn.length;
  // 언어 분포(기간 내): 상위 4 + 기타
  const langCnt = {};
  for (const r of rowsIn) { const k = r.lang || 'unknown'; langCnt[k] = (langCnt[k] || 0) + 1; }
  const langAll = Object.entries(langCnt).sort((a, b) => b[1] - a[1]);
  const langTotal = Math.max(1, rowsIn.length);
  const rest = langAll.slice(4).reduce((a, [, n]) => a + n, 0);
  const langRows = [...langAll.slice(0, 4).map(([lg, n]) => [LANG_KO[lg] || lg, n]), ...(rest ? [['기타', rest]] : [])];
  const OP = [1, 0.8, 0.6, 0.45, 0.35];
  // 시간대별(기간 내, KST)
  const hourly = Array(24).fill(0);
  for (const r of rowsIn) { if (r.endedAt) hourly[new Date(r.endedAt + 9 * 3600e3).getUTCHours()]++; }
  const hourlyBars = hourly.map((n, h) => ({ label: String(h).padStart(2, '0'), full: `${h}시`, value: n }));
  const hourlyTotal = rowsIn.length;
  const periodLabel = period === 'month' ? '전체' : `${period}일`;

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
          <ToggleButtonGroup size="small" exclusive value={period} onChange={(e, v) => v && setPeriod(v)}
            sx={{ '& .MuiToggleButton-root': { py: 0.35, px: 1.4, fontSize: 12, fontWeight: 700, textTransform: 'none', '&.Mui-selected': { bgcolor: brand, color: '#fff', '&:hover': { bgcolor: brand } } } }}>
            {PERIODS.map(([v, l]) => <ToggleButton key={l} value={v}>{l}</ToggleButton>)}
          </ToggleButtonGroup>
          <Tooltip title="응대 원자료 CSV 내려받기 (응대 1건 = 1행)">
            <IconButton size="small" onClick={downloadCsv}><FileDownloadOutlinedIcon sx={{ fontSize: 20 }} /></IconButton>
          </Tooltip>
        </>
      )}

      {/* KPI 타일 4 — 선택 기간 기준 */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 1.5, mb: 1.5 }}>
        <KpiCard label={`총 응대 건수 (${periodLabel})`} value={rowsIn.length} unit="건"
          sub={rowsIn.filter((r) => r.interrupted).length ? `중단 ${rowsIn.filter((r) => r.interrupted).length}건 포함` : undefined} />
        <KpiCard label={`총 응대 시간 (${periodLabel})`} value={fmtTotal(totalMs)} sub={`응대당 평균 ${fmtClock(avgMs)}`} />
        <KpiCard label="평균 응대 시간" value={fmtClock(avgMs)} sub={`중앙값 ${fmtClock(medianMs)}`} />
        <KpiCard label="누화 드랍" value={crossRate} unit="%" sub="2채널 마이크 간섭 지표"
          tip="2채널(안내원 마이크 + 여객 태블릿) 운영 시 한 발화가 반대쪽 마이크에도 새어 들어와 중복 인식된 것을 서버가 걸러낸 비율입니다. 값이 높으면 두 마이크가 너무 가깝거나 민감도가 높다는 신호입니다." />
      </Box>

      {/* 응대 추이(좌) + 언어 분포(우) */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.6fr 1fr' }, gap: 1.5 }}>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>{period === 'month' ? '월별' : '일별'} 응대 건수</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>{periodLabel} 합계 {trendSum}건</Typography>
          </Box>
          {trendSum > 0 ? <BarTrend data={trendBars} brand={brand} height={200} barSize={26} tickEvery={period === 30 ? 3 : period === 14 ? 2 : 1} emphasizeLast={period !== 'month'} formatValue={(n) => `${n}건`} />
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 7, textAlign: 'center' }}>선택한 기간에 응대 기록이 없습니다.</Typography>}
        </Paper>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 0.5 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 14 }}>언어 분포</Typography>
            <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>손님 언어 · {periodLabel}</Typography>
          </Box>
          {langRows.length > 0
            ? langRows.map(([label, count], i) => (
              <HBar key={label} label={label} pct={(count / langTotal) * 100} right={`${count}건 · ${Math.round((count / langTotal) * 100)}%`} brand={brand} opacity={OP[i] || 0.35} />
            ))
            : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 2, textAlign: 'center' }}>기록 없음</Typography>}
        </Paper>
      </Box>

      {/* 시간대별 분포(KST, 기간 내) */}
      <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 1.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 1.5, mb: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 14 }}>시간대별 분포 <Box component="span" sx={{ fontWeight: 500, fontSize: 12, color: 'text.secondary' }}>· KST · {periodLabel}</Box></Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>합계 {hourlyTotal}건</Typography>
        </Box>
        {hourlyTotal > 0 ? <BarTrend data={hourlyBars} brand={brand} height={180} barSize={18} tickEvery={3} formatValue={(n) => `${n}건`} />
          : <Typography sx={{ fontSize: 12.5, color: 'text.disabled', py: 6, textAlign: 'center' }}>기록 없음</Typography>}
      </Paper>
    </>
  );
}

export default function DesksTab({ brand }) {
  return (
    <>
      <DeskManagePanel />
      <DeskStats brand={brand} />
    </>
  );
}
