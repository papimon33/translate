/* 안드로이드 앱 업데이트 알림 — 앱을 켤 때 서버(GitHub 릴리스)의 최신 APK 버전과 이 앱 버전을 비교해,
   새 버전이 있으면 아래에서 시트를 띄운다. '업데이트' = 앱이 직접 내려받아 안드로이드 설치 화면을 연다
   (마지막 '설치' 확인은 안드로이드 정책상 사용자가 누른다). 화면(웹)은 서버에서 오므로 원래 자동 반영 —
   이 알림은 앱 본체(네이티브)가 바뀐 경우용이다. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { BottomSheet } from './common.jsx';
import { useT } from './i18n.js';
import { api } from '../../api.js';

const SKIP_KEY = 'kac-upd-skip'; // '나중에' — 같은 버전은 하루 동안 다시 묻지 않는다
const DAY = 24 * 60 * 60 * 1000;

function parseVer(s) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(s || ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function newer(a, b) { // a > b ?
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}

// 이 앱 버전과 서버(GitHub 릴리스)의 최신 APK 버전 — 홈의 자동 알림·설정의 '버전' 줄이 같이 쓴다
function readCur() {
  try { const a = window.AndroidApp; const v = a && a.version ? parseVer(a.version()) : null; return v ? v.join('.') : null; } catch { return null; }
}
export function useAppVersion() {
  const [v, setV] = useState(() => ({ cur: readCur(), latest: null, sizeMb: null }));
  useEffect(() => {
    if (!v.cur) return undefined;
    let dead = false;
    api.desktopInfo().then((d) => {
      const a = d && d.android;
      const l = a && parseVer(a.filename);
      if (!dead && l) setV((o) => ({ ...o, latest: l.join('.'), sizeMb: a.size ? (a.size / 1048576).toFixed(1) : null }));
    }).catch(() => {});
    return () => { dead = true; };
    // eslint-disable-next-line
  }, []);
  const hasNew = !!(v.cur && v.latest && newer(parseVer(v.latest), parseVer(v.cur)));
  return { ...v, hasNew };
}

/* manual=false(홈): 새 버전이 있으면 저절로 뜬다('나중에' = 같은 버전 하루 동안 안 물음).
   manual=true(설정의 '업데이트' 링크): open 일 때만 뜨고 '나중에' 기록과 무관. */
export default function UpdateSheet({ manual = false, open = false, onClose }) {
  const t = useT();
  const ver = useAppVersion();
  const [dismissed, setDismissed] = useState(false);
  const [pct, setPct] = useState(null);   // null=대기, 0~100 내려받는 중, 101=설치 화면, -1=실패

  useEffect(() => {
    window.__kacUpd = (p) => setPct(Number(p));
    return () => { window.__kacUpd = null; };
  }, []);

  const skipped = (() => {
    if (manual || !ver.latest) return false;
    try { const [v, at] = String(localStorage.getItem(SKIP_KEY) || '').split('|'); return v === ver.latest && Date.now() - Number(at) < DAY; } catch { return false; }
  })();
  const visible = ver.hasNew && (manual ? open : !dismissed && !skipped);
  if (!visible) return null;
  const info = ver;
  const app = window.AndroidApp;
  const inApp = !!(app && app.installUpdate);
  const busy = pct != null && pct >= 0 && pct <= 100;
  const later = () => {
    if (manual) { if (onClose) onClose(); return; }
    try { localStorage.setItem(SKIP_KEY, `${info.latest}|${Date.now()}`); } catch {}
    setDismissed(true);
  };
  const go = () => {
    if (busy) return;
    if (inApp) { setPct(0); try { app.installUpdate('/download/desktop?platform=android'); } catch { setPct(-1); } return; }
    // 이 기능이 없는 구버전 앱(1.1.x): 다운로드를 브라우저로 넘긴다 — 받은 파일을 열어 설치
    window.location.href = '/download/desktop?platform=android';
  };

  // 설명 문구 없이 버전과 버튼만(2026-10-21 시안) — 설치 화면 안내는 내려받은 뒤에만 보인다
  return (
    <BottomSheet open onClose={busy ? () => {} : later} title={t('updateTitle')}>
      <Box sx={{ px: 3, pb: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 15, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          <span>AirTalk {info.cur}</span>
          <ArrowForwardIcon sx={{ fontSize: 18 }} />
          <Box component="b" sx={{ color: 'text.primary' }}>{info.latest}</Box>
        </Box>

        {busy && (
          <Box>
            <LinearProgress variant={pct > 0 ? 'determinate' : 'indeterminate'} value={pct} sx={{ height: 6, borderRadius: '999px' }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1, fontVariantNumeric: 'tabular-nums' }}>{t('downloading', { p: pct > 0 ? `${pct}%` : '' })}</Typography>
          </Box>
        )}
        {pct === 101 && <Typography sx={{ fontSize: 13.5, color: 'text.secondary', wordBreak: 'keep-all' }}>{t('installHint')}</Typography>}
        {pct === -1 && <Typography sx={{ fontSize: 13.5, color: 'error.main' }}>{t('downloadFail')}</Typography>}

        <ButtonBase onClick={go} disabled={busy}
          sx={{ height: 56, borderRadius: '16px', bgcolor: 'text.primary', color: 'background.paper', fontSize: 16, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          {pct === -1 ? t('retry') : pct === 101 ? t('reopenInstall') : info.sizeMb ? t('updateSize', { mb: info.sizeMb }) : t('update')}
        </ButtonBase>
        {!busy && (
          <ButtonBase onClick={later} sx={{ height: 48, borderRadius: '16px', fontSize: 15, fontWeight: 700, color: 'text.secondary' }}>{t('later')}</ButtonBase>
        )}
      </Box>
    </BottomSheet>
  );
}
