/* 안드로이드 앱 폰 화면 — 세션 화면(레이아웃 전용).
   상태·엔진 로직은 TranslateView 가 그대로 갖고, 이 파일은 그 값을 받아 그리기만 한다.
   하단 아이콘 5개(줌 회의 화면 참고). 번역을 시작하면 위·아래 메뉴를 숨기고 화면을 누르면 4초간 보인다. */
import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import Switch from '@mui/material/Switch';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import { alpha } from '@mui/material/styles';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MicNoneIcon from '@mui/icons-material/MicNone';
import MicOffOutlinedIcon from '@mui/icons-material/MicOffOutlined';
import VolumeUpOutlinedIcon from '@mui/icons-material/VolumeUpOutlined';
import VolumeOffOutlinedIcon from '@mui/icons-material/VolumeOffOutlined';
import TuneIcon from '@mui/icons-material/Tune';
import HighlightOffIcon from '@mui/icons-material/HighlightOff';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import TranslateIcon from '@mui/icons-material/Translate';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import HeadphonesOutlinedIcon from '@mui/icons-material/HeadphonesOutlined';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { BottomSheet, LangSheet, ConfirmDialog, FormSheet, SensSlider, MicSheet, MIC_ICON, micKindName, langOptions, useMicInputs, useIdleMeter } from './common.jsx';
import { useT } from './i18n.js';

const BLUE = '#1F5BBF';

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

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

function DockButton({ label, onClick, disabled, color, children, pressed }) {
  return (
    <ButtonBase onClick={onClick} disabled={disabled} aria-pressed={pressed}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, borderRadius: '14px', py: 0.5, opacity: disabled ? 0.35 : 1, color: color || 'text.primary', '& svg': { fontSize: 27 } }}>
      {children}
      <Typography component="span" sx={{ fontSize: 12.5, color: 'inherit', lineHeight: 1.2 }}>{label}</Typography>
    </ButtonBase>
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

function SheetItem({ icon, label, value, onClick, danger, disabled, right }) {
  return (
    <ButtonBase onClick={onClick} disabled={disabled}
      sx={{ width: '100%', display: 'flex', alignItems: 'center', gap: 1.75, minHeight: 54, px: 1.75, borderRadius: '14px', justifyContent: 'flex-start', textAlign: 'left', opacity: disabled ? 0.4 : 1, color: danger ? 'error.main' : 'text.primary', '& > svg:first-of-type': { fontSize: 22 } }}>
      {icon}
      <Typography sx={{ flex: 1, fontSize: 16, fontWeight: 700, color: 'inherit' }}>{label}</Typography>
      {value && <Typography noWrap sx={{ fontSize: 14, color: 'text.secondary', maxWidth: '50%' }}>{value}</Typography>}
      {right}
    </ButtonBase>
  );
}

export default function MobileLive(p) {
  const t = useT();
  const { twoway, recording, connecting, messages, fontScale: scale } = p;
  const mic = useMicInputs();
  const [sheet, setSheet] = useState(null); // 'settings' | 'lang' | 'mic' | 'share' | 'rename' | 'end' | 'clear' | 'delete'
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [shown, setShown] = useState(true); // 번역 중 위·아래 메뉴 표시 여부
  const [hint, setHint] = useState(false);  // '화면을 누르면 메뉴가 나타납니다'(시작 직후 3초)
  const [qr, setQr] = useState(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const hideTimer = useRef(null);
  // 대기 중에도 마이크만 켜서(엔진·과금 없음) 입력 크기를 보여 준다 — 시작 전에 소리가 들어오는지 확인용.
  // 시작을 누르면 먼저 이 미터를 끄고(네이티브 캡처를 번역 경로에 넘김) 번역을 연다.
  const [starting, setStarting] = useState(false);
  const idleLevel = useIdleMeter(!recording && !starting);
  const liveLevel = recording ? (p.micMuted ? null : p.level) : idleLevel;
  const start = () => {
    if (starting) return;
    setStarting(true);
    setTimeout(async () => {
      try { await p.onStart(); } finally { setStarting(false); }
    }, 80);
  };
  // 하드웨어 뒤로가기(세션 화면) = 종료 확인 — MobileApp 이 화면을 붙잡고 신호만 보낸다
  const backSeen = useRef(p.backAsk || 0);
  useEffect(() => {
    if (!p.backAsk || p.backAsk === backSeen.current) return;
    backSeen.current = p.backAsk;
    setSheet('end');
  }, [p.backAsk]);

  useEffect(() => {
    if (!p.recStartAt) return undefined;
    const tm = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tm);
  }, [p.recStartAt]);

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
  const bars = !recording || shown || !!sheet;
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

  const close = () => setSheet(null);
  const langText = twoway ? `${t.lang(p.sxA)} ⇄ ${t.lang(p.sxB)}` : `${t.lang(p.inLang)} → ${t.lang(p.sxTarget)}`;
  const subtitle = `${twoway ? t('modeTwoway') : t('modeOneway')} · ${langText}`;
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
  const ChipIcon = MIC_ICON[mic.kind] || MicNoneIcon;
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

  const top = (
    <Box onPointerDown={poke} sx={{
      position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pr: 1.5, pt: 'calc(8px + env(safe-area-inset-top))', pb: 1,
      bgcolor: (th) => alpha(th.palette.background.default, 0.97), borderBottom: 1, borderColor: recording ? 'divider' : 'transparent',
      transform: bars ? 'none' : 'translateY(-110%)', transition: 'transform 220ms ease',
    }}>
      <IconButton onClick={() => setSheet('end')} aria-label={t('backToList')} sx={{ width: 48, height: 48 }}>
        <ArrowBackIosNewIcon sx={{ fontSize: 20 }} />
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography noWrap sx={{ fontSize: 17, fontWeight: 700 }}>{p.title}</Typography>
        <Typography noWrap sx={{ fontSize: 12.5, color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}>
          {recording ? (
            <>
              <Box component="span" sx={{ color: p.connState === 'reconn' ? 'warning.main' : 'error.main' }}>●</Box>
              {' '}{p.connState === 'reconn' ? t('reconnecting') : twoway ? t('interpreting') : t('translating')}
              {p.recStartAt ? ` · ${fmtElapsed(now - p.recStartAt)}` : ''}
            </>
          ) : subtitle}
        </Typography>
      </Box>
      <ButtonBase onClick={() => setSheet('mic')} aria-label={t('micAria', { name: micKindName(mic.kind, t) })}
        sx={{ height: 40, pl: 1.25, pr: 0.75, gap: 0.5, borderRadius: '999px', border: 1, borderColor: 'divider', bgcolor: 'background.paper', flex: 'none' }}>
        {mic.kind === 'usb' || mic.kind === 'bluetooth'
          ? <><MicNoneIcon sx={{ fontSize: 18 }} /><ChipIcon sx={{ fontSize: 17, color: mic.kind === 'bluetooth' ? BLUE : 'text.primary' }} /></>
          : <ChipIcon sx={{ fontSize: 19 }} />}
        {stereo && <Typography component="span" sx={{ fontSize: 11, fontWeight: 800, bgcolor: 'action.hover', borderRadius: '6px', px: 0.6 }}>2CH</Typography>}
        <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 13, ml: 0.25 }}>
          {[8, 22, 40, 60].map((th, i) => (
            <Box key={th} sx={{ width: 3, height: [5, 8, 11, 13][i], borderRadius: '2px', bgcolor: liveLevel != null && liveLevel > th ? 'success.main' : 'divider' }} />
          ))}
        </Box>
        <ExpandMoreIcon sx={{ fontSize: 17, color: 'text.secondary' }} />
      </ButtonBase>
    </Box>
  );

  const muteOn = recording && p.micMuted;
  const ttsOn = p.ttsOn && p.ttsAllowed;
  const bottom = (
    <Box onPointerDown={poke} sx={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 2, bgcolor: (th) => alpha(th.palette.background.paper, 0.98), borderTop: 1, borderColor: 'divider',
      px: 0.75, pt: 1, pb: 'calc(14px + env(safe-area-inset-bottom))', display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', alignItems: 'center',
      transform: bars ? 'none' : 'translateY(110%)', transition: 'transform 220ms ease',
    }}>
      <DockButton label={muteOn ? t('unmute') : t('mute')} onClick={p.onToggleMute} disabled={!recording} pressed={muteOn} color={muteOn ? 'error.main' : undefined}>
        {muteOn ? <MicOffOutlinedIcon /> : <MicNoneIcon />}
      </DockButton>
      <DockButton label={ttsOn ? t('tts') : t('ttsOff')} onClick={p.onToggleTts} disabled={!p.ttsAllowed} pressed={ttsOn} color={ttsOn ? undefined : 'text.secondary'}>
        {ttsOn ? <VolumeUpOutlinedIcon /> : <VolumeOffOutlinedIcon />}
      </DockButton>
      <ButtonBase onClick={recording ? p.onStop : start} disabled={starting} aria-label={recording ? t('stop') : t('start')}
        sx={{ justifySelf: 'center', width: 56, height: 56, borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: recording ? 'error.main' : 'text.primary', opacity: starting ? 0.6 : 1 }}>
        {starting
          ? <CircularProgress size={22} sx={{ color: 'background.paper' }} />
          : recording
            ? <Box sx={{ width: 18, height: 18, borderRadius: '5px', bgcolor: '#fff' }} />
            : <PlayArrowRoundedIcon sx={{ fontSize: 33, color: 'background.paper' }} />}
      </ButtonBase>
      <DockButton label={t('settings')} onClick={() => setSheet('settings')}><TuneIcon /></DockButton>
      <DockButton label={t('end')} onClick={() => setSheet('end')} color="error.main"><HighlightOffIcon /></DockButton>
    </Box>
  );

  const banner = (p.notice || (recording && connecting)) && (
    <Box sx={{ position: 'absolute', zIndex: 3, left: 16, right: 16, top: bars ? 'calc(80px + env(safe-area-inset-top))' : 'calc(14px + env(safe-area-inset-top))', transition: 'top 220ms ease', px: 2, py: 1.25, borderRadius: '14px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 1, bgcolor: (th) => (p.notice ? alpha(th.palette.warning.main, 0.16) : th.palette.background.paper), color: p.notice ? 'warning.dark' : 'text.secondary', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
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
          pt: bars ? 'calc(84px + env(safe-area-inset-top))' : 'calc(20px + env(safe-area-inset-top))',
          pb: bars ? 'calc(120px + env(safe-area-inset-bottom))' : 'calc(40px + env(safe-area-inset-bottom))' }}>
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
          const label = mine ? `${t.lang(p.sxA)} → ${t.lang(p.sxB)}` : `${t.lang(p.sxB)} → ${t.lang(p.sxA)}`;
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

      {/* 세션 설정 — 예전 우상단 ⋮ 메뉴 항목 */}
      <BottomSheet open={sheet === 'settings'} onClose={close} title={t('sessionSettings')}>
        <Box sx={{ px: 1.25, pb: 2.5, display: 'flex', flexDirection: 'column', gap: 0.25, overflowY: 'auto' }}>
          <SheetItem icon={<TranslateIcon />} label={t('language')} value={langText} onClick={openLang} right={<ChevronRightIcon sx={{ color: 'text.disabled' }} />} />
          <SheetItem icon={<QrCode2Icon />} label={t('shareLink')} onClick={() => setSheet('share')} />
          <SheetItem icon={<FileDownloadOutlinedIcon />} label={t('saveTranscript')} disabled={!p.canSave} onClick={() => { close(); p.onSaveTranscript(); }} />
          {p.ttsAllowed && (
            <SheetItem icon={<HeadphonesOutlinedIcon />} label={t('viewerOnly')} onClick={() => p.onViewerOnly(!p.ttsViewerOnly)}
              right={<Switch edge="end" checked={!!p.ttsViewerOnly} tabIndex={-1} inputProps={{ 'aria-label': t('viewerOnly') }} />} />
          )}
          {p.ttsAllowed && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', px: 1.75, mt: -0.75, mb: 0.5, pl: 7.25, lineHeight: 1.45 }}>{t('viewerOnlySub')}</Typography>}
          <SheetItem icon={<DriveFileRenameOutlineIcon />} label={t('rename')} onClick={() => setSheet('rename')} />
          <Box sx={{ height: '1px', bgcolor: 'divider', mx: 1.75, my: 0.5 }} />
          <SheetItem icon={<DeleteSweepOutlinedIcon />} label={t('clearHistory')} disabled={!p.canSave} onClick={() => setSheet('clear')} />
          <SheetItem icon={<DeleteOutlineIcon />} label={t('deleteSession')} danger onClick={() => setSheet('delete')} />
        </Box>
      </BottomSheet>

      <LangSheet open={sheet === 'lang'} onClose={close} title={t('language')} subtitle={twoway ? t('langSubTwo') : t('langSubOne')} tabs={tabs} startTab={1} />

      {/* 마이크 선택 + 입력 감도(대기 중에도 마이크만 켜서 지금 입력 크기 표시) */}
      <MicSheet open={sheet === 'mic'} onClose={close} mic={mic} stereo={stereo}>
        <Box sx={{ mx: 0.5, mt: 1, borderRadius: '16px', bgcolor: 'action.hover' }}>
          <SensSlider label={t('inputSens')} value={p.micSens} native={p.micNative} level={liveLevel} hint={t('inputSensHint')} onChange={p.onMicSens} />
        </Box>
      </MicSheet>

      <BottomSheet open={sheet === 'share'} onClose={close} title={t('shareLink')} subtitle={t('shareHint')}>
        <Box sx={{ px: 3, pb: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
          {qr ? (
            <>
              <Box component="img" src={qr.qr} alt="QR" sx={{ width: 220, bgcolor: '#fff', borderRadius: '16px', p: 1 }} />
              <Typography sx={{ fontSize: 12.5, color: 'text.secondary', wordBreak: 'break-all', textAlign: 'center' }}>{qr.url}</Typography>
              <Box sx={{ display: 'flex', gap: 1, width: '100%' }}>
                <ButtonBase onClick={copy} sx={{ flex: 1, height: 50, borderRadius: '14px', bgcolor: 'action.hover', fontSize: 15, fontWeight: 700, color: copied ? 'success.main' : 'text.primary' }}>{copied ? t('copied') : t('copyLink')}</ButtonBase>
                {window.AndroidApp && window.AndroidApp.shareText && (
                  <ButtonBase onClick={() => { try { window.AndroidApp.shareText(qr.url); } catch {} }} sx={{ flex: 1, height: 50, borderRadius: '14px', bgcolor: 'text.primary', color: 'background.paper', fontSize: 15, fontWeight: 700 }}>{t('share')}</ButtonBase>
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

      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} />
    </Box>
  );
}
