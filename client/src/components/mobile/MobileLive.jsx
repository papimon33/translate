/* 안드로이드 앱 폰 화면 — 세션 화면(레이아웃 전용). 디스코드 음성 채널 화면 참고(2026-10-26).
   상태·엔진 로직은 TranslateView 가 그대로 갖고, 이 파일은 그 값을 받아 그리기만 한다.
   · 위: 세션 이름(표시만) · 오른쪽에 이 폰 소리(스피커)·링크 공유(QR)
   · 아래: 떠 있는 회색 조작판(음소거·TTS·시작/중지·언어·종료) — 위로 밀거나 손잡이를 누르면 큰 설정(입력·출력·세션)
   · 번역을 시작하면 위·아래를 숨기고 화면을 누르면 4초간 보인다 */
import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import SwipeableDrawer from '@mui/material/SwipeableDrawer';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import { alpha } from '@mui/material/styles';
import { BottomSheet, LangSheet, ConfirmDialog, FormSheet, PickSheet, SensSlider, MicSheet, ChannelMeters, Group, OptionRow, langOptions, useMicInputs, useIdleMeter, useBackClose, micCurrentName } from './common.jsx';
import { useT } from './i18n.js';
import { MicIcon, MicOffIcon, PlayIcon, QrIcon, LogOutIcon, TranslateIcon, TtsIcon, VolumeOffIcon, VolumeOnIcon } from './icons.jsx';
import { BRAND, BRAND_SOFT } from '../../brand.js';
import { api } from '../../api.js';

const BLUE = '#1F5BBF';
// 조작판 회색(디스코드의 떠 있는 바) — 대화 배경(흰색)과 구분. 버튼은 배경 없이 아이콘만(시작=보라 사각형만 예외).
const PANEL_BG = (th) => (th.palette.mode === 'dark' ? '#2B2D31' : '#F1F1F4');
const SOFT_BG = (th) => (th.palette.mode === 'dark' ? alpha(BRAND, 0.28) : BRAND_SOFT); // 켜짐 표시(옅은 보라)

// 원문이 표시 문장과 같으면(같은 언어 기록) 작은 줄을 생략 — 데스크톱 Row 와 같은 규칙
function sameText(a, b) { return String(a || '').trim() === String(b || '').trim(); }

// 실시간 번역: 번역문(큰 글씨) + 원문(작은 회색). 번역 대기·진행 중은 회색.
export function Line({ text, source, draft, scale, t }) {
  const pending = !text && !!source;
  const main = pending ? source : text;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
      <Typography sx={{ fontSize: Math.round(22 * scale), fontWeight: 500, lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere', color: pending || draft ? 'text.secondary' : 'text.primary' }}>
        {main}
      </Typography>
      {!pending && source && !sameText(source, text) && (
        <Typography sx={{ fontSize: Math.round(14.5 * scale), lineHeight: 1.5, color: 'text.secondary', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{source}</Typography>
      )}
      {pending && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>{t('pending')}</Typography>}
    </Box>
  );
}

// 양방향 통역: 말풍선 — 상대(왼쪽, 파랑) / 나(오른쪽, 무채색). 위 작은 글씨 = '말한 언어 → 번역 언어'.
export function Bubble({ mine, label, text, source, draft, scale }) {
  const pending = !text && !!source;
  const main = pending ? source : text;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, px: 0.75, color: mine ? 'text.secondary' : (th) => (th.palette.mode === 'dark' ? th.palette.accent.main : BLUE) }}>{label}</Typography>
      <Box sx={{
        maxWidth: '86%', px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5,
        borderRadius: mine ? '20px 6px 20px 20px' : '6px 20px 20px 20px',
        bgcolor: (th) => (mine ? alpha(th.palette.text.primary, 0.06) : alpha(th.palette.accent.main, th.palette.mode === 'dark' ? 0.22 : 0.1)),
      }}>
        <Typography sx={{ fontSize: Math.round(19 * scale), fontWeight: 500, lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere', color: pending || draft ? 'text.secondary' : 'text.primary' }}>{main}</Typography>
        {!pending && source && !sameText(source, text) && (
          <Typography sx={{ fontSize: Math.round(13.5 * scale), lineHeight: 1.5, color: 'text.secondary', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{source}</Typography>
        )}
      </Box>
    </Box>
  );
}

// '[시작] 버튼을…' — 대괄호 부분만 굵게
function Hint({ text }) {
  return (
    <>
      {String(text).split(/(\[[^\]]+\])/).map((p, i) => (p.startsWith('[')
        ? <Box key={i} component="b" sx={{ color: 'text.primary' }}>{p}</Box>
        : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

// 조작판 버튼 — 글자·배경 없이 아이콘만(디스코드). bg 를 주면 그 색의 둥근 사각형(시작=보라). 종료는 빨간 나가기 아이콘.
function Ctrl({ label, onClick, bg, color, dim, disabled, pressed, children }) {
  return (
    <ButtonBase onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={pressed}
      sx={{ justifySelf: 'center', width: 48, height: 48, borderRadius: '14px', bgcolor: bg || 'transparent', color: color || 'text.primary', opacity: disabled || dim ? 0.4 : 1, '& svg': { fontSize: 24 } }}>
      {children}
    </ButtonBase>
  );
}

// 우상단 버튼 — 배경 없이 아이콘만, 켜짐(active)일 때만 옅은 보라 배경
function TopBtn({ label, onClick, active, dim, children }) {
  return (
    <IconButton onClick={onClick} aria-label={label} aria-pressed={active}
      sx={{ width: 40, height: 40, borderRadius: '12px', bgcolor: active ? SOFT_BG : 'transparent', color: active ? BRAND : 'text.primary', opacity: dim ? 0.45 : 1, '&:hover': { bgcolor: active ? SOFT_BG : 'transparent' }, '& svg': { fontSize: 22 } }}>
      {children}
    </IconButton>
  );
}

// 보라 스위치(켜짐 = 브랜드 색)
const brandSwitch = { '& .MuiSwitch-switchBase.Mui-checked': { color: '#fff' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: BRAND, opacity: 1 } };

export default function MobileLive(p) {
  const t = useT();
  const { twoway, recording, connecting, messages, fontScale: scale } = p;
  const mic = useMicInputs();
  const [sheet, setSheet] = useState(null); // 'lang' | 'device' | 'voice' | 'share' | 'rename' | 'end' | 'clear' | 'delete'
  const [panel, setPanel] = useState(false); // 큰 설정(조작판을 위로 민 상태)
  const [toastMsg, setToastMsg] = useState({ text: '', n: 0 });
  const toast = toastMsg.text;
  // 같은 버튼을 연달아 눌러도 안내가 새로 뜨게(번호가 바뀌면 Snackbar 를 새로 띄워 타이머도 처음부터)
  const setToast = (text) => setToastMsg((o) => ({ text, n: text ? o.n + 1 : o.n }));
  const [shown, setShown] = useState(true); // 번역 중 위·아래 메뉴 표시 여부
  const [hint, setHint] = useState(false);  // '화면을 누르면 메뉴가 나타납니다'(시작 직후 3초)
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(null);
  const hideTimer = useRef(null);
  useBackClose(panel, () => setPanel(false));
  // 대기 중에도 마이크만 켜서(엔진·과금 없음) 입력 크기를 보여 준다 — 시작 전에 소리가 들어오는지 확인용.
  // 시작을 누르면 먼저 이 미터를 끄고(네이티브 캡처를 번역 경로에 넘김) 번역을 연다.
  const [starting, setStarting] = useState(false);
  // 양방향 통역이면 대기 중에도 2채널로 열어 송신기 1·2(좌·우)를 따로 보여 준다(번역도 같은 방식으로 연다)
  const idle = useIdleMeter(!recording && !starting, twoway);
  const liveLevel = recording ? (p.micMuted ? null : p.level) : idle.l;
  const liveLevel2 = recording ? (p.micMuted || !p.stereoInfo ? null : p.level2) : idle.r;
  const chanState = recording ? (p.stereoInfo && p.stereoInfo.state) : null; // 번역 중 자동 판별 결과(대기 중엔 막대만)
  const start = () => {
    if (starting) return;
    setStarting(true);
    setTimeout(async () => {
      try { await p.onStart(); } finally { setStarting(false); }
    }, 80);
  };
  // 나가기(하드웨어 뒤로가기·종료 버튼): 번역 중일 때만 종료 확인, 대기 중이면 바로 목록으로.
  // 하드웨어 뒤로가기는 MobileApp 이 화면을 붙잡고 신호(backAsk)만 보낸다.
  const leave = () => { if (recording) setSheet('end'); else p.onBack(); };
  const backSeen = useRef(p.backAsk || 0);
  useEffect(() => {
    if (!p.backAsk || p.backAsk === backSeen.current) return;
    backSeen.current = p.backAsk;
    leave();
    // eslint-disable-next-line
  }, [p.backAsk]);

  // 시작하면 메뉴를 숨기고 안내를 3초 보여준다. 중지하면 메뉴 고정.
  useEffect(() => {
    clearTimeout(hideTimer.current);
    if (!recording) { setShown(true); setHint(false); return undefined; }
    setShown(false);
    setHint(true);
    const h = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(h);
  }, [recording]);
  useEffect(() => () => clearTimeout(hideTimer.current), []);
  const poke = () => { // 메뉴를 보이고 4초 뒤 다시 숨김(번역 중일 때만)
    if (!recording) return;
    setShown(true);
    setHint(false);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShown(false), 4000);
  };
  const onStageTap = () => {
    if (!recording) return;
    if (shown) { clearTimeout(hideTimer.current); setShown(false); } else poke();
  };
  const bars = !recording || shown || !!sheet || panel;
  // 메뉴가 나타나고 사라질 때 위·아래 여백이 바뀐다 — 맨 아래를 보고 있었다면 마지막 문장이 메뉴에 가리지 않게 다시 맨 아래로
  const atBottomRef = useRef(true);
  useEffect(() => {
    const el = p.scrollRef && p.scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line
  }, [bars]);

  useEffect(() => {
    if (sheet !== 'share' || qr) return;
    p.getQr().then(setQr).catch(() => {});
    // eslint-disable-next-line
  }, [sheet]);

  // 조작판을 위로 밀면 큰 설정(손잡이 탭도 같음)
  const swipeY = useRef(null);
  const onBarDown = (e) => { poke(); swipeY.current = e.clientY; };
  const onBarMove = (e) => {
    if (swipeY.current == null) return;
    if (swipeY.current - e.clientY > 28) { swipeY.current = null; setPanel(true); }
  };
  const onBarUp = () => { swipeY.current = null; };

  const close = () => setSheet(null);
  const tabs = twoway
    ? [
      { key: 'a', label: t('myLang'), value: p.sxA, options: langOptions(p.sxCodes, t), onPick: p.onA },
      { key: 'b', label: t('otherLang'), value: p.sxB, options: langOptions(p.sxCodes, t), onPick: p.onB },
    ]
    : [
      { key: 'in', label: t('inputLang'), value: p.inLang, options: langOptions(p.inCodes, t), onPick: p.onInLang },
      { key: 'out', label: t('outputLang'), value: p.sxTarget, options: langOptions(p.sxCodes, t), onPick: p.onTarget },
    ];
  const openLang = () => {
    if (recording) { setToast(t('langLocked')); return; }
    setSheet('lang');
  };
  const stereo = p.stereoInfo && p.stereoInfo.state === 'stereo';
  const copy = async () => {
    if (!qr) return;
    let ok = false;
    try { await navigator.clipboard.writeText(qr.url); ok = true; } catch {}
    if (!ok) { // http 사내망·WebView 는 clipboard API 가 막혀 있다 — 구식 복사로 폴백
      try { const ta = document.createElement('textarea'); ta.value = qr.url; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch {}
    }
    if (ok) { setCopied(true); setTimeout(() => setCopied(false), 1500); }
  };
  const run = async (fn, okMsg) => { // 확인 창의 실제 동작(대화 내역 삭제·세션 삭제)
    setBusy(true);
    try { await fn(); close(); if (okMsg) setToast(okMsg); }
    catch (e) { setToast(t('failMsg', { msg: e.message || t('netError') })); }
    finally { setBusy(false); }
  };

  // 토글 + 아래 안내(디스코드처럼 상태가 바뀐 걸 바로 알림)
  const muteOn = recording && p.micMuted;
  const toggleMute = () => {
    if (!recording) { setToast(t('muteNeedRec')); return; }
    const next = !p.micMuted;
    p.onToggleMute();
    setToast(next ? t('mutedMsg') : t('unmutedMsg'));
  };
  // TTS(하단) = 번역 음성을 만들지 — 켜면 링크로 접속한 참가자들이 '듣기'로 들을 수 있다.
  // 이 폰에서도 틀지는 우상단 스피커(예전 '뷰어에게만 음성 보내기'의 반대).
  const ttsMade = p.ttsOn && p.ttsAllowed;
  const toggleTts = () => {
    const next = !p.ttsOn;
    p.onToggleTts();
    setToast(next ? t('ttsOnMsg') : t('ttsOffMsg'));
  };
  const hereOn = !p.ttsViewerOnly;
  const toggleSpeaker = () => {
    if (!ttsMade) { setToast(t('speakerNeedTts')); return; }
    p.onViewerOnly(hereOn); // 지금 켜져 있으면 '뷰어에게만'으로
    setToast(hereOn ? t('speakerOffMsg') : t('speakerOnMsg'));
  };

  const previewLang = twoway ? p.sxA : p.sxTarget;
  const preview = async (g) => {
    if (previewing) return;
    setPreviewing(g);
    try {
      let blob;
      try { blob = await api.ttsPreview(previewLang, g); } catch { blob = await api.ttsPreview('ko', g); } // 음성이 없는 언어면 한국어로
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch { setToast(t('previewFail')); }
    finally { setPreviewing(null); }
  };
  const voiceName = (g) => (g === 'm' ? t('male') : t('female'));

  const controls = (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', alignItems: 'center' }}>
      <Ctrl label={muteOn ? t('unmute') : t('mute')} onClick={toggleMute} pressed={muteOn} dim={!recording}
        color={muteOn ? 'error.main' : undefined}>
        {muteOn ? <MicOffIcon /> : <MicIcon />}
      </Ctrl>
      <Ctrl label={ttsMade ? t('tts') : t('ttsOff')} onClick={toggleTts} pressed={ttsMade} disabled={!p.ttsAllowed} color={ttsMade ? undefined : 'text.secondary'}>
        <TtsIcon off={!ttsMade} />
      </Ctrl>
      <Ctrl label={recording ? t('stop') : t('start')} onClick={recording ? p.onStop : start} disabled={starting} bg={BRAND} color="#fff">
        {starting
          ? <CircularProgress size={18} sx={{ color: '#fff' }} />
          : recording
            ? <Box sx={{ width: 15, height: 15, borderRadius: '4px', bgcolor: '#fff' }} />
            : <PlayIcon />}
      </Ctrl>
      <Ctrl label={t('language')} onClick={openLang} dim={recording}><TranslateIcon /></Ctrl>
      <Ctrl label={t('end')} onClick={leave} color="error.main"><LogOutIcon strokeWidth={1.9} /></Ctrl>
    </Box>
  );

  const top = (
    <Box onPointerDown={poke} sx={{
      position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 1, px: 2, pt: 'calc(10px + env(safe-area-inset-top))', pb: 1,
      bgcolor: 'background.default',
      transform: bars ? 'none' : 'translateY(-110%)', transition: 'transform 220ms ease',
    }}>
      {/* 세션 이름은 표시만(누르는 곳 아님) — 큰 설정은 조작판을 위로 밀어 연다 */}
      <Box sx={{ minWidth: 0, maxWidth: '64%', height: 44, pl: 0.5, display: 'flex', alignItems: 'center', gap: 0.9 }}>
        {recording && <Box aria-label={twoway ? t('interpreting') : t('translating')} sx={{ width: 8, height: 8, flex: 'none', borderRadius: '999px', bgcolor: p.connState === 'reconn' ? 'warning.main' : 'error.main' }} />}
        <Typography component="h1" noWrap sx={{ fontSize: 18, fontWeight: 800 }}>{p.title}</Typography>
      </Box>
      <Box sx={{ flex: 1 }} />
      {p.ttsAllowed && (
        <TopBtn label={t('speakerAria')} onClick={toggleSpeaker} active={hereOn && ttsMade} dim={!ttsMade}>
          {hereOn ? <VolumeOnIcon /> : <VolumeOffIcon />}
        </TopBtn>
      )}
      <TopBtn label={t('shareLink')} onClick={() => setSheet('share')}><QrIcon /></TopBtn>
    </Box>
  );

  const bottom = (
    <Box onPointerDown={onBarDown} onPointerMove={onBarMove} onPointerUp={onBarUp} onPointerCancel={onBarUp}
      sx={{
        position: 'absolute', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))', zIndex: 2,
        borderRadius: '24px', bgcolor: PANEL_BG, boxShadow: '0 6px 24px rgba(0,0,0,0.10)', px: 1, pb: 1, touchAction: 'none',
        transform: bars ? 'none' : 'translateY(140%)', transition: 'transform 220ms ease',
      }}>
      <ButtonBase onClick={() => setPanel(true)} aria-label={t('openSettings')} sx={{ width: '100%', height: 16, display: 'flex', justifyContent: 'center', borderRadius: '12px' }}>
        <Box sx={{ width: 40, height: 4, borderRadius: '999px', bgcolor: 'divider' }} />
      </ButtonBase>
      {controls}
    </Box>
  );

  const banner = (p.notice || (recording && connecting)) && (
    <Box sx={{ position: 'absolute', zIndex: 3, left: 16, right: 16, top: bars ? 'calc(70px + env(safe-area-inset-top))' : 'calc(14px + env(safe-area-inset-top))', transition: 'top 220ms ease', px: 2, py: 1.25, borderRadius: '14px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 1, bgcolor: (th) => (p.notice ? alpha(th.palette.warning.main, 0.16) : th.palette.background.paper), color: p.notice ? 'warning.dark' : 'text.secondary', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
      {!p.notice && <CircularProgress size={14} color="inherit" />}
      {p.notice || t('engineConnecting')}
    </Box>
  );

  return (
    <Box sx={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden', bgcolor: 'background.default' }}>
      {/* 대화 — 메뉴가 고정(대기)일 땐 위·아래 메뉴 높이만큼 비워 가리지 않게 */}
      <Box ref={p.scrollRef} onClick={onStageTap}
        onScroll={(e) => { const el = e.currentTarget; atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}
        sx={{ position: 'absolute', inset: 0, overflowY: 'auto', overscrollBehavior: 'contain', px: twoway ? 2 : 3, display: 'flex', flexDirection: 'column', gap: twoway ? 1.75 : 2.75,
          pt: bars ? 'calc(76px + env(safe-area-inset-top))' : 'calc(20px + env(safe-area-inset-top))',
          pb: bars ? 'calc(108px + env(safe-area-inset-bottom))' : 'calc(40px + env(safe-area-inset-bottom))' }}>
        {messages.length === 0 ? (
          <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Typography sx={{ textAlign: 'center', color: 'text.secondary', fontSize: 15, lineHeight: 1.6, maxWidth: 300, wordBreak: 'keep-all' }}>
              {recording ? t('speakNow') : <Hint text={t('readyHint')} />}
            </Typography>
          </Box>
        ) : <Box sx={{ flex: 1 }} />}
        {messages.map((m) => {
          const keys = m.texts ? Object.keys(m.texts) : [];
          const tk = keys[0];
          const text = tk ? m.texts[tk] : '';
          if (!twoway) return <Line key={m.id} text={text} source={m.source} draft={!!m.draft} scale={scale} t={t} />;
          // 타깃이 내 언어(A)면 상대(B)가 말한 것 — 데스크톱 dir 판정과 동일
          const mine = tk ? tk !== p.sxA : true;
          const from = m.lang || (mine ? p.sxA : p.sxB);
          const to = tk || (mine ? p.sxB : p.sxA);
          const label = `${t.lang(from)} → ${t.lang(to)}`;
          return <Bubble key={m.id} mine={mine} label={label} text={text} source={m.source} draft={!!m.draft} scale={scale} />;
        })}
      </Box>

      {top}
      {bottom}
      {banner}
      {recording && !bars && <Box aria-label={twoway ? t('interpreting') : t('translating')} sx={{ position: 'absolute', zIndex: 2, top: 'calc(16px + env(safe-area-inset-top))', right: 16, width: 8, height: 8, borderRadius: '999px', bgcolor: p.connState === 'reconn' ? 'warning.main' : 'error.main' }} />}
      {hint && !bars && (
        <Box sx={{ position: 'absolute', zIndex: 2, left: 0, right: 0, bottom: 'calc(28px + env(safe-area-inset-bottom))', display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
          <Typography sx={{ fontSize: 12.5, color: '#fff', bgcolor: 'rgba(31,30,29,0.72)', borderRadius: '999px', px: 1.75, py: 0.75 }}>{t('tapHint')}</Typography>
        </Box>
      )}

      {/* 큰 설정 — 조작판을 위로 민 화면(디스코드). 맨 위에 같은 조작 버튼, 아래에 입력·출력·세션 */}
      <SwipeableDrawer anchor="bottom" open={panel} onOpen={() => setPanel(true)} onClose={() => setPanel(false)} disableSwipeToOpen disableDiscovery ModalProps={{ keepMounted: false }}
        slotProps={{ paper: { sx: { height: 'calc(100dvh - 64px)', borderTopLeftRadius: '28px', borderTopRightRadius: '28px', bgcolor: PANEL_BG, backgroundImage: 'none' } } }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
          <Box sx={{ alignSelf: 'center', width: 40, height: 4, borderRadius: '999px', bgcolor: 'divider', mt: 1.25, mb: 1.5, flex: 'none' }} />
          <Box sx={{ px: 1.5, pb: 1.5, flex: 'none' }}>{controls}</Box>
          <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pb: 'calc(24px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Group title={t('secInput')}>
              <OptionRow label={t('inputDevice')} value={micCurrentName(mic, t)} onClick={() => setSheet('device')} />
              <OptionRow toggle label={t('autoSens')} onClick={() => p.onMicAuto(!p.micAuto)}
                value={<Switch edge="end" checked={!!p.micAuto} tabIndex={-1} inputProps={{ 'aria-label': t('autoSens') }} sx={brandSwitch} />} />
              {p.micAuto
                ? <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 2.25, py: 1.5, lineHeight: 1.5 }}>{t('autoSensHint')}</Typography>
                : <SensSlider label={t('inputSens')} value={p.micSens} native={p.micNative} level={liveLevel} hint={t('inputSensHint')} onChange={p.onMicSens} />}
            </Group>
            {twoway && liveLevel2 != null && <ChannelMeters l={liveLevel} r={liveLevel2} state={chanState} />}
            <Group title={t('secOutput')}>
              <OptionRow label={t('ttsVoice')} value={voiceName(p.gender)} onClick={() => setSheet('voice')} />
            </Group>
            <Group title={t('secSession')}>
              <OptionRow label={t('sessionName')} value={p.title} onClick={() => setSheet('rename')} />
              <OptionRow label={t('viewers')} value={t('viewersCount', { n: p.viewerCount || 0 })} onClick={() => setSheet('share')} />
              <OptionRow label={t('saveTranscript')} onClick={() => p.onSaveTranscript()} disabled={!p.canSave} />
              <OptionRow label={t('clearHistory')} onClick={() => setSheet('clear')} disabled={!p.canSave} />
              <OptionRow label={t('deleteSession')} danger onClick={() => setSheet('delete')} />
            </Group>
          </Box>
        </Box>
      </SwipeableDrawer>

      <LangSheet open={sheet === 'lang'} onClose={close} title={t('language')} subtitle={twoway ? t('langSubTwo') : t('langSubOne')} tabs={tabs} startTab={1} />

      <MicSheet open={sheet === 'device'} onClose={close} mic={mic} stereo={stereo} />

      <PickSheet open={sheet === 'voice'} onClose={close} title={t('ttsVoice')} subtitle={t('ttsVoiceDesc')} value={p.gender} keepOpen
        options={['f', 'm'].map((g) => ({
          code: g,
          label: voiceName(g),
          extra: (
            <IconButton onClick={() => preview(g)} aria-label={t('previewVoice', { v: voiceName(g) })}
              sx={{ width: 44, height: 44, mr: 1, flex: 'none', bgcolor: SOFT_BG, color: BRAND, '&:hover': { bgcolor: SOFT_BG } }}>
              {previewing === g ? <CircularProgress size={18} sx={{ color: 'inherit' }} /> : <PlayIcon sx={{ fontSize: 20 }} />}
            </IconButton>
          ),
        }))}
        onPick={p.onGender} />

      <BottomSheet open={sheet === 'share'} onClose={close} title={t('shareLink')} subtitle={t('shareHint')}>
        <Box sx={{ px: 3, pb: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          {p.viewerCount > 0 && <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.secondary' }}>{t('viewersN', { n: p.viewerCount })}</Typography>}
          {qr ? (
            <>
              <Box component="img" src={qr.qr} alt="QR" sx={{ width: 220, bgcolor: '#fff', borderRadius: '16px', p: 1 }} />
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', wordBreak: 'break-all', textAlign: 'center' }}>{qr.url}</Typography>
              <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                <ButtonBase onClick={copy} sx={{ flex: 1, height: 50, borderRadius: '14px', bgcolor: 'action.hover', fontSize: 15, fontWeight: 700, color: copied ? 'success.main' : 'text.primary' }}>{copied ? t('copied') : t('copyLink')}</ButtonBase>
                {/* 앱은 네이티브 공유, 폰 브라우저(iPhone 웹)는 Web Share */}
                {((window.AndroidApp && window.AndroidApp.shareText) || navigator.share) && (
                  <ButtonBase onClick={() => {
                    if (window.AndroidApp && window.AndroidApp.shareText) { try { window.AndroidApp.shareText(qr.url); } catch {} return; }
                    navigator.share({ title: p.title || 'AirTalk', url: qr.url }).catch(() => {});
                  }} sx={{ flex: 1, height: 50, borderRadius: '14px', bgcolor: BRAND, color: '#fff', fontSize: 15, fontWeight: 700 }}>{t('share')}</ButtonBase>
                )}
              </Box>
            </>
          ) : <Box sx={{ py: 6, display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}><CircularProgress size={18} color="inherit" />{t('generating')}</Box>}
        </Box>
      </BottomSheet>

      <FormSheet open={sheet === 'rename'} onClose={close} title={t('rename')}
        fields={[{ key: 'title', label: t('sessionName') }]} initial={{ title: p.title || '' }}
        validate={(v) => (String(v.title || '').trim() ? '' : t('nameRequired'))}
        onSubmit={(v) => p.onRename(String(v.title).trim())} />

      <ConfirmDialog open={sheet === 'end'} title={t('endTitle')} desc={t('endDesc')} okLabel={t('end')} danger onClose={close}
        onOk={() => { close(); if (recording) p.onStop(); p.onBack(); }} />
      <ConfirmDialog open={sheet === 'clear'} title={t('clearHistory')} desc={t('clearConfirm')} okLabel={t('delete')} danger busy={busy} onClose={close}
        onOk={() => run(p.onClear, t('cleared'))} />
      <ConfirmDialog open={sheet === 'delete'} title={t('deleteSession')} desc={t('deleteConfirm', { name: p.title || t('untitled') })} okLabel={t('delete')} danger busy={busy} onClose={close}
        onOk={() => run(p.onDelete)} />

      {/* 토글 안내는 조작판 바로 위에(디스코드처럼 아래쪽) */}
      {/* 바깥 탭(clickaway)으론 닫지 않는다 — 토글 버튼을 다시 누르면 새 안내가 그 탭에 바로 닫혀 버렸다 */}
      <Snackbar key={toastMsg.n} open={!!toast} autoHideDuration={2600} onClose={(e, reason) => { if (reason !== 'clickaway') setToast(''); }} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: 'calc(96px + env(safe-area-inset-bottom)) !important' }} />
    </Box>
  );
}
