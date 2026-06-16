import { createTheme, alpha } from '@mui/material/styles';

export function buildTheme(mode) {
  const dark = mode === 'dark';
  const primary = dark ? '#7c9cff' : '#4f46e5';
  const bgDefault = dark ? '#0b0d12' : '#f6f7f9';
  const bgPaper = dark ? '#14171f' : '#ffffff';
  const divider = dark ? 'rgba(255,255,255,0.09)' : 'rgba(15,23,42,0.08)';

  return createTheme({
    palette: {
      mode,
      primary: { main: primary },
      success: { main: '#34d399' },
      error: { main: dark ? '#fb7185' : '#f43f5e' },
      warning: { main: '#fbbf24' },
      divider,
      background: { default: bgDefault, paper: bgPaper },
      text: dark
        ? { primary: '#e8eaf0', secondary: '#9aa3b2' }
        : { primary: '#0f172a', secondary: '#64748b' },
    },
    shape: { borderRadius: 14 },
    typography: {
      fontFamily: "'Noto Sans KR', system-ui, 'Segoe UI', sans-serif",
      h6: { fontWeight: 800, letterSpacing: '-0.01em' },
      subtitle1: { fontWeight: 700 },
      subtitle2: { fontWeight: 700 },
      button: { fontWeight: 700 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundImage: dark
              ? `radial-gradient(1200px 600px at 100% -10%, ${alpha(primary, 0.10)}, transparent 60%)`
              : `radial-gradient(1200px 600px at 100% -10%, ${alpha(primary, 0.07)}, transparent 60%)`,
            backgroundAttachment: 'fixed',
          },
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
          root: { textTransform: 'none', borderRadius: 10, paddingInline: 16 },
          containedPrimary: {
            background: `linear-gradient(135deg, ${primary}, ${dark ? '#9b87ff' : '#6366f1'})`,
            boxShadow: `0 6px 18px ${alpha(primary, 0.35)}`,
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            border: `1px solid ${divider}`,
            backgroundImage: 'none',
            transition: 'transform .15s ease, box-shadow .15s ease, border-color .15s ease',
          },
        },
      },
      MuiOutlinedInput: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiMenu: { styleOverrides: { paper: { borderRadius: 14, border: `1px solid ${divider}`, marginTop: 6 } } },
      MuiDialog: { styleOverrides: { paper: { borderRadius: 20 } } },
      MuiTooltip: {
        styleOverrides: {
          tooltip: { borderRadius: 8, fontSize: 12, fontWeight: 600, paddingBlock: 6, paddingInline: 10 },
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
