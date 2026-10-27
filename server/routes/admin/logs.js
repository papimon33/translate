/* 관리자 로그: 데스크 통계·응대/대화 로그 열람·정리 */
import { sessions, setSessions, col, saveSessions, deleteSessionStore } from '../../store/index.js';
import { getSessionAny } from '../../store/sessions.js';
import { requireAdmin } from '../../auth/index.js';

export function registerLogRoutes(app) {
  /* ---- 관리자: 데스크 통계(응대 건수·언어 분포·평균 응대 시간·일별) — 대화 내용은 노출하지 않음 ---- */
  /* 데스크 운영 통계 v2 — 시범운영 보고서용 상세 지표.
     응대(deskLog) 단위로 집계: 언어별 건수·평균시간, 일별·시간대 분포, 응대시간 중앙값,
     문장수(안내원/손님 비율), 누화 드랍율, 중단(interrupted) 응대, 길안내 감지→표시율,
     그리고 원자료 rows(응대 1건=1행) — CSV 내려받기·외부 분석용. */
  app.get('/api/admin/desk-stats', requireAdmin, (req, res) => {
    const out = sessions.filter((s) => s.pipeline === 'desk').map((s) => {
      const log = Array.isArray(s.deskLog) ? s.deskLog : [];
      const langs = {};
      const byLang = {}; // lang -> { count, durSum, durN, sent }
      const daily = {};
      const hourly = Array(24).fill(0);
      const durs = [];
      let durSum = 0, durN = 0, interrupted = 0;
      let sentSum = 0, staffSent = 0, guestSent = 0, crossDrops = 0;
      const rows = [];
      for (const e of log) {
        const lang = e.lang || 'unknown';
        const sent = Array.isArray(e.items) ? e.items.length : 0;
        const dur = e.startedAt && e.endedAt ? e.endedAt - e.startedAt : null;
        langs[lang] = (langs[lang] || 0) + 1;
        const bl = byLang[lang] || (byLang[lang] = { count: 0, durSum: 0, durN: 0, sent: 0 });
        bl.count++; bl.sent += sent;
        if (dur != null) { durSum += dur; durN++; durs.push(dur); bl.durSum += dur; bl.durN++; }
        if (e.interrupted) interrupted++;
        sentSum += sent;
        if (e.stats) { staffSent += e.stats.staff || 0; guestSent += e.stats.guest || 0; crossDrops += e.stats.crossDrops || 0; }
        const kst = new Date((e.endedAt || Date.now()) + 9 * 3600 * 1000); // KST(UTC 서버에서 새벽 응대가 전날로 집계되는 문제 방지)
        const d = kst.toISOString().slice(0, 10);
        daily[d] = (daily[d] || 0) + 1;
        hourly[kst.getUTCHours()]++;
        rows.push({
          date: d, startedAt: e.startedAt || null, endedAt: e.endedAt || null, durMs: dur,
          lang, sentences: sent, staff: e.stats ? e.stats.staff || 0 : null, guest: e.stats ? e.stats.guest || 0 : null,
          crossDrops: e.stats ? e.stats.crossDrops || 0 : null, interrupted: !!e.interrupted,
        });
      }
      durs.sort((a, b) => a - b);
      const medianMs = durs.length ? durs[Math.floor(durs.length / 2)] : 0;
      const wl = Array.isArray(s.wayfindLog) ? s.wayfindLog : [];
      const wayfindTop = {};
      for (const w of wl) { if (w.catId) wayfindTop[w.catId] = (wayfindTop[w.catId] || 0) + 1; }
      return {
        id: s.id, title: s.title || '안내데스크', owner: s.owner || null, deleted: !!s.deletedAt,
        count: log.length, interrupted, langs, avgMs: durN ? Math.round(durSum / durN) : 0, medianMs,
        byLang: Object.fromEntries(Object.entries(byLang).map(([lg, b]) => [lg, { count: b.count, avgMs: b.durN ? Math.round(b.durSum / b.durN) : 0, avgSent: b.count ? +(b.sent / b.count).toFixed(1) : 0 }])),
        sentences: { total: sentSum, avgPerConv: log.length ? +(sentSum / log.length).toFixed(1) : 0, staff: staffSent, guest: guestSent },
        crossDrops, crossDropRate: staffSent + guestSent + crossDrops > 0 ? +((crossDrops / (staffSent + guestSent + crossDrops)) * 100).toFixed(1) : 0,
        wayfindDetected: wl.length, wayfindShown: wl.filter((w) => w.shown).length,
        wayfindTop: Object.entries(wayfindTop).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([catId, count]) => ({ catId, count })),
        daily: Object.entries(daily).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, count]) => ({ date, count })), // 전체 — 기간·월별 뷰는 클라에서 필터/그룹핑
        hourly,
        rows: rows.slice(-500),
      };
    });
    res.json(out);
  });

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
  // 데스크 응대 로그 전체 삭제(길안내 로그 포함)
  app.delete('/api/admin/logs/desk/:sid', requireAdmin, (req, res) => {
    const s = getSessionAny(req.params.sid);
    if (!s || s.pipeline !== 'desk') return res.status(404).json({ error: 'not found' });
    const n = (s.deskLog || []).length;
    s.deskLog = [];
    s.wayfindLog = [];
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
