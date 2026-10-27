// 폰 화면(안드로이드 앱 흉내) — 목록 → 세션 → 시작 → 엔진 문장이 화면과 뷰어에 → 공유 시트 참여 코드
import { test, expect } from '@playwright/test';
import { login, createSession, qrOf, androidAudioStub, engine } from './helpers.mjs';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

test('실시간 번역 한 바퀴', async ({ page, browser }) => {
  await page.addInitScript(androidAudioStub);
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E 폰', preset: 'oneway', inLang: 'ko' });
  const qr = await qrOf(page.request, s.id);

  await page.goto('/');
  await page.getByText('E2E 폰').click();
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^TTS/ })).toHaveCount(1); // 관리자는 TTS 권한 있음(권한 없는 계정 테스트와 짝)

  const before = (await engine.conns()).total;
  await page.getByRole('button', { name: '시작' }).click();
  // 처음 시작이면 마이크 확인을 거친다
  const check = page.getByRole('dialog', { name: '마이크 확인' });
  if (await check.isVisible({ timeout: 1500 }).catch(() => false)) await check.getByRole('button', { name: /시작/ }).first().click();
  await expect(page.getByRole('button', { name: '중지' })).toBeVisible();
  await expect.poll(async () => (await engine.conns()).total, { timeout: 10000 }).toBeGreaterThan(before);

  // 뷰어도 하나 연다
  const viewer = await browser.newPage({ locale: 'ko-KR' });
  await viewer.goto('/j/' + qr.code);
  await viewer.click('#enterBtn');

  const { config } = await engine.conns();
  const target = config?.translation?.target_language;
  await engine.say([
    { text: '안녕하세요 반갑습니다.', is_final: true, language: 'ko', translation_status: 'original', confidence: 0.95 },
    ...(target && target !== 'ko' ? [{ text: 'Hello, nice to meet you.', is_final: true, language: target, translation_status: 'translation' }] : []),
  ]);
  await engine.end();
  await expect(page.getByText('안녕하세요 반갑습니다.').first()).toBeVisible({ timeout: 10000 });
  await expect(viewer.locator('#feed')).toContainText(/안녕하세요 반갑습니다|Hello, nice to meet you/, { timeout: 10000 });

  await page.getByRole('button', { name: '중지' }).click();
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();

  // 공유 시트 — 참여 코드
  await page.getByRole('button', { name: '링크 공유' }).click();
  await expect(page.getByText(qr.code)).toBeVisible();
  await viewer.close();
});

test('목록 — 안내데스크는 안 보이고, 길게 누르면 이름 바꾸기', async ({ page }) => {
  await page.addInitScript(androidAudioStub);
  await login(page.request);
  await createSession(page.request, { title: 'E2E 길게', preset: 'twoway' });
  await createSession(page.request, { title: 'E2E 폰에 안 보이는 데스크', pipeline: 'desk' }); // 안내데스크는 PC 전용
  await page.goto('/');
  await expect(page.getByText('E2E 길게')).toBeVisible();
  await expect(page.getByText('E2E 폰에 안 보이는 데스크')).toHaveCount(0);
  const row = page.getByText('E2E 길게');
  await row.dispatchEvent('contextmenu');
  await page.getByText('이름 바꾸기').click();
  const input = page.getByRole('textbox', { name: '세션 이름' });
  await input.fill('E2E 바뀐 이름');
  await input.press('Enter');
  await expect(page.getByText('E2E 바뀐 이름')).toBeVisible();
});

test('TTS 권한이 없으면 TTS 버튼이 없다', async ({ page }) => {
  await page.addInitScript(androidAudioStub);
  await login(page.request);
  await page.request.post('/api/admin/users', { data: { id: 'e2e-notts', password: 'nottspw' } });
  await page.request.post('/api/logout');
  const r = await page.request.post('/api/login', { data: { id: 'e2e-notts', password: 'nottspw', device: 'phone', replace: true } });
  expect(r.ok()).toBeTruthy();
  const s = await createSession(page.request, { title: 'E2E TTS 없음', preset: 'twoway' });
  await page.goto('/');
  await page.getByText(s.title).click();
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^TTS/ })).toHaveCount(0);
});

test('새 세션 — 단계별(모드 → 두 언어 휠 → 이름), 이름을 비우면 기본 이름', async ({ page }) => {
  await page.addInitScript(androidAudioStub);
  await login(page.request);
  await page.goto('/');
  await page.getByRole('button', { name: '새 세션' }).click();
  await expect(page.getByText('어떤 세션을 만들까요?')).toBeVisible();
  await page.getByRole('radio', { name: '양방향 통역' }).click();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('내 언어를 고르세요')).toBeVisible();
  // 휠: 상대 언어 칸으로 넘어가 일본어 줄을 누른다
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByText('상대 언어를 고르세요')).toBeVisible();
  await page.getByRole('listbox', { name: '상대 언어' }).getByRole('option', { name: '일본어' }).click();
  await expect(page.getByRole('button', { name: '상대 언어: 일본어' })).toBeVisible();
  await page.getByRole('button', { name: '다음' }).click();
  await expect(page.getByRole('textbox', { name: '세션 이름' })).toBeVisible();
  await page.getByRole('button', { name: '만들기' }).click();
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  const list = await (await page.request.get('/api/sessions')).json();
  expect(list[0].preset).toBe('twoway');
  expect(list[0].title).toMatch(/양방향 통역$/);
});

test('마이크는 시작을 누를 때 켠다(대기·설정 중엔 꺼짐)', async ({ page }) => {
  await page.addInitScript(androidAudioStub);
  await login(page.request);
  const s = await createSession(page.request, { title: 'E2E 마이크', preset: 'twoway' });
  await page.goto('/');
  await page.getByText(s.title).click();
  await expect(page.getByRole('button', { name: '시작' })).toBeVisible();
  await page.getByRole('button', { name: '설정 열기' }).first().click();
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.__aaStarts)).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '시작' }).click();
  await expect(page.getByRole('dialog', { name: '마이크 확인' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__aaStarts)).toBeGreaterThan(0);
});

