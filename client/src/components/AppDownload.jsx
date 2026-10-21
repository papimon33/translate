/* 휴대폰 브라우저로 접속하면 로그인 대신 이 화면 — 폰은 AirTalk 앱으로만 쓴다(2026-10-21).
   iPhone 은 아직 앱이 없어 웹으로 계속할 수 있게 둔다. */
import React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { BRAND, BRAND_DARK } from './Login.jsx';

export default function AppDownload({ iphone, onContinueWeb }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', px: 3, gap: 1.25, bgcolor: (t) => (t.palette.mode === 'dark' ? t.palette.background.default : '#fff') }}>
      <Box component="img" src="/favicon.svg" alt="" sx={{ width: 64, height: 64, borderRadius: 2, mb: 1 }} />
      <Typography component="h1" sx={{ fontWeight: 800, fontSize: 26, letterSpacing: '-0.02em' }}>AirTalk</Typography>
      <Typography sx={{ fontSize: 15, color: 'text.secondary', textAlign: 'center', wordBreak: 'keep-all', mb: 2 }}>
        {iphone ? 'iPhone 앱은 준비 중입니다.' : '휴대폰에서는 AirTalk 앱으로 사용합니다.'}
      </Typography>
      {iphone ? (
        <Button variant="contained" size="large" onClick={onContinueWeb} disableElevation
          sx={{ width: '100%', maxWidth: 340, height: 54, borderRadius: '14px', fontSize: 16, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DARK } }}>
          웹으로 계속
        </Button>
      ) : (
        <>
          <Button variant="contained" size="large" href="/download/android" disableElevation
            sx={{ width: '100%', maxWidth: 340, height: 54, borderRadius: '14px', fontSize: 16, fontWeight: 700, bgcolor: BRAND, '&:hover': { bgcolor: BRAND_DARK } }}>
            앱 다운로드
          </Button>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', textAlign: 'center', wordBreak: 'keep-all', maxWidth: 340, mt: 0.5 }}>
            받은 파일을 열어 설치하세요. 처음 한 번은 '알 수 없는 앱 설치'를 허용해야 할 수 있습니다.
          </Typography>
        </>
      )}
    </Box>
  );
}
