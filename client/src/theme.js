import { createTheme, alpha } from '@mui/material/styles';

// 액센트: 보라 (Aurora) — 다크 #7c6df2 / 라이트 #6d5ef0
export const ACCENT = { dark: '#7c6df2', light: '#6d5ef0' };
// 그라데이션(로고·버튼·아바타) 보조 스톱
export const GRAD = {
  dark: ['#8b7cff', '#6354e0'],
  light: ['#8b7cff', '#6d5ef0'],
};

export function buildTheme(mode) {
  const dark = mode === 'dark';
  const primary = dark ? ACCENT.dark : ACCENT.light;
  const bgDefault = dark ? '#0e0f15' : '#f4f5f9';
  const bgPaper = dark ? '#191c27' : '#ffffff';
  const divider = dark ? 'rgba(255,255,255,0.07)' : 'rgba(18,22,45,0.09)';

  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      success: { main: '#34d399' },
      error: { main: dark ? '#fb7185' : '#f43f5e' },
      warning: { main: '#fbbf24' },
      divider,
      background: { default: bgDefault, paper: bgPaper },
      // 명도 상향(가독성): 본문/보조 대비 강화
      text: dark
        ? { primary: '#f3f4f8', secondary: '#a3a9bb' }
        : { primary: '#161922', secondary: '#5b6175' },
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, 'Segoe UI', sans-serif",
      h5: { fontWeight: 800, letterSpacing: '-0.02em' },
      h6: { fontWeight: 800, letterSpacing: '-0.02em' },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 700 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { backgroundColor: bgDefault },
          '*::-webkit-scrollbar': { width: 10, height: 10 },
          '*::-webkit-scrollbar-thumb': {
            background: alpha(dark ? '#fff' : '#000', 0.14),
            borderRadius: 8,
            border: '2px solid transparent',
            backgroundClip: 'padding-box',
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: { textTransform: 'none', borderRadius: 12, paddingInline: 16 },
          containedPrimary: {
            background: `linear-gradient(135deg, ${GRAD[mode][0]}, ${GRAD[mode][1]})`,
            boxShadow: `0 8px 22px ${alpha(primary, 0.38)}`,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 14,
            border: `1px solid ${divider}`,
            backgroundImage: 'none',
            transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
          },
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 12, border: `1px solid ${divider}`, marginTop: 6 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 9, fontSize: 12, fontWeight: 600, paddingBlock: 7, paddingInline: 11, maxWidth: 260, lineHeight: 1.5 },
        },
      },
      MuiChip: { styleOverrides: { root: { fontWeight: 700 } } },
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
