/* 안드로이드 앱 폰 화면 공용 조각 — 바텀 시트·언어 선택·마이크 장치 이름.
   웹 티(PC식 드롭다운·작은 버튼)를 없애는 게 목적이라 선택은 전부 아래에서 올라오는 시트로 한다. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Drawer from '@mui/material/Drawer';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import CheckIcon from '@mui/icons-material/Check';

export { MOBILE_UI } from './env.js';

export function rel(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return new Date(ts).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' });
}

export function langName(code, ...lists) {
  for (const l of lists) { const f = l.find((x) => x.code === code); if (f) return f.label; }
  return code;
}

/* 지금 쓰는(또는 시작하면 쓸) 마이크 이름 — 네이티브가 USB 수신기 등을 고른 결과를 2초마다 읽는다.
   구버전 앱(브리지에 inputLabel 없음)·브라우저에선 '마이크'. */
export function useMicLabel() {
  const read = () => {
    try { const a = window.AndroidAudio; if (a && a.inputLabel) return String(a.inputLabel() || ''); } catch {}
    return '';
  };
  const [label, setLabel] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setLabel(read()), 2000);
    return () => clearInterval(t);
  }, []);
  const name = label || '마이크';
  return { name, external: /^(USB|유선)/.test(name) };
}

export function BottomSheet({ open, onClose, title, subtitle, action, children, maxHeight = '86dvh' }) {
  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { borderTopLeftRadius: '28px', borderTopRightRadius: '28px', maxHeight, bgcolor: 'background.paper', backgroundImage: 'none', pb: 'env(safe-area-inset-bottom)' } }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, maxHeight }}>
        <Box sx={{ alignSelf: 'center', width: 40, height: 4, borderRadius: '999px', bgcolor: 'divider', mt: 1.25, mb: 1.5 }} />
        {(title || action) && (
          <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, px: 3, pb: 1.5 }}>
            <Box sx={{ minWidth: 0 }}>
              <Typography component="h2" sx={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.015em' }}>{title}</Typography>
              {subtitle && <Typography sx={{ fontSize: 14, color: 'text.secondary', mt: 0.25 }}>{subtitle}</Typography>}
            </Box>
            {action}
          </Box>
        )}
        {children}
      </Box>
    </Drawer>
  );
}

/* 언어 선택 시트. tabs: [{ key, label, value, options:[{code,label,sub?}], onPick }] — 둘 이상이면 상단 세그먼트로 전환.
   단일 탭이면 고르는 즉시 닫힌다(한 번 탭 = 선택 완료). */
export function LangSheet({ open, onClose, title, subtitle, tabs, startTab = 0 }) {
  const [tab, setTab] = useState(startTab);
  useEffect(() => { if (open) setTab(startTab); }, [open, startTab]);
  const cur = tabs[Math.min(tab, tabs.length - 1)];
  const multi = tabs.length > 1;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      action={multi ? (
        <ButtonBase onClick={onClose} sx={{ height: 40, px: 2, borderRadius: '999px', bgcolor: 'action.hover', fontSize: 14, fontWeight: 700, flex: 'none' }}>완료</ButtonBase>
      ) : null}
    >
      {multi && (
        <Box role="tablist" sx={{ mx: 3, mb: 1.5, p: 0.5, borderRadius: '999px', bgcolor: 'action.hover', display: 'grid', gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, gap: 0.5 }}>
          {tabs.map((t, i) => (
            <ButtonBase
              key={t.key}
              role="tab"
              aria-selected={i === tab}
              onClick={() => setTab(i)}
              sx={{ height: 40, borderRadius: '999px', fontSize: 14, fontWeight: 700, color: i === tab ? 'text.primary' : 'text.secondary', bgcolor: i === tab ? 'background.paper' : 'transparent', boxShadow: i === tab ? '0 1px 3px rgba(0,0,0,0.12)' : 'none', display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}
            >
              <span>{t.label}</span>
              <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 500, color: 'text.secondary' }}>{langName(t.value, t.options)}</Typography>
            </ButtonBase>
          ))}
        </Box>
      )}
      <Box sx={{ overflowY: 'auto', px: 1.5, pb: 2, minHeight: 0 }}>
        {cur.options.map((o) => {
          const on = o.code === cur.value;
          return (
            <ButtonBase
              key={o.code}
              onClick={() => { cur.onPick(o.code); if (!multi) onClose(); }}
              sx={{ width: '100%', minHeight: 56, px: 2, borderRadius: '16px', justifyContent: 'space-between', textAlign: 'left', bgcolor: on ? 'action.hover' : 'transparent' }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography sx={{ fontSize: 16.5, fontWeight: 700 }}>{o.label}</Typography>
                {o.sub && <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{o.sub}</Typography>}
              </Box>
              {on && <CheckIcon aria-label="선택됨" sx={{ fontSize: 22 }} />}
            </ButtonBase>
          );
        })}
      </Box>
    </BottomSheet>
  );
}
