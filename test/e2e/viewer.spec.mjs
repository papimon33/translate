// QR 뷰어(/j) — 코드 입력·코드 주소 입장·예전 주소 이동
import { test, expect } from '@playwright/test';
import { login, createSession, qrOf } from './helpers.mjs';

test('코드 없이 /j — 입력 칸, 없는 코드는 안내', async ({ page }) => {
  await page.goto('/j');
  await expect(page.locator('#codeBox')).toBeVisible();
  await page.fill('#codeInput', 'zzzzzz');
  await expect(page.locator('#codeInput')).toHaveValue('ZZZZZZ');
  await page.click('#codeBtn');
  await expect(page.locator('#codeErr')).not.toBeEmpty();
});

test('/j/<코드> — 세션 이름이 보이고 입장된다, 예전 주소는 새 주소로', async ({ page, request }) => {
  await login(request);
  const s = await createSession(request, { title: 'E2E 뷰어', preset: 'oneway' });
  const qr = await qrOf(request, s.id);
  expect(qr.code).toMatch(/^[0-9A-Z]{6}$/);
  expect(qr.url).toContain('/j/' + qr.code);

  await page.goto('/j/' + qr.code.toLowerCase());
  await expect(page.locator('#lTitle')).toHaveText('E2E 뷰어');
  await page.click('#enterBtn');
  await expect(page.locator('#title')).toHaveText('E2E 뷰어');
  // 공유 시트에 참여 코드
  await page.click('#qrBtn');
  await expect(page.locator('#qrCode')).toContainText(qr.code);

  // 코드 입력으로도 같은 곳
  await page.goto('/j');
  await page.fill('#codeInput', qr.code);
  await page.click('#codeBtn');
  await expect(page).toHaveURL(new RegExp('/j/' + qr.code + '$'));

  const t = await (await request.get('/api/join/' + qr.code)).json();
  const r = await request.get(`/mobile.html?session=${s.id}&t=${t.t}`, { maxRedirects: 0 });
  expect(r.status()).toBe(301);
  expect(r.headers().location).toBe('/j/' + qr.code);
});
