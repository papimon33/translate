import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import { alpha } from '@mui/material/styles';
import DownloadIcon from '@mui/icons-material/Download';
import InstallDesktopOutlinedIcon from '@mui/icons-material/InstallDesktopOutlined';
import { api } from '../api.js';

function fmtSize(n) {
  if (!n) return '';
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

// 사용자 OS 추정 — 해당 플랫폼 다운로드를 먼저(주 버튼) 보여준다.
function detectOS() {
  const s = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent || ''}`.toLowerCase();
  if (/android/.test(s)) return 'android';
  if (/mac|iphone|ipad|ipod/.test(s)) return 'mac';
  return 'windows';
}

// 데스크톱 앱 안내 + 다운로드 모달. 프로필 메뉴 '데스크톱 앱'에서 열림.
export default function DesktopAppDialog({ open, onClose }) {
  const [info, setInfo] = useState(null); // null=로딩, {available,...}
  const [err, setErr] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInfo(null); setErr(false);
    api.desktopInfo().then(setInfo).catch(() => setErr(true));
  }, [open]);

  const os = detectOS();
  const assets = { win: info?.windows || null, mac: info?.mac || null, android: info?.android || null };
  const { win, mac, android } = assets;
  const available = !!info?.available && (!!win || !!mac || !!android);
  // 주 다운로드 = 사용자 OS(가능하면), 없으면 있는 쪽 순서대로. 보조 = 나머지 플랫폼 전부.
  const order = [os === 'android' ? 'android' : os === 'mac' ? 'mac' : 'win', 'win', 'mac', 'android'];
  const plats = [...new Set(order)].filter((p) => assets[p]);
  const primaryPlat = plats[0] || null;
  const secondaryPlats = plats.slice(1);
  const platLabel = (p) => (p === 'mac' ? 'macOS' : p === 'android' ? 'Android' : 'Windows');
  const platAsset = (p) => assets[p];
  const dlHref = (p) => `/download/desktop?platform=${p}`;

  const FEATURES = [
    { t: '통합 실행 창', d: '로그인·세션·녹음 전체 기능을 브라우저 없이 앱 하나로.' },
    { t: '줌 오버레이 자막', d: '투명·항상 위·클릭 통과 자막 창을 Zoom 화면 위에 겹쳐 표시. (PC)' },
    { t: '시스템 오디오 캡처', d: 'PC로 나오는 온라인 회의 소리도 앱에서 바로 잡아 번역. (PC)' },
    { t: '안내데스크 태블릿 앱', d: '자동 증폭(AGC) 없는 네이티브 마이크로 민감도가 그대로 듣는 대로 적용. (Android)' },
  ];

  return (
    <Dialog open={open} onClose={onClose} PaperProps={{ sx: { width: 460, maxWidth: 460 } }}>
      <DialogContent sx={{ pt: 3.5, pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.75, mb: 2 }}>
          <Box
            sx={{
              width: 48, height: 48, borderRadius: 2.5, flex: 'none', display: 'grid', placeItems: 'center',
              bgcolor: (t) => alpha(t.palette.text.primary, 0.06), color: 'text.primary',
            }}
          >
            <InstallDesktopOutlinedIcon sx={{ fontSize: 26 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.25 }}>앱 설치</Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
              Windows · macOS · Android(안내데스크 태블릿) 설치본
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mb: 2 }}>
          {FEATURES.map((f) => (
            <Box key={f.t} sx={{ display: 'flex', gap: 1.25 }}>
              <Box sx={{ mt: '7px', width: 6, height: 6, borderRadius: '50%', flex: 'none', bgcolor: 'text.disabled' }} />
              <Typography sx={{ fontSize: 13.5, color: 'text.secondary' }}>
                <Box component="span" sx={{ fontWeight: 700, color: 'text.primary' }}>{f.t}</Box> — {f.d}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* 설치 안내 3단계 */}
        <Box sx={{ borderRadius: 2, border: 1, borderColor: 'divider', p: 1.75, mb: 0.5 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', mb: 1, letterSpacing: '0.02em' }}>설치 방법</Typography>
          {['아래 버튼으로 설치파일을 내려받습니다.', '내려받은 설치파일을 실행해 안내대로 설치합니다.', '바탕화면/시작 메뉴의 아이콘으로 앱을 실행하면 바로 로그인 화면이 열립니다.'].map((s, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1.25, mb: i < 2 ? 0.75 : 0, alignItems: 'flex-start' }}>
              <Box sx={{ width: 18, height: 18, mt: '1px', flex: 'none', borderRadius: '50%', bgcolor: (t) => alpha(t.palette.text.primary, 0.08), color: 'text.primary', fontSize: 11, fontWeight: 800, display: 'grid', placeItems: 'center' }}>{i + 1}</Box>
              <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>{s}</Typography>
            </Box>
          ))}
        </Box>

        {/* 상태 */}
        <Box sx={{ mt: 2, minHeight: 24 }}>
          {info === null && !err && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={15} thickness={5} /><Typography sx={{ fontSize: 12.5 }}>설치본 확인 중…</Typography>
            </Box>
          )}
          {(err || (info && !available)) && (
            <Alert severity="info" sx={{ py: 0.5, fontSize: 12.5 }}>
              아직 배포된 설치본이 없습니다. 관리자가 새 버전을 게시하면 여기에서 바로 받을 수 있어요.
            </Alert>
          )}
          {available && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
              {info.version && <Chip size="small" label={info.version} sx={{ height: 22, fontSize: 11.5, fontWeight: 700 }} />}
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>
                {[win && 'Windows', mac && 'macOS', android && 'Android'].filter(Boolean).join(' · ')} 설치본 제공
              </Typography>
            </Box>
          )}
          {available && primaryPlat === 'mac' && (
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.75 }}>
              macOS는 서명되지 않은 앱이라 첫 실행 시 <b>우클릭 → 열기</b>로 한 번 허용해야 합니다.
            </Typography>
          )}
          {available && android && (
            <Typography sx={{ fontSize: 11.5, color: 'text.disabled', mt: 0.75 }}>
              Android(태블릿)는 스토어 밖 설치라 <b>알 수 없는 앱 설치 허용</b>을 한 번 켜야 합니다. 첫 실행에서
              서버 주소(또는 뷰어 링크)를 입력하고 마이크 권한을 허용하세요.
            </Typography>
          )}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, flexWrap: 'wrap' }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>닫기</Button>
        {/* 보조 플랫폼(다른 OS) 다운로드 링크 */}
        {available && secondaryPlats.map((p) => (
          <Button
            key={p}
            variant="text"
            href={dlHref(p)}
            sx={{ color: 'text.secondary' }}
          >
            {platLabel(p)}용 받기{platAsset(p)?.size ? ` (${fmtSize(platAsset(p).size)})` : ''}
          </Button>
        ))}
        {/* 주 다운로드(사용자 OS) */}
        <Button
          variant="contained"
          startIcon={<DownloadIcon />}
          disabled={!available || !primaryPlat}
          href={available && primaryPlat ? dlHref(primaryPlat) : undefined}
          // 같은 창에서 attachment 응답을 받으면 다운로드만 시작되고 페이지는 유지됨
        >
          {available && primaryPlat ? `${platLabel(primaryPlat)}용 다운로드${platAsset(primaryPlat)?.size ? ` (${fmtSize(platAsset(primaryPlat).size)})` : ''}` : '준비 중'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
