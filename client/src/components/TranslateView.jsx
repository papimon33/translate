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
import MicNoneIcon from '@mui/icons-material/MicNone';
import MicOffIcon from '@mui/icons-material/MicOff';
import QrCode2Icon from '@mui/icons-material/QrCode2';
import PictureInPictureAltIcon from '@mui/icons-material/PictureInPictureAlt';
import TuneIcon from '@mui/icons-material/Tune';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import CloseIcon from '@mui/icons-material/Close';
import RefreshIcon from '@mui/icons-material/Refresh';
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

// 데스크: 무음 자동종료(대기 복귀) 시간 — 기본 30초
const DESK_IDLE = [
  { v: 10, label: '10초' },
  { v: 15, label: '15초' },
  { v: 20, label: '20초' },
  { v: 30, label: '30초 (기본)' },
  { v: 45, label: '45초' },
  { v: 60, label: '60초' },
];

const pulse = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(244,63,94,.5); }
  70% { box-shadow: 0 0 0 16px rgba(244,63,94,0); }
  100% { box-shadow: 0 0 0 0 rgba(244,63,94,0); }
`;
// 진행 중 자막 커서 깜빡임
const blink = keyframes`
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0.15; }
  100% { opacity: 1; }
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

// 읽기 전용(잠금) 값 표시 — 오디오 소스·출력 언어 등
function LockedValue({ label }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, height: 37, px: 1.25, borderRadius: 1.5, border: 1, borderColor: 'divider', bgcolor: (t) => alpha(t.palette.text.primary, 0.03) }}>
      <LockOutlinedIcon sx={{ fontSize: 15, color: 'text.disabled' }} />
      <Typography sx={{ fontSize: 13.5, fontWeight: 700, color: 'text.primary' }}>{label}</Typography>
    </Box>
  );
}
// 토글 + (i) 설명 툴팁 (+ 선택적 note: 스위치 옆 작은 안내)
function InfoToggle({ label, hint, checked, disabled, onChange, note }) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.02em' }}>{label}</Typography>
        <Tooltip title={hint} arrow>
          <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} />
        </Tooltip>
      </Box>
      <Box sx={{ height: 37, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Switch checked={checked} disabled={disabled} onChange={onChange} />
        {note && <Typography sx={{ fontSize: 10.5, color: 'text.disabled', whiteSpace: 'nowrap' }}>{note}</Typography>}
      </Box>
    </Box>
  );
}

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
  // 통역 프리셋: 소스/방향 기본값 (단방향=시스템·one→ko, 양방향/모바일=마이크·two)
  // 단방향 모드: 라이브 청취(live)·온라인 회의(oneway/online). 소스: 온라인만 시스템, 나머지 마이크.
  const onewayPreset = ['live', 'oneway', 'online'].includes(initial.preset);
  const [sourceMode, setSourceMode] = useState(['oneway', 'online'].includes(initial.preset) ? 'system' : 'mic');
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
    return Number.isFinite(v) && v >= 10 ? v : 30; // 초 (기본 30)
  });
  const [optsOpen, setOptsOpen] = useState(true); // 옵션(컨트롤) 바 접기 — 접으면 번역영역 넓어짐
  const [micSens, setMicSens] = useState(() => {
    const v = Number(localStorage.getItem('kac-mic-sens'));
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 100; // 마이크 음성인식 민감도 0~100 (100=가장 민감, 낮출수록 큰 소리만). 기기 저장
  });
  // 프리셋: 단방향=one→ko, 양방향/모바일=two. (없으면 기존 localStorage)
  const [sxMode, setSxMode] = useState(() => (initial.preset ? (onewayPreset ? 'one' : 'two') : (localStorage.getItem('kac-sx-mode') || 'one')));
  const [sxTarget, setSxTarget] = useState(() => (onewayPreset ? 'ko' : (localStorage.getItem('kac-sx-target') || 'en')));
  const [sxA, setSxA] = useState(() => localStorage.getItem('kac-sx-a') || 'ko');
  const [sxB, setSxB] = useState(() => localStorage.getItem('kac-sx-b') || 'en');
  const [ttsOn, setTtsOn] = useState(() => { const s = localStorage.getItem('kac-sx-tts'); return s === '1' ? true : s === '0' ? false : !onewayPreset; }); // 음성재생(TTS): 오프라인(대화) 기본 ON, 온라인 OFF
  const [viewerPTT, setViewerPTT] = useState(!!initial.viewerPTT); // 참여자 발화(휴대폰 토글) — 기본 OFF
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
  const [micMuted, setMicMuted] = useState(false); // 발화 일시정지(세션 유지, 마이크만 off)
  const [viewerActive, setViewerActive] = useState(false); // 데스크: 통역(응대) 진행 중인지
  const [deskGuestLang, setDeskGuestLang] = useState(null); // 데스크: 현재 응대 중인 손님 언어
  const [hostLang, setHostLang] = useState('en'); // 데스크: 호스트 수동 시작용 손님 언어
  const [level, setLevel] = useState(0);
  const [qr, setQr] = useState(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [sxSettingsOpen, setSxSettingsOpen] = useState(false);
  // AI 요약(세션 내 패널)
  const [sumOpen, setSumOpen] = useState(false);
  const [sumLoading, setSumLoading] = useState(false);
  const [sumData, setSumData] = useState(null); // { points:[], terms:[{src,ko}] }
  const [sumErr, setSumErr] = useState('');
  const [sumCopied, setSumCopied] = useState(false);
  const generateSummary = async () => {
    setSumLoading(true); setSumErr('');
    try { const d = await api.sessionSummary(initial.id); setSumData(d); }
    catch (e) { setSumErr(e.message || '요약 실패'); }
    finally { setSumLoading(false); }
  };
  const copySummary = async () => {
    if (!sumData) return;
    const lines = [];
    if (sumData.points && sumData.points.length) { lines.push('[핵심 요점]'); sumData.points.forEach((p) => lines.push('• ' + p)); }
    if (sumData.terms && sumData.terms.length) { lines.push('', '[주요 용어]'); sumData.terms.forEach((t) => lines.push('- ' + t.src + (t.ko ? ' → ' + t.ko : ''))); }
    try { await navigator.clipboard.writeText(lines.join('\n')); setSumCopied(true); setTimeout(() => setSumCopied(false), 1500); } catch {}
  };
  const [copied, setCopied] = useState(false);
  // 세션 제목(라이브 헤더에서 수정)
  const [sessTitle, setSessTitle] = useState(initial.title);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const openRename = () => { setRenameVal(sessTitle || ''); setRenameOpen(true); };
  const saveRename = () => { const v = (renameVal || '').trim() || '제목 없음'; setSessTitle(v); setRenameOpen(false); api.patch(initial.id, { title: v }).catch(() => {}); };
  const [speakers, setSpeakers] = useState(initial.speakers || {}); // 화자번호 -> 지정이름(다운로드 표기용)
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const recRef = useRef(null);
  const scrollRef = useRef(null);
  const onMessageRef = useRef(null); // 패시브 뷰어 연결이 최신 onMessage 를 호출하도록
  const stopReqRef = useRef(false); // 연결 중(시작 await)에 중지를 누른 경우 처리

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

  // 데스크: 패시브 뷰어 연결 — 뷰어(손님)가 시작해도 호스트 화면에 동시 표출(녹음 안 해도 수신)
  useEffect(() => {
    if (cfg.pipeline !== 'desk') return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ws = null, closed = false;
    const conn = () => {
      ws = new WebSocket(`${proto}://${location.host}/ws/viewer?session=${initial.id}`);
      ws.onmessage = (ev) => { try { onMessageRef.current && onMessageRef.current(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { if (!closed) setTimeout(conn, 1500); };
    };
    conn();
    return () => { closed = true; try { ws && ws.close(); } catch {} };
    // eslint-disable-next-line
  }, [cfg.pipeline, initial.id]);

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
    if (m.type === 'desk-reset') { // 데스크: 대화 종료 → 화면 초기화(다음 손님), 대기 상태로
      setMessages([]);
      setPartials({ left: '', right: '' });
      setViewerActive(false);
      setDeskGuestLang(null);
      return;
    }
    if (m.type === 'desk-active') { // 통역 시작됨(손님 언어 선택 또는 호스트 수동 시작)
      if (cfg.pipeline === 'desk') { setViewerActive(true); if (m.lang) setDeskGuestLang(m.lang); }
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
  onMessageRef.current = onMessage; // 패시브 뷰어 연결이 항상 최신 핸들러를 쓰도록

  const start = async () => {
    if (recording || recRef.current || startingRef.current) return; // 연타 중복 방지
    startingRef.current = true;
    stopReqRef.current = false;
    try {
      const rec = await startRecorder({
        sessionId: initial.id,
        mode: cfg.pipeline === 'desk' ? 'mic' : sourceMode, // 데스크는 항상 마이크
        deskIdle: cfg.pipeline === 'desk' ? deskIdle * 1000 : undefined, // 무음 자동중지(ms)
        inLang: cfg.inLang,
        outLang: cfg.outLang,
        pipeline: cfg.pipeline,
        refine: true,
        audioOut: (cfg.pipeline === 'translate' && audioOutOn) || (cfg.pipeline === 'soniox' && ttsOn),
        tts: cfg.pipeline === 'soniox' && ttsOn, // 음성재생(TTS)
        gender,
        volume,
        endpointing,
        micSens, // 마이크 음성인식 민감도(0~100): 일정 볼륨 이상만 전송하는 클라이언트 볼륨 게이트
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
      // 연결되는 동안 사용자가 중지를 눌렀으면 즉시 정리하고 켜지 않음
      if (stopReqRef.current) {
        try { rec.stop(); } catch {}
        setRecording(false);
        setConnecting(false);
        return;
      }
      recRef.current = rec;
      setRecording(true);
      setMicMuted(false); // 시작 시 발화 on
      setConnecting(cfg.pipeline !== 'desk'); // 엔진 연결~첫 결과까지 표시 (데스크는 대기 모드라 제외)
    } catch (e) {
      alert(e.message);
    } finally {
      startingRef.current = false;
    }
  };
  const stop = () => {
    stopReqRef.current = true; // 연결 중이면 시작 완료 시점에 정리되도록 표시
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
    setMicMuted(false);
    setConnecting(false);
    setLevel(0);
    setPartials({ left: '', right: '' });
  };
  // 발화 on/off (세션은 유지) — 다시 켜도 재연결 지연 없음
  const toggleMute = () => {
    const next = !micMuted;
    setMicMuted(next);
    if (recRef.current && recRef.current.setMuted) recRef.current.setMuted(next);
  };

  const toggleSrc = (v) => {
    setSrcVisible(v);
    localStorage.setItem('kac-src', v ? '1' : '0');
  };
  // 토글은 '완성 문장 아래 회색 원어'만 제어. 실시간 한 줄(partial)은 항상 표시.
  const showSource = cfg.pipeline === 'desk' ? true : (cfg.pipeline !== 'translate' && srcVisible);
  const showPartial = true;
  const twoway = cfg.pipeline === 'soniox' && !onewayPreset; // 양방향 번역(언어1↔언어2) — 방향별 색상 구분
  const PRESET_LABEL = { live: '라이브 청취', oneway: '온라인 회의', twoway: '양방향 번역', mobile: '양방향 번역', online: '온라인 회의', field: '양방향 번역', meeting: '양방향 번역' };
  const pipeLabel = initial.preset ? PRESET_LABEL[initial.preset] : PIPES.find((p) => p.v === cfg.pipeline)?.label;

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 타이틀 바 */}
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pt: 2, pb: 1.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton onClick={onBack} sx={{ width: 38, height: 38, borderRadius: '10px', border: 1, borderColor: 'divider', color: 'text.secondary' }}>
          <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" sx={{ width: 20, height: 20 }}><path d="M15 6l-6 6 6 6" /></Box>
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ fontWeight: 800, fontSize: 18, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {sessTitle}
            </Typography>
            {cfg.pipeline !== 'desk' && (
              <Tooltip title="제목 수정">
                <IconButton onClick={openRename} sx={{ width: 30, height: 30, flex: 'none', borderRadius: '9px', border: 1, borderColor: 'divider', color: 'text.secondary' }}>
                  <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" sx={{ width: 15, height: 15 }}><path d="M4 20h4L19 9l-4-4L4 16v4z" /></Box>
                </IconButton>
              </Tooltip>
            )}
            {cfg.pipeline !== 'desk' && (
              <Chip size="small" label={pipeLabel} sx={{ height: 22, fontSize: 11.5, fontWeight: 700, flex: 'none', bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }} />
            )}
          </Box>
          {cfg.pipeline === 'desk' && <Typography sx={{ fontSize: 12.5, color: 'text.secondary', mt: 0.25 }}>{pipeLabel}</Typography>}
        </Box>
        {recording && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.85, borderRadius: '9px', flex: 'none', bgcolor: (t) => alpha(t.palette.success.main, 0.14), color: 'success.main', fontSize: 13, fontWeight: 700 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main', animation: `${blink} 1.4s infinite` }} />진행 중
          </Box>
        )}
        {isElectron && (
          <Tooltip title="줌 위에 오버레이 창 열기">
            <IconButton onClick={openOverlay} sx={{ border: 1, borderColor: 'divider' }}>
              <PictureInPictureAltIcon />
            </IconButton>
          </Tooltip>
        )}
        {cfg.pipeline !== 'desk' && (
          <Button
            onClick={() => setSumOpen(true)}
            startIcon={<AutoAwesomeOutlinedIcon />}
            variant="outlined"
            sx={{ borderColor: 'divider', color: 'text.primary', fontWeight: 700, display: { xs: 'none', sm: 'inline-flex' } }}
          >
            AI 요약
          </Button>
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
        {cfg.pipeline === 'desk' && (
          <Tooltip title="전체화면">
            <IconButton
              onClick={() => { const el = document.documentElement; const fn = el.requestFullscreen || el.webkitRequestFullscreen; if (fn) try { fn.call(el); } catch {} }}
              sx={{ border: 1, borderColor: 'divider' }}
            >
              <FullscreenIcon />
            </IconButton>
          </Tooltip>
        )}
        {(cfg.pipeline === 'soniox' || cfg.pipeline === 'desk') && (
          <Tooltip title="고급 설정">
            <IconButton onClick={() => setSxSettingsOpen(true)} sx={{ border: 1, borderColor: 'divider' }}>
              <TuneIcon />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 컨트롤 바 (옵션) — 한 줄: 옵션(좌) · 마이크 입력(우) · 숨김 버튼(최우측) */}
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pb: 1.5 }}>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.text.primary, 0.015), overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap', px: 1.5, py: 1 }}>
          {optsOpen && (
          <>
          {cfg.pipeline !== 'desk' && cfg.pipeline !== 'soniox' && (
            <Field label="오디오 소스">
              <Select size="small" value={sourceMode} disabled={recording} onChange={(e) => setSourceMode(e.target.value)} sx={{ ...selSx, minWidth: 120 }}>
                {SRC.map((s) => (
                  <MenuItem key={s.v} value={s.v}>{s.label}</MenuItem>
                ))}
              </Select>
            </Field>
          )}
          {cfg.pipeline === 'desk' && (
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
          {cfg.pipeline === 'soniox' && onewayPreset && (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.02em' }}>입력 언어</Typography>
                  <Tooltip title="언어를 선택하면 더 정확하게 번역할 수 있습니다. (모든 언어 = 자동 감지)" arrow>
                    <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Select size="small" value={cfg.inLang} disabled={recording} onChange={(e) => patch({ inLang: e.target.value })} sx={{ ...selSx, minWidth: 130 }}>
                  <MenuItem value="auto">자동 감지</MenuItem>
                  {LANGS.filter((l) => l.code !== 'auto').map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Box>
              <Field label="출력 언어">
                <Select size="small" value={sxTarget} disabled={recording} onChange={(e) => { setSxTarget(e.target.value); localStorage.setItem('kac-sx-target', e.target.value); }} sx={{ ...selSx, minWidth: 120 }}>
                  {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              {['oneway', 'online'].includes(initial.preset) && (
                <InfoToggle
                  label="내 음성 인식"
                  hint="켜면 시스템 오디오와 함께 내 마이크(스피커)로 말한 것도 인식합니다."
                  checked={sourceMode === 'both'}
                  disabled={recording}
                  onChange={(e) => setSourceMode(e.target.checked ? 'both' : 'system')}
                />
              )}
              {['oneway', 'online'].includes(initial.preset) && (
                <InfoToggle
                  label="음성 재생"
                  hint="번역 결과를 음성(TTS)으로 재생합니다. 스피커로 틀면 시스템 소리에 다시 섞여 인식될 수 있으니 이어폰 사용을 권장합니다."
                  checked={ttsOn}
                  disabled={recording}
                  onChange={(e) => { setTtsOn(e.target.checked); localStorage.setItem('kac-sx-tts', e.target.checked ? '1' : '0'); }}
                />
              )}
            </>
          )}
          {cfg.pipeline === 'soniox' && !onewayPreset && (
            <>
              <Field label="언어 1">
                <Select size="small" value={sxA} disabled={recording} onChange={(e) => { setSxA(e.target.value); localStorage.setItem('kac-sx-a', e.target.value); }} sx={{ ...selSx, minWidth: 110 }}>
                  {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              <Field label="언어 2">
                <Select size="small" value={sxB} disabled={recording} onChange={(e) => { setSxB(e.target.value); localStorage.setItem('kac-sx-b', e.target.value); }} sx={{ ...selSx, minWidth: 110 }}>
                  {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              <InfoToggle
                label="음성 재생"
                hint="번역 결과를 음성(TTS)으로 재생합니다. 상대 음성이 다시 인식되는 것을 막기 위해 이어폰 사용을 권장합니다."
                checked={ttsOn}
                disabled={recording}
                onChange={(e) => { setTtsOn(e.target.checked); localStorage.setItem('kac-sx-tts', e.target.checked ? '1' : '0'); }}
              />
              {ttsOn && (
                <Field label="음성(성별)">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Select size="small" value={gender} disabled={recording} onChange={(e) => { setGender(e.target.value); localStorage.setItem('kac-sx-gender', e.target.value); }} sx={{ ...selSx, minWidth: 90 }}>
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
              <InfoToggle
                label="참여자 발화"
                hint="켜면 참여자가 휴대폰에서 '발화' 버튼을 눌러(토글) 직접 말할 수 있습니다. (양방향 대화용)"
                checked={viewerPTT}
                disabled={recording}
                onChange={(e) => { const v = e.target.checked; setViewerPTT(v); try { api.patch(initial.id, { viewerPTT: v }); } catch {} }}
              />
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
          </>
          )}

          <Box sx={{ flex: 1 }} />
          <Field label="마이크 입력">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 37 }}>
              <MicNoneIcon fontSize="small" sx={{ color: level > 2 ? 'success.main' : 'text.disabled' }} />
              <LinearProgress variant="determinate" value={level} color="success" sx={{ width: 90, height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }} />
            </Box>
          </Field>
          <Tooltip title={optsOpen ? '옵션 숨기기' : '옵션 펼치기'}>
            <IconButton size="small" onClick={() => setOptsOpen((o) => !o)} sx={{ border: 1, borderColor: 'divider', width: 28, height: 28, borderRadius: '8px', flex: 'none' }}>
              {optsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          </Box>
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

      {/* 채팅 + AI 요약(인라인 고정 패널) */}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <Box ref={scrollRef} sx={{ position: 'absolute', inset: 0, overflowY: 'auto', px: { xs: 1.5, sm: 3 }, py: 3, pb: 16 }}>
          <Box sx={{ maxWidth: 880, mx: 'auto', display: 'flex', flexDirection: 'column', gap: '30px' }}>
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
              // 양방향: 저장된 타깃 언어 키로 발화 방향 판별(언어1 발화→texts[언어2], 언어2 발화→texts[언어1])
              let dir = null;
              if (twoway && m.texts) {
                const tk = Object.keys(m.texts)[0];
                if (tk) dir = tk === sxA ? 'b' : 'a'; // 타깃이 언어1 → 언어2가 말함(b), 타깃이 언어2 → 언어1이 말함(a)
              }
              return <Row key={m.id} side={m.side} text={t} source={m.source} dir={dir} />;
            })}
            {showPartial && partials.left && <PartialLine side="left" text={partials.left} />}
            {showPartial && partials.right && <PartialLine side="right" text={partials.right} />}
          </Box>
        </Box>

        {/* 빈 화면 안내 — 번역 텍스트 영역의 수직 중앙 */}
        {messages.length === 0 && !partials.left && !partials.right && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary', pointerEvents: 'none' }}>
            <Typography sx={{ fontSize: 14 }}>버튼을 클릭해 실시간 번역을 시작하세요.</Typography>
          </Box>
        )}

        {/* 하단 그라데이션 + FAB */}
        <Box
          sx={{
            // 모바일: 화면 고정(스크롤해도 위치 유지) / 데스크톱: 채팅영역 하단
            position: { xs: 'fixed', sm: 'absolute' }, left: 0, right: 0, bottom: 0, height: 130, zIndex: 1100,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, pointerEvents: 'none',
            background: (t) => `linear-gradient(to top, ${t.palette.background.default}, transparent)`,
          }}
        >
          {cfg.pipeline === 'desk' ? (
            recording ? (
              <>
                <Chip
                  label={viewerActive ? `● 손님 응대 중${deskGuestLang ? ` (${OUT4.find((l) => l.code === deskGuestLang)?.label || deskGuestLang})` : ''}` : '● 대기 중'}
                  color={viewerActive ? 'error' : 'success'}
                  variant="filled"
                  sx={{ pointerEvents: 'auto', fontWeight: 800, fontSize: 14, py: 2, px: 1, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
                />
                {!viewerActive && (
                  <>
                    <Select size="small" value={hostLang} onChange={(e) => setHostLang(e.target.value)}
                      sx={{ pointerEvents: 'auto', bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', '& .MuiSelect-select': { py: 1 } }}>
                      {OUT4.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                    </Select>
                    <Button onClick={() => recRef.current && recRef.current.deskStart && recRef.current.deskStart(hostLang)} variant="contained" disableElevation
                      sx={{ pointerEvents: 'auto', px: 2.5, py: 1.25, borderRadius: 2.5, fontSize: 14, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                      통역 시작
                    </Button>
                  </>
                )}
                {viewerActive && (
                  <Button onClick={() => recRef.current && recRef.current.deskReset && recRef.current.deskReset()} variant="outlined"
                    sx={{ pointerEvents: 'auto', px: 2.5, py: 1.25, borderRadius: 2.5, fontSize: 14, fontWeight: 700, bgcolor: 'background.paper', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                    대기모드로
                  </Button>
                )}
                <Button onClick={stop} variant="text" sx={{ pointerEvents: 'auto', color: 'text.secondary', fontWeight: 700 }}>정지</Button>
              </>
            ) : (
              <Button onClick={start} variant="contained" disableElevation
                sx={{ pointerEvents: 'auto', px: 3.5, py: 1.25, borderRadius: 2.5, fontSize: 15, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }}>
                마이크 허용하고 대기 시작
              </Button>
            )
          ) : (
            <>
              {recording && (
                <Button
                  onClick={toggleMute}
                  disableElevation
                  startIcon={micMuted ? <MicOffIcon /> : <MicNoneIcon />}
                  variant="outlined"
                  color={micMuted ? 'inherit' : 'error'}
                  sx={{
                    pointerEvents: 'auto', px: 2.5, py: 1.25, borderRadius: 2.5, fontSize: 14, fontWeight: 700,
                    bgcolor: 'background.paper', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                    color: micMuted ? 'text.secondary' : 'error.main',
                  }}
                >
                  {micMuted ? '발화 시작' : '발화 멈춤'}
                </Button>
              )}
              <Button
                onClick={recording ? stop : start}
                disableElevation
                startIcon={
                  recording ? (
                    <Box sx={{ width: 9, height: 9, borderRadius: '2px', bgcolor: '#ff5a5f', animation: `${pulse} 1.6s infinite` }} />
                  ) : (
                    <Box sx={{ width: 0, height: 0, borderStyle: 'solid', borderWidth: '5px 0 5px 8px', borderColor: (t) => `transparent transparent transparent ${t.palette.mode === 'dark' ? '#111' : '#fff'}` }} />
                  )
                }
                sx={{
                  pointerEvents: 'auto', px: 3.5, py: 1.25, borderRadius: 2.5, fontSize: 15, fontWeight: 700,
                  color: (t) => (t.palette.mode === 'dark' ? '#111' : '#fff'),
                  bgcolor: (t) => (t.palette.mode === 'dark' ? '#fff' : '#111'),
                  boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
                  '&:hover': { bgcolor: (t) => (t.palette.mode === 'dark' ? '#e8e8e8' : '#000') },
                }}
              >
                {recording ? '중지' : '시작'}
              </Button>
            </>
          )}
        </Box>
      </Box>

      {sumOpen && cfg.pipeline !== 'desk' && (
        <Box sx={{ width: { xs: '100%', sm: 380 }, flex: 'none', borderLeft: 1, borderColor: 'divider', bgcolor: 'background.paper', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.75, borderBottom: 1, borderColor: 'divider', flex: 'none' }}>
            <AutoAwesomeOutlinedIcon sx={{ color: 'primary.main' }} />
            <Typography sx={{ fontWeight: 800, fontSize: 16, flex: 1 }}>AI 요약</Typography>
            <IconButton size="small" onClick={() => setSumOpen(false)}><CloseIcon fontSize="small" /></IconButton>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
            {!sumData && !sumLoading && !sumErr && (
              <Box sx={{ textAlign: 'center', mt: 5 }}>
                <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mb: 3, lineHeight: 1.6 }}>지금까지의 확정된 대화를 핵심 요점과 주요 용어로 정리합니다.</Typography>
                <Button variant="contained" startIcon={<AutoAwesomeOutlinedIcon />} onClick={generateSummary}>요약 생성</Button>
              </Box>
            )}
            {sumLoading && (
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, mt: 6, color: 'text.secondary' }}>
                <CircularProgress size={26} />
                <Typography sx={{ fontSize: 13 }}>요약을 생성하고 있어요…</Typography>
              </Box>
            )}
            {sumErr && !sumLoading && (
              <Box sx={{ mt: 3 }}>
                <Typography sx={{ fontSize: 13.5, color: 'error.main', mb: 2 }}>{sumErr}</Typography>
                <Button variant="outlined" startIcon={<RefreshIcon />} onClick={generateSummary}>다시 시도</Button>
              </Box>
            )}
            {sumData && !sumLoading && (
              (!(sumData.points && sumData.points.length) && !(sumData.terms && sumData.terms.length)) ? (
                <Typography sx={{ fontSize: 13.5, color: 'text.secondary', mt: 3, lineHeight: 1.6 }}>요약할 대화가 아직 없어요. 번역이 쌓인 뒤 다시 생성해 주세요.</Typography>
              ) : (
                <>
                  {sumData.points && sumData.points.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', letterSpacing: '.04em', mb: 1 }}>핵심 요점</Typography>
                      <Box component="ul" sx={{ m: 0, pl: 2.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {sumData.points.map((p, i) => (<Typography key={i} component="li" sx={{ fontSize: 14.5, lineHeight: 1.55 }}>{p}</Typography>))}
                      </Box>
                    </Box>
                  )}
                  {sumData.terms && sumData.terms.length > 0 && (
                    <Box sx={{ mb: 1 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 800, color: 'text.secondary', letterSpacing: '.04em', mb: 1 }}>주요 용어</Typography>
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {sumData.terms.map((t, i) => (
                          <Box key={i} sx={{ fontSize: 13, fontWeight: 500, px: 1.25, py: 0.75, borderRadius: '8px', border: 1, borderColor: 'divider', bgcolor: (th) => alpha(th.palette.text.primary, 0.02) }}>
                            {t.src}{t.ko ? ` · ${t.ko}` : ''}
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                </>
              )
            )}
          </Box>
          {sumData && !sumLoading && (
            <Box sx={{ display: 'flex', gap: 1, p: 2, borderTop: 1, borderColor: 'divider', flex: 'none' }}>
              <Button fullWidth variant="outlined" startIcon={sumCopied ? <CheckIcon /> : <ContentCopyIcon />} onClick={copySummary} sx={{ borderColor: 'divider', color: sumCopied ? 'success.main' : 'text.primary' }}>{sumCopied ? '복사됨' : '복사'}</Button>
              <Button fullWidth variant="contained" startIcon={<RefreshIcon />} onClick={generateSummary}>다시 생성</Button>
            </Box>
          )}
        </Box>
      )}
      </Box>

      <Dialog open={sxSettingsOpen} onClose={() => setSxSettingsOpen(false)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>고급 설정</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2.5 }}>이 설정은 이 기기에 저장됩니다.</Typography>
          <SxSlider label="마이크 음성인식 민감도" hint="100=가장 민감(모든 소리), 낮출수록 큰 소리에만 반응(주변 소음 무시)" value={micSens} min={0} max={100} step={1} disabled={recording}
            fmt={(v) => String(v)}
            onChange={(v) => { setMicSens(v); localStorage.setItem('kac-mic-sens', String(v)); }} />
          {cfg.pipeline === 'soniox' && (
            <>
              <SxSlider label="종료 민감도" hint="높을수록 더 자주/빨리 끊김" value={sxSens} min={-1} max={1} step={0.1} disabled={recording}
                fmt={(v) => (v > 0 ? '+' : '') + v.toFixed(1)}
                onChange={(v) => { setSxSens(v); localStorage.setItem('kac-sx-sens', String(v)); }} />
              <SxSlider label="최대 지연" hint="무음 후 이 시간 안에 강제 종료(ms)" value={sxMaxDelay} min={500} max={3000} step={100} disabled={recording}
                fmt={(v) => v + 'ms'}
                onChange={(v) => { setSxMaxDelay(v); localStorage.setItem('kac-sx-maxdelay', String(v)); }} />
              <SxSlider label="지연 레벨" hint="높을수록 저지연(끊김↑, 정확도↓)" value={sxLatency} min={0} max={3} step={1} disabled={recording}
                fmt={(v) => String(v)}
                onChange={(v) => { setSxLatency(v); localStorage.setItem('kac-sx-latency', String(v)); }} />
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="contained" onClick={() => setSxSettingsOpen(false)}>닫기</Button>
        </DialogActions>
      </Dialog>


      <Dialog open={qrOpen} onClose={() => setQrOpen(false)}>
        <DialogTitle sx={{ fontWeight: 800 }}>{cfg.pipeline === 'desk' ? '뷰어(손님 태블릿) 연결' : '모바일로 보기'}</DialogTitle>
        <DialogContent sx={{ textAlign: 'center', pb: 3 }}>
          <Typography sx={{ fontSize: 13, color: 'text.secondary', mb: 2 }}>
            {cfg.pipeline === 'desk'
              ? '손님 태블릿으로 QR을 스캔하면 이 안내데스크 전용 뷰어(입장 화면)가 열립니다.'
              : '같은 와이파이의 휴대폰으로 QR을 스캔하세요.'}
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

      <Dialog open={renameOpen} onClose={() => setRenameOpen(false)} PaperProps={{ sx: { width: 400, maxWidth: 400 } }}>
        <DialogTitle sx={{ fontWeight: 800 }}>제목 변경</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth size="small" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setRenameOpen(false)}>취소</Button>
          <Button variant="contained" onClick={saveRename}>저장</Button>
        </DialogActions>
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
  return (
    // 진행 중(interim): 액센트 색 + 깜빡이는 커서로 구분
    <Box sx={{ pb: 0.5 }}>
      <Typography
        noWrap
        sx={{ fontSize: { xs: 21, sm: 24 }, lineHeight: 1.5, fontWeight: 500, color: 'primary.main', overflow: 'hidden' }}
      >
        {oneLineReset(text)}
        <Box
          component="span"
          sx={{ display: 'inline-block', width: '3px', height: '1em', ml: '4px', borderRadius: '1px', bgcolor: 'primary.main', verticalAlign: '-0.15em', animation: `${blink} 1s steps(1, end) infinite` }}
        />
      </Typography>
    </Box>
  );
}

// 데스크톱: 모든 발화 좌측 정렬·전체 폭 사용. 마이크=보라색, 시스템=검정(라이트)/밝은(다크).
// 양방향(dir): 언어1 발화='a'(보라 액센트) · 언어2 발화='b'(무채색=검정/흰색) 로 방향 구분.
function Row({ side, text, source, dir }) {
  const isMic = side === 'right'; // 마이크 입력
  const pending = !text && !!source; // 번역 대기 중 → 원문을 흐리게
  const mainText = pending ? source : text;
  const mainColor = (t) => {
    if (pending) return t.palette.text.secondary;
    if (dir === 'a') return t.palette.primary.main; // 언어1 발화(액센트)
    if (dir === 'b') return t.palette.text.primary; // 언어2 발화(무채색)
    return isMic ? t.palette.primary.main : t.palette.text.primary;
  };
  return (
    // 카드/박스 없이 라인 구분선(하단)만. 번역문(큰 글씨) 위 · 원어(작은 회색) 아래. 원어 항상 표시.
    <Box sx={{ pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography
        sx={{
          fontSize: { xs: 21, sm: 24 },
          lineHeight: 1.5,
          fontWeight: 500,
          wordBreak: 'keep-all', // 띄어쓰기 없는 단어 중간에서 줄바꿈 금지
          overflowWrap: 'anywhere',
          color: mainColor,
          fontStyle: pending ? 'italic' : 'normal',
        }}
      >
        {mainText}
      </Typography>
      {pending && <Typography sx={{ fontSize: 12.5, color: 'text.disabled', mt: 0.3 }}>번역 중…</Typography>}
      {!pending && source && (
        <Typography sx={{ fontSize: 14.5, color: 'text.secondary', lineHeight: 1.5, mt: 0.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>{source}</Typography>
      )}
    </Box>
  );
}
