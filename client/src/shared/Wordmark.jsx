/* 글자 로고 'airtalk.' — Nunito 900 소문자 + 보라 마침표(2026-10-26 로고 시안 B). 폰 홈 제목·로그인·앱 다운로드 화면.
   안드로이드 앱 시작 화면은 같은 모양의 그림(android/.../drawable-nodpi/splash_wordmark.png)이고, 웹이 첫 화면을 다 그리면 닫힌다(env.js appReady). */
import React from 'react';
import Box from '@mui/material/Box';
import { BRAND } from './brand.js';

export default function Wordmark({ size = 23, sx }) {
  return (
    <Box component="span" aria-label="AirTalk" sx={{ fontFamily: "'Nunito', 'Pretendard', system-ui, sans-serif", fontWeight: 900, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1, color: '#1F1E1D', ...sx }}>
      airtalk<Box component="span" sx={{ color: BRAND }}>.</Box>
    </Box>
  );
}
