/* 글자 로고 'airtalk.' — Nunito 900 소문자 + 보라 마침표·보라 i 점(2026-10-27). 폰 홈·PC 위 띠·로그인·앱 다운로드 화면.
   i 점: 글꼴의 i 점은 마침표보다 납작해(높이 0.17em vs 0.19em) 보라로 칠하면 아래가 잘린 것처럼 보인다 →
   점 없는 ı(검정) 위에 보라 마침표를 올려 둥근 점을 만든다. 위치는 글꼴 실측값(i 점 중심 = 기준선 위 0.659em, 마침표 중심 0.0925em).
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
        <Box component="span" sx={{ gridArea: '1 / 1', color: BRAND, transform: 'translate(0.005em, -0.566em)' }}>.</Box>
      </Box>
      rtalk<Box component="span" sx={{ color: BRAND }}>.</Box>
    </Box>
  );
}
