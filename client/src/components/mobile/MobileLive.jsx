/* 안드로이드 앱 폰 화면 — 번역 중 화면(레이아웃 전용).
   상태·엔진 로직은 TranslateView 가 그대로 갖고, 이 파일은 그 값을 받아 그리기만 한다. */
import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import Snackbar from '@mui/material/Snackbar';
import { alpha } from '@mui/material/styles';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import MicNoneIcon from '@mui/icons-material/MicNone';
import MicOffIcon from '@mui/icons-material/MicOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { LangSheet, langName, useMicLabel } from './common.jsx';

function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = String(m).padStart(2, '0'), ss = String(r).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 원문이 표시 문장과 같으면(같은 언어 기록) 작은 줄을 생략 — 데스크톱 Row 와 같은 규칙
function sameText(a, b) { return String(a || '').trim() === String(b || '').trim(); }

// 실시간 번역: 번역문(큰 글씨) + 원문(작은 회색). 번역 대기·진행 중은 회색.
function Line({ text, source, draft, scale }) {
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
      {pending && <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>번역 중…</Typography>}
    </Box>
  );
}

// 양방향 통역: 말풍선 — 상대(왼쪽, 파랑) / 나(오른쪽, 무채색). 큰 글씨 = 상대에게 보여줄 번역.
function Bubble({ mine, who, text, source, draft, scale }) {
  const pending = !text && !!source;
  const main = pending ? source : text;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <Typography sx={{ fontSize: 12, fontWeight: 700, px: 0.75, color: mine ? 'text.secondary' : (t) => (t.palette.mode === 'dark' ? t.palette.accent.main : '#1F5BBF') }}>{who}</Typography>
      <Box sx={{
        maxWidth: '86%', px: 2, py: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5,
        borderRadius: mine ? '20px 6px 20px 20px' : '6px 20px 20px 20px',
        bgcolor: (t) => (mine ? alpha(t.palette.text.primary, 0.06) : alpha(t.palette.accent.main, t.palette.mode === 'dark' ? 0.22 : 0.1)),
      }}>
        <Typography sx={{ fontSize: Math.round(19 * scale), fontWeight: 500, lineHeight: 1.45, wordBreak: 'keep-all', overflowWrap: 'anywhere', color: pending || draft ? 'text.secondary' : 'text.primary' }}>{main}</Typography>
        {!pending && source && !sameText(source, text) && (
          <Typography sx={{ fontSize: Math.round(13.5 * scale), lineHeight: 1.5, color: 'text.secondary', wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{source}</Typography>
        )}
      </Box>
    </Box>
  );
}

function DockButton({ label, onClick, disabled, active, children }) {
  return (
    <ButtonBase onClick={onClick} disabled={disabled} aria-pressed={active == null ? undefined : !!active}
      sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, borderRadius: '16px', p: 0.5, opacity: disabled ? 0.4 : 1 }}>
      <Box sx={{ width: 56, height: 56, borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: (t) => (active ? t.palette.text.primary : alpha(t.palette.text.primary, 0.07)), color: active ? 'background.paper' : 'text.primary' }}>
        {children}
      </Box>
      <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{label}</Typography>
    </ButtonBase>
  );
}

export default function MobileLive(p) {
  const { twoway, recording, connecting, messages, fontScale: scale } = p;
  const mic = useMicLabel();
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!p.recStartAt) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [p.recStartAt]);

  const inOpts = p.inLangs.map((l) => ({ code: l.code, label: l.label }));
  const sxOpts = p.sxLangs.map((l) => ({ code: l.code, label: l.label }));
  const chip = twoway
    ? `${langName(p.sxA, p.sxLangs)} ⇄ ${langName(p.sxB, p.sxLangs)}`
    : `${langName(p.inLang, p.inLangs)} → ${langName(p.sxTarget, p.sxLangs)}`;
  const tabs = twoway
    ? [
      { key: 'a', label: '내 언어', value: p.sxA, options: sxOpts, onPick: p.onA },
      { key: 'b', label: '상대 언어', value: p.sxB, options: sxOpts, onPick: p.onB },
    ]
    : [
      { key: 'in', label: '입력 언어', value: p.inLang, options: inOpts, onPick: p.onInLang },
      { key: 'out', label: '출력 언어', value: p.sxTarget, options: sxOpts, onPick: p.onTarget },
    ];
  const openLang = () => {
    if (recording) { setToast('번역 중에는 언어를 바꿀 수 없습니다 — 정지한 뒤 바꾸세요.'); return; }
    setSheet(true);
  };
  const bars = [8, 22, 40, 60].map((th) => recording && !p.micMuted && p.level > th);

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* 앱 바 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1, pt: 1, pb: 0.5 }}>
        <IconButton onClick={p.onBack} aria-label="세션 목록으로" sx={{ width: 48, height: 48 }}>
          <ArrowBackIosNewIcon sx={{ fontSize: 20 }} />
        </IconButton>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: 17, fontWeight: 700 }}>{p.title}</Typography>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary' }}>{p.modeLabel}</Typography>
        </Box>
        <IconButton onClick={(e) => p.onMenu(e.currentTarget)} aria-label="세션 메뉴" sx={{ width: 48, height: 48 }}>
          <MoreVertIcon />
        </IconButton>
      </Box>

      {/* 언어 · 마이크 상태 */}
      <Box sx={{ display: 'flex', gap: 1, px: 2.5, pb: 1.5, flexWrap: 'wrap' }}>
        <ButtonBase onClick={openLang} sx={{ height: 40, px: 1.75, gap: 0.75, borderRadius: '999px', bgcolor: 'background.paper', border: 1, borderColor: 'divider', fontSize: 14, fontWeight: 700 }}>
          {chip}
          {recording ? <LockOutlinedIcon sx={{ fontSize: 15, color: 'text.secondary' }} /> : <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.secondary' }} />}
        </ButtonBase>
        {/* 마이크 칩 → 고급 설정(민감도·입력 크기 기준선)으로 바로 */}
        <ButtonBase onClick={p.onMicSettings} aria-label="마이크 민감도 설정" sx={{ height: 40, px: 1.75, display: 'flex', alignItems: 'center', gap: 1, borderRadius: '999px', bgcolor: 'background.paper', border: 1, borderColor: 'divider', fontSize: 13.5, fontWeight: 500, minWidth: 0 }}>
          <Box aria-hidden="true" sx={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: 14 }}>
            {bars.map((on, i) => (
              <Box key={i} sx={{ width: 3, height: [6, 9, 12, 14][i], borderRadius: '2px', bgcolor: on ? 'success.main' : 'divider' }} />
            ))}
          </Box>
          <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 500, maxWidth: 170 }}>{p.micMuted && recording ? '발화 멈춤' : mic.name.replace(/\s*\(.*\)$/, '') /* 모델명은 홈·앱 정보에서 — 칩은 한 줄에 */}{p.stereoInfo && p.stereoInfo.state === 'stereo' ? ' · 2채널' : ''}</Typography>
        </ButtonBase>
      </Box>

      {(p.notice || (recording && connecting)) && (
        <Box sx={{ mx: 2.5, mb: 1, px: 2, py: 1.25, borderRadius: '14px', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 1, bgcolor: (t) => alpha(p.notice ? t.palette.warning.main : t.palette.text.primary, p.notice ? 0.14 : 0.06), color: p.notice ? 'warning.main' : 'text.secondary' }}>
          {!p.notice && <CircularProgress size={14} color="inherit" />}
          {p.notice || '엔진 연결 중… 첫 인식까지 몇 초 걸릴 수 있어요.'}
        </Box>
      )}

      {/* 대화 */}
      <Box ref={p.scrollRef} sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: twoway ? 2 : 3, pt: 1, pb: 2.5, display: 'flex', flexDirection: 'column', gap: twoway ? 1.75 : 2.75, overscrollBehavior: 'contain' }}>
        <Box sx={{ flex: 1 }} />
        {messages.length === 0 ? (
          <Typography sx={{ textAlign: 'center', color: 'text.secondary', fontSize: 15, py: 6 }}>
            {recording ? '말씀하세요. 인식되는 대로 여기에 표시됩니다.' : '아래 버튼을 눌러 시작하세요.'}
          </Typography>
        ) : messages.map((m) => {
          const keys = m.texts ? Object.keys(m.texts) : [];
          const tk = keys[0];
          const text = tk ? m.texts[tk] : '';
          if (!twoway) return <Line key={m.id} text={text} source={m.source} draft={!!m.draft} scale={scale} />;
          // 타깃이 내 언어(A)면 상대(B)가 말한 것 — 데스크톱 dir 판정과 동일
          const mine = tk ? tk !== p.sxA : true;
          const who = mine ? `나 · ${langName(p.sxA, p.sxLangs)}` : `상대 · ${langName(p.sxB, p.sxLangs)}`;
          return <Bubble key={m.id} mine={mine} who={who} text={text} source={m.source} draft={!!m.draft} scale={scale} />;
        })}
      </Box>

      {/* 하단 조작부 */}
      <Box sx={{ bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider', borderTopLeftRadius: '28px', borderTopRightRadius: '28px', px: 3, pt: 1.75, pb: 'calc(28px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, fontSize: 13.5, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minHeight: 20 }}>
          {recording ? (
            <>
              <Box sx={{ width: 8, height: 8, borderRadius: '999px', bgcolor: p.connState === 'reconn' ? 'warning.main' : 'error.main' }} />
              {p.connState === 'reconn' ? '다시 연결하는 중' : (twoway ? '통역 중' : '번역 중')}
              {p.recStartAt ? ` · ${fmtElapsed(now - p.recStartAt)}` : ''}
            </>
          ) : (
            <Typography component="span" sx={{ fontSize: 13.5, color: 'text.secondary' }}>대기 중</Typography>
          )}
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'center', justifyItems: 'center' }}>
          <DockButton label={p.micMuted ? '발화 시작' : '발화 멈춤'} onClick={p.onToggleMute} disabled={!recording} active={recording && p.micMuted}>
            {p.micMuted ? <MicOffIcon /> : <MicNoneIcon />}
          </DockButton>
          <ButtonBase onClick={recording ? p.onStop : p.onStart} aria-label={recording ? '정지' : '시작'}
            sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.75, borderRadius: '20px', p: 0.5 }}>
            <Box sx={{
              width: 78, height: 78, borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: recording ? 'error.main' : 'text.primary',
              boxShadow: (t) => `0 0 0 6px ${alpha(recording ? t.palette.error.main : t.palette.text.primary, 0.12)}`,
            }}>
              {recording
                ? <Box sx={{ width: 24, height: 24, borderRadius: '6px', bgcolor: '#fff' }} />
                : <MicNoneIcon sx={{ fontSize: 34, color: 'background.paper' }} />}
            </Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 700 }}>{recording ? '정지' : '시작'}</Typography>
          </ButtonBase>
          <DockButton label="음성 출력" onClick={p.onToggleTts} disabled={!p.ttsAllowed} active={p.ttsOn && p.ttsAllowed}>
            {p.ttsOn && p.ttsAllowed ? <VolumeUpIcon /> : <VolumeOffIcon />}
          </DockButton>
        </Box>
      </Box>

      <LangSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="언어"
        subtitle={twoway ? '서로의 말을 상대 언어로 통역합니다' : '말한 내용을 출력 언어로 보여줍니다'}
        tabs={tabs}
        startTab={1}
      />
      <Snackbar open={!!toast} autoHideDuration={2600} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} />
    </Box>
  );
}
