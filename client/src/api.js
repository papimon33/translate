// 모든 응답의 HTTP 상태를 검사 — 오류 바디({error})가 성공값으로 흘러 화면이 깨지던 문제 수정.
// 실패 시 Error(message)에 status 를 붙여 던진다(호출부 .catch 폴백이 정상 동작).
const json = async (r) => {
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const e = new Error(d.error || `요청 실패 (${r.status})`);
    e.status = r.status;
    throw e;
  }
  return r.json();
};

export const api = {
  list: (q) => fetch('/api/sessions' + (q ? '?q=' + encodeURIComponent(q) : '')).then(json), // q=제목+대화내용 검색
  create: (body) =>
    fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(json),
  get: (id) => fetch('/api/sessions/' + id).then(json),
  patch: (id, body) =>
    fetch('/api/sessions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(json),
  remove: (id) => fetch('/api/sessions/' + id, { method: 'DELETE' }).then(json),
  qr: (id) => fetch('/api/qr?session=' + id).then(json),
  desktopInfo: () => fetch('/api/desktop/info').then(json), // 데스크톱 앱 최신 설치본 정보

  me: () => fetch('/api/me').then(json),
  login: (id, password, remember, otp) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password, remember: !!remember, ...(otp ? { otp } : {}) }),
    }).then(async (r) => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        const e = new Error(d.error || '로그인 실패');
        e.need2fa = !!d.need2fa; // 관리자 2FA 코드 필요/불일치
        e.status = r.status; // 429(잠금) 구분용
        throw e;
      }
      return r.json();
    }),
  logout: () => fetch('/api/logout', { method: 'POST' }).then(json),
  ttsPreview: (lang, gender) =>
    fetch('/api/tts/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang, gender }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('preview failed');
      return r.blob();
    }),
  updateMe: (body) =>
    fetch('/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '변경 실패');
      return r.json();
    }),

  adminUsers: () => fetch('/api/admin/users').then(json),
  adminUsage: () => fetch('/api/admin/usage').then(json),
  adminVendorUsage: (days) => fetch(`/api/admin/vendor-usage?days=${days || 14}`).then(json),
  termsConfig: () => fetch('/api/terms-config').then(json),
  saveTermsConfig: (body) =>
    fetch('/api/terms-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '저장 실패');
      return r.json();
    }),
  validateTermsConfig: () => fetch('/api/terms-config/validate', { method: 'POST' }).then(json),

  summaries: () => fetch('/api/summaries').then(json),
  summary: (id) => fetch('/api/summaries/' + id).then(json),
  // 세션 내 즉시 요약(구조화: points/terms) — 확정 자막 기준
  sessionSummary: (id) =>
    fetch('/api/sessions/' + id + '/summary', { method: 'POST' }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '요약 실패');
      return r.json();
    }),
  createSummary: (sessionId) =>
    fetch('/api/summaries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '요약 시작 실패');
      return r.json();
    }),
  deleteSummary: (id) => fetch('/api/summaries/' + id, { method: 'DELETE' }).then(json),

  adminCreateUser: (body) =>
    fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '생성 실패');
      return r.json();
    }),
  adminDeleteUser: (id) => fetch('/api/admin/users/' + encodeURIComponent(id), { method: 'DELETE' }).then(json),
  // 관리자: 2FA / 데스크 통계 / 시스템 상태 / 오번역 검사
  admin2fa: () => fetch('/api/admin/2fa').then(json),
  admin2faSetup: () =>
    fetch('/api/admin/2fa/setup', { method: 'POST' }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '설정 시작 실패');
      return r.json();
    }),
  admin2faVerify: (code) =>
    fetch('/api/admin/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '확인 실패');
      return r.json();
    }),
  admin2faDisable: (code) =>
    fetch('/api/admin/2fa/disable', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '해제 실패');
      return r.json();
    }),
  adminDeskStats: () => fetch('/api/admin/desk-stats').then(json),
  // 자주 묻는 질문(GPT 클러스터링) / 용어 적중 분석 / 정형 안내 멘트
  adminFaqReport: () => fetch('/api/admin/faq-report').then(json),
  adminFaqAnalyze: () => fetch('/api/admin/faq-analyze', { method: 'POST' }).then(json),
  adminTermsHit: () => fetch('/api/admin/terms-hit').then(json),
  canned: () => fetch('/api/canned').then(json),
  saveCanned: (items) =>
    fetch('/api/canned', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    }).then(json),
  adminHealth: () => fetch('/api/admin/health').then(json),
  adminTermsSuggest: (sessionIds) =>
    fetch('/api/admin/terms-suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionIds && sessionIds.length ? { sessionIds } : {}),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '검사 실패');
      return r.json();
    }),
  // 관리자: 세부 로그(데스크 응대 건·일반 세션 대화)
  adminLogs: () => fetch('/api/admin/logs').then(json),
  adminDeskLog: (sid, idx) => fetch(`/api/admin/logs/desk/${encodeURIComponent(sid)}/${idx}`).then(json),
  adminSessionLog: (id) => fetch('/api/admin/logs/session/' + encodeURIComponent(id)).then(json),
  // 로그 정리(삭제): 데스크 응대 1건 / 데스크 전체 / 일반 세션 대화 기록
  adminDeleteDeskLog: (sid, idx) => fetch(`/api/admin/logs/desk/${encodeURIComponent(sid)}/${idx}`, { method: 'DELETE' }).then(json),
  adminClearDeskLogs: (sid) => fetch(`/api/admin/logs/desk/${encodeURIComponent(sid)}`, { method: 'DELETE' }).then(json),
  adminClearSessionLog: (id) => fetch('/api/admin/logs/session/' + encodeURIComponent(id), { method: 'DELETE' }).then(json),
  adminResetPassword: (id, password) =>
    fetch('/api/admin/users/' + encodeURIComponent(id) + '/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '재설정 실패');
      return r.json();
    }),
};
