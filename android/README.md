# AirTalk Android (안내데스크 태블릿용)

기존 웹앱(호스트 세션·데스크 뷰어·모바일 뷰어)을 WebView 로 그대로 띄우고,
**마이크만 네이티브 AudioRecord(VOICE_RECOGNITION 소스, AGC 완전 차단)** 로 캡처해
`window.AndroidAudio` 브리지로 웹에 공급하는 키오스크 앱.

브라우저(WebView 포함)는 `autoGainControl:false` 요청을 기기에 따라 무시해
민감도 게이트를 아무리 낮춰도 속삭임·원거리 소음이 증폭돼 들어오던 문제를 OS 레벨에서 해결한다.

## 구조
- `MainActivity.kt` — WebView 키오스크(서버 주소 저장, 몰입 전체화면, 화면 꺼짐 방지,
  렌더러 크래시 복구, 페이지 이동 시 캡처 강제 종료). **뒤로가기 = 관리 메뉴**
  (새로고침 / 서버 주소 변경 / 마이크 입력 게인 / 앱 정보).
- `NativeAudio.kt` — AudioRecord 캡처 → 24kHz PCM16 리샘플 → 소프트웨어 게인 →
  100ms base64 청크를 `window.__kacNA(b64)` 로 전달. AGC 명시 해제, AEC·NS 는 지원 기기만 부착.
- 웹 쪽 연동: `client/src/audio.js`(호스트), `client/public/desk.html`(여객 마이크),
  `client/public/mobile.html`(참여자 발화) — `window.AndroidAudio` 있으면 getUserMedia 대신 네이티브 사용.
  게이트(적응형 소음바닥)·VAD·전송 프로토콜은 브라우저 경로와 동일.

## 빌드
CI(GitHub Actions `main.yml` 의 `android` 잡)가 `desktop-v*` 태그/수동 실행 시 APK 를 빌드해
GitHub Release 에 올린다. 웹앱 프로필 → '데스크톱 앱' 모달에서 내려받는다.

로컬 빌드(Android SDK + JDK 17 필요):
```
gradle -p android assembleRelease   # 산출물: android/app/build/outputs/apk/release/AirTalk-<ver>-android.apk
```

서명: `app/airtalk-release.p12` (사이드로드 전용, repo 커밋 — 같은 키로 서명해야 덮어쓰기
업데이트가 되므로 CI 빌드 간 서명을 고정한다. 스토어 배포용 비밀키가 아님.)

## 태블릿 설치·운영
1. 태블릿 브라우저(크롬)로 서버 접속 → 로그인 → 프로필 → '데스크톱 앱' → Android APK 다운로드.
2. 설치 시 '알 수 없는 앱 설치 허용'(크롬에 대해 1회) → 설치.
3. 첫 실행: **서버 주소 입력**(전체 URL 가능 — 여객 뷰어 태블릿이면
   `https://…/desk.html?session=<데스크세션ID>` 를 그대로 입력) → 마이크 권한 허용.
4. 소리가 너무 작거나 크면: 뒤로가기 → '마이크 입력 게인'으로 보정(AGC 가 없으므로 이 값이 그대로 유지됨).
5. 문제 진단: 같은 네트워크 PC 크롬에서 `chrome://inspect` → 이 앱 WebView 원격 디버깅 가능.
