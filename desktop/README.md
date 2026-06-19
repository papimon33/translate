# KAC Translator 줌 오버레이 (Electron)

배포된 웹앱의 `/overlay.html` 을 **투명·항상 위·클릭 통과** 창으로 띄워, 줌(Zoom) 같은 화면 위에 자막을 반투명하게 겹쳐 보여주는 데스크톱 래퍼입니다.

웹앱 자체는 그대로 두고(클라이언트에 `overlay.html` 한 파일만 추가됨) 이 폴더는 독립적으로 실행/패키징합니다.

## 동작 방식
- 녹음(호스트)은 평소처럼 **브라우저 웹앱**에서 진행.
- 이 오버레이 창은 해당 세션을 **뷰어(읽기 전용)**로 구독 → 자막만 표시. 마이크 권한·로그인 불필요.

## 실행 (개발/테스트)
```bash
cd desktop
npm install
npm start
```
- 기본은 배포 사이트(`https://translate-voxm.onrender.com`)의 `/overlay.html` 을 띄웁니다.
- 로컬 서버로 테스트하려면(웹앱을 `npm start`로 띄운 상태):
  ```bash
  # Windows PowerShell
  $env:OVERLAY_URL="http://localhost:3000"; npm start
  ```
- 세션을 자동 연결하려면:
  ```bash
  $env:SESSION="세션코드"; npm start
  ```
  지정하지 않으면 창에서 세션 링크/코드를 붙여넣어 연결합니다.
  (세션 코드는 웹앱 QR 모달의 "주소 복사" 링크 안 `session=...` 값)

## 단축키
| 키 | 동작 |
|---|---|
| `Ctrl+Shift+O` | 잠금(클릭 통과) 토글 — 켜면 자막은 떠 있되 클릭은 줌으로 통과 |
| `Ctrl+Shift+Q` | 종료 |

상단 바를 드래그해 창을 이동하고, 바의 버튼으로 표시 언어 · 글자 크기 · 배경 농도 · 원문 표시 · 닫기를 조절합니다. **잠금 상태에서는 클릭이 통과되므로, 위치·설정을 바꾸려면 먼저 잠금을 해제하세요.**

## 배포 파일(.exe) 만들기
```bash
cd desktop
npm install
npm run dist
```
`dist/KAC-Translator-Overlay-win32-x64/` 폴더가 생성되고, 그 안의
`KAC-Translator-Overlay.exe` 를 실행하면 됩니다.

> **폴더째로 보관/전달하세요.** exe 단독이 아니라 같은 폴더의 dll·리소스가
> 함께 있어야 실행됩니다. 다른 PC에 줄 땐 폴더 전체를 zip 으로 압축해 전달.

(electron-packager 사용 — Windows 개발자 모드 없이도 빌드됩니다. 단일 설치파일/
포터블 1개 파일이 필요하면 Windows 개발자 모드를 켠 뒤 electron-builder 로 빌드.)
