/* 관리자 사용자 관리 + 계정 완전 삭제(본인 탈퇴와 공용) */
import crypto from 'crypto';
import { ADMIN_ID } from '../../config.js';
import { users, sessions, setSessions, profiles, col, profilesCol, saveUsers, deleteUserStore, saveSessions, deleteSessionStore, deleteProfileStore } from '../../store/index.js';
import { requireAdmin, makeUser, hashPassword, PASSWORD_MIN_LEN } from '../../auth/index.js';
import { closeSessionRoom } from '../../realtime/rooms.js';

// 사용자 계정 완전 삭제 — 관리자 삭제(DELETE /api/admin/users/:id)·본인 탈퇴(DELETE /api/me) 공용.
// 사용자 레코드 + 소유 세션(하드 삭제, 저장소 포함) + 프로필. 소유 세션의 라이브 소켓도 끊는다 —
// 하드 삭제된 세션에 호스트가 붙어 있으면 좀비 스트리밍(비용)이 계속된다(closeSessionRoom, 세션 삭제와 동일 정리).
export function deleteUserAccount(id) {
  const i = users.findIndex((u) => u.id === id);
  if (i >= 0) {
    users.splice(i, 1);
    deleteUserStore(id);
  }
  const owned = sessions.filter((s) => s.owner === id).map((s) => s.id);
  if (owned.length) {
    setSessions(sessions.filter((s) => s.owner !== id));
    owned.forEach((sid) => { deleteSessionStore(sid); closeSessionRoom(sid); });
    if (!col) saveSessions();
  }
  if (profiles.delete(id) || profilesCol) deleteProfileStore(id);
}

export function registerAccountRoutes(app) {
  /* ---- 관리자: 사용자 관리 + 사용량 통계 ---- */
  app.get('/api/admin/users', requireAdmin, (req, res) => {
    const list = users.map((u) => ({
      id: u.id, username: u.username, role: u.role, createdAt: u.createdAt,
      sessionCount: sessions.filter((s) => s.owner === u.id).length,
      usageMs: u.usageMs || 0,
    }));
    res.json(list);
  });
  app.post('/api/admin/users', requireAdmin, (req, res) => {
    const b = req.body || {};
    const id = String(b.id || '').trim();
    const username = String(b.username || '').trim();
    const password = String(b.password || '');
    if (!id || !password) return res.status(400).json({ error: 'ID 와 비밀번호는 필수입니다.' });
    if (password.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
    if (id === ADMIN_ID || users.some((u) => u.id === id))
      return res.status(409).json({ error: '이미 존재하는 ID 입니다.' });
    const u = makeUser({ id, username, password, role: 'user' });
    users.push(u);
    saveUsers();
    res.json({ id: u.id, username: u.username, role: u.role, createdAt: u.createdAt, sessionCount: 0, usageMs: 0 });
  });
  app.post('/api/admin/users/:id/password', requireAdmin, (req, res) => {
    const u = users.find((x) => x.id === req.params.id);
    if (!u) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const pw = String((req.body && req.body.password) || '');
    if (!pw) return res.status(400).json({ error: '비밀번호는 필수입니다.' });
    if (pw.length < PASSWORD_MIN_LEN) return res.status(400).json({ error: `비밀번호는 ${PASSWORD_MIN_LEN}자 이상이어야 합니다.` });
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPassword(pw, u.salt);
    saveUsers();
    console.log(`[admin] 비밀번호 재설정 user=${u.id}`);
    res.json({ ok: true });
  });
  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (id === ADMIN_ID) return res.status(400).json({ error: '관리자 계정은 삭제할 수 없습니다.' });
    deleteUserAccount(id);
    res.json({ ok: true });
  });
}
