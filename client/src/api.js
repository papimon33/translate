const json = (r) => r.json();

export const api = {
  list: () => fetch('/api/sessions').then(json),
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
  deskLandingQr: () => fetch('/api/qr?desk=1').then(json),

  me: () => fetch('/api/me').then(json),
  login: (id, password, remember) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password, remember: !!remember }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '로그인 실패');
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
