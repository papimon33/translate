# KAC Translator

실시간 음성 번역 웹앱 (React+MUI 프론트 / Node+WebSocket 백엔드 / OpenAI 실시간·GPT 번역).

## 작업 시작 전 필수
- **먼저 `PROJECT_NOTES.md`를 읽어라.** 아키텍처·파이프라인(soniox/desk/translate)·핵심 로직·표시 규칙·파일 위치·WS 프로토콜·남은 배포 작업이 정리돼 있다.

## 빌드/실행
- 실행: `npm start` (= `vite build && node server.js`). 코드 수정 후엔 재시작 필요.
- 프론트만 빌드: `npm run build` / 서버만: `npm run serve`
- 프론트 소스는 `client/`, 빌드 산출물 `dist/`(express가 서빙). **`dist`를 직접 수정하지 말 것** — `client/` 고치고 빌드.
- 모바일 뷰어 `client/public/mobile.html`는 독립 바닐라 JS(React 아님).

## 규칙
- 번역 로직·프롬프트는 `server.js` 한 곳에 모여 있다. 수정 후 실제 음성(또는 TTS)으로 검증할 것.
- soniox=실시간 번역(단방향/양방향, 세션·데스크), translate=단일+띄어쓰기만 교정. whisper(구 4개국어 동시)는 삭제됨. 다듬기는 항상 on(토글 없음).
- `.env`에 `OPENAI_API_KEY` 필요. OpenAI 호출은 항상 과금되니 테스트 세션은 끝나고 삭제.
