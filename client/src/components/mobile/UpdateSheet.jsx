/* 안드로이드 앱 업데이트 알림 — 앱을 켤 때 서버(GitHub 릴리스)의 최신 APK 버전과 이 앱 버전을 비교해,
   새 버전이 있으면 아래에서 시트를 띄운다. '업데이트' = 앱이 직접 내려받아 안드로이드 설치 화면을 연다
   (마지막 '설치' 확인은 안드로이드 정책상 사용자가 누른다). 화면(웹)은 서버에서 오므로 원래 자동 반영 —
   이 알림은 앱 본체(네이티브)가 바뀐 경우용이다. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import LinearProgress from '@mui/material/LinearProgress';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { BottomSheet } from './common.jsx';
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

export default function UpdateSheet() {
  const [info, setInfo] = useState(null); // { cur, latest, sizeMb }
  const [pct, setPct] = useState(null);   // null=대기, 0~100 내려받는 중, 101=설치 화면, -1=실패

  useEffect(() => {
    const app = window.AndroidApp;
    if (!app || !app.version) return undefined;
    let dead = false;
    let cur = null;
    try { cur = parseVer(app.version()); } catch {}
    if (!cur) return undefined;
    api.desktopInfo().then((d) => {
      const a = d && d.android;
      const latest = a && parseVer(a.filename);
      if (dead || !latest || !newer(latest, cur)) return;
      const lv = latest.join('.');
      try {
        const [v, at] = String(localStorage.getItem(SKIP_KEY) || '').split('|');
        if (v === lv && Date.now() - Number(at) < DAY) return;
      } catch {}
      setInfo({ cur: cur.join('.'), latest: lv, sizeMb: a.size ? (a.size / 1048576).toFixed(1) : null });
    }).catch(() => {});
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    window.__kacUpd = (p) => setPct(Number(p));
    return () => { window.__kacUpd = null; };
  }, []);

  if (!info) return null;
  const app = window.AndroidApp;
  const inApp = !!(app && app.installUpdate);
  const busy = pct != null && pct >= 0 && pct <= 100;
  const later = () => {
    try { localStorage.setItem(SKIP_KEY, `${info.latest}|${Date.now()}`); } catch {}
    setInfo(null);
  };
  const go = () => {
    if (busy) return;
    if (inApp) { setPct(0); try { app.installUpdate('/download/desktop?platform=android'); } catch { setPct(-1); } return; }
    // 이 기능이 없는 구버전 앱(1.1.x): 다운로드를 브라우저로 넘긴다 — 받은 파일을 열어 설치
    window.location.href = '/download/desktop?platform=android';
  };

  return (
    <BottomSheet open onClose={busy ? () => {} : later} title="새 버전이 나왔습니다" subtitle={`AirTalk ${info.latest} · 지금 ${info.cur}`}>
      <Box sx={{ px: 3, pb: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, borderRadius: '16px', bgcolor: 'action.hover' }}>
          <SystemUpdateAltIcon sx={{ color: 'text.secondary', mt: 0.25 }} />
          <Typography sx={{ fontSize: 14, lineHeight: 1.6, color: 'text.secondary', wordBreak: 'keep-all' }}>
            {inApp
              ? `업데이트를 누르면 새 버전${info.sizeMb ? `(${info.sizeMb}MB)` : ''}을 내려받아 설치 화면을 엽니다. 설치 화면에서 '업데이트'를 누르면 끝납니다. 로그인과 설정은 그대로 유지됩니다.`
              : '업데이트를 누르면 브라우저에서 새 버전을 내려받습니다. 받은 파일을 열어 설치하세요. 로그인과 설정은 그대로 유지됩니다.'}
          </Typography>
        </Box>

        {busy && (
          <Box>
            <LinearProgress variant={pct > 0 ? 'determinate' : 'indeterminate'} value={pct} sx={{ height: 6, borderRadius: '999px' }} />
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 1, fontVariantNumeric: 'tabular-nums' }}>내려받는 중… {pct > 0 ? `${pct}%` : ''}</Typography>
          </Box>
        )}
        {pct === 101 && <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>설치 화면에서 '업데이트'를 눌러 주세요. 처음 한 번은 'AirTalk에서 앱 설치 허용'을 켜야 할 수 있습니다.</Typography>}
        {pct === -1 && <Typography sx={{ fontSize: 13.5, color: 'error.main' }}>내려받지 못했습니다. 네트워크를 확인하고 다시 눌러 주세요.</Typography>}

        <ButtonBase onClick={go} disabled={busy}
          sx={{ height: 56, borderRadius: '16px', bgcolor: 'text.primary', color: 'background.paper', fontSize: 16, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>
          {pct === -1 ? '다시 시도' : pct === 101 ? '설치 화면 다시 열기' : '업데이트'}
        </ButtonBase>
        {!busy && (
          <ButtonBase onClick={later} sx={{ height: 48, borderRadius: '16px', fontSize: 15, fontWeight: 700, color: 'text.secondary' }}>나중에</ButtonBase>
        )}
      </Box>
    </BottomSheet>
  );
}
