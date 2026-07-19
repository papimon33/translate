# AirTalk

공항 실시간 음성 번역 웹앱. **Soniox 실시간 STT+번역**과 **Cartesia TTS**, **GPT(다듬기·교정)**를 조합해
대면 안내(안내데스크)·회의·현장 통역을 지원합니다. 세션별 대화가 자동 저장되고, QR 로 연결한 태블릿/휴대폰 뷰어에서 함께 봅니다.

> 개발 인수인계·아키텍처 상세는 **`PROJECT_NOTES.md`**(필독), 평가 절차는 `eval/TEST_GUIDE.md`.

## 주요 기능

| 모드 | 설명 |
|---|---|
| **데스크 안내** | 안내데스크 상시 운영: 손님이 태블릿에서 언어 터치 → 양방향 통역. 지향성 마이크 2대(PC 직결) 또는 태블릿 마이크 2채널, 길안내 지도(호스트 승인제), TTS |
| **실시간 번역** | 라이브 청취(단방향), 온라인 회의(시스템 오디오), 양방향 번역(마이크). 60개 언어 |
| 공통 | 용어 설정(Soniox context 주입) · 저신뢰 자동 교정(GPT·β) · RNNoise 잡음 제거(β) · 적응형 마이크 게이트 · AI 요약 |
| 앱 | Windows/macOS(Electron) · Android(WebView + 네이티브 마이크, AGC 차단) — 프로필 → 앱 설치 |
| 관리자 | 사용량(벤더 청구 API) · 로그 · 안내데스크 정의 · 계정 · 용어 · 정형 안내 · 시스템/백업 |

## 설치 & 실행

```bash
npm install
cp .env.example .env   # OPENAI_API_KEY, SONIOX_API_KEY, CARTESIA_API_KEY(선택), MONGODB_URI(선택)
npm start              # vite build && node server.js  (http://localhost:3000, 기본 admin/admin)
```
- 코드 수정 후 재시작 필요. 프론트만: `npm run build` / 서버만: `npm run serve` / 테스트: `npm test`
- 프론트 소스 `client/` → 빌드 `dist/`(express 서빙). **`dist` 직접 수정 금지.**
- 저장소: `MONGODB_URI` 있으면 MongoDB, 없으면 `data/*.json` 파일.
- ⚠ Soniox/OpenAI/Cartesia 호출은 항상 과금 — 테스트 세션은 끝나면 삭제.

## 테스트

`npm test` — **전부 무과금**(실 엔진 대신 가짜 Soniox 사용), 1초 내 완료. CI 에서도 실행.

| 종류 | 파일 | 내용 |
|---|---|---|
| 순수 로직 | `test/logic.test.mjs` | confFix 트리거 규칙·간투사/응답어 필터·데스크 제어 빈도 제한·KST 버킷 (`pipeline_util.js`) |
| 파이프라인 E2E | `test/desk-pipeline.test.mjs` | 가짜 Soniox(`SONIOX_WS_URL` 오버라이드)로 데스크 응대 시작→발화 확정→호스트 이탈 아카이브·제어 난사 차단 |
| 저장소 | `test/store.test.mjs` | 손상 파일 부팅(`.corrupt` 백업 + 나머지 정상 로드), 임시 `DATA_DIR` 격리 |
| 보안·부팅 | `test/security.test.mjs` · `boot.test.mjs` | TOTP·저장 암호화·에코 필터, 더미 키 실기동 |

- 새 파이프라인 시나리오는 `test/helpers/fake-soniox.mjs`(토큰 재생) + `helpers/boot.mjs`(격리 부팅)로 작성.
- **과금되는 실검증**(수동): `node eval/soniox-pairs.mjs` (언어쌍·오디오 재생 진단), 음성 E2E 는 `eval/tts-audio/` mp3 + `score.mjs --auto`.

## 로그(데이터) 구조 — 하나의 대화 로그로 여러 분석

모든 분석 데이터는 **세션의 대화 항목(item) 하나에 통합**돼 쌓입니다(별도 로그 파일 없음).
데스크는 응대가 끝날 때 items 가 `deskLog` 항목으로 아카이브됩니다.

```jsonc
// session.items[] / session.deskLog[].items[]
{
  "id": "mr…",
  "side": "right",            // right=호스트(마이크) / left=게스트(여객 채널)·시스템
  "lang": "ja",               // 발화 원문 언어(토큰 다수결) — 화자 라벨·언어 분포의 근거
  "source": "トイレはどこですか。",     // 원문(STT)
  "texts": { "ko": "화장실은 어디예요?" }, // 번역 { 언어코드: 문장 }
  "speaker": null,            // 화자 구분(diarization) 사용 시
  "toks": [["トイ", 0.98], ["レ", 0.95]], // 원문 토큰별 confidence(≤120개) — 인식 품질·confFix 근거
  "tm": {                     // 레이턴시 분해 타임스탬프(epoch ms) — 저장 전용(뷰어 미전송)
    "s": 1789000000000,       //  첫 토큰(발화 인식 시작)
    "e": 1789000003000,       //  <end>(엔드포인트 감지 = 발화 종료 판정)
    "c": 1789000003200,       //  카드 확정(commit)
    "tq": 1789000003300,      //  TTS 합성 요청(TTS 켠 세션만, 발화당 첫 문장 기준)
    "ta": 1789000003700       //  TTS 첫 오디오 청크(체감 음성 지연의 끝점)
  }
}

// session.deskLog[]  (데스크 응대 1건)
{ "startedAt": 0, "endedAt": 0, "lang": "en",  // 손님 언어(잠금 또는 발화에서 유추 — '미상' 없음)
  "interrupted": false, "items": [], "stats": { "staff": 7, "guest": 5, "crossDrops": 0 } }
```

### 로그 분석 방안

한 로그에서 파생되는 대표 분석(관리자 API `GET /api/admin/logs/*` 또는 백업 JSON에서 수행):

| 분석 | 계산 | 의미 |
|---|---|---|
| **발화 길이** | `tm.e − tm.s` | 실제 발화 시간 |
| **확정 지연** | `tm.c − tm.e` | 말이 끝나고 카드가 뜨기까지 — 종료 민감도·최대 지연 튜닝 지표 |
| **음성 지연** | `tm.ta − tm.c` | 카드 확정 후 TTS 첫 소리까지(합성 경로 성능) |
| **체감 총지연** | `tm.ta − tm.e` | 말 끝 → 소리 시작(TTS 세션의 핵심 KPI) |
| **응대 응답 지연** | 손님 item `tm.e` → 다음 안내원 item `tm.s` | 데스크 서비스 KPI |
| **인식 품질** | `toks` confidence 분포 | `node eval/conf-analyze.mjs` — confFix 임계 재튜닝(근거: PROJECT_NOTES 2026-07-14(5)) |
| **언어 분포·응대량** | `deskLog.lang` · 건수/시간 | 관리자 > 사용량의 데스크 통계 |
| **누화율** | `deskLog.stats.crossDrops` | 2채널 마이크 간섭 지표(높으면 마이크 배치·민감도 조정) |
| **번역 정확도** | 응대 로그 → 평가 JSON | 관리자 > 로그 > [평가 JSON 내려받기] → `node eval/score.mjs --auto` |

백업: 관리자 > 시스템·보안 > **전체 데이터 백업(JSON)** — sessions(deskLog 포함)·데스크 정의·용어·정형 안내를 한 파일로.

## 구조(요약)

```
server.js            # 전부: REST + WS(host/viewer) + 파이프라인(runSoniox/runDesk/runTranslate)
                     #  + Cartesia 상시 WS + confFix + 용어 context + 데스크 레지스트리
client/src/          # React 앱(TranslateView·SessionList·AdminPage·Nav·audio.js)
client/public/       # desk.html(데스크 뷰어)·mobile.html(모바일 뷰어) — 독립 바닐라 JS
android/             # Android 키오스크 앱(WebView + 네이티브 마이크) — android/README.md
desktop/             # Electron 데스크톱 앱
eval/                # 평가: dataset·score·conf-analyze·make-tts-audio(6언어 mp3)
```

WS 프로토콜·표시 규칙·운영/보안·과금 구조(context = input_text_tokens)는 `PROJECT_NOTES.md` 참고.
