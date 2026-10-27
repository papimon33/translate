/* 경량 모니터링 상태 — 저장소(저장 실패)·데스크 기록 상한·라우트(관리자 시스템 상태)·실시간이 함께 쓴다.
   의존성 없는 말단 모듈(순환 import 방지). */
/* ---- 경량 모니터링: 프로세스 상태 + 최근 오류(서버·클라이언트) ---- */
export const metrics = { startedAt: Date.now(), errors: [], clientErrors: [], saveFail: null, deskLogFull: [] };
export function logErr(scope, err) {
  const e = { at: Date.now(), scope, msg: String((err && err.message) || err).slice(0, 300) };
  metrics.errors.push(e);
  if (metrics.errors.length > 100) metrics.errors.shift();
  console.error(`[${scope}]`, (err && err.stack) || err);
}
