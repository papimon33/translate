import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// 브라우저 오류를 서버로 보고(관리자 > 시스템·보안에서 확인) — 5초 스로틀
let __lastErrAt = 0;
function reportClientError(msg, src) {
  const t = Date.now();
  if (t - __lastErrAt < 5000) return;
  __lastErrAt = t;
  // fetch 자체의 실패는 삼킨다(.catch) — 서버 불통 시 보고 실패가 다시 오류 이벤트를 만들어 무한 루프가 되던 문제 방지
  try {
    fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: String(msg || ''), src: String(src || '') }) }).catch(() => {});
  } catch {}
}
window.addEventListener('error', (e) => reportClientError(e.message, (e.filename || '') + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', (e) => reportClientError((e.reason && e.reason.message) || String(e.reason), 'promise'));

createRoot(document.getElementById('root')).render(<App />);
