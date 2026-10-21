# AirTalk Android (안내데스크 태블릿·현장 폰용)

기존 웹앱(호스트 세션·데스크 뷰어·모바일 뷰어)을 WebView 로 그대로 띄우고,
**마이크만 네이티브 AudioRecord(VOICE_RECOGNITION 소스, AGC 완전 차단)** 로 캡처해
`window.AndroidAudio` 브리지로 웹에 공급하는 키오스크 앱.

브라우저(WebView 포함)는 `autoGainControl:false` 요청을 기기에 따라 무시해
민감도 게이트를 아무리 낮춰도 속삭임·원거리 소음이 증폭돼 들어오던 문제를 OS 레벨에서 해결한다.

## 구조
- `MainActivity.kt` — WebView 셸(서버 주소 저장, 렌더러 크래시 복구, 페이지 이동 시 캡처 강제 종료,
  시작 화면·**서버 연결 끊김 화면 + 자동 재연결**). 화면은 서버에서 오고, 앱에선 웹이 폰 전용 화면(`client/src/components/mobile/`)으로 바뀐다.
  - 손님 태블릿(주소 경로에 `desk`): 몰입 전체화면·화면 상시 켜짐·**뒤로가기 = 관리 메뉴**.
  - 폰: 상태바 표시, 번역 중에만 화면 켜짐, 뒤로가기 = 웹 화면 뒤로(첫 화면에서 두 번 누르면 종료), **길게 누르면 관리 메뉴**
    (새로고침 / 서버 주소 변경 / 마이크 입력 게인 / 앱 정보 — 폰 화면 계정 메뉴의 '앱 설정'으로도 열림).
  - `window.AndroidApp` 브리지: 녹취록 저장(저장 위치 선택), 링크 공유 시트, 화면 켜짐, 상태바 색.
- `NativeAudio.kt` — AudioRecord 캡처 → 24kHz PCM16 리샘플 → 소프트웨어 게인 →
  100ms base64 청크를 `window.__kacNA(b64)` 로 전달. AGC 명시 해제, AEC·NS 는 지원 기기만 부착.
  **외부 마이크 우선**: USB(USB-C 무선 수신기 등) → 유선 이어폰 마이크 → 내장 마이크 순으로 자동 선택하고,
  번역 중 꽂거나 뽑아도 끊지 않고 입력만 바꾼다(토스트로 알림). 블루투스 마이크는 음질(통화용 협대역) 문제로 자동으로는 고르지 않는다.
  - `window.AndroidAudio` 브리지: `start()`·`startStereo()`(2=스테레오 `__kacNA2` / 1=모노 `__kacNA` / 0=실패)·`stop()`,
    `inputLabel()`(마이크 칩), `inputs()`·`setInput(id)`(1.4.0~), `setGain`/`getGain`, `info()`, `setMediaVolume`/`getMediaVolume`.
  - **마이크 직접 선택(1.4.0~)**: `inputs()` = JSON 배열 `[{id, kind, label, selected, active?, channels?}]` — 첫 항목은 id 0 '자동'(active 없음),
    kind = `builtin`/`usb`/`wired`/`bluetooth`, 안드로이드가 두 번 내놓는 같은 장치(USB_DEVICE·USB_HEADSET, 주소별 내장 마이크)는 하나로.
    `selected` = 저장된 선택, `active` = 실제로 쓰는(대기 중이면 시작하면 쓸) 입력. 고른 장치가 빠져 있으면 '자동' 항목에 `missing`(그 장치 이름).
    `setInput(id)` = 선택 저장(종류+제품명으로 저장 → 다시 꽂거나 앱을 다시 켜도 유지, 0=자동, 모르는 id 면 false) + 번역 중이면 바로 전환
    (2채널로 듣는 중 내장·블루투스를 고르면 1채널로 다시 연다). 고른 장치가 빠지면 자동으로 돌다가 다시 연결되면 그 장치로 돌아간다.
    **블루투스**는 캡처하는 동안만 SCO 링크를 연다(API 31+ `setCommunicationDevice`, 그 이하 `startBluetoothSco`) — 다른 입력으로 바꾸거나
    정지·종료하면 놓는다. 링크를 못 열면 토스트 후 자동 선택으로 대신한다. 추가 권한 없음(`MODIFY_AUDIO_SETTINGS` 는 원래 있음).
    2채널(스테레오)은 USB 장치를 쓸 때만, 한 번 1채널이 된 세션은 끝까지 1채널.
- 웹 쪽 연동: `client/src/audio.js`(호스트), `client/public/desk.html`(여객 마이크)
  — `window.AndroidAudio` 있으면 getUserMedia 대신 네이티브 사용. 게이트(적응형 소음바닥)·VAD·전송 프로토콜은 브라우저 경로와 동일.
  앱에선 PC 소리 캡처가 불가하므로 호스트 화면의 '소리 입력'은 마이크로 고정된다.

## 빌드
CI(GitHub Actions `main.yml` 의 `android` 잡)가 `desktop-v*` 태그/수동 실행 시 APK 를 빌드해
GitHub Release 에 올린다. 웹앱 프로필 → '데스크톱 앱' 모달에서 내려받는다.

로컬 빌드(Android SDK + JDK 17 필요, 서명키 환경변수 없으면 미서명 APK):
```
ANDROID_KEYSTORE=/경로/airtalk-release.p12 ANDROID_KEYSTORE_PASSWORD=… gradle -p android assembleRelease
# 산출물: android/app/build/outputs/apk/release/AirTalk-<ver>-android.apk
```

**서명키는 repo 에 없다.** 같은 키로 서명한 APK 만 덮어쓰기 업데이트가 되므로 키를 잃으면 모든 기기에서
앱을 지우고 다시 설치해야 한다. 보관 위치: 관리자 PC 의 repo 밖 폴더(백업 필수) + GitHub Secrets
`ANDROID_KEYSTORE_B64`(p12 의 base64)·`ANDROID_KEYSTORE_PASSWORD`. CI 는 업로드 전 인증서 지문
(SHA-256 `DF:33:A8:E6:…:CD:6F`)을 검사해 다른 키로 서명된 APK 를 막는다.

## 설치·운영
1. 태블릿·폰 브라우저(크롬)로 서버 접속 → 로그인 → 프로필 → '데스크톱 앱' → Android APK 다운로드.
2. 설치 시 '알 수 없는 앱 설치 허용'(크롬에 대해 1회) → 설치.
3. 첫 실행: 서버 주소는 묻지 않는다 — 운영 서버(`https://translate-voxm.onrender.com`)가 기본으로 열린다(1.1.1~).
   마이크 권한 허용 → 로그인. 시험 서버로 바꿀 때만 관리 메뉴 '서버 주소 변경'(비우고 저장 = 기본값 복귀).
   안내데스크 손님 태블릿은 앱 대신 웹 브라우저로 데스크 세션 QR 주소(`…/desk.html?session=<ID>&t=<토큰>`)를 연다.
4. 무선마이크: USB-C 수신기를 꽂으면 자동으로 그쪽을 쓴다(시작 시 '마이크 입력: USB 마이크 …' 토스트).
   내장·블루투스 등 다른 입력을 쓰려면 폰 화면의 마이크 선택 시트에서 직접 고른다(1.4.0~, 기기에 저장 — '자동'을 고르면 원래 동작).
   지금 어떤 입력을 쓰는지는 뒤로가기 → '앱 정보'에서 확인(직접 선택/자동 선택 여부도 표시).
**업데이트**: 화면(웹)은 서버만 고치면 자동 반영. 앱 본체가 바뀌면(versionName 올려 CI 빌드) 앱 홈에서 '새 버전이 나왔습니다' 시트가 뜨고
'업데이트' 한 번으로 내려받아 설치 화면이 열린다(1.2.0~, 처음 한 번 'AirTalk 에서 앱 설치 허용'). **새 APK 는 반드시 versionName 을 올려야** 알림이 뜬다.
5. 소리가 너무 작거나 크면: 뒤로가기 → '마이크 입력 게인'으로 보정(AGC 가 없으므로 이 값이 그대로 유지됨).
6. 문제 진단: 같은 네트워크 PC 크롬에서 `chrome://inspect` → 이 앱 WebView 원격 디버깅 가능.
