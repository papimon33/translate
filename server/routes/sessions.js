/* 세션 REST API(목록·생성·조회·수정·내역 비우기·뷰어 수·삭제) + 데스크 뷰어 랜딩 목록 */
import { LANG_NAMES, ALL_LANGS, PRESET_SRC, normalizeMode } from '../config.js';
import { sessions, setSessions, deskRegistry, col, saveSessions, deleteSessionStore } from '../store/index.js';
import { getSession, newId } from '../store/sessions.js';
import { requireAuth, viewerAccessOk } from '../auth/index.js';
import { rooms, broadcast, closeSessionRoom } from '../realtime/rooms.js';

export function registerSessionRoutes(app) {
  /* ---- 세션 REST API ---- */
  app.get('/api/sessions', requireAuth, (req, res) => {
    // q= 검색: 제목 + 대화 내용(원문·번역, 데스크 응대 기록 포함)
    const q = String(req.query.q || '').trim().toLowerCase();
    const hitItem = (it) => {
      if (!it) return false;
      if (it.source && String(it.source).toLowerCase().includes(q)) return true;
      return !!(it.texts && Object.values(it.texts).some((v) => v && String(v).toLowerCase().includes(q)));
    };
    const matches = (s) => {
      if ((s.title || '').toLowerCase().includes(q)) return true;
      if (Array.isArray(s.items) && s.items.some(hitItem)) return true;
      return Array.isArray(s.deskLog) && s.deskLog.some((e) => Array.isArray(e.items) && e.items.some(hitItem));
    };
    // 검색 결과에 보여줄 매칭 발췌: 대화 내용에서 q 가 처음 나오는 곳 주위 텍스트(제목만 맞은 경우엔 null)
    const snippetOf = (s) => {
      if (!q) return null;
      const texts = [];
      const collect = (it) => { if (it) { if (it.source) texts.push(String(it.source)); if (it.texts) for (const v of Object.values(it.texts)) if (v) texts.push(String(v)); } };
      (s.items || []).forEach(collect);
      (s.deskLog || []).forEach((e) => (e.items || []).forEach(collect));
      for (const t of texts) {
        const i = t.toLowerCase().indexOf(q);
        if (i >= 0) {
          const start = Math.max(0, i - 24);
          const raw = t.slice(start, i + q.length + 56);
          return (start > 0 ? '…' : '') + raw.trim() + (i + q.length + 56 < t.length ? '…' : '');
        }
      }
      return null; // 제목만 매칭
    };
    // 폰 세션 목록의 '한국어 ⇄ 중국어' 표기용 — 마지막으로 번역한 방향(sxInfo)과 입력 언어
    const langsOf = (s) => ({
      inLang: s.inLang || null,
      sxInfo: s.sxInfo ? { mode: s.sxInfo.mode, target: s.sxInfo.target, a: s.sxInfo.a, b: s.sxInfo.b } : null,
    });
    const list = sessions
      .filter((s) => !s.deletedAt)
      // 일반 세션은 본인 것만. 안내데스크 세션은 관리자가 만들고 전 직원이 공용으로 운영 → 모두에게 노출.
      .filter((s) => (s.pipeline === 'desk' ? true : s.owner === req.user.id))
      .filter((s) => (q ? matches(s) : true))
      .map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, count: s.items.length, pipeline: s.pipeline || 'whisper', preset: s.preset || null, src: s.src || null, deskName: s.deskName || null, snippet: snippetOf(s), ...langsOf(s) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    res.json(list);
  });

  app.post('/api/sessions', requireAuth, (req, res) => {
    const now = Date.now();
    const b = req.body || {};
    const pipeline = ['translate', 'soniox', 'desk'].includes(b.pipeline) ? b.pipeline : 'soniox'; // whisper(구) 지원 종료 — 기본 soniox
    // 안내데스크 세션은 관리자만 생성(공용 인프라) — 직원은 운영만
    if (pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 만들 수 있습니다.' });
    // translate 는 단일 출력 언어. desk 는 ko 시작(감지로 동적 확장). soniox 다국어.
    const outLang = b.outLang && LANG_NAMES[b.outLang] ? b.outLang : 'ko';
    const langs = pipeline === 'translate' ? [outLang] : (pipeline === 'desk' ? ['ko'] : ALL_LANGS.slice());
    // 실시간 번역 모드: oneway(실시간 번역)/twoway(양방향 통역) + 소스. 신규 기본 소스는 마이크
    // (구 프리셋 키가 들어와도 같은 상황으로 매핑 — 캐시된 구 클라 대비).
    const mode = pipeline === 'soniox' ? normalizeMode(b.preset, b.src, 'mic') : null;
    // 데스크 안내: 레지스트리(관리자 사전 정의)에서 데스크 선택 → 층/방향/데스크명 복사.
    // deskId 없이 직접 deskFloor/deskSide 를 주는 구형 경로도 하위호환으로 유지.
    let deskName;
    if (pipeline === 'desk' && b.deskId) {
      const reg = (deskRegistry.desks || []).find((d) => d.id === String(b.deskId));
      if (!reg) return res.status(400).json({ error: '등록되지 않은 안내데스크입니다. 관리자 페이지에서 먼저 등록하세요.' });
      b.deskFloor = reg.floor;
      b.deskSide = reg.side;
      deskName = reg.name;
    }
    const deskFloor = pipeline === 'desk' ? (['1F', '2F', '3F', '4F'].includes(b.deskFloor) ? b.deskFloor : '1F') : undefined;
    const deskSide = pipeline === 'desk' ? (['E', 'W', 'S', 'N'].includes(b.deskSide) ? b.deskSide : 'S') : undefined;
    const s = {
      id: newId(),
      owner: req.user.id, // 소유자
      title: b.title || '새 세션',
      createdAt: now,
      updatedAt: now,
      pipeline, // 생성 후 변경 불가
      ...(mode ? { preset: mode.preset, src: mode.src } : {}),
      ...(deskFloor ? { deskFloor, deskSide } : {}),
      ...(deskName ? { deskName } : {}),
      langs,
      outLang,
      inLang: b.inLang || 'auto',
      items: [],
    };
    sessions.push(s);
    saveSessions();
    res.json(s);
  });

  app.get('/api/sessions/:id', (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (!viewerAccessOk(req, s.id)) return res.status(403).json({ error: 'forbidden' }); // 공개 뷰어: 유효 토큰 또는 로그인 필요
    // 공개 라우트(뷰어용) — 필요한 필드만 화이트리스트로 반환.
    // 전체 스프레드 금지: deskLog(지난 손님 응대 기록)·wayfindLog·owner 등이 노출됐던 문제 수정.
    res.json({
      id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt,
      pipeline: s.pipeline || 'whisper', preset: s.preset || null, src: s.src || null, // src: 호스트 화면 재진입 시 소리 입력 복원(목록에서 열 때 이 값이 쓰인다)
      langs: s.langs || [], outLang: s.outLang, inLang: s.inLang,
      sxInfo: s.sxInfo || null, speakers: s.speakers || {},
      deskFloor: s.deskFloor || null, deskSide: s.deskSide || null,
      items: s.items || [],
    });
  });

  // 데스크 뷰어 랜딩(공개): 안내데스크 세션 목록(id·제목·가동 여부) — 표시 전용이다.
  // 뷰어 토큰이 없어 여기서 방을 골라 입장할 수는 없고(태블릿은 로그인한 직원이 발급한 세션별 QR 로 1회 설치),
  // 이 목록은 어떤 데스크가 등록·가동 중인지 보여주기만 한다.
  app.get('/api/desk-sessions', (req, res) => {
    const list = sessions
      .filter((s) => s.pipeline === 'desk' && !s.deletedAt)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      // active = 호스트(안내원)가 마이크 캡처 중(대기 가능). 비활성이면 손님이 선택 못 함.
      // t(뷰어 접근 토큰)는 여기서 내려보내지 않는다 — 이 라우트는 무인증 공개라, 토큰을 실으면
      // 인터넷에서 누구나 진행 중인 승객 대화를 수신하고 desk-end 로 응대를 종료할 수 있다.
      // 태블릿은 로그인한 직원만 열 수 있는 GET /api/qr?session=.. 로 1회 프로비저닝한다(안내원 조작 0회).
      .map((s) => ({ id: s.id, title: s.title || '안내데스크', active: !!(rooms.get(s.id) && rooms.get(s.id).hosts.size > 0) }));
    res.json(list);
  });

  app.patch('/api/sessions/:id', requireAuth, (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    // 데스크 세션은 전 직원이 운영(층/방향·화자명 등 조작) — 소유자 제한 없음. 그 외에는 본인/관리자만.
    if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    // 데스크 세션 제목 변경(관리 행위)은 관리자만
    if (s.pipeline === 'desk' && typeof (req.body || {}).title === 'string' && req.user.role !== 'admin') delete req.body.title;
    // pipeline 은 생성 시 고정. title·inLang 수정 허용. outLang 은 translate 의 타깃 변경용.
    const b = req.body || {};
    if (typeof b.title === 'string') s.title = b.title;
    if (typeof b.inLang === 'string') s.inLang = b.inLang;
    // 모드(preset) 변경: 번역 이력이 없고 '녹음 중이 아닌' soniox 세션만 허용(진행 중 방향/설정 desync 방지)
    const activeHosts = rooms.get(req.params.id)?.hosts.size || 0;
    if (typeof b.preset === 'string' && s.pipeline === 'soniox' && activeHosts === 0 && (!Array.isArray(s.items) || s.items.length === 0)) {
      const m = normalizeMode(b.preset, typeof b.src === 'string' ? b.src : s.src, 'mic');
      if (m) { s.preset = m.preset; s.src = m.src; }
    } else if (typeof b.src === 'string' && s.pipeline === 'soniox' && (PRESET_SRC[s.preset] || []).includes(b.src)) {
      // 소스는 번역 이력과 무관(방향이 바뀌지 않음) — 이력이 있어도 변경 허용. 녹음 중 변경은 클라가 막는다.
      s.src = b.src;
    }
    if (s.pipeline === 'desk') { // 데스크 출발 층/방향
      if (['1F', '2F', '3F', '4F'].includes(b.deskFloor)) s.deskFloor = b.deskFloor;
      if (['E', 'W', 'S', 'N'].includes(b.deskSide)) s.deskSide = b.deskSide;
    }
    if (typeof b.outLang === 'string' && LANG_NAMES[b.outLang]) {
      s.outLang = b.outLang;
      if (s.pipeline === 'translate') s.langs = [b.outLang]; // translate 출력 언어 변경
    }
    // 화자 이름 매핑(diarization): { "1": "지정이름", ... } — 다운로드/요약/뷰어 공용
    if (b.speakers && typeof b.speakers === 'object' && !Array.isArray(b.speakers)) {
      const clean = {};
      for (const [k, v] of Object.entries(b.speakers)) {
        if (typeof v === 'string') { const nv = v.trim().slice(0, 40); if (nv) clean[String(k)] = nv; }
      }
      s.speakers = clean;
      broadcast(req.params.id, { type: 'speakers', speakers: clean }); // 뷰어(모바일) 실시간 반영
    }
    // 참여자 PTT(휴대폰 누르고 말하기) on/off — 뷰어에 실시간 반영
    s.updatedAt = Date.now();
    saveSessions();
    res.json(s);
  });

  // 세션 대화 내역만 비우기(세션 자체는 유지) — 세션 화면의 '…' 메뉴에서 사용자가 직접.
  //  본인 세션(또는 관리자), 데스크는 관리자만. 라이브 뷰어 화면도 비운다.
  app.delete('/api/sessions/:id/items', requireAuth, (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (s.pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 대화 내역은 관리자만 삭제할 수 있습니다.' });
    if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const n = Array.isArray(s.items) ? s.items.length : 0;
    s.items = [];
    s.updatedAt = Date.now();
    saveSessions();
    broadcast(req.params.id, { type: 'snapshot', items: [] }); // 접속 중인 뷰어 화면도 비움
    res.json({ ok: true, deleted: n });
  });

  // 지금 링크로 접속한 뷰어 수(폰 호스트 화면 표시용 — 번역 시작 전에도) — 호스트 화면의 패시브 뷰어는 제외
  app.get('/api/sessions/:id/viewers', requireAuth, (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'not found' });
    if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
    const r = rooms.get(s.id);
    res.json({ n: r ? [...r.viewers].filter((v) => !v._hostView).length : 0 });
  });
  app.delete('/api/sessions/:id', requireAuth, (req, res) => {
    const s = getSession(req.params.id);
    if (s) {
      // 안내데스크 세션 삭제(관리 행위)는 관리자만
      if (s.pipeline === 'desk' && req.user.role !== 'admin') return res.status(403).json({ error: '안내데스크 세션은 관리자만 삭제할 수 있습니다.' });
      if (s.pipeline !== 'desk' && s.owner !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
      if (s.pipeline === 'desk') {
        // 안내데스크(관리자 전용 삭제): 소프트 삭제 — 응대 통계·로그(deskLog)는 관리자 페이지에서 따로 정리
        s.deletedAt = Date.now();
        saveSessions();
      } else {
        // 일반 세션: 대화 기록까지 완전 삭제(2026-10-22 — 삭제한 대화가 관리자 로그에 남지 않게, 회의 녹취 개인정보)
        setSessions(sessions.filter((x) => x.id !== s.id));
        deleteSessionStore(s.id);
        if (!col) saveSessions();
      }
    }
    closeSessionRoom(req.params.id);
    res.json({ ok: true });
  });
}
