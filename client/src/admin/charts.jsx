import React from 'react';
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme, alpha } from '@mui/material/styles';

/* 관리자 대시보드 공용 차트(recharts) — 시그니처 보라, 다크 모드 자동 대응.
   모든 데이터 행은 { label(축), full(툴팁 제목), value } 형태.
   value 포맷은 formatValue(v) 로 주입(비용 $, 크레딧, 건, 분 등). */

function ChartTooltip({ active, payload, formatValue }) {
  const theme = useTheme();
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload || {};
  const dark = theme.palette.mode === 'dark';
  return (
    <Box sx={{
      bgcolor: dark ? '#2e2c36' : '#1d1c1d', color: '#fff', borderRadius: 1.5,
      px: 1.25, py: 0.75, boxShadow: '0 6px 20px rgba(0,0,0,0.28)', minWidth: 110,
    }}>
      <Typography sx={{ fontSize: 11.5, opacity: 0.72, mb: 0.25 }}>{row.full ?? row.label}</Typography>
      <Typography sx={{ fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
        {formatValue ? formatValue(payload[0].value, row) : payload[0].value}
      </Typography>
    </Box>
  );
}

// 벤더 카드용 소형 면적 스파크라인(축 없음, 호버 툴팁)
export function Sparkline({ data, brand, formatValue }) {
  const id = 'spark-grad-' + React.useId().replace(/[:]/g, '');
  return (
    <Box sx={{ height: 44, mt: 1, mx: -0.5 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={brand} stopOpacity={0.28} />
              <stop offset="100%" stopColor={brand} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ stroke: brand, strokeOpacity: 0.4, strokeDasharray: '3 3' }} />
          <Area type="monotone" dataKey="value" stroke={brand} strokeWidth={2} fill={`url(#${id})`} isAnimationActive={false}
            dot={false} activeDot={{ r: 3, fill: brand, strokeWidth: 0 }} />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}

// 막대 추이(비용·응대·시간대) — 라운드 탑, 마지막 막대 강조, 호버 툴팁
export function BarTrend({ data, brand, height = 210, formatValue, barSize = 30, tickEvery = 1, emphasizeLast = false }) {
  const theme = useTheme();
  const divider = theme.palette.divider;
  const tickFill = theme.palette.text.secondary;
  return (
    <Box sx={{ height, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={divider} strokeOpacity={0.5} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tickFill }} axisLine={false} tickLine={false}
            interval={tickEvery - 1} minTickGap={4} />
          <YAxis width={38} tick={{ fontSize: 10.5, fill: tickFill }} axisLine={false} tickLine={false}
            tickFormatter={(v) => (formatValue ? formatValue(v, {}, true) : v)} />
          <Tooltip content={<ChartTooltip formatValue={formatValue} />} cursor={{ fill: alpha(brand, 0.1) }} />
          <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={barSize} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={brand}
                fillOpacity={emphasizeLast ? (i === data.length - 1 ? 1 : d.value ? 0.5 : 0.16) : (d.value ? 0.9 : 0.16)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  );
}
