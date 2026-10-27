/* 글자 로고 'airtalk.' — Nunito 900 소문자 + 보라 마침표·보라 i 점(2026-10-27). 폰 홈·PC 위 띠·로그인·앱 다운로드 화면.
   i 점: 점 없는 ı(검정) 위에 같은 자리의 i(보라)를 겹치고 점만 남게 아래를 잘라 낸다 — 글꼴의 점 모양을 그대로 쓴다.
   자르는 위치 0.74em = 줄 높이 1 기준, 줄기 끝(기준선 위 0.505em)과 점 아래(0.57em) 사이.
   안드로이드 앱 시작 화면은 같은 모양의 그림(android/.../drawable-nodpi/splash_wordmark.png)이고, 웹이 첫 화면을 다 그리면 닫힌다(env.js appReady). */
import React from 'react';
import Box from '@mui/material/Box';
import { BRAND } from './brand.js';

export default function Wordmark({ size = 23, sx }) {
  return (
    <Box component="span" role="img" aria-label="AirTalk" sx={{ fontFamily: "'Nunito', 'Pretendard', system-ui, sans-serif", fontWeight: 900, fontSize: size, letterSpacing: '-0.02em', lineHeight: 1, color: '#1F1E1D', userSelect: 'none', ...sx }}>
      a
      <Box component="span" sx={{ display: 'inline-grid' }}>
        <Box component="span" sx={{ gridArea: '1 / 1' }}>ı</Box>
        <Box component="span" sx={{ gridArea: '1 / 1', color: BRAND, clipPath: 'inset(0 0 0.74em 0)' }}>i</Box>
      </Box>
      rtalk<Box component="span" sx={{ color: BRAND }}>.</Box>
    </Box>
  );
}
