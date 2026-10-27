/* 운영 도메인(PUBLIC_HOST, 2026-10-27): 어느 주소로 접속했든 QR(뷰어 링크)은 https://<PUBLIC_HOST> 를 가리킨다 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, loginAdmin } from './helpers/boot.mjs';

test('QR: PUBLIC_HOST 가 있으면 뷰어 링크는 그 도메인(https)', { timeout: 30000 }, async (t) => {
  const srv = await bootServer({ PUBLIC_HOST: 'airtalk.kr' });
  t.after(() => srv.stop());
  const cookie = await loginAdmin(srv.base);
  const auth = { headers: { 'Content-Type': 'application/json', Cookie: cookie } };
  const s = await fetch(`${srv.base}/api/sessions`, { method: 'POST', ...auth, body: JSON.stringify({ title: 'QR', pipeline: 'soniox', preset: 'oneway' }) }).then((r) => r.json());
  const qr = await fetch(`${srv.base}/api/qr?session=${s.id}`, auth).then((r) => r.json());
  assert.equal(qr.url, `https://airtalk.kr/j/${qr.code}`);
  const landing = await fetch(`${srv.base}/api/qr?landing=1`, auth).then((r) => r.json());
  assert.equal(landing.url, 'https://airtalk.kr/desk');
});
