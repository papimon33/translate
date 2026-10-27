// 화면 자동 테스트(2026-10-27) — 폰 화면·QR 뷰어·PC 화면의 주요 흐름. 먼저 `npm run build`(dist 필요).
// 브라우저는 내려받지 않고 이 컴퓨터의 Chrome 을 쓴다(channel: 'chrome'). 실행: npm run test:e2e
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  testMatch: '*.spec.mjs',
  timeout: 30000,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:3012', channel: 'chrome', headless: true, locale: 'ko-KR' },
  webServer: { command: 'node test/e2e/server.mjs', url: 'http://127.0.0.1:3012/health', reuseExistingServer: false, timeout: 30000 },
});
