/* 관리자 사용량: 내부 집계(분당 요금) + 벤더 실사용량 */
import { SONIOX_API_KEY, CARTESIA_API_KEY, OPENAI_API_KEY, PRICE_WHISPER_PER_MIN, PRICE_TRANSLATE_PER_MIN } from '../../config.js';
import { usageDaily, usageHourly, vendorUsage, costOfDay } from '../../store/index.js';
import { requireAdmin } from '../../auth/index.js';
import { vendorStatus, vendorRefreshAt, kickVendorRefresh } from '../../vendors/usage.js';
import { kstDay } from '../../util/pipeline_util.js';

export function registerUsageRoutes(app) {
  // 사용량/비용 — 일별 + 합계 (관리자). 파이프라인별 분당 요금 기반.
  app.get('/api/admin/usage', requireAdmin, (req, res) => {
    const daily = Object.keys(usageDaily)
      .sort()
      .map((date) => {
        const d = usageDaily[date];
        const whisperMin = (d.whisperMs || 0) / 60000;
        const translateMin = (d.translateMs || 0) / 60000;
        return { date, whisperMin, translateMin, minutes: whisperMin + translateMin, cost: costOfDay(d) };
      });
    const hourly = Object.keys(usageHourly)
      .sort()
      .slice(-72) // 최근 72시간
      .map((hour) => {
        const d = usageHourly[hour];
        const whisperMin = (d.whisperMs || 0) / 60000;
        const translateMin = (d.translateMs || 0) / 60000;
        return { hour, whisperMin, translateMin, minutes: whisperMin + translateMin, cost: costOfDay(d) };
      });
    res.json({
      daily,
      hourly,
      totalMinutes: daily.reduce((a, d) => a + d.minutes, 0),
      totalCost: daily.reduce((a, d) => a + d.cost, 0),
      rateWhisper: PRICE_WHISPER_PER_MIN,
      rateTranslate: PRICE_TRANSLATE_PER_MIN,
    });
  });

  app.get('/api/admin/vendor-usage', requireAdmin, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 14));
    // 10분보다 오래됐으면 백그라운드로 신선화하고, 응답은 저장분으로 즉시 — 화면이 벤더 API 왕복(수 초)을 기다리지 않는다.
    // 단, 저장분이 아예 없으면(첫 부팅 직후) 한 번은 기다려 빈 화면을 피한다.
    const stale = Date.now() - vendorRefreshAt > 10 * 60e3;
    const empty = !Object.keys(vendorUsage.soniox).length && !Object.keys(vendorUsage.cartesia).length && !Object.keys(vendorUsage.openai).length;
    if (stale) {
      const p = kickVendorRefresh();
      if (empty) { try { await p; } catch {} }
    }
    const cut = kstDay(Date.now() - (days - 1) * 86400e3);
    const svcKeys = { soniox: !!SONIOX_API_KEY, cartesia: !!CARTESIA_API_KEY, openai: !!OPENAI_API_KEY };
    // 세 벤더의 일자 축을 동일하게(빈 날은 0) — 카드 간 막대가 날짜 기준으로 1:1 정렬되도록
    const axis = [];
    for (let i = days - 1; i >= 0; i--) axis.push(kstDay(Date.now() - i * 86400e3));
    const build = (k, extra) => {
      const st = { ...vendorStatus[k], serviceKey: svcKeys[k] }; // serviceKey=동작용 일반 키(사용량 조회 키와 별개)
      const all = Object.keys(vendorUsage[k]).sort();
      const hasData = all.some((d) => d >= cut);
      const days2 = hasData ? axis.map((date) => ({ date, ...(vendorUsage[k][date] || {}) })) : [];
      return { ...st, days: days2, earliest: all[0] || null, ...extra(days2) };
    };
    res.json({
      days, at: vendorRefreshAt, retention: { soniox: 91 },
      soniox: build('soniox', (ds) => {
        const byUser = {};
        for (const d of ds) for (const [uid, u] of Object.entries(d.byUser || {})) {
          const t = byUser[uid] || (byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
          t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
        }
        const users = Object.entries(byUser)
          .map(([id, u]) => ({ id, audioMin: +(u.audioMs / 60000).toFixed(1), costUsd: +u.costUsd.toFixed(4), requests: u.requests }))
          .sort((a, b) => b.costUsd - a.costUsd);
        // 파이프라인별(안내데스크/실시간 번역) 합계 — client_reference_id 의 |p: 태그 기준(구 로그는 etc)
        const byPipe = { desk: { audioMs: 0, costUsd: 0, requests: 0 }, live: { audioMs: 0, costUsd: 0, requests: 0 }, etc: { audioMs: 0, costUsd: 0, requests: 0 } };
        for (const d of ds) for (const [pk, u] of Object.entries(d.byPipe || {})) {
          const t = byPipe[pk] || byPipe.etc;
          t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
        }
        for (const t of Object.values(byPipe)) t.costUsd = +t.costUsd.toFixed(4);
        return { totalCostUsd: +ds.reduce((a, d) => a + (d.costUsd || 0), 0).toFixed(4), totalAudioMin: +(ds.reduce((a, d) => a + (d.audioMs || 0), 0) / 60000).toFixed(1), totalRequests: ds.reduce((a, d) => a + (d.requests || 0), 0), users, byPipe };
      }),
      cartesia: build('cartesia', (ds) => {
        // 파이프라인별 자체 집계(문자수 기준 — Cartesia 벤더 API 는 태그별 분해 미지원)
        const byPipe = { desk: { chars: 0, req: 0 }, live: { chars: 0, req: 0 } };
        for (const d of ds) {
          const s = vendorUsage.cartesiaSelf[d.date];
          if (!s) continue;
          for (const pk of ['desk', 'live']) { if (s[pk]) { byPipe[pk].chars += s[pk].chars || 0; byPipe[pk].req += s[pk].req || 0; } }
        }
        return { totalCredits: ds.reduce((a, d) => a + (d.credits || 0), 0), byPipe };
      }),
      openai: build('openai', (ds) => ({ totalCostUsd: +ds.reduce((a, d) => a + (d.costUsd || 0), 0).toFixed(4) })),
    });
  });
}
