import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';

// 브라우저 오류를 서버로 보고(관리자 > 시스템·보안에서 확인) — 5초 스로틀
let __lastErrAt = 0;
function reportClientError(msg, src) {
  const t = Date.now();
  if (t - __lastErrAt < 5000) return;
  __lastErrAt = t;
  try { fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: String(msg || ''), src: String(src || '') }) }); } catch {}
}
window.addEventListener('error', (e) => reportClientError(e.message, (e.filename || '') + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', (e) => reportClientError((e.reason && e.reason.message) || String(e.reason), 'promise'));

createRoot(document.getElementById('root')).render(<App />);
