/* 로그인·로그아웃 + 관리자 2FA 설정 라우트 */
import crypto from 'crypto';
import QRCode from 'qrcode';
import { ADMIN_ID, ADMIN_PASSWORD, AUTH_COOKIE } from '../config.js';
import { users } from '../store/index.js';
import { b32encode, totpVerify } from '../util/security_util.js';
import { requireAdmin, isHttps, verifyPassword, findUser, authToken, publicUser, clearAuthCookie, securityCfg, saveSecurityCfg, adminTotpSecret, LOGIN_WINDOW_MS, LOGIN_MAX_FAIL, loginFails, loginKey } from '../auth/index.js';

let pending2faSecret = ''; // 설정 진행 중 시크릿(코드 확인 후 저장)

export function registerAuthRoutes(app) {
  app.get('/api/admin/2fa', requireAdmin, (req, res) => res.json({ enabled: !!adminTotpSecret(), viaEnv: !!process.env.ADMIN_TOTP_SECRET }));
  app.post('/api/admin/2fa/setup', requireAdmin, async (req, res) => {
    if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
    pending2faSecret = b32encode(crypto.randomBytes(20));
    const label = encodeURIComponent(`AirTalk:${req.user.id}`);
    const url = `otpauth://totp/${label}?secret=${pending2faSecret}&issuer=${encodeURIComponent('AirTalk')}`;
    try { res.json({ secret: pending2faSecret, qr: await QRCode.toDataURL(url, { width: 240, margin: 1 }) }); }
    catch (e) { res.status(500).json({ error: String(e) }); }
  });
  app.post('/api/admin/2fa/verify', requireAdmin, (req, res) => {
    if (!pending2faSecret) return res.status(400).json({ error: '먼저 2FA 설정을 시작하세요.' });
    if (!totpVerify(pending2faSecret, (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다. 앱의 6자리 코드를 다시 확인하세요.' });
    securityCfg.adminTotpSecret = pending2faSecret;
    pending2faSecret = '';
    saveSecurityCfg();
    console.log('[2fa] 관리자 2FA 활성화됨');
    res.json({ ok: true });
  });
  app.post('/api/admin/2fa/disable', requireAdmin, (req, res) => {
    if (process.env.ADMIN_TOTP_SECRET) return res.status(400).json({ error: '2FA 시크릿이 환경변수로 관리되고 있습니다.' });
    if (!totpVerify(adminTotpSecret(), (req.body || {}).code)) return res.status(400).json({ error: '인증 코드가 올바르지 않습니다.' });
    securityCfg.adminTotpSecret = '';
    saveSecurityCfg();
    console.log('[2fa] 관리자 2FA 해제됨');
    res.json({ ok: true });
  });

  app.post('/api/login', (req, res) => {
    const b = req.body || {};
    const id = String(b.id || '').trim();
    const password = String(b.password || '');
    const key = loginKey(req, id);
    const now = Date.now();
    // 만료 엔트리 게으른 청소(무한 증가 방지) — 크기가 커졌을 때만 순회
    if (loginFails.size > 2000) {
      for (const [k, v] of loginFails) { if (now - v.first > LOGIN_WINDOW_MS && (!v.lockUntil || now > v.lockUntil)) loginFails.delete(k); }
    }
    let rec = loginFails.get(key);
    if (rec && rec.lockUntil && now < rec.lockUntil) {
      const sec = Math.ceil((rec.lockUntil - now) / 1000);
      return res.status(429).json({ error: `로그인 시도가 너무 많습니다. ${sec}초 후 다시 시도하세요.` });
    }
    if (rec && now - rec.first > LOGIN_WINDOW_MS) rec = null; // 윈도우 경과 → 초기화

    let user = null;
    if (id === ADMIN_ID) {
      const a = Buffer.from(password), e = Buffer.from(ADMIN_PASSWORD);
      if (a.length === e.length && crypto.timingSafeEqual(a, e)) user = findUser(ADMIN_ID);
    } else {
      const u = users.find((x) => x.id === id);
      if (verifyPassword(u, password)) user = u;
    }
    if (!user) {
      rec = rec || { count: 0, first: now, lockUntil: 0 };
      rec.count++;
      if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
      loginFails.set(key, rec);
      console.warn(`[auth] 로그인 실패 id=${id} ip=${key} (${rec.count}회)`);
      return res.status(401).json({ error: 'ID 또는 비밀번호가 올바르지 않습니다.' });
    }
    // 관리자 2FA: 비밀번호 통과 후 OTP 코드 확인(활성화된 경우)
    if (user.role === 'admin' && adminTotpSecret()) {
      if (!b.otp) return res.status(401).json({ need2fa: true, error: '인증 앱의 6자리 코드를 입력하세요.' });
      if (!totpVerify(adminTotpSecret(), b.otp)) {
        rec = rec || { count: 0, first: now, lockUntil: 0 };
        rec.count++;
        if (rec.count >= LOGIN_MAX_FAIL) rec.lockUntil = now + LOGIN_WINDOW_MS;
        loginFails.set(key, rec);
        console.warn(`[auth] 2FA 코드 불일치 id=${id} ip=${key}`);
        return res.status(401).json({ need2fa: true, error: '인증 코드가 올바르지 않습니다.' });
      }
    }
    loginFails.delete(key); // 성공 시 초기화
    console.log(`[auth] 로그인 성공 id=${user.id} role=${user.role} ip=${key}`);
    const secure = isHttps(req) ? '; Secure' : '';
    // remember(자동 로그인) 시 30일 영속 쿠키, 아니면 세션 쿠키(브라우저 종료 시 해제)
    const persist = b.remember ? '; Max-Age=2592000' : '';
    res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${authToken(user.id)}; HttpOnly; SameSite=Lax; Path=/${persist}${secure}`);
    res.json({ user: publicUser(user) });
  });
  app.post('/api/logout', (req, res) => {
    clearAuthCookie(res);
    res.json({ ok: true });
  });
}
