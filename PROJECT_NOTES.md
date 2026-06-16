# KAC Translator — 개발 핸드오프 노트

실시간 음성 번역 웹앱. 데스크톱(호스트)이 오디오를 캡처→번역하고, 모바일(뷰어)이 QR로 접속해 자기 언어로 봄.

## 스택 / 실행
- 프론트: **React 19 + MUI 9 + Vite 8** (`client/` 소스 → `dist/` 빌드)
- 백엔드: **Node(Express) + ws(WebSocket)**, 세션은 `data/sessions.json` 파일 저장
- 실행: `npm start`(= `vite build && node server.js`), 코드 수정 후 재시작 필요. 빌드만: `npm run build`, 서버만: `npm run serve`
- `.env`: `OPENAI_API_KEY`, `TRANSCRIBE_MODEL`(기본 gpt-realtime-whisper), `TRANSLATE_MODEL`(gpt-realtime-translate), `REFINE_MODEL`(gpt-5-mini), `PORT`

## 두 가지 번역 파이프라인 (세션 생성 시 선택, 변경 불가)
1. **whisper** (저비용·다국어): `gpt-realtime-whisper`(`/v1/realtime?intent=transcription`)로 원문 전사 → `gpt-5-mini`로 번역.
   - **항상 한·영·일·중(ko/en/ja/zh) 4개국어 전부 번역** (`ALL_LANGS`).
   - 항목 구조 `{ side, source(원어), texts:{ko,en,ja,zh} }`.
   - 번역 스타일: **부드러운 의역**(자연스러움 우선), 다듬기 항상 on.
2. **translate** (고품질·단일): `gpt-realtime-translate`(`/v1/realtime/translations`)로 단일 언어 번역 → **띄어쓰기만** 교정(`spacingPolish`, 의역·단어변경 금지).
   - 카드에 **스트리밍**으로 직접 써내려감(회색 partial 없음), 말 멈추면(1.2초) 확정.

## whisper 핵심 로직 (server.js `runWhisper`)
- 클라이언트 VAD가 자주 커밋(0.8초 무음/2.5초 MAX) → 원문만 흘려보냄.
- 서버가 **N초(4.5초) 배칭** + `segmentTranslate`로 **GPT가 문장 경계 판단**(완결 문장만 번역, 미완성 꼬리는 remainder로 보류). whisper가 마침표를 안 찍는 문제 해결.
- `remainder`는 입력의 '깔끔한 꼬리'일 때만 신뢰(아니면 통째 보류 후 재시도) → 내용 누락/중복 방지.
- 약어(Dr. U.S. e.g.)·소수(3.5) 오인 방지 분리기 `splitSentences`(translate에서 사용).
- 1차 언어(ko) 먼저 emit → 나머지 언어 병렬 번역해 같은 카드에 병합(`upsertItem`).

## 표시 규칙
- **데스크톱**: 출력언어 select(한영일중)로 1개 표시. 선택 언어 없으면 다른언어 대체 X, 원문을 흐리게. 원어표시 토글(회색 원문). 오디오소스 마이크/시스템/모두. 다듬기 토글 없음(필수).
- **모바일**(`client/public/mobile.html`, 바닐라): 헤더 KAC Translator+설정톱니 → 세션제목 → 언어select(한영일중 전부). 모든 메시지 **좌측 정렬 + 최신 강조색**. 설정시트(글자크기 %±10 / QR보기 / 원문동시보기 / 다크모드, 행 전체 클릭). QR모달(중앙 QR+읽기전용 링크+복사+X).
- 선택 언어 미도착 시 한국어 깜빡임 방지: `pick()`이 대체 안 하고 원문 placeholder.

## 주요 파일
- `server.js` — 전부(REST, WS host/viewer, 두 파이프라인, GPT 호출). 핵심: `handleHost`>`runWhisper`/`runTranslate`, `segmentTranslate`, `spacingPolish`, `translateText`, `splitSentences`, `upsertItem`.
- `client/src/components/TranslateView.jsx` — 데스크톱 번역뷰
- `client/src/components/SessionList.jsx` — 세션목록 + 새세션 모달(파이프라인만 선택)
- `client/src/components/Nav.jsx`, `App.jsx`, `theme.js`, `audio.js`(캡처/VAD), `api.js`
- `client/public/mobile.html` — 모바일 뷰어(독립 바닐라 JS)

## 메시지 프로토콜 (WS)
- `{type:'sentence', id, side, source, texts:{lang:text}}` — 같은 id로 언어별/스트리밍 병합
- `{type:'partial', side, text}` — whisper 진행중 원문
- `{type:'snapshot', items}` — 뷰어 접속 시 누적분
- `{type:'status', message}`

## 배포 (Render + MongoDB Atlas)
- [x] **Render 설정**: `render.yaml`(Blueprint). plan=free, build `npm install --include=dev && npm run build`(무료티어 NODE_ENV=production이라 vite devDep 빠짐 방지), start `node server.js`. PORT는 Render 자동 주입.
- [x] **QR public 도메인**: `/api/qr`가 요청 `x-forwarded-proto`/`x-forwarded-host`(Render 프록시) 사용. localhost/사설IP 접속이면 `getLanIp()`로 폴백(로컬 와이파이 폰 접속 유지).
- [x] **세션 영속화 → MongoDB Atlas**: `MONGODB_URI`(Render secret) 있으면 Mongo, 없으면 `data/sessions.json` 파일 폴백(로컬 dev). DB 이름 `MONGODB_DB`는 코드 기본값 `kac_translator`(env로 덮어쓰기 가능, DB/컬렉션은 첫 저장 시 자동 생성). 저장 `flushSessions`(debounced replaceOne upsert), 삭제 `deleteSessionStore`(deleteOne). 코드: server.js `loadSessions`/`saveSessions`/`flushSessions`/`deleteSessionStore`.
- [ ] **접근 제한**: 공개 시 아무나 OpenAI 키를 소모하므로 비밀번호/인증 필요. (미구현)
- 주의: 무료 티어는 15분 유휴 시 슬립 → 첫 접속 cold start ~30초. WS는 클라가 이미 `wss/ws` 자동 선택(`location.protocol/host`).

## 주의
- OpenAI 실시간 모델은 **GA API** 사용(베타 헤더 X). `gpt-realtime-translate`는 `/v1/realtime/translations` 전용 엔드포인트.
- OpenAI 비용은 호스팅과 별개로 항상 발생(음성 모델). whisch 다국어는 전사 1회 + 언어당 텍스트 번역.
- 옛 세션('123123' 등)은 옛 `text` 형식 → 클라이언트에서 `texts`로 하위호환 처리됨.
