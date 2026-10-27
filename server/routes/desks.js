/* 안내데스크: 현황판(실시간 상태) / 레지스트리(사전 정의) */
import { sessions, deskRegistry, setDeskRegistry, persistDeskRegistry } from '../store/index.js';
import { newId } from '../store/sessions.js';
import { requireAuth, requireAdmin } from '../auth/index.js';
import { rooms, deskCtrl } from '../realtime/rooms.js';

export function registerDeskStatusRoutes(app) {
  /* ---- 정형 안내 멘트(원터치 재생용 문안) — 열람은 로그인 전원, 수정은 관리자 ---- */
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

export function registerDeskRegistryRoutes(app) {
  /* ---- 안내데스크 사전 정의(레지스트리): 관리자가 이름·층·방향을 등록해 두면
     세션 생성 시 데스크를 '선택'만 한다(층·방향은 레지스트리에서 복사, 세션명은 별도). ---- */
  app.get('/api/desk-registry', requireAuth, (req, res) => res.json(deskRegistry));
  app.put('/api/desk-registry', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const desks = (Array.isArray(b.desks) ? b.desks : []).slice(0, 50).map((d) => ({
      id: String(d.id || newId()),
      name: String(d.name || '').trim().slice(0, 60),
      floor: ['1F', '2F', '3F', '4F'].includes(d.floor) ? d.floor : '1F',
      side: ['E', 'W', 'S', 'N'].includes(d.side) ? d.side : 'S',
    })).filter((d) => d.name);
    setDeskRegistry({ desks });
    try { await persistDeskRegistry(); } catch (e) { return res.status(500).json({ error: '저장 실패: ' + e.message }); }
    res.json(deskRegistry);
  });
}
