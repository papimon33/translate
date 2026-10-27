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
- 옵션 숨김 토글: 콘텐츠 중앙·헤더 밀착 탭(공간 미차지, 숨김 시 opacity 0.4). 텍스트 크기 슬라이더(고급설정, `kac-font-scale`).

## 운영/보안 (SECURITY_GUIDE.md 참고)
- `FORCE_HTTPS=1` http→https 리다이렉트. 관리자 **2FA(TOTP)**: env `ADMIN_TOTP_SECRET` 우선, 아니면 관리자>시스템·보안에서 설정(data/security.json). 로그인 시 `need2fa` 응답 → Login.jsx 코드 입력. `DATA_KEY` 설정 시 data/*.json **AES-256-GCM 암호화**(평문 하위호환, security_util.js).
- 관리자 탭: **데스크 통계**(GET /api/admin/desk-stats — deskLog 기반 응대수·언어분포·평균시간(deskLog.startedAt)·일별, 대화 내용 미노출) / **시스템·보안**(GET /api/admin/health — 가동시간·연결수·보안상태·최근 서버/브라우저 오류, POST /api/client-log 수집).
- **오번역 검사**: 관리자>용어 설정 → '최근 전체 검사' 또는 '대상 선택…'(세션·안내데스크 체크) → POST /api/admin/terms-suggest {sessionIds?} (일반 대화 + 데스크 응대 로그 원문·번역 200쌍을 GPT 검수 → 용어 후보 추천 → '추가'로 translationTerms 반영).
- **관리자 '로그' 탭**: GET /api/admin/logs(데스크 응대 건 메타 + 세션 메타) / logs/desk/:sid/:idx·logs/session/:id (대화 전문). 건당 시각·길이·언어·문장수·누화드랍 표시, 클릭 시 전문(안내원/손님·마이크/시스템 구분) 펼침.
- 모바일: 세션 화면 옵션바 기본 접힘(<600px), 타이틀바·간격 축소, 하단 버튼 세이프에어리어. 관리자 카드류 borderRadius 3→2.
- 테스트: `npm test` = smoke + `test/security.test.mjs`(base32/TOTP RFC 벡터/암호화 라운드트립·변조감지/에코 매칭) + `test/boot.test.mjs`(더미 키로 실제 기동→/health).
- **전면 감사 후 안정화(49건 수정)**: 공개 GET 세션은 화이트리스트 필드만(deskLog 등 미노출) · 운영 기동 게이트(AUTH_SECRET/ADMIN_PASSWORD 필수, ALLOW_INSECURE=1 우회) · 쿠키 토큰 30일 만료(id.ts.sig — 구 쿠키는 재로그인 1회) · WS 하트비트 30s(ping/pong, 죽은 소켓 락 해제) + 빈 room GC · 세션 삭제 시 연결 강제 종료·부속맵 정리 · 원자적 파일 쓰기(tmp+rename) · JSON 바디 기본 256kb(terms-config만 16mb)·client-log IP당 분당 10회 · api.js json 이 r.ok 검사(오류 전파) · 에코/crossDup 매칭은 길이비 0.6 이상만(따라 말하기 오탐 제거) · 중복 확정은 5초 창 내만 · 빈 커밋/에코 드랍 시 클라 카드 제거(sentence 빈 페이로드=삭제 규약) · runSoniox 자동 재연결+全 pending 큐 24프레임 상한 · runWhisper flush 보류 재실행(마지막 문장 유실 수정) · desk endConversation 은 현 등록 ctrl 만 세션 조작(좀비 가드)+guestCommit 포함, 여객 스트림 소유 소켓만 수용, wayfind 비동기 세대 가드 · langVotes 동률 유지 · takeover 레이스(클라 stop 후 제어 메시지 무시)+호스트 WS 자동 재연결(audio.js wire/pipe.ws) · 언마운트 시 stopReq 로 권한 대기 레코더 정리 · desk.html enterStage 재진입/thanks 타이머/절전 후 meta 동기화(started 재전송 제거)/keepalive 보류 재전송/지도 스크립트 재시도 상한/#stage 스페이서 스크롤 · mobile.html connect 중복 가드/PTT 재접속 재전송·이중탭 가드·백프레셔/카드 300개 상한 · desktop mac loopback 분기.
- **안내데스크 태블릿 3건(2026-08-01, 설계 `docs/superpowers/specs/2026-08-01-desk-tablet-access-language-consent-design.md`)**:
  ① **공개 목록에서 뷰어 토큰 제거** — `GET /api/desk-sessions` 가 무인증인데 `t: viewerToken(s.id)` 를 실어
  보내, 인터넷에서 누구나 진행 중인 승객 대화를 수신하고 `desk-end` 로 응대를 원격 종료할 수 있었다
  (`deskCtlAllowed` 는 빈도만 제한). 토큰은 세션 파생 HMAC 이라 만료가 없다 — 바꾼 것은 수명이 아니라
  **얻는 경로**로, 이미 인증 게이트(`viewerAccessOk` — `currentUser` 만 확인, 로그인한 직원이면 누구나 통과하고
  `role==='admin'` 은 요구하지 않는다)가 있는 `GET /api/qr?session=..` 로만 배포한다.
  ⚠ 랜딩 목록 선택 경로가 사라지지만 **안내원 부담은 줄어든다** — 그 경로는 매 부팅 데스크를 탭해야 했고,
  세션 QR 로 설치한 태블릿은 부팅하면 바로 그 데스크다. 회귀 테스트 `test/desk-access.test.mjs`,
  헬퍼 `deskToken()`(`test/helpers/boot.mjs`) — 기존 데스크 E2E 3개도 이 경로로 이관.
  ② **손님 언어 12개 스크롤 리스트** — `en ja zh vi th id ru tl es fr de ar`. 드럼 휠 대신 리스트인 이유:
  김포 국제선은 en/ja/zh 가 대다수인데 휠은 그 손님까지 스핀+확인 2동작을 요구한다. ⚠ **몽골어(mn)는 제외** —
  `LANGNAME` 에는 있으나 `SONIOX_LANGS` 에 없어 명시 선택도 자동감지도 불가(엔진 제약, 벤더를 바꿔도 동일).
  함께: `startConversation` 이 `GUEST_LANGS` 밖 선택을 조용히 `'en'` 으로 바꾸던 폴백 제거 → `SONIOX_LANGS`
  (60개)로 검증하고 미지원이면 자동감지로. **`GUEST_LANGS` 는 그대로 둔다** — 자동감지 `language_hints`
  전용이라 늘리면 힌트가 희석된다.
  ③ **개인정보 고지 모달** — 언어 선택 → 그 언어로 고지 → `[동의하고 시작]` → 발화 대기. 손님당 1회
  (응대 종료 후 다음 손님에게 다시). 자동감지 경로는 한국어+영어 병기, 아랍어는 `dir=rtl`.
  동의 시각은 `desk-start` 의 `consent` 필드 → `deskLog[].consentAt`(구버전 캐시 클라는 안 보내므로 생략 허용).
  문구에 **'AI 학습'은 쓰지 않았다** — 실제로 학습에 쓰지 않고, 그렇게 쓰면 별도 동의가 필요한 처리로
  해석될 여지가 있다. 보유기간·국외이전 업체명을 담은 전체 처리방침은 기관 산출물(범위 밖).
  고지 화면은 `desk-reset` 수신 조건에 `pendingLang` 을 포함시키고 45초 방치 타이머를 둬야 한다 —
  안 그러면 손님 A가 미동의 이탈한 뒤 손님 B가 A의 언어로 시작된다.
  하단 종료 버튼은 `--fs`(손님 글자 배율)에 연동돼 커지므로, `#stage` 하단 여백과 `#idleWarn`·`#toast`
  위치가 CSS 변수 `--endH`(버튼 실측 높이)를 따라가야 한다. 고정값이면 큰 글씨에서 말풍선이 가린다.
  ④ **코드로 해결 못 하는 운영 사항** — 안내원이 **노트북을 덮으면 그 데스크가 오프라인**이 된다. OS 절전으로
  마이크 캡처와 WS 가 끊기고 손님 화면은 '안내원 준비 중'이 된다. 덮개를 열면 조작 없이 복구되는 것은
  `test/desk-host-recovery.test.mjs` 로 확인했으나(급이탈·승계 두 경우 모두), 덮혀 있는 동안은 죽어 있다.
  게다가 하트비트가 30초(`HEARTBEAT_MS`)라 서버가 이탈을 알아채기 전 최대 30초 동안 태블릿은 데스크를
  '가동 중'으로 표시하고, 그 사이 손님이 언어를 고르면 Soniox 가 열려 과금된 채 무음 종료를 기다린다.
  → 전원 설정에서 "덮개를 닫을 때: 아무 것도 안 함" 으로 두거나 화면만 끄도록 운영 지침에 넣을 것.
- **Soniox 헤더 인증(2026-10-27)**: start(config) 메시지의 `api_key` 가 2027-01-15 에 중단되므로 Soniox 실시간 STT 접속 4곳(실시간 번역·데스크 안내원/여객 채널·용어 실검증)을 `openSonioxWs()`(`Authorization: Bearer <SONIOX_API_KEY>` 헤더)로 바꾸고 config 에서 키를 뺐다. `test/soniox-auth.test.mjs`(가짜 엔진이 `conn.headers` 기록). `eval/*.mjs` 3개는 아직 구 방식.
- **주소 정리(2026-10-27, 배포 전이라 일괄 변경)**: 사용자에게 보이는 주소를 짧고 의미 있게.
  · QR 참여 = `/j/<참여 코드>`(6자리, 0·O·1·I·L 제외 31자), 코드 입력 화면 `/j`, 안내데스크 태블릿 = `/desk/<코드>`·랜딩 `/desk`, 오버레이 `/overlay`, 앱 받기 `/app`.
    세션마다 `joinCode` 를 한 번 만들어 저장(`ensureJoinCode`, 인쇄 QR 유지). 서버가 뷰어 페이지(`dist/viewer/*.html`)에 `window.__JOIN={session,t,code}` 를 심어 보낸다
    (코드 = 뷰어 토큰과 같은 권한). JSON 은 `/api/join/:code`. 틀린 코드는 IP 당 10분 20번 넘으면 429. `/api/qr` 은 `{url, qr, code}`.
    데스크 홈 화면 바로가기(manifest start_url)도 `/desk/<코드>` — 토큰을 주소에 싣지 않아도 재실행 후 바로 접속. 예전 `/mobile.html?session&t`·`/desk.html` 은 새 주소로 301.
    안드로이드 앱은 경로에 'desk' 가 있으면 손님 태블릿 모드 → 안내데스크 세션은 꼭 `/desk/…`(`/j/<데스크 코드>` 는 `/desk/<코드>` 로 302).
  · 뷰어 파일 이동: `client/public/{mobile,desk,overlay}.html` → `client/public/viewer/{join,desk,overlay}.html`.
  · PC 화면 주소: `/` 목록, `/s/<세션>`, `/desks`(안내데스크 목록), `/admin/<탭>` — 새로고침·즐겨찾기·링크 공유 가능(App `pathOf`, 로그인 후 첫 주소 해석). 폰 화면은 주소를 쓰지 않음.
  · 그대로 둔 것: `/api/…`, `/ws/…`, 설치된 앱이 업데이트에 쓰는 `/download/desktop?platform=`.
  · 폰·PC 링크 공유 시트에 참여 코드 크게 + "airtalk.kr/j 에서 입력". 앱 다운로드 화면(폰 브라우저)에 "참여 코드로 보기"(/j). 테스트 test/join-code.test.mjs.
- **운영 도메인 airtalk.kr(2026-10-27)**: 가비아 등록, DNS = A `@` 216.24.57.1 + CNAME `www` translate-voxm.onrender.com.(Render 문서 값). Render Custom Domains 에
  airtalk.kr 추가 → 인증서(Google Trust Services) 자동, www·http 는 https://airtalk.kr 로 301. 옛 주소 translate-voxm.onrender.com 도 같은 서비스라 계속 동작.
  · 서버: 환경변수 `PUBLIC_HOST=airtalk.kr` 이면 QR(뷰어·데스크 랜딩 링크)을 항상 https://airtalk.kr 로(`/api/qr`, test/public-host.test.mjs). Render 대시보드에서 설정 필요.
  · 앱 기본 주소: 안드로이드 `DEFAULT_URL` = https://airtalk.kr(1.4.4, versionCode 10), 데스크톱 `desktop/main.js` SITE 동일(데스크톱은 태그/수동 빌드 때 반영).
    주소(출처)가 바뀌므로 앱 업데이트 후 첫 실행에 한 번 다시 로그인, 기기 저장 설정(입력 감도·자동 감도·스테레오 기억·세션별 언어 기억)은 초기화 — 계정 동기화 항목(언어·테마·글자 크기·TTS 음성)은 로그인 후 복원.
- **폰 목록 길게 누르기(2026-10-27)**: 세션 줄을 0.5초 누르면(손가락이 10px 이상 움직이면 취소, PC 는 우클릭) 이름 바꾸기·세션 삭제 시트
  (`MobileApp` 의 `SessionRow`). 이름 바꾸기 = FormSheet → `api.patch`, 삭제 = 확인 창(데이터 손실 명시) → `api.remove` → "세션을 삭제했습니다." 목록 모드 아이콘 선 굵기 2.4.
- **PC 새 화면 테스트(?ui=v2, 2026-10-26)**: 주소에 `?ui=v2` → 이 브라우저에 기억(`kac-pc-ui`), `?ui=v1` → 원래 화면. 기본은 기존 화면 그대로.
  · 전체: `buildTheme(mode, { brand: true })` — 보라 주색(버튼·스위치 등)·흰 바탕·더 둥근 버튼/대화상자. 사이드바(Nav v2)는 옅은 회색 + `airtalk.` 로고 + 선택 항목 옅은 보라.
  · 세션 목록(SessionList, 데스크 제외): 폰 목록과 같은 줄 — 모드 아이콘 + '날짜 · 언어'(공용 `mobile/sessionMeta.jsx`, 폰 홈도 이걸 씀).
  · 세션 화면(soniox 실시간 번역·양방향만): 폰 세션 화면 `MobileLive` 를 `desktop` 으로 — 메뉴 항상 표시, 대화 가운데 820px 열, 조작판 가운데 520px,
    큰 설정은 오른쪽(420px, 우상단 설정 버튼). PC 전용 줄(`pc/PcRows.jsx`): 음성 입력(마이크/PC 소리/둘 다)·마이크 장치·모드·고급 설정(기존 대화상자 그대로)·오버레이 창(데스크톱 앱).
    PC 소리만 들을 땐 대기 중 마이크 미터를 끔(`meterOff`, 권한 안 묻게). 안내데스크 세션·구 파이프라인·관리자 화면은 기존 구조(색만 보라).
  · 바텀 시트는 넓은 화면(sm 이상)에서 가운데 폭 520(`common.jsx` BottomSheet).
- **언어별 글꼴(2026-10-26)**: 한국어·영어 Pretendard(기존), 일본어 Pretendard JP(`Pretendard JP Variable`, jsDelivr dynamic-subset), 중국어 Noto Sans SC(Google Fonts).
  `index.html`·`mobile.html` 의 `[lang|="ja"]`·`[lang|="zh"]` 규칙(!important — MUI 글꼴 지정보다 우선)으로 lang 이 달린 요소에만. 글꼴 파일은 그 글자를 쓸 때만 받는다.
  폰 앱: `Line`/`Bubble` 의 번역문·원문에 lang(번역 키·`m.lang`), 화면 언어가 일본어면 `MobileApp` 이 html lang=ja. 뷰어: 문장·언어 버튼·html lang 이 이미 달려 있음.
  PC 화면 대화 줄(Row)은 언어 정보를 안 넘겨서 미적용(기존 Pretendard → Noto Sans KR 대체 그대로).
- **시작 전 마이크 확인 + 마이크 2 즉시 연결(2026-10-26)**: 양방향 통역은 세션 화면에서 첫 시작 때 `MicCheckDialog` 를 반드시 거친다(마이크 1개여도, 건너뛰기 없음.
  같은 세션 화면에서 다시 시작할 땐 생략). 마이크 2개면 호스트·마이크 1 | 상대방·마이크 2 — 말소리(미터 36 이상)에서 한쪽이 약 8dB(13) 넘게 크면 그쪽 강조,
  3번이면 '확인됨'. 둘 다 → '시작'(stereoKnown: 판별 없이 2채널, 상대 채널 `src=mic2` 도 처음부터), 마이크 1만 → '마이크 1개로 시작'(stereoForget, 1채널).
  마이크 1개(1채널 장치·모노 복사·확인 중 좌우가 계속 같음)면 '마이크' 카드 하나 — 경고 없이 1채널로(2채널 장치였으면 stereoForget).
  대기 중 미터가 좌우 상관으로 말하기 전에도 판별(`useIdleMeter` 의 layout: 상관 0.98 초과 = 모노 복사본, 0.9 미만 = 따로 들어옴) → 감도 슬라이더 1·2개,
  확인 창 카드 수, 상태 문장(`stereoMsg`)에 쓴다. 지난번 '스테레오' 기억으로 시작할 때도 상대 채널을 처음부터 연다(마이크 2 첫 문장 지연 없음, 대신 연결 2개·요금 2배).
  표기는 '송신기 1(왼쪽)/2(오른쪽)' → '마이크 1/2'.
- **마이크별 입력 감도(2026-10-26)**: 양방향 통역에서 마이크 2개로 나눠 들을 때(대기 중 미터 판별 / 번역 중 모노 판정 전) 큰 설정 '입력'에
  감도 슬라이더 2개 — 마이크 1(채널 1)=`micSens`, 마이크 2(채널 2)=`micSens2`(기기 저장 `kac-mic-sens2`, 없으면 송신기 1 값). 각 슬라이더의 진한 선 = 그 채널 입력 크기.
  audio.js 스테레오 `feed` 가 채널별 게이트(`micRatio2`·`micAbsMin2`…, `setMicSens2`)를 쓴다. 자동 감도는 두 채널 모두. 1채널(실시간 번역·모노 판정)은 슬라이더 하나.
  예전 송신기 막대 상자(ChannelMeters)는 슬라이더 막대로 대체하고 상태 안내 문장(`stereoMsg`)만 남김. 설정 화면의 감도는 송신기 1(기본) 값.
- **화면 문구 정리(2026-10-26)**: CLAUDE.md '화면 문구 규칙' 신설(이후 문구도 이 규칙). 폰 앱(i18n ko/en/ja)·안내 띠(TranslateView)·안드로이드 토스트·뷰어 문구를
  짧게(상태=완료 사실만, 오류=원인+해결), 용어 통일("시작 버튼"·"이 기기"·"번역 서비스"·줄표 대신 마침표). 일반 화면에서 삭제: 앱 정보의 진단 문장(AGC·chrome://inspect),
  관리자 계정 안내, 서버 주소 설명, 블루투스 음질 경고. 내보내기 토스트 "녹취록을 저장했습니다" → "파일로 내보냈습니다". 안 쓰는 i18n 키 정리. 앱 1.4.3(versionCode 9).
  양방향 말풍선: 같은 방향('한국어 → 일본어')이 연달아 나오면 첫 말풍선에만 방향 표시(앱 MobileLive·뷰어 `applyWhoRuns`).
- **글자 로고 'airtalk.'(2026-10-26, 시안 B)**: Nunito 900 소문자 + 보라 마침표 — `client/src/components/Wordmark.jsx`(폰 홈 제목 26px, 폰 로딩 화면 `WordmarkSplash`).
  글꼴은 index.html 에서 Google Fonts `Nunito:wght@900&text=airtlk.`(로고 글자만 받는 작은 파일). 안드로이드 시작 화면(MainActivity 오버레이)은 흰 바탕 가운데
  같은 모양 그림 `res/drawable-nodpi/splash_wordmark.png`(브라우저 캔버스로 Nunito 렌더, 폭 160dp) 하나만 — 진행 표시·'연결하는 중' 문구 없음, 연결 실패 화면은 그대로.
  시작 화면은 페이지 다운로드 끝(onPageFinished)이 아니라 웹이 첫 화면을 다 그린 뒤 `AndroidApp.ready()` 로 닫는다(env.js `appReady` — 로그인 화면 마운트,
  홈은 목록 로드 후). 신호가 없으면 다운로드 끝 6초 뒤(`SPLASH_MAX_MS`) 닫힘. 그래서 웹에는 따로 시작 화면이 없다(폰 로딩 상태는 빈 흰 화면).
  앱 바탕색 BG #FAFAF8 → #FFFFFF. 앱 1.4.2(versionCode 8).
  로그인·앱 다운로드 화면(`Wordmark` 40px)과 QR 뷰어 입장 화면(`mobile.html` `.lbrand`, 같은 Nunito 링크)도 아이콘+'AirTalk' 대신 이 로고.
- **시트 쓸어내려 닫기(2026-10-26)**: `common.jsx` `BottomSheet` 를 `SwipeableDrawer`(쓸어 열기 끔·`keepMounted:false`)로 — 새 세션·언어·마이크·TTS 음성·이름 수정·링크 공유 등
  아래에서 올라오는 시트 전부 아래로 쓸어내리면 닫힘(목록이 스크롤돼 있으면 먼저 목록이 올라감, 짧게 끌면 제자리). 닫히면 `useBackClose` 가 히스토리도 정리.
  keepMounted 를 켜 두면(SwipeableDrawer 기본) 닫힌 시트 내용이 늘 떠 있어 입력 시트 autoFocus 가 열 때 안 먹으므로 끔. 큰 설정 패널도 같게.
  QR 뷰어(`mobile.html`) QR 시트도 터치로 80px 넘게 내리면 닫힘.
- **모바일 웹도 앱과 같은 화면(2026-10-26)**:
  · 폰 브라우저 호스트: `env.js` 의 `MOBILE_UI` 에 `PHONE_BROWSER` 포함 — iPhone 은 '웹으로 계속' 뒤 로그인하면 앱과 같은 `MobileApp`(목록·세션·설정).
    안드로이드 폰 브라우저는 그대로 앱 다운로드 화면. 브라우저 경로는 마이크 미터·녹음 모두 getUserMedia(스테레오 불가 → 1채널), 장치 고르기 없음(지금 장치 이름만).
    번역 중 화면 꺼짐 방지는 앱=네이티브, 브라우저=Screen Wake Lock(TranslateView). 링크 공유 버튼은 브라우저에서 Web Share.
  · QR 뷰어(`client/public/mobile.html`): 앱 세션 화면과 같은 모양 — 흰 바탕, 위 세션 이름(+라이브 점)·양방향 내 언어 세그먼트(알약),
    우상단 아이콘 4개(가−·가+·듣기=헤드폰·QR, Lucide, 배경 없이 — 듣기 켜짐만 옅은 보라 배경. 처음엔 하단 떠 있는 조작판이었다가 사용자 요청으로 우상단 복귀). 문장은 앱 `Line`/`Bubble` 과 같은 크기·색
    (단방향 22px·원문 14.5px / 말풍선 19px, 원문도 말풍선 안 — 카드에 `.bub` 묶음 추가). 최신 문장 파랑 강조는 앱에 없어 뺐다.
    QR 시트는 앱 바텀 시트 모양 + '공유'(Web Share 지원 시). 글자 크기 기준 20→22px(저장 키 `kac-mfs` 그대로).
- **폰 화면 디스코드 스타일(2026-10-26)**: 세션 화면 `mobile/MobileLive.jsx` 전면 재작성(상태·엔진은 TranslateView 그대로).
  · 아래: 떠 있는 회색 조작판(`PANEL_BG`), 글자 없는 버튼 5개 — 음소거 · TTS(`TtsIcon`, 'TTS' 글자 모양) ·
    시작/중지(보라 둥근 사각형 `BRAND`) · 언어(`TranslateIcon` = 사용자가 고른 SVG Repo 'translate-01', 선 1.9) · 종료(배경 없는 빨간 나가기 아이콘 `LogOutIcon`).
    음소거·TTS·언어는 배경 없이 아이콘만(음소거 중이면 빨간 아이콘). 크기는 디스코드에 맞춰 버튼 48px·아이콘 24px(뷰어 조작판도 같게).
    우상단 스피커·QR 도 배경 없이 아이콘 22px, 스피커 켜짐일 때만 옅은 보라 배경. 위 띠는 불투명(96% 일 때 스크롤된 글자가 비쳤다).
    말풍선 위 '말한 언어 → 번역 언어'는 그 문장의 실제 언어(`m.lang`·번역 키) — 언어를 바꾸면 예전 문장까지 새 언어로 표시되던 문제. 조작판을 위로 밀거나(포인터 28px) 손잡이를 누르면 큰 설정(`SwipeableDrawer`):
    맨 위 같은 버튼 줄 + 입력(입력 장치·자동으로 감도 조절·감도·송신기 막대) / 출력(TTS 음성 + 미리 듣기) / 세션(이름·뷰어 N명→QR·내보내기·대화 내역 삭제·세션 삭제).
    '세션 설정' 제목·TTS 마스터 스위치는 없앴다.
  · 하단 TTS = 음성 만들기 마스터(`onToggleTts`, 참가자 TTS 켜짐/꺼짐 안내). 우상단 스피커 = 이 폰에서도 재생(`ttsViewerOnly` 반대) + QR(링크 공유).
    좌상단 세션 이름은 표시만(누르는 곳 아님). 예전 마이크 칩·`<` 뒤로·'양방향 통역 · 한국어↔일본어' 부제는 삭제(나가기 = 종료 버튼·하드웨어 뒤로).
  · 토글 안내(Snackbar, 조작판 바로 위): clickaway 로 닫지 않고 `key` 로 매번 새로 띄운다 — 토글을 연달아 누르면 두 번째 안내가 그 탭에 바로 닫혔다.
  · 자동 감도(`prefs.micAuto`, 기기 전용 `kac-mic-auto`): audio.js `calcGate` 가 고정 감도 대신 주변 소음 × `AUTO_GATE_RATIO`(2.5) 기준 + `setMicAuto`. 켜면 감도 슬라이더 숨김. 설정 화면 '음성'에도 같은 토글.
  · 마이크 선택 시트(`MicSheet`)에서 '자동' 항목 숨김 — 고른 장치가 없거나 아무것도 안 골랐으면(네이티브 자동 동작) 지금 쓰는 장치(`active`)에 체크.
  · 폰 전체 바탕 순백(`MobileApp` 이 라이트일 때 `background.default=#FFFFFF` 로 감싼다, PC 웹은 #FAFAF8 그대로).
    강조 버튼은 보라(`client/src/brand.js` 의 BRAND·BRAND_DARK·BRAND_SOFT — 로그인·앱 다운로드도 여기서): + 버튼(60px 둥근 사각형)·만들기·확인/저장·업데이트·프로필 아바타·스위치.
  · 세션 목록 부제 '10/24 · 한국어 ⇄ 중국어'(오늘이면 시각). 언어는 이 폰 localStorage(`kac-sx-pair:<id>`/`kac-sx-target:<id>`) → 서버 목록의 `sxInfo`·`inLang`
    (`GET /api/sessions` 에 추가, 번역을 한 번 열어야 sxInfo 가 생김) 순. 테스트 `test/session-list.test.mjs`.
- **TTS 몰아서 나옴 대응 + 송신기 1·2 입력 막대(2026-10-25)**: 증상 — 도중에 '듣기'를 켜면 이전 문장 음성이 몰아서 나옴. 원인 ① 듣는 사람이
  없어도 문장마다 합성해 줄(`ttsChain`)이 밀리면 나중에 켠 사람에게 밀린 음성이 감 ② 상시 Cartesia WS 가 겉으로만 열린 채 죽으면 요청마다 30초
  타임아웃을 기다리고도 그 연결을 계속 써서 줄이 크게 밀림 ③ 뷰어는 화면이 꺼진 동안 예약된 음성이 복귀 시 한꺼번에(새 음성과 겹쳐) 재생, '듣기'를
  꺼도 예약분은 계속 재생. 수정(시간 기준 규칙 없이 단순하게 — 사용자 요청): ① `speakTts` 가 듣는 사람(이 호스트 `_audioOut` 또는 `hasAudioListener`
  — '듣기' 켠 뷰어, 언어 지정 시 그 언어)이 있을 때만 합성(줄 차례에 다시 확인) — 헛 Cartesia 요금도 사라짐. 세션 시작 예열('Hi.')은 기존대로.
  ② Cartesia 요청 10초 무응답이면 그 연결을 버림(`terminate`, 다음 문장은 새 연결, 같은 연결의 다른 요청은 HTTP 폴백). ③ `mobile.html` 이 예약한
  음성 조각을 기억(`srcNodes`)하고 '듣기' 끄기·화면 복귀·내 언어 변경 때 비움(`clearAudioQueue`) — 대기열은 원래 폰마다 따로라 그 폰에만 영향.
  테스트 `test/tts-listener.test.mjs`(가짜 Cartesia, 수정 제거 시 실패). 남는 것: 쉬지 않는 긴 설명이면 번역 음성이 원래 말보다 길어 조금씩 뒤처질 수 있음.
  **송신기 1·2 막대**: 휴대폰은 송신기 개수를 알 수 없다(수신기가 섞어 'USB 마이크 1개'로 보임) — 대신 양방향 통역 세션의 마이크 시트에 좌·우 입력 막대
  (`ChannelMeters`)와 상태 문구(번역 중 자동 판별: 스테레오/모노, 대기 중: '송신기마다 말해 보세요'). 대기 중에도 `useIdleMeter(active, stereo)` 가
  `startStereo()` 로 2채널을 열어 좌우를 따로 잰다(2채널을 못 여는 마이크면 막대 숨김).
- **뷰어만 멈추던 문제 대응(2026-10-22, 웹 뷰어에서 재현 보고)**: 원인 후보 — ① 망 전환·절전 복귀 후 브라우저가 끊김(close)을 못 받아
  '열린 채 죽은' 연결로 남음(뷰어는 close 를 받아야만 재연결했고, 말이 없으면 원래 아무것도 안 와서 조용함과 끊김을 구분 못 함 — 서버의
  프로토콜 ping 은 JS 에 안 보임) ② 같은 IP 8명 상한 + 재접속 순간 옛 연결이 아직 세어져 거부되면 **영구 중단** ③ 화면 꺼짐으로 탭이 쉼.
  수정: 서버가 뷰어에게 15초마다 `{type:'hb'}`(`VIEWER_HB_MS`, 패시브 호스트 뷰어 제외) → `mobile.html`·`desk.html` 이 마지막 수신 시각을 보고
  **35초 무수신이면 새로 연결**(5초 감시), 화면 복귀 시 20초 넘게 무수신이어도 새로 연결(`reconnectNow` — 옛 소켓 onclose 떼고 닫음).
  거부(`error`)는 15초 뒤 재시도. `VIEWERS_PER_IP` 8 → 100. `mobile.html` 은 입장·복귀 시 **Screen Wake Lock**(화면 켜짐 유지, 탭 떠나면 자동 해제 →
  복귀 시 재요청). 지난 대화 스냅샷 제한은 보류(사용자 결정). 테스트 `test/viewer-live.test.mjs`. ⚠ 브라우저 프리뷰는 Wake Lock 권한을 막아 실기기 확인 필요.
- **운영 개선 6건(2026-10-22)**: ① **내보내기**(구 '녹취록 저장', PC 툴팁도): 내 언어(양방향 = 내 언어, 실시간 = 출력 언어)로 말한 문장은 원문 그대로,
  다른 언어 문장은 내 언어 번역 + 다음 줄 `(원문)` — 예전엔 표시 언어 칸만 찾아 양방향에서 내 한국어 말이 일본어 번역으로 저장됐다. ② **음소거 5분 지속 →
  번역 자동 중지**(`MUTE_AUTOSTOP_MS`, 데스크 제외) — 음소거 중에도 무음 전송 + '사용 중' 신호로 1분 유휴 중지가 안 걸려 계속 과금되던 것. ③ **앱 빌드 자동**:
  `main.yml` 이 main 푸시 중 `android/**` 변경이면 APK 만 빌드·게시(데스크톱 설치본은 태그·수동 실행에서만 — `build` 잡 if). ④ 폰: 나가기(뒤로가기·화살표·
  종료 버튼)는 **번역 중일 때만 확인**, 새 세션 이름 기본값 `10/22 14:30 양방향 통역`(직접 고치기 전엔 모드를 따라감, 필수 유지), 계정 화면 이메일 숨김(서버 필드 유지).
  ⑤ **뷰어 수**: `GET /api/sessions/:id/viewers`(소유자·관리자, 패시브 뷰어 제외) 를 폰이 5초마다 → 부제목 '· 뷰어 N명'. 폰은 번역 전에 호스트 소켓이 없어
  WS 푸시 대신 폴링. ⑥ **일반 세션 삭제 = 완전 삭제**(대화 기록이 관리자 로그에 남지 않음, 확인 문구도 변경) — 안내데스크 세션은 기존 소프트 삭제 유지.
  ⚠ 이전에 소프트 삭제된 일반 세션(관리자 로그의 '삭제됨')은 자동 정리하지 않았다 — 관리자 로그에서 삭제 가능. 테스트 `test/session-delete.test.mjs`.
- **폰 TTS 두 단계로 정리(2026-10-22)**: '뷰어에게만 음성 보내기'가 헷갈린다는 의견 → **세션 설정 'TTS (번역 음성)' = 음성을 만들지**(켜면 링크로
  접속한 뷰어에게 감, `kac-sx-tts`), **하단 TTS 버튼 = 이 폰에서도 틀지**(`kac-tts-viewer-only` 의 반대). 음성을 안 만드는 동안 하단 버튼은 흐리게,
  누르면 '세션 설정에서 TTS를 켜면…' 안내. 서버·저장 키는 그대로(`setTts(on, gender, local)`), PC 웹 화면은 기존 그대로.
- **폰 화면 아이콘 → Lucide(2026-10-22)**: '아이콘 비교' 시안(지금 Material Icons / Lucide / Material Symbols Rounded)에서 사용자가 Lucide 선택.
  `lucide-react@1.52.0`(정확한 버전 고정 — 최신 1.61 은 하루 전 릴리스라 2주 넘은 버전 사용). `mobile/icons.jsx` 래퍼가 MUI 아이콘처럼
  `sx={{ fontSize, color }}` 를 받고 선 굵기 1.75, 시작 버튼의 재생만 채움. 폰 화면(mobile/*)만 교체, PC 웹은 MUI 아이콘 그대로.
- **폰 화면 후속 13건(2026-10-21)**: ① **뒤로가기 = 열린 시트·확인 창만 닫기** — `mobile/backstack.js`(창이 열려 있으면 history 항목 1개를
  더 쌓고, popstate 가 그걸 꺼내면 맨 위 창을 닫은 뒤 `stopImmediatePropagation` 으로 MobileApp 에 안 넘김. 화면에서 닫으면 우리가 꺼냄, 시트→시트
  전환은 0ms 지연으로 꺼냈다 쌓지 않음. 화면 이동은 `pushNav`(창 항목 자리를 덮어씀)·`backNav`(창 항목까지 한 번에 go(-n))). `BottomSheet`·
  `ConfirmDialog`·텍스트 크기 화면이 `useBackClose` 사용. ② **세션에서 뒤로가기(하드웨어·헤더 화살표) = 종료 확인** — MobileApp 이 popstate 에서
  세션을 다시 붙잡고(`pushState {m:'session'}`) `backAsk` 신호 → MobileLive 가 종료 확인. 확인 = `leaveOk` 후 `backNav`. ③ 새 세션 입력 언어는 항상
  자동 감지(`kac-sx-in` 기억 삭제). ④ 홈 톱니 배경 삭제. ⑤ 설정 음성에 '연결된 기기'(공용 `MicSheet` — 세션 마이크 시트와 같은 목록). ⑥ 설정에
  '버전 x.y.z' + 오른쪽 '최신 버전' 또는 '업데이트 (새 버전)' 링크(`useAppVersion`, `UpdateSheet manual`). ⑦ 텍스트 크기 = 전용 화면(예시 대화 +
  하단 막대, 바로 반영). ⑨ 시작/중지 글자 삭제(원형 버튼만, 시작 중 스피너). ⑩ 하단 막대 높이 축소. ⑫ **세션 대기 중에도 마이크만 켬**
  (`useIdleMeter` — 엔진·과금 없음, 마이크 칩 막대·감도 시트에 입력 크기, 화면 꺼지면 끔). 시작 = 미터를 먼저 끄고(네이티브 캡처 반납) 80ms 뒤 번역 시작,
  중지하면 미터 재개. ⑬ 감도 안내 '말소리가 초록색 구간에 오도록 마이크 감도를 조절하세요.'
  ⑪ **'최신인데 마이크 선택이 안 됨'의 원인: 앱 빌드 워크플로(`main.yml` Desktop Build)는 태그(desktop-v*)·수동 실행에서만 돈다** — main 푸시로는
  APK 가 안 만들어져 1.4.0 이 없었다(폰은 1.3.0 → inputs() 없음 → '앱을 업데이트하면…'). `gh workflow run main.yml` 로 수동 실행해 1.4.0 게시.
  **앱(네이티브) 변경 후엔 반드시 이 워크플로를 수동 실행할 것.** 덤: CI(ci.yml) 테스트가 Node 20 에서 `test/*.test.mjs` 패턴을 못 펼쳐 계속 실패하던 것 → Node 22.
- **모노 양방향 언어 판정 실측 + 판정 버그 수정(2026-10-21)**: 아이폰 호스트(스테레오 불가) 대비 위험도 측정. macOS 음성(say: Yuna·Kyoko·
  같은 목소리 Eddy 한/일)으로 공항 견학 한↔일 대화 41문장(짧은 응답·고유명사·외래어·영어·섞어 말하기·0.6초 빠른 교대) 3분을 실제 서버(runSoniox,
  실제 Soniox, 격리 DATA_DIR) 모노 양방향으로 재생 → **수정 전 41문장 중 1문장 방향 뒤집힘**(일본어 'スマートフォンで…' 카드가 lang=ko, 번역 칸 ja 에
  한국어 문장). 원인: 엔진이 처음 응답들에서 같은 비확정 토큰을 한국어 '스마트폰'으로 보냈다가 확정은 일본어로 냈는데, 서버가 **응답마다 비확정
  토큰까지 다시 세** 초기 오판 표가 확정 정답을 이김. 수정: `langJudge()`(runSoniox·데스크 직원/여객 채널 공용) — ① 확정 번역 토큰의
  `source_language`(Soniox 가 번역 토큰에 실어 줌 = 실제 번역 방향, 카드 번역 칸과 항상 일치) ② 확정 원문 다수결 ③ 확정 전엔 그 응답의 비확정만(누적 안 함).
  **수정 후 같은 대화 41/41**. 회귀 테스트 `test/lang-judge.test.mjs`(수정 제거 시 실패 확인). 남는 위험: 엔진 자체 오판 — 같은 오디오를 Soniox 에 직접
  보낸 한 번은 그 일본어 문장을 한국어로 받아쓰고 다음 한국어 답과 한 카드로 합침(실행마다 다름, 외래어로 시작하는 짧은 문장·같은 목소리에서).
  측정 스크립트는 세션 scratchpad(`lidtest/`)에 있었음 — 재측정 시 say + afconvert 24kHz 모노 + 호스트 WS 실시간 송출로 재현 가능. 비용 1회 약 18원.
- **로그인 화면 정리 + 휴대폰 브라우저는 앱 설치로(2026-10-21)**: ① `Login.jsx` — 상자(Paper) 없이 흰 배경, 'ID와 비밀번호로 로그인하세요' 삭제,
  아이디 저장·자동 로그인 선택 삭제(**항상 자동 로그인** = remember true, 30일 쿠키), 버튼 '입장'→'로그인' + 로고 보라(`BRAND #5B4FE8`),
  입력칸 `autoCapitalize=none`·자동 수정 끔(폰 키보드가 ID 첫 글자를 대문자로 바꾸던 문제). ② **휴대폰 브라우저(앱 아님)는 로그인 대신
  `AppDownload`**(`env.js PHONE_BROWSER` = UA 'Android…Mobile' 또는 iPhone, 앱·태블릿·iPad·`?mobileui=1` 제외, 로그인 여부와 무관) —
  '앱 다운로드' = 새 **공개** 라우트 `GET /download/android`(최신 APK, 공개 GitHub 릴리스와 같은 파일이고 앱도 로그인해야 쓰므로 공개 무방.
  데스크톱 설치본 `/download/desktop` 은 그대로 로그인 필요 — 공통 처리는 `sendLatestInstaller`). iPhone 은 앱이 없어 '웹으로 계속'(그 탭 동안 `kac-web-ok`).
  QR 뷰어(`mobile.html`)·안내데스크(`desk.html`)는 별도 페이지라 영향 없음.
- **폰 화면 v2 + 계정·옵션 동기화 + 마이크 선택 + 뷰어 개편(2026-10-21, 앱 1.4.0)**: 시안 v2(claude.ai 아티팩트 'AirTalk 폰 앱 시안' v2 페이지) 승인 후 구현.
  - **홈**: 우상단 톱니 = 설정(전체 화면, 오른쪽에서 밀려 나옴), 마이크 칩 삭제, 새 세션은 둥근 [+]. 새 세션 시트: 제목 문구 삭제, 언어는
    번역 `[입력] → [출력]`(입력 자동 감지 기본, 출력 = 모국어) / 통역 `[내 언어] ⇄ [상대 언어]`(내 언어 = 모국어), **세션 이름 필수**,
    버튼 '만들기' — **만들어도 자동 시작하지 않는다**(`_autoStart` 삭제, 세션 화면에서 [시작]). 양방향 두 언어는 세션별 기억 `kac-sx-pair:<id>`(PC 셀렉터도 저장).
  - **설정**(`mobile/OptionsScreen.jsx`): 한 화면에 언어(시스템 언어 ko/en/ja·모국어) / 음성(입력 감도 + 지금 입력 크기, TTS 음성 + 미리 듣기) /
    화면(테마 라이트·다크·시스템, 텍스트 크기) / 로그아웃. 고르는 항목은 아래 시트. 프로필 카드 → **계정**(ID·사용자명·이메일·비밀번호 변경·계정 삭제,
    관리자는 env 계정이라 사용자명·비밀번호·삭제 잠금). 새로고침·서버 주소·입력 게인 메뉴 항목 삭제(네이티브 관리 메뉴는 뒤로가기 길게 눌러 그대로).
    입력 감도 슬라이더는 손잡이 = 인식 기준선(왼쪽 끝 = 모든 소리), 값은 기존 민감도(`kac-mic-sens`) 그대로 — `micGateAbs` 역함수로 눈금 변환.
    설정 화면 미터는 슬라이더를 만질 때만 마이크를 켠다(앱 = 네이티브 캡처).
  - **옵션 저장**(`mobile/prefs.js`): 기기 localStorage 가 원본(즉시 적용), 계정 항목(sysLang·nativeLang·theme·fontScale·ttsGender)은 서버 사본 —
    로그인 후 1회 `syncWithAccount`(서버 값 있으면 따름, 없으면 기기 값 업로드), 변경은 0.7초 모아 `PATCH /api/me {prefs}`. 입력 감도는 기기 전용.
    fontScale·ttsGender 키는 세션 화면이 쓰던 `kac-font-scale`·`kac-sx-gender` 그대로. 테마: App 이 prefs 를 구독(시스템 = 기기 설정 변경 즉시 반영).
  - **다국어**(`mobile/i18n.js`): 폰 화면 문구 ko/en/ja(시스템 언어). 언어 이름은 `Intl.DisplayNames`(목록 큰 글씨 = 그 언어 자신의 이름).
    TranslateView 의 드문 안내(엔진 오류 등)와 서버 오류 문구는 한국어 그대로.
  - **세션 화면**(`MobileLive`): 하단 아이콘 5개(음소거·TTS 토글 — 아이콘·글자로 상태 표시, 시작/중지, 설정, 종료), 우상단 ⋮ 삭제 → 마이크 칩
    (내장/USB/블루투스 아이콘, 누르면 마이크 선택 + 입력 감도 시트 — 번역 중 감도 조절은 여기). **시작하면 위·아래 메뉴 숨김**, 화면을 누르면 4초간
    표시(누르는 동안 연장), 안내 '화면을 누르면 메뉴가 나타납니다'는 시작 직후 3초, 숨김 중엔 우상단 작은 빨간 점. 설정 = 세션 설정 시트
    (언어·링크 공유·녹취록 저장·뷰어에게만 음성 보내기·세션 이름 수정·대화 내역 삭제·세션 삭제). 종료 = '번역을 종료하시겠습니까? / 지금까지의 내용은 저장됩니다.'
    양방향 말풍선 라벨 '일본어 → 한국어' 식. **폰은 고급 설정 없음** — 발화 끊김(sxSens 0·maxDelay 2000·latency 0)·단독 응답어·저신뢰 교정·RNNoise 는
    기본값 고정(예전에 바꿔 둔 저장값이 화면 없이 남지 않게, PC 웹 고급 설정은 그대로).
  - **스테레오 좌우 바꾸기 기능 삭제**(사용자 결정 — 송신기 1번 = 나 고정): `audio.js` swap·TranslateView 토글·`kac-stereo-swap`.
  - **업데이트 시트**: 설명 삭제, '1.3.0 → 1.4.0' + '업데이트 (n MB)' + 나중에.
  - **MUI 9 주의**: Dialog 는 `PaperProps`/`TransitionComponent` 가 없다 — `slotProps.paper`/`slots.transition`. Drawer(바텀 시트)는 z-index 가
    Dialog 보다 낮아 전체 화면 Dialog 위에선 뒤에 열린다 → `BottomSheet` 가 `zIndex.modal + 1`.
  - **서버 — 계정·프로필**: 새 저장소 `profiles`(Mongo 컬렉션 / `DATA_DIR/profiles.json`, `{id,email,prefs,updatedAt}` — 관리자 가상 계정도 저장되게 users 와 분리).
    `GET /api/me`·로그인 응답에 `email`·`prefs`. `PATCH /api/me`: email(형식 검사, 관리자 가능)·prefs(화이트리스트, 잘못된 값이면 400·아무것도 저장 안 함,
    null = 기본값으로)·username/password(관리자 불가). **비밀번호 변경에 현재 비밀번호 필수**(PC `ProfileEditDialog` 에도 필드 추가), 최소 4자
    (관리자 생성·재설정에도 같은 규칙). `DELETE /api/me {password}`(관리자 불가) — `deleteUserAccount` 로 관리자 삭제와 공용: 사용자·세션·프로필 삭제 +
    `closeSessionRoom` 으로 그 세션의 호스트·뷰어 연결 종료(관리자 삭제 경로는 원래 연결을 안 끊었다 — 삭제된 사용자의 세션이 계속 과금될 수 있던 문제), 쿠키 삭제.
    테스트 `test/account.test.mjs`. ⚠ Mongo 모드는 실행 확인 못 함(코드는 users/sessions 패턴 그대로).
  - **앱 1.4.0 — 마이크 선택**(`NativeAudio.kt`): `AndroidAudio.inputs()`(JSON: auto/builtin/usb/wired/bluetooth, selected·active·channels, 저장된 장치가
    없으면 auto 에 `missing`) · `setInput(id)`(0 = 자동, 장치 id 는 꽂을 때마다 바뀌므로 종류+제품명을 저장, 번역 중 즉시 재라우팅, 장치가 빠지면 자동으로
    돌아갔다가 다시 꽂으면 복귀). 블루투스: API 31+ `setCommunicationDevice`, 그 아래 `startBluetoothSco`, 전환·정지 시 해제. 2채널은 USB 만.
    구버전 앱은 마이크 시트에 현재 장치 이름만 + '앱을 업데이트하면 고를 수 있습니다'. versionCode 6.
  - **뷰어**(`mobile.html`): 라이트 테마만, 설정 톱니·패널 삭제 → 헤더 아이콘 4개(A−·A+·TTS·QR — QR 시트 = `/api/qr` + 주소 복사), 원문 항상 표시,
    양방향은 '내 언어' 라벨 없이 두 언어 세그먼트 토글(각 언어 자기 이름), 말풍선 라벨 `원문 언어 → 번역 언어` — 화면 문구는 내 언어가 ko/ja 면 그 언어,
    그 밖은 영어. 일본어 줄바꿈 수정(keep-all 은 한국어 줄에만). 전체화면 버튼 삭제(입장 버튼이 전체화면 전환). 뷰어가 공유 키 `kac-theme` 를 더는 쓰지 않음.
  - 확인: 가짜 엔진 + 네이티브 스텁으로 폰 흐름(새 세션 필수 이름 → 자동 시작 없음 → 시작 시 메뉴 숨김·탭 표시 → 양방향 말풍선 라벨 → 마이크 시트·선택 →
    세션 설정·링크 공유 → 종료 확인 → 설정·영어 전환·계정 이메일 저장·서버 prefs 동기화 → 뒤로가기 단계별), 실서버 뷰어 한국어/일본어 전환, PC 세션 화면, 테스트 41/41.
    **미확인**: Kotlin 은 CI 에서 처음 컴파일, 실기기 마이크 선택·블루투스(SCO 동안 TTS 가 폰 스피커/통화 음질로 바뀔 수 있음), 실기기 설정 화면 미터.
- **화면 점검 후속 3건(2026-10-21)**: ① PC 양방향 색을 폰·뷰어와 통일(상대 말=파랑, 내 말=무채색 — `Row` dir 판정 반전).
  ② 실시간 번역 출력 언어를 세션별로 기억(`kac-sx-target:<세션id>`, PC·폰 공통) — PC 가 열 때마다 한국어로 시작해 실제 번역(English)과 표시가 달랐다.
  ③ 안내데스크 언어 선택 화면의 일본어·중국어 보조 문구 삭제(예전에 중단된 요청).
- **양방향 통역 채널 분리 + 뷰어 내 언어·언어별 음성 + 뷰어 전용 음성(2026-10-21, 앱 1.3.0)**: 대면 견학(설명자 핀마이크 1번,
  방문객이 돌려 쓰는 2번)·화상회의 기준. **원칙: 채널마다 언어가 정해지면 엔진이 언어를 추측할 필요가 없다**(양방향 모드의 오판 제거).
  세션은 하나, 엔진 연결은 채널마다(단방향). 요금은 오디오 시간분만 늘어남(글자 요금은 각자 자기 말만이라 그대로) — 실측 기준 시간당 약 +200원.
  - **서버(runSoniox)**: WS 파라미터 `role`(me/them)·`drop`(이 채널에서 들리면 버릴 언어 = 그 채널의 번역 타깃 = 반대 채널 언어)·`pair`(a,b).
    `drop` 언어 발화는 진행 중에도 감추고 확정 안 함(스피커·옆 핀마이크로 샌 소리). 같은 세션 다른 채널이 8초 안에 비슷한 문장을 확정했으면
    교차 중복으로 버림(`room.chCommits`, echoMatch). `pair` 가 있으면 엔진은 단방향이어도 세션 `sxInfo={mode:'two',a,b,split:true}`.
    확정·진행 중 항목에 **발화 언어 `lang`** 저장/전송. `src=mic2`(스테레오 상대 채널)=왼쪽. 회귀 테스트 `test/channel-split.test.mjs`.
  - **시스템+마이크(화상회의)**: 이전엔 두 연결 모두 양방향(채널마다 언어 추측). 이제 시스템=무엇이든→내 언어(제3 언어도 번역, 버리지 않음),
    마이크=내 언어→상대 언어 + 상대 언어 버림 → **스피커로 회의해도 상대 말이 내 마이크로 새어 두 번 나오던 문제 대부분 해결**(상대도 한국어면 불가 — 이어폰).
    트레이드오프: 내 쪽에서 상대 언어로 말하면 버려지고, 원격 쪽에서 내 언어(예: 한국어)로 말하면 번역 없이 그대로 보인다(기존 양방향은 둘 다 처리).
  - **스테레오 2채널 자동 판별(옵션 없음)**: 양방향 통역 + 마이크 + 2채널 가능 기기면 원음 2채널로 연다(크롬은 에코 제거·잡음 억제를 켜면 모노로
    합치므로 끔). **기본은 지금과 같은 1채널(왼쪽 소리 → 양방향 엔진)** 로 동작하며 뒤에서 판별: 좌우 상관 0.985 초과(모노 모드 복사본·백업 트랙) → 모노 기억,
    **오른쪽에서 왼쪽보다 8dB 이상 큰 말소리 3프레임 → 2채널 전환·기억**. 한쪽만 쓰는 장치·조용한 백업 복사본은 이 조건을 못 만들어 오판 없음
    (코드 리뷰 지적 반영 — 처음 설계는 '한쪽이 크면 스테레오'라 이런 장치에서 상대 말을 전부 버릴 수 있었다). 실녹음·시뮬레이션 검증: 모노 복사본→모노,
    스테레오→송신기 2가 말하는 순간 전환, 한쪽만→1채널 유지, 백업 트랙→모노. 전환 전엔 오른쪽 소리를 엔진에 보내지 않아 조각 중복 없음.
    2채널: **왼쪽(송신기 1)=나: 단방향 내 언어→상대(상대 언어 버림)**, **오른쪽(2)=상대: 단방향 →내 언어(내 언어 버림)** + 오른쪽 프리롤 0.7초.
    결과는 기기별 기억(`kac-stereo:<기기명>`, 2채널 중에도 계속 검증해 복사본이면 다음부터 1채널). 앱에서 모노 프레임이 오면(수신기 분리) 이번 세션은 1채널로 복귀(기억 유지).
    민감도 슬라이더 하나를 두 채널에 동일 적용, 소음 바닥만 채널별, 원음이라 앱 곡선(기준선도 같은 곡선). 모노 판정 시 브라우저는 에코 제거를 다시 켬.
    이 기기 TTS 재생 중엔 원음 채널 무음, 크게 말하면(두 채널 중 큰 쪽) 끊고 살림. 새 소켓 12초 무응답 보호. '좌우 바꾸기'(고급 설정).
    고급 설정·옵션 바 입력 막대 두 줄(나/상대), 폰 마이크 칩 '· 2채널'. `audio.js setupStereo`·`wirePipe`·`reopenPipe`·`makeQ(over)`.
  - **앱 1.3.0**: `AndroidAudio.startStereo()` — USB 장치가 2채널을 지원하면 스테레오 AudioRecord(VOICE_RECOGNITION→MIC 순), `__kacNA2` 로 좌우 인터리브 24kHz.
    반환 2/1/0. 내장 마이크는 항상 모노(폰 스테레오 마이크는 화자 분리가 아님). 구버전 앱은 1채널 그대로.
  - **뷰어(mobile.html) 양방향**: 'My language' 선택(두 언어, 폰 언어로 기본값·세션별 기억). **내 언어로 말한 쪽=오른쪽(원문, 아래 작게 번역), 상대 언어 쪽=왼쪽
    (내 언어 번역, 아래 작게 원문)** — 실제로 누가 말했든 보는 사람 기준. 발화 언어는 `lang`, 없으면 번역 키로 추정. 듣기(audioSub)에 `lang` → 서버가 **내 언어 음성만** 전송
    (`broadcastAudio(…, lang)`; 언어 미지정 뷰어·단방향은 전부).
  - **TTS '뷰어에게만 보내기'**(고급 설정 음성 출력): 합성은 하되 이 기기에서는 재생 안 함 — `tts` 제어 메시지 `local:false` → 서버 `ws._audioOut=false`.
    설명자 기기 스피커 대신 듣는 사람 각자 폰·이어폰.
  - **미검증**: 실제 스테레오 수신기로 브라우저 캡처(내장 브라우저는 마이크 차단)·앱 스테레오 캡처, 대면 누화 실측. 판별 임계는 실녹음으로만 검증.
- **앱 마이크 민감도 범위 확대 + 입력 크기 기준선(2026-10-20, 웹만)**: 현장 보고 — 앱에서 민감도를 1로 해도 50cm 떨어진 말이 다 인식됨.
  원인: 절대 하한이 브라우저용(0.004~0.034 RMS)이라 AGC 없는 원음 + 무선 핀마이크(신호 큼)에선 최저값도 너무 관대. `audio.js micGateAbs(sens, native)` 신설 —
  **앱(native)만 0.004~0.2 지수 곡선**(70≈0.013, 50≈0.028, 30≈0.062, 10≈0.13, 1≈0.19), 브라우저(PC·데스크)는 기존 선형 그대로(맞춰 둔 값 불변).
  고급 설정 민감도 슬라이더 아래에 번역 중 **입력 크기 막대 + 빨간 기준선**(onMeter 와 같은 dB 눈금) — 평소 말은 넘고 떨어진 말은 못 넘게 눈으로 조절.
  폰 화면 마이크 칩을 누르면 고급 설정이 바로 열린다.
- **앱 업데이트 알림(2026-10-20, 앱 1.2.0)**: 화면(웹)은 서버에서 오므로 원래 자동 반영 — 이건 **앱 본체(네이티브)가 바뀐 경우**용.
  홈 진입 시 `UpdateSheet`(mobile/)가 `AndroidApp.version()` 과 `/api/desktop/info` 의 `android.filename`(AirTalk-x.y.z-android.apk)을 비교해
  새 버전이면 바텀 시트. '업데이트' = `AndroidApp.installUpdate('/download/desktop?platform=android')` → 네이티브가 직접 내려받음
  (**로그인 쿠키는 우리 서버 요청에만** — 리다이렉트를 직접 따라가 GitHub 로는 쿠키를 안 보냄, 10만 바이트 미만 응답은 오응답으로 거부)
  → `UpdateFileProvider`(androidx 없이 만든 읽기 전용 ContentProvider, exported=false)로 안드로이드 설치 화면. 진행률 `window.__kacUpd`(0~100, -1 실패, 101 설치 화면).
  `REQUEST_INSTALL_PACKAGES` 추가 — 처음 한 번은 안드로이드가 'AirTalk 에서 앱 설치 허용' 설정으로 안내(시스템 동작). 마지막 '업데이트' 확인은 정책상 사용자.
  '나중에' = 같은 버전 24시간 묻지 않음(`kac-upd-skip`). 번역 중엔 안 뜸(홈에서만). 서버 릴리스 정보 캐시 10분이라 새 APK 감지까지 최대 10분.
  구버전(1.1.x, 브리지 없음)은 브라우저 다운로드로 폴백 — **1.2.0 은 한 번 수동 설치**해야 이후부터 앱 안 업데이트가 된다. versionCode 4.
- **앱 기본 서버 주소 내장(2026-10-20, 앱 1.1.1)**: 첫 실행의 '서버 주소' 입력 창 삭제 — 앱은 폰 전용이고 손님 태블릿은 웹으로 접속하므로
  운영 서버 `https://translate-voxm.onrender.com`(데스크톱 앱 기본값과 동일)을 `DEFAULT_URL` 로 바로 연다. 관리 메뉴 '서버 주소 변경'은 시험 서버용으로 유지
  (비우고 저장 = 기본값 복귀, 저장값 없으면 기본값). versionCode 3.
- **안드로이드 앱 폰 전용 화면 + 옵션 문구 정리(2026-10-20, 앱 1.1.0)**: 시안(claude.ai 아티팩트 'AirTalk 폰 앱 시안') 승인 후 구현.
  - **공통(웹)**: 사이드바 '최근 항목' 머리글 삭제(목록은 유지). 옵션 '소리 입력'→**'음성 입력'**, 'PC 소리'→**'시스템'**(양방향 '시스템 + 마이크').
    **입력 언어(실시간)·내 언어(양방향)를 고급 설정에서 상단 옵션으로**(고급 설정 '번역' 섹션은 'TTS 음성'만 남아 '음성 출력'으로 개명).
    QR 대화상자 제목 '모바일로 보기'→**'링크 공유'**(앱에선 '공유' 버튼 = 네이티브 공유 시트, http 사내망 복사 폴백).
  - **폰 화면(`client/src/components/mobile/`)**: `window.AndroidAudio` 가 있으면(앱) `App` 이 `MobileApp` 으로 전환 — 메뉴바·안내데스크·관리자 없음.
    홈(세션 목록, 머리글 없음 · USB 마이크 칩 · '새 세션' 버튼) → 새 세션 시트(모드 카드 설명: 실시간='시스템 혹은 마이크 입력 음성을 실시간으로
    번역합니다.' / 양방향='지정한 두 언어를 상대방 언어로 통역합니다.', 출력·상대 언어, 이름, **'시작하기' = 생성 후 바로 시작**) → 세션 화면.
    **세션 화면은 `TranslateView mobile` — 상태·엔진 로직은 그대로 공유하고 레이아웃만 `MobileLive`**(로직 복제 금지: 뷰어 발화 폐지의 교훈).
    대화상자·메뉴는 `overlays` 로 빼서 두 레이아웃이 공유. ⋮ 메뉴에 링크 공유·녹취록 저장·고급 설정(전체 화면). 언어는 바텀 시트(입력/출력·내/상대 탭),
    번역 중엔 잠금. 양방향은 말풍선(상대=왼쪽 파랑, 나=오른쪽). 실시간 번역의 출력 언어는 세션별로 기기에 기억(`kac-sx-target:<id>`).
    웹 티 제거: 글자 선택·탭 번쩍임·확대·끝 튕김 끔. 브라우저 확인용 `?mobileui=1`.
  - **앱(네이티브)**: 시작 화면·**서버 연결 끊김 화면**(주 프레임 로드 실패/5xx → 2·4·8·15초 자동 재시도 + 네트워크 복귀 즉시 재시도, '지금 다시 시도'·'서버 주소 확인').
    `window.AndroidApp` 브리지 — `saveText`(WebView 는 blob 다운로드 불가 → 저장 위치 선택 창), `shareText`, `setKeepScreenOn`(폰은 번역 중에만 화면 켜짐),
    `setDarkUi`(상태바 색), `openMenu`. `AndroidAudio.inputLabel()`(마이크 칩). **손님 태블릿(경로에 desk)만 몰입 전체화면·상시 켜짐·뒤로가기=관리 메뉴**,
    폰은 상태바 표시 · 뒤로가기=웹 뒤로(세션→홈) · 첫 화면에서 두 번 누르면 종료 · 길게 누르면 관리 메뉴. versionCode 2 / 1.1.0.
  - 서버: 릴리스에 APK 가 여러 개면 **가장 최근에 올라온 것**을 내려준다(버전마다 파일명이 달라 쌓임).
  - 확인: 가짜 엔진 + 브리지 스텁으로 폰 화면 흐름(새 세션→자동 시작→번역/초안→정지→언어 시트→⋮ 메뉴→링크 공유→뒤로→양방향 말풍선) 브라우저 확인,
    테스트 37/37. **미확인**: Kotlin 은 CI 빌드에서 처음 컴파일, 실기기 동작(연결 끊김 화면·저장·공유·뒤로가기).
- **같은 언어 기록(한국어→한국어) 표시 정리(2026-10-19, 온라인 회의 녹취용)**: 실시간 번역 + 출력 언어 = 말하는 언어면
  Soniox one_way 는 번역 토큰을 안 보낸다. 확정(commit)은 원래 `out = tgt || txt` 로 원문 폴백이라 기록은 됐지만 화면이 어색했다 —
  ① 말하는 동안 타깃 칸이 비어 호스트에 흐린 기울임 + '번역 중…' ② 확정 후 큰 글씨·작은 회색 원문에 **같은 문장 두 번**(호스트는 원문 상시,
  뷰어는 '원문 동시 보기' 기본 ON). 수정: runSoniox 진행 중 `sameLang = sxMode==='one' && curSrc===sxTarget && !shownTgt` 면 원문을 타깃 칸에
  싣는다(다른 언어는 번역 도착 전까지 비움 — 원문을 번역처럼 보이면 안 됨). 같은 언어 확정 발화는 **TTS 생략**(방금 한 말을 되읽던 것).
  화면: `Row`(TranslateView)·`mobile.html srcShown()` 이 원문=표시 문장이면 작은 줄 숨김(뷰어는 언어 변경 시 `rerender` 에서 재판정).
  저장 데이터는 그대로(source 는 항상 원문). 테스트 `test/same-lang.test.mjs`(수정 제거 시 실패 확인).
- **안드로이드 앱 서명키 교체 + 외부 마이크(USB-C 무선 수신기) 자동 선택(2026-10-19)**: 첫 빌드·배포 직전 정리.
  - **서명키 교체**: 기존 `android/app/airtalk-release.p12` 와 비밀번호가 **공개 repo 에 평문 커밋**돼 있었다(누구나 같은 서명의
    가짜 업데이트 APK 를 만들 수 있음). 설치된 기기가 0대인 지금 바꾸면 비용 0(설치 후 바꾸면 전 기기 삭제·재설치). 새 키(RSA 4096,
    30년, SHA-256 `DF:33:A8:E6:…:CD:6F`)는 **repo 밖** `~/Documents/claude/airtalk-signing/`(백업 필수) + GitHub Secrets
    `ANDROID_KEYSTORE_B64`·`ANDROID_KEYSTORE_PASSWORD`. `build.gradle` 은 환경변수 `ANDROID_KEYSTORE`(+비밀번호)가 있을 때만 서명.
    CI `android` 잡이 Secret 을 `$RUNNER_TEMP` 에 풀어 빌드하고, **업로드 전 apksigner 로 인증서 지문 검증**(미서명·다른 키 APK 차단).
    `.gitignore` 에 `*.p12`·`*.jks`·`*.keystore`. 옛 키는 git 기록에 남지만 새 키로 서명하므로 무의미(기록 정리 불요).
  - **외부 마이크 우선 라우팅**(`NativeAudio.kt`): 이전엔 입력 장치를 OS 에 맡겼다. 이제 `pickInput()` = USB(HEADSET/DEVICE) →
    유선 이어폰 마이크 → 없으면 OS 기본(내장)을 `setPreferredDevice` 로 명시. **번역 중 꽂거나 뽑으면** `AudioDeviceCallback` →
    진행 중 AudioRecord 의 선호 장치만 교체(끊김 없이 재라우팅). 실제 라우팅이 바뀌면 토스트 "마이크 입력: USB 마이크 (모델명)"
    (내장 마이크로 처음 시작할 땐 조용히). 블루투스는 통화용 협대역(SCO)이라 일부러 안 고른다.
  - **장치 분리로 read() 오류 시 재개방**: 이전엔 오류 = 캡처 스레드 종료였는데 웹은 이를 알 길이 없어 '번역 중'인데 소리만 끊긴
    상태가 됐다. 이제 300ms 간격으로 다시 열어 이어간다. 캡처·효과를 `Capture` 묶음으로 관리, 세대 번호(`gen`)로 stop 이 늦게 끝난
    이전 스레드와 새 캡처가 동시에 돌지 않게 함. 앱 정보에 '마이크 입력: 사용 중 — …/대기 — 시작하면 …' 표시.
  - 웹: 안드로이드 앱에선 **소리 입력을 마이크로 고정**(PC 소리 캡처 getDisplayMedia 가 WebView 에 없음 — 부팅 이전으로 src=system 이
    된 구 PC 음성 번역 세션을 폰에서 열면 시작 즉시 실패했을 것). 서버 세션 값은 건드리지 않고 이 기기 상태만, 선택 UI 숨김.
  - **미검증**: 이 맥엔 JDK·Android SDK 가 없어 Kotlin 컴파일은 CI 에서 처음 확인된다. 실기기 확인 항목 — 수신기 꽂고 시작 시 토스트,
    번역 중 뽑기/꽂기, 그리고 **수신기가 USB 출력 장치도 겸하면 TTS 가 폰 스피커 대신 수신기(모니터 단자)로 나갈 수 있음**
    (WebView 미디어 출력은 앱이 장치를 고를 수 없다).
- **실시간 번역 메뉴 3종 → 2종 + 뷰어 발화 폐지 + 발화 멈춤 버그(2026-10-18)**: 모드가 '소스+방향'을 섞어 정의하고
  모드 안 토글이 다시 그걸 바꾸던 구조(예: 'PC 음성 번역'이 양방향·내 음성 인식 토글로 사실상 다른 모드로 변신)를 정리.
  **모드 = 번역 방향, 소리 입력(소스) = 모드 안 선택지 하나** — 모드마다 유효한 소스가 정확히 두 개라 잘못된 조합이 없다.
  `oneway`=실시간 번역(src `mic`|`system`) / `twoway`=양방향 통역(src `mic`|`both`). 세션에 `src` 필드 신설
  (`normalizeMode` — 생성·PATCH·부팅 이전 공용). 서버 번역 동작은 원래 WS 쿼리(sxMode·src)를 따르므로 엔진 경로 변경 없음.
  - **기존 세션 이전(부팅 1회, 바뀐 세션만 저장)**: live→oneway/mic, oneway(src 없음)→oneway/**system**(구 PC 음성 번역은
    PC 소리였음 — 신규 생성 기본 mic 과 다름), online→oneway/system, twoway→twoway/mic, mobile·field·meeting→twoway/mic.
    대화 기록은 건드리지 않음. 8/17 의 '양방향 번역' 토글(`kac-oneway-two`)은 폐기 — 그 조합은 '양방향 통역 + PC 소리+마이크'.
  - **소스 변경은 번역 이력이 있어도 허용**(방향 불변), **모드 변경은 이력 없을 때만**(기존 규칙). 모드를 바꾸면 소스는 마이크로.
  - **옵션 최소화**: 메인 바엔 모드·소리 입력·언어 하나(실시간=출력 언어, 양방향=상대 언어)만. 입력 언어(자동 감지 기본)·내 언어
    (한국어 기본)·TTS 음성은 고급 설정 '번역' 섹션으로. **TTS 는 소스가 마이크일 때만 노출·동작**(PC 소리 캡처 중이면 TTS 음성이
    PC 소리 채널로 되들어가 재번역 — 켜진 저장값이 있어도 합성 안 함). 마이크 장치·미터·발화 멈춤도 마이크를 쓸 때만.
  - **뷰어 발화(PTT) 폐지**: 번역 방향은 채널이 아니라 언어로 정해지므로 대면은 마이크 하나로 충분(데스크 단일 채널과 동일).
    결정적 이유는 이 경로가 6주간의 수정(언어 다수결·재연결·간투사)이 빠진 가장 관리 안 된 복사본이었다는 점 — 따라잡기보다 삭제.
    서버: `startTalkPipeline`·`ptt` 처리·발화 락(`hostTalking`/`speaking`/`ptt-state`)·`roomCfg`·`micState`·`sendToHosts`·`applyItem`
    삭제, 세션 응답 `viewerPTT` 제거. `mobile.html`: 발화 버튼·녹음 코드·TTS 덕킹 삭제. **데스크 손님 태블릿 마이크(`desk-mic`)는 별도 경로라 무영향.**
    이제 뷰어 소켓이 유료 엔진을 여는 경로는 데스크 여객 마이크뿐.
  - **발화 멈춤 버그**: 무음 처리 분기가 소스를 가리지 않아 'PC 소리 + 마이크'에서 누르면 **상대 말(system) 번역까지 멈췄다**
    (주석은 '마이크만'). `audio.js` `micOff = muted && src !== 'system'`.
  - 덤: `App.jsx` `<TranslateView key={session.id}>` — 키가 없어 세션 안에서 사이드바로 다른 세션을 고르면 화면이 이전 세션
    상태(모드·언어·**녹음 대상 id**)로 남았다(기존 버그). 목록/조회 응답에 `src` 추가(목록에서 열 때 이 객체가 그대로 쓰여 소스 복원).
  - 회귀 테스트 `test/mode-migration.test.mjs`(이전 매핑·디스크 저장·목록 src / 소스 변경 규칙·이력 있을 때 모드 거부 /
    뷰어 ptt·오디오에 엔진 미개방 — 이전 로직 제거 시 실패 확인), `test/twoway-both.test.mjs`(구 oneway-twoway — 양방향+both 두 채널 two_way).
- **PC 음성 번역에 양방향 토글(2026-08-17, 화상회의)**: oneway/online 프리셋에 '양방향 번역' 토글 신설 — 켜면 `sxMode='two'`,
  입력/출력 언어 대신 언어1/언어2 선택. '내 음성 인식'(both)과 함께 켜면 **시스템 채널(=Zoom 상대 음성, side left)·마이크
  채널(=내 음성, side right)이 각각 two_way 로 붙어** 상대는 내 한국어를 자기 언어로, 나는 상대 언어를 한국어로 본다(뷰어 링크 공유).
  서버는 원래 프리셋을 안 보고 `ws._sxMode` 만 보므로(서버 변경 0줄) UI 만 열었다. 저장 키는 `kac-oneway-two`(모드 변경 시 리셋)
  — `kac-sx-mode` 는 프리셋 없는 구세션용이라 분리. 방향별 색상 `twoway` 플래그도 `sxMode==='two'` 를 포함하게 수정.
  주의: 소스 2개 = Soniox 연결 2개(오디오 과금 2배, context 2회 주입). 상대 목소리가 마이크로 되들어가지 않게 이어폰 권장(힌트에 명시).
  회귀 테스트 `test/oneway-twoway.test.mjs` — oneway 프리셋 + system/mic 두 채널 모두 two_way(ko↔ja)·힌트 언어쌍 축소 확인
  (서버에 프리셋 클램프가 들어가면 이 조합이 조용히 단방향으로 떨어져 상대 화면이 전부 한국어가 되는 회귀 방지).
- **진행 중 발화 흐린 글씨 표시(draft, 2026-08-02)**: 다듬기(polish)가 `commit()` 안에서만 돌아 **발화 전체가 끝나야** 시작되니,
  강의처럼 한 발화가 길면 다음 발화로 넘어간 뒤에야 번역이 또렷해졌다(사용자 지적). 플리토 방식 — 진행 중은 흐리게, 확정되면 또렷하게.
  서버 `liveSend` 가 `draft: true` 를 얹고 확정 경로(`commit`→`upsertItem`→`buildMsg`)는 이 필드를 **아예 빼서** 같은 id 를 다시 보낸다.
  ⚠ 클라는 `draft` 를 `??` 로 유지하면 안 된다 — 확정 메시지에 필드가 없으므로 유지하면 카드가 영영 흐린 채로 굳는다. 매 메시지가 정본(`!!m.draft`).
  적용: `TranslateView`(Row `draft` prop → 방향색 대신 `text.secondary`) · `mobile.html`(`.line.draft` — latest/dirA/dirB 규칙보다 뒤에
  같은 특이도로 배치해 확실히 이김) · `desk.html`(말풍선 배경이 색이라 글자색 대신 `.turn.draft .bub { opacity:.5 }`).
  저장 item 에는 `draft` 가 들어가지 않는다(화면 상태이지 데이터가 아님). 구버전 캐시 클라는 필드를 무시해 지금과 동일하게 그려짐 — 추가는 안전.
  **nano 호출은 전혀 늘지 않는다** — 진행 중 텍스트는 원래도 흘러가고 있었고 시각 구분만 생겼다.
  회귀 테스트 `test/draft-flag.test.mjs`(진행 중 `draft:true` → 확정 시 같은 id 에 필드 없음 → 이후 재부착 없음 → 저장 item 미포함, TDD-red 확인).
  **미채택(다음 단계 판단)**: 문장 단위 재번역. 번역문도 이미 조각조각 확정돼 들어오고(`finalTrans`) 문장 분리 로직도 `flushTtsSentences`
  (약어·줄임표·소수점·이니셜 처리)에 이미 있어 가능하지만 — ① 원문↔번역 문장 경계가 1:1이 아니라 카드 `texts[key]` 를 조각 배열로 바꿔야 하고
  ② 조각별 nano 응답이 순서 역전되며 ③ 발화당 호출이 2~4배가 된다. 데스크는 발화가 짧아 이득이 거의 없으므로 하더라도 `runSoniox` 단방향 한정.
- **과금 폭주 방어 + 시범 데이터 손실 차단(2026-08-01, 시범운영 전 필수 A2·A5)**:
  ① **데스크 엔진 재연결 상한·백오프** — `connectSx`/`connectGuest` 의 close 핸들러가 **고정 800ms 무한 재시도**였다.
  `runSoniox` 에는 `sxFails` 8회 상한 + 지수 백오프가 있는데 데스크에만 빠져 있었다. 재연결 1회마다 용어집 context 가
  `input_text_tokens` 로 재청구(데스크 context 2,522자 ≈ $0.008/회)돼, 엔진이 연결 즉시 끊는 장애에서 **4,500회/시간 = 데스크
  1대당 $36/시간**. 무음 자동종료가 막아 주지도 않는다 — `armForeignTimer` 는 오디오 RMS>0.02 로도 리셋되므로(공항 로비 암소음)
  `phase` 가 계속 `active` 로 남는다. 수정: `SX_MAX_FAILS=8` + `sxRetryDelay(n)=min(base·2^(n-1), 15s)` 공용화(runSoniox 포함),
  채널별 `sxFails`/`gsxFails`(한쪽만 죽어도 상한이 걸리게), **토큰 수신·새 응대 시작·여객 마이크 재점등 시 리셋**.
  ⚠ 의도적 재체결(언어 감지 `lockDetected`·2채널 전환·guestMic 토글)은 `closeSx()` 가 `sx` 를 먼저 null 로 만들어 close 핸들러가
  걸러내므로 **별도 `relockPending` 플래그가 필요 없다**(구조로 이미 제외됨 — 확인함). 상한 도달 시 **`endConversation` 은 부르지
  않는다**: 유인 데스크에서 회복 가능한 장애를 손님 앞 강제 종료로 바꾸는 게 더 나쁘다. 대신 호스트 status + 뷰어 `desk-engine-down`
  (desk.html `UI.engineDown` ko/en/ja/zh/vi). 여객 채널만 죽으면 데스크 마이크 단일 채널로 계속. 회귀 테스트
  `test/desk-retry-cap.test.mjs` — fake-soniox `{autoClose:true}` + `SX_RETRY_BASE_MS=20`(운영 800ms) 로 8회 정지·이후 무증가·
  응대 미종료 검증(상한 제거 시 실패 확인).
  ② **뷰어 PTT 레이트리밋** — `m.type==='ptt'` 분기에만 `deskCtlAllowed` 가 없었다(desk-start/end/mic 은 전부 호출).
  `on` 마다 유료 엔진이 열린다. ⚠ **`off` 는 절대 막지 않는다** — 드랍하면 엔진이 열린 채 남아 오히려 과금이 계속되고 발화권도 잠긴다.
  거부 시 `ptt-denied`(mobile.html 이 이미 처리 — 버튼 깜빡임). 도달 조건은 좁다: PTT 는 `pipeline==='soniox'` + preset
  twoway/mobile/field/meeting 으로 이미 게이트돼 데스크 세션에서는 발동 불가.
  ③ **deskLog 보존 상한 200 → `DESKLOG_CAP=1000` + 바이트 상한** — 한 데스크가 200 응대를 넘기면 오래된 응대 전문이 **조용히**
  사라졌다(시범 보고서 원천 데이터). 건수와 별개로 `DESKLOG_MAX_BYTES=8MB` 를 함께 둔다: 데스크 세션은 deskLog 를 품은 문서 1개라
  **Mongo 16MB 한도를 넘기면 replaceOne 이 통째로 실패**해 그 데스크의 저장이 전부 멈춘다(잘림보다 훨씬 나쁨). 잘리면
  `metrics.deskLogFull` 에 기록 → `/api/admin/health` → 관리자 시스템·보안에 경고.
  ⚠ **`item.toks` 는 지우지 않기로 함(검토 결과 리뷰 권고와 다름)** — `eval/conf-analyze.mjs` 가 deskLog 의 toks 를 읽어 confFix
  임계값 근거를 뽑고, 공항 실소음·실억양의 신뢰도 분포는 시범 기간에만 얻을 수 있다. 용량은 바이트 상한으로 대신 막았다.
  ④ **저장 실패 노출** — `flushSessions` 실패가 `console.error` 뿐이라 저장이 죽어도 화면은 정상으로 보였다.
  `metrics.saveFail{at,msg,count}` → health → 관리자 화면 빨간 칩(성공 시 자동 해제).
- **미완성·미사용 기능 폐기 + 전체 초기화 개선(2026-07-30, 사용자 결정)**: ① **정형 안내 멘트(canned) 삭제** — 관리자 입력 UI는 있었으나 데스크 재생 경로가 끝내 없었다(미완성). 서버 `CANNED_FILE`·`cannedConfig`·`cannedCol`·`persistCanned`·라우트 2개 + `/api/admin/export` 의 `canned` 필드(백업 JSON 스키마 변경), 클라 `CannedPanel`·Nav 탭·api 2개. ⚠ 운영 Mongo `canned` 에 실제 문안 1건("수하물 규정 안내")이 있었고 함께 폐기됨. ② **AI 요약 일체 삭제** — 도달 불가였던 `SummaryPage` 뿐 아니라 **세션 내 요약 패널까지 전부**. 서버 AI 요약 섹션 160줄(`SUMMARY_SYS`·`chatComplete`·`sessionTranscript`·`summarizeTranscript`·`runSummary`·`pubSummary`·라우트 4개) + 저장 헬퍼 35줄 + `summaries`/`summariesCol`/`SUMMARIES_FILE`, 클라 `SummaryPage.jsx`·TranslateView 요약 state/버튼/패널·api 6개. ③ **전체 초기화(reset-all) 개선 — 데스크 세션 보존**: 기존에는 `sessions=[]` 로 **데스크 세션까지 삭제**돼 세션 id 가 바뀌고, 뷰어 토큰이 `HMAC(secret,'viewer:'+id)` 이라 **현장에 인쇄·게시한 QR 이 전부 무효**가 됐다. 이제 데스크 세션은 남기고 `items`/`deskLog`/`wayfindLog` 만 비운다(Mongo 는 `deleteMany({id:{$nin:keptIds}})` + kept 재저장). 응답에 `keptDesks`·`clearedDeskLogs` 추가, 관리자 문구도 "데스크 세션 유지" 로 수정. → 실운영 전 테스트 데이터 정리를 **QR 재발급 없이** 버튼 하나로. 검증: 라우트 404 확인(`/api/summaries`·`/api/canned`), 테스트 25/25, 빌드, 기동 스모크.
- **과잉·죽은 코드 1단계 정리(2026-07-30, 감사 48건 중 검증 통과 36건에서 safe 묶음만)**: ⚠ **뷰어 접속 거부 안내 추가(삭제 아님)** — 뷰어 상한(세션 300·IP 8) 초과 시 서버가 `{type:'error'}`를 보내는데 **수신부가 클라 어디에도 없어**(참조 0건) 거부된 폰이 이유 표시 없이 무한 재연결하던 문제. mobile/desk.html 에 `refused` 플래그 + 안내 표시 + 재연결 중단 추가. 삭제분: **B** WS 쿼리 잔재(`ws._refine`·`ws._model`·`refineModel`·`const polish`·`langsOut` + audio.js/TranslateView 배선) · **C** whisper 문장경계 95줄(`segmentTranslate`·`splitSentences`·전역 `ABBR`/`CLOSERS` — ⚠ `runSoniox` 지역 `ABBR`(TTS 문장분리 실사용)은 별개 심볼이라 유지) · **D** `showSource`/`toggleSrc`/`srcVisible`/`kac-src`, Nav 죽은 prop `onSummaries`·`onTerms` (⚠ `showPartial`·`NavItem muted` 는 실사용이라 유지 — 감사 초기 발견의 오류) · **F** desk.html `#langMore` 죽은 CSS(요소 없음)·`order` 배열(push만) · **G** POST preset 화이트리스트를 현행 3종으로(읽기 호환 경로는 유지) · **H** `@breezystack/lamejs` → devDependencies(eval 전용, 락파일 재생성) · **I** `test/smoke.test.mjs`(1+1=2 자리표시자) · **M-1** `/map` 디렉터리 통째 static → **필요한 2파일 화이트리스트**(제작도구 `test.html`·`_serve.py`·`original/*` 가 인증 앞에서 무인증 공개되던 문제 차단, 실기동 curl 검증) · **R** 짝 없는 WS 타입(`commit` 송신+`vad` 블록 — 게이트는 `noiseFloor`/`gateOpenUntil`/`prevRaw` 만 쓰므로 무영향, `viewerPTT`·`viewers` 수신·송신). **A** 저장소 위생: `.gitignore` 에 `.DS_Store`·`eval/tts-audio/*`·`eval/*.out.json` 추가 후 `.DS_Store`×3·`w.bat`·`manifest.json` 추적 해제 — ⚠ 선행으로 **manifest 의 러시아어 질문 30문장(저장소 유일본)을 `eval/dataset.json` `question.src.ru` 로 이식**(30/30 매칭 확인). 미실행(2·3단계): usage 집계·diar·desk-stats 사전집계·map 도구 파일·문서 정리, canned/데스크로그삭제/SummaryPage/translate 는 판단 대기.
- **실시간 번역 입력언어 재감지 + 용어 UI 언어 축소 + 연결중 문구(2026-07-30)**: ① **1회 재감지 재연결**(runSoniox): `config` → `buildConfig()` 함수화, `lockedIn`·`relockPending` 신설. auto 세션은 광역 힌트(L4 8언어)로 시작 → 첫 확정 발화의 언어(`commit` 내 `lockDetected(src)`)로 잠그고 `language_hints=[타깃, 감지언어]`·context 도 그 언어로 좁혀 **한 번만** 재연결. 데스크 `lockDetected` 와 동일 패턴. `relockPending` 으로 close 핸들러가 이걸 '실패'로 세지 않게(백오프·8회 상한 무영향), 그 사이 발화는 pending 리플레이 버퍼가 복구. 비용: context 재과금 1회(주기적 재연결과 달리 무해). `roomCfg` 는 `cfg0=buildConfig()` 로 클램프값 참조. 회귀 테스트 `test/live-relock.test.mjs`(1차 광역→2차 [ko,es], 재연결 1회만, 감지 발화 보존 — 수정 제거 시 실패 확인). ② **용어 UI 언어 축소**: `ALL_LANGS` → `ko,en,ja,zh`. es·fr·pt·ar 는 서버가 영어 표기로 폴백하므로 채울 필요가 없어 빈칸 노출을 없앰. ⚠ `toEntries` 도 이 배열을 순회해 **저장 시 해당 언어 표기는 제거**된다 — 운영 데이터에 es/fr/pt/ar 값 0건·servedLangs 도 ko/en/ja/zh 라 손실 없음(확인). 되돌리려면 배열에 추가. ③ **'엔진 연결 중…' 문구 잔존 수정**: `connecting` 이 첫 인식 결과(`partial`/`sentence`)에서만 해제돼, 시작 후 말을 하지 않으면 연결이 끝났는데도 최대 12초간 스피너가 남았다 → 서버 '엔진 연결됨' status 수신 시 즉시 해제.
- **용어 context 한도 초과 수정(2026-07-29, 실세션 ms5bwpkgfqtc9 분석 근거)**: 증상 두 건 — ① `Jeju Air`→"제주에어" 오역 ② 스페인어 첫 12발화가 번역 없이 원문 그대로 표시. 원인: `buildSonioxContextRaw` 의 `pair` 모드가 **활성 언어 전 조합**(4언어=12쌍/항목)을 만들어 `auto` 세션(구 L4=ko/en/ja/zh)에서 752쌍·31,384자 → 한도 9,500자 절삭에 **752쌍 전부 삭제**(번역쌍 0개로 전송). ja→zh 처럼 그 세션에서 쓰이지 않는 쌍이 자리를 차지한 게 원인. 수정: **`opts.target`(단방향 타깃) 신설 — 주면 `X→타깃` 방향만 생성**. 호출부: runSoniox one_way → `{target: sxTarget}`(two_way 는 전 방향 유지), desk `baseConfig(langs, target)` — 2채널 직원 채널 `target=lockedB`, 여객 채널·단일 `target=ko`. 결과(실 용어집 109항목 검증): auto 752쌍/31,384자·전부잘림 → **203쌍/10,169자·34개만 잘림**, 항공사 6사 번역쌍 전부 생존. 세션 ko↔en 7,071자·데스크 2,522자로 잘림 없음. 함께: `L4` → `ko,en,ja,zh,es,fr,de,ru`, `GUEST_LANGS` → `+es,fr,de` (힌트에 없는 언어의 첫 발화 미번역 원인 제거 — 표기 없는 언어는 영어로 폴백돼 context 증가 없음). **미채택**: GPT 번역 폴백(드문 상황에 상시 판정·과금 경로 추가는 과도 — 세션 재시작으로 해소되고 실사용에 3개 언어가 한 세션에 섞이지 않음), 카테고리 우선순위 절삭.
- **번역 다듬기(polish, 2026-07-22)**: Soniox 기계 번역의 직역투를 gpt-5-nano(reasoning minimal)로 후교정 — `polishText`(전역, LANG_NAMES 타깃언어 프롬프트+폴란드 시연 few-shot)·`polishCommit`(handleHost, 직전 3발화 컨텍스트 `polishCtx`). 적용: runSoniox·desk 직원/여객·폰 PTT 커밋 전부(항상 on, 토글 없음 — 기존 '다듬기 상시' 정책). 흐름: 카드 확정(기계 번역 즉시 표시) → 비동기 nano(~0.5s) → **카드가 살아 있고 텍스트 그대로일 때만** 같은 id 덮어쓰기(confFix·늦은 번역 꼬리가 먼저 덮으면 양보), 응대 종료로 deskLog 아카이브 후 도착하면 기록만 갱신. 스킵: 4자 미만·isAckOnly(비용 절약)·무변경·3배 폭주(해설 방어). TTS 는 이미 재생된 뒤라 자막/기록만 다듬어짐(의도). 비용: 발화당 ~0.01원 미만. 실검증: "…얼마나 오래 진행되는지, 처음부터요"→"처음부터 …얼마나 오래 걸리는지요"(교정), 자연스러운 단답은 무변경 유지.
- **발화 경로 안정화(2026-07-21, 폴란드 시연 후속 — 음량 중재 + 잘림 수정 일괄)**: ① **음량 중재**(데스크 2채널): 서버가 채널별 수신 프레임 RMS 기록(`volLog`/`noteVol`/`volOwn`, 발화 창 평균 1.3배 우세 판정) — 언어 소유권·crossDup 이 누화로 판정해도 자기 마이크가 명백히 크면 실제 발화로 살림(겹침 발화 전체 드랍·직원의 외국어 응대 드랍·"복창 확인" 오탐 완화). crossDup 은 hit/note 분리(살린 발화도 기록해 반대편 진짜 누화를 잡음). 표본 부족 시 null→기존 판정 유지(fake 엔진 테스트 무영향). ② **그레이스 종료**: runSoniox stop/호스트 close(`gracefulEngineStop`)·PTT stop·desk `endConversation(graceful)` 모두 finalize('') 후 0.9~1초 토큰 수신 유지→잔여 final 강제 커밋→close. "말 끝내고 2초 내 중지"의 마지막 문장 유실 수정. desk 는 `finishEnd` 분리(그레이스 중 호스트 이탈해도 아카이브 보존, 승계 시 방송 생략, 언어 전환은 즉시 마감). ③ **리플레이 버퍼**: soniox·desk 직원/여객 채널의 pending 을 '마지막 확정 이후 프레임(상한 ~2초)'으로 전환, 소켓 재체결(언어 감지·여객 마이크 전환·백오프 재연결) 시 새 소켓에 재전송 — 발화 앞부분 유실 복구. commit/guestCommit 에서 비움, closeGuest 는 비우지 않음(재체결 리플레이용). ④ **언어 전환 응대 분리**: active 중 타 언어 desk-start → `endConversation(false)` 선행(두 손님 기록 병합 방지). ⑤ **무음 타이머 소리 리셋**: 토큰 없이도 수신 RMS>0.02 면 armForeignTimer(게이트/엔진 장애 중 응대 끊김 방지, 2초 스로틀). ⑥ **클라 게이트 3중 수정**(audio.js 마이크/여객/네이티브 + desk.html 웹/네이티브): 게이트 열림 중 noiseFloor 상승 동결(연속 5~12초 발화 중간 절단 — 폴란드어 끊김 원인 수정), 닫힘→열림 전이 시 직전 무음화 프레임 재전송(온셋 ~85ms 복구), ⑦ TTS **barge-in**(AEC 폴백에서 rms>0.06×2프레임이면 재생 게인 0+뮤트 해제 — TTS 중 발화 통째 유실 방지, 다음 재생 시 볼륨 복원). ⑧ audio.js `audioCtx.resume()`+visibilitychange 재개(desk/mobile.html 과 동일 방어), WS 끊김 중 프레임 버퍼(pipe.gapBuf, 재연결 onopen flush). ⑨ mobile PTT 중 TTS 재생 게인 0(`duckTts` — 스피커 재인식 유령 자막 차단). ⑩ TranslateView 카드 texts 병합→교체(언어 플립 시 이중 표기 잔존 수정). ⑪ runSoniox 커밋 직후 늦은 번역 꼬리를 직전 카드에 귀속(`lastCommitted`, 4초 창). ⑫ ACK 목록에서 'right'·'글쎄요' 제외(정보성 단답 유실 방지). 미수정(의도): runSoniox TTS 에코 필터 20초 창(실측 데이터 없이 완화 시 에코 재발 위험 — 현장 데이터 후 재검토).
- **다중 사용자 안정화(2026-07, Important 4 + 뷰어 토큰)**: ① `applyItem` 이 `saveSessions(id)` 로 해당 세션만 dirty(폰 PTT 확정마다 전 세션 재저장하던 쓰기 증폭 제거) · ② 세션 `items` 상한 `ITEMS_CAP=5000`(초과 시 오래된 문장부터 splice — 화면 히스토리만 잘림, deskLog/통계 무관) · ③ **뷰어 접속 상한** 세션당 300·IP당 8(`VIEWERS_PER_SESSION`/`VIEWERS_PER_IP`, 호스트 패시브 뷰어 `_hostView` 제외, 초과 시 error+close — 무인증 QR DoS 방어) · ④ 로그인 잠금 키 `IP`→`IP|ID`(공항 사내 NAT 에서 한 명 오타로 전원 잠기던 문제 해소). **뷰어 접근 토큰**: `viewerToken(id)=HMAC(AUTH_SECRET,'viewer:'+id).slice(0,16)` 무상태·세션고정(인쇄 QR 계속 유효, 저장/마이그레이션 없음). `/ws/viewer`·`/api/sessions/:id`·`/api/qr` 는 유효 토큰(QR 의 `&t=`) 또는 로그인 사용자만 통과(`viewerAccessOk`). `/api/qr` URL 과 `/api/desk-sessions`(랜딩 디렉터리) 응답에 토큰 포함 → 직접 QR·데스크 랜딩 양쪽 동작. mobile.html/desk.html 이 URL 의 `t` 를 ws/REST 에 전달. **주의**: 데스크 세션은 공개 디렉터리(`/api/desk-sessions`)로 토큰이 나가므로 열거 차단은 비-데스크(강의) 세션에 강하게 적용, 데스크는 접속 상한이 자원 DoS 를 담당. 회귀 테스트 `test/desk-pipeline.test.mjs`(토큰 없/틀림→403, 로그인 200, 뷰어 WS 거부).
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
- **모바일 뷰어**(`client/public/mobile.html`, 바닐라, 2026-10-21 개편): 헤더 = 세션 이름 + 아이콘 4개(A−·A+·TTS·QR). 양방향은 두 언어 세그먼트 토글(선택 = 내 언어, 내 언어 쪽 = 오른쪽), 말풍선 위 `원문 언어 → 번역 언어`(화면 문구 ko/ja/en, 그 밖은 영어). 원문 항상 표시, 라이트 테마만.
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

## 운영 보강 (production hardening)
- **유휴 자동 종료**: 호스트 WS 에서 1분간 음성 활동(전사/번역 델타) 없으면 OA 세션 닫음(`bumpIdle`/`idleClose`, IDLE_LIMIT_MS=60000). 서버가 `{type:'idle-stop'}` → 클라가 stop()+안내. whisper=transcription.delta, translate=output_transcript.delta 에서 리셋, oa open 시 시작.
- **로그인 무차별 대입 방어**: IP당 15분 내 8회 실패 시 15분 잠금(429), 메모리 `loginFails`. 성공/실패 로그.
- **보안 헤더**: X-Content-Type-Options, X-Frame-Options, Referrer-Policy, (https)HSTS. `x-powered-by` 끔, `trust proxy`.
- **CSRF 완화**: `/api` 의 POST/PUT/PATCH/DELETE 는 동일 출처(Origin host==host)만 허용, 교차출처 403.
- **Mongo 견고화**: 연결 3회 재시도(serverSelectionTimeoutMS 8s). `MONGODB_URI` 설정됐는데 실패 시 — 운영(NODE_ENV=production)에선 파일모드 폴백 대신 **기동 중단**(데이터 분리/유실 방지), 개발에선 파일 폴백.
- `NODE_ENV=production` + `AUTH_SECRET` 미설정 시 경고.
- **관리자 비밀번호 재설정**: `POST /api/admin/users/:id/password`(requireAdmin) + AdminPage 행별 🔑 버튼/다이얼로그.
- **코드 스플리팅**: App.jsx 에서 TranslateView/AdminPage 를 React.lazy + Suspense.
- **CI/테스트**: `npm test`(node:test, `test/*.test.mjs` — logic·desk-pipeline·live-relock·security·boot·store) + `.github/workflows/ci.yml`(ci: npm ci→test→build).

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
  · 서명: `app/airtalk-release.p12`(openssl PKCS12, 사이드로드 전용, repo 커밋 — CI 빌드 간 서명 고정으로 덮어쓰기 업데이트 가능) → **2026-10-19 폐기·교체**(공개 repo 평문 노출, 새 키는 GitHub Secrets — 상단 해당 항목). 아이콘: favicon 심볼 어댑티브 벡터.
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

## 2026-07-19(2) — UI 배치 다듬기 7건(첨부 참고: 새세션 모달·OpenAI Logs·검색 스니펫)
- **새 세션 모달 아이콘 다크 가림 수정**: 선택 카드 Avatar 가 primary(다크=거의 흰색) 배경+흰 아이콘이 되어 가려지던 문제 →
  선택 여부와 무관하게 아이콘 색 고정(연보라 배경+보라 아이콘). 선택은 테두리 링 + 우측 라디오로만 표시.
- **세션 목록 아이콘 통일**: 유형별 아이콘(스피커/화면/화살표) → 단일 채팅 버블 아이콘(IcoChat). (모달·⌘K 는 유형 아이콘 유지)
- **검색 스니펫**: `GET /api/sessions?q=` 가 매칭 발췌(snippet, 앞뒤 …)를 반환 → 목록 행이 제목 아래 발췌를 2줄로 표시,
  제목·발췌 모두 검색어 하이라이트(Highlight, 대소문자 무시). 제목만 매칭 시 발췌 없음.
- **헤더 제목 + 버튼 한 줄**: 제목(실시간 번역/데스크 안내)과 선택·새 세션 버튼을 같은 라인으로(별도 툴바 줄 제거).
- **세션 헤더 연결 점 이동**: connState 점을 제목 왼쪽 → 유형 칩([양방향 번역]) 우측으로. 데스크는 유형 라벨 옆에 점.
- **로그 UI = OpenAI 플랫폼 스타일**: LogsPanel 전면 재구성 — 상단 탭(안내데스크 응대 N / 세션 대화 N) + 검색 + 개수,
  컬럼 테이블(시각·데스크/제목·언어·응대시간·문장), 행 클릭 → 마스터-디테일 상세(브레드크럼 + 대화 전문 좌 / 속성 패널 우 +
  평가 JSON·삭제). 기존 아코디언 인라인 열람 폐기. 삭제·평가 JSON 기능 보존.
- **(제안만) 새 세션 모달 설명 직관화**: 사용자 요청대로 구현 전 아이디어 제시(대화로 회신).
- 검증: 빌드·테스트 24/24, 프리뷰 라이트/다크(모달 아이콘·검색 하이라이트·로그 테이블/상세·헤더 점) 확인, 콘솔 무오류.

## 2026-07-19 — UI 다듬기 7건(목록 Claude 스타일·케밥 통일) + 관리자 재배치(통계 이동·파이프라인별 사용량·전체 초기화)
- **세션 화면**: 번역 문장 사이 구분선 제거(여백만으로 구분, Row borderBottom 삭제).
- **케밥 메뉴 통일**: 세션 헤더 ⋯ 메뉴·세션 목록 케밥 메뉴에 Nav 프로필 메뉴와 동일 slotProps(fontSize 13) + 아웃라인 아이콘(Download→FileDownloadOutlined).
- **세션 목록(Claude 채팅 목록 스타일)**: 행 앞에 프리셋 아이콘(라이브=스피커·온라인회의=화면·양방향=화살표, 데스크=IcoHeadset),
  행 사이 구분선(마지막 제외), hover 시 시간↔케밥 스왑(3버튼 오버레이 폐기 — 데스크톱도 케밥 메뉴로 통일).
- **데스크 운영 통계 → 관리자>안내데스크 탭으로 이동**(정의 CRUD 아래). KPI 개편: 오늘 응대→**총 응대 건수(기간)**,
  응대당 문장→**총 응대 시간(기간)**(sub 응대당 평균) + 평균(중앙값)·누화 유지. **기간 세그먼트 7/14/30일/월별** —
  KPI·응대 추이·언어 분포·시간대별 전부 rows(응대 원자료, 데스크당 최근 500건) 기반으로 기간 재계산. 월별은 연도 라벨.
- **파이프라인별 사용량(③)**: soniox client_reference_id 를 `u:<id>|p:<desk|live>` 로 확장 태깅(runSoniox/runDesk staff·guest/폰 PTT)
  → usage-logs 파서가 byPipe(desk/live/etc=미태깅 과거) 집계, 카드의 유저별 자리에 '실시간 번역/안내데스크' 표시.
  Cartesia 는 벤더 API 가 태그 미지원 → **자체 집계**(vendorUsage.cartesiaSelf, 합성 요청 시 문자수·건수 recordTts) 로 카드에 표시.
- **유저별 사용량(④)**: Soniox 카드에서 분리해 사용량 페이지 하단 별도 패널(UserUsagePanel).
- **전체 초기화(⑤)**: POST /api/admin/reset-all — requireAdmin + 본문에서 관리자 비밀번호 재확인(timingSafeEqual).
  라이브 연결 close 후 대화·응대 기록 삭제(Mongo deleteMany/파일). 보존: 계정·데스크 정의·용어·사용량. (2026-07-30: 안내데스크 세션 자체는 보존하고 내용만 비우도록 변경 — 세션 id 가 바뀌면 뷰어 토큰·인쇄 QR 이 무효가 되기 때문)
  시스템·보안 탭에 위험 버튼 + 경고 모달(백업 안내 포함). 프리뷰에서 오입력 403 + 데이터 무손상 확인.
- 검증: 빌드·테스트 24/24, 프리뷰 스모크(목록 hover 케밥·구분선 제거·안내데스크 통계 14일/월별·파이프라인별 카드·초기화 403).

## 2026-07-16(5) — 테스트 인프라: 가짜 엔진 + 순수 로직 분리 + 회귀 테스트 (24개, 무과금 <1s)
- **pipeline_util.js 신설**(security_util.js 패턴): kstDay·CONFFIX/confFixTrigger/confFixMark·isAckOnly·stripFillers·
  sanitizeTranslation·deskCtlAllowed(now 주입 가능) 를 server.js 에서 분리 — 테스트가 직접 임포트.
- **엔진 오버라이드**: `SONIOX_WS_URL`(5개 접속 지점)·`CARTESIA_TTS_WS_URL`·`DATA_DIR` 환경변수 — 테스트는
  가짜 엔진·임시 데이터 디렉터리로 격리(실 엔진 호출 = 과금이므로 자동 테스트에서 금지).
- **test/helpers/**: fake-soniox.mjs(config 캡처 + 토큰 시나리오 재생 WS 서버) · boot.mjs(격리 부팅·admin 로그인·until 폴링).
- **회귀 테스트**: logic.test.mjs 15개(confFix 임계 = NOTES 2026-07-14(5) 근거 고정) ·
  desk-pipeline.test.mjs(응대 시작→sentence(lang 포함)→**호스트 급이탈 아카이브(C1)**·**start 난사 차단(C2)**) ·
  store.test.mjs(손상 sessions.json → .corrupt 백업 + 타 파일 정상 로드). C1 은 수정을 임시 되돌려 실패를 실증 후 복원(레드 확인).
- **npm test 글롭을 `test/*.test.mjs` 로 제한 + soniox-pairs.mjs 를 eval/ 로 이동** — node --test 가 test/ 하위
  전 파일을 실행해 과금 진단 스크립트가 매 테스트마다 31초간 실 Soniox 에 붙던 문제 제거(스위트 31s→0.8s).
- 24/24 통과. 새 시나리오 작성법·과금 실검증 경로는 README '테스트' 섹션.

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
- **상단 탭 제거 → 좌측 nav 하위메뉴**: `Nav.jsx` `ADMIN_TABS`(사용량/로그/안내데스크/계정 관리/용어 설정/시스템·보안). (정형 안내 탭은 2026-07-30 폐지)
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
