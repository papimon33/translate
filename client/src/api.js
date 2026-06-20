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
  glossaryList: () => fetch('/api/glossary').then(json),

  summaries: () => fetch('/api/summaries').then(json),
  summary: (id) => fetch('/api/summaries/' + id).then(json),
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

  adminGlossary: () => fetch('/api/admin/glossary').then(json),
  adminUploadGlossary: (csv) =>
    fetch('/api/admin/glossary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '업로드 실패');
      return r.json();
    }),
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
