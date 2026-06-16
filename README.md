# KAC Translator

웹페이지에서 외국어 음성을 듣고 **OpenAI Realtime 번역 모델**(`gpt-realtime-translate`)로 번역,
**gpt-5-mini** 로 문장을 다듬어 실시간 표시합니다. 세션별로 대화가 자동 저장되고, **QR 코드**로 휴대폰에서도 함께 볼 수 있습니다.

## 기능
1. 외국어 음성 → 선택한 언어로 실시간 번역 (입력 언어는 자동 감지)
2. 문장 단위로 gpt-5-mini 가 자연스럽게 다듬음
3. 좌측 네비(클로드 스타일) · 세션 목록 · "새 세션"
4. **세션별 대화 자동 저장** (서버 `data/sessions.json`)
5. **시스템 소리 = 왼쪽 / 내 마이크 = 오른쪽** 채팅식 표시
6. 화이트/블랙 테마 (좌측 네비 하단 **설정** 아이콘)
7. QR 코드로 같은 와이파이 휴대폰에서 실시간 열람

## 기술 스택
- 프론트: **React 19 + MUI**(Vite 빌드, `client/` → `dist/`)
- 백엔드: Node(Express) + WebSocket, 세션 파일 저장(`data/sessions.json`)

## 설치 & 실행
```bash
npm install
copy .env.example .env   # (mac/linux: cp .env.example .env)
# .env 에 OPENAI_API_KEY 입력
npm start                # vite build 후 서버 실행 (dist 서빙)
```
- 코드 수정 후에는 `npm start`(빌드 포함) 또는 `npm run build` 후 `npm run serve`.
- 프론트만 빠르게 개발하려면: `npm run dev:client`(Vite) + 별도로 `npm run serve`.
- 데스크톱: http://localhost:3000
- 휴대폰: 번역 화면의 **모바일** 버튼 → QR 스캔 (PC와 같은 와이파이)

## 사용법
1. **새 세션** 생성 → 번역 화면 진입
2. 출력 언어 선택, 오디오 소스 선택
   - **마이크**: 내가 말하는 외국어 → 오른쪽에 표시
   - **시스템 소리**: PC에서 나는 소리 → 왼쪽에 표시
   - **둘 다**: 두 소스를 동시에 (각각 좌/우)
3. 하단 중앙 **재생(▷)** 버튼으로 시작, 다시 누르면 **정지(■)**
4. 헤더의 마이크 미터로 입력이 잡히는지 확인

### "이 컴퓨터의 모든 소리" 캡처 방법
브라우저 보안상 PC 전체 오디오를 자동으로 가져올 수는 없고, 권한 창이 한 번 뜹니다.
**시스템 소리**를 고르면 화면 공유 창이 뜨는데, 여기서

> **"전체 화면(Entire Screen)"** 선택 + 하단 **"시스템 오디오 공유"** 체크

하면 (특정 탭이 아니라) **PC에서 재생되는 모든 소리**가 잡힙니다. (Chrome / Edge 권장)

## 번역 방식(파이프라인) — 화면에서 토글
- **Whisper + GPT 번역** (기본, 저비용): `gpt-realtime-whisper`로 원문 전사(음성 출력 없음 = 음성 과금 0) → `gpt-5-mini`로 번역. **번역문 아래에 원어를 회색 작은 글씨로 표시**. 입력 언어 지정 가능. whisper는 server VAD 미지원이라 브라우저가 무음(약 0.7초)에서 commit.
- **Translate + GPT 다듬기** (고품질): `gpt-realtime-translate`로 번역 → `gpt-5-mini`로 다듬기. 음성 출력까지 생성돼 분당 비용이 약 2배.

## 참고
- 전사 모델: `.env` `TRANSCRIBE_MODEL` (기본 `gpt-realtime-whisper`). 대안: `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`.
- 번역/다듬기 모델: `.env` `REFINE_MODEL` (`gpt-5-mini`/`gpt-4.1-mini`/`gpt-5-nano`).
- "다듬기" 토글: 켜면 자연스럽게 의역, 끄면 빠른 직역(둘 다 번역은 수행).
- 출력 언어는 화면에서 선택, 기본값은 `.env` `TARGET_LANG`.
- 세션 데이터는 `data/sessions.json` 에 저장됩니다.
- 외부망에서 모바일 접속 시 HTTPS가 필요하면 리버스 프록시(ngrok, caddy 등)로 TLS를 붙이세요.
