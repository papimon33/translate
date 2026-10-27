// 관리자 > 사용량 탭: 벤더별 실사용량·비용 추이·사용자별 사용량
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import Tooltip from '@mui/material/Tooltip';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import { api } from '../shared/api.js';
import { Sparkline, BarTrend } from './charts.jsx';
import { fmtCost, fmtMin } from './format.js';

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

/* 카드 하단 파이프라인별(실시간 번역/안내데스크) 분해 표 — 값이 0인 행은 숨김 */
function PipeSplit({ rows, note }) {
  const shown = rows.filter(([, v]) => v && Object.values(v).some((n) => n > 0));
  if (!shown.length) return null;
  return (
    <Box sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'text.secondary', mb: 0.5 }}>
        파이프라인별{note ? <Box component="span" sx={{ fontWeight: 400, color: 'text.disabled' }}> · {note}</Box> : null}
      </Typography>
      {shown.map(([label, v, fmt]) => (
        <Box key={label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.2 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{label}</Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</Typography>
        </Box>
      ))}
    </Box>
  );
}

/* 유저별 사용량(Soniox) — 카드에서 분리한 별도 패널(④) */
function UserUsagePanel({ users }) {
  if (!users || !users.length) return null;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 1.5, p: 2.5, mt: 1.5 }}>
      <Typography sx={{ fontWeight: 800, fontSize: 14, mb: 1 }}>
        유저별 사용량 <Box component="span" sx={{ fontWeight: 500, fontSize: 12, color: 'text.secondary' }}>· Soniox · {users.length}명</Box>
      </Typography>
      <Box sx={{ maxHeight: 220, overflowY: 'auto', pr: 0.5 }}>
        {users.map((u) => (
          <Box key={u.id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, py: 0.35, borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 } }}>
            <Typography sx={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.id === 'anon' ? '(미태깅·과거)' : u.id}</Typography>
            <Typography sx={{ fontSize: 12.5, color: 'text.secondary', flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(u.costUsd)} · {fmtMin(u.audioMin)} · {u.requests}회</Typography>
          </Box>
        ))}
      </Box>
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
    let months = Object.entries(m).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const firstIdx = months.findIndex(([, c]) => c > 0);
    months = firstIdx < 0 ? [] : months.slice(firstIdx); // 데이터 시작 이전의 빈 달(0 막대) 제거
    const multiYear = new Set(months.map(([ym]) => ym.slice(0, 4))).size > 1; // 1년 경계: '7월' 라벨 중복 방지
    costBars = months.map(([ym, c]) => ({
      label: (multiYear ? `${ym.slice(2, 4)}.` : '') + Number(ym.slice(5)) + '월',
      full: ym.replace('-', '. ') + '.',
      value: +c.toFixed(4),
    }));
  } else {
    costBars = dailyEntries.map(([date, c]) => ({ label: date.slice(5).replace('-', '/'), full: date, value: +c.toFixed(4) }));
  }
  const PERIODS = [[7, '7일'], [14, '14일'], [30, '30일'], ['month', '월별']];
  return (
    <>
      {/* 기간 세그먼트(활성=시그니처 보라) */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2.5 }}>
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
          extra={(x) => x.byPipe && (
            <PipeSplit rows={[
              ['실시간 번역', x.byPipe.live, (v) => `${fmtCost(v.costUsd)} · ${fmtMin(v.audioMs / 60000)}`],
              ['안내데스크', x.byPipe.desk, (v) => `${fmtCost(v.costUsd)} · ${fmtMin(v.audioMs / 60000)}`],
              ['(미태깅·과거)', x.byPipe.etc, (v) => `${fmtCost(v.costUsd)} · ${fmtMin(v.audioMs / 60000)}`],
            ]} />
          )} />
        <VendorCard brand={brand} name="Cartesia" desc="음성 합성(TTS)" v={v('cartesia')} keyHint="CARTESIA_ADMIN_API_KEY (sk_car_admin_…)"
          totalOf={(x) => `${(x.totalCredits || 0).toLocaleString()} 크레딧`}
          subOf={(x) => `일평균 ${Math.round((x.totalCredits || 0) / Math.max(1, (x.days || []).length)).toLocaleString()} 크레딧`}
          valueOf={(d) => d.credits} valFmt={(c) => `${(c || 0).toLocaleString()} 크레딧`}
          extra={(x) => x.byPipe && (x.byPipe.desk.req + x.byPipe.live.req > 0) && (
            <PipeSplit note="자체 집계(합성 문자수)" rows={[
              ['실시간 번역', x.byPipe.live, (v) => `${v.req}회 · ${v.chars.toLocaleString()}자`],
              ['안내데스크', x.byPipe.desk, (v) => `${v.req}회 · ${v.chars.toLocaleString()}자`],
            ]} />
          )} />
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
      {/* 유저별 사용량 — 벤더 카드에서 분리(④) */}
      {!(data && data.error) && <UserUsagePanel users={(v('soniox') || {}).users} />}
    </>
  );
}

export default VendorUsage;
