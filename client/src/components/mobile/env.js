// 안드로이드 앱(네이티브 브리지)에서 열렸는지 — 폰 전용 화면(MobileApp)으로 전환하는 기준.
// ?mobileui=1 / localStorage 'kac-mobile-ui'=1 은 브라우저에서 폰 화면을 확인하는 개발용.
// (App 의 첫 번들에 포함되므로 MUI 를 끌어오지 않게 별도 파일로 둔다)
export const MOBILE_UI = typeof window !== 'undefined' && (
  !!window.AndroidAudio
  || /[?&]mobileui=1(&|$)/.test(window.location.search)
  || (() => { try { return localStorage.getItem('kac-mobile-ui') === '1'; } catch { return false; } })()
);

// 휴대폰 브라우저(앱 아님) — 폰은 앱으로만 쓰므로 로그인 대신 앱 설치 화면을 띄운다(2026-10-21).
// 안드로이드 태블릿(UA 에 Mobile 없음)·iPad(데스크톱 UA)·?mobileui=1 개발 확인은 제외.
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
export const IS_IPHONE = /iPhone|iPod/i.test(UA);
export const PHONE_BROWSER = typeof window !== 'undefined' && !window.AndroidAudio
  && (/Android.+Mobile/i.test(UA) || IS_IPHONE)
  && !/[?&]mobileui=1(&|$)/.test(window.location.search);
