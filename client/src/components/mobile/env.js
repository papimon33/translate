// 안드로이드 앱(네이티브 브리지)에서 열렸는지 — 폰 전용 화면(MobileApp)으로 전환하는 기준.
// ?mobileui=1 / localStorage 'kac-mobile-ui'=1 은 브라우저에서 폰 화면을 확인하는 개발용.
// (App 의 첫 번들에 포함되므로 MUI 를 끌어오지 않게 별도 파일로 둔다)
export const MOBILE_UI = typeof window !== 'undefined' && (
  !!window.AndroidAudio
  || /[?&]mobileui=1(&|$)/.test(window.location.search)
  || (() => { try { return localStorage.getItem('kac-mobile-ui') === '1'; } catch { return false; } })()
);
