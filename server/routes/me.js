/* 본인 계정: 조회·정보 변경(이메일·환경설정·이름·비밀번호)·탈퇴 */
import crypto from 'crypto';
import { users, profiles, saveUsers, saveProfiles } from '../store/index.js';
import { authFromReq, requireAuth, verifyPassword, hashPassword, publicUser, clearAuthCookie, closeAllLogins, setAuthCookie, PASSWORD_MIN_LEN, EMAIL_RE, PREF_RULES } from '../auth/index.js';
import { deleteUserAccount } from './admin/accounts.js';

export function registerMeRoutes(app) {
  // reason: 로그아웃된 이유(replaced=다른 기기 로그인, password=비밀번호 변경) — 로그인 화면 안내용
  app.get('/api/me', (req, res) => {
    const a = authFromReq(req);
    res.json({ user: a.user ? publicUser(a.user) : null, ...(a.reason ? { reason: a.reason } : {}) });
  });
  // 본인 정보 변경(필드 모두 선택): email·prefs 는 관리자 포함 전원, username·password 는 일반 사용자만
  // (관리자는 env 관리 — 해당 필드가 있을 때만 400 이라 관리자도 이메일·환경설정은 저장 가능).
  // 비밀번호 변경은 currentPassword 확인 + password/passwordConfirm 일치 + 최소 길이.
  // 모든 필드를 먼저 검증한 뒤 반영한다(일부만 저장되는 반쪽 변경 방지).
  app.patch('/api/me', requireAuth, (req, res) => {
    const b = req.body && typeof req.body === 'object' ? req.body : {};
    const isAdmin = req.user.role === 'admin';
    const wantName = typeof b.username === 'string' && !!b.username.trim();
    const wantPw = b.password != null && b.password !== '';
    if (isAdmin && (wantName || wantPw)) return res.status(400).json({ error: '관리자 계정은 환경변수로 관리됩니다.' });
    let stored = null;
    if (wantName || wantPw) {
      stored = users.find((x) => x.id === req.user.id);
      if (!stored) return res.status(404).json({ error: 'not found' });
    }
    if (wantPw) {
      const pw = String(b.password);
      if (pw !== b.passwordConfirm) return res.status(400).json({ error: '비밀번호가 일치하지 않습니다.' });
      if (pw.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
      if (!verifyPassword(stored, String(b.currentPassword || ''))) return res.status(400).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }
    let email; // undefined = 변경 없음, '' = 지움
    if (b.email !== undefined) {
      if (b.email === null || b.email === '') email = '';
      else if (typeof b.email !== 'string') return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
      else {
        email = b.email.trim();
        if (email && (email.length > 254 || !EMAIL_RE.test(email))) return res.status(400).json({ error: '이메일 형식이 올바르지 않습니다.' });
      }
    }
    let prefPatch = null;
    if (b.prefs !== undefined) {
      if (!b.prefs || typeof b.prefs !== 'object' || Array.isArray(b.prefs)) return res.status(400).json({ error: '환경설정 형식이 올바르지 않습니다.' });
      prefPatch = {};
      for (const [k, rule] of Object.entries(PREF_RULES)) {
        if (!Object.prototype.hasOwnProperty.call(b.prefs, k)) continue;
        const v = b.prefs[k];
        if (v === null) { prefPatch[k] = null; continue; }
        const ok = rule(v);
        if (ok === undefined) return res.status(400).json({ error: `환경설정 값이 올바르지 않습니다: ${k}` });
        prefPatch[k] = ok;
      }
    }
    // ---- 반영 ----
    if (stored) {
      if (wantName) stored.username = b.username.trim();
      if (wantPw) {
        stored.salt = crypto.randomBytes(16).toString('hex');
        stored.hash = hashPassword(String(b.password), stored.salt);
        // 다른 기기는 모두 로그아웃, 지금 기기는 새 토큰으로 계속
        closeAllLogins(stored.id, 'password');
        setAuthCookie(req, res, stored.id, req.auth.kind);
      }
      saveUsers();
    }
    if (email !== undefined || prefPatch) {
      const id = req.user.id;
      const prev = profiles.get(id) || { id, email: '', prefs: {} };
      const prefs = { ...(prev.prefs || {}) };
      for (const [k, v] of Object.entries(prefPatch || {})) { if (v === null) delete prefs[k]; else prefs[k] = v; }
      profiles.set(id, { ...prev, id, email: email !== undefined ? email : prev.email || '', prefs, updatedAt: Date.now() }); // ...prev: 로그인 자리(logins) 보존
      saveProfiles(id);
    }
    res.json({ user: publicUser(stored || req.user) });
  });
  // 본인 탈퇴: 비밀번호 재확인 후 관리자 삭제와 동일하게 정리(deleteUserAccount) + 로그아웃. 관리자는 불가.
  app.delete('/api/me', requireAuth, (req, res) => {
    if (req.user.role === 'admin') return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
    const stored = users.find((x) => x.id === req.user.id);
    if (!stored) return res.status(404).json({ error: 'not found' });
    if (!verifyPassword(stored, String((req.body && req.body.password) || ''))) return res.status(400).json({ error: '비밀번호가 올바르지 않습니다.' });
    deleteUserAccount(stored.id);
    console.log(`[auth] 본인 탈퇴 user=${stored.id}`);
    clearAuthCookie(res);
    res.json({ ok: true });
  });
}
