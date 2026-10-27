// 관리자 화면 공용: 빈 상태 안내
import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';

// 빈 상태 안내(아이콘+제목+설명) — 텅 빈 회색 문구 대신 다음 행동을 알려준다
export function EmptyHint({ icon, title, desc }) {
  return (
    <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
      <Box sx={{ display: 'grid', placeItems: 'center', width: 44, height: 44, mx: 'auto', mb: 1.25, borderRadius: '50%', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }}>{icon}</Box>
      <Typography sx={{ fontSize: 14.5, fontWeight: 800, color: 'text.primary' }}>{title}</Typography>
      <Typography sx={{ fontSize: 12.5, mt: 0.5 }}>{desc}</Typography>
    </Box>
  );
}
