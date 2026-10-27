/* AirTalk 서버 진입점 — 앱·HTTP 서버 생성, 미들웨어(순서 중요), 부팅 순서(저장소 로드 → 용어·세션 마이그레이션 → 인증 점검),
   라우트 등록(구 server.js 와 같은 순서, SPA 폴백 `*` 는 마지막), WebSocket 연결, listen.
   기능별 코드는 server/ 하위 모듈(config·store·auth·routes·realtime·pipelines·vendors·desk·util). 루트 server.js 는 이 파일을 import 하는 shim. */
import 'dotenv/config';
import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { PORT, STATIC_DIR, SONIOX_API_KEY, CARTESIA_ADMIN_API_KEY, OPENAI_ADMIN_API_KEY } from './config.js';
import { logErr } from './metrics.js';
import { loadStore, sessions, dirtySessions, flushSessions, flushUsers, flushUsage } from './store/index.js';
import { initTermsConfig } from './store/terms.js';
import { migrateSessions } from './store/sessions.js';
import { authBootCheck, loadSecurityCfg } from './auth/index.js';
import { forceHttps, securityHeaders, csrfGuard } from './auth/middleware.js';
import { kickVendorRefresh } from './vendors/usage.js';
import { getLanIp } from './util/net_util.js';
import { attachRealtime } from './realtime/index.js';
import { registerViewerAssetRoutes, registerJoinRoutes } from './routes/join.js';
import { registerMeRoutes } from './routes/me.js';
import { registerSystemRoutes, registerDataRoutes } from './routes/admin/system.js';
import { registerLogRoutes } from './routes/admin/logs.js';
import { registerTermsAdminRoutes, registerTermsConfigRoutes } from './routes/terms.js';
import { registerDeskStatusRoutes, registerDeskRegistryRoutes } from './routes/desks.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/admin/accounts.js';
import { registerUsageRoutes } from './routes/admin/usage.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerDownloadRoutes } from './routes/downloads.js';
import { registerMiscRoutes } from './routes/misc.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Render 등 프록시 뒤 — req.ip / x-forwarded-* 신뢰

// FORCE_HTTPS=1: http 접속을 https 로 301 리다이렉트(프록시 뒤에선 x-forwarded-proto 기준).
// Render 등 관리형 호스팅은 자체적으로 https 를 강제하므로 자가 호스팅에서만 필요.
if (process.env.FORCE_HTTPS === '1') app.use(forceHttps); // auth/middleware.js

// 보안 헤더
app.use(securityHeaders);
// CSRF 완화: /api 의 상태변경 요청은 동일 출처만 허용(쿠키 인증 보호)
app.use(csrfGuard);
// JSON 바디 한도 차등: 기본 256kb(무인증 엔드포인트 대용량 파싱 DoS 방지),
// 용어집 CSV 업로드(수천 행)가 오는 /api/terms-config 만 16mb 허용.
const bigJson = express.json({ limit: '16mb' });
const smallJson = express.json({ limit: '256kb' });
app.use((req, res, next) => (req.path === '/api/terms-config' ? bigJson : smallJson)(req, res, next));
// 빌드된 React 앱(dist) 서빙
if (!fs.existsSync(STATIC_DIR)) {
  console.warn('\n[경고] dist 폴더가 없습니다. 먼저 `npm run build` 를 실행하세요. (npm start 는 자동 빌드)\n');
}
app.use(express.static(STATIC_DIR));
// 데스크 뷰어 자산(2.5D 맵 2개)·PWA manifest — routes/join.js
registerViewerAssetRoutes(app);

const server = http.createServer(app);

/* ---- 부팅: 저장소 로드 → 용어 시드/마이그레이션 → 세션 이전 → 인증 점검 (구 server.js 와 같은 순서·같은 로그) ---- */
await loadStore();
await initTermsConfig();
migrateSessions();
authBootCheck();

/* ---- 프로세스 오류·종료 처리 ---- */
process.on('uncaughtException', (e) => logErr('uncaught', e));
// 재배포·재시작(SIGTERM/SIGINT) 시 디바운스 저장분(세션 ~400ms·사용량 ~1s) 유실 방지 — flush 후 종료
let shuttingDown = false;
async function gracefulShutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig} — 미저장 변경 flush 후 종료`);
  try {
    for (const s of sessions) dirtySessions.add(s.id);
    await Promise.allSettled([flushSessions(), flushUsers(), flushUsage()]);
  } catch {}
  process.exit(0);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (e) => logErr('unhandledRejection', e));

loadSecurityCfg(); // 관리자 2FA 시크릿(data/security.json)

/* ---- REST 라우트 — 구 server.js 와 같은 등록 순서 ---- */
registerMeRoutes(app);
registerSystemRoutes(app);
registerLogRoutes(app);
registerTermsAdminRoutes(app);
registerDeskStatusRoutes(app);
registerDataRoutes(app);
registerDeskRegistryRoutes(app);
registerAuthRoutes(app);
registerAccountRoutes(app);
registerUsageRoutes(app);
registerTermsConfigRoutes(app);
registerSessionRoutes(app);
registerDownloadRoutes(app);
registerJoinRoutes(app);
registerMiscRoutes(app);

/* SPA 폴백: API 외 GET 은 React index.html */
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  const idx = path.join(STATIC_DIR, 'index.html');
  if (fs.existsSync(idx)) return res.sendFile(idx);
  next();
});

// WebSocket(/ws/host·/ws/viewer) 업그레이드·하트비트 — realtime/index.js
attachRealtime(server);

server.listen(PORT, () => {
  const ip = getLanIp();
  console.log(`\n  AirTalk 서버 실행 중`);
  console.log(`  · 데스크톱:  http://localhost:${PORT}`);
  console.log(`  · 같은 와이파이 모바일: http://${ip}:${PORT}\n`);
});

// 벤더 사용량 주기 신선화(12h) — 관리자가 화면을 안 봐도 일별 실사용량이 계속 누적되어
// 벤더 API 보관기간(예: Soniox 91일)이 지나도 앱에는 기록이 남는다. 키가 하나라도 있을 때만.
if (SONIOX_API_KEY || CARTESIA_ADMIN_API_KEY || OPENAI_ADMIN_API_KEY) {
  setTimeout(() => kickVendorRefresh().catch((e) => logErr('vendor-usage-boot', e)), 8000); // 부팅 직후 1회
  setInterval(() => kickVendorRefresh().catch((e) => logErr('vendor-usage-cron', e)), 12 * 3600e3); // 라우트 갱신과 동시 실행 방지(공용 가드)
}
