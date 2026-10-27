/* AirTalk 서버 설정 — 환경변수·상수(구 server.js 상단과 각 절에 흩어져 있던 것을 한곳에 모음).
   이 모듈을 불러오는 순간 OPENAI_API_KEY 점검이 실행된다(없으면 종료 — 구 server.js 와 같은 시점: 앱 생성 전). */
import 'dotenv/config';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

// 저장소 루트(구 server.js 의 __dirname) — dist·data 기본 경로의 기준
export const ROOT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// 엔진 접속 URL — 테스트에서 로컬 fake 엔진으로 오버라이드(실 엔진 호출은 항상 과금되므로)
export const SONIOX_WS_URL = process.env.SONIOX_WS_URL || 'wss://stt-rt.soniox.com/transcribe-websocket';
export const CARTESIA_TTS_WS_BASE = process.env.CARTESIA_TTS_WS_URL || 'wss://api.cartesia.ai/tts/websocket';

export const PORT = Number(process.env.PORT || 3000);
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// 모델은 코드 고정(환경변수로 안 받음). 바꾸려면 여기서 직접 수정.
export const TRANSLATE_MODEL = 'gpt-realtime-translate';
export const REFINE_MODEL = 'gpt-5-nano';
export const TARGET_LANG = process.env.TARGET_LANG || 'ko';
// 세션당 저장 문장(items) 상한 — 장시간 세션이 무한히 커져 메모리·문서를 압박하는 것을 막는다.
// 초과 시 가장 오래된 문장부터 버린다(화면 히스토리만 잘림, 데스크 응대 기록 deskLog·통계는
// 별도 저장이라 영향 없음). 5,000 ≈ 5~8시간 연속 강의 분량(2시간 강의는 보통 1~1.8천).
export const ITEMS_CAP = 5000;
// 실시간 번역 모드(2026-10, 메뉴 3종 → 2종 개편).
// 모드(preset) = 번역 방향, 소스(src) = 소리를 어디서 듣나. 유효한 조합만 존재한다.
//   oneway(실시간 번역): src ∈ mic | system      — 단방향 고정
//   twoway(양방향 통역): src ∈ mic | both        — 양방향 고정('PC 소리만'은 단방향으로 충분해 선택지에 없다)
// 구 프리셋은 같은 상황으로 이전: live→oneway/mic, online→oneway/system, mobile·field·meeting→twoway/mic.
// 서버의 번역 동작은 원래 preset 이 아니라 WS 쿼리(sxMode·src)를 따른다 — 이 값은 클라 UI 상태의 저장용이다.
export const PRESET_SRC = { oneway: ['mic', 'system'], twoway: ['mic', 'both'] };
const LEGACY_PRESET = { live: ['oneway', 'mic'], online: ['oneway', 'system'], mobile: ['twoway', 'mic'], field: ['twoway', 'mic'], meeting: ['twoway', 'mic'] };
export function normalizeMode(preset, src, defaultSrc) {
  const legacy = LEGACY_PRESET[preset];
  const p = legacy ? legacy[0] : preset;
  const allowed = PRESET_SRC[p];
  if (!allowed) return null; // 프리셋 없는 구세션·데스크 등은 대상 아님
  const fb = legacy ? legacy[1] : defaultSrc;
  return { preset: p, src: allowed.includes(src) ? src : (allowed.includes(fb) ? fb : 'mic') };
}
// STT 엔진 재연결 연속 실패 상한 — 초과하면 재시도를 멈춘다. 재연결 1회마다 용어집 context 가
// input_text_tokens 로 다시 청구되므로(데스크 기준 약 $0.008/회) 상한이 없으면 장애 시 과금이 폭주한다.
// 토큰이 실제로 수신되면 0 으로 리셋되므로 정상 세션의 간헐적 끊김은 누적되지 않는다.
export const SX_MAX_FAILS = 8;
// 재연결 지수 백오프: 800ms → 15s. 기준 간격만 env 로 낮출 수 있게 둔다(테스트가 수십 초를 기다리지 않도록).
const SX_RETRY_BASE_MS = Number(process.env.SX_RETRY_BASE_MS) || 800;
export const sxRetryDelay = (n) => Math.min(SX_RETRY_BASE_MS * 2 ** (n - 1), 15000);
// 데스크 세션 1개가 보존하는 응대(deskLog) 건수 상한 — 초과 시 가장 오래된 응대가 조용히 사라진다.
// 시범운영 기간의 응대 전문은 보고서의 원천 데이터라 유실되면 복구 수단이 없어 넉넉히 잡는다.
// 응대 1건 ≈ 2~4KB(toks 제외 후)이므로 1,000건이라도 세션 문서는 수 MB 수준 — Mongo 16MB 한도 안.
export const DESKLOG_CAP = 1000;
export const SONIOX_API_KEY = process.env.SONIOX_API_KEY || ''; // Soniox stt-rt-v5 테스트 모드(선택)
// Soniox stt-rt-v5 지원 언어(60) — 번역은 지원 언어 임의 쌍. 선택 UI/검증에 사용.
export const SONIOX_LANGS = ['af','sq','ar','az','eu','be','bn','bs','bg','ca','zh','hr','cs','da','nl','en','et','fi','fr','gl','de','el','gu','he','hi','hu','id','it','ja','kn','kk','ko','lv','lt','mk','ms','ml','mr','no','fa','pl','pt','pa','ro','ru','sr','sk','sl','es','sw','sv','tl','ta','te','th','tr','uk','ur','vi','cy'];
export const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || ''; // Cartesia Sonic 실시간 TTS(선택)
export const CARTESIA_VERSION = '2025-04-16';
export const CARTESIA_MODEL = 'sonic-3.5';

// 데스크톱 앱(Electron) 배포 — GitHub Release 에 올린 설치본을 프로필 메뉴에서 내려받게 한다.
//  · 비공개 repo 라도 서버가 GITHUB_TOKEN 으로 에셋을 받아 스트리밍 → 사용자는 GitHub 인증 불필요.
//  · 공개 repo 로 바꾸면 토큰 없이 browser_download_url 로 리다이렉트.
//  · DESKTOP_DOWNLOAD_URL 을 주면 GitHub 을 거치지 않고 그 주소로 바로 보냄(사내 서버·S3 등).
export const DESKTOP_REPO = process.env.DESKTOP_REPO || 'papimon33/translate';
export const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
export const DESKTOP_DOWNLOAD_URL = process.env.DESKTOP_DOWNLOAD_URL || '';

export const LANG_NAMES = {
  ko: '한국어', en: '영어', ja: '일본어', zh: '중국어', es: '스페인어',
  fr: '프랑스어', de: '독일어', vi: '베트남어', th: '태국어', id: '인도네시아어',
};
export const ALL_LANGS = ['ko', 'en', 'ja', 'zh']; // whisper 는 항상 한·영·일·중 전부 번역

if (!OPENAI_API_KEY) {
  console.error('\n[오류] OPENAI_API_KEY 가 설정되지 않았습니다. .env 파일을 만들어 주세요. (.env.example 참고)\n');
  process.exit(1);
}

// 빌드된 React 앱(dist) 서빙
export const STATIC_DIR = path.join(ROOT_DIR, 'dist');
export const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, 'data'); // 테스트는 임시 디렉터리로 격리
export const MONGODB_URI = process.env.MONGODB_URI;                       // 있으면 Mongo, 없으면 로컬 파일
export const MONGODB_DB = process.env.MONGODB_DB || 'kac_translator';     // DB 이름(앱이 자동 생성). 코드 기본값.

// 사용량 비용: 파이프라인별 오디오 분당 요금(USD) — 관리자 사용량 화면
export const PRICE_WHISPER_PER_MIN = Number(process.env.PRICE_WHISPER_PER_MIN || 0.017);
export const PRICE_TRANSLATE_PER_MIN = Number(process.env.PRICE_TRANSLATE_PER_MIN || 0.034);

// 인증: 관리자 계정(env 기반 가상 사용자)·쿠키 서명 키 — 경고·운영 게이트는 auth/index.js authBootCheck()
export const ADMIN_ID = process.env.ADMIN_ID || 'admin';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
export const AUTH_SECRET =
  process.env.AUTH_SECRET || crypto.createHash('sha256').update('kac::' + ADMIN_PASSWORD).digest('hex');
export const AUTH_COOKIE = 'kac_auth';

// 벤더 사용량 조회용 관리자 키(선택) — vendors/usage.js
export const CARTESIA_ADMIN_API_KEY = process.env.CARTESIA_ADMIN_API_KEY || '';
export const OPENAI_ADMIN_API_KEY = process.env.OPENAI_ADMIN_API_KEY || '';
