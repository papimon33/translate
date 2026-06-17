import React, { useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import CircularProgress from '@mui/material/CircularProgress';
import SearchIcon from '@mui/icons-material/Search';
import { api } from '../api.js';

const RENDER_CAP = 2000; // 한 번에 그리는 최대 행(성능). 초과 시 검색 유도.

export default function GlossaryPage() {
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState(''); // 디바운스된 검색어

  useEffect(() => {
    api.glossaryList().then(setRows).catch(() => setRows([]));
  }, []);
  // 타이핑마다 검색하되 약간의 딜레이(250ms)로 과도한 연산 방지
  useEffect(() => {
    const t = setTimeout(() => setDq(q.trim().toLowerCase()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (!dq) return rows;
    return rows.filter((r) => (r.ko + ' ' + r.en + ' ' + r.meaning).toLowerCase().includes(dq));
  }, [rows, dq]);

  const shown = filtered.slice(0, RENDER_CAP);
  const overflowed = filtered.length - shown.length;

  return (
    <>
      <Box sx={{ px: { xs: 2, sm: 4 }, py: 2.5, borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
        <Typography variant="h6">용어집</Typography>
        {rows && (
          <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
            {dq ? `${filtered.length.toLocaleString('en-US')} / ` : ''}
            {rows.length.toLocaleString('en-US')}개
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, p: { xs: 2, sm: 4 }, display: 'flex' }}>
        <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, borderRadius: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* 영역 우상단 검색창 (영역 폭의 약 1/3) */}
          <Box sx={{ p: 1.25, borderBottom: 1, borderColor: 'divider', display: 'flex', justifyContent: 'flex-end' }}>
            <TextField
              size="small"
              placeholder="검색 (한글·영문·뜻)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
              sx={{ width: '33%', minWidth: 200 }}
            />
          </Box>

          {/* 고정 영역 내부 스크롤 */}
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            {!rows ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8, gap: 1, color: 'text.secondary' }}>
                <CircularProgress size={18} /> <Typography sx={{ fontSize: 14 }}>불러오는 중…</Typography>
              </Box>
            ) : rows.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary', fontSize: 14 }}>
                등록된 용어가 없습니다. (관리자 페이지에서 CSV 업로드)
              </Box>
            ) : filtered.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary', fontSize: 14 }}>‘{q}’ 검색 결과가 없습니다.</Box>
            ) : (
              <Box
                component="table"
                sx={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  tableLayout: 'fixed',
                  '& th': {
                    position: 'sticky', top: 0, zIndex: 1,
                    textAlign: 'left', fontWeight: 800, fontSize: 12.5, color: 'text.secondary',
                    px: 2, py: 1.1, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider',
                  },
                  '& td': { px: 2, py: 1.1, borderBottom: 1, borderColor: 'divider', verticalAlign: 'top', fontSize: 14, wordBreak: 'keep-all' },
                  '& td:nth-of-type(1)': { fontWeight: 700 },
                  '& td:nth-of-type(2)': { color: 'text.secondary' },
                  '& td:nth-of-type(3)': { color: 'text.primary', lineHeight: 1.55 },
                  '& tbody tr:hover': { bgcolor: 'action.hover' },
                }}
              >
                <thead>
                  <tr>
                    <th style={{ width: '20%' }}>한글</th>
                    <th style={{ width: '22%' }}>영문</th>
                    <th style={{ width: '58%' }}>뜻</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>
                      <td>{r.ko}</td>
                      <td>{r.en}</td>
                      <td>{r.meaning}</td>
                    </tr>
                  ))}
                </tbody>
              </Box>
            )}
            {overflowed > 0 && (
              <Box sx={{ textAlign: 'center', py: 1.5, color: 'text.disabled', fontSize: 12 }}>
                {RENDER_CAP.toLocaleString('en-US')}개만 표시 중 · {overflowed.toLocaleString('en-US')}개 더 있음 — 검색으로 좁혀보세요.
              </Box>
            )}
          </Box>
        </Paper>
      </Box>
    </>
  );
}
