/* 관리자 시스템: 상태(health)·브라우저 오류 수집 / 전체 초기화·백업 */
import crypto from 'crypto';
import { ADMIN_PASSWORD, DESKLOG_CAP } from '../../config.js';
import { metrics } from '../../metrics.js';
import { sessions, setSessions, dataKey, col, dirtySessions, sessionsFlushInflight, flushSessions, deskRegistry, termsConfig } from '../../store/index.js';
import { requireAdmin, adminTotpSecret } from '../../auth/index.js';
import { rooms } from '../../realtime/rooms.js';
import { wss } from '../../realtime/index.js';

export function registerSystemRoutes(app) {
  app.get('/api/admin/health', requireAdmin, (req, res) => {
    const rms = [...rooms.values()];
    res.json({
      uptimeSec: Math.floor((Date.now() - metrics.startedAt) / 1000),
      memoryMB: Math.round(process.memoryUsage().rss / 1048576),
      node: process.version,
      sessions: sessions.length,
      liveHosts: rms.reduce((a, r) => a + r.hosts.size, 0),
      liveViewers: rms.reduce((a, r) => a + r.viewers.size, 0),
      dataEncrypted: !!dataKey,
      twoFaEnabled: !!adminTotpSecret(),
      forceHttps: process.env.FORCE_HTTPS === '1',
      saveFail: metrics.saveFail,           // 세션 저장(디스크·Mongo) 최근 실패 — null 이면 정상
      deskLogFull: metrics.deskLogFull.slice(-10).reverse(), // 응대 보존 상한 초과로 잘려 나간 기록
      deskLogCap: DESKLOG_CAP,
      recentErrors: metrics.errors.slice(-20).reverse(),
      clientErrors: metrics.clientErrors.slice(-20).reverse(),
    });
  });
  // 브라우저 오류 수집(window.onerror) — 관리자 시스템 상태에서 확인.
  // 무인증 엔드포인트이므로 IP당 분당 10회로 제한(스팸·소음 방지).
  const clientLogRate = new Map(); // ip -> { count, windowStart }
  app.post('/api/client-log', (req, res) => {
    const ip = String(req.ip || 'ip');
    const now = Date.now();
    let rl = clientLogRate.get(ip);
    if (!rl || now - rl.windowStart > 60000) rl = { count: 0, windowStart: now };
    rl.count++;
    clientLogRate.set(ip, rl);
    if (clientLogRate.size > 2000) clientLogRate.clear(); // 상한(메모리 가드)
    if (rl.count > 10) return res.json({ ok: true }); // 조용히 무시
    const b = req.body || {};
    const e = { at: now, ua: String(req.headers['user-agent'] || '').slice(0, 80), msg: String(b.msg || '').slice(0, 300), src: String(b.src || '').slice(0, 120) };
    metrics.clientErrors.push(e);
    if (metrics.clientErrors.length > 100) metrics.clientErrors.shift();
    res.json({ ok: true });
  });
}

export function registerDataRoutes(app) {
  /* ---- 전체 초기화(관리자): 세션(대화·응대 로그 포함)·AI 요약을 전부 삭제 ----
     파괴적 작업이므로 로그인 세션과 별개로 관리자 비밀번호를 본문에서 재확인한다.
     보존: 계정·안내데스크 정의·용어·정형 안내·사용량 통계(과금 기록). */
  app.post('/api/admin/reset-all', requireAdmin, async (req, res) => {
    const pw = String((req.body || {}).password || '');
    const a = Buffer.from(pw), e = Buffer.from(ADMIN_PASSWORD);
    if (!(a.length === e.length && crypto.timingSafeEqual(a, e))) {
      return res.status(403).json({ error: '관리자 비밀번호가 일치하지 않습니다.' });
    }
    // 진행 중인 캡처·뷰어 연결을 먼저 정리(파이프라인 close 핸들러가 정상 경로로 정돈)
    for (const c of wss.clients) { try { c.close(); } catch {} }
    // 데스크 세션은 '설비'다 — 지우면 세션 id 가 바뀌어 뷰어 접근 토큰(HMAC of id)도 바뀌고
    // 현장에 인쇄·게시한 QR 이 전부 무효가 된다. 그래서 데스크 세션은 남기고 내용만 비운다.
    const kept = sessions.filter((s) => s.pipeline === 'desk' && !s.deletedAt);
    const removed = sessions.length - kept.length;
    let clearedLogs = 0;
    for (const s of kept) {
      clearedLogs += (s.deskLog || []).length;
      s.items = [];
      s.deskLog = [];
      s.wayfindLog = [];
      s.updatedAt = Date.now();
    }
    setSessions(kept);
    dirtySessions.clear();
    try {
      if (col) {
        if (sessionsFlushInflight) await sessionsFlushInflight;
        await col.deleteMany({ id: { $nin: kept.map((s) => s.id) } }); // 데스크 세션 외 전부 삭제
        for (const s of kept) await col.replaceOne({ id: s.id }, s, { upsert: true }); // 비운 상태로 저장
      } else await flushSessions();
    } catch (err) {
      console.error('[reset-all] 저장소 정리 실패', err);
      return res.status(500).json({ error: '저장소 정리에 실패했습니다 — 서버 로그를 확인하세요.' });
    }
    console.warn(`[reset-all] 관리자 초기화 — 세션 ${removed}개 삭제, 데스크 ${kept.length}개 유지(응대 기록 ${clearedLogs}건 비움)`);
    res.json({ ok: true, removedSessions: removed, keptDesks: kept.length, clearedDeskLogs: clearedLogs });
  });

  /* ---- 전체 데이터 백업(관리자): 세션·데스크 정의·용어·정형 안내를 JSON 한 파일로 ---- */
  app.get('/api/admin/export', requireAdmin, (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="airtalk-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.send(JSON.stringify({ exportedAt: Date.now(), sessions, deskRegistry, termsConfig }, null, 1));
  });
}
