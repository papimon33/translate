// PC 화면 — 위 띠(로고·개인설정), 주소(/s/<세션>·/admin/<탭>), 새 세션의 안내데스크, 새 화면 시험(?ui=v2)
import { test, expect } from '@playwright/test';
import { login, createSession } from './helpers.mjs';

test.use({ viewport: { width: 1280, height: 800 } });

test('세션 주소로 바로 열고, 새로고침·없는 주소', async ({ page }) => {
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E PC', preset: 'oneway' });
  await page.goto('/s/' + s.id);
  await expect(page.getByText('E2E PC').first()).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(new RegExp('/s/' + s.id + '$'));
  await expect(page.getByText('E2E PC').first()).toBeVisible();

  await page.goto('/desks'); // 데스크 안내 메뉴는 없앴다 → 목록
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/s/nope-does-not-exist');
  await expect(page).toHaveURL(/\/$/);
});

test('개인설정 아이콘 → 관리자 페이지 탭 이동(안내데스크 탭 없음)', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '개인설정' }).click();
  await page.getByRole('menuitem', { name: '관리자 페이지' }).click();
  await expect(page).toHaveURL(/\/admin\/usage$/);
  const tabs = page.getByRole('tablist', { name: '관리자 메뉴' });
  await expect(tabs.getByRole('tab')).toHaveText(['사용량', '로그', '계정 관리', '용어 설정', '시스템·보안']);
  await tabs.getByRole('tab', { name: '로그' }).click();
  await expect(page).toHaveURL(/\/admin\/logs$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/usage$/);
  await page.goto('/admin/desks'); // 없앤 탭 → 사용량
  await expect(page).toHaveURL(/\/admin\/usage$/);
  await page.getByRole('button', { name: '세션 목록' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('새 세션 — 안내데스크는 따로, 만들면 같은 목록에', async ({ page }) => {
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('다른 세션')).toBeVisible();
  await dlg.getByText('안내데스크', { exact: true }).last().click();
  await expect(dlg.getByText('안내데스크', { exact: true }).first()).toBeVisible(); // 기본 제목이 바뀐다
  await dlg.getByRole('button', { name: '만들기' }).click();
  await expect(page).toHaveURL(/\/s\/[^/]+$/);
  const id = page.url().split('/s/')[1];
  const got = await (await page.request.get('/api/sessions/' + id)).json();
  expect(got.pipeline).toBe('desk');
  await page.goto('/');
  await expect(page.getByText('안내데스크', { exact: true }).first()).toBeVisible();
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
  await page.goto('/?ui=v1');
});

test('같은 계정으로 다른 PC 로그인 — 확인 창, 이전 PC 는 이유와 함께 로그인 화면', async ({ browser, request }) => {
  await login(request);
  await request.post('/api/admin/users', { data: { id: 'e2e-kim', password: 'kimpw1', perms: { tts: false, desk: false } } });
  const signIn = async (page) => {
    await page.goto('/');
    await page.getByLabel('ID').fill('e2e-kim');
    await page.getByLabel('비밀번호').fill('kimpw1');
    await page.getByRole('button', { name: '로그인' }).click();
  };
  const a = await browser.newPage();
  await signIn(a);
  await expect(a.getByRole('button', { name: '개인설정' })).toBeVisible();

  const b = await browser.newPage();
  await signIn(b);
  const dlg = b.getByRole('dialog');
  await expect(dlg.getByText('다른 기기에서 사용 중인 계정입니다')).toBeVisible();
  await dlg.getByRole('button', { name: '로그인' }).click();
  await expect(b.getByRole('button', { name: '개인설정' })).toBeVisible();

  await a.reload();
  await expect(a.getByText('다른 기기에서 이 계정으로 로그인해 로그아웃되었습니다.')).toBeVisible();
  await a.close();
  await b.close();
});

test('관리자 > 계정 관리 — 권한 스위치', async ({ page }) => {
  await login(page.request);
  await page.request.post('/api/admin/users', { data: { id: 'e2e-lee', password: 'leepw1' } });
  await page.goto('/admin/accounts');
  const sw = page.getByRole('switch', { name: 'e2e-lee TTS' });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();
  const users = await (await page.request.get('/api/admin/users')).json();
  expect(users.find((u) => u.id === 'e2e-lee').perms).toEqual({ tts: true, desk: false });
});

test('안내데스크 권한이 없으면 새 세션 창에 안내데스크 항목이 없다', async ({ page }) => {
  await login(page.request);
  await page.request.post('/api/admin/users', { data: { id: 'e2e-nodesk', password: 'nodeskpw' } });
  await page.request.post('/api/logout');
  expect((await page.request.post('/api/login', { data: { id: 'e2e-nodesk', password: 'nodeskpw', replace: true } })).ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).first().click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('실시간 번역', { exact: true })).toBeVisible();
  await expect(dlg.getByText('다른 세션')).toHaveCount(0);
});

test('로그인 화면 — 로그인 버튼 아래 데스크톱 앱 받기 링크', async ({ page }) => {
  await page.goto('/');
  const a = page.getByRole('link', { name: '데스크톱 앱 받기' });
  await expect(a).toBeVisible();
  expect(await a.getAttribute('href')).toMatch(/^\/download\/desktop\?platform=(mac|win)$/);
});
