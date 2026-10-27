import { SONIOX_API_KEY, CARTESIA_ADMIN_API_KEY, OPENAI_ADMIN_API_KEY } from '../config.js';
import { vendorUsage, persistVendorUsage } from '../store/index.js';
import { kstDay } from '../util/pipeline_util.js';
import { logErr } from '../metrics.js';

/* ---- 벤더 실사용량: Soniox / Cartesia / OpenAI 사용량 API 를 직접 조회해 일별 집계 ----
   - Soniox: GET /v1/usage-logs (일반 API 키) — 요청별 오디오시간·비용(cost_usd)
   - Cartesia: GET /usage/credits (⚠ 관리자 키 CARTESIA_ADMIN_API_KEY = sk_car_admin_… 필요) — 일별 크레딧
   - OpenAI: GET /v1/organization/costs (⚠ 관리자 키 OPENAI_ADMIN_API_KEY = sk-admin-… 필요) — 일별 비용(USD)
   키가 없는 벤더는 configured=false 로 내려 UI 가 내부 집계 폴백을 안내한다. 10분 캐시(과금·쿼터 보호). */
// 벤더 사용량 API 공용 fetch — 429(레이트리밋)면 Retry-After 만큼 기다렸다 1회 재시도.
// (OpenAI costs API 는 30req/min 제한 — 재배포 직후 부팅 갱신이 겹치면 429 가 났다가 10분간 오류로 남던 문제)
async function vendorFetch(url, opts) {
  let r = await fetch(url, opts);
  if (r.status === 429) {
    const ra = Math.min(65, Math.max(2, Number(r.headers.get('retry-after')) || 20));
    await new Promise((ok) => setTimeout(ok, ra * 1000));
    r = await fetch(url, opts);
  }
  return r;
}

// 각 fetch 는 { byDay: {date: metrics} } 또는 { error } 를 반환. 미설정이면 null.
async function fetchSonioxRange(startMs, endMs) {
  const byDay = {};
  let cursor = null;
  for (let page = 0; page < 40; page++) { // 안전 상한(최대 40,000건)
    const qs = new URLSearchParams({ start_time: new Date(startMs).toISOString(), end_time: new Date(endMs).toISOString(), limit: '1000' });
    if (cursor) qs.set('cursor', cursor);
    const r = await vendorFetch('https://api.soniox.com/v1/usage-logs?' + qs, { headers: { Authorization: `Bearer ${SONIOX_API_KEY}` } });
    if (!r.ok) return { error: `Soniox ${r.status}: ${(await r.text()).slice(0, 120)}` };
    const d = await r.json();
    for (const e of d.usage_logs || []) {
      const day = kstDay(Date.parse(e.end_time || e.start_time || 0) || startMs);
      const b = byDay[day] || (byDay[day] = { audioMs: 0, costUsd: 0, requests: 0, byUser: {}, byPipe: {} });
      const ms = Number(e.input_audio_duration_ms) || 0;
      const cost = Number(e.cost_usd) || 0;
      b.audioMs += ms; b.costUsd += cost; b.requests += 1;
      // client_reference_id('u:<id>|p:<desk|live>') → 유저별·파이프라인별 집계 (미태깅 과거 요청은 anon/etc)
      const ref = String(e.client_reference_id || '');
      const um = ref.match(/^u:([^|]*)/);
      const uid = um ? um[1] : 'anon';
      const pm = ref.match(/\|p:(desk|live)/);
      const pipe = pm ? pm[1] : 'etc';
      const u = b.byUser[uid] || (b.byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
      u.audioMs += ms; u.costUsd += cost; u.requests += 1;
      const pp = b.byPipe[pipe] || (b.byPipe[pipe] = { audioMs: 0, costUsd: 0, requests: 0 });
      pp.audioMs += ms; pp.costUsd += cost; pp.requests += 1;
    }
    cursor = d.next_page_cursor;
    if (!cursor) break;
  }
  for (const k of Object.keys(byDay)) {
    byDay[k].costUsd = +byDay[k].costUsd.toFixed(4);
    for (const u of Object.values(byDay[k].byUser || {})) u.costUsd = +u.costUsd.toFixed(4);
    for (const u of Object.values(byDay[k].byPipe || {})) u.costUsd = +u.costUsd.toFixed(4);
  }
  return { byDay };
}
// Soniox 는 요청당 31일 창 제한 → 30일씩 잘라 요청(최대 90일까지 보관분 backfill)
async function fetchSoniox(spanDays) {
  if (!SONIOX_API_KEY) return null;
  const endMs = Date.now();
  const byDay = {};
  const CH = 30 * 86400e3;
  // 청크 경계(임의 시각)에 걸친 KST 하루는 두 청크에 부분합으로 나뉨 → 덮어쓰지 말고 합산 병합
  const mergeDay = (into, m) => {
    into.audioMs += m.audioMs; into.costUsd += m.costUsd; into.requests += m.requests;
    for (const [uid, u] of Object.entries(m.byUser || {})) {
      const t = into.byUser[uid] || (into.byUser[uid] = { audioMs: 0, costUsd: 0, requests: 0 });
      t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
    }
    into.byPipe = into.byPipe || {};
    for (const [pk, u] of Object.entries(m.byPipe || {})) {
      const t = into.byPipe[pk] || (into.byPipe[pk] = { audioMs: 0, costUsd: 0, requests: 0 });
      t.audioMs += u.audioMs; t.costUsd += u.costUsd; t.requests += u.requests;
    }
  };
  for (let s = endMs - spanDays * 86400e3; s < endMs; s += CH) {
    const r = await fetchSonioxRange(s, Math.min(s + CH, endMs));
    if (r.error) return r; // 에러면 저장분 보존
    for (const [date, m] of Object.entries(r.byDay)) {
      if (byDay[date]) mergeDay(byDay[date], m);
      else byDay[date] = m;
    }
  }
  for (const d of Object.values(byDay)) { d.costUsd = +d.costUsd.toFixed(4); for (const u of Object.values(d.byUser || {})) u.costUsd = +u.costUsd.toFixed(4); }
  return { byDay };
}
async function fetchCartesia(spanDays) {
  if (!CARTESIA_ADMIN_API_KEY) return null;
  const endMs = Date.now();
  const qs = new URLSearchParams({ start_ts: new Date(endMs - spanDays * 86400e3).toISOString(), end_ts: new Date(endMs).toISOString(), interval: 'day' });
  const r = await vendorFetch('https://api.cartesia.ai/usage/credits?' + qs, { headers: { Authorization: `Bearer ${CARTESIA_ADMIN_API_KEY}`, 'Cartesia-Version': '2025-04-16' } });
  if (!r.ok) return { error: `Cartesia ${r.status}: ${(await r.text()).slice(0, 120)}` };
  const d = await r.json();
  const byDay = {};
  for (const b of d.data || []) byDay[kstDay(Date.parse(b.start_ts))] = { credits: b.credits || 0 };
  return { byDay };
}
async function fetchOpenai(spanDays) {
  if (!OPENAI_ADMIN_API_KEY) return null;
  const endMs = Date.now();
  const byDay = {};
  let pageToken = null;
  // limit=기간 전체(최대 180 버킷) — 페이지네이션 왕복을 없애 30req/min 레이트리밋(429)을 피한다
  const limit = String(Math.min(180, spanDays + 2));
  for (let page = 0; page < 8; page++) {
    const qs = new URLSearchParams({ start_time: String(Math.floor((endMs - spanDays * 86400e3) / 1000)), end_time: String(Math.floor(endMs / 1000)), bucket_width: '1d', limit });
    if (pageToken) qs.set('page', pageToken);
    const r = await vendorFetch('https://api.openai.com/v1/organization/costs?' + qs, { headers: { Authorization: `Bearer ${OPENAI_ADMIN_API_KEY}` } });
    if (!r.ok) return { error: `OpenAI ${r.status}: ${(await r.text()).slice(0, 120)}` };
    const d = await r.json();
    for (const b of d.data || []) {
      const day = kstDay((b.start_time || 0) * 1000);
      // amount.value 가 문자열로 오면 합계가 문자열 연결이 돼 .toFixed 크래시 → 숫자 강제
      byDay[day] = { costUsd: +(b.results || []).reduce((a, x) => a + (Number(x.amount && x.amount.value) || 0), 0).toFixed(4) };
    }
    if (!d.has_more) break;
    pageToken = d.next_page;
    if (!pageToken) break;
  }
  return { byDay };
}

// 벤더 API 조회 → 저장소에 병합(무기한 누적). 상태(configured/error)는 메모리에 최신값 유지.
export const vendorStatus = { soniox: {}, cartesia: {}, openai: {} };
export let vendorRefreshAt = 0;
let vendorRefreshing = null;
async function refreshVendorUsage(spanDays = 90) {
  const jobs = { soniox: fetchSoniox, cartesia: fetchCartesia, openai: fetchOpenai };
  let changed = false;
  await Promise.all(Object.entries(jobs).map(async ([k, fn]) => {
    let r; try { r = await fn(spanDays); } catch (e) { r = { error: String(e.message || e) }; }
    if (r === null) { vendorStatus[k] = { configured: false }; return; }
    if (r.error) { vendorStatus[k] = { configured: true, error: r.error }; return; } // 저장분은 보존
    vendorStatus[k] = { configured: true };
    for (const [date, m] of Object.entries(r.byDay)) { vendorUsage[k][date] = m; changed = true; } // 최근일은 갱신(덮어쓰기)
  }));
  vendorRefreshAt = Date.now();
  if (changed) { try { await persistVendorUsage(); } catch (e) { logErr('vendor-usage-persist', e); } }
}
// 갱신 단일화 — 라우트/부팅/주기 타이머가 모두 이 함수로 진입해 동시 실행(429 유발)을 막는다
export function kickVendorRefresh() {
  if (!vendorRefreshing) vendorRefreshing = refreshVendorUsage().finally(() => { vendorRefreshing = null; });
  return vendorRefreshing;
}
