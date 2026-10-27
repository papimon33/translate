/* 세션 목록 줄 공용 — 폰 홈(MobileApp)과 PC 새 화면 목록(SessionList v2)이 같이 쓴다.
   부제 '10/24 · 한국어 ⇄ 중국어'(오늘이면 시각) + 모드 아이콘(실시간 번역 →, 양방향 통역 ⇄). */
import React from 'react';
import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import { ArrowRightIcon, SwapIcon } from './icons.jsx';

export const isTwoPreset = (preset) => ['twoway', 'mobile', 'field', 'meeting'].includes(preset);

export function shortDate(ts, locale) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 세션의 언어: 이 기기에서 마지막으로 쓴 값(localStorage) → 서버에 저장된 값 순. 모르면 모드 이름(labels.two / labels.one).
export function sessionLangs(s, langName, labels) {
  let pair = null, target = null;
  try { pair = localStorage.getItem('kac-sx-pair:' + s.id); target = localStorage.getItem('kac-sx-target:' + s.id); } catch {}
  const sx = s.sxInfo || {};
  if (isTwoPreset(s.preset)) {
    const [a, b] = pair ? pair.split('|') : [sx.a, sx.b];
    return a && b ? `${langName(a)} ⇄ ${langName(b)}` : labels.two;
  }
  const out = target || sx.target;
  const src = s.inLang && s.inLang !== 'auto' ? s.inLang : null;
  if (!out) return labels.one;
  return src ? `${langName(src)} → ${langName(out)}` : `→ ${langName(out)}`;
}

export function ModeIcon({ preset, size = 46 }) {
  const two = isTwoPreset(preset);
  const Icon = two ? SwapIcon : ArrowRightIcon;
  return (
    <Box sx={{ width: size, height: size, flex: 'none', borderRadius: size >= 44 ? '14px' : '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (t) => (two ? alpha(t.palette.accent.main, t.palette.mode === 'dark' ? 0.22 : 0.1) : alpha(t.palette.text.primary, 0.06)), color: (t) => (two ? (t.palette.mode === 'dark' ? t.palette.accent.main : '#1F5BBF') : t.palette.text.primary) }}>
      <Icon strokeWidth={2.4} sx={{ fontSize: size >= 44 ? 22 : 20 }} />
    </Box>
  );
}
