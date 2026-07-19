import React, { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Button from '@mui/material/Button';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import ListItemIcon from '@mui/material/ListItemIcon';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import Switch from '@mui/material/Switch';
import Slider from '@mui/material/Slider';
import Fab from '@mui/material/Fab';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import CircularProgress from '@mui/material/CircularProgress';
import Collapse from '@mui/material/Collapse';
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
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import DeleteSweepOutlinedIcon from '@mui/icons-material/DeleteSweepOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ConfirmDialog from './ConfirmDialog.jsx';
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
// Soniox stt-rt-v5 지원 언어 전체(60) — 한·영·일·중을 상단에, 나머지는 가나다순
const SX_LANGS = [
  ...OUT4,
  { code: 'el', label: '그리스어' }, { code: 'nl', label: '네덜란드어' }, { code: 'no', label: '노르웨이어' },
  { code: 'da', label: '덴마크어' }, { code: 'de', label: '독일어' }, { code: 'lv', label: '라트비아어' },
  { code: 'ru', label: '러시아어' }, { code: 'ro', label: '루마니아어' }, { code: 'lt', label: '리투아니아어' },
  { code: 'mk', label: '마케도니아어' }, { code: 'mr', label: '마라티어' }, { code: 'ms', label: '말레이어' },
  { code: 'ml', label: '말라얄람어' }, { code: 'eu', label: '바스크어' },
  { code: 'bn', label: '벵골어' }, { code: 'bs', label: '보스니아어' }, { code: 'bg', label: '불가리아어' },
  { code: 'be', label: '벨라루스어' }, { code: 'vi', label: '베트남어' }, { code: 'sr', label: '세르비아어' },
  { code: 'sw', label: '스와힐리어' }, { code: 'sv', label: '스웨덴어' }, { code: 'es', label: '스페인어' },
  { code: 'sk', label: '슬로바키아어' }, { code: 'sl', label: '슬로베니아어' }, { code: 'ar', label: '아랍어' },
  { code: 'az', label: '아제르바이잔어' }, { code: 'af', label: '아프리칸스어' }, { code: 'sq', label: '알바니아어' },
  { code: 'et', label: '에스토니아어' }, { code: 'cy', label: '웨일스어' }, { code: 'uk', label: '우크라이나어' },
  { code: 'ur', label: '우르두어' }, { code: 'it', label: '이탈리아어' }, { code: 'id', label: '인도네시아어' },
  { code: 'gl', label: '갈리시아어' }, { code: 'gu', label: '구자라트어' }, { code: 'kk', label: '카자흐어' },
  { code: 'ca', label: '카탈루냐어' }, { code: 'kn', label: '칸나다어' }, { code: 'hr', label: '크로아티아어' },
  { code: 'ta', label: '타밀어' }, { code: 'th', label: '태국어' }, { code: 'te', label: '텔루구어' },
  { code: 'tr', label: '터키어' }, { code: 'pa', label: '펀자브어' }, { code: 'fa', label: '페르시아어' },
  { code: 'pt', label: '포르투갈어' }, { code: 'pl', label: '폴란드어' }, { code: 'fr', label: '프랑스어' },
  { code: 'fi', label: '핀란드어' }, { code: 'tl', label: '필리핀어' }, { code: 'hu', label: '헝가리어' },
  { code: 'he', label: '히브리어' }, { code: 'hi', label: '힌디어' }, { code: 'cs', label: '체코어' },
];
const PIPES = [
  { v: 'translate', label: '실시간 통역' },
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

// 데스크: 손님 언어 선택지(호스트용 — 한국어 표기, ko 제외. soniox two_way 지원 언어)
const DESK_LANGS = [
  { code: 'en', label: '영어' },
  { code: 'ja', label: '일본어' },
  { code: 'zh', label: '중국어' },
  { code: 'vi', label: '베트남어' },
  { code: 'th', label: '태국어' },
  { code: 'id', label: '인도네시아어' },
  { code: 'ru', label: '러시아어' },
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

// 고급 설정 섹션 캡션 — 항목이 많아져 기본/실험을 눈으로 구분(기능 변화 없음)
function SettingsCap({ children, first }) {
  return (
    <Typography sx={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.04em', color: 'text.disabled', mt: first ? 0 : 2.5, mb: 1.25, pb: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      {children}
    </Typography>
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
    pipeline: initial.pipeline || 'soniox',
    inLang: initial.inLang || 'auto',
    langs: initial.langs && initial.langs.length ? initial.langs : [initial.outLang || 'ko'],
    outLang: initial.outLang || 'ko',
  });
  const [dispLang, setDispLang] = useState(initial.outLang || 'ko'); // 화면에 표시할 언어
  // 통역 프리셋: 소스/방향 기본값 (단방향=시스템·one→ko, 양방향/모바일=마이크·two)
  // 단방향 모드: 라이브 청취(live)·온라인 회의(oneway/online). 소스: 온라인만 시스템, 나머지 마이크.
  const [preset, setPreset] = useState(initial.preset || null); // 번역 이력이 없으면 세션 안에서 변경 가능
  const onewayPreset = ['live', 'oneway', 'online'].includes(preset);
  const [sourceMode, setSourceMode] = useState(['oneway', 'online'].includes(initial.preset) ? 'system' : 'mic');
  const [srcVisible, setSrcVisible] = useState(localStorage.getItem('kac-src') !== '0');
  const [audioOutOn, setAudioOutOn] = useState(localStorage.getItem('kac-audioout') === '1');
  const [volume, setVolume] = useState(() => {
    const s = localStorage.getItem('kac-vol'); // 0(음소거)도 유효한 저장값 — v > 0 판정으로 무시되던 문제 수정
    const v = s == null ? NaN : Number(s);
    return Number.isFinite(v) && v >= 0 && v <= 1.5 ? v : 1;
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
  const [optsOpen, setOptsOpen] = useState(() => (typeof window === 'undefined' ? true : !window.matchMedia('(max-width: 599px)').matches)); // 옵션 바 — 모바일은 화면이 좁아 기본 접힘
  const [micSens, setMicSens] = useState(() => {
    const s = localStorage.getItem('kac-mic-sens'); // 미저장 시 Number(null)=0 으로 오인되지 않게 원문 확인
    const v = s == null ? NaN : Number(s);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 70; // 마이크 음성인식 민감도 0~100 (100=가장 민감, 낮출수록 조용한 소리 무시). 기본 70=속삭임·주변소음 걸러냄. 기기 저장
  });
  const [guestSens, setGuestSens] = useState(() => {
    const s = localStorage.getItem('kac-desk-guest-sens');
    const v = s == null ? NaN : Number(s);
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 50; // 여객 태블릿 마이크 민감도(데스크) — 50=기존 근접 게이트와 동일
  });
  // 프리셋: 단방향=one→ko, 양방향/모바일=two. (없으면 기존 localStorage)
  const [sxMode, setSxMode] = useState(() => (initial.preset ? (onewayPreset ? 'one' : 'two') : (localStorage.getItem('kac-sx-mode') || 'one')));
  const [sxTarget, setSxTarget] = useState(() => (onewayPreset ? 'ko' : (localStorage.getItem('kac-sx-target') || 'en')));
  const [sxA, setSxA] = useState(() => localStorage.getItem('kac-sx-a') || 'ko');
  const [sxB, setSxB] = useState(() => localStorage.getItem('kac-sx-b') || 'en');
  // 다국어 회의: 동시 번역 언어 집합(2~4개). 기기 저장.
  // 고급옵션: 단독 응답어(네/Yes/Okay 단독 발화) 기록 생략 — 기본 꺼짐(보존)
  const [dropAcks, setDropAcks] = useState(() => localStorage.getItem('kac-drop-acks') === '1');
  const [ttsOn, setTtsOn] = useState(() => { const s = localStorage.getItem('kac-sx-tts'); return s === '1' ? true : s === '0' ? false : !onewayPreset; }); // 음성재생(TTS): 오프라인(대화) 기본 ON, 온라인 OFF
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
      setNotice('미리듣기 실패: ' + (e.message || e)); setTimeout(() => setNotice(''), 6000); // 블로킹 alert 대신 인앱 배너
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
  const [deskGuestMic, setDeskGuestMic] = useState(false); // 데스크: 여객 태블릿 마이크(2채널) 연결 여부
  const [hostLang, setHostLang] = useState('en'); // 데스크: 호스트 수동 시작용 손님 언어
  const deskAutoRef = useRef(false); // 데스크 자동 캡처 시작 1회 가드
  const [wayfindSug, setWayfindSug] = useState(null); // 데스크: 길안내 제안(호스트 승인 대기)
  const sugTimerRef = useRef(null); // 제안 자동 소멸 타이머
  const [mapAuto, setMapAuto] = useState(() => localStorage.getItem('kac-desk-map-auto') === '1'); // 지도 자동 표시(승인 생략)
  const [fontScale, setFontScale] = useState(() => { // 번역 텍스트 크기(고급설정, 기기 저장)
    const v = Number(localStorage.getItem('kac-font-scale'));
    return Number.isFinite(v) && v >= 0.8 && v <= 1.6 ? v : 1;
  });
  const [level, setLevel] = useState(0);
  // 데스크 마이크 2대(PC): 지향성 마이크 2대를 이 PC 에 직결 — 직원/여객 장치 지정, 뷰어는 표출 전용이 됨
  const [guestLevel, setGuestLevel] = useState(0); // 여객 마이크 실측 레벨(연결 확인용)
  const [mic2On, setMic2On] = useState(() => localStorage.getItem('kac-desk-mic2') === '1');
  const [micStaffId, setMicStaffId] = useState(() => localStorage.getItem('kac-desk-mic-staff') || '');
  const [micGuestId, setMicGuestId] = useState(() => localStorage.getItem('kac-desk-mic-guest') || '');
  const [micDevs, setMicDevs] = useState([]); // 사용 가능한 입력 장치 목록(연결 확인)
  // RNNoise(신경망 잡음 억제, β): 켜면 브라우저 기본 NS 대신 사용 — 지향성 마이크 없는 데스크 보조용
  const [rnnoise, setRnnoiseOpt] = useState(() => localStorage.getItem('kac-rnnoise') === '1');
  // 저신뢰 자동 교정(β): 연속 저신뢰 발화만 GPT 가 맥락 보고 원문 교정→재번역해 카드 덮어쓰기
  const [confFix, setConfFix] = useState(() => localStorage.getItem('kac-conf-fix') === '1');
  // 데스크: 길안내 지도 기능 on/off(끄면 감지·GPT 분류·지도 표시 모두 생략)
  const [wayfindOn, setWayfindOn] = useState(() => localStorage.getItem('kac-desk-wayfind') !== '0');
  // 실시간 번역(soniox): 사용할 마이크 장치 선택(기본 = 시스템 기본 마이크)
  const [micId, setMicId] = useState(() => localStorage.getItem('kac-mic-device') || '');
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
  // 연결 상태 인디케이터: ok(정상)/reconn(재연결 중)/off(중지) — 상태 문구가 스쳐 지나가 안 보이던 문제 보완
  const [connState, setConnState] = useState('off');
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const openRename = () => { setRenameVal(sessTitle || ''); setRenameOpen(true); };
  const saveRename = () => { const v = (renameVal || '').trim() || '제목 없음'; setSessTitle(v); setRenameOpen(false); api.patch(initial.id, { title: v }).catch(() => {}); };
  // 세션 헤더 '…' 메뉴: 이름 수정 / 대화 내역 삭제 / 세션 삭제
  const [hdrMenu, setHdrMenu] = useState(null); // anchorEl
  const [confirmReq, setConfirmReq] = useState(null);
  const [snack, setSnack] = useState(null); // { ok, msg }
  const clearHistory = () => {
    setHdrMenu(null);
    setConfirmReq({
      title: '대화 내역 삭제',
      message: '이 세션의 지금까지 번역·대화 내역을 모두 삭제합니다. 세션은 그대로 유지됩니다. 되돌릴 수 없습니다.',
      confirmLabel: '내역 삭제',
      onOk: async () => {
        try { await api.clearItems(initial.id); setMessages([]); setSnack({ ok: true, msg: '대화 내역을 삭제했습니다.' }); }
        catch (e) { setSnack({ ok: false, msg: '삭제 실패: ' + (e.message || '네트워크 오류') }); }
      },
    });
  };
  const deleteSession = () => {
    setHdrMenu(null);
    setConfirmReq({
      title: '세션 삭제',
      message: `'${sessTitle || '제목 없음'}' 세션을 삭제합니다. 목록에서 사라지며, 대화 기록은 관리자 로그에 보존됩니다.`,
      confirmLabel: '세션 삭제',
      onOk: async () => {
        try { await api.remove(initial.id); onBack(); }
        catch (e) { setSnack({ ok: false, msg: '삭제 실패: ' + (e.message || '네트워크 오류') }); }
      },
    });
  };
  const [speakers, setSpeakers] = useState(initial.speakers || {}); // 화자번호 -> 지정이름(다운로드 표기용)
  const [notice, setNotice] = useState('');
  const [connecting, setConnecting] = useState(false);
  const recRef = useRef(null);
  const scrollRef = useRef(null);
  const onMessageRef = useRef(null); // 패시브 뷰어 연결이 최신 onMessage 를 호출하도록
  const stopReqRef = useRef(false); // 연결 중(시작 await)에 중지를 누른 경우 처리

  const startingRef = useRef(false); // 시작 버튼 연타로 중복 세션 생성 방지
  const startRef = useRef(null); // 최신 start() 참조(재시작 클로저의 stale state 방지)
  // 번역 GPT 모델(테스트용). 기본 gpt-5-nano.
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
          lang: it.lang || null, // 발화 원문 언어 — 데스크 화자 색 구분(안내원 ko/손님)의 근거
          toks: it.toks || null, // 원문 토큰(신뢰도) — 저신뢰 단어 하이라이트
        }))
      );
      setSpeakers(s.speakers || {});
      setCfg({
        pipeline: s.pipeline || 'soniox',
        inLang: s.inLang || 'auto',
        langs: s.langs && s.langs.length ? s.langs : [s.outLang || 'ko'],
        outLang: s.outLang || 'ko',
      });
      setDispLang(s.outLang || 'ko');
    }).catch(() => {
      // 삭제된 세션을 히스토리 뒤로가기 등으로 연 경우 — unhandled rejection 대신 안내
      setNotice('세션 정보를 불러오지 못했습니다. 삭제되었거나 네트워크 오류일 수 있습니다.');
    });
    api.qr(initial.id).then(setQr).catch(() => {});
    return () => {
      // 언마운트 시: 권한 프롬프트 대기 중(start await 중)인 레코더도 완료되는 즉시 정리되도록 표시.
      // 이게 없으면 뒤로가기 후 권한을 허용한 경우 마이크·연결이 화면 없이 계속 돌아간다.
      stopReqRef.current = true;
      // 예약된 재캡처 타이머도 제거 — start() 가 stopReq 를 되리셋하므로 표시만으론 막지 못한다
      clearTimeout(restartDebRef.current);
      clearTimeout(restartTimerRef.current);
      recRef.current?.stop();
      recRef.current = null;
    };
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
    let ws = null, closed = false, retry = null;
    const conn = () => {
      if (closed) return; // 재시도 타이머가 언마운트 후 발화해 고아 소켓을 만드는 것 방지
      ws = new WebSocket(`${proto}://${location.host}/ws/viewer?session=${initial.id}&role=host`); // role=host: 현황판 뷰어 수에서 제외
      ws.onmessage = (ev) => { try { onMessageRef.current && onMessageRef.current(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { if (!closed) retry = setTimeout(conn, 1200 + Math.random() * 1200); }; // 지터 — 동시 재연결 폭주 방지
    };
    conn();
    return () => { closed = true; clearTimeout(retry); try { ws && ws.close(); } catch {} };
    // eslint-disable-next-line
  }, [cfg.pipeline, initial.id]);

  // 데스크: 별도 대기 버튼 없이 마운트 시 자동으로 마이크 캡처 시작(권한 1회 허용 필요, STT는 통역 시작 시)
  useEffect(() => {
    if (cfg.pipeline !== 'desk' || deskAutoRef.current) return;
    deskAutoRef.current = true;
    const t = setTimeout(() => { start(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line
  }, [cfg.pipeline]);

  // 입력 장치 목록 유지(데스크 2대 모드 연결 확인 + 실시간 번역 마이크 선택) — 꽂거나 뽑으면 즉시 갱신.
  // 라벨은 마이크 권한 이후에만 노출되는데 데스크는 진입 시 자동 캡처로 권한을 이미 얻는다.
  useEffect(() => {
    if (!((cfg.pipeline === 'desk' && mic2On) || cfg.pipeline === 'soniox')) return;
    let dead = false;
    const refresh = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!dead) setMicDevs(list.filter((d) => d.kind === 'audioinput'));
      } catch {}
    };
    refresh();
    try { navigator.mediaDevices.addEventListener('devicechange', refresh); } catch {}
    return () => { dead = true; try { navigator.mediaDevices.removeEventListener('devicechange', refresh); } catch {} };
  }, [cfg.pipeline, mic2On]);

  // 녹음 중 실수로 페이지를 닫거나 새로고침하면 번역이 중단됨 — 이탈 전 확인
  useEffect(() => {
    if (!recording) return;
    const h = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [recording]);

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
    api.patch(initial.id, next).catch(() => {});
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
    // 연결 상태 점(헤더): 서버 상태 문구에서 파생 — 재연결 중엔 노란 점으로 즉시 보이게
    if (m.type === 'status' && typeof m.message === 'string') {
      if (m.message.includes('재연결 중')) setConnState('reconn');
      else if (m.message.includes('엔진 연결됨') || m.message.includes('대기 중')) setConnState('ok');
      else if (m.message.includes('연결 종료')) setConnState('off');
    }
    if (m.type === 'idle-stop') {
      stop();
      setNotice('1분간 입력이 없어 자동으로 중지했습니다. 다시 시작하려면 시작 버튼을 누르세요.');
      setTimeout(() => setNotice(''), 6000);
      return;
    }
    if (m.type === 'takeover') { // 같은 세션을 다른 기기/탭에서 시작 → 이 연결은 종료됨
      stop();
      setNotice('다른 기기 또는 탭에서 이 세션의 번역을 시작해 이 연결을 종료했습니다.');
      setTimeout(() => setNotice(''), 8000);
      return;
    }
    if (m.type === 'desk-reset') { // 데스크: 대화 종료 → 화면 초기화(다음 손님), 대기 상태로
      setMessages([]);
      setPartials({ left: '', right: '' });
      setViewerActive(false);
      setDeskGuestLang(null);
      setWayfindSug(null);
      return;
    }
    if (m.type === 'desk-active') { // 통역 시작됨(손님 언어 선택 또는 호스트 수동 시작)
      if (cfg.pipeline === 'desk') { setViewerActive(true); if (m.lang) setDeskGuestLang(m.lang); }
      return;
    }
    if (m.type === 'desk-guest-mic') { // 여객 태블릿 마이크 채널 연결 여부(2채널 화자 구분)
      if (cfg.pipeline === 'desk') setDeskGuestMic(!!m.on);
      return;
    }
    if (m.type === 'wayfind-suggest') { // 길안내 감지 → 호스트 승인 대기(자동 표시 설정 시 즉시 승인)
      if (cfg.pipeline !== 'desk') return;
      if (localStorage.getItem('kac-desk-map-auto') === '1') { if (recRef.current && recRef.current.wayfindShow) recRef.current.wayfindShow(); return; }
      setWayfindSug(m);
      clearTimeout(sugTimerRef.current);
      sugTimerRef.current = setTimeout(() => setWayfindSug(null), 20000); // 20초 방치 시 제안 소멸(맥락 지난 지도 방지)
      return;
    }
    if (m.type === 'partial' || m.type === 'sentence') setConnecting(false); // 첫 결과 도착 → 연결중 해제
    if (m.type === 'partial') {
      setPartials((p) => ({ ...p, [m.side || 'right']: m.text || '' }));
    } else if (m.type === 'sentence') {
      const side = m.side || 'right';
      // 에코 드랍/고스트 정리: 서버가 내용 없는 페이로드를 보내면 해당 카드를 화면에서 제거
      const emptyPayload = !m.source && (!m.texts || !Object.values(m.texts).some(Boolean));
      if (emptyPayload) { setMessages((arr) => arr.filter((x) => x.id !== m.id)); return; }
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
            lang: m.lang ?? copy[i].lang, // 화자 색 구분용 — 유실되면 단일 채널 데스크에서 색이 전부 호스트색이 됨
            toks: m.toks ?? copy[i].toks, // 원문 토큰(신뢰도) — 저신뢰 단어 하이라이트용
          };
          return copy;
        }
        const next = [...arr, { id: m.id, side, texts: m.texts || {}, source: m.source, speaker: m.speaker || null, lang: m.lang || null, toks: m.toks || null }];
        return next.length > 800 ? next.slice(-800) : next; // 장시간 세션 렌더 보호(전문은 서버 세션에 보존)
      });
    }
  };
  onMessageRef.current = onMessage; // 패시브 뷰어 연결이 항상 최신 핸들러를 쓰도록

  const start = async () => {
    if (recording || recRef.current || startingRef.current) return; // 연타 중복 방지
    if (preset && !PRESET_LABEL[preset]) { // 지원 종료 모드(구 multi 등)는 열람 전용 — 실수로 다른 모드로 녹음되는 것 방지
      setNotice('지원이 종료된 모드의 세션입니다 — 열람만 가능합니다. 새 세션을 만들어 주세요.');
      return;
    }
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
        micSens, // 마이크 음성인식 민감도(0~100): 일정 볼륨 이상만 전송하는 클라이언트 볼륨 게이트
        deskGuestSens: cfg.pipeline === 'desk' ? guestSens : undefined, // 여객 태블릿 마이크 민감도(서버 경유 뷰어 근접 게이트)
        sxSens,
        sxMaxDelay,
        sxLatency,
        sxMode,
        sxTarget,
        sxA,
        sxB,
        dropAcks, // 고급옵션: 단독 응답어(네/Yes) 기록 생략
        confFix, // 고급옵션: 저신뢰 자동 교정(GPT) — 연속 저신뢰 발화만 맥락 교정
        // 데스크 마이크 2대(PC): 여객 장치가 지정된 경우에만 — 여객 오디오는 src=guestmic 별도 연결로 공급
        mic2: cfg.pipeline === 'desk' && mic2On && micGuestId && !window.AndroidAudio ? { staff: micStaffId || null, guest: micGuestId } : undefined,
        rnnoise, // 잡음 제거 강화(β): 브라우저 NS 대신 RNNoise(신경망) — 마이크 캡처에만 적용
        micId: cfg.pipeline === 'soniox' && micId ? micId : undefined, // 실시간 번역: 마이크 장치 선택
        wayfind: cfg.pipeline === 'desk' ? wayfindOn : undefined, // 데스크: 길안내 지도 기능 on/off
        onMessage,
        onEnded: () => { // 장치 뽑힘·화면공유 중지 — 레코더는 스스로 멈추므로 UI 를 함께 정리('진행 중' 고착 방지)
          recRef.current = null;
          setRecording(false);
          setConnecting(false);
          setConnState('off');
          setLevel(0); setGuestLevel(0);
          setNotice('마이크 입력이 중단되었습니다(장치 분리 또는 화면 공유 중지). 다시 시작해 주세요.');
        },
        onMeter: (rms, peak, src) => {
          const db = 20 * Math.log10(rms + 1e-8);
          const v = Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
          // 값이 실질적으로 변할 때만 상태 갱신 — 매 오디오 프레임(~85ms)마다 전체 메시지 목록이 리렌더되던 문제 완화
          if (src === 'guestmic') setGuestLevel((prev) => (Math.abs(prev - v) < 3 ? prev : Math.round(v)));
          else setLevel((prev) => (Math.abs(prev - v) < 3 ? prev : Math.round(v)));
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
      setConnState('ok');
      setMicMuted(false); // 시작 시 발화 on
      setConnecting(cfg.pipeline !== 'desk'); // 엔진 연결~첫 결과까지 표시 (데스크는 대기 모드라 제외)
    } catch (e) {
      // 블로킹 alert 대신 인앱 안내 배너로 통일
      if (cfg.pipeline === 'desk') { setNotice('마이크를 사용할 수 없습니다. 권한을 허용한 뒤 통역 시작을 눌러 주세요. (' + (e.message || e) + ')'); }
      else { setNotice(String(e.message || e)); setTimeout(() => setNotice(''), 8000); }
    } finally {
      startingRef.current = false;
    }
  };
  startRef.current = start; // 항상 최신 렌더의 start — restartCapture 가 이걸 부른다
  // 캡처 설정 변경 후 재시작(데스크 상시 캡처용) — recorder 의 stop 만 직접 호출
  // (컴포넌트 stop() 은 stopReq 를 세워 재시작을 막으므로 사용하지 않음).
  // ⚠ start 는 반드시 startRef(최신 렌더의 함수)로 불러야 한다 — setTimeout 클로저가 옛 start 를 잡으면
  //   그 안의 stale recording=true 가드에 걸려 재시작이 조용히 무시된다(RNNoise 토글 시 캡처가
  //   멈춘 채 복구되지 않던 버그의 원인).
  const restartTimerRef = useRef(null); // 재캡처 600ms 타이머 — stop()/언마운트에서 반드시 취소
  const restartCapture = () => {
    if (!recRef.current) return;
    try { recRef.current.stop(); } catch {}
    recRef.current = null;
    setRecording(false);
    setLevel(0); setGuestLevel(0);
    clearTimeout(restartTimerRef.current);
    restartTimerRef.current = setTimeout(() => {
      // 타이머 발화 전에 사용자가 중지/이탈했으면 재시작하지 않는다 — 화면 없는 핫 마이크 방지
      if (stopReqRef.current) return;
      try { startRef.current && startRef.current(); } catch {}
    }, 600); // 리렌더 후 최신 구성으로 재캡처
  };
  // 발화 끊김(soniox 엔드포인트) 설정은 연결 시 고정 — 데스크에서 슬라이더로 바꾸면 짧게 모아 재캡처
  const restartDebRef = useRef(null);
  const scheduleRestart = () => {
    clearTimeout(restartDebRef.current);
    restartDebRef.current = setTimeout(() => restartCapture(), 900);
  };
  // 데스크 마이크 2대: 설정 변경(토글·장치 교체)을 저장하고, 캡처 중이면 새 구성으로 재시작.
  const applyMic2 = (p) => {
    if ('on' in p) { setMic2On(p.on); localStorage.setItem('kac-desk-mic2', p.on ? '1' : '0'); }
    if ('staff' in p) { setMicStaffId(p.staff); localStorage.setItem('kac-desk-mic-staff', p.staff); }
    if ('guest' in p) { setMicGuestId(p.guest); localStorage.setItem('kac-desk-mic-guest', p.guest); }
    restartCapture();
  };
  const stop = () => {
    setConnState('off');
    stopReqRef.current = true; // 연결 중이면 시작 완료 시점에 정리되도록 표시
    clearTimeout(restartDebRef.current); // 예약된 재캡처(슬라이더 디바운스·600ms 재시작)도 취소 —
    clearTimeout(restartTimerRef.current); // 중지 직후 타이머가 살아나 캡처를 되살리는 레이스 방지
    recRef.current?.stop();
    recRef.current = null;
    setRecording(false);
    setMicMuted(false);
    setConnecting(false);
    setLevel(0);
    setPartials({ left: '', right: '' });
  };
  // 데스크: 호스트 수동 통역 시작 — 캡처가 아직 없으면(권한 대기·거부 등) 먼저 시작.
  // 자동 시작이 진행 중이면 끝날 때까지 대기(이전엔 이 경우 버튼이 소리 없이 무시됐음)
  const deskManualStart = async () => {
    for (let i = 0; i < 100 && startingRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    if (!recRef.current) await start();
    if (recRef.current && recRef.current.deskStart) recRef.current.deskStart(hostLang);
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
  const pipeLabel = preset ? (PRESET_LABEL[preset] || '지원 종료 모드') : (PIPES.find((p) => p.v === cfg.pipeline)?.label || '지원 종료 모드'); // 구 multi 등
  // 모드 변경(번역 이력 없을 때만): 프리셋 + 모드별 기본값(소스·방향·TTS)을 함께 리셋
  const presetGroup = preset ? (preset === 'live' ? 'live' : onewayPreset ? 'oneway' : 'twoway') : null;
  const changeMode = (v) => {
    setPreset(v);
    api.patch(initial.id, { preset: v }).catch(() => {});
    setSourceMode(v === 'oneway' ? 'system' : 'mic');
    setSxMode(v === 'twoway' ? 'two' : 'one');
    if (v !== 'twoway') setSxTarget('ko');
    setTtsOn(v === 'twoway');
    localStorage.setItem('kac-sx-tts', v === 'twoway' ? '1' : '0'); // 저장값과 동기화(리로드 시 되돌아가던 문제)
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* 타이틀 바 — 모바일은 여백·간격 축소 */}
      <Box sx={{ px: { xs: 1.25, sm: 3 }, pt: { xs: 1.25, sm: 2 }, pb: { xs: 1, sm: 1.5 }, display: 'flex', alignItems: 'center', gap: { xs: 0.75, sm: 1.5 } }}>
        <IconButton onClick={onBack} sx={{ width: 38, height: 38, borderRadius: '10px', border: 1, borderColor: 'divider', color: 'text.secondary' }}>
          <Box component="svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" sx={{ width: 20, height: 20 }}><path d="M15 6l-6 6 6 6" /></Box>
        </IconButton>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          {/* overflow hidden — 좁은 폭에서 모드 칩이 우측 버튼들 밑으로 겹쳐 보이던 문제 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, overflow: 'hidden' }}>
            <Tooltip title={connState === 'ok' ? '엔진 연결 정상' : connState === 'reconn' ? '재연결 중 — 잠시 인식이 멈출 수 있습니다' : '중지됨(연결 없음)'}>
              <Box sx={{ width: 9, height: 9, borderRadius: '50%', flex: 'none', bgcolor: connState === 'ok' ? 'success.main' : connState === 'reconn' ? 'warning.main' : 'text.disabled', boxShadow: connState === 'reconn' ? '0 0 0 3px rgba(232,145,45,0.25)' : 'none' }} />
            </Tooltip>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: 16, sm: 18 }, lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
              {sessTitle}
            </Typography>
            {cfg.pipeline !== 'desk' && (
              <Tooltip title="세션 관리">
                <IconButton onClick={(e) => setHdrMenu(e.currentTarget)} sx={{ width: 30, height: 30, flex: 'none', borderRadius: '9px', border: 1, borderColor: 'divider', color: 'text.secondary' }}>
                  <MoreVertIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            )}
            {cfg.pipeline !== 'desk' && (
              <Chip size="small" label={pipeLabel} sx={{ height: 22, fontSize: 11.5, fontWeight: 700, flex: 'none', display: { xs: 'none', md: 'inline-flex' }, bgcolor: (t) => alpha(t.palette.primary.main, 0.1), color: 'primary.main' }} />
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
        <Tooltip title="지금까지의 번역 전문을 텍스트 파일로 저장합니다">
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
          <Tooltip title="전체화면 전환">
            <IconButton
              onClick={() => {
                const cur = document.fullscreenElement || document.webkitFullscreenElement;
                if (cur) { try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} }
                else { const el = document.documentElement; const fn = el.requestFullscreen || el.webkitRequestFullscreen; if (fn) try { fn.call(el); } catch {} }
              }}
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

      {/* 컨트롤 바 (옵션) — 숨기면 박스 전체가 접혀 번역 영역이 그만큼 올라옴. 토글 버튼은 공간을 차지하지 않는 플로팅 */}
      <Box sx={{ px: { xs: 1.5, sm: 3 }, pb: optsOpen ? 1.5 : 0, position: 'relative' }}>
        <Collapse in={optsOpen}>
        <Paper variant="outlined" sx={{ borderRadius: 1.5, bgcolor: (t) => alpha(t.palette.text.primary, 0.015), overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.25, sm: 2 }, flexWrap: 'wrap', px: { xs: 1, sm: 1.5 }, py: 1, pr: { xs: 5, sm: 7 } }}>
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
              {/* 데스크는 진입 즉시 상시 캡처(recording=true)라 disabled 로 두면 영영 못 바꿈 → 라이브 변경 지원 */}
              <Select
                size="small"
                value={deskIdle}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDeskIdle(v);
                  localStorage.setItem('kac-desk-idle', String(v));
                  try { recRef.current && recRef.current.setDeskIdle && recRef.current.setDeskIdle(v * 1000); } catch {}
                }}
                sx={{ ...selSx, minWidth: 120 }}
              >
                {DESK_IDLE.map((o) => (<MenuItem key={o.v} value={o.v}>{o.label}</MenuItem>))}
              </Select>
            </Field>
          )}
          {/* 데스크 마이크 2대(PC): 지향성 마이크 2대 직결 — 직원/여객 장치 지정 + 실측 레벨로 연결 확인.
              켜면 여객 오디오는 이 PC 가 공급하고 손님 태블릿은 표출 전용이 된다. (안드로이드 앱에선 숨김 — 단일 네이티브 마이크) */}
          {cfg.pipeline === 'desk' && !window.AndroidAudio && (
            <>
              <Field label="마이크 2대 (PC)">
                <Box sx={{ display: 'flex', alignItems: 'center', height: 37 }}>
                  <Tooltip title="지향성 마이크 2대를 이 PC에 연결해 직원·여객 채널을 직접 캡처합니다. 켜면 손님 태블릿은 화면 표출 전용이 됩니다.">
                    <Switch checked={mic2On} onChange={(e) => applyMic2({ on: e.target.checked })} />
                  </Tooltip>
                </Box>
              </Field>
              {mic2On && (
                <>
                  <Field label="직원(안내원) 마이크">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 37 }}>
                      <Select
                        size="small" displayEmpty
                        value={micDevs.some((d) => d.deviceId === micStaffId) ? micStaffId : ''}
                        onChange={(e) => applyMic2({ staff: e.target.value })}
                        sx={{ ...selSx, minWidth: 140, maxWidth: 200 }}
                      >
                        <MenuItem value="">기본 마이크</MenuItem>
                        {micDevs.map((d, i) => (<MenuItem key={d.deviceId || i} value={d.deviceId}>{d.label || `마이크 ${i + 1}`}</MenuItem>))}
                      </Select>
                      <Tooltip title="이 마이크에 말하면 게이지가 움직여야 합니다(연결 확인)">
                        <LinearProgress variant="determinate" value={level} color="success" sx={{ width: 54, height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }} />
                      </Tooltip>
                      {!micStaffId && (
                        <Tooltip title="장치를 지정하지 않으면 PC 내장(기본) 마이크가 직원 채널로 들어갑니다. 외장 지향성 마이크를 선택하세요.">
                          <Chip size="small" color="warning" variant="outlined" label="내장 마이크 사용 중" sx={{ height: 22, fontSize: 11 }} />
                        </Tooltip>
                      )}
                    </Box>
                  </Field>
                  <Field label="여객(손님) 마이크">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 37 }}>
                      <Select
                        size="small" displayEmpty
                        value={micDevs.some((d) => d.deviceId === micGuestId) ? micGuestId : ''}
                        onChange={(e) => applyMic2({ guest: e.target.value })}
                        sx={{ ...selSx, minWidth: 140, maxWidth: 200 }}
                      >
                        <MenuItem value="" disabled>장치를 선택하세요</MenuItem>
                        {micDevs.map((d, i) => (<MenuItem key={d.deviceId || i} value={d.deviceId}>{d.label || `마이크 ${i + 1}`}</MenuItem>))}
                      </Select>
                      <Tooltip title="이 마이크에 말하면 게이지가 움직여야 합니다(연결 확인)">
                        <LinearProgress variant="determinate" value={guestLevel} color="success" sx={{ width: 54, height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }} />
                      </Tooltip>
                      {!micGuestId && <Chip size="small" color="warning" variant="outlined" label="선택 필요" sx={{ height: 22, fontSize: 11 }} />}
                      {micGuestId && !micDevs.some((d) => d.deviceId === micGuestId) && <Chip size="small" color="warning" label="미연결" sx={{ height: 22, fontSize: 11 }} />}
                      {micGuestId && micGuestId === micStaffId && <Chip size="small" color="warning" label="직원과 같은 장치" sx={{ height: 22, fontSize: 11 }} />}
                    </Box>
                  </Field>
                </>
              )}
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
          {cfg.pipeline === 'soniox' && preset && messages.length === 0 && (
            <Field label="모드">
              <Select size="small" value={presetGroup} disabled={recording} onChange={(e) => changeMode(e.target.value)} sx={{ ...selSx, minWidth: 125 }}>
                <MenuItem value="live">라이브 청취</MenuItem>
                <MenuItem value="oneway">온라인 회의</MenuItem>
                <MenuItem value="twoway">양방향 번역</MenuItem>
              </Select>
            </Field>
          )}
          {cfg.pipeline === 'soniox' && onewayPreset && (
            <>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, color: 'text.secondary', letterSpacing: '0.02em' }}>입력 언어</Typography>
                  <Tooltip title="말하는 언어를 지정하면 더 정확하게 인식합니다. 자동 감지를 고르면 여러 언어를 자동으로 알아듣습니다." arrow>
                    <InfoOutlinedIcon sx={{ fontSize: 13, color: 'text.disabled', cursor: 'help' }} />
                  </Tooltip>
                </Box>
                <Select size="small" value={cfg.inLang} disabled={recording} onChange={(e) => patch({ inLang: e.target.value })} sx={{ ...selSx, minWidth: 130 }}>
                  <MenuItem value="auto">자동 감지</MenuItem>
                  {LANGS.filter((l) => l.code !== 'auto').map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Box>
              <Field label="출력 언어">
                <Select size="small" value={sxTarget} disabled={recording} onChange={(e) => { setSxTarget(e.target.value); localStorage.setItem('kac-sx-target', e.target.value); }} sx={{ ...selSx, minWidth: 120 }} MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}>
                  {SX_LANGS.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              {['oneway', 'online'].includes(preset) && (
                <InfoToggle
                  label="내 음성 인식"
                  hint="시스템 소리에 더해 내 마이크로 말한 내용도 함께 인식해 번역합니다."
                  checked={sourceMode === 'both'}
                  disabled={recording}
                  onChange={(e) => setSourceMode(e.target.checked ? 'both' : 'system')}
                />
              )}
              <InfoToggle
                label="TTS"
                hint="번역된 문장을 음성으로 읽어줍니다. 스피커로 크게 틀면 그 소리가 다시 인식될 수 있으니 이어폰 사용을 권장합니다. 번역 중에도 켜고 끌 수 있습니다."
                checked={ttsOn}
                onChange={(e) => { const v = e.target.checked; setTtsOn(v); localStorage.setItem('kac-sx-tts', v ? '1' : '0'); if (recRef.current && recRef.current.setTts) recRef.current.setTts(v, gender); }}
              />
              {ttsOn && (
                <Field label="음성">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Select size="small" value={gender} disabled={recording} onChange={(e) => { setGender(e.target.value); localStorage.setItem('kac-sx-gender', e.target.value); }} sx={{ ...selSx, minWidth: 90 }}>
                      <MenuItem value="f">여성</MenuItem>
                      <MenuItem value="m">남성</MenuItem>
                    </Select>
                    <Tooltip title="선택한 음성을 미리 들어봅니다">
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
          {cfg.pipeline === 'soniox' && !onewayPreset && (
            <>
              <Field label="언어 1">
                <Select size="small" value={sxA} disabled={recording} onChange={(e) => { setSxA(e.target.value); localStorage.setItem('kac-sx-a', e.target.value); }} sx={{ ...selSx, minWidth: 110 }} MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}>
                  {SX_LANGS.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              <Field label="언어 2">
                <Select size="small" value={sxB} disabled={recording} onChange={(e) => { setSxB(e.target.value); localStorage.setItem('kac-sx-b', e.target.value); }} sx={{ ...selSx, minWidth: 110 }} MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}>
                  {SX_LANGS.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
              </Field>
              <InfoToggle
                label="TTS"
                hint="번역된 문장을 음성으로 읽어줍니다. 나와 상대 기기에서 함께 켜면 소리가 겹칠 수 있으니 이어폰 사용을 권장합니다. 번역 중에도 켜고 끌 수 있습니다."
                checked={ttsOn}
                onChange={(e) => { const v = e.target.checked; setTtsOn(v); localStorage.setItem('kac-sx-tts', v ? '1' : '0'); if (recRef.current && recRef.current.setTts) recRef.current.setTts(v, gender); }}
              />
              {ttsOn && (
                <Field label="음성">
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Select size="small" value={gender} disabled={recording} onChange={(e) => { setGender(e.target.value); localStorage.setItem('kac-sx-gender', e.target.value); }} sx={{ ...selSx, minWidth: 90 }}>
                      <MenuItem value="f">여성</MenuItem>
                      <MenuItem value="m">남성</MenuItem>
                    </Select>
                    <Tooltip title="선택한 음성을 미리 들어봅니다">
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
                    api.patch(initial.id, { outLang: v }).catch(() => {}); // translate 타깃 변경
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


          {/* 실시간 번역: 사용할 마이크 장치 선택(녹음 중엔 변경 불가 — 다음 시작부터 적용) */}
          {cfg.pipeline === 'soniox' && !window.AndroidAudio && (
            <Field label="마이크">
              <Tooltip title={recording ? '녹음 중에는 변경할 수 없습니다(중지 후 변경)' : '사용할 마이크 장치를 선택합니다'}>
                <span>
                  <Select
                    size="small" displayEmpty disabled={recording}
                    value={micDevs.some((d) => d.deviceId === micId) ? micId : ''}
                    onChange={(e) => { setMicId(e.target.value); localStorage.setItem('kac-mic-device', e.target.value); }}
                    sx={{ ...selSx, minWidth: 140, maxWidth: 200 }}
                  >
                    <MenuItem value="">기본 마이크</MenuItem>
                    {micDevs.map((d, i) => (<MenuItem key={d.deviceId || i} value={d.deviceId}>{d.label || `마이크 ${i + 1}`}</MenuItem>))}
                  </Select>
                </span>
              </Tooltip>
            </Field>
          )}
          <Box sx={{ flex: 1 }} />
          <Field label="마이크 입력">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 37 }}>
              <MicNoneIcon fontSize="small" sx={{ color: level > 2 ? 'success.main' : 'text.disabled' }} />
              <LinearProgress variant="determinate" value={level} color="success" sx={{ width: 90, height: 8, borderRadius: 5, bgcolor: (t) => alpha(t.palette.text.primary, 0.08) }} />
            </Box>
          </Field>
          </Box>
        </Paper>
        </Collapse>
        {/* 펼치기/숨기기 토글 — 콘텐츠 중앙, 헤더에 밀착한 탭 모양. 공간을 차지하지 않고, 숨김 상태에선 반투명 */}
        <Tooltip title={optsOpen ? '옵션 숨기기' : '옵션 펼치기'}>
          <IconButton
            size="small"
            onClick={() => setOptsOpen((o) => !o)}
            sx={{
              position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', zIndex: 3,
              width: 44, height: 22, borderRadius: '0 0 12px 12px',
              border: 1, borderTop: 0, borderColor: 'divider', bgcolor: 'background.paper',
              opacity: optsOpen ? 1 : 0.4, transition: 'opacity .15s',
              '&:hover': { opacity: 1, bgcolor: 'background.paper' },
            }}
          >
            {optsOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
          </IconButton>
        </Tooltip>
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
          <Box sx={{ maxWidth: 880, mx: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
              // 데스크: 호스트 화면에서도 발화 주체 색 구분 — 게스트(손님) 발화는 액센트('a'), 호스트(안내원, ko)는 무채색('b').
              // lang = 발화 원문 언어(커밋 시 저장), 2채널 게스트는 side='left'.
              const deskDir = cfg.pipeline === 'desk' ? (((m.lang && m.lang !== 'ko') || m.side === 'left') ? 'a' : 'b') : null;
              // 데스크: 안내원(한국어) 발화는 texts 에 ko 가 없음 → 원문을 본문으로('번역 중…' 표시 없이)
              if (cfg.pipeline === 'desk' && !t) {
                if (!m.source) return null;
                return <Row key={m.id} side={m.side} text={m.source} source={null} dir={deskDir} scale={fontScale} />;
              }
              // 양방향: 저장된 타깃 언어 키로 발화 방향 판별(언어1 발화→texts[언어2], 언어2 발화→texts[언어1])
              let dir = deskDir;
              if (twoway && m.texts) {
                const tk = Object.keys(m.texts)[0];
                if (tk) dir = tk === sxA ? 'b' : 'a'; // 타깃이 언어1 → 언어2가 말함(b), 타깃이 언어2 → 언어1이 말함(a)
              }
              return <Row key={m.id} side={m.side} text={t} source={m.source} dir={dir} scale={fontScale} />;
            })}
            {showPartial && partials.left && <PartialLine side="left" text={partials.left} scale={fontScale} />}
            {showPartial && partials.right && <PartialLine side="right" text={partials.right} scale={fontScale} />}
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
            // 모바일: 화면 고정(스크롤해도 위치 유지) + 홈바 세이프에어리어 / 데스크톱: 채팅영역 하단
            position: { xs: 'fixed', sm: 'absolute' }, left: 0, right: 0, bottom: 0, height: { xs: 118, sm: 130 }, zIndex: 1100,
            paddingBottom: 'env(safe-area-inset-bottom)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 1, sm: 1.5 }, flexWrap: 'wrap', pointerEvents: 'none',
            background: (t) => `linear-gradient(to top, ${t.palette.background.default}, transparent)`,
          }}
        >
          {/* 길안내 제안(호스트 승인) — 오탐 지도가 손님 화면에 바로 뜨지 않도록 확인 단계 */}
          {cfg.pipeline === 'desk' && wayfindOn && wayfindSug && (
            <Paper sx={{ position: 'absolute', bottom: 106, left: '50%', transform: 'translateX(-50%)', pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 1, px: 1.75, py: 0.9, borderRadius: 3, border: 1, borderColor: 'divider', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
              <Typography sx={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap' }}>
                지도 표시: {wayfindSug.ko} · {String(wayfindSug.floor || '').replace('F', '')}층
              </Typography>
              <Button size="small" variant="contained" disableElevation
                onClick={() => { if (recRef.current && recRef.current.wayfindShow) recRef.current.wayfindShow(); setWayfindSug(null); }}>표시</Button>
              <Button size="small" variant="text" sx={{ color: 'text.secondary' }}
                onClick={() => { if (recRef.current && recRef.current.wayfindDismiss) recRef.current.wayfindDismiss(); setWayfindSug(null); }}>무시</Button>
            </Paper>
          )}
          {cfg.pipeline === 'desk' ? (
            viewerActive ? (
              <>
                <Chip
                  label={`● 손님 응대 중${deskGuestLang ? ` (${DESK_LANGS.find((l) => l.code === deskGuestLang)?.label || deskGuestLang})` : ''}${deskGuestMic ? ' · 2채널' : ''}`}
                  color="error"
                  variant="filled"
                  sx={{ pointerEvents: 'auto', fontWeight: 800, fontSize: 14, py: 2, px: 1, boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}
                />
                <Button onClick={() => recRef.current && recRef.current.deskReset && recRef.current.deskReset()} variant="outlined"
                  sx={{ pointerEvents: 'auto', px: 2.5, py: 1.25, borderRadius: 2.5, fontSize: 14, fontWeight: 700, bgcolor: 'background.paper', boxShadow: '0 8px 24px rgba(0,0,0,0.18)' }}>
                  대기모드로
                </Button>
              </>
            ) : (
              <>
                <Select size="small" value={hostLang} onChange={(e) => setHostLang(e.target.value)}
                  sx={{ pointerEvents: 'auto', bgcolor: 'background.paper', borderRadius: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', '& .MuiSelect-select': { py: 1 } }}>
                  {DESK_LANGS.map((l) => (<MenuItem key={l.code} value={l.code}>{l.label}</MenuItem>))}
                </Select>
                <Button onClick={deskManualStart} variant="contained" disableElevation
                  sx={{ pointerEvents: 'auto', px: 3, py: 1.25, borderRadius: 2.5, fontSize: 15, fontWeight: 700, boxShadow: '0 8px 24px rgba(0,0,0,0.28)' }}>
                  통역 시작
                </Button>
              </>
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
          <SxSlider label="텍스트 크기" hint="번역 텍스트 표시 크기 (80~160%)" value={fontScale} min={0.8} max={1.6} step={0.1} disabled={false}
            fmt={(v) => Math.round(v * 100) + '%'}
            onChange={(v) => { setFontScale(v); localStorage.setItem('kac-font-scale', String(v)); }} />
          <SettingsCap first>마이크</SettingsCap>
          {/* 녹음(캡처) 중에도 실시간 조절 — 데스크는 상시 캡처라 비활성화하면 아예 바꿀 수 없었음 */}
          <SxSlider label={cfg.pipeline === 'desk' ? '호스트 마이크 민감도' : '마이크 음성인식 민감도'} hint="100=모든 소리, 낮출수록 조용한 소리 무시(주변소음·속삭임 차단). 기본 70. 속삭임이 잡히면 더 낮추고, 작게 말하는데 끊기면 높이세요. 번역 중에도 바로 적용됩니다." value={micSens} min={0} max={100} step={1} disabled={false}
            fmt={(v) => String(v)}
            onChange={(v) => { setMicSens(v); localStorage.setItem('kac-mic-sens', String(v)); if (recRef.current && recRef.current.setMicSens) recRef.current.setMicSens(v); }} />
          {cfg.pipeline === 'desk' && (
            /* 게스트 마이크(2채널) 근접 게이트 — 호스트 민감도 바로 아래 배치. 태블릿 마이크는 서버 경유, PC 직결(2대 모드)은 로컬에 즉시 반영 */
            <SxSlider label="게스트 마이크 민감도" hint="100=모든 소리, 낮출수록 게스트 마이크 가까이의 큰 소리에만 반응(호스트 발화 누화·안내방송 무시). 기본 50. 번역 중에도 바로 적용됩니다. 태블릿 마이크·PC 직결 마이크 모두에 적용." value={guestSens} min={0} max={100} step={1} disabled={false}
              fmt={(v) => String(v)}
              onChange={(v) => { setGuestSens(v); localStorage.setItem('kac-desk-guest-sens', String(v)); if (recRef.current && recRef.current.setGuestSens) recRef.current.setGuestSens(v); }} />
          )}
          <SettingsCap>실험 기능 (β)</SettingsCap>
          {!window.AndroidAudio && (
            <InfoToggle
              label="잡음 제거 강화 (RNNoise·β)"
              hint="브라우저 기본 잡음 억제 대신 신경망(RNNoise)으로 배경 소음(에어컨·웅성거림)을 걸러냅니다. 지향성 마이크가 없는 곳에서 배경 소음이 심할 때 켜 보세요. 사람 목소리 누화는 못 거르므로 민감도 게이트는 그대로 필요합니다. 데스크는 즉시 재적용, 일반 세션은 다음 시작부터. 이 기기에 저장됩니다."
              checked={rnnoise}
              disabled={false}
              onChange={(e) => {
                const v = e.target.checked;
                setRnnoiseOpt(v);
                localStorage.setItem('kac-rnnoise', v ? '1' : '0');
                if (cfg.pipeline === 'desk') restartCapture(); // 상시 캡처는 새 구성으로 재시작
              }}
            />
          )}
          {(cfg.pipeline === 'soniox' || cfg.pipeline === 'desk') && (
            <InfoToggle
              label="단독 응답어 생략"
              hint="켜면 '네. / Yes. / Okay.'처럼 응답어 하나뿐인 발화를 기록에 남기지 않습니다(회의록 간소화). 문장에 섞인 응답어는 그대로 두며, 번역 중에도 바로 적용됩니다. 기본 꺼짐(모두 기록)."
              checked={dropAcks}
              disabled={false}
              onChange={(e) => { const v = e.target.checked; setDropAcks(v); localStorage.setItem('kac-drop-acks', v ? '1' : '0'); if (recRef.current && recRef.current.setDropAcks) recRef.current.setDropAcks(v); }}
            />
          )}
          {(cfg.pipeline === 'soniox' || cfg.pipeline === 'desk') && (
            <InfoToggle
              label="저신뢰 자동 교정 (GPT·β)"
              hint="음성인식이 연속으로 흔들린 발화만 GPT가 대화 맥락·용어를 보고 원문을 교정해 다시 번역합니다(카드가 잠시 후 바뀜). 명백한 오인식만 고치고 불확실하면 그대로 둡니다. 교정 시 GPT 호출 비용이 추가되며, 이미 재생된 TTS 음성은 바뀌지 않습니다. 번역 중에도 바로 적용. 기본 꺼짐."
              checked={confFix}
              disabled={false}
              onChange={(e) => { const v = e.target.checked; setConfFix(v); localStorage.setItem('kac-conf-fix', v ? '1' : '0'); if (recRef.current && recRef.current.setConfFix) recRef.current.setConfFix(v); }}
            />
          )}
          {cfg.pipeline === 'desk' && (
            <>
              <InfoToggle
                label="길안내 지도"
                hint="끄면 발화에서 시설·길안내를 감지하지 않고 지도도 표시하지 않습니다(감지용 GPT 호출도 생략). 번역 중에도 바로 적용. 기본 켜짐."
                checked={wayfindOn}
                disabled={false}
                onChange={(e) => { const v = e.target.checked; setWayfindOn(v); localStorage.setItem('kac-desk-wayfind', v ? '1' : '0'); if (recRef.current && recRef.current.setWayfindOn) recRef.current.setWayfindOn(v); }}
              />
              <InfoToggle
                label="지도 자동 표시"
                hint="켜면 길안내 감지 시 확인 없이 바로 손님 화면에 지도를 표시합니다. 끄면 하단 제안에서 '표시'를 눌러야 표시됩니다."
                checked={mapAuto}
                disabled={!wayfindOn}
                onChange={(e) => { setMapAuto(e.target.checked); localStorage.setItem('kac-desk-map-auto', e.target.checked ? '1' : '0'); }}
              />
            </>
          )}
          {(cfg.pipeline === 'soniox' || cfg.pipeline === 'desk') && (
            <>
              <SettingsCap>발화 인식 (끊김 조절)</SettingsCap>
              {/* 데스크는 상시 캡처라 disabled 로 두면 영영 못 바꿈 → 값 변경 후 0.9초 뒤 자동 재캡처로 적용 */}
              <SxSlider label="종료 민감도" hint={'높을수록 더 자주/빨리 끊김' + (cfg.pipeline === 'desk' ? ' (변경 시 잠시 후 자동 재적용)' : '')} value={sxSens} min={-1} max={1} step={0.1} disabled={cfg.pipeline !== 'desk' && recording}
                fmt={(v) => (v > 0 ? '+' : '') + v.toFixed(1)}
                onChange={(v) => { setSxSens(v); localStorage.setItem('kac-sx-sens', String(v)); if (cfg.pipeline === 'desk') scheduleRestart(); }} />
              <SxSlider label="최대 지연" hint={'무음 후 이 시간 안에 강제 종료(ms)' + (cfg.pipeline === 'desk' ? ' (변경 시 잠시 후 자동 재적용)' : '')} value={sxMaxDelay} min={500} max={3000} step={100} disabled={cfg.pipeline !== 'desk' && recording}
                fmt={(v) => v + 'ms'}
                onChange={(v) => { setSxMaxDelay(v); localStorage.setItem('kac-sx-maxdelay', String(v)); if (cfg.pipeline === 'desk') scheduleRestart(); }} />
              <SxSlider label="지연 레벨" hint={'높을수록 저지연(끊김↑, 정확도↓)' + (cfg.pipeline === 'desk' ? ' (변경 시 잠시 후 자동 재적용)' : '')} value={sxLatency} min={0} max={3} step={1} disabled={cfg.pipeline !== 'desk' && recording}
                fmt={(v) => String(v)}
                onChange={(v) => { setSxLatency(v); localStorage.setItem('kac-sx-latency', String(v)); if (cfg.pipeline === 'desk') scheduleRestart(); }} />
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

      {/* 세션 헤더 '…' 메뉴 */}
      <Menu anchorEl={hdrMenu} open={!!hdrMenu} onClose={() => setHdrMenu(null)} transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{ paper: { sx: { '& .MuiMenuItem-root': { fontSize: 13 } } } }}>
        <MenuItem onClick={() => { setHdrMenu(null); openRename(); }}>
          <ListItemIcon><DriveFileRenameOutlineIcon fontSize="small" /></ListItemIcon>
          세션 이름 수정
        </MenuItem>
        <MenuItem onClick={clearHistory} disabled={messages.length === 0}>
          <ListItemIcon><DeleteSweepOutlinedIcon fontSize="small" /></ListItemIcon>
          대화 내역 삭제
        </MenuItem>
        <Divider />
        <MenuItem onClick={deleteSession} sx={{ color: 'error.main' }}>
          <ListItemIcon><DeleteOutlineIcon fontSize="small" sx={{ color: 'error.main' }} /></ListItemIcon>
          세션 삭제
        </MenuItem>
      </Menu>

      <ConfirmDialog req={confirmReq} onClose={() => setConfirmReq(null)} />

      <Snackbar open={!!snack} autoHideDuration={4000} onClose={() => setSnack(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snack ? (
          <MuiAlert elevation={6} variant="filled" severity={snack.ok ? 'success' : 'error'} onClose={() => setSnack(null)}>
            {snack.msg}
          </MuiAlert>
        ) : undefined}
      </Snackbar>
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
function PartialLine({ side, text, scale = 1 }) {
  if (!text) return null;
  return (
    // 진행 중(interim): 액센트 색 + 깜빡이는 커서로 구분
    <Box sx={{ pb: 0.5 }}>
      <Typography
        noWrap
        sx={{ fontSize: { xs: Math.round(21 * scale), sm: Math.round(24 * scale) }, lineHeight: 1.5, fontWeight: 500, color: 'primary.main', overflow: 'hidden' }}
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

// 데스크톱: 모든 발화 좌측 정렬·전체 폭 사용. 마이크=액센트, 시스템=무채색.
// 양방향(dir): 언어1 발화='a'(액센트) · 언어2 발화='b'(무채색) / 데스크: 게스트='a' · 호스트='b'.
// memo: 마이크 미터 등 무관한 상태 변경 때 수백 개 행이 재렌더되지 않도록
// (저신뢰 단어 하이라이트 표시(TokenizedSource)는 사용자 요청으로 삭제 — toks 기록 자체는
//  confFix·품질 평가용으로 서버에 계속 저장된다.)
const Row = React.memo(function Row({ side, text, source, dir, scale = 1 }) {
  const isMic = side === 'right'; // 마이크 입력
  const pending = !text && !!source; // 번역 대기 중 → 원문을 흐리게
  const mainText = pending ? source : text;
  const mainColor = (t) => {
    if (pending) return t.palette.text.secondary;
    const accent = (t.palette.accent && t.palette.accent.main) || t.palette.primary.main;
    if (dir === 'a') return accent; // 게스트/언어1 발화 — 전용 파란 액센트(뉴트럴 primary 는 텍스트색과 같아 구분 불가였음)
    if (dir === 'b') return t.palette.text.primary; // 호스트/언어2 발화(무채색)
    return isMic ? t.palette.text.primary : t.palette.text.secondary;
  };
  return (
    // 카드/박스/구분선 없이 여백만으로 구분. 번역문(큰 글씨) 위 · 원어(작은 회색) 아래. 원어 항상 표시.
    <Box>
      <Typography
        sx={{
          fontSize: { xs: Math.round(21 * scale), sm: Math.round(24 * scale) },
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
        <Typography sx={{ fontSize: Math.round(14.5 * scale), color: 'text.secondary', lineHeight: 1.5, mt: 0.6, wordBreak: 'keep-all', overflowWrap: 'anywhere' }}>
          {source}
        </Typography>
      )}
    </Box>
  );
});
