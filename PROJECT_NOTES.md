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
   - **번역 음성 출력**(토글, 기본 off): OA `session.output_audio.delta`(24kHz PCM16)를 host 로 전달(`{type:'audio',b64}`), `audio.js`가 Web Audio 로 끊김없이 재생. host WS `audioOut` 쿼리/`{type:'audioOut'}` 제어 메시지로 on/off. recorder `setAudioOut()`로 녹음 중에도 토글.

## whisper 핵심 로직 (server.js `runWhisper`)
- 클라이언트 VAD가 자주 커밋(0.8초 무음/2.5초 MAX) → 원문만 흘려보냄.
- 서버가 **N초(4.5초) 배칭** + `segmentTranslate`로 **GPT가 문장 경계 판단**(완결 문장만 번역, 미완성 꼬리는 remainder로 보류). whisper가 마침표를 안 찍는 문제 해결.
- `remainder`는 입력의 '깔끔한 꼬리'일 때만 신뢰(아니면 통째 보류 후 재시도) → 내용 누락/중복 방지.
- 약어(Dr. U.S. e.g.)·소수(3.5) 오인 방지 분리기 `splitSentences`(translate에서 사용).
- 1차 언어(ko) 먼저 emit → 나머지 언어 병렬 번역해 같은 카드에 병합(`upsertItem`).

## 반응형 / UI
- 메인 React 앱은 반응형(`App.jsx` `useMediaQuery(down('sm'))`). 모바일: 상단 AppBar(햄버거)+임시 Drawer 에 Nav, 데스크톱: 고정 사이드바. 모바일에서도 로그인/호스트 사용 가능(마이크). 별도 `mobile.html` 은 QR 뷰어 전용으로 유지.
- 용어집 하이라이트는 항상 on(토글 제거). translate 음성 출력 토글 + 볼륨 슬라이더(GainNode, `audio.js setVolume`).
- 하단 시작/중지 버튼: 검정 rounded 사각형+흰 글씨(Fab 아님). 빈 화면 안내 "버튼을 클릭해 실시간 번역을 시작하세요."는 번역영역 수직 중앙.
- 세션 목록/내부 헤더에 파이프라인 표기: whisper="다국어 번역", translate="실시간 통역". 세션생성 토글도 동일 라벨.
- 페이지 제목(실시간 번역/데스크 안내)은 좌측 정렬. 세션 내 컨트롤 바: 옵션(좌)+마이크 입력(우)이 한 박스, 숨김 버튼은 박스 밖 절대위치(우측) — 숨기면 박스 전체가 접히고 버튼만 제자리.

## 데스크 안내 모드 (pipeline='desk')
- 데스크(국제선 1층/2층 등)마다 세션 1개. 호스트가 세션에 들어가면 **자동으로 마이크 캡처**(별도 대기 버튼 없음, 권한 거부 시 인앱 배너). 캡처 중에도 **soniox 세션은 열지 않음**(서버가 오디오 버림 — 비용 0), 60초 idle-stop 도 데스크는 제외(무기한 대기).
- 호스트 하단 컨트롤: 대기 시엔 [언어 셀렉터(영어/일본어/중국어 — 한국어 표기)]+[통역 시작]만, 응대 중엔 [응대 중 칩]+[대기모드로]. 호스트 발화(ko)는 texts에 ko가 없으므로 원문을 본문으로 표시('번역 중…' 없음). 전체화면 버튼은 토글(재클릭 시 해제).
- 세션 내 QR('뷰어 연결') = `desk.html?session=ID`(해당 데스크 전용 뷰어). 데스크 목록 화면의 랜딩 QR은 제거됨(랜딩 `desk.html` 자체는 유지).
- 뷰어 플로우: **입장 화면**(안내데스크명 + 입장) → 전체화면 + **상시 WS 연결** → **대기 화면**("Touch your language to start translation" 세로 중앙 + 언어 버튼 원탭 시작: English/日本語/中文 + More languages(vi/th/id/ru)) → soniox two_way(ko↔선택언어) → 번역 텍스트 화면(발화 유도 "Please speak" 손님 언어). 전체화면이 풀리면 다음 터치에서 자동 복귀.
- 뷰어 CX: 무음 종료 10초 전 `desk-idle-warn` 배너(카운트다운, 터치 시 `desk-keepalive`로 연장) / 대화 종료 시 "Thank you" 1.5초 후 대기 화면 / 고급설정에 텍스트 크기(80~160%, `kac-font-scale`).
- 길안내는 **호스트 승인제**: 감지 시 `wayfind-suggest`(호스트 전용) → 하단 제안 칩 [표시/무시](20초 방치 소멸) → 승인 시 `wayfind-show`로 뷰어 브로드캐스트. 고급설정 '지도 자동 표시'(`kac-desk-map-auto`)면 즉시 승인. 부정어(없/말고/아니) 직매칭 차단→GPT 분류, 분류에 직전 손님 질문(ko 번역) 컨텍스트 동봉. `session.wayfindLog`(최근 200)에 감지·표시 기록. 뷰어 지도: ✕ 닫기, 헤더 탭 접기/펼치기, 새 발화 시 자동 축소, 시설 라벨 ko/en/ja/zh.
- TTS 재입력 방지(2중): ① `audio.js` — TTS 재생을 **WebRTC 루프백(RTCPeerConnection 쌍)** 경로로 우회해 브라우저 AEC 가 재생음을 마이크에서 제거(실패 시 재생 중 자동 음소거 폴백 `aecActive`). ② 서버 **자기음성 텍스트 필터**(`security_util.js echoMatch` + server `recentTts`/`noteTts`/`isSelfEcho`) — 시스템 오디오 캡처·기기 간 경로로 되돌아온 TTS 문장을 20초 내 유사도 매칭으로 버림(runSoniox·폰 PTT commit 에서 확인, 화면 카드도 제거).

## 실시간 번역(soniox) 최근 사양
- TTS(라벨 'TTS')는 **3모드 전부** 제공, 녹음 중 토글 가능(`audio.js setTts` → 서버 `{type:'tts',on,gender}`), 호스트도 재생(`ws._audioOut` 시 `sendAudioToHosts`; 클라는 첫 파이프만 재생해 이중재생 방지). 음성(성별) 라벨은 '음성'.
- 참여자 발화(PTT)는 **양방향 모드 기본 기능**(토글 삭제, GET 세션이 preset 기준으로 viewerPTT 계산). 뷰어 발화 버튼은 mobile.html **우하단**.
- **발화 배타 락**: room.hostTalking(마이크 연결=true, '발화 멈춤' 토글 시 `micState` 로 갱신) + room.speaking(뷰어). 점유 중 `ptt-denied`, 상태는 `ptt-state{busy}` 브로드캐스트 — 호스트가 발화 멈춤을 눌러야 뷰어가 발화 가능.
- **모드 변경**: 번역 이력 없는 세션은 옵션바 '모드' 셀렉터로 live/oneway/twoway 전환(PATCH preset, 모드별 기본값 리셋).
- 유휴(1분) 자동중지는 **전체 소스 기준**(audio.js `notifyActivityAll` — 어느 소스든 소리가 있으면 모든 host WS 에 activity).
- 옵션 숨김 토글: 콘텐츠 중앙·헤더 밀착 탭(공간 미차지, 숨김 시 opacity 0.4). 텍스트 크기 슬라이더(고급설정, `kac-font-scale`). AI 요약은 항상 한국어·누락 없이 상세(+맨 위 '한눈에 보기' 3줄).

## 운영/보안 (SECURITY_GUIDE.md 참고)
- `FORCE_HTTPS=1` http→https 리다이렉트. 관리자 **2FA(TOTP)**: env `ADMIN_TOTP_SECRET` 우선, 아니면 관리자>시스템·보안에서 설정(data/security.json). 로그인 시 `need2fa` 응답 → Login.jsx 코드 입력. `DATA_KEY` 설정 시 data/*.json **AES-256-GCM 암호화**(평문 하위호환, security_util.js).
- 관리자 탭: **데스크 통계**(GET /api/admin/desk-stats — deskLog 기반 응대수·언어분포·평균시간(deskLog.startedAt)·일별, 대화 내용 미노출) / **시스템·보안**(GET /api/admin/health — 가동시간·연결수·보안상태·최근 서버/브라우저 오류, POST /api/client-log 수집).
- **오번역 검사**: 관리자>용어 설정 '검사 실행' → POST /api/admin/terms-suggest (최근 대화 원문·번역 200쌍을 GPT 검수 → 용어 후보 추천 → '추가'로 translationTerms 반영).
- 테스트: `npm test` = smoke + `test/security.test.mjs`(base32/TOTP RFC 벡터/암호화 라운드트립·변조감지/에코 매칭).
- 데스크톱 설치파일: `desktop/` electron-builder — `npm run dist:win`(NSIS 설치 마법사 exe) / `npm run dist:mac`(dmg). macOS 시스템 오디오는 BlackHole 필요(desktop/README.md).
- 통역 시작/종료 프로토콜: 뷰어/호스트 `{type:'desk-start', lang}` → 서버 `deskCtrl`(sessionId→start/end) → `startConversation` → 모두에게 `{type:'desk-active', lang}` — **뷰어는 상시 연결이라 호스트가 시작해도 즉시 통역 화면으로 전환**. 종료(무음 deskIdle **기본 30초**·뷰어 ✕ `desk-end`·호스트 '대기모드로' `desk-reset-now`·호스트 이탈) → items 를 deskLog 에 보존 후 `desk-reset` → 뷰어는 터치 화면 복귀(WS 유지). 호스트 수동 시작은 `audio.js deskStart(lang)`.
- desk sentence 메시지에 **`lang`(발화 원문 언어)** 포함 — 뷰어가 말풍선 좌우(안내원 ko=좌 / 손님=우)를 번역 도착 전에 확정(방향 튐 방지). 화자 라벨(안내원/나)은 표시 안 함(정렬만 유지). 안내원 발화는 번역 도착 전까지 뷰어에서 숨김.
- 호스트 미준비 상태에서 뷰어가 시작하면 status 안내 토스트 후 터치 화면 복귀.
- 길안내(wayfind): 통역 중 안내원(ko) 답변에서 시설 감지 → 뷰어 채팅 아래 인라인 지도.

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
- [x] **접근 제한 → 다중 사용자 + 관리자**: 관리자 계정은 env `ADMIN_ID`/`ADMIN_PASSWORD`(미설정 시 admin/admin), 쿠키 서명 `AUTH_SECRET`(미설정 시 ADMIN_PASSWORD 파생). 로그인=ID+비번(`Login.jsx`)→HttpOnly HMAC 쿠키. 관리자만 **관리자 페이지**(`AdminPage.jsx`)에서 사용자 생성/삭제(ID·사용자명·비번, scrypt 해시). **사용자별 세션 분리**: 세션에 `owner`, list/patch/delete 가 소유자(또는 admin)만. **사용량 로깅**: 사용자별 세션 수 + 총 이용시간(`usageMs`, 호스트 WS 연결시간 누적, `addUsage`). 토큰 집계는 미포함(요청). **호스트만 보호**(`requireAuth`/`requireAdmin`), 모바일 뷰어(`/ws/viewer`, GET 세션, `/api/qr`)는 공개. 저장: Mongo `users` 컬렉션 / 파일 `data/users.json`. 멀티유저 전환 시 소유자 없는 구 세션 자동 삭제. 코드: server.js `currentUser`/`requireAuth`/`requireAdmin`/`/api/me`·`login`·`logout`·`/api/admin/users`.
- Nav(`Nav.jsx`): 좌상단 = 로고(rounded 사각형, favicon 동일) + "KAC Translator", 접으면 토글만. **프로필은 좌측 최하단**(아바타+사용자명, 클릭→메뉴: 정보변경/관리자페이지/로그아웃). '정보 변경'=`ProfileEditDialog`(ID 고정, 사용자명·비밀번호 변경, 비번 확인 일치 검사) → `PATCH /api/me`(관리자는 env 관리라 차단).
- **사용 비용**: 호스트 WS 연결시간을 **파이프라인별 분당 요금**으로 환산. `usageDaily[date]={whisperMs,translateMs}`(Mongo `usageDaily`/파일 `data/usage.json`), `recordUsage(pipeline,ms)`는 host WS close 에서 호출. 단가 env `PRICE_TRANSLATE_PER_MIN`(0.034)·`PRICE_WHISPER_PER_MIN`(0.017). 관리자 페이지에 총비용 + 일별 막대차트(`AdminPage.jsx` `DailyChart`, 최근 14일). 코드: server.js `recordUsage`/`costOfDay`/`GET /api/admin/usage`.
- 주의: 무료 티어는 15분 유휴 시 슬립 → 첫 접속 cold start ~30초. WS는 클라가 이미 `wss/ws` 자동 선택(`location.protocol/host`).

## 용어 설정(고유명사 + 번역, Soniox context)
- **용어집(하이라이트) 기능은 폐기됨**(glossary.js·GlossaryPage·computeTerms·terms 스팬·Mongo `glossary` 컬렉션 모두 삭제. 부팅 시 Mongo면 `glossary.drop()`).
- **전역 설정 1개**: `termsConfig = { terms:[고유명사], translationTerms:[{source,target}], updatedAt }`. 저장 Mongo `termsConfig`(단일 `_id:'singleton'`) / 파일 `data/terms_config.json`. 저장된 값 없으면(=updatedAt 0) 부팅 시 KAC 항공 기본값 시드(`DEFAULT_TERMS`/`DEFAULT_TRANSLATION_TERMS`).
- **라우트**: `GET /api/terms-config`(로그인 누구나 열람), `PUT /api/terms-config`(관리자만, `persistTermsConfig`).
- **Soniox 주입**: runSoniox config 에 `buildSonioxContext()` → `{ terms:[고유명사+번역source], translation_terms:[{source,target}] }`. 세션 시작 시점에 반영(녹음 중 변경은 다음 세션부터).
- **프론트**: Nav '용어 설정' → `TermsConfigPage`(고유명사=칩 입력 Enter추가/✕삭제, 번역=source→target 행 추가/편집/삭제). 관리자만 수정 가능(`user.role`), 일반 사용자는 읽기 전용. api: `termsConfig()`/`saveTermsConfig(body)`.

## AI 요약 (gpt-5-nano)
- 세션 케밥 'AI 요약' → `POST /api/summaries {sessionId}` → 서버가 **비동기 백그라운드**로 요약(화면 이탈해도 진행). 세션당 1개(재요청 시 덮어쓰기/재시도).
- 요약 로직(server.js): `sessionTranscript`(ko 우선, **화자 있으면 `* [화자] : 발언` 형식**) → `summarizeTranscript`. 16000자 초과면 **map-reduce**(청크별 노트→통합). 프롬프트 `SUMMARY_SYS`(머리말 없이 본문만, ##/불릿, 지어내기 금지, **화자별 입장 구분**). 전문<10자면 즉시 `error`.
- 상태 `pending|done|error`. 서버 재시작 시 `pending`→`error`(무한 스피너 방지). 저장: Mongo `summaries`/파일 `data/summaries.json`, 사용자별.
- 라우트: `GET /api/summaries`(목록·본문 제외), `GET /:id`(본문 포함), `POST`(생성/재생성), `DELETE`.
- 프론트: Nav 'AI 요약' → `SummaryPage`(목록 최신순, 상태뱃지 요약중/완료/실패, 폴링 3s, 검색, 빈상태, 펼치면 본문+복사·다운로드, 실패 시 재시도, 삭제).

## 운영 보강 (production hardening)
- **유휴 자동 종료**: 호스트 WS 에서 1분간 음성 활동(전사/번역 델타) 없으면 OA 세션 닫음(`bumpIdle`/`idleClose`, IDLE_LIMIT_MS=60000). 서버가 `{type:'idle-stop'}` → 클라가 stop()+안내. whisper=transcription.delta, translate=output_transcript.delta 에서 리셋, oa open 시 시작.
- **로그인 무차별 대입 방어**: IP당 15분 내 8회 실패 시 15분 잠금(429), 메모리 `loginFails`. 성공/실패 로그.
- **보안 헤더**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, (https)HSTS. `x-powered-by` 끔, `trust proxy`.
- **CSRF 완화**: `/api` 의 POST/PUT/PATCH/DELETE 는 동일 출처(Origin host==host)만 허용, 교차출처 403.
- **Mongo 견고화**: 연결 3회 재시도(serverSelectionTimeoutMS 8s). `MONGODB_URI` 설정됐는데 실패 시 — 운영(NODE_ENV=production)에선 파일모드 폴백 대신 **기동 중단**(데이터 분리/유실 방지), 개발에선 파일 폴백.
- `NODE_ENV=production` + `AUTH_SECRET` 미설정 시 경고.
- **관리자 비밀번호 재설정**: `POST /api/admin/users/:id/password`(requireAdmin) + AdminPage 행별 🔑 버튼/다이얼로그.
- **코드 스플리팅**: App.jsx 에서 TranslateView/AdminPage/SummaryPage/TermsConfigPage 를 React.lazy + Suspense.
- **CI/테스트**: `npm test`(node:test, `test/smoke.test.mjs`) + `.github/workflows/ci.yml`(ci: npm ci→test→build).

## 주의
- OpenAI 실시간 모델은 **GA API** 사용(베타 헤더 X). `gpt-realtime-translate`는 `/v1/realtime/translations` 전용 엔드포인트.
- OpenAI 비용은 호스팅과 별개로 항상 발생(음성 모델). whisch 다국어는 전사 1회 + 언어당 텍스트 번역.
- 옛 세션('123123' 등)은 옛 `text` 형식 → 클라이언트에서 `texts`로 하위호환 처리됨.
