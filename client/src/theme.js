import { createTheme, alpha } from '@mui/material/styles';

/* ---- 디자인 토큰 (Claude 앱 계열: 웜 뉴트럴, 플랫) ----
   - 보라(바이올렛)는 로고(favicon.svg)에만 남기고 UI 는 전부 뉴트럴 —
     주 버튼은 라이트=거의 검정(#1F1E1D 바탕·백색 글자), 다크=거의 백색(#FAF9F5 바탕·검정 글자).
   - radius 체계: shape 8 기준(sx borderRadius:1=8px, 1.5=12px). */
// 시그니처 보라(favicon.svg 와 동일 계열) — 로고 + 관리자 데이터 시각화(그래프·강조 수치)와
// nav 관리자 활성 하위메뉴에만 사용. 일반 버튼·본문에는 쓰지 않는다.
export const ACCENT = { dark: '#8579ff', light: '#5b4fe8' };
// ---- 라운딩 표준 (sx borderRadius 단위: 1 = 8px) ----
// panel: 카드·검색창·다이얼로그 내부 패널(12px) / control: 버튼·셀렉트류(theme shape 기본 8px 사용)
// row: 목록 행 hover 배경(16px) / pill: 완전 원형. 새 UI 는 이 토큰만 사용할 것.
export const RADIUS = { panel: 1.5, control: 1, row: 2, pill: 999 };
// 사이드바 토큰 — Nav 에서 사용. nav 는 항상 콘텐츠보다 밝게:
// 라이트=거의 백색(#FAF9F5) / 캔버스 #F5F4EE, 다크=#262624 / 캔버스 #1F1E1D.
export const SIDEBAR = {
  light: {
    bg: '#ffffff',
    text: 'rgba(31,30,29,0.85)',
    textStrong: '#1f1e1d',
    muted: 'rgba(31,30,29,0.52)',
    hover: 'rgba(31,30,29,0.06)',
    active: 'rgba(31,30,29,0.10)',
    border: 'rgba(31,30,29,0.10)',
  },
  dark: {
    bg: '#262624',
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
  // 주 색상 = 뉴트럴 반전(Claude 버튼과 동일): 라이트=거의 검정 버튼, 다크=거의 백색 버튼.
  const primary = dark ? '#faf9f5' : '#1f1e1d';
  const primaryContrast = dark ? '#1f1e1d' : '#ffffff';
  // Claude 앱 팔레트(웜 뉴트럴). nav 가 캔버스보다 항상 밝다:
  // 라이트 캔버스 #FAFAF8(거의 흰색)·카드/nav #FFF, 다크 캔버스 #1F1E1D·카드 #30302E(nav #262624).
  const bgDefault = dark ? '#1f1e1d' : '#fafaf8';
  const bgPaper = dark ? '#30302e' : '#ffffff';
  const divider = dark ? 'rgba(250,249,245,0.10)' : 'rgba(31,30,29,0.12)';
  const textPrimary = dark ? '#faf9f5' : '#1f1e1d';
  const textSecondary = dark ? '#b3b1a9' : '#6b6a63';

  return createTheme({
    palette: {
      mode,
      primary: { main: primary, contrastText: primaryContrast },
      success: { main: dark ? '#2eb67d' : '#007a5a' }, // Slack 그린 계열
      error: { main: dark ? '#f47c7c' : '#e01e5a' },
      warning: { main: dark ? '#e8a03e' : '#e8912d' },
      // 발화자 구분 전용 액센트(게스트/언어1 발화) — primary 가 뉴트럴이라 텍스트색과 구분되지 않던 문제
      accent: { main: dark ? '#84b5ff' : '#2e6fd8' },
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
      button: { fontWeight: 700, letterSpacing: 0, fontSize: 14 },
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
          // 버튼 폰트는 크기(size) 무관 14 고정
          root: { textTransform: 'none', borderRadius: 8, paddingInline: 14, fontSize: 14 },
          containedPrimary: {
            backgroundColor: primary,
            color: primaryContrast,
            boxShadow: 'none',
            '&:hover': { backgroundColor: dark ? '#e8e6df' : '#3d3b38', boxShadow: 'none' },
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
