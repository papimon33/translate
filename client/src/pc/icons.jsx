// PC 화면 아이콘 — 얇은 스트로크 아웃라인(명령 팔레트·세션 목록)
import React from 'react';
import Box from '@mui/material/Box';

const strokeProps = { component: 'svg', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
export function IcoGlobe(props) { // 실시간 번역: 지구본(언어)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.8 2.5 2.8 14.5 0 17M12 3.5c-2.8 2.5-2.8 14.5 0 17" />
    </Box>
  );
}
export function IcoHeadset(props) { // 안내데스크: 헤드셋(대면 상담)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <path d="M4.5 13.5v-2a7.5 7.5 0 0 1 15 0v2" />
      <rect x="3.5" y="12.5" width="4" height="6" rx="2" />
      <rect x="16.5" y="12.5" width="4" height="6" rx="2" />
      <path d="M19.5 18.5v.7a2.8 2.8 0 0 1-2.8 2.8H14" />
    </Box>
  );
}
export function IcoSliders(props) { // 관리자: 조절 슬라이더(운영 설정)
  return (
    <Box {...strokeProps} sx={{ width: 19, height: 19, flex: 'none', ...props.sx }}>
      <path d="M4 7.5h4.5M12.5 7.5H20M4 16.5h7.5M15.5 16.5H20" />
      <circle cx="10.5" cy="7.5" r="2" />
      <circle cx="13.5" cy="16.5" r="2" />
    </Box>
  );
}
