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

## 2026-07-12 (6) — ⌘K 크기 고정 · 데스크 무음 종료 설정 라이브 변경
- **⌘K 팔레트 크기 고정**: 결과 리스트 maxHeight→height 360 — 검색 결과 수에 따라 늘었다 줄었다 하지 않음(빈 결과도 동일 크기, 프리뷰 418px 유지 확인).
- **데스크 '세션 자동중지(무음)' 설정 disabled 해제**: 데스크는 진입 즉시 상시 캡처(recording=true)라 `disabled={recording}` 으로는 영영 변경 불가였음 →
  서버 `desk-idle` 메시지 추가(deskIdleMs const→let, 수신 시 5초~120초 클램프 + 진행 중이면 armForeignTimer 재장전 + 상태 안내),
  audio.js `setDeskIdle(ms)`, TranslateView 는 disabled 제거하고 변경 즉시 localStorage + 라이브 전송. desk-guest-sens 와 동일 패턴.

## 2026-07-12 (7) — Claude 앱 팔레트 정밀 적용 · Nav 다듬기 · 새 로고
- **Claude 팔레트와 동일 톤**(웜 뉴트럴): 라이트 bg `#FAF9F5`/paper `#FFF`/사이드바 `#F5F4EE`, 다크 bg `#262624`/paper `#30302E`/사이드바 `#1F1E1D`, 텍스트 `#1F1E1D`↔`#FAF9F5`. 포인트 컬러(바이올렛)는 AirTalk 아이덴티티로 유지(테라코타로 바꾸려면 theme.js ACCENT 만 교체).
- Nav: 로고 하단 "메뉴" 라벨 삭제, 메뉴 항목·프로필·프로필 팝오버 메뉴 폰트 13.
- **새 로고**(favicon.svg): 말풍선 안 음성 파형 — '음성 대화 번역'을 한 형태로. 바이올렛 그라데이션 라운드 스퀘어(rx18). 탭 아이콘·Nav·로그인 공용.
- 검증: 라이트/다크 프리뷰 스크린샷, 빌드 OK.

## 2026-07-12 (8) — FAQ 분석·용어 적중·정형 멘트 · 뷰어 길안내 상단 · 오프라인 배너 · TTS 검증
### UI
- **Nav 아이콘 교체**: 지구본(실시간 번역)/헤드셋(데스크 안내)/슬라이더(관리자) — 얇은 스트로크 커스텀 SVG(Nav.jsx export, CommandPalette 공용).
- **라이트 색 반전**: 사이드바 #FAF9F5(거의 백색) ↔ 콘텐츠 캔버스 #F5F4EE(카드 #FFF). 다크는 기존(사이드바 #1F1E1D < 콘텐츠 #262624) 유지.
- **뷰어(mobile.html) 길안내 상단 고정**: 원인 — desk.html 만 상단 플로팅이고 뷰어는 피드 하단 인라인이었음. `.mapCard` fixed top(12px)+z60 으로 변경,
  10초 자동 닫힘 + **화면 아무 곳 탭 닫힘**(document click capture, 오픈 후 300ms 등록) + removeMap 이 mapApi.destroy()(rAF 누수도 해결) + clearAll 연동.
  desk.html 도 지도만이 아니라 화면 아무 곳 탭으로 닫히게 통일. 다음 발화로는 닫히지 않음(fixed 오버레이 — 닫는 경로는 탭/10초/응대 종료뿐).
  프리뷰 실검증: mapCard top=12px·fixed·피드 밖, 탭 → 닫힘.
### 기능
- **자주 묻는 질문**(사용량 탭 하단 FaqPanel): POST `/api/admin/faq-analyze` — 데스크 응대 손님 발화(ko 번역, 최근 400) GPT 클러스터링 →
  {topics:[{topic,count,examples}]} 저장(faqReport, Mongo faqReport/파일 faq_report.json) · GET `/api/admin/faq-report`. 실검증: 160건 → "화장실 위치 문의 9건" 등.
- **용어 적중 분석**(용어 설정 탭 TermsHitPanel): GET `/api/admin/terms-hit` — 전 대화 코퍼스(응대+세션, source+texts) 문자열 매칭, ko 기준 병합,
  적중 상위 20 + 0회 필터(정리 후보). GPT 미사용. 실검증: 코퍼스 2,879줄, 터미널 66회, 0회 69개.
- **정형 안내 멘트 설정창**(관리자 새 탭 '정형 안내'): GET `/api/canned`(로그인)/PUT(관리자) — items[{id,title,texts:{ko,en,ja,zh}}] ≤50,
  ko·제목 필수, Mongo canned/파일 canned.json. CRUD UI(제목+4언어 멀티라인). **데스크 원터치 재생 버튼 연결은 다음 단계.** 실검증: 저장·조회 왕복.
- **오프라인 안내 배너**: React App(전역 온라인/오프라인 리스너, 상단 주황 배너) + desk.html/mobile.html(#netBanner) — 연결 복구 시 자동 숨김(WS 재연결이 이어받음).
### TTS 음성 검증
- `scripts/verify_tts_samples.mjs`: tts_samples mp3 → **Soniox 비동기 전사 API**(stt-async-preview, mp3 직접 업로드 — ffmpeg 불필요) → CER(≤10% PASS) →
  `tts_samples/VERIFICATION.md` 리포트. **결과 10/10 PASS** (en/ja/zh/ru 0%, es 4.2%: esta→esto 경미 오인식).

## 2026-07-12 (9) — 데스크 자동감지 정리 · 데스크 세션 관리자 전용 · 소프트 삭제 · Claude 스타일 목록·검색·최근 항목 · 뉴트럴 테마
### 데스크(Other languages) 자동감지 — 2줄 중복 수정 + 여객 채널 감지
- 증상: 'Other languages' 시작 시 같은 발화가 두 채널(데스크 sx + 여객 gsx)에 동시에 라이브 표시(2줄)됐다가 커밋에서 crossDup 로 합쳐짐.
- 수정(server.js runDesk): ① `staffOwns/guestOwns` 에 autoDetect 케이스 추가 — 감지 중에도 '외국어=여객 채널, 한국어=데스크 채널' 소유권 적용(라이브 이중 표시 소멸).
  ② 감지→잠금을 `lockDetected(src)` 로 분리, **staff commit + guestCommit 양쪽에서 호출**(드랍 판정과 무관하게 언어부터 잠금 — 이전엔 데스크 채널 커밋에서만 감지).
  ③ 여객 채널 자동감지 중 힌트 광역화(`autoDetect ? GUEST_LANGS : [A]` — ko 고정이면 감지 불가였음).
- 감지 후 재체결은 기존 로직(2채널이면 one_way×2, 단일이면 two_way) 재사용. desk.html 은 두 번째 desk-active 수신 시 curLang 갱신 처리 이미 있음(482행 가드).
- 실 음성 검증은 현장 몫(엔진 왕복 필요). 코드 경로는 소유권·재체결 모두 기존 잠금 모드와 동일 분기라 회귀 위험 낮음.
### 데스크 세션 = 관리자 전용 관리(공용 인프라)
- POST/DELETE `/api/sessions` — pipeline=desk 는 admin 만(403 한글 메시지). PATCH 는 desk 면 전 직원 허용(층/방향 등 운영 조작), 단 title 변경은 admin 만(비관리자 body 에서 strip).
- GET `/api/sessions` — desk 세션은 **모든 로그인 사용자에게 노출**(직원이 운영), 일반 세션은 본인 것만(기존 유지).
- 클라(SessionList): `canManage = !deskMode || isAdmin` — 비관리자 데스크 화면에서 새 세션/FAB/선택(일괄 삭제)/행 삭제·제목변경/케밥 항목 숨김. 빈 상태 문구 분기.
- curl 실검증: staff 생성 403, staff 목록에 desk 노출, staff 삭제 403, staff PATCH deskFloor OK + title 무시.
### 세션 소프트 삭제(로그 보존)
- DELETE = `deletedAt` 마킹(splice/스토어 삭제 제거). `getSession` 은 삭제분 제외(뷰어 404·WS·PATCH 차단), 관리자 로그/통계용 `getSessionAny` 분리.
- 목록·`/api/desk-sessions` 제외, 관리자 로그·데스크 통계에는 계속 포함 + `deleted` 플래그(UI '삭제된 세션' 표기, 통계 셀렉터 '(삭제됨)').
- **완전 정리 경로**: 관리자 로그 삭제 라우트(`DELETE /api/admin/logs/desk/:sid`, `/session/:id`)가 소프트 삭제된 세션이면 껍데기까지 제거(purgeIfDeleted, 스토어 포함).
- curl 실검증: 삭제 후 본인 목록 제외·뷰어 404·admin logs deleted:true, 로그 삭제 시 통계에서 완전 소멸. 삭제 confirm 문구도 "기록은 관리자 로그에 보존"으로 정정.
### UI — Claude 스타일 마무리
- **다크 반전**: nav `#262624` ↔ 캔버스 `#1F1E1D`(카드 #30302E) — 라이트와 동일하게 'nav 가 항상 콘텐츠보다 밝게'. theme.js SIDEBAR.dark + bgDefault 교체.
- **보라 폐기(로고 제외)**: primary = 뉴트럴 반전(라이트 `#1F1E1D` 검정 버튼/백색 글자, 다크 `#FAF9F5` 백색 버튼/검정 글자, hover #3d3b38/#e8e6df).
  Nav 아바타 그라데이션→primary 뉴트럴, 모바일 AppBar 로고 박스→favicon.svg(로고만 바이올렛 유지). GRAD 토큰 삭제.
- **세션 목록**: 카드→플랫 행(제목 flex·유형 텍스트·일자만, 모드 아이콘 삭제), hover 하이라이트, hover 액션은 **우측 오버레이**(absolute + paper 필 —
  안 보일 때 자리 차지해 제목이 69px 로 짜부라지던 문제 → 169px). 페이지 제목 24px·탑마진 축소. 버튼 폰트 14 고정(theme).
- **검색**: 목록 상단 검색바(돋보기, radius 20) → `GET /api/sessions?q=` 서버 검색(제목 + items/deskLog 의 source·texts, 250ms 디바운스). 검색 빈 결과 전용 문구.
  실검증: '탑승'(내용에만 존재) → 해당 세션 1건 필터, 소유권 격리 유지(타 유저 세션 미노출).
- **Nav 최근 항목**: 메뉴 아래 '최근 항목' 최근 세션 8개(view/세션 변경 시 재조회, 클릭 → 해당 화면으로 열기·활성 표시), 펼침 폭 248→288(모바일 드로어 300).
- 프리뷰 실검증: 라이트/다크 스크린샷, 최근 항목 클릭→데스크 세션 열림, 검색 필터, 오버레이 액션 opacity/absolute 확인.

## 2026-07-13 (10) — 추임새(간투사) 제거 · 데스크톱 앱 웹 다운로드(프로필 메뉴 → 모달 → exe)
### 추임새(간투사) 제거 — server.js stripFillers()
- 실시간 STT 가 잡는 무의미 간투사를 인식 확정(commit) 시점에 원문·번역문 공통 제거. 라이브(비확정)는 두고 확정 때만(깜빡임 방지).
- 2단계: ① 순수 잡음(항상 제거) `um/uh/hmm/mm/erm·음/어/으음·えっと/えー/あー/うー/んー·嗯/呃/唔` — 발화 전체가 이것뿐이면 카드째 드랍.
  ② 소프트 간투사(내용이 남을 때만) `yeah/yep/yup/y'know` — 단독 "Yeah"(=네) 답변은 보존.
- 오작동 회피: 영어 'well'(실단어)·한국어 조사 '에'는 제외. 단어경계·한글 인접(lookbehind/ahead)로 정상어(음악·어디·album·hummingbird) 보존.
- 적용: soniox commit / desk staff·guest commit / translate finalize(+spacingPolish 결과). 유닛테스트 17종 통과.
### 데스크톱 앱 웹 다운로드 (프로필 → '데스크톱 앱' 모달 → 설치 exe)
- 기존 `desktop/`(Electron 통합 앱: 웹앱 래핑 + 줌 오버레이 자막)을 웹에서 바로 내려받게 연결. 사용자 결정: **GitHub Releases + CI 빌드**, **모든 로그인 사용자 노출**.
- 서버(server.js):
  - `fetchLatestDesktop()` — GitHub `/releases?per_page=20` 목록에서 설치본(.exe→.dmg→.zip) 있는 첫 릴리스 선택(무관 태그 릴리스 섞여도 OK), 10분 캐시.
  - `GET /api/desktop/info`(requireAuth) — available/version/filename/size/platform/reason.
  - `GET /download/desktop`(requireAuth) — env URL 있으면 리다이렉트 / 공개+토큰없음이면 browser_download_url 리다이렉트 /
    **비공개면 서버가 GITHUB_TOKEN 으로 에셋을 받아 스트리밍**(사용자 GitHub 인증 불필요, `Readable.fromWeb` 파이프).
  - env: `GITHUB_TOKEN`(Contents read), `DESKTOP_REPO`(기본 papimon33/translate), `DESKTOP_DOWNLOAD_URL`(사내·S3 직결). .env.example 반영.
- 클라: Nav 프로필 메뉴에 **'데스크톱 앱'**(모든 사용자) → `DesktopAppDialog`(기능 3종·설치 3단계·버전/크기 칩·다운로드 버튼). api.desktopInfo().
  - 버튼: available 이면 `<a href="/download/desktop">`(같은 창 attachment 다운로드), 미배포면 '준비 중' 비활성 + 안내(Alert).
- CI: `.github/workflows/desktop-build.yml` — windows-latest, `npm ci`+`electron-builder --win nsis`, desktop/package.json 버전으로
  `desktop-v<ver>` Release 생성/에셋 교체(gh CLI). workflow_dispatch + `desktop-v*` 태그 트리거. 새 버전은 package.json version 올리고 수동 실행.
- 프리뷰 실검증: 프로필 메뉴 '데스크톱 앱' 표시, 모달 렌더, 준비중(no-release) 비활성 + info=available:false, /download/desktop 404, 미인증 401,
  fetch 목으로 available 상태 → 다운로드 앵커 href=/download/desktop·버전 칩·"Windows · KAC-Translator-Setup-1.0.0.exe · 81 MB" 확인.
- 남은 일(사용자): 최초 릴리스 발행 — Actions 에서 Desktop Build 1회 실행. 비공개 repo 유지 시 Render env 에 GITHUB_TOKEN 설정 필요.

## 2026-07-13 (11) — 마이크 게이트 RMS화 · 세션 …메뉴(내역/세션 삭제) · 데스크톱 mac · 라이트 배경 흰색화
### 마이크 민감도 게이트 — peak→RMS
- 문제: 게이트가 peak(순간 최대)로 열려 속삭임의 자음 스파이크(ㅅ·ㅌ)에도 열림 → 속삭임이 그대로 인식. 또 기본 100은 게이트 자체가 off(`v<100`일 때만).
- audio.js: 게이트 판정을 RMS(프레임 평균 음량)로 변경(rms 계산 후 onMeter·게이트 공용). sensToGate 범위 0.08→0.05(RMS 스케일). 300ms hold 유지.
- TranslateView: 기본 micSens 100→**70**(미저장 기기), 힌트 문구 갱신("속삭임 잡히면 더 낮추고, 작게 말하는데 끊기면 높이세요"). 저장값 있으면 유지.
- 실오디오 검증은 현장 몫(프리뷰 마이크 차단). RMS 임계 대략: 보통대화 0.03~0.1 통과 / 속삭임 0.005~0.02·실내소음 차단.
### 세션 헤더 '…' 메뉴 (연필 대체)
- TranslateView 제목 옆 연필 IconButton → MoreVert '…' → Menu: **세션 이름 수정 / 대화 내역 삭제 / 세션 삭제**(비desk 한정, 기존 연필 조건 유지).
- 대화 내역 삭제: **신규 서버 라우트 `DELETE /api/sessions/:id/items`**(requireAuth, 본인/관리자·desk는 관리자만) — items 비우고 `broadcast snapshot:[]`로 뷰어 화면도 초기화. setMessages([]).
- 세션 삭제: 기존 소프트 삭제(api.remove) → onBack(). ConfirmDialog + Snackbar(성공/실패). api.clearItems 추가.
- 검증: 임시 세션 clear→{ok,deleted:0}, 미인증 401, 메뉴 3항목 렌더 확인(실데이터 미삭제).
### 데스크톱 앱 macOS
- 서버 fetchLatestDesktop 이 win(.exe)·mac(.dmg) 에셋 각각 반환, `/download/desktop?platform=win|mac` 분기(비공개=토큰 스트리밍/공개=리다이렉트).
- DesktopAppDialog: 사용자 OS 감지(navigator) → 주 버튼(내 OS)+보조 링크(다른 OS), macOS 미서명 안내. desktop/package.json mac 타깃 universal 단일 dmg + identity:null.
- **워크플로 main.yml 에 macos 빌드 잡 추가는 사용자 몫**(토큰 workflow 스코프로 서버측 푸시 불가) — 매트릭스(win/mac)+release 잡 분리 안 전달함.
- Windows 빌드/릴리스는 이미 라이브(desktop-v1.0.0, exe 81.9MB, /download?platform=win 302→200 확인).
### 라이트 배경 흰색화
- theme.js: 라이트 캔버스 #F5F4EE→**#FAFAF8**(거의 흰색), nav #FAF9F5→**#FFF**(카드와 함께 최상단 밝기). 다크 불변. nav≥content 밝기 순서 유지.

## 2026-07-13 (12) — 마이크 게이트 무력화 원인: 브라우저 AGC(자동 게인)
- 증상: 민감도를 1까지 낮춰도 속삭임·작은 목소리가 전부 인식됨(RMS 게이트 전환 후에도).
- 원인: getUserMedia 에 `autoGainControl` 미지정 → 기본 on. 크롬 AGC 가 속삭임·먼 소리를 보통 음량으로
  **증폭한 뒤** 게이트에 도달 — 음량 차이가 이미 지워져 임계가 무의미했다.
- 수정:
  · audio.js(호스트 마이크): 게이트 사용(민감도<100) 시 `autoGainControl:false` 로 캡처, 슬라이더 변경 시
    micTrack.applyConstraints 로 실시간 토글(100=AGC 원복). getSources(mode, agcOff) 시그니처 확장.
  · desk.html(여객 태블릿): AGC 항상 off(근접 판별이 이 채널의 존재 이유) + 근접 게이트 peak→RMS 전환,
    스케일 0.08(peak)→0.04(RMS), 기본 50=0.02 RMS(~30cm 발화 통과·먼 소리 차단).
  · mobile.html PTT 는 누르는 동안만 발화(게이트 없음) — AGC 유지가 이득이라 그대로 둠.
- 실음성 검증은 현장 몫: 민감도 50~70에서 속삭임 차단, 보통 목소리 통과 확인. 안 맞으면 슬라이더로 보정.

## 2026-07-13 (13) — 모바일(iOS 등) 민감도 무력화: AGC 를 못 끄는 기기 → 임계 스케일 자동 상향
- 증상: 데스크톱(크롬)은 AGC off 수정으로 해결됐지만, 휴대폰 뷰어(desk.html)는 민감도를 끝까지 내려도 작은 소리가 통과.
- 원인: iOS 사파리 등 일부 모바일 브라우저는 `autoGainControl:false` 요청을 **무시**(OS 레벨 AGC).
  증폭된 신호(발화 RMS ≈0.05~0.2)가 들어오는데 임계 스케일 최대가 0.04~0.05 라 어떤 값에서도 못 거름.
- 수정: 캡처 후 `track.getSettings().autoGainControl` 로 **실제 상태를 확인** —
  · off 로 확인된 기기(안드로이드 크롬·데스크톱): 저임계 스케일(호스트 0.05 / 뷰어 0.04) 유지
  · off 확인 불가(미지원·무시, iOS 등): 스케일 **0.12** 로 상향 — 증폭 후 음량 기준으로 근접/원거리 구분
- 적용: desk.html(gmSens/gmScale/gmCalc 분리, 캡처 시 판정) + audio.js(micSensVal/agcScale/syncAgcScale,
  슬라이더 변경 applyConstraints 완료 후 재판정 — 모바일 호스트도 커버).
- AGC 강제 기기는 근접 판별력이 상대적으로 약함(증폭이 음량차를 압축) — 그래도 스케일 상향으로 슬라이더가 실효.

## 2026-07-13 (14) — 마이크 게이트 적응형(주변소음 바닥 대비)으로 재설계 + 오역 반복 원인
- 문제1: 절대 RMS 임계(스케일 자동조정 포함)도 뷰어(휴대폰)에서 무력 — 기기·AGC·환경마다 절대 음량이 달라
  어떤 고정 임계도 맞출 수 없었다("낮춰도 다 들림").
- 문제2: 세션 중 같은 오역 반복 — 대개 게이트가 못 막은 '상시 주변소음'이 반복적으로 같은 오인식·오역을
  만들어낸 것(원인이 문제1과 동일한 경우가 많음).
- 해법: 게이트를 **적응형**으로 재설계 — 절대 임계 대신 '주변 소음 바닥(floor) 대비 배수'로 판정.
  · floor: 조용할 때 빠르게 수렴(×0.3), 소리날 때 아주 느리게 상승(×0.002) → 발화로 바닥이 안 튀고
    상시 소음은 서서히 바닥에 흡수돼 자동 차단.
  · 열림 조건: `rms ≥ absMin && rms ≥ floor × ratio`. 민감도(0~100)가 ratio(1~8배)+absMin(0.004~0.034) 조절.
  · 기기 게인과 무관(상대 판정) → iOS/안드로이드/데스크톱 공통 동작.
- 적용: audio.js(호스트 마이크, calcGate/noiseFloor), desk.html(여객 뷰어, gmCalc/gmFloor, 캡처마다 floor 리셋).
  AGC 는 여전히 off 시도(켜지면 원거리음 증폭으로 판별 흐려짐)하되, 게이트 자체는 AGC 성공/실패와 무관하게 동작.
- 시뮬 검증: 근접(0.12) 전 구간 통과, 원거리(0.03) sens30↓ 차단, 상시소음(0.02) sens50↓ 차단.
- 실오디오 검증은 현장 몫. #2 가 근접 발화에서도 재현되면(주변소음 아님) soniox 결정론 이슈 → 별도 대응 필요.

## 2026-07-13 (15) — #2 재검토: STT 인식 컨텍스트 고착 → 무음 시 조용한 재연결로 플러시
- 재정의된 증상: 번역이 아니라 **STT 인식** 문제. 같은 환경·같은 발화라도 세션(=별도 soniox 연결)마다 결과가 다르고,
  한 연결 안에서 오인식이 한 번 굳으면 그 발음을 계속 같게 인식. → soniox 스트리밍 연결에 누적되는 인식 컨텍스트가 원인.
- 해법: **발화 확정 후 일정 무음(2.6s)이 지속되면 soniox 소켓을 '조용히' 재연결**해 누적 컨텍스트를 비운다.
  · 무음 구간에만 재연결 → 오디오 손실 없음(pending 큐가 재연결 중 프레임 보관). 상태 메시지·지연 최소(quiet).
  · 발화 중(토큰 도착)이면 예약 취소(clearFlush), 진행 중 발화(curId)·클라 이탈(ws.readyState)이면 스킵(좀비 재연결 방지).
- 적용:
  · runSoniox(일반 실시간 번역): flushTimer/quietFlush, onmessage 에서 clearFlush, commit 에서 armFlush, close 핸들러 quiet 분기(200ms).
  · runDesk(안내데스크 양 채널): deskFlushTimer, onSxMessage·onGuestMsg 에서 clearDeskFlush, staff commit·guestCommit 에서 armDeskFlush,
    발동 시 closeSx()+connectSx()(+guestMicOn 이면 closeGuest()+connectGuest()) — 기존 안전 재연결 프리미티브 재사용. endConversation·stop 에서 clearDeskFlush.
- 검증: 문법 OK, 부팅 OK, 데스크 host WS 연결 시 런타임 에러 없음(플러시 클로저 정상). 실오디오 재현은 현장 몫.
- 남은 여지: 여전히 재현되면 (a) FLUSH_MS 조정 (b) 수동 '인식 초기화' 버튼 (c) 오인식 잦은 발음은 용어(주요 용어)에 등록해 인식 힌트 제공.

## 2026-07-14 — 발화 필터 v2(간투사 확장·저신뢰 하이라이트·응답어 옵션·토큰 기록) + 다국어 회의(multi) 프리셋
### 발화 필터 v2 (사용자 지시: 드롭 대신 하이라이트, 중복 접기 제외)
- **간투사 사전 확장**(stripFillers): NOISE 에 en oh/ah/huh·ko 아/앗/핫/헉/흠 추가(단어경계·한글 인접 가드로 아이스크림/ohio/ahead 보존),
  FILLER_WHOLE_RE 신설 — 단독 あ/え/ん/啊/哦/唉 는 '발화 전체일 때만' 드롭(가나·한자 단어 내부 오작동 방지). 유닛 28/28.
- **저신뢰 단어 하이라이트**(드롭 아님): soniox 원문 확정 토큰의 confidence 를 [[text,conf],...] 로 기록,
  TranslateView 원문 줄에서 **conf<0.6 단어를 warning(주황)색 + 점선 밑줄**로 표시(TokenizedSource). 번역문은 대상 아님.
- **단독 응답어 생략 = 고급옵션(dropAcks)**: ACK_WORDS(네/예/응/Yes/Okay/はい/好 등) 단독 발화를 기록에서 제외 —
  기본 꺼짐(모두 보존). 고급 설정 토글, WS 파라미터 + {type:'dropAcks'} 라이브 메시지(soniox·desk 양쪽). 문장에 섞인 응답어는 불변.
- **토큰 기록(평가용)**: item.toks = [[text,conf],...] (≤120 토큰) — 세션 items·데스크 deskLog 에 저장돼
  추후 confidence 기반 인식 품질 평가 가능. sentence 브로드캐스트에도 포함(뷰어는 무시, 무변화).
- 연속 중복 접기는 **구현하지 않음**(사용자 지시).
### 다국어 회의(3개국어+) — 별도 세션 프리셋 'multi' (테스트)
- 새 세션 모달 4번째 카드 '다국어 회의(3개국어+ 테스트)'. 기존 세션 유형·뷰어 로직 무변경(신규 분기만).
- 서버 runSoniox sxMode='multi': soniox **전사+언어감지만**(translation 미포함, hints=선택 언어), commit 에서
  **GPT(gpt-5-nano) 병렬 팬아웃** — 원문을 모든 언어 칸에 즉시 확정 후 각 언어 번역 도착 시 교체(deepgram 패턴 재사용).
  라이브는 원문을 전 언어 칸에 스트리밍. TTS 미지원(강제 off). session.langs=선택 언어(뷰어 언어 선택 자동 연동), sxInfo={mode:'multi',langs}.
- 클라: multiLangs 칩 다중선택(2~4개, kac-multi-langs 저장) + 표시 언어 셀렉터, 모드 변경 셀렉터에 '다국어 회의' 추가.
  WS 파라미터 multiLangs=ko,en,... POST/PATCH preset 허용목록에 'multi'.
- 검증: 프리뷰에서 카드 표시→생성→언어 칩/표시 언어/고급 설정(단독 응답어 생략) 렌더 확인, multi WS 스모크(엔진 연결 OK),
  session.langs=['ko','en','ja','zh'] 반영 확인, 콘솔 무에러, 테스트 세션 완전 정리. 실음성 팬아웃 검증은 현장 몫.
### 데스크 음성크기 네이티브 검토(답변만) — 요지
- 입력(마이크 게인): 웹은 AGC on/off 요청뿐(iOS 무시). 네이티브는 iOS AVAudioSession.setInputGain·Android VOICE_RECOGNITION/UNPROCESSED
  소스로 결정적 제어 → **입력 제어는 네이티브가 명확히 우월**. 출력: 웹 GainNode(페이지 내)로 충분, 기기 마스터 볼륨은 Android 네이티브만(setStreamVolume), iOS 는 네이티브도 불가.
- 권고: 풀 네이티브 재작성 불필요 — 필요 시 **Capacitor 로 웹앱 래핑 + 오디오 네이티브 플러그인**(데스크 태블릿용, Electron 데스크톱 전례와 동일 패턴).

## 2026-07-14 (2) — 안드로이드 네이티브 앱(안내데스크 태블릿) — WebView + 네이티브 마이크(AGC 완전 차단)
- 배경: 브라우저(WebView 포함)는 autoGainControl:false 요청을 기기에 따라 무시(특히 iOS/일부 안드로이드) →
  적응형 게이트로도 잔여 편차. **안내데스크는 안드로이드 태블릿 통일 + 네이티브 앱**으로 입력을 OS 레벨에서 제어(직전 세션 검토안의 하이브리드 구현).
- **`android/` 순수 Gradle 프로젝트**(Android Studio 불요, minSdk 26/target 34, Kotlin):
  · `MainActivity.kt` — WebView 키오스크: 서버 주소 저장(첫 실행 입력, 전체 URL 허용 → 뷰어 태블릿은 desk.html?session=… 직접 지정),
    몰입 전체화면·화면 꺼짐 방지·회전 시 재생성 안 함(WS 유지), 렌더러 크래시 recreate 복구, **페이지 이동 시 네이티브 캡처 강제 종료**(고아 마이크 방지),
    onPermissionRequest 마이크 승인(getUserMedia 폴백용), 다운로드는 외부 브라우저로, WebView 원격 디버깅 상시 허용(chrome://inspect).
    **뒤로가기 = 관리 메뉴**(새로고침/서버 주소 변경/마이크 입력 게인/앱 정보).
  · `NativeAudio.kt` — `window.AndroidAudio` 브리지: AudioRecord **VOICE_RECOGNITION**(CDD상 AGC 미적용) + AutomaticGainControl 명시 off,
    AEC(자기 TTS 에코 제거)·NS 지원 기기만 on, 48k(폴백 44.1k/24k/16k) 캡처→선형보간 24kHz PCM16, **소프트웨어 게인 0.1~8.0×**(앱 메뉴, prefs 저장),
    100ms base64 청크 → `window.__kacNA(b64)` (evaluateJavascript). setMediaVolume/getMediaVolume(STREAM_MUSIC) 브리지도 포함(추후 호스트 원격 볼륨용).
  · 서명: `app/airtalk-release.p12`(openssl PKCS12, 사이드로드 전용, repo 커밋 — CI 빌드 간 서명 고정으로 덮어쓰기 업데이트 가능). 아이콘: favicon 심볼 어댑티브 벡터.
- **웹 3곳 연동(window.AndroidAudio 있으면 getUserMedia 대신 네이티브, 없으면 기존 그대로)**:
  · audio.js(호스트): getSources 가 {native:true} 소스 반환, 루프에서 __kacNA 핸들러가 게이트(noiseFloor/micRatio/micAbsMin 동일)·VAD(ms 카운터)·
    mute/TTS 음소거·activity·commit 를 브라우저 경로와 동일 수행. **네이티브면 AEC 루프백 생략**(기기 AEC + 재생 중 음소거 폴백). stop 에서 브리지 정지.
  · desk.html(여객 마이크): guestMicStartNative — gm 근접 게이트(gmFloor/gmRatio) 동일 적용 + 백프레셔. guestMicStop native 분기.
  · mobile.html(참여자 PTT): pttNative 분기(백프레셔 포함).
  · 서버 24kHz PCM16 LE 프로토콜 완전 무변경(리틀엔디언 Int16Array.buffer 그대로 송신).
- **배포 체인**: fetchLatestDesktop 에 .apk 에셋 → /api/desktop/info android + /download/desktop?platform=android(MIME
  application/vnd.android.package-archive — 브라우저가 바로 설치 화면), 모달 '앱 설치'(3플랫폼, Android 는 '알 수 없는 앱 설치 허용' 안내),
  Nav 라벨 '앱 설치 (PC·태블릿)'. main.yml 에 android 잡(setup-java 17 + setup-gradle 8.7 → `gradle -p android assembleRelease` → 릴리스 업로드).
- 검증: vite 빌드 OK·테스트 8/8·desk/mobile 인라인 스크립트 문법 OK. **프리뷰 E2E(가짜 AndroidAudio 스텁 main world 주입)**:
  양방향 세션에서 시작→getUserMedia 0회·start() 1회·__kacNA 등록·청크 전송·'진행 중' 상태, 중지→stop() 1회·핸들러 해제. 콘솔·서버 에러 0. 테스트 세션 purge.
  ⚠ 실기기(APK 설치) 검증은 CI 빌드 후 현장 몫: 게이트 체감, 여객 태블릿 2채널, TTS 에코(AEC 기기 편차).
- 주의: 프리뷰 pane 에선 getDisplayMedia/getUserMedia 프롬프트가 영구 보류됨 → '온라인 회의'(시스템 오디오) 프리셋으로 시작하면 startingRef 가
  고착돼 이후 시작 클릭이 무시됨(페이지 새로고침으로 해소). 앱/실브라우저에선 프롬프트가 항상 settle 되므로 해당 없음.

## 2026-07-14 (3) — 데스크 2안: PC 호스트 + 지향성 마이크 2대 직결 (뷰어는 표출 전용)
- 배경: 고정 안내데스크는 태블릿 2대(각자 캡처)보다 **PC 1대가 마이크 2대를 직접 잡는 구조**가 운영 안정성 우위
  (유선 전원·PC급 오디오 스택·장애면 1개·데스크톱 크롬은 AGC off 준수). 마이크별 별도 스트림 유지로 one_way×2(채널=화자)는 그대로.
- **서버**: `/ws/host?src=guestmic` = 여객 오디오 공급 전용 연결(`runDeskGuestFeed`) —
  컨트롤러·usage·발화락·유휴타이머 미접촉, 기존 `ctrl.guestMic/feedGuest`(뷰어 desk-mic 와 동일 경로) 재사용.
  room.hosts 에 넣지 않고 `room.guestFeeder` 슬롯(hostTalking/host-active 오염 방지), 같은 src 재접속은 takeover.
  컨트롤러 없을 때 0.5s×20 재시도 부착(두 파이프 동시 오픈 레이스).
  · `guestMic` 소유권에 **호스트 공급 우선**: PC 직결 활성 중 뷰어 desk-mic on 은 무시(스모크로 확인), 소유 소켓 죽었으면 readyState 로 즉시 승계.
  · 뷰어 신호 `{type:'desk-mic2',on}` + meta.mic2 (setMeta/뷰어 접속 시 ctrl.mic2()) — on=태블릿 캡처 중지(표출 전용), off=응대 중이면 태블릿 마이크 자동 복귀(폴백).
  · 상태문구 '여객 마이크(PC 직결/태블릿) 연결'.
- **audio.js**: `opts.mic2={staff,guest}`(desk+브라우저 한정) → getSources 가 장치 2개(getUserMedia deviceId exact, 직원은 실패 시 기본 폴백,
  여객은 실패 시 단일채널 폴백+status) → 여객 파이프(src=guestmic): 근접 게이트(gmCalc 동일 공식, guestSens)+백프레셔+TTS 재생 중 음소거 공유,
  발화멈춤(muted) 비적용(손님 말은 호스트 일시정지와 무관), **커밋 미전송**(soniox 엔드포인트 확정). onMeter(rms,peak,src) 로 채널별 레벨.
  setGuestSens 는 로컬 여객 게이트 즉시 갱신 + 서버 경유 뷰어 반영(양쪽 공통).
- **TranslateView**: 데스크 옵션 바에 '마이크 2대 (PC)' 스위치(kac-desk-mic2) + 직원/여객 장치 Select(enumerateDevices,
  devicechange 자동 갱신, kac-desk-mic-staff/guest 저장) + **채널별 실측 레벨 미터**(말해서 연결 확인) + 경고 칩(선택 필요/미연결/직원과 같은 장치).
  설정 변경 시 applyMic2 가 캡처 재시작(recorder.stop→600ms→start, stopReq 미사용). 여객 장치 미선택이면 mic2 미적용. AndroidAudio 환경에선 숨김.
  고급설정 슬라이더 라벨 '여객 태블릿 마이크 민감도'→'여객 마이크 민감도'(태블릿·PC 직결 공통).
- **desk.html**: hostMic2 플래그(meta.mic2 / desk-mic2) — true 면 guestMicStart 차단+진행 중 캡처 중지(표출 전용),
  false 복귀 시 응대 중이면 자동 재캡처(PC 마이크 뽑힘 → 태블릿 폴백). 권한 대기 레이스 가드에 hostMic2 추가.
- 검증: 빌드·8/8 테스트·인라인 스크립트 문법 OK. **WS 스모크**(host+guestmic+viewer 실서버): 피더 접속→desk-guest-mic true+'PC 직결' 상태문구+
  뷰어 desk-mic2 true → 통역 시작(meta two·mic2=true) → 뷰어 desk-mic on 시도 무시(소유권 유지) → 피더 종료→desk-mic2 false+단일채널 폴백. 테스트 세션 purge.
  프리뷰 UI: 스위치→직원/여객 Select+미터+'선택 필요' 칩 렌더 확인. (프리뷰는 마이크 권한 불가라 장치 라벨은 실PC에서만 정상 노출)
- ⚠ 실기기 확인: 실제 USB 지향성 마이크 2대에서 장치 선택·레벨 확인·양 채널 동시 인식, 뷰어 표출 전용 전환, PC 마이크 탈락 시 태블릿 폴백.

## 2026-07-14 (4) — TTS 상시 WebSocket + RNNoise 잡음 제거 옵션(β)
### Cartesia 상시 WS (문장별 HTTP 연결 비용 제거)
- 배경: TTS 지연 검토에서 스트리밍 번역·문장 단위 즉시 합성·오디오 큐는 기구현 확인 → 남은 지연 성분 중
  '문장마다 새 HTTP POST(/tts/bytes) 연결 비용'을 제거(리스크 0 항목만 채택, 문장 내부 청크 continuation 은 보류).
- server.js: 전역 `cartesiaSock` 1개 유지(`cartesiaConnect` — 연결 합류·8s 타임아웃·close 시 진행 요청 일괄 실패),
  `cartesiaTTSWs`(context_id 다중화, chunk/done/error, 0.2s 청크 정렬은 HTTP 와 동일), `cartesiaTTSStream` = WS 우선 +
  **오디오를 하나도 못 내보낸 경우에만 HTTP 폴백**(부분 재생 후 재시도하면 문장이 겹쳐 들림). 기존 HTTP 는 `cartesiaTTSHttp` 로 개명.
  `cartesiaWarmup` 은 새 경로로 짧은 합성 1회(WS 프리커넥트+키/보이스 검증, 오디오 무시·got 플래그로 실패 감지).
- 실측(실키): WS 재사용 첫 청크 311~376ms vs HTTP 412~529ms — **문장당 ~100~180ms 절감**, 완료도 ~650ms vs ~1000ms.
  연결 835ms 는 warmup 때 1회. 실서버 스모크: tts=1 호스트 연결 → '음성(Cartesia) 준비됨' + `[cartesia] ws 실패` 로그 0(폴백 미발동).
### RNNoise 잡음 제거 옵션 (고급 설정 '잡음 제거 강화(RNNoise·β)', kac-rnnoise, 기본 꺼짐)
- 위치: 지향성 마이크 없는 환경의 배경 소음(에어컨·웅성거림) 보조 — **사람 목소리 누화는 못 거르므로 근접 게이트는 유지**.
- `@jitsi/rnnoise-wasm`(sync 빌드, wasm 인라인) — **동적 import 로 별도 청크(1.9MB)**, 옵션 켠 세션에서만 로드. 메인 번들 무영향.
- audio.js: `loadRnnoise`/`createDenoiser`(480샘플 프레임, ±32768 스케일, HEAPF32 매 프레임 재획득(메모리 증가 대응), carry 이월 ≤10ms,
  destroy 로 상태·힙 반납). rnnoise on 시: **AudioContext 48kHz 강제**(미지원이면 자동 포기+안내) → getUserMedia `noiseSuppression:false`
  (이중 NS 방지, RNNoise 로드 실패 시엔 브라우저 NS 유지 폴백) → 파이프별 디노이저(직원 mic + 여객 guestmic 각자 상태, system 오디오 제외)
  → **게이트·VAD·미터는 정제된 신호로 판별**. AudioContext 를 getSources 앞으로 이동(권한 거부 시 close 누수 가드 추가).
- TranslateView: 고급 설정 토글(AndroidAudio 환경 숨김 — 네이티브는 자체 NS), 데스크는 변경 즉시 재캡처(`restartCapture` 로 applyMic2 와 공용화),
  일반 세션은 다음 시작부터. start() opts.rnnoise.
- 검증: node 에서 wasm 직접 구동 — 무성 백색소음 **-76.8dB** 억제·VAD 0·API(create/process/destroy/malloc/free) 계약 확인.
  빌드 OK(rnnoise-sync 별도 청크), 8/8 테스트, 프리뷰 고급 설정에 토글 렌더 확인.
- ⚠ 실환경 A/B 권장: STT 앞 과처리는 인식률을 떨어뜨릴 수 있음 — 켜고/끄고 실발화 인식률 비교 후 데스크별 선택.

## 2026-07-14 (5) — 저신뢰 자동 교정(confFix, 고급옵션 β) + 임계 선택 근거
### 무엇
- soniox 원문 토큰 confidence 로 '오인식 의심 발화'만 골라 GPT(gpt-5-nano)가 대화 맥락·용어를 보고
  **원문 치환을 제안 → 서버가 가드 적용 → translateText 로 재번역 → 같은 id 카드 덮어쓰기**(TTS 재발화 없음).
- 고급 설정 '저신뢰 자동 교정 (GPT·β)'(kac-conf-fix, 기본 꺼짐, 라이브 토글 {type:'confFix'}), runSoniox commit +
  runDesk 직원/여객 커밋 3곳 훅. 카드 소멸(응대 종료 아카이브) 후 도착한 교정은 폐기(유령 카드 방지).
### 트리거(서버 CONFFIX 상수) — ⚠ 재튜닝 시 이 근거를 먼저 읽을 것
- **채택: 가드(실단어≥3) → [연속 2개+ conf<0.4] OR [min≤0.12], 상한(저신뢰<0.55 비율 70% 초과 시 제외)**
- 근거 데이터: 실로그 3세션(테스트 soniox/live 81발화 · Le train soniox/twoway 68 · Bonjour soniox/live 50, 실단어 ~3,500토큰).
  재현: `node eval/conf-analyze.mjs` (서버 실행 중, 규칙별 발동률·분포 출력 — PROD 규칙이 서버 상수와 동기).
- 규칙별 발동률(테스트/Le train/Bonjour): 단발 min≤0.35 → **15%/24%/58%**(폐기 — 세션 편차 극심),
  연속2+<0.4 → **0%/0%/8%**(채택), PROD(연속+극단 0.12+상한) → 2%/4%/18%.
- 단발 저신뢰가 무의미한 이유(구조적 편향 3유형, 전부 '정상 인식'이었음):
  ① 한국어 어절 첫 음절(안0.13/여0.05/당0.05) ② 조사·구두점(을0.29/는0.23) ③ 언어 전환 경계(c'est 0.34, Wi-Fi 0.32, th/se 0.25/0.33).
  진짜 오인식(찝찝대는/측측대는/逆0.07/주위0.18)은 음절이 줄줄이 틀려 **저신뢰가 연속**됨.
- 남은 허점: EXTREME(0.12) 가지가 Bonjour 류(장문 안내방송체)에서 발동률을 8%→18%로 올림(여0.05 등 정상 극단값) —
  현장에서 과발동이면 **EXTREME 을 먼저 낮추거나 제거**할 것. 연속 규칙도 오탐 가능(담당인력 0.11/0.09) → GPT changed=false 가 최종 거름망.
- ⚠ 표본 한계: 3세션 전부 한국어 지배 발화. **데스크 외국어 손님 발화(영·일·중→한)가 쌓이면 conf-analyze 로 재측정** 필요.
### GPT 판정 계약 — 프롬프트 실험(실왕복 4라운드)에서 확정
- 문장 재작성 방식은 실패: nano 가 ①명백 케이스도 과보수(changed=false) ②번역을 직전 대화 걸로 냄 ③마킹 밖 글자 훼손('가상공간→가상간').
- **판정 전용 + 치환 목록** 계약으로 해결: {"changed", "replacements":[{from,to}]} 만 받고, **서버가 치환 적용**
  (가드: from 2글자 미만·no-op·원문 부재 → 폐기 — 정상 발화 오탐이 '가→가상' 류 1글자 치환으로 나와 이 가드만으로 전멸),
  번역은 검증된 translateText 로 재생성(판정 모델 번역은 언어 섞임 재현). few-shot 예시 2개(긴옌실→흡연실 / 가상공간 정상) 포함.
- 검증: 양성(흡연실 오인식+용어) → 치환 적용·정상 번역, 음성(정상 발화) → 가드에서 전부 폐기. 2회 반복 재현. 판정 지연 ~1.1–2.4s.

## 2026-07-15 — 무음 재연결(컨텍스트 플러시) 삭제 + UI 일괄 개선 8건
### ⚠ 무음 시 조용한 재연결(quiet flush) 삭제 — Soniox 과금 원인 규명
- 표기 $0.18/h 대비 실단가 $0.42/h 였던 원인: Soniox 는 **context(용어집)를 input_text_tokens($4/1M)로 과금**하는데
  (번역 자체는 무료, 오디오는 ~$0.12/h), quiet flush 가 무음 2.6초마다 재연결하며 **config+context 를 매번 재전송** →
  발화마다 context(1,500~3,000토큰)가 재청구돼 14일 비용 $3.33 중 $2.37(71%)이 context. request 중앙 지속 3.1s(=발화당 새 연결) 로 확인.
- runSoniox(CTX_FLUSH)·runDesk(DESK_FLUSH) 플러시 로직 전부 제거(네트워크 오류 자동 재연결은 유지).
  오인식 고착(플러시의 원래 목적)은 confFix(저신뢰 자동 교정)가 완화 — 고착이 다시 문제되면 '수동 인식 초기화 버튼'을 검토.
- 원칙 재확인: context 는 연결(세션)당 1회만 실려야 한다. 언어 전환·모드 전환 등 불가피한 재체결 외에 재연결을 만들지 말 것.
### UI 일괄(사용자 지시 8건 중 구현 7건)
- ② 호스트 화면 발화 색 구분(데스크): 게스트(외국어·side=left)=액센트('a'), 호스트(ko)=무채색('b') — Row dir 재사용.
- ③ 데스크 고급설정: '마이크 음성인식 민감도'→(데스크에서만) **'호스트 마이크 민감도'**, '여객 마이크 민감도'→**'게스트 마이크 민감도'** 로 개명하고 호스트 바로 아래로 이동.
- ④ '길안내 지도' on/off 토글(kac-desk-wayfind, 기본 on): 끄면 서버가 감지·GPT 분류 자체를 생략(&wayfind=0 + {type:'wayfind-on'} 라이브), 지도 자동 표시는 종속 비활성.
- ⑤ 저신뢰 단어 하이라이트(TokenizedSource) 삭제 — toks 기록·confFix 는 유지(표시만 제거).
- ⑥ 관리자 페이지 '안내데스크' 탭(DeskManagePanel): 데스크 목록/추가(데스크명·층·방향)/삭제(소프트 — 로그 보존). 기존 admin 전용 세션 API 재사용.
- ⑧ 실시간 번역(soniox) 옵션 바에 '마이크' 장치 선택(kac-mic-device, 녹음 중 변경 불가) — audio.js micId(exact deviceId, 뽑히면 기본 폴백).
- ⑦ 게스트 태블릿 오프라인(블루투스) 검토는 대답만(스레드 참고): BLE 대역폭·WebSocket 구조상 부적합, Wi-Fi Direct/로컬 AP 열이 현실적.

## 2026-07-15 (2) — UI 점검 후속: 캡처 재시작 버그·발화자 색·데스크 레지스트리 등 일괄
- **캡처 재시작 멈춤 버그(치명)**: RNNoise 토글 등에서 restartCapture 의 setTimeout 이 '옛 렌더 클로저의 start'를
  호출 → stale recording=true 가드에 걸려 재시작이 조용히 무시(미터 0, 서비스 멈춘 듯 보임). **startRef(항상 최신 start 참조)로 수정.**
  프리뷰에서 mock getUserMedia 로 재현·수정 검증(토글 전 73 → 수정 전 0 고착 → 수정 후 78 복구).
- **발화자 색 구분 실종 원인**: 뉴트럴 테마 전환으로 primary=거의 검정 → dir 'a'(액센트)가 본문색과 동일해졌음.
  **palette.accent(라이트 #2e6fd8/다크 #84b5ff) 신설** — Row 의 게스트/언어1 발화에 사용. theme.js 에 **RADIUS 표준 토큰**
  (panel 1.5/control 1/row 2/pill) 신설, 세션 검색창 라운드를 관리자 패널과 통일(2.5→panel).
- **데스크 레지스트리**: 관리자가 이름·층·방향을 사전 정의(`deskRegistry` 저장소, GET 로그인/PUT admin) →
  데스크 세션 생성은 '등록 데스크 선택 + 세션명'만(POST sessions deskId → floor/side/deskName 복사, 미등록 400).
  AdminPage '안내데스크' 탭=정의 CRUD 로 개조, SessionList 데스크 생성 모달=셀렉터, 목록 행에 deskName 표시.
- **soniox 발화 끊김 옵션(종료 민감도·최대 지연·지연 레벨) 데스크 노출** — 상시 캡처라 변경 시 0.9s 디바운스 후 자동 재캡처.
- **mic2 직원 기본마이크 경고**: 장치 미지정이면 '내장 마이크 사용 중' 칩(내장이 직원 채널로 들어간다는 안내).
  참고: 2대 모드에서 캡처되는 것은 '지정한 두 장치'뿐 — 둘 다 외장 지정 시 내장 마이크는 입력받지 않음.
- **로그 언어 '미상' 제거**: deskLog push 시 lockedB 없으면(감지 전 이탈·interrupted 아카이브) items 의 비ko 발화 언어로 유추 저장.
- **'안내원이 일본어' 원인(실로그 확인)**: 오라벨 아님 — 단일 마이크 two_way 에서 손님 일어 꼬리+안내원 한국어가
  한 발화로 묶여(lang=ko 다수결) 표기된 혼합 발화("で、말씀하세요"). 대응은 엔드포인트 튜닝(이번에 데스크 노출)·2채널 모드.
- 세션 목록 첫 로딩 스켈레톤(빈 상태 오표시 방지).

## 2026-07-16(4) — 전면 버그 소탕(리뷰어 3명 교차 검증 → 전부 수정)
클라(오디오·뷰어)/서버 전체/최근 diff 3방향 독립 리뷰 후 확정 결함 전량 수정. 핵심만 기록:
### Critical
- **데스크 close 순서 회귀**: host close 가 `deskCtrl.delete` → `endConversation()` 순서라 좀비 가드가 자기 자신을
  좀비 판정 → 응대 중 이탈 시 아카이브·뷰어 리셋 전부 생략되던 문제. endConversation 먼저 호출로 교체(server).
- **무인증 뷰어 제어 남용**: `deskCtlAllowed()`(소켓 20/분·세션 40/분·start/end 0.8s 간격, desk-mic 는 간격 제외) —
  공개 뷰어의 desk-start/end/mic 난사로 인한 soniox 재체결(context 재과금)·응대 강제종료 차단. + WS `maxPayload 1MB`.
- **재캡처 타이머 유령 캡처**: restartCapture 600ms·scheduleRestart 900ms 타이머를 stop()/언마운트에서 clear +
  발화 시 stopReq 확인(TranslateView). start() 첫 줄의 stopReq 리셋 때문에 표시만으론 못 막았음.
### Important
- 장치 뽑힘/화면공유 중지: recorder `opts.onEnded` 콜백 신설 → UI 정리+안내(이전엔 '진행 중' 고착).
- 단일 채널 데스크 발화자 색: messages 에 `lang` 필드 보존(초기 로드·병합·신규 3곳) — 서버는 보내는데 클라가 버렸음.
- runSoniox 재연결: 지수 백오프 + 연속 8회 실패 시 idle-stop(재시도마다 context 재과금 방지). 토큰 수신 시 리셋.
- loadStore 파일별 개별 try/catch + 손상 파일 `.corrupt-<ts>` 백업 — 1파일 손상이 전체 데이터 유실로 번지던 문제.
- flushSessions **dirty-only upsert**(Mongo) + 파일 모드 비동기 쓰기. `saveSessions(id)` 로 핫 콜사이트 전달.
  `sessionsFlushInflight` 대기 후 deleteOne — 삭제 부활 레이스(보류 리스크) 해소.
- runTranslate markReady 소켓 상태 확인 + close 시 idle-stop(죽은 소켓 '연결됨' 표시·무음 유실 방지).
- desk-status 뷰어 수: 호스트 패시브 뷰어(`role=host` 파라미터)를 카운트에서 제외(상시 +1 부풀림).
- 재연결 시 ctlState 에 dropAcks/confFix/wayfind/deskIdle 추가 재전송. AEC 루프백 실패·늦은 완료 경로 자원 회수.
- mobile.html: pttCtx `resume()`(iOS 무음 녹음), 지도 스크립트 재시도 상한 3회, 빈 페이로드(clearCard) 카드 제거 — desk 에만 있던 수정 동기화.
### Minor(발췌)
- 서버: getCookie try/catch(깨진 쿠키 500), ws error 리스너, SIGTERM/SIGINT flush 후 종료, deskLog 삭제 `endedAt` 검증(409),
  terms PUT 실패 시 500, viewerPTT 죽은 PATCH 제거, guestFeeder room GC 예외, stale wayfind 제안 정리, TTS 토글 roomCfg 반영(폰 PTT),
  뷰어 snapshot 에서 tm/toks 제거(저장 전용 규약), tm.tq 를 TTS 체인 내부(실요청 직전)로 이동, desk connectSx/Guest open 세대 가드.
- 클라: 뷰어 재연결 지터(1.2~2.4s), 재연결 소켓 12s 타임아웃, onmessage JSON.parse 가드, 세션 생성 더블클릭 방지,
  삭제 세션 popstate 진입 catch, messages 800개 상한, patch .catch, 마이크 폴백 안내, 구 multi 세션 시작 차단(열람 전용)+라벨 폴백.
- 관리자: 월별 비용 축(선행 빈 달 제거·연도 라벨), adminTab 히스토리 복원(pushState/popstate), PAGE_TITLES 를 Nav ADMIN_TABS 에서 파생,
  데스크 등록 실패 시 다이얼로그 유지.
- 검증: node --check·빌드·테스트 8/8, 프리뷰 스모크(관리자 렌더·하위메뉴 뒤로가기 복원·콘솔 무오류·파일 저장소 정상 로드).

## 2026-07-16(3) — 관리자 차트 recharts 전환(콘솔 대시보드 참고 피드백 5건)
- **차트 라이브러리 도입: recharts 3.9.2**(React 19 지원). 손수 짠 SVG(투박) → recharts 로 전면 교체.
  공용 래퍼 `client/src/components/charts.jsx`: `Sparkline`(면적, 벤더 카드) · `BarTrend`(막대, 라운드 탑·마지막 강조·호버 툴팁).
  다크 모드 자동 대응(테마 divider·text 색 주입), 툴팁은 콘솔 스타일 다크 박스(제목=full 날짜, 값=formatValue).
  AdminPage 청크 94KB→464KB(gzip 135KB) — lazy-load 청크라 초기 로딩 영향 없음.
- **일별 비용 → 막대 그래프 + 기간 7/14/30/월별**: 상단 세그먼트를 7·14·30일·월별로 변경(기존 7/30/90 폐기).
  월별은 days=365 fetch 후 YYYY-MM 합산 → '1월·2월…' 막대. Cartesia(크레딧)는 여전히 합산 제외(카드에서 확인).
- **호버 툴팁**: 모든 차트에 recharts `<Tooltip>` — 막대/스파크라인 위에서 해당 일자·값 표시(프리뷰 실측: 06-17 $1.51 확인).
  ※ recharts 툴팁은 mousemove 로 활성 — 합성 이벤트 단발로는 안 뜸(테스트 시 실제 hover 2단계 필요).
- **시간대별 분포 복원**: 데스크 통계에 24시간(0~23시) 막대 차트 재추가(전폭 패널). '전체' 합산 시 hourly 배열 합산.
- **응답 지연(손님 발화끝→안내 시작) 삭제**: 클라 HBar·계산 제거 + 서버 desk-stats 의 respDelays 집계 제거(불필요 연산 정리).
  ※ 레이턴시 tm 로그(item.tm) 자체는 유지 — 오프라인 분석·README 문서 그대로.
- 검증: 빌드·테스트 8/8, 프리뷰 라이트/다크에서 막대·스파크라인·툴팁·월별 전환·시간대별 렌더 확인, 콘솔 무오류.

## 2026-07-16(2) — 관리자 메뉴 개편(시안 승인분 구현)
- **상단 탭 제거 → 좌측 nav 하위메뉴**: `Nav.jsx` `ADMIN_TABS`(사용량/로그/안내데스크/계정 관리/용어 설정/정형 안내/시스템·보안).
  view=admin 일 때 '관리자' 아래 펼침, 활성 항목=시그니처 보라(ACCENT) 글자+연보라 배경. adminTab 상태는 `App.jsx`(onAdmin(tab)).
  AdminPage 는 `tab` prop 수신 — 상단 제목(23px/800) + 컨텐츠 maxWidth 1240(전폭).
- **보라 사용 범위**: theme.js ACCENT(라이트 #5b4fe8/다크 #8579ff) = 로고+관리자 그래프·강조 수치·활성 하위메뉴 전용(버튼·본문은 뉴트럴 유지).
- **사용량**: 벤더 3카드(면적 스파크라인 SVG + 정상/미설정/실패 상태) + **일별 총 비용(USD) 면적 그래프**(Soniox+OpenAI 합산;
  Cartesia 는 크레딧 단위라 합산 제외, 카드에서 확인) + 제목행 7/30/90일 세그먼트(활성=보라). 일자별 <title> 네이티브 툴팁.
  캡션 2건("벤더 청구 API 기준…", "응대 로그 기반…")은 사용자 지시로 미표기. '기록 시작일…' 푸터도 제거.
- **데스크 운영 통계(v3)**: KPI 4타일(오늘 응대·어제 대비% / 평균 응대 시간·중앙값 / 응대당 문장·안내원·손님 / 누화 드랍%)
  + 일별 응대 막대(고정 14일, 마지막=오늘 진하게) + 언어 분포 가로바(상위4+기타, 순위별 투명도) + **응답 지연(중앙값·P90)**.
  데스크 선택=네이티브 select(사용자 지시), CSV 내려받기 유지. **드랍된 기존 뷰**: 시간대별 분포·길안내 타일/상위시설·기간(7/30/90/전체)·월별 토글
  — CSV 원자료로는 계속 산출 가능. 응답 지연은 `desk-stats` 가 **respDelays**(손님 tm.e→다음 안내원 tm.s, 0<d<2분, 응대당 수집,
  건별 최근 300) 반환, 중앙값/P90 은 클라 계산('전체'는 배열 합산). 기존 로그(tm 없음)는 빈 상태 문구.
- 잔재 정리: AdminPage 의 미사용 FaqPanel·EmptyTab·BarRow·MetricBox 삭제(7b16e51 때 라우트만 지우고 컴포넌트가 남아 있었음).
- 검증: 빌드·테스트 8/8, 프리뷰(라이트/다크)에서 하위메뉴 전환·보라 차트·KPI·select 전환·응답지연 빈 상태 확인, 콘솔 무오류.

## 2026-07-16 — 테스트 잔재 삭제 + 운영 보강 + 레이턴시 로그(tm) + README
### 삭제(과도한 복잡성 조치)
- **deepgram 파이프라인 전부 삭제**(runDeepgram·endpointing·PIPES·ENDPOINTS·kac-dg-endpointing), **multi(다국어 회의) 전부 삭제**
  (runSoniox multi 분기·multiLangs·SITUATIONS 카드·모드 셀렉터·표시 언어/칩 UI·kac-multi-langs), **FAQ(자주 묻는 질문) 삭제**
  (FaqPanel·faq-report/analyze 라우트·faqReport 저장), **번역 모델 셀렉터(테스트) 삭제**. 기존 multi/deepgram 세션은 열람만(지원 종료 라벨).
- 고급 설정을 **섹션 캡션**으로 구획: 마이크 / 발화 인식(끊김 조절) / 실험 기능(β=RNNoise·confFix·응답어 등).
### 운영 보강
- **연결 상태 인디케이터**: 세션 헤더 제목 옆 점(초록=정상·노랑=재연결 중·회색=중지) — status 문구 파생 + start/stop 직접 갱신.
- **데스크 현황판**: `GET /api/desk-status`(호스트 연결·응대 중·손님 언어·뷰어 수, ctrl.state()) → 데스크 목록 행에
  상태 칩(응대 중·LANG/대기/오프라인 · 뷰어 n) 10초 폴링.
- **전체 백업**: `GET /api/admin/export`(sessions+deskLog·deskRegistry·termsConfig·canned 를 JSON 1파일, Content-Disposition) →
  관리자 시스템·보안 탭 '전체 데이터 백업(JSON)' 버튼.
### 레이턴시 분해 로그 — 별도 로그 없이 대화 item 에 통합(item.tm)
- `item.tm = { s(첫 토큰), e(<end>), c(확정), tq(TTS 요청), ta(TTS 첫 오디오) }` (epoch ms) —
  runSoniox(전체) + runDesk 직원/여객(s/e/c). **저장 전용**: buildMsg 미포함이라 뷰어/브로드캐스트에 안 실림.
  TTS 는 발화당 첫 문장 기준(stampTm — 커밋 전이면 utterTm 보류 후 병합). 분석식·활용은 README '로그 분석 방안' 표 참고.
- README.md 전면 최신화: 기능 표·실행·**로그 스키마(item/deskLog)·분석 방안 표**·구조 요약. (구 whisper 시절 내용 폐기)
### 관리자 개편(#6)은 미구현 — HTML 시안 검토 대기
- 시안 아티팩트: 좌측 nav 하위메뉴(탭 제거)·상단 제목+전폭 컨텐츠·시그니처 보라(#5B4FE8) 그래프·데스크 통계
  KPI 타일+응대 추이+언어 분포+응답 지연(신규 tm 기반). 승인 후 구현 예정.
