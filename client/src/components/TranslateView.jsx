import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import Fab from '@mui/material/Fab';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import DialogActions from '@mui/material/DialogActions';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import { alpha } from '@mui/material/styles';
import { keyframes } from '@mui/system';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import MicNoneIcon from '@mui/icons-material/MicNone';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import PictureInPictureAltIcon from '@mui/icons-material/PictureInPictureAlt';
import TuneIcon from '@mui/icons-material/Tune';
import PersonIcon from '@mui/icons-material/Person';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { api } from '../api.js';

function VolumeIcon({ level }) {
  if (!level) return <VolumeOffIcon fontSize="small" sx={{ color: 'text.disabled' }} />;
  if (level < 0.6) return <VolumeDownIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
  return <VolumeUpIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
}
import { LANGS, LANG_LABEL } from '../theme.js';
import { startRecorder } from '../audio.js';

const SRC = [
  { v: 'mic', label: '마이크' },
  { v: 'system', label: '시스템' },
  { v: 'both', label: '모두' },
];
const OUT4 = [
  { code: 'ko', label: '한국어' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
];
const PIPES = [
  { v: 'whisper', label: '다국어 번역 (구)' },
  { v: 'translate', label: '실시간 통역' },
  { v: 'deepgram', label: '다국어 번역 (Deepgram)' },
  { v: 'soniox', label: '다국어 번역' },
  { v: 'desk', label: '데스크 안내 모드' },
];
// Soniox 엔드포인트 튜닝 테스트용 프리셋 — 민감도 -1.0~1.0 (0.1 단위)
const SX_SENS = Array.from({ length: 21 }, (_, i) => {
  const v = +((i * 0.1) - 1).toFixed(1);
  return { v, label: v === 0 ? '0 (기본값)' : (v > 0 ? '+' : '') + v.toFixed(1) };
});
const SX_MAXDELAY = [
  { v: 500, label: '500ms (API 최소)' },
  { v: 700, label: '700ms' },
  { v: 1000, label: '1000ms' },
  { v: 1500, label: '1500ms' },
  { v: 2000, label: '2000ms (기본값)' },
  { v: 3000, label: '3000ms' },
];
const SX_LATENCY = [
  { v: 0, label: '0 (기본값)' },
  { v: 1, label: '1' },
  { v: 2, label: '2' },
  { v: 3, label: '3 (저지연)' },
];
// 번역 GPT 모델(테스트용)
const MODELS = [
  { v: 'gpt-5-nano', label: 'gpt-5-nano (기본)' },
  { v: 'gpt-5.4-mini', label: 'gpt-5.4-mini' },
];
// Deepgram endpointing(문장종료 무음, ms) 테스트용 프리셋. 클수록 문장이 길어짐.
const ENDPOINTS = [
  { v: 10, label: '10ms (Deepgram 기본값)' },
  { v: 50, label: '50ms' },
  { v: 100, label: '100ms' },
  { v: 150, label: '150ms' },
  { v: 200, label: '200ms' },
  { v: 300, label: '300ms' },
  { v: 500, label: '500ms' },
  { v: 800, label: '800ms' },
  { v: 1200, label: '1200ms' },
];

// 데스크: 무음 자동중지(세션 리셋) 시간 — 기본 7초
const DESK_IDLE = [
  { v: 3, label: '3초' },
  { v: 5, label: '5초' },
  { v: 7, label: '7초 (기본)' },
  { v: 10, label: '10초' },
  { v: 15, label: '15초' },
  { v: 20, label: '20초' },
];

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(244,63,94,.5); }
  70% { box-shadow: 0 0 0 16px rgba(244,63,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(244,63,94,0); }
`;

function Field({ label, children }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.02em' }}>{label}</Typography>
      {children}
    </Box>
  );
}

const selSx = { '& .MuiSelect-select': { py: 0.85 }, bgcolor: 'background.paper' };

function SxSlider({ label, hint, value, min, max, step, disabled, fmt, onChange }) {
  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
        <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>{label}</Typography>
        <Typography sx={{ fontSize: 13, color: 'primary.main', fontWeight: 700 }}>{fmt(value)}</Typography>
      </Box>
      <Slider size="small" value={value} min={min} max={max} step={step} disabled={disabled} onChange={(e, v) => onChange(v)} />
      <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>{hint}</Typography>
    </Box>
  );
}

export default function TranslateView({ session: initial, onBack }) {
  const [cfg, setCfg] = useState({
    pipeline: initial.pipeline || 'whisper',
    inLang: initial.inLang || 'auto',
    langs: initial.langs && initial.langs.length ? initial.langs : [initial.outLang || 'ko'],
    outLang: initial.outLang || 'ko',
  });
  const [dispLang, setDispLang] = useState(initial.outLang || 'ko'); // 화면에 표시할 언어
  const [sourceMode, setSourceMode] = useState('mic');
  const [srcVisible, setSrcVisible] = useState(localStorage.getItem('kac-src') !== '0');
  const [audioOutOn, setAudioOutOn] = useState(localStorage.getItem('kac-audioout') === '1');
  const [volume, setVolume] = useState(() => {
    const v = Number(localStorage.getItem('kac-vol'));
    return Number.isFinite(v) && v > 0 ? v : 1;
  });
  const [endpointing, setEndpointing] = useState(() => {
    const v = Number(localStorage.getItem('kac-dg-endpointing'));
    return Number.isFinite(v) && v > 0 ? v : 1200;
  });
  const [sxSens, setSxSens] = useState(() => {
    const v = Number(localStorage.getItem('kac-sx-sens'));
    return Number.isFinite(v) ? v : 0;
  });
  const [sxMaxDelay, setSxMaxDelay] = useState(() => {
    const v = Number(localStorage.getItem('kac-sx-maxdelay'));
    return Number.isFinite(v) && v > 0 ? v : 2000;
  });
  const [sxLatency, setSxLatency] = useState(() => {
    const v = Number(localStorage.getItem('kac-sx-latency'));
    return Number.isFinite(v) ? v : 0;
  });
  const [deskIdle, setDeskIdle] = useState(() => {
    const v = Number(localStorage.getItem('kac-desk-idle'));
    return Number.isFinite(v) && v > 0 ? v : 7; // 초
  });
  const [sxMode, setSxMode] = useState(() => localStorage.getItem('kac-sx-mode') || 'one'); // 'one' | 'two'
  const [sxTarget, setSxTarget] = useState(() => localStorage.getItem('kac-sx-target') || 'en');
  const [sxA, setSxA] = useState(() => localStorage.getItem('kac-sx-a') || 'ko');
  const [sxB, setSxB] = useState(() => localStorage.getItem('kac-sx-b') || 'en');
  const [ttsOn, setTtsOn] = useState(localStorage.getItem('kac-sx-tts') === '1'); // Cartesia TTS 음성 출력
  const [diar, setDiar] = useState(localStorage.getItem('kac-sx-diar') !== '0'); // 화자 구분(기본 ON)
  const [gender, setGender] = useState(() => localStorage.getItem('kac-sx-gender') || 'f'); // 음성 성별
  const [previewing, setPreviewing] = useState(false);
  const previewVoice = async () => {
    if (previewing) return;
    const lang = sxMode === 'two' ? sxA : sxTarget; // 출력언어로 미리듣기
    setPreviewing(true);
    try {
      const blob = await api.ttsPreview(lang, gender);
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      a.onended = () => URL.revokeObjectURL(url);
      await a.play();
    } catch (e) {
      alert('미리듣기 실패: ' + (e.message || e));
    } finally {
      setPreviewing(false);
    }
  };
  const [messages, setMessages] = useState([]);
  const [partials, setPartials] = useState({ left: '', right: '' });
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [qr, setQr] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [sxSettingsOpen, setSxSettingsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [speakers, setSpeakers] = useState(initial.speakers || {}); // 화자번호 -> 지정이름
  const [speakerEdit, setSpeakerEdit] = useState(null); // 편집 중인 화자 번호
  const [speakerInput, setSpeakerInput] = useState('');
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const recRef = useRef(null);
  const scrollRef = useRef(null);

  const startingRef = useRef(false); // 시작 버튼 연타로 중복 세션 생성 방지
  // 번역 GPT 모델(테스트용). 기본 gpt-5-nano.
  const [model, setModel] = useState(() => localStorage.getItem('kac-model') || 'gpt-5-nano');
  // Electron(통합 데스크톱 앱)에서만 노출되는 오버레이 버튼
  const isElectron = typeof window !== 'undefined' && !!(window.kac && window.kac.isElectron);
  const openOverlay = () => {
    if (window.kac) window.kac.openOverlay({ session: initial.id, lang: dispLang });
  };

  useEffect(() => {
    api.get(initial.id).then((s) => {
      const ls = s.langs && s.langs.length ? s.langs : [s.outLang || 'ko'];
      setMessages(
        s.items.map((it) => ({
          id: it.id,
          side: it.side,
          texts: it.texts || (it.text ? { [ls[0]]: it.text } : {}), // 옛 형식 호환
          source: it.source,
          speaker: it.speaker || null,
        }))
      );
      setSpeakers(s.speakers || {});
      setCfg({
        pipeline: s.pipeline || 'whisper',
        inLang: s.inLang || 'auto',
        langs: s.langs && s.langs.length ? s.langs : [s.outLang || 'ko'],
        outLang: s.outLang || 'ko',
      });
      setDispLang(s.outLang || 'ko');
    });
    api.qr(initial.id).then(setQr);
    return () => recRef.current?.stop();
    // eslint-disable-next-line
  }, [initial.id]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, partials]);

  // 연결/인식이 지나치게 지연되면 무한 스피너 대신 안내로 전환(특히 시스템 오디오)
  useEffect(() => {
    if (!connecting) return;
    const t = setTimeout(() => {
      setConnecting(false);
      setNotice('연결/인식이 지연되고 있어요. 시스템 오디오를 쓰는 경우 실제로 소리가 재생 중인지, 입력 소스가 맞는지 확인해 주세요.');
      setTimeout(() => setNotice(''), 9000);
    }, 12000);
    return () => clearTimeout(t);
  }, [connecting]);

  const patch = (next) => {
    setCfg((c) => ({ ...c, ...next }));
    api.patch(initial.id, next);
  };

  // 화자 이름: 지정값 있으면 이름, 없으면 번호 그대로
  const speakerName = (id) => (id ? (speakers[id] || id) : null);
  const openSpeakerEdit = (id) => { setSpeakerInput(speakers[id] || ''); setSpeakerEdit(id); };
  const saveSpeaker = () => {
    const id = speakerEdit;
    if (!id) return;
    const name = speakerInput.trim().slice(0, 40);
    const next = { ...speakers };
    if (name) next[id] = name; else delete next[id];
    setSpeakers(next);
    setSpeakerEdit(null);
    api.patch(initial.id, { speakers: next }).catch(() => {});
  };

  // 전문 다운로드: "* [화자] : 발언" 형식 (.txt)
  const downloadTranscript = () => {
    const lines = [];
    for (const m of messages) {
      let t = m.texts ? (m.texts[dispLang] || Object.values(m.texts)[0] || '') : '';
      t = (t || m.source || '').trim();
      if (!t) continue;
      if (m.speaker) lines.push(`* [${speakers[m.speaker] || ('화자 ' + m.speaker)}] : ${t}`);
      else lines.push(`* ${t}`);
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(initial.title || 'transcript').replace(/[\\/:*?"<>|]/g, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onMessage = (m) => {
    if (m.type === 'idle-stop') {
      stop();
      setNotice('1분간 입력이 없어 자동으로 중지했습니다. 다시 시작하려면 시작 버튼을 누르세요.');
      setTimeout(() => setNotice(''), 6000);
      return;
    }
    if (m.type === 'desk-reset') { // 데스크: 대화 종료 → 화면 초기화(다음 손님)
      setMessages([]);
      setPartials({ left: '', right: '' });
      return;
    }
    if (m.type === 'partial' || m.type === 'sentence') setConnecting(false); // 첫 결과 도착 → 연결중 해제
    if (m.type === 'partial') {
      setPartials((p) => ({ ...p, [m.side || 'right']: m.text || '' }));
    } else if (m.type === 'sentence') {
      const side = m.side || 'right';
      setPartials((p) => ({ ...p, [side]: '' }));
      setMessages((arr) => {
        const i = arr.findIndex((x) => x.id === m.id);
        if (i >= 0) {
          const copy = arr.slice();
          copy[i] = {
            ...copy[i],
            texts: { ...copy[i].texts, ...(m.texts || {}) },
            source: m.source ?? copy[i].source,
            speaker: m.speaker ?? copy[i].speaker,
          };
          return copy;
        }
        return [...arr, { id: m.id, side, texts: m.texts || {}, source: m.source, speaker: m.speaker || null }];
      });
    }
  };

  const start = async () => {
    if (recording || recRef.current || startingRef.current) return; // 연타 중복 방지
    startingRef.current = true;
    try {
      recRef.current = await startRecorder({
        sessionId: initial.id,
        mode: cfg.pipeline === 'desk' ? 'mic' : sourceMode, // 데스크는 항상 마이크
        deskIdle: cfg.pipeline === 'desk' ? deskIdle * 1000 : undefined, // 무음 자동중지(ms)
        inLang: cfg.inLang,
        outLang: cfg.outLang,
        pipeline: cfg.pipeline,
        refine: true,
        audioOut: cfg.pipeline === 'translate' && audioOutOn, // 호스트 재생은 translate만(soniox TTS는 폰으로만)
        tts: cfg.pipeline === 'soniox' && ttsOn,
        gender,
        diar: cfg.pipeline === 'soniox' && diar,
        volume,
        endpointing,
        sxSens,
        sxMaxDelay,
        sxLatency,
        sxMode,
        sxTarget,
        sxA,
        sxB,
        model,
        onMessage,
        onMeter: (rms) => {
          const db = 20 * Math.log10(rms + 1e-8);
          setLevel(Math.max(0, Math.min(100, ((db + 60) / 60) * 100)));
        },
      });
      setRecording(true);
      setConnecting(true); // 엔진 연결~첫 결과까지 표시
    } catch (e) {
      alert(e.message);
    } finally {
      startingRef.current = false;
    }
  };
  const stop = () => {
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
    setConnecting(false);
    setLevel(0);
    setPartials({ left: '', right: '' });
  };

  const toggleSrc = (v) => {
    setSrcVisible(v);
    localStorage.setItem('kac-src', v ? '1' : '0');
  };
  // 토글은 '완성 문장 아래 회색 원어'만 제어. 실시간 한 줄(partial)은 항상 표시.
  const showSource = cfg.pipeline === 'desk' ? true : (cfg.pipeline !== 'translate' && srcVisible);
  const showPartial = true;
  const pipeLabel = PIPES.find((p) => p.v === cfg.pipeline)?.label;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 타이틀 바 */}
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton onClick={onBack} size="small" sx={{ border: 1, borderColor: 'divider' }}>
          <ArrowBackIcon fontSize="small" />
        </IconButton>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 17, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 360 }}>
            {initial.title}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{pipeLabel}</Typography>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Chip
          size="small"
          color={recording ? 'error' : 'default'}
          variant={recording ? 'filled' : 'outlined'}
          label={recording ? '● 녹음 중' : '대기'}
          sx={{ fontWeight: 700 }}
        />
        {isElectron && (
          <Tooltip title="줌 위에 오버레이 창 열기">
            <IconButton onClick={openOverlay} sx={{ border: 1, borderColor: 'divider' }}>
              <PictureInPictureAltIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip title="전문 다운로드(.txt)">
          <span>
            <IconButton onClick={downloadTranscript} disabled={messages.length === 0} sx={{ border: 1, borderColor: 'divider' }}>
              <FileDownloadOutlinedIcon />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="모바일로 보기">
          <IconButton onClick={() => setQrOpen(true)} sx={{ border: 1, borderColor: 'divider' }}>
            <QrCode2Icon />
          </IconButton>
        </Tooltip>
        {(cfg.pipeline === 'soniox' || cfg.pipeline === 'desk') && (
          <Tooltip title="고급 설정">
            <IconButton onClick={() => setSxSettingsOpen(true)} sx={{ border: 1, borderColor: 'divider' }}>
              <TuneIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 컨트롤 바 */}
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pb: 1.5 }}>
        <Paper
          variant="outlined"
          sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', borderRadius: 3, bgcolor: (t) => alpha(t.palette.text.primary, 0.015) }}
        >
          {cfg.pipeline !== 'desk' && (
            <Field label="오디오 소스">
              <Select size="small" value={sourceMode} disabled={recording} onChange={(e) => setSourceMode(e.target.value)} sx={{ ...selSx, minWidth: 120 }}>
                {SRC.map((s) => (
                  <MenuItem key={s.v} value={s.v}>{s.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}
          {cfg.pipeline === 'desk' && (
            <>
              <Field label="음성 감지 민감도">
                <Select
                  size="small"
                  value={sxSens}
                  disabled={recording}
                  onChange={(e) => { const v = Number(e.target.value); setSxSens(v); localStorage.setItem('kac-sx-sens', String(v)); }}
                  sx={{ ...selSx, minWidth: 130 }}
                >
                  {SX_SENS.map((o) => (<MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>))}
                </Select>
              </Field>
              <Field label="세션 자동중지(무음)">
                <Select
                  size="small"
                  value={deskIdle}
                  disabled={recording}
                  onChange={(e) => { const v = Number(e.target.value); setDeskIdle(v); localStorage.setItem('kac-desk-idle', String(v)); }}
                  sx={{ ...selSx, minWidth: 120 }}
                >
                  {DESK_IDLE.map((o) => (<MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>))}
                </Select>
              </Field>
            </>
          )}
          {cfg.pipeline !== 'translate' && cfg.pipeline !== 'soniox' && cfg.pipeline !== 'desk' && (
            <Field label="입력 언어">
              <Select size="small" value={cfg.inLang} disabled={recording} onChange={(e) => patch({ inLang: e.target.value })} sx={{ ...selSx, minWidth: 120 }}>
                {LANGS.map((l) => (
                  <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}
          {cfg.pipeline === 'deepgram' && (
            <Field label="문장종료 무음(테스트)">
              <Select
                size="small"
                value={endpointing}
                disabled={recording}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setEndpointing(v);
                  localStorage.setItem('kac-dg-endpointing', String(v));
                }}
                sx={{ ...selSx, minWidth: 140 }}
              >
                {ENDPOINTS.map((o) => (
                  <MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}
          {cfg.pipeline === 'soniox' && (
            <>
              <Field label="번역 방향">
                <Select
                  size="small"
                  value={sxMode}
                  disabled={recording}
                  onChange={(e) => { setSxMode(e.target.value); localStorage.setItem('kac-sx-mode', e.target.value); }}
                  sx={{ ...selSx, minWidth: 110 }}
                >
                  <MenuItem value="one">단방향</MenuItem>
                  <MenuItem value="two">양방향</MenuItem>
                </Select>
              </Field>
              {sxMode === 'one' ? (
                <Field label="출력 언어">
                  <Select
                    size="small"
                    value={sxTarget}
                    disabled={recording}
                    onChange={(e) => { setSxTarget(e.target.value); localStorage.setItem('kac-sx-target', e.target.value); }}
                    sx={{ ...selSx, minWidth: 120 }}
                  >
                    {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                  </Select>
                </Field>
              ) : (
                <>
                  <Field label="언어 A">
                    <Select
                      size="small"
                      value={sxA}
                      disabled={recording}
                      onChange={(e) => { setSxA(e.target.value); localStorage.setItem('kac-sx-a', e.target.value); }}
                      sx={{ ...selSx, minWidth: 110 }}
                    >
                      {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                    </Select>
                  </Field>
                  <Field label="언어 B">
                    <Select
                      size="small"
                      value={sxB}
                      disabled={recording}
                      onChange={(e) => { setSxB(e.target.value); localStorage.setItem('kac-sx-b', e.target.value); }}
                      sx={{ ...selSx, minWidth: 110 }}
                    >
                      {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                    </Select>
                  </Field>
                </>
              )}
              <Field label="음성재생(TTS)">
                <Box sx={{ height: 37, display: 'flex', alignItems: 'center' }}>
                  <Switch
                    checked={ttsOn}
                    disabled={recording}
                    onChange={(e) => { setTtsOn(e.target.checked); localStorage.setItem('kac-sx-tts', e.target.checked ? '1' : '0'); }}
                  />
                </Box>
              </Field>
              {ttsOn && (
                <Field label="음성(성별)">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Select
                      size="small"
                      value={gender}
                      disabled={recording}
                      onChange={(e) => { setGender(e.target.value); localStorage.setItem('kac-sx-gender', e.target.value); }}
                      sx={{ ...selSx, minWidth: 90 }}
                    >
                      <MenuItem value="f">여성</MenuItem>
                      <MenuItem value="m">남성</MenuItem>
                    </Select>
                    <Tooltip title="미리듣기(출력 언어)">
                      <span>
                        <IconButton size="small" onClick={previewVoice} disabled={previewing} sx={{ border: 1, borderColor: 'divider' }}>
                          <VolumeUpIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Field>
              )}
            </>
          )}
          {cfg.pipeline !== 'soniox' && cfg.pipeline !== 'desk' && (
            <Field label="출력 언어">
              <Select
                size="small"
                value={dispLang}
                disabled={cfg.pipeline === 'translate' && recording}
                onChange={(e) => {
                  const v = e.target.value;
                  setDispLang(v);
                  if (cfg.pipeline === 'translate') {
                    setCfg((c) => ({ ...c, outLang: v }));
                    api.patch(initial.id, { outLang: v }); // translate 타깃 변경
                  }
                }}
                sx={{ ...selSx, minWidth: 120 }}
              >
                {OUT4.map((l) => (
                  <MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}
          {cfg.pipeline !== 'desk' && (
            <Field label="원어 표시">
              <Box sx={{ height: 37, display: 'flex', alignItems: 'center' }}>
                <Switch checked={srcVisible} onChange={(e) => toggleSrc(e.target.checked)} />
              </Box>
            </Field>
          )}
          {cfg.pipeline === 'translate' && (
            <Field label="음성 출력">
              <Box sx={{ height: 37, display: 'flex', alignItems: 'center' }}>
                <Switch
                  checked={audioOutOn}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setAudioOutOn(v);
                    localStorage.setItem('kac-audioout', v ? '1' : '0');
                    if (recRef.current && recRef.current.setAudioOut) recRef.current.setAudioOut(v);
                  }}
                />
              </Box>
            </Field>
          )}
          {cfg.pipeline === 'translate' && audioOutOn && (
            <Field label="볼륨">
              <Box sx={{ height: 37, display: 'flex', alignItems: 'center', gap: 1, minWidth: 120 }}>
                <VolumeIcon level={volume} />
                <Slider
                  size="small"
                  value={volume}
                  min={0}
                  max={1.5}
                  step={0.05}
                  onChange={(e, v) => {
                    setVolume(v);
                    localStorage.setItem('kac-vol', String(v));
                    if (recRef.current && recRef.current.setVolume) recRef.current.setVolume(v);
                  }}
                  sx={{ width: 90 }}
                />
              </Box>
            </Field>
          )}

          {cfg.pipeline !== 'soniox' && cfg.pipeline !== 'desk' && (
            <Field label="번역 모델(테스트)">
              <Select
                size="small"
                value={model}
                disabled={recording}
                onChange={(e) => {
                  setModel(e.target.value);
                  localStorage.setItem('kac-model', e.target.value);
                }}
                sx={{ ...selSx, minWidth: 150 }}
              >
                {MODELS.map((m) => (
                  <MenuItem key={m.v} value={m.v}>{m.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}

          <Box sx={{ flex: 1 }} />

          <Field label="마이크 입력">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 37 }}>
              <MicNoneIcon fontSize="small" sx={{ color: level > 2 ? 'success.main' : 'text.disabled' }} />
              <LinearProgress
                variant="determinate"
                value={level}
                color="success"
                sx={{ width: 90, height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }}
              />
            </Box>
          </Field>
        </Paper>
      </Box>

      {notice && (
        <Box sx={{ mx: { xs: 1.5, sm: 3 }, mb: 1, px: 1.75, py: 1, borderRadius: 2, fontSize: 13, bgcolor: (t) => alpha(t.palette.warning.main, 0.14), color: 'warning.main', border: 1, borderColor: (t) => alpha(t.palette.warning.main, 0.4) }}>
          {notice}
        </Box>
      )}
      {recording && connecting && (
        <Box sx={{ mx: { xs: 1.5, sm: 3 }, mb: 1, px: 1.75, py: 1, borderRadius: 2, fontSize: 13, display: 'flex', alignItems: 'center', gap: 1, bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main', border: 1, borderColor: (t) => alpha(t.palette.primary.main, 0.35) }}>
          <CircularProgress size={14} color="inherit" /> 엔진 연결 중… 첫 인식까지 몇 초 걸릴 수 있어요.
        </Box>
      )}

      <Divider />

      {/* 채팅 */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Box ref={scrollRef} sx={{ position: 'absolute', inset: 0, overflowY: 'auto', px: { xs: 1.5, sm: 3 }, py: 3, pb: 16 }}>
          <Box sx={{ maxWidth: 880, mx: 'auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
            {messages.length === 0 && !partials.left && !partials.right && (
              <Box sx={{ textAlign: 'center', mt: 8, color: 'text.secondary' }}>
                <Typography sx={{ fontSize: 14 }}>버튼을 클릭해 실시간 번역을 시작하세요.</Typography>
              </Box>
            )}
            {messages.map((m) => {
              // 선택 언어만 표시(다른 언어로 대체하지 않음). 아직 없으면 원문을 placeholder 로.
              // translate 는 항목당 1개 언어만 저장 → 출력언어 변경 시 기존 메시지가 사라지지
              // 않도록 보유 텍스트로 폴백. whisper 는 선택 언어만(대체 X).
              let t = m.texts ? m.texts[dispLang] || '' : '';
              let usedLang = dispLang;
              if (!t && (cfg.pipeline === 'translate' || cfg.pipeline === 'soniox') && m.texts) {
                const keys = Object.keys(m.texts);
                if (keys.length) { usedLang = keys[0]; t = m.texts[usedLang]; }
              }
              return <Row key={m.id} side={m.side} text={t} source={m.source} showSource={showSource} speaker={m.speaker} speakerName={speakerName(m.speaker)} onSpeakerClick={openSpeakerEdit} />;
            })}
            {showPartial && partials.left && <PartialLine side="left" text={partials.left} />}
            {showPartial && partials.right && <PartialLine side="right" text={partials.right} />}
          </Box>
        </Box>

        {/* 하단 그라데이션 + FAB */}
        <Box
          sx={{
            // 모바일: 화면 고정(스크롤해도 위치 유지) / 데스크톱: 채팅영역 하단
            position: { xs: 'fixed', sm: 'absolute' }, left: 0, right: 0, bottom: 0, height: 130, zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
            background: (t) => `linear-gradient(to top, ${t.palette.background.default}, transparent)`,
          }}
        >
          <Button
            onClick={recording ? stop : start}
            disableElevation
            startIcon={
              recording ? (
                <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: '#ff5a5f', animation: `${pulse} 1.6s infinite` }} />
              ) : (
                // 다크모드: 흰 버튼 위 검은 삼각형 / 라이트모드: 검은 버튼 위 흰 삼각형
                <Box sx={{ width: 0, height: 0, borderStyle: 'solid', borderWidth: '5px 0 5px 8px', borderColor: (t) => `transparent transparent transparent ${t.palette.mode === 'dark' ? '#111' : '#fff'}` }} />
              )
            }
            sx={{
              pointerEvents: 'auto',
              px: 3.5,
              py: 1.25,
              borderRadius: 2.5,
              fontSize: 15,
              fontWeight: 700,
              color: (t) => (t.palette.mode === 'dark' ? '#111' : '#fff'),
              bgcolor: (t) => (t.palette.mode === 'dark' ? '#fff' : '#111'),
              boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
              '&:hover': { bgcolor: (t) => (t.palette.mode === 'dark' ? '#e8e8e8' : '#000') },
            }}
          >
            {recording ? '중지' : '시작'}
          </Button>
        </Box>
      </Box>

      <Dialog open={sxSettingsOpen} onClose={() => setSxSettingsOpen(false)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>고급 설정 (Soniox)</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2.5 }}>녹음 전에 설정하세요. 문장 끊김 타이밍을 조절합니다.</Typography>
          <SxSlider label="종료 민감도" hint="높을수록 더 자주/빨리 끊김" value={sxSens} min={-1} max={1} step={0.1} disabled={recording}
            fmt={(v) => (v > 0 ? '+' : '') + v.toFixed(1)}
            onChange={(v) => { setSxSens(v); localStorage.setItem('kac-sx-sens', String(v)); }} />
          <SxSlider label="최대 지연" hint="무음 후 이 시간 안에 강제 종료(ms)" value={sxMaxDelay} min={500} max={3000} step={100} disabled={recording}
            fmt={(v) => v + 'ms'}
            onChange={(v) => { setSxMaxDelay(v); localStorage.setItem('kac-sx-maxdelay', String(v)); }} />
          <SxSlider label="지연 레벨" hint="높을수록 저지연(끊김↑, 정확도↓)" value={sxLatency} min={0} max={3} step={1} disabled={recording}
            fmt={(v) => String(v)}
            onChange={(v) => { setSxLatency(v); localStorage.setItem('kac-sx-latency', String(v)); }} />
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mt: 1 }}>
            <Box>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700 }}>화자 구분</Typography>
              <Typography sx={{ fontSize: 11.5, color: 'text.secondary' }}>발화자별로 '화자 N' 표시 (정확도는 다소↓)</Typography>
            </Box>
            <Switch
              checked={diar}
              disabled={recording}
              onChange={(e) => { setDiar(e.target.checked); localStorage.setItem('kac-sx-diar', e.target.checked ? '1' : '0'); }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="contained" onClick={() => setSxSettingsOpen(false)}>닫기</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!speakerEdit} onClose={() => setSpeakerEdit(null)} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 800 }}>화자 이름 지정</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mb: 2 }}>
            화자 {speakerEdit}의 이름을 입력하세요. 이후 모든 발언과 다운로드·요약에 이 이름으로 표시됩니다. (비우면 번호로 되돌아갑니다.)
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="이름"
            value={speakerInput}
            onChange={(e) => setSpeakerInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveSpeaker(); }}
            inputProps={{ maxLength: 40 }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setSpeakerEdit(null)}>취소</Button>
          <Button variant="contained" onClick={saveSpeaker}>저장</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={qrOpen} onClose={() => setQrOpen(false)}>
        <DialogTitle sx={{ fontWeight: 800 }}>모바일로 보기</DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
            같은 와이파이의 휴대폰으로 QR을 스캔하세요.
          </Typography>
          {qr ? (
            <>
              <Box component="img" src={qr.qr} alt="QR" sx={{ width: 230, bgcolor: '#fff', borderRadius: 3, p: 1 }} />
              <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 1.5, wordBreak: 'break-all' }}>{qr.url}</Typography>
              <Box sx={{ mt: 1.5 }}>
                <Button
                  size="small"
                  variant="text"
                  color={copied ? 'success' : 'inherit'}
                  startIcon={copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(qr.url);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    } catch {}
                  }}
                  sx={{ fontSize: 12, color: copied ? 'success.main' : 'text.secondary' }}
                >
                  {copied ? '복사됨' : '주소 복사'}
                </Button>
              </Box>
            </>
          ) : (
            '생성 중...'
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}

// CJK 는 2칸으로 세는 시각적 길이
function isWide(c) {
  return /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c);
}
// 한 줄(약 CAPV 시각폭)을 넘으면 '지우고 처음부터' 보이도록, 마지막 구간만 반환
function oneLineReset(text) {
  const CAPV = 66;
  let segStart = 0;
  let v = 0;
  for (let i = 0; i < text.length; i++) {
    const w = isWide(text[i]) ? 2 : 1;
    if (v + w > CAPV) {
      segStart = i;
      v = w;
    } else {
      v += w;
    }
  }
  return text.slice(segStart);
}

// 진행 중 원어/번역: 항상 한 줄, 넘치면 비우고 처음부터
function PartialLine({ side, text }) {
  if (!text) return null;
  const isMic = side === 'right';
  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
      <Box
        sx={{
          width: '100%',
          minWidth: 0,
          textAlign: 'left',
          pl: 1.75,
          opacity: 0.6,
          overflow: 'hidden',
          borderLeft: '3px solid',
          borderColor: isMic ? 'primary.main' : 'divider',
        }}
      >
        <Typography
          noWrap
          sx={{ fontSize: 18, lineHeight: 1.6, fontStyle: 'italic', color: 'text.secondary', overflow: 'hidden' }}
        >
          {oneLineReset(text)}
        </Typography>
      </Box>
    </Box>
  );
}

// 데스크톱: 모든 발화 좌측 정렬·전체 폭 사용. 마이크=보라색, 시스템=검정(라이트)/밝은(다크).
function Row({ side, text, source, showSource, speaker, speakerName, onSpeakerClick }) {
  const isMic = side === 'right'; // 마이크 입력
  const pending = !text && !!source; // 번역 대기 중 → 원문을 흐리게
  const mainText = pending ? source : text;
  const subSource = showSource ? source : null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
      <Box
        sx={{
          width: '100%',
          textAlign: 'left',
          pl: 1.75,
          borderLeft: '3px solid',
          borderColor: isMic ? 'primary.main' : 'divider',
        }}
      >
        {speaker && (
          <Tooltip title="클릭해 화자 이름 지정">
            <Box
              onClick={() => onSpeakerClick && onSpeakerClick(speaker)}
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, mb: 0.4, px: 0.75, py: 0.1, borderRadius: 5, cursor: 'pointer', bgcolor: (t) => alpha(t.palette.primary.main, 0.12), color: 'primary.main', '&:hover': { bgcolor: (t) => alpha(t.palette.primary.main, 0.22) } }}
            >
              <PersonIcon sx={{ fontSize: 14 }} />
              <Typography component="span" sx={{ fontSize: 11, fontWeight: 800, lineHeight: 1.6 }}>{speakerName || speaker}</Typography>
            </Box>
          </Tooltip>
        )}
        <Typography
          sx={{
            fontSize: 18,
            lineHeight: 1.55,
            fontWeight: 300,
            wordBreak: 'keep-all', // 띄어쓰기 없는 단어 중간에서 줄바꿈 금지
            overflowWrap: 'anywhere',
            color: pending
              ? 'text.secondary'
              : isMic
              ? 'primary.main'
              : (t) => (t.palette.mode === 'dark' ? t.palette.text.primary : '#000'),
            fontStyle: pending ? 'italic' : 'normal',
          }}
        >
          {mainText}
        </Typography>
        {pending && <Typography sx={{ fontSize: 12, color: 'text.disabled', mt: 0.3 }}>번역 중…</Typography>}
        {subSource && !pending && (
          <Typography sx={{ fontSize: 13, color: 'text.disabled', lineHeight: 1.45, mt: 0.5, wordBreak: 'keep-all' }}>{source}</Typography>
        )}
      </Box>
    </Box>
  );
}
