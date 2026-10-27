/* 관리자 로그: 데스크 응대·세션 대화 로그 열람·정리 */
import { sessions, setSessions, col, saveSessions, deleteSessionStore } from '../../store/index.js';
import { getSessionAny } from '../../store/sessions.js';
import { requireAdmin } from '../../auth/index.js';

export function registerLogRoutes(app) {
  /* ---- 관리자: 세부 로그 열람 — 데스크 응대 로그(건당) + 일반 세션 대화 로그 ---- */
  app.get('/api/admin/logs', requireAdmin, (req, res) => {
    const desks = sessions.filter((s) => s.pipeline === 'desk').map((s) => ({
      id: s.id,
      title: s.title || '안내데스크',
      deleted: !!s.deletedAt, // 소프트 삭제된 세션의 로그도 계속 열람 가능(표기용)
      logs: (Array.isArray(s.deskLog) ? s.deskLog : []).map((e, i) => ({
        idx: i,
        startedAt: e.startedAt || null,
        endedAt: e.endedAt || null,
        lang: e.lang || null,
        count: Array.isArray(e.items) ? e.items.length : 0,
        stats: e.stats || null,
      })).reverse(),
    }));
    const others = sessions.filter((s) => s.pipeline !== 'desk').map((s) => ({
      id: s.id, title: s.title || '(제목 없음)', owner: s.owner || null, pipeline: s.pipeline || 'whisper', preset: s.preset || null,
      updatedAt: s.updatedAt || 0, count: Array.isArray(s.items) ? s.items.length : 0,
      deleted: !!s.deletedAt,
    })).sort((a, b) => b.updatedAt - a.updatedAt);
    res.json({ desks, sessions: others });
  });
  app.get('/api/admin/logs/desk/:sid/:idx', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.sid);
    if (!s || s.pipeline !== 'desk') return res.status(404).json({ error: 'not found' });
    const e = (s.deskLog || [])[Number(req.params.idx)];
    if (!e) return res.status(404).json({ error: 'not found' });
    res.json({ startedAt: e.startedAt || null, endedAt: e.endedAt || null, lang: e.lang || null, consentAt: e.consentAt || null, stats: e.stats || null, items: e.items || [] });
  });
  app.get('/api/admin/logs/session/:id', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    res.json({ id: s.id, title: s.title || '', langs: s.langs || [], items: s.items || [] });
  });
  /* ---- 관리자: 로그 정리(삭제) — 시범운영 후 데이터 관리용 ---- */
  // 데스크 응대 1건 삭제
  app.delete('/api/admin/logs/desk/:sid/:idx', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.sid);
    if (!s || s.pipeline !== 'desk' || !Array.isArray(s.deskLog)) return res.status(404).json({ error: 'not found' });
    const i = Number(req.params.idx);
    if (!(i >= 0 && i < s.deskLog.length)) return res.status(404).json({ error: 'not found' });
    // idx 는 목록 조회 시점 기준 — 그 사이 응대 종료/정리로 재색인됐다면 다른 기록을 지우게 되므로 endedAt 으로 동일성 검증
    const expect = Number(req.query.endedAt || 0);
    if (expect && (s.deskLog[i].endedAt || 0) !== expect) return res.status(409).json({ error: '목록이 갱신되었습니다 — 새로고침 후 다시 시도해 주세요.' });
    s.deskLog.splice(i, 1);
    saveSessions();
    res.json({ ok: true, remaining: s.deskLog.length });
  });
  // 소프트 삭제된 세션의 로그까지 지우면 남는 게 없으므로 껍데기도 완전 제거(저장소 포함)
  const purgeIfDeleted = (s) => {
    if (!s.deletedAt) return false;
    setSessions(sessions.filter((x) => x.id !== s.id));
    deleteSessionStore(s.id);
    if (!col) saveSessions();
    return true;
  };
  // 데스크 응대 로그 전체 삭제
  app.delete('/api/admin/logs/desk/:sid', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.sid);
    if (!s || s.pipeline !== 'desk') return res.status(404).json({ error: 'not found' });
    const n = (s.deskLog || []).length;
    s.deskLog = [];
    if (!purgeIfDeleted(s)) saveSessions();
    res.json({ ok: true, deleted: n });
  });
  // 일반 세션 대화 기록 삭제(세션 자체는 유지 — 단, 이미 삭제된 세션은 완전 제거)
  app.delete('/api/admin/logs/session/:id', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    const n = (s.items || []).length;
    s.items = [];
    if (!purgeIfDeleted(s)) saveSessions();
    res.json({ ok: true, deleted: n });
  });
}
