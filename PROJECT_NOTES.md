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
- **오번역 검사**: 관리자>용어 설정 → '최근 전체 검사' 또는 '대상 선택…'(세션·안내데스크 체크) → POST /api/admin/terms-suggest {sessionIds?} (일반 대화 + 데스크 응대 로그 원문·번역 200쌍을 GPT 검수 → 용어 후보 추천 → '추가'로 translationTerms 반영).
- **관리자 '로그' 탭**: GET /api/admin/logs(데스크 응대 건 메타 + 세션 메타) / logs/desk/:sid/:idx·logs/session/:id (대화 전문). 건당 시각·길이·언어·문장수·누화드랍 표시, 클릭 시 전문(안내원/손님·마이크/시스템 구분) 펼침.
- 모바일: 세션 화면 옵션바 기본 접힘(<600px), 타이틀바·간격 축소, 하단 버튼 세이프에어리어. 관리자 카드류 borderRadius 3→2.
- 테스트: `npm test` = smoke + `test/security.test.mjs`(base32/TOTP RFC 벡터/암호화 라운드트립·변조감지/에코 매칭) + `test/boot.test.mjs`(더미 키로 실제 기동→/health).
- **전면 감사 후 안정화(49건 수정)**: 공개 GET 세션은 화이트리스트 필드만(deskLog 등 미노출) · 운영 기동 게이트(AUTH_SECRET/ADMIN_PASSWORD 필수, ALLOW_INSECURE=1 우회) · 쿠키 토큰 30일 만료(id.ts.sig — 구 쿠키는 재로그인 1회) · WS 하트비트 30s(ping/pong, 죽은 소켓 락 해제) + 빈 room GC · 세션 삭제 시 연결 강제 종료·부속맵 정리 · 원자적 파일 쓰기(tmp+rename) · JSON 바디 기본 256kb(terms-config만 16mb)·client-log IP당 분당 10회 · api.js json 이 r.ok 검사(오류 전파) · 에코/crossDup 매칭은 길이비 0.6 이상만(따라 말하기 오탐 제거) · 중복 확정은 5초 창 내만 · 빈 커밋/에코 드랍 시 클라 카드 제거(sentence 빈 페이로드=삭제 규약) · runSoniox 자동 재연결+全 pending 큐 24프레임 상한 · runWhisper flush 보류 재실행(마지막 문장 유실 수정) · desk endConversation 은 현 등록 ctrl 만 세션 조작(좀비 가드)+guestCommit 포함, 여객 스트림 소유 소켓만 수용, wayfind 비동기 세대 가드 · langVotes 동률 유지 · takeover 레이스(클라 stop 후 제어 메시지 무시)+호스트 WS 자동 재연결(audio.js wire/pipe.ws) · 언마운트 시 stopReq 로 권한 대기 레코더 정리 · desk.html enterStage 재진입/thanks 타이머/절전 후 meta 동기화(started 재전송 제거)/keepalive 보류 재전송/지도 스크립트 재시도 상한/#stage 스페이서 스크롤 · mobile.html connect 중복 가드/PTT 재접속 재전송·이중탭 가드·백프레셔/카드 300개 상한 · desktop mac loopback 분기.
- 데스크톱 설치파일: `desktop/` electron-builder — `npm run dist:win`(NSIS 설치 마법사 exe) / `npm run dist:mac`(dmg). macOS 시스템 오디오는 BlackHole 필요(desktop/README.md).
- 통역 시작/종료 프로토콜: 뷰어/호스트 `{type:'desk-start', lang}` → 서버 `deskCtrl`(sessionId→start/end) → `startConversation` → 모두에게 `{type:'desk-active', lang}` — **뷰어는 상시 연결이라 호스트가 시작해도 즉시 통역 화면으로 전환**. 종료(무음 deskIdle **기본 30초**·뷰어 ✕ `desk-end`·호스트 '대기모드로' `desk-reset-now`·호스트 이탈) → items 를 deskLog 에 보존 후 `desk-reset` → 뷰어는 터치 화면 복귀(WS 유지). 호스트 수동 시작은 `audio.js deskStart(lang)`.
- desk sentence 메시지에 **`lang`(발화 원문 언어)** 포함 — 뷰어가 말풍선 좌우(안내원 ko=좌 / 손님=우)를 번역 도착 전에 확정(방향 튐 방지). 화자 라벨(안내원/나)은 표시 안 함(정렬만 유지). 안내원 발화는 번역 도착 전까지 뷰어에서 숨김.
- 호스트 미준비 상태에서 뷰어가 시작하면 status 안내 토스트 후 터치 화면 복귀.
- 길안내(wayfind): 통역 중 안내원(ko) 답변에서 시설 감지 → 뷰어 채팅 아래 인라인 지도.
- 엔진 토큰은 **현재 소켓 + phase active 일 때만 처리**(종료 후 늦게 도착한 토큰이 다음 응대에 새는 잔여 버퍼 문제 수정). 여객 오디오는 **백프레셔 드랍**(클라 ws.bufferedAmount>128KB·서버 gsx>256KB 시 프레임 버림, 연결 전 큐는 최근 ~2초만) — 밀린 오디오를 그대로 보내면 이후 인식이 계속 지연되는 문제 방지.
- 입력 언어 판정은 **토큰 다수결**(runSoniox·runDesk 공통, `langVotes`) — 한국어 발화의 첫 단어가 영어로 오인돼도 뒤 토큰들이 교정.
- **동시접속 승계(takeover)**: 같은 세션·같은 소스로 새 호스트 연결이 오면 기존 연결에 `{type:'takeover'}` 후 종료(나중 연결 우선). 클라는 notice 표시. 로그인 자체는 무상태 HMAC 쿠키라 충돌 없음.
- **2채널 마이크(프로토타입)**: 통역 시작 시 여객 태블릿이 자기 마이크를 상시 캡처해 뷰어 WS 로 스트림(`desk.html guestMicStart`, 근접 게이트 GM_GATE=0.04 미만은 무음 전송) + `{type:'desk-mic',on}` 등록. 서버 `runDesk` 가 **여객 전용 soniox one_way(선택언어→ko, 힌트 고정)** 엔진을 병행 — 채널 자체가 화자 귀속(guest: side='left'/lang=손님언어), 동시 발화도 채널별 독립 인식. 누화 방어: 근접 게이트 + `crossDup`(교차 채널 5초 내 유사 문장=누화 드랍, `echoMatch` 재사용). 여객 마이크 실패/해제 시 기존 단일 채널(two_way)로 자동 폴백. 누화율 측정: `deskLog[].stats={staff,guest,crossDrops}` + 서버 콘솔 `[desk] 채널 통계`. 호스트 응대 칩에 '· 2채널' 표시(`desk-guest-mic`). 뷰어 재접속 시 desk-mic 재등록(소유 소켓 추적으로 구 소켓 close 무시).

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

## 2026-07-09 — whisper 삭제 + 용어설정 다국어 개편
- **whisper 파이프라인 삭제**: `runWhisper`·`TRANSCRIBE_MODEL` 제거, 세션 생성 기본 `soniox`. 기존 whisper 세션은 열람만 가능(시작 시 "지원 종료" 상태 메시지). 클라 PIPES 에서 '다국어 번역 (구)' 제거, `pipeline || 'soniox'` 폴백.
- **termsConfig 새 스키마**:
  - `terms` = `{ airline: [], aviation: [], etc: [] }` 3분류(구형 평면 배열은 기본 항공용어→aviation, 나머지→etc 자동 분류).
  - `translationTerms` = 행당 다국어 `{ ko(필수·행 키), en?, ja?, zh?, es?, fr?, pt?, ar? }` (구형 `{source,target}` → `{ko:target, en:source}` 마이그레이션).
  - 로드/`PUT /api/terms-config` 모두 `normalizeTermsConfig` 로 정규화. 마이그레이션은 부팅 시 1회, 항공사 36개 시드 병합.
  - 시드: `DEFAULT_AIRLINES`(36개, ko/en/ja/zh — es/fr/pt/ar 는 비워 en 폴백. **파라타항공 en·섬에어 외국어 표기는 미확정이라 비움 — 확정 시 채울 것**), `DEFAULT_TERMS_AVIATION`, `DEFAULT_TRANSLATION_TERMS`(ko/en 항공용어 30).
- **buildSonioxContext(langs)**: 활성 언어쌍의 표기·번역쌍만 조립(양방향 2항목/행). 비면 en→ko 폴백(`termLangValue`). 한도 방어: JSON 9,500자 초과 시 번역쌍→terms 순으로 잘라내고 경고 로그. Soniox 한도 = context 전체 8,000토큰(≈10,000자), translation_terms 는 항목당 target 언어 1개.
  - 호출부: runSoniox(two=[A,B]/one=[target,+힌트]), desk `baseConfig(langs)`(configFor/guestConfig), PTT `startTalkPipeline`(기존 미주입이던 것 추가).
- **용어설정 UI**(TermsConfigPage 재작성): 고유명사 3분류 칩, 번역설정 언어 Select(ko→선택언어 열 편집, 폴백 플레이스홀더), 저장 버튼 아래 컨텍스트 크기 게이지 `N/10,000자`(언어쌍 중 최대 기준, 80% 경고색/초과 시 Alert), JSON 내려받기/업로드(구형 형식도 수용), 오탈자·오번역 검사 채택 시 한글 감지로 ko/현재 언어 열 배치.
- 검증: 8/8 테스트(부팅 테스트가 실데이터 마이그레이션 수행 확인), 빌드 OK, 프리뷰에서 3분류(36/23/0)·게이지 7,048자·언어 전환(ja=大韓航空)·데스크 ja 실연결(desk-active, soniox 오류 없음 → 새 context 수용) 확인.

## 2026-07-09 (2) — 항공사 축약형(alt) 지원
- **번역 행에 `alt` 필드 추가** — `{ ko, en, ja, zh, …, alt: { ja:[…], zh:[…] } }`. 현지 축약/구어 표기(예: 国航, 全日空, JAL, ピーチ).
  - **인식**: 활성 언어의 alt 표기를 Soniox `terms` 에 추가 → 축약형 전사 정확도 ↑.
  - **번역**: `alt→ko`(정식명) **단방향** translation_term 만 추가 → 정방향(한국어→외국어)은 정식명 유지(충돌 방지). 예: 国航→중국국제항공.
  - `buildSonioxContext`/`normalizeTermsConfig` 가 alt 처리·보존. 클라 `contextSizeFor`/`normalizeUpload`/save 도 alt 반영.
- **시드 보강**: 일본항공(日航/JAL)·전일본공수(全日空/ANA)·피치(ピーチ), 중국국제(国航)·남방(南航)·동방(东航)·상하이(上航)·사천(川航)·하문(厦航)·길상(吉祥)·춘추(春秋). 파라타항공 ja/zh(パラタ航空/帕拉塔航空, **잠정 음역 — 검수 필요**).
- **1회 백필 마이그레이션**: `termsConfig.altSeeded` 플래그. 기존 저장분(alt 없던 항공사 행)에 시드 alt·미채운 ja/zh 병합, 이후엔 사용자 삭제분 되살리지 않음.
- **UI**: 번역 설정 각 행 아래 '약어·구어' 칩 편집기(선택 언어 기준 추가/삭제). JSON 입출력도 alt 라운드트립.
- 검증: 빌드 OK, 프리뷰에서 alt 백필 로그·데이터 확인, ko↔zh 데스크 연결(약어 포함 context 수용, soniox 오류 0), UI 国航/南航 칩 렌더 확인.

## 2026-07-09 (3) — 평가 가이드 러너 (eval.html)
- **목적**: 수동 결과 전사(로그→records.json) 제거. 낭독→자동 수집→즉시 채점을 한 화면에서.
- **`client/public/eval.html`** (독립 바닐라 JS): 언어 선택 → 마이크 캡처(soniox two_way ko↔L, host WS, 세션 미생성 `eval-<rand>`) →
  시나리오별 질문(원어)·답변(한국어) 낭독 안내 → `sentence` 수신 시 방향에 맞춰 자동 태깅(q: stt=source/mt=texts.ko, a: stt=source/mt=texts[L]) →
  입력칸에서 수정 가능 → [확정&다음]으로 records 누적 → 완료 후 [채점(OpenAI)]/[간이(CER)]/[records 내려받기]. 언어 감지 불일치 경고, 20s activity ping으로 유휴 종료 방지.
- **채점 코어 분리**: `eval/score_core.mjs`(CER·정규화·judge·집계·오류귀속 순수 함수). `eval/score.mjs`(CLI)와 서버가 공유.
- **서버 API**(requireAdmin): `GET /api/eval/dataset`(정답셋), `POST /api/eval/score`({records,dry}→구조화 리포트). OPENAI_API_KEY 없으면 자동 dry.
- **진입점**: 관리자 → 용어 설정 상단 **'평가 러너'** 버튼(`window.open('/eval.html')`). `eval/TEST_GUIDE.md` 최상단에 러너 절차 추가.
- 검증: dataset API 30개·score API dry 리포트·페이지 로드·러너 로직(질문/답변 방향별 캡처·records 누적) 프리뷰 확인. 마이크 캡처는 mobile.html PTT와 동일 코드(실기기 필요).

## 2026-07-09 (4) — 관리자 개편(벤더 사용량·로그·평가 흐름 단순화)
- **평가 러너 삭제** → 데스크 로그 활용: 관리자→로그→응대 상세에 **[평가 JSON 내려받기]**(items→records 변환, 안내원(ko)=a/손님=q). `eval/score.mjs --auto` 가 scenario_id 없이 정답 원문 CER 유사도로 자동 매칭(0.55 초과 미매칭 제외·표시). /api/eval/* 및 eval.html 제거. TEST_GUIDE 표준 절차 갱신.
- **번역설정 약어(alt) 입력 UI 제거** — 데이터·서버 로직(alt 인식 힌트+축약→정식명 번역)은 유지, 편집은 JSON 업로드로.
- **벤더 실사용량**: `GET /api/admin/vendor-usage?days=`(requireAdmin, 10분 캐시) —
  Soniox `GET /v1/usage-logs`(일반 키, cost_usd·audio ms, 문자열 숫자 주의 Number() 강제), Cartesia `GET /usage/credits`(⚠ `CARTESIA_ADMIN_API_KEY`=sk_car_admin_… + Cartesia-Version 헤더), OpenAI `GET /v1/organization/costs`(⚠ `OPENAI_ADMIN_API_KEY`=sk-admin-…). KST 일별 버킷.
  사용량 탭 = 요약 StatCard → **벤더 카드 3개**(총액/미니바, 키 미설정 시 env 안내) → 내부 집계(추정치 라벨) → **데스크 통계 편입**(데스크 탭 제거).
- **로그 스크롤 억제**: 데스크 응대 8건/세션 15건 첫 표시 + '더 보기', 전문(TranscriptView)은 maxHeight 340 내부 스크롤.
- 관리자 상단 '관리자' 타이틀 제거(탭이 최상단), 카드 라운딩 2→1.5(용어 3→2).
- 검증: Soniox 실청구 조회 성공(7일 $0.4152/103분, 14일 $0.792/244분), Cartesia·OpenAI 키미설정 카드, 탭 5개, 로그·용어 렌더, 8/8 테스트.

## 2026-07-10 — 벤더 사용량 무기한 누적(보관기간 대응)
- **문제**: 벤더 사용량 API 는 조회 보관기간이 있다 — **Soniox 91일 보관 · 요청당 31일 창**. 그 뒤엔 API 로도 못 꺼냄.
- **해결**: `vendorUsage` 저장소(Mongo `vendorUsage` 싱글턴 / 파일 `data/vendor_usage.json`)에 일별로 계속 누적.
  - fetchers(`fetchSoniox`/`fetchCartesia`/`fetchOpenai`)는 `{byDay}` 반환. Soniox 는 30일씩 잘라 최대 90일 backfill(31일 창 제한 준수), OpenAI 는 page 페이지네이션.
  - `refreshVendorUsage(90)`: 각 벤더 조회 → **저장소에 병합(덮어쓰기, 삭제 없음)** → persist. 에러 시 저장분 보존. 상태(configured/error)는 `vendorStatus` 메모리.
  - `GET /api/admin/vendor-usage?days=`(최대 365): 10분 초과 시 신선화(중복호출 1회만), 응답은 **저장소에서** 해당 범위 + `earliest`.
  - 부팅 8s 후 1회 + **12h 주기** 자동 갱신 → 관리자가 안 봐도 누적(서버 다운 91일↑ 아니면 공백 없음).
- **UI**: 기간 토글 7/30/90일, "자체 누적 — 보관기간 지나도 남음" 안내, "기록 시작일 …" 캡션.
- 검증: 90일 backfill(Soniox 17일·$1.36·389분·586건), `data/vendor_usage.json` 저장 확인, **191일 전 날짜 주입→재기동→365일 조회에 그대로 표시**(API 불가 데이터가 앱엔 잔존) 확인, 8/8 테스트.

## 2026-07-10 (2) — 데스크 2채널 이중입력·지도 UX 수정
- **이중 입력(양쪽 마이크 동시 인식)**: crossDup(유사도)만으로는 ①두 엔진 endpoint 가 5초 이상 벌어짐 ②6자 미만 짧은 발화 ③두 마이크 전사가 달라 매칭 실패 ④커밋 전 live 카드 이중 표시를 못 막았음.
  - **채널-언어 소유권**(1차 방어): 여객 마이크 on + 이중언어 응대에서 `staffOwns(src)`=손님 언어 발화는 데스크 채널이 버림 / `guestOwns(src)`=ko 발화는 여객 채널이 버림. 여객 채널에도 `gCurSrc`/`gLangVotes` 언어 감지 추가. **live 단계에서도** 소유권 위반이면 빈 페이로드(카드 제거)로 이중 표시 차단. 커밋 시에도 드랍(crossDrops 집계).
  - crossDup 강화(2차): 창 5s→8s, 최소 길이 6→4자. (손님이 한국어 고른 단일언어 응대는 언어 구분 불가 → crossDup 만)
- **지도 상단 플로팅**: `.item.map` → body 직속 `position:fixed; top:14px; z-index:70`. 새 발화에도 유지(collapseMapMini 제거), **10초 뒤 자동 닫힘**(mapHideTimer, 새 안내 시 리셋) + **아무 곳이나 탭하면 닫힘**. clearAll→removeMap(타이머 정리 포함).
- **경로 2개 중복**: 원인 = resolveCategoryDests 가 층의 매칭 시설 전부를 dests 로 반환 → 맵이 전 경로를 그림. ① 서버: 좌표(5px 격자) 중복 시설 dedupe ② 클라: 1차 showRoute 결과에서 최단(summary.meters) 후보를 골라 **그 하나만 재표시**.
- 검증(프리뷰): 지도 fixed/route 1개/새 발화 유지/탭 닫힘/10초 자동 닫힘 모두 통과, 데스크 시작→guest-mic on/off→종료 프로토콜 회귀 정상(서버 오류 0), 8/8 테스트. ⚠ 실제 이중 마이크 누화 억제 효과는 실기기(데스크+태블릿 동시)로 확인 필요.

## 2026-07-10 (3) — 언어 확장·데스크 자동감지·지도/절단 수정
- **실시간 번역 언어 60개**: `SONIOX_LANGS`(서버) — runSoniox `okL`·PTT 검증을 전체 지원 언어로 개방(기본 힌트는 L4 유지). 클라 `SX_LANGS`(한영일중 상단 + 가나다순 56개) — soniox 단방향 타깃·양방향 언어1/2 셀렉트에 적용(maxHeight 360 메뉴).
- **데스크 'Other languages' 자동 감지**: 터치 화면 = 영/일/중 3버튼 + 하단 넓은 대시 버튼 "Other languages — just speak"(`desk-start lang:'auto'`).
  - 서버: `autoDetect` 상태 — one_way(→ko)+광역 힌트(GUEST_LANGS)로 시작, `sxInfo {mode:'detect'}`. **첫 커밋의 감지 언어(src≠ko)로 two_way 재체결**(closeSx→connectSx, 여객 채널도 재연결), desk-active(lang)·meta 재브로드캐스트.
  - 뷰어: applySxInfo 에 detect 분기(터치 화면으로 쫓지 않음), svcPair "Detecting language…", LANGNAME 확장(es/fr/pt/ar/de/it/hi/tr/uk/pl/nl). 구 '+ More languages' 확장 패널 제거.
- **지도 top**: `top:calc(env(safe-area-inset-top)+14px)` — 노치 기기에서도 항상 화면 최상단.
- **발화 길이 강제 확정 제거**: SX_MAX(_CHARS) 200자 도달 시 강제 commit 하던 로직(runSoniox·데스크 staff/guest·PTT 4곳) 삭제 — 문장 중간 절단이 단어 오역·언어 오인식을 유발했음. 이제 endpoint(<end>)에서만 확정. (translate 파이프라인의 텍스트 스트리밍 MAX_BUF 는 별개로 유지)
- 검증: desk-start auto → meta detect→desk-active:auto→상태문구, 뷰어 Other 버튼→"Detecting language…" 화면, soniox 광역 힌트 연결 오류 0, 빌드에 60언어 포함, 8/8 테스트. ⚠ 감지→two_way 전환의 실발화 확인은 실기기 필요.

## 2026-07-10 (4) — 데스크 마이크 민감도 실시간 조절
- 고급 설정의 '마이크 음성인식 민감도' 슬라이더가 `disabled={recording}` 이라 **상시 캡처인 데스크에선 항상 비활성**이던 문제.
- audio.js: `gateTh` 를 let 으로, recorder API 에 `setMicSens(v)` 추가(볼륨 게이트만 실시간 조정, 연결 유지).
- TranslateView: 슬라이더 상시 활성 + onChange 에서 `recRef.current.setMicSens(v)` — 번역/캡처 중 즉시 적용(전 모드 공통).
- 검증: 데스크 세션 고급 설정에서 슬라이더 활성(Mui-disabled false) 확인, 빌드·8/8 테스트.

## 2026-07-10 (5) — 여객 마이크 조절·벤더 키 안내·유저별 사용량
- **여객 태블릿 마이크 민감도(호스트 조절)**: desk.html 근접 게이트 GM_GATE(고정 0.04) → `gmGate` 동적(50=기존값, 100=게이트 없음). 호스트 고급 설정에 슬라이더(kac-desk-guest-sens, 기본 50) → recorder `setGuestSens` → 서버 `desk-guest-sens` 메시지 → 뷰어 브로드캐스트. 초기값은 `deskGuestSens` 쿼리, 늦게 접속한 뷰어는 meta(guestSens)·ctrl.guestSens() 로 동기화.
- **'키 미설정' 원인 명확화**: TTS/GPT 동작용 일반 키(CARTESIA_API_KEY/OPENAI_API_KEY)와 **사용량 조회용 관리자 키**(CARTESIA_ADMIN_API_KEY=sk_car_admin_…/OPENAI_ADMIN_API_KEY=sk-admin-…)는 별개 — 벤더가 일반 키로는 usage API 를 허용하지 않음. 응답에 serviceKey 플래그 추가, 카드 문구로 구분 표시.
- **내부 집계 제거(UI)**: UsageChart·일별/시간별 토글·총사용시간/비용 카드 삭제 — 사용량 탭은 벤더 API 기반만. (서버 recordUsage 는 계정 관리의 사용자별 이용시간용으로 유지)
- **유저별 사용량(STT)**: Soniox WS config `client_reference_id: 'u:<userId>'`(공식 필드, usage-logs 에 기록) — runSoniox/데스크 staff·guest/PTT(세션 소유자) 태깅. usage-logs 집계에 byUser(일별) 추가, vendor-usage 응답에 기간 합산 users[]. Soniox 카드에 유저별 목록(미태깅 과거분='anon'). **Cartesia TTS 는 명세상 요청 태그 필드 없음 + usage 는 api_key 단위만 → 유저별 불가**, OpenAI costs 도 프로젝트/키 단위.
- 검증: vendor-usage users[anon] 집계, openai serviceKey 구분 문구, desk-guest-sens E2E(쿼리 초기값 30 → meta gs=30 → 변경 80 뷰어 전파), 내부 집계 UI 제거 확인, 8/8 테스트.

## 2026-07-10 (6) — 용어 설정 통합모델(v3) 전면 개편
- **데이터 모델 통합**: `termsConfig = { version:3, servedLangs, categoryScope, entries[] }`. 고유명사·번역쌍·alt 분리 폐지 → 평면 entries.
  - `entry = { id, category(airline|aviation|facility|etc), scope:['*']|['zh'..], names:{ko필수,en,ja,..}, mode }`
  - `mode`: **pair**(양방향 번역+인식) / **inputOnly**(외국어→ko 단방향, 약칭·오인식 교정) / **recognize**(인식 힌트만, 예 ICAO).
  - 구형(terms/translationTerms/alt) → entries 자동 마이그레이션(부팅 1회, seed 병합). 로드 지점(Mongo/파일/초기값) 전체 객체 보존하도록 수정.
- **약칭 단방향 확정**: 东航=`{airline, scope:[zh], names:{ko:중국동방항공, zh:东航}, inputOnly}` → zh→ko 만. 정식 표기는 한국어→중국어로 유지(충돌 없음). 오인식 교정(キチン室→흡연실)도 동일 inputOnly.
- **buildSonioxContext(langs, {desk})** entries 기반 재작성 — mode별 조립, scope 언어필터, **categoryScope로 데스크 시 aviation 제외**(항공용어 데스크 주입 안 함). **en→ko 폴백 제거**(명시 표기만). raw/한도방어 분리(buildSonioxContextRaw).
- **언어별 게이지**: 세션은 언어쌍 단위라 게이지를 운영 언어별(ko↔L)로 표시. 서버·클라 동일 규칙(contextSizeFor).
- **soniox 실검증 API** `POST /api/terms-config/validate`: 각 운영 언어쌍 context 로 soniox WS 열어 config 수락/거부 판정(오디오 미전송, 3s 타임아웃=수락), 언어별 pass/fail+bytes 반환. 글자수 추정의 부정확성(토큰≠글자) 보완.
- **필수 입력**: servedLangs(기본 ko/en/ja/zh) 미충족 entry = '미완성' 뱃지·필터. 폴백 없앴으므로 항공용어 pair(ko/en만)들이 미완성으로 노출(정상 — 채우거나 servedLangs 조정).
- **UI 전면 개편**(TermsConfigPage): 카테고리 탭+검색+미완성필터, 엔트리 카드(mode/scope/언어별 입력), 언어·적용대상 설정 다이얼로그(servedLangs 칩 + 카테고리별 데스크/일반 체크), 게이지+실검증(✓/✗), JSON 입출력, 오탈자검사 채택→entry. GET/PUT/api.js 갱신.
- 검증(프리뷰, 실 soniox): 기존데이터 마이그레이션 103 entries, 검증 API 3언어 ok(en 7048/ja 3841/zh 3568 bytes), 흡연실 inputOnly 저장→ja context +1 pair·+2 terms(단방향 확인), 데스크 ko↔zh 연결(항공용어 제외 context 수용, 오류 0), 8/8 테스트.

## 2026-07-10 (7) — 용어 설정 UI 단순화 (표 형태, 저장 시 자동검증)
- 사용자 피드백: v3 UI(엔트리 카드+mode/scope 드롭다운)가 복잡·중복. 키텀/번역쌍 구분은 유지, 실검증 버튼 제거→저장 시 자동.
- **화면 모델 재편**(TermsConfigPage 재작성, 서버 모델·API 는 그대로): UI 는 `행(용어)+키텀`, 저장/로드 시 entries 와 상호 변환.
  - `groupEntries()`: pair→행의 정식 명칭, inputOnly→같은 (category, ko) 행의 해당 언어 **약칭 칩**, recognize→키텀. `toEntries()` 는 역변환(약칭 칩=`inputOnly scope:[lang]` 자동).
  - **번역 용어 표**: 열=한국어+운영 외국어(그리드, 가로 스크롤). mode/scope 드롭다운 제거 — 칸을 채우면 양방향 쌍, 칸 아래 약칭 칩은 그 언어→ko 단방향. 약칭 추가는 행 hover 시 `+ 약칭` 칩(빈 행은 hover 시에만 노출돼 행 높이 압축).
  - **키텀(인식 전용)**: 표와 분리된 칩 목록 + Enter 입력.
  - 미완성 규칙 조정: 정식 외국어가 하나라도 있으면 운영 언어 전부 필수, **약칭만 있는 행(오인식 교정 전용)은 완성**으로 간주.
  - 오탈자검사 채택 → ko 일치 행을 찾아 해당 언어 약칭 칩으로 병합(없으면 새 행). 언어는 문자셋으로 감지.
- **저장 시 자동 soniox 검증**: 실검증 버튼 삭제. 저장(PUT) 성공 → `POST /api/terms-config/validate` 자동 호출 → 게이지 칩에 언어별 ✓/✗, 실패 언어는 경고 문구. JSON 업로드도 동일 흐름.
- 검증(프리뷰): 로드 시 약칭 그룹핑(日航/全日空/东航 등 칩 표시), 키텀 추가→저장→"저장 완료 · soniox 검증 통과"+✓ 아이콘, 삭제→재저장 라운드트립 정상, 빌드 OK.

## 2026-07-10 (8) — 데스크 context.general(공항 배경) 주입 → 저빈도 단어 인식 보정
- 문제: 喫煙室(きつえんしつ)를 STT 가 계속 キッチン室/実習室 등으로 오인식. 키텀 등록은 soft-bias 라 강제 못 하고, 데스크·실시간 경로는 Soniox 직번역이라 뒤에서 잡을 GPT 도 없음.
- Soniox context 4섹션 확인: `general`(=[{key,value}])·`text`·`terms`·`translation_terms`. `general` 로 "이 자리가 어떤 상황인지" 배경을 주면 저빈도·동음이의 인식이 개선됨.
- **`DESK_GENERAL_CONTEXT`**(server.js, buildSonioxContextRaw 위) 상수 추가 — location=Airport information desk, airport=Gimpo International Airport, facilities=smoking room(喫煙室/きつえんしつ 병기), restroom, currency exchange, convenience store, subway station, boarding gate. 영어로 작성, 흡연실만 일본어 병기.
- `buildSonioxContextRaw` 에서 **`opts.desk` 일 때만** `ctx.general` 주입(일반세션·실시간엔 미주입). 한도 방어 루프는 translation_terms→terms 만 잘라 general 은 보존.
- 검증: 실제 soniox WS 에 general 포함 데스크 config 전송 → ACCEPTED(수락). 서버 부팅 정상.
- 편집하려면 server.js 의 DESK_GENERAL_CONTEXT 배열 수정(현재 코드 상수, 필요 시 termsConfig 로 승격해 UI 편집 가능하게 할 수 있음).

## 2026-07-10 (9) — 데스크 2채널: 채널별 언어 고정 (one_way×2)
- 배경: two_way 는 "한 스트림에 두 언어가 섞이는데 누가 말했는지 모를 때"의 도구. 2채널(호스트 마이크+여객 태블릿 마이크)은 기기=채널로 화자가 물리적으로 확정 → 언어 자동판별(확률)을 쓸 이유가 없음. soniox 는 토큰에 채널 식별자를 안 주므로 "한 세션에 두 기기 믹싱"은 화자 귀속 소실+동시발화 붕괴라 불가(검토 결론).
- **configFor()** (runDesk): `lockedB && guestMicOn` 이면 호스트 채널을 `one_way(ko→손님 언어) + language_hints:[ko]` 로 고정. 여객 채널(gsx)은 원래 one_way(손님 언어→ko, 힌트 손님 언어) → **one_way×2 로 양방향 커버, 방향 뒤집힘 구조적 소멸 + 힌트 집중으로 인식 향상**. 단일 마이크 폴백(여객 마이크 off)은 two_way 유지.
- **guestMic() 토글**: 응대 중 여객 마이크 on/off 로 모드가 바뀌면 `commit() → closeSx() → connectSx()` 로 호스트 세션 재체결(진행 중 발화는 커밋해 유실 방지). 상태 메시지에 "채널별 언어 고정, 단방향×2" 명시.
- 자동 감지(Other languages) 흐름은 그대로 — 감지 완료 시 connectSx() 가 configFor() 를 다시 읽으므로 2채널이면 자연히 one_way 로 체결됨. 세션 수·비용은 기존 2채널과 동일(세션 2개, type 만 변경).
- staffOwns/guestOwns·crossDup 누화 방어는 유지(one_way 라도 언어식별은 돌아서 새어 들어온 반대 언어 발화를 여전히 걸러 줌).
- 검증: 실제 soniox 에 host one_way(ko→ja, 힌트 ko)·guest one_way(ja→ko, 힌트 ja) 각각 전송 → 둘 다 ACCEPTED. 서버 부팅 오류 0. **실 음성 2기기 테스트는 사용자 확인 필요.**

## 2026-07-12 — UI 전면 개편(Slack 계열) + 용어 UI 단순화(쉼표 병기) + 코드 리뷰 수정 일괄
### 용어 설정 UI 재단순화 (사용자 피드백: hover 약칭 칩 복잡)
- **쉼표 병기 모델**: 약칭 칩·hover UI 전부 제거. 각 언어 칸에 `정식명, 약칭1, 약칭2` 로 입력 —
  첫 표기=pair(양방향), 나머지=inputOnly(그 언어→ko 단방향) 로 저장 시 자동 변환(toEntries/groupEntries, splitCell 은 ,、， 모두 인식).
  예: ja `日本航空, 日航, JAL` / zh `中国东方航空, 东航`. 서버 모델은 그대로.
- 명칭: 키텀→**주요 용어**, 번역 용어→**번역 설정**. 회색 안내문구는 (i) 툴팁(InfoTip)으로 숨김.
- 저장 안전장치: ① 같은 카테고리·같은 ko 중복 행 저장 차단(병합 유실 방지) ② 미완성 행은 저장에서 제외하되 화면에 남김(소리 없는 소멸 방지)
  ③ 저장 중 편집하면 서버 스냅샷으로 덮지 않음(editGen 카운터) ④ 오탈자검사 lang 필드(서버 프롬프트에 추가) 우선 사용 — 한자만 일본어의 zh 오판 방지.
- 참고: 구 테스트 행 '섬에어'(ko만 있던 미완성)는 과거 저장에서 소실된 상태였음 — ②로 재발 방지.
### UI 전면 개편 (Slack 계열: 플랫·크리스프·다크 사이드바) — React 앱 전체
- theme.js 재작성: shape 8(전역 radius 축소), 플랫 버튼(그라데이션·글로우 제거), Slack 그린/레드 계열 시맨틱 컬러,
  다크 툴팁, 카드=1px 보더+무그림자, `SIDEBAR` 토큰 export.
- Nav.jsx: **다크 사이드바**(라이트/다크 공통 딥 바이올렛 차콜) — 활성 항목 흰 필, hover 흰 7%, 로고·프로필 화이트 타이포.
- Login.jsx: 로고+워드마크 중심, outlined 카드. 라이트/다크 모두 프리뷰 확인.
### 벤더 사용량·데스크 통계
- OpenAI 429 대응: `vendorFetch`(429 시 Retry-After 재시도) 전 벤더 적용, costs limit=기간 전체(페이지네이션 제거),
  12h 타이머·라우트 갱신을 `kickVendorRefresh` 단일 가드로 통일(동시 실행 금지).
- 차트 정렬: 서버가 세 벤더의 일자 축을 동일하게 채움(빈 날 0, 흐린 점) + 카드 보조문구 줄 상시 렌더 → 막대 기준선 1:1.
  라벨은 최대 ~10개만(90일 겹침 방지). 조회 실패 시 저장분은 계속 표시(+갱신 실패 칩).
- 데스크 통계: 데스크별 카드 나열 → **셀렉터로 1개만 표출**.
- fetchSoniox 30일 청크 경계에 걸친 날짜 부분합 유실 → 합산 병합으로 수정(누적 데이터 정확성).
### 코드 리뷰(서브에이전트 3, 발견 29건) → 수정 반영
- 서버: ① 뷰어 PTT 서버측 강제(viewerPTT 조건 미검증 → 무인증 과금·타세션 주입 차단) ② translate/deepgram ready 미리셋+무상한 pending → close 시 리셋+상한 400
  ③ desk sx/gsx close 시 ready 리셋(재연결 창 오디오 유실) ④ context 한도 방어 청크화(대용량 업로드 시 미절단·이벤트루프 블로킹)
  ⑤ takeover 시 진행 중 응대 items 를 '중단된 응대(interrupted)'로 deskLog 보존+뷰어 리셋 ⑥ 데스크 사용량=active 시간만(대기 8시간이 과금 집계되던 문제)
  ⑦ upgrade 핸들러 try/catch+socket.destroy(FD 누수) ⑧ endConversation 중 autoDetect 분기 차단.
- 클라: audio.js `stopped` TDZ(모두 모드 초기 메시지 크래시), 시작 실패 시 마이크/AudioContext 정리(핫마이크 누수), 재연결 시 제어상태(tts/mute/guestSens) 재전송,
  AdminPage 로그 열림·기간 토글 stale 응답 가드, 벤더 조회 실패 시 로딩 고착 해소.
- desk.html: WS onclose 최신 소켓 가드(고아 소켓·여객 오디오 중단), removeMap 에서 `mapApi.destroy()`(rAF 누수 — 응대마다 누적되던 CPU/발열),
  지도 에셋 실패 시 빈 카드 미표시, setGuestSens NaN 방어.
- mobile.html: PTT 권한 대기 중 상태 변경 시 시작 취소(끌 수 없는 핫마이크), 복귀 시 actx.resume+outCursor 리셋(밀린 TTS 몰아 재생), JSON.parse 방어, loadSession 실패 5초 재시도.
- **수정 보류(알려진 리스크)**: Mongo 디바운스 flush ↔ deleteOne 순서 미보장(삭제 항목 부활 가능, 타이밍 의존 희귀) / mobile 지도 rAF 는 인스턴스 재사용이라 누수 1개 고정(영향 미미).
- 검증: 빌드 OK, 서버 부팅 오류 0, 용어 쉼표 왕복(东航+东方航空 추가→pair+inputOnly×2 확인→원복) + 저장 시 soniox 자동 검증 통과, 라이트/다크 프리뷰 스크린샷 확인.

## 2026-07-12 (2) — AirTalk 개명 · 데스크 운영통계 v2 · 로그 관리 · 용어 완성 등 13건
- **개명**: KAC Translator → **AirTalk** (index/mobile/overlay title, Nav 로고, Login, 2FA issuer, 서버 콘솔). 로고의 "실시간 음성 번역" 서브타이틀 제거.
- **OpenAI 사용량 429 후속 버그**: costs API 의 `amount.value` 가 문자열 → reduce 합계가 문자열이 돼 `.toFixed is not a function` 크래시. `Number()` 강제.
- **관리자 정리**: 사용량 탭의 사용자/총 세션 카드 제거, 데스크 통계의 총 응대/데스크 수/평균 시간 카드 제거. 뷰어 랜딩 "0명 시청 중" 제거.
- **데스크 운영 통계 v2** (`/api/admin/desk-stats`): 시범운영 보고서용 — 응대건수(중단 포함)·평균/중앙값 응대시간·응대당 평균 문장(안내원/손님 분리)·
  누화 드랍율·길안내 감지→표시율·상위 시설, 일별(30d)·시간대(24h) 분포, 언어별 상세(count/avgMs/avgSent), **응대 원자료 rows(최근 500) + CSV 내려받기**(BOM, 엑셀 호환).
  UI 셀렉터는 네이티브 `<select>` 로 교체(MUI Select 클릭 불가 문제).
- **로그 관리**: DELETE `/api/admin/logs/desk/:sid/:idx`(응대 1건) · `/desk/:sid`(전체+wayfindLog) · `/session/:id`(대화 기록만, 세션 유지). 로그 탭에 행 hover 삭제·데스크 전체 삭제·세션 대화 삭제 버튼(confirm).
- **2채널 동시발화 이중 표출 방어 강화**: crossDup 이 원문뿐 아니라 **번역문까지 교차 대조** — 한 발화가 양쪽 마이크에 들어가 언어 판별이 엇갈려도
  "여객 채널 ko 번역 ↔ 데스크 채널 ko 원문" 유사로 걸림. 기존 방어: ①언어 소유권(staffOwns/guestOwns) ②근접 게이트 ③crossDup. **실 음성 2기기 검증 필요.**
- **용어 폴백 보장**: 한·영·일 외 언어(중국어 미입력 포함, es/fr/ru 등 전부)는 표기가 비면 **영어 표기로 폴백**해 pair/terms 에 주입(buildSonioxContextRaw nameFor, 클라 게이지 미러 동일). 약칭(inputOnly)은 폴백 없음.
- **용어 데이터 완성**: 항공용어 30개 ja/zh 전부 채움(駐機場/停机坪, 搭乗口/登机口 등), 에어로케이 zh=Aero K, 타이에어아시아엑스 zh=泰国亚洲航空长途, **섬에어 재등록**(en/zh=Sum Air, ja=サムエア). 잔여 미완성 pair 0. 검증 API 3언어 통과(en 7,022/ja 6,249/zh 5,967).
- **TTS 샘플 스크립트**: `scripts/gen_tts_samples.mjs` — en/ja/zh/ru/es('라틴어'→라틴어권 스페인어로 해석) 테스트 문장을 Cartesia mp3 로 `tts_samples/<lang>/` 에 생성.
  **로컬 .env 에 CARTESIA_API_KEY 없어 미실행** — 키 있는 환경에서 `CARTESIA_API_KEY=... node scripts/gen_tts_samples.mjs`.
- 검증: 빌드·테스트(fail 0)·부팅 OK, desk-stats v2 응답 필드 확인, 삭제 API 404 방어 확인, es 폴백(대한항공→Korean Air) 확인, AirTalk 라이트/다크 프리뷰 확인.

## 2026-07-12 (3) — 통계·목록 UI 다듬기 + 용어 Mongo 병합 + TTS 샘플 등 18건
- **용어가 안 채워져 보이던 원인**: 로컬 .env 에 MONGODB_URI 가 있어 서버는 **Mongo**에서 용어를 읽는데, 이전 작업이 data/terms_config.json **파일만** 수정했음.
  → **부팅 시 코드 레벨 병합**(`TERM_FILL`/`TERM_FILL_ADD`, 멱등): 표의 한국어 용어에서 en/ja/zh 빈 칸을 채움. Mongo 에 64칸 채워짐 + 섬에어(ko만 있던 기존 항목) 완성. 미완성 pair 0.
- **OpenAI 429 후속**은 이전 커밋에서 수정(문자열 합계). **벤더 사용량 속도**: 조회가 갱신을 기다리지 않고 저장분 즉시 반환, 갱신은 백그라운드(빈 저장소일 때만 1회 대기).
- **벤더 실사용량 UI**: 기본 기간 7일(토글과 일치), 설명 문구 삭제, 유저별 사용량은 인원수 표기+고정 높이 스크롤 목록(다수 유저 대응).
- **데스크 운영 통계 UI**: 제목을 박스 안으로(벤더 카드와 통일), 셀렉터에 **전체**(클라 합산 aggregateDeskStats), '일별 응대 추이'→**기간별 통계**(7/30/90일/전체 × 일별/월별, 기본 7일·일별, 빈 날 0 채움 — 서버 daily 상한 제거),
  시간대별(좌)+언어별(우) 1열 배치(언어별은 건수 막대그래프), CSV 는 아이콘만(전체 선택 시 desk 열 포함), 누화 드랍율 (i) 툴팁.
- **세션 목록(실시간 번역·데스크 안내)**: ① 一括 선택 모드(선택 버튼 → 체크박스+n개 선택+일괄 삭제, Promise.allSettled) ② 데스크톱 hover 인라인 액션(제목변경/대화내역저장/삭제 — 슬랙 스타일), 모바일은 케밥 유지 ③ 모바일 빈 툴바 줄 제거(제목-목록 간격 축소, FAB 유지).
- **Cartesia reference id 검토(#15)**: TTS bytes API 요청 본문은 model_id/transcript/voice/language/output_format/pronunciation_dict_id/generation_config 만 허용 — **유저 태깅 필드 없음**(헤더도 없음). 유저별 TTS 집계가 필요하면 서버 내부 집계(문자수/호출수)로만 가능.
- **Mongo 보안 검토(#16)**: mongodb+srv(TLS 기본) + URI 에 user:pass 자격증명 포함 — "URL만 있으면 접근"은 URI 자체가 자격증명이기 때문(표준 방식). .env 는 gitignore, 실제 URI 커밋 이력 없음(.env.example 은 placeholder).
  권고: ① Atlas Network Access 를 Render egress IP 로 제한(0.0.0.0/0 금지) ② DB 사용자 최소권한(readWrite@해당DB) ③ 유출 의심 시 비밀번호 교체 ④ Mongo 문서는 앱 레벨 평문(DATA_KEY 암호화는 파일 모드 전용) — 민감 필드 암호화는 필요 시 별도 작업.
- **TTS 샘플 생성 완료(#17)**: `tts_samples/{en,ja,zh,ru,es}/<lang>_{female,male}.mp3` 10개 (Cartesia sonic-3.5, 미리듣기 문장. '라틴어'→스페인어 해석).
- 검증: 부팅 병합 로그(64칸), 미완성 pair 0, 사용량 탭·데스크 통계·세션 목록(호버 액션/선택 모드/모바일 간격) 프리뷰 확인, 빌드 OK.

## 2026-07-12 (4) — UI 개선 2차: ⌘K 팔레트·확인 다이얼로그 통일·빈 상태·세션 헤더
- **⌘K/Ctrl+K 명령 팔레트**(CommandPalette.jsx, App 전역 키 리스너): 세션 검색(제목)·이동 + 화면 이동 액션(실시간 번역/데스크 안내/관리자/새 세션 만들기 — createSignal 로 SessionList 생성 모달 오픈). 방향키/Enter/ESC, 최근 8개 세션.
- **confirm()/alert() 전면 교체**(ConfirmDialog.jsx 공용): SessionList 삭제·일괄 삭제, AdminPage 로그 3종 삭제·사용자 삭제 → MUI 다이얼로그(+실패는 Snackbar). TranslateView alert 2곳(미리듣기 실패·시작 실패) → 기존 인앱 notice 배너.
- **빈 상태 개선**(EmptyHint): 데스크 운영 통계·응대 로그가 비었을 때 아이콘+다음 행동 안내("데스크 안내에서 세션을 만들면…").
- **세션 화면 헤더 겹침 수정**(TranslateView): 제목 행에 overflow hidden — 좁은 폭에서 모드 칩이 우측 버튼 밑으로 겹쳐 보이던 문제. 칩은 md 미만에서 숨김.
- 검증(프리뷰): ⌘K 열기→검색→관리자 이동, 삭제 클릭→MUI 확인 다이얼로그(취소 동작), 헤더 겹침 해소, 빌드 OK. (참고: 시뮬레이션 키입력의 한글 IME 조합 artefact 로 Enter 실행이 지연돼 보였으나 클릭·실사용 경로 정상)
- 남은 제안: 데스크 뷰어(desk.html) 브랜드 정합은 현장 검증 필요로 보류 유지.

## 2026-07-12 (5) — 사이드바 남색 제거 → 테마 추종(Claude 앱 스타일)
- 사용자 피드백: 남색 고정 사이드바 폐기. 라이트 테마=사이드바도 밝게, 다크 테마=어둡게(Claude 앱처럼).
- theme.js `SIDEBAR` 를 모드별 토큰으로 재구성: light(웜 그레이 #f6f5f4, 다크 텍스트, 회색 활성 필, 우측 보더) / dark(콘텐츠보다 어두운 #121116, 밝은 텍스트). Nav.jsx 는 `SIDEBAR[mode]` 로 소비(하드코딩 #fff 제거, NavItem 에 S 전달).
- 검증: 라이트/다크 프리뷰 스크린샷 모두 확인, 빌드 OK.
