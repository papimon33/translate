/* 뷰어(공개) 진입: 데스크 뷰어 자산(2.5D 맵·PWA manifest) / 참여 코드 페이지(/j·/desk·/overlay)·JSON·예전 주소 리다이렉트·QR */
import fs from 'fs';
import path from 'path';
import QRCode from 'qrcode';
import { PORT, STATIC_DIR } from '../config.js';
import { getSession, ensureJoinCode, sessionByJoinCode } from '../store/sessions.js';
import { loginIp, viewerToken, viewerTokenValid, viewerAccessOk } from '../auth/index.js';
import { getLanIp } from '../util/net_util.js';

const joinMisses = new Map(); // ip -> { n, at } — 틀린 코드 10분에 20번 넘으면 잠시 차단
function joinBlocked(ip) {
  const m = joinMisses.get(ip);
  if (!m) return false;
  if (Date.now() - m.at > 10 * 60 * 1000) { joinMisses.delete(ip); return false; }
  return m.n >= 20;
}
function joinMiss(ip) {
  const m = joinMisses.get(ip);
  if (!m || Date.now() - m.at > 10 * 60 * 1000) joinMisses.set(ip, { n: 1, at: Date.now() });
  else m.n++;
}
// 뷰어 페이지(빌드 산출물 dist/viewer/*.html)에 이 세션 정보를 심어 보낸다 — 페이지는 window.__JOIN 을 읽는다
const viewerHtmlCache = new Map();
function sendViewerPage(res, file, join) {
  let html = viewerHtmlCache.get(file);
  if (!html) {
    try { html = fs.readFileSync(path.join(STATIC_DIR, 'viewer', file), 'utf8'); } catch { return res.status(404).send('viewer page missing — run npm run build'); }
    if (process.env.NODE_ENV === 'production') viewerHtmlCache.set(file, html);
  }
  const inject = `<script>window.__JOIN=${JSON.stringify(join || {}).replace(/</g, '\\u003c')};</script>`;
  res.setHeader('Cache-Control', 'no-store');
  res.type('html').send(html.replace('</head>', inject + '</head>'));
}
function joinPage(req, res, desk) {
  const code = req.params.code;
  if (!code) return sendViewerPage(res, desk ? 'desk.html' : 'join.html', {});
  const ip = loginIp(req);
  if (joinBlocked(ip)) return sendViewerPage(res, desk ? 'desk.html' : 'join.html', { notFound: true, blocked: true, code: String(code).slice(0, 6) });
  const s = sessionByJoinCode(code);
  if (!s) { joinMiss(ip); return sendViewerPage(res, desk ? 'desk.html' : 'join.html', { notFound: true, code: String(code).slice(0, 6) }); }
  const isDesk = s.pipeline === 'desk';
  if (isDesk !== !!desk) return res.redirect(302, (isDesk ? '/desk/' : '/j/') + s.joinCode); // 안내데스크는 /desk(앱이 손님 태블릿 모드로 연다)
  sendViewerPage(res, isDesk ? 'desk.html' : 'join.html', { session: s.id, t: viewerToken(s.id), code: s.joinCode });
}

// 구 server.js 에선 express.static 바로 뒤(인증 미들웨어보다 앞)에 등록 — index.js 도 같은 자리에서 호출한다
export function registerViewerAssetRoutes(app) {
  // 데스크 뷰어 PWA manifest — '홈 화면에 추가'로 실행 시 항상 전체화면 유지. 시작 주소 = /desk/<참여 코드>
  // (참여 코드가 곧 접근 권한이라 토큰을 주소에 싣지 않아도 재실행 후 바로 접속된다. 코드가 없거나 틀리면 /desk 랜딩)
  app.get('/desk.webmanifest', (req, res) => {
    const s = sessionByJoinCode(req.query.code);
    const start = s && s.pipeline === 'desk' ? '/desk/' + s.joinCode : '/desk';
    res.type('application/manifest+json').json({
      name: 'KAC Desk', short_name: 'KAC Desk',
      display: 'fullscreen', display_override: ['fullscreen', 'standalone'],
      background_color: '#0b0e14', theme_color: '#0b0e14',
      start_url: start, scope: '/',
      icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    });
  });
}

export function registerJoinRoutes(app) {
  app.get(['/j', '/j/:code'], (req, res) => joinPage(req, res, false));
  // 같은 정보를 JSON 으로(앱·테스트용) — 틀린 코드 횟수 제한은 페이지와 공유
  app.get('/api/join/:code', (req, res) => {
    const ip = loginIp(req);
    if (joinBlocked(ip)) return res.status(429).json({ error: 'too many attempts' });
    const s = sessionByJoinCode(req.params.code);
    if (!s) { joinMiss(ip); return res.status(404).json({ error: 'not found' }); }
    res.json({ session: s.id, t: viewerToken(s.id), code: s.joinCode, desk: s.pipeline === 'desk' });
  });
  app.get(['/desk', '/desk/:code'], (req, res) => joinPage(req, res, true));
  app.get('/overlay', (req, res) => sendViewerPage(res, 'overlay.html', {}));
  // 예전 주소(…/mobile.html?session=&t=, …/desk.html) → 새 참여 주소로(이미 찍어 둔 QR·링크용). 토큰이 맞을 때만 그 세션으로.
  app.get(['/mobile.html', '/desk.html'], (req, res) => {
    const desk = req.path === '/desk.html';
    const sid = String(req.query.session || '');
    const s = sid && viewerTokenValid(sid, req.query.t) ? getSession(sid) : null;
    if (s) return res.redirect(301, (s.pipeline === 'desk' ? '/desk/' : '/j/') + ensureJoinCode(s));
    res.redirect(301, desk ? '/desk' : '/j');
  });

  /* ---- QR (세션별 모바일 URL) ---- */
  app.get('/api/qr', async (req, res) => {
    const sessionId = String(req.query.session || '');
    // 데스크 랜딩 QR: session 없이 호출하면 안내데스크 선택 화면(desk.html)으로
    const landing = req.query.desk === '1' || (!sessionId && req.query.landing === '1');
    if (!sessionId && !landing) return res.status(400).json({ error: 'session required' });
    // 특정 세션 QR 은 유효 토큰(자신의 뷰어에서 공유) 또는 로그인 사용자만. 랜딩(세션 없음)은 공개.
    if (sessionId && !viewerAccessOk(req, sessionId)) return res.status(403).json({ error: 'forbidden' });
    // 배포 환경: 요청 host/proto 사용(Render 등은 x-forwarded-* 로 전달).
    let proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
    let host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    // PUBLIC_HOST(운영 도메인, 예: airtalk.kr)가 있으면 어느 주소로 접속했든 QR 은 그 도메인으로 —
    // 옛 주소(translate-voxm.onrender.com)로 접속한 구버전 앱에서 만든 QR 도 새 도메인을 가리키게(2026-10-27)
    if (process.env.PUBLIC_HOST) {
      host = process.env.PUBLIC_HOST;
      proto = 'https';
    } else if (!host || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(host)) {
      // 로컬 접속(localhost)이면 같은 와이파이 모바일이 닿도록 LAN IP 로 대체.
      host = `${getLanIp()}:${PORT}`;
      proto = 'http';
    }
    // 데스크 안내 모드는 전용(최소 UI·터치 시작·전체화면) 뷰어로. 랜딩(세션 선택)은 desk.html (세션 없이)
    const sess = sessionId ? getSession(sessionId) : null;
    let url, code = null;
    if (landing) url = `${proto}://${host}/desk`;
    else {
      if (!sess) return res.status(404).json({ error: 'not found' });
      code = ensureJoinCode(sess);
      url = `${proto}://${host}/${sess.pipeline === 'desk' ? 'desk' : 'j'}/${code}`;
    }
    try {
      const dataUrl = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      res.json({ url, qr: dataUrl, code });
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  });
}
