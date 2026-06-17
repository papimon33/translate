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
  login: (id, password) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '로그인 실패');
      return r.json();
    }),
  logout: () => fetch('/api/logout', { method: 'POST' }).then(json),

  adminUsers: () => fetch('/api/admin/users').then(json),
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
};
