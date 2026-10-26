/* 글자 로고 'airtalk.' — Nunito 900 소문자 + 보라 마침표(2026-10-26 로고 시안 B). 홈 제목·입장(로딩) 화면.
   안드로이드 앱 시작 화면은 같은 모양을 그림으로 넣었다(android/.../drawable-nodpi/splash_wordmark.png). */
import React from 'react';
import Box from '@mui/material/Box';
import { BRAND } from '../brand.js';

export default function Wordmark({ size = 23, sx }) {
  return (
    <Box component="span" aria-label="AirTalk" sx={{ fontFamily: "'Nunito', 'Pretendard', system-ui, sans-serif", fontWeight: 900, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1, color: '#1F1E1D', ...sx }}>
      airtalk<Box component="span" sx={{ color: BRAND }}>.</Box>
    </Box>
  );
}

// 입장(로딩) 화면 — 흰 바탕 가운데 로고만
export function WordmarkSplash() {
  return (
    <Box sx={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: '#fff' }}>
      <Wordmark size={44} />
    </Box>
  );
}
