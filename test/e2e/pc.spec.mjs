// PC 화면 — 주소(/s/<세션>·/desks·/admin/<탭>)와 새 화면 시험(?ui=v2)
import { test, expect } from '@playwright/test';
import { login, createSession } from './helpers.mjs';

test.use({ viewport: { width: 1280, height: 800 } });

test('세션 주소로 바로 열고, 새로고침·뒤로 가기', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E PC', preset: 'oneway' });
  await page.goto('/s/' + s.id);
  await expect(page.getByText('E2E PC').first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp('/s/' + s.id + '$'));
  await expect(page.getByText('E2E PC').first()).toBeVisible();

  await page.goto('/admin/logs');
  await expect(page).toHaveURL(/\/admin\/logs$/);
  await page.goto('/desks');
  await expect(page).toHaveURL(/\/desks$/);
  await page.goto('/s/nope-does-not-exist');
  await expect(page).toHaveURL(/\/$/);
});

test('새 화면 시험(?ui=v2) — 폰과 같은 세션 화면 + PC 설정 줄', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E V2', preset: 'twoway' });
  await page.goto('/?ui=v2');
  await page.getByText('E2E V2').first().click();
  await expect(page).toHaveURL(new RegExp('/s/' + s.id + '$'));
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  await page.getByRole('button', { name: '설정 열기' }).first().click();
  await expect(page.getByText('음성 입력')).toBeVisible();
  await expect(page.getByText('고급 설정')).toBeVisible();
  await page.goto('/?ui=v1'); // 시험 끄기(다른 테스트에 남지 않게 — 컨텍스트는 어차피 새로 만든다)
});
