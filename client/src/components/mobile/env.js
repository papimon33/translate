// 폰 전용 화면(MobileApp)으로 전환하는 기준 — 안드로이드 앱(네이티브 브리지) 또는 휴대폰 브라우저.
// ?mobileui=1 / localStorage 'kac-mobile-ui'=1 은 PC 브라우저에서 폰 화면을 확인하는 개발용.
// (App 의 첫 번들에 포함되므로 MUI 를 끌어오지 않게 별도 파일로 둔다)
const UA = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
export const IS_IPHONE = /iPhone|iPod/i.test(UA);

// 휴대폰 브라우저(앱 아님). 안드로이드 폰은 앱으로만 쓰므로 로그인 대신 앱 설치 화면을 띄우고(2026-10-21),
// iPhone 은 앱이 없어 '웹으로 계속'을 누르면 앱과 같은 폰 화면을 쓴다(2026-10-26).
// 안드로이드 태블릿(UA 에 Mobile 없음)·iPad(데스크톱 UA)·?mobileui=1 개발 확인은 제외.
export const PHONE_BROWSER = typeof window !== 'undefined' && !window.AndroidAudio
  && (/Android.+Mobile/i.test(UA) || IS_IPHONE)
  && !/[?&]mobileui=1(&|$)/.test(window.location.search);

// 안드로이드 앱: 웹 첫 화면(로그인·홈)을 다 그렸으면 앱 시작 화면을 닫게 알린다(페이지당 1번). 그리기가 끝난 다음 프레임에 보낸다.
let readySent = false;
export function appReady() {
  if (readySent || typeof window === 'undefined' || !window.AndroidApp) return;
  readySent = true;
  requestAnimationFrame(() => requestAnimationFrame(() => { try { window.AndroidApp.ready(); } catch {} }));
}

export const MOBILE_UI = typeof window !== 'undefined' && (
  !!window.AndroidAudio
  || PHONE_BROWSER
  || /[?&]mobileui=1(&|$)/.test(window.location.search)
  || (() => { try { return localStorage.getItem('kac-mobile-ui') === '1'; } catch { return false; } })()
);
