/* 폰 화면 옵션 — 기기 localStorage 가 즉시 적용되는 원본이고, 계정 항목은 서버(PATCH /api/me prefs)에 사본을 둔다
   (다른 폰·재설치 후에도 같은 설정). App 첫 번들에서 테마 계산에 쓰므로 MUI 를 끌어오지 않는다. */
import { useSyncExternalStore } from 'react';
import { api } from '../../api.js';

// 계정에 동기화하는 항목 → 저장 키. fontScale·ttsGender 는 세션 화면(TranslateView)이 원래 쓰던 키 그대로.
const SYNCED = {
  sysLang: 'kac-sys-lang',
  nativeLang: 'kac-native-lang',
  theme: 'kac-theme-pref',
  fontScale: 'kac-font-scale',
  ttsGender: 'kac-sx-gender',
};
// 기기 전용 — 입력 감도는 마이크·폰마다 맞는 값이 달라 계정에 올리지 않는다
const LOCAL = { micSens: 'kac-mic-sens', micSens2: 'kac-mic-sens2', micAuto: 'kac-mic-auto' }; // micSens2: 송신기 2(오른쪽) 감도, micAuto: 자동 감도(주변 소음 기준)

const UI_LANGS = ['ko', 'en', 'ja'];
const VALID = {
  sysLang: (v) => UI_LANGS.includes(v),
  nativeLang: (v) => typeof v === 'string' && /^[a-z]{2,3}$/.test(v),
  theme: (v) => ['light', 'dark', 'system'].includes(v),
  fontScale: (v) => typeof v === 'number' && v >= 0.8 && v <= 1.6,
  ttsGender: (v) => v === 'f' || v === 'm',
  micSens: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  micSens2: (v) => typeof v === 'number' && v >= 0 && v <= 100,
  micAuto: (v) => typeof v === 'boolean',
};
const BOOL = { micAuto: true };
const NUMERIC = { fontScale: true, micSens: true, micSens2: true };

function deviceLang() {
  const l = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  return l ? 'en' : 'ko';
}
function defaults() {
  let oldTheme = null; // 옵션 이전엔 계정 메뉴의 밝은/어두운 화면 토글(kac-theme)이었다
  try { oldTheme = localStorage.getItem('kac-theme'); } catch {}
  return { sysLang: deviceLang(), nativeLang: 'ko', theme: oldTheme === 'dark' ? 'dark' : 'light', fontScale: 1, ttsGender: 'f', micSens: 100, micSens2: 100, micAuto: false };
}

function readAll() {
  const d = defaults();
  const out = { ...d };
  for (const [k, key] of Object.entries({ ...SYNCED, ...LOCAL })) {
    let raw = null;
    try { raw = localStorage.getItem(key); } catch {}
    if (raw == null) continue;
    const v = NUMERIC[k] ? Number(raw) : BOOL[k] ? raw === '1' : raw;
    if (VALID[k](v)) out[k] = v;
  }
  return out;
}

let cache = typeof window === 'undefined' ? defaults() : readAll();
const subs = new Set();
const notify = () => subs.forEach((f) => { try { f(); } catch {} });

export function getPrefs() { return cache; }
export function subscribePrefs(fn) { subs.add(fn); return () => subs.delete(fn); }
export function usePrefs() { return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs); }

// 서버 동기화는 슬라이더처럼 연달아 바뀌는 값을 모아 한 번에
let pending = {};
let syncTimer = null;
function queueSync(k, v) {
  pending[k] = v;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const prefs = pending;
    pending = {};
    api.updateMe({ prefs }).catch(() => {}); // 실패해도 이 기기에는 이미 적용됨 — 다음 변경 때 다시 올라간다
  }, 700);
}

export function setPref(k, v) {
  if (!VALID[k] || !VALID[k](v)) return;
  const key = SYNCED[k] || LOCAL[k];
  try { localStorage.setItem(key, BOOL[k] ? (v ? '1' : '0') : String(v)); } catch {}
  cache = { ...cache, [k]: v };
  notify();
  if (SYNCED[k]) queueSync(k, v);
}

// 로그인 직후 1회: 서버에 저장된 값이 있으면 그걸 따르고(다른 기기에서 바꾼 설정), 없으면 이 기기 값을 올린다.
export function syncWithAccount(user) {
  const sp = (user && user.prefs) || {};
  const next = { ...cache };
  let had = false;
  for (const k of Object.keys(SYNCED)) {
    if (sp[k] != null && VALID[k](sp[k])) {
      had = true;
      next[k] = sp[k];
      try { localStorage.setItem(SYNCED[k], String(sp[k])); } catch {}
    }
  }
  if (had) { cache = next; notify(); return; }
  if (!user) return;
  const up = {};
  for (const k of Object.keys(SYNCED)) up[k] = cache[k];
  api.updateMe({ prefs: up }).catch(() => {});
}

// 테마 옵션 → 실제 화면 모드. '시스템'이면 기기 설정을 따른다.
export function resolveTheme(pref) {
  if (pref === 'dark' || pref === 'light') return pref;
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
