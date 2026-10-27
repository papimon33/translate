/* 안내데스크 현황판(실시간 상태) */
import { sessions } from '../store/index.js';
import { requireAuth } from '../auth/index.js';
import { rooms, deskCtrl } from '../realtime/rooms.js';

export function registerDeskStatusRoutes(app) {
  /* ---- 데스크 현황: 전 데스크의 실시간 상태(호스트 연결·응대 중·뷰어 수) — 목록 화면 현황판용 ---- */
  app.get('/api/desk-status', requireAuth, (req, res) => {
    const out = sessions
      .filter((s) => s.pipeline === 'desk' && !s.deletedAt)
      .map((s) => {
        const r = rooms.get(s.id);
        const dc = deskCtrl.get(s.id);
        const st = dc && dc.state ? dc.state() : null;
        return {
          id: s.id,
          hostOn: !!(r && r.hosts.size > 0),
          active: !!(st && st.phase === 'active'),
          lang: st && st.phase === 'active' ? st.lang : null,
          // 호스트 화면의 패시브 뷰어 소켓(role=host)은 제외 — 태블릿이 없어도 '뷰어 1'로 부풀던 문제
          viewers: r ? [...r.viewers].filter((v) => !v._hostView).length : 0,
        };
      });
    res.json(out);
  });
}
