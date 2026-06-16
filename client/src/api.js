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

  authStatus: () => fetch('/api/auth-status').then(json),
  login: (password) =>
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    }).then((r) => {
      if (!r.ok) throw new Error('비밀번호가 올바르지 않습니다.');
      return r.json();
    }),
  logout: () => fetch('/api/logout', { method: 'POST' }).then(json),
};
