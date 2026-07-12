import { createTheme, alpha } from '@mui/material/styles';

/* ---- 디자인 토큰 (Slack 계열: 플랫·크리스프·다크 사이드바) ----
   - 포인트 컬러는 바이올렛 유지하되 그라데이션·글로우 제거(플랫).
   - 사이드바는 라이트/다크 공통의 딥 바이올렛 차콜 — 콘텐츠 영역과 확실히 분리.
   - radius 체계: shape 8 기준(sx borderRadius:1=8px, 1.5=12px). */
export const ACCENT = { dark: '#8579ff', light: '#5b4fe8' };
// (구) 그라데이션 스톱 — 아바타 등 일부 장식에만 사용
export const GRAD = {
  dark: ['#8579ff', '#6354e0'],
  light: ['#7c6df2', '#5b4fe8'],
};
// 사이드바 토큰 — Nav 에서 사용. Claude 앱과 동일 톤: 라이트=거의 백색(#FAF9F5, 콘텐츠보다 밝게), 다크=#1F1E1D(콘텐츠보다 어둡게).
export const SIDEBAR = {
  light: {
    bg: '#faf9f5',
    text: 'rgba(31,30,29,0.85)',
    textStrong: '#1f1e1d',
    muted: 'rgba(31,30,29,0.52)',
    hover: 'rgba(31,30,29,0.06)',
    active: 'rgba(31,30,29,0.10)',
    border: 'rgba(31,30,29,0.10)',
  },
  dark: {
    bg: '#1f1e1d',
    text: 'rgba(250,249,245,0.85)',
    textStrong: '#faf9f5',
    muted: 'rgba(250,249,245,0.52)',
    hover: 'rgba(250,249,245,0.07)',
    active: 'rgba(250,249,245,0.12)',
    border: 'rgba(250,249,245,0.09)',
  },
};

export function buildTheme(mode) {
  const dark = mode === 'dark';
  const primary = dark ? ACCENT.dark : ACCENT.light;
  // Claude 앱 팔레트와 동일(웜 뉴트럴). 라이트: 콘텐츠 캔버스 #F5F4EE(사이드바보다 살짝 어둡게), 카드 #FFF. 다크: #262624/#30302E.
  const bgDefault = dark ? '#262624' : '#f5f4ee';
  const bgPaper = dark ? '#30302e' : '#ffffff';
  const divider = dark ? 'rgba(250,249,245,0.10)' : 'rgba(31,30,29,0.12)';
  const textPrimary = dark ? '#faf9f5' : '#1f1e1d';
  const textSecondary = dark ? '#b3b1a9' : '#6b6a63';

  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      success: { main: dark ? '#2eb67d' : '#007a5a' }, // Slack 그린 계열
      error: { main: dark ? '#f47c7c' : '#e01e5a' },
      warning: { main: dark ? '#e8a03e' : '#e8912d' },
      divider,
      background: { default: bgDefault, paper: bgPaper },
      text: { primary: textPrimary, secondary: textSecondary },
    },
    shape: { borderRadius: 8 },
    typography: {
      fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, 'Segoe UI', sans-serif",
      fontSize: 14,
      h5: { fontWeight: 800, letterSpacing: '-0.02em' },
      h6: { fontWeight: 800, letterSpacing: '-0.015em', fontSize: 18 },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 700, letterSpacing: 0 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: bgDefault },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            background: alpha(dark ? '#fff' : '#000', 0.16),
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'padding-box',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 8, paddingInline: 14 },
          containedPrimary: {
            backgroundColor: primary,
            boxShadow: 'none',
            '&:hover': { backgroundColor: dark ? '#948aff' : '#4a3fd4', boxShadow: 'none' },
          },
          outlined: { borderColor: divider, '&:hover': { borderColor: alpha(textPrimary, 0.3), backgroundColor: alpha(textPrimary, 0.03) } },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: { borderRadius: 12, border: `1px solid ${divider}`, backgroundImage: 'none', boxShadow: 'none' },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: { backgroundImage: 'none' },
          outlined: { borderColor: divider },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: alpha(textPrimary, 0.3) },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderWidth: 1.5 },
          },
        },
      },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 10, border: `1px solid ${divider}`, marginTop: 6, boxShadow: dark ? '0 8px 24px rgba(0,0,0,0.5)' : '0 8px 24px rgba(29,28,29,0.12)' } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 14, border: `1px solid ${divider}` } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8, fontSize: 12.5, fontWeight: 500, paddingBlock: 7, paddingInline: 11, maxWidth: 300, lineHeight: 1.55,
            backgroundColor: dark ? '#2e2c36' : '#1d1c1d', color: '#fff',
          },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 6 } } },
      MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 700 } } },
      MuiToggleButton: { styleOverrides: { root: { textTransform: 'none', borderRadius: 8 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiTableCell: { styleOverrides: { root: { borderColor: divider } } },
    },
  });
}

export const LANGS = [
  { code: 'auto', label: '자동 감지' },
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Indonesia' },
];
export const OUT_LANGS = LANGS.filter((l) => l.code !== 'auto');
// whisper 다중 출력 선택용
export const MULTI_LANGS = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];
export const LANG_LABEL = Object.fromEntries(LANGS.map((l) => [l.code, l.label]));
