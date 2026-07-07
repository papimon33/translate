# KAC Translator 데스크톱 앱 (통합형)

배포된 웹앱을 그대로 감싸는 Electron 앱입니다. **하나의 exe**로:
- **메인 창** — 로그인·세션·녹음 등 전체 기능(웹앱 그대로).
- **오버레이 창** — 메인 창의 "오버레이 열기" 버튼으로 띄우는 **투명·항상 위·클릭 통과** 자막 창. 줌(Zoom) 위에 자막을 반투명하게 겹쳐 표시.
- **투명도·클릭 통과**를 메인 창 UI(또는 단축키)에서 실시간 조절.

웹앱 코드는 원격(배포 사이트)에서 로드하므로 이 폴더만 독립적으로 실행/빌드합니다.
브라우저·모바일(QR) 접속도 종전대로 동작합니다.

## 동작 방식
- 메인 창에서 평소처럼 세션을 만들고 **녹음**(마이크/시스템 오디오 모두 Electron이 캡처).
- 세션 화면 우상단 **오버레이 버튼**(▣) → 현재 세션 자막이 투명 창으로 뜸.
- 컨트롤 바의 **오버레이 투명도** 슬라이더 / **클릭 통과** 스위치로 조절.

## 실행 (개발/테스트)
```bash
cd desktop
npm install
npm start
```
- 기본은 배포 사이트(`https://translate-voxm.onrender.com`)를 띄웁니다.
- 로컬 서버로 테스트(웹앱을 루트에서 `npm start`로 띄운 상태):
  ```bash
  # Windows PowerShell
  $env:KAC_URL="http://localhost:3000"; npm start
  ```

## 단축키
| 키 | 동작 |
|---|---|
| `Ctrl+Shift+O` | 오버레이 잠금(클릭 통과) 토글 — 켜면 자막은 떠 있되 클릭은 줌으로 통과 |
| `Ctrl+Shift+Q` | 종료 |

오버레이 상단 바를 드래그해 이동하고, 바의 버튼으로 표시 언어·글자 크기·배경 농도·원문·닫기를 조절합니다. **잠금(클릭 통과) 상태에선 클릭이 통과되므로, 위치·설정을 바꾸려면 먼저 잠금을 해제하세요.**

## 설치파일 만들기 (Windows 설치 마법사 + macOS)

electron-builder 로 **파일 하나짜리 설치본**을 만듭니다.

```bash
cd desktop
npm install

# Windows 설치파일(NSIS 설치 마법사, 설치 경로 선택·바로가기 생성)
npm run dist:win     # → dist/KAC-Translator-Setup-1.0.0.exe

# macOS 설치파일(dmg — Apple Silicon + Intel)
npm run dist:mac     # → dist/KAC-Translator-1.0.0-arm64.dmg 등
```

- **Windows**: 생성된 `KAC-Translator-Setup-*.exe` 하나만 전달하면 됩니다. 실행하면
  설치 마법사가 뜨고(경로 선택 가능), 바탕화면·시작 메뉴 바로가기가 생깁니다.
  제거는 Windows 앱 설정에서 일반 프로그램처럼 제거.
- **macOS**: `*.dmg` 를 열어 앱을 Applications 로 드래그. 서명(코드사인) 없이 빌드하면
  첫 실행 시 우클릭 → 열기 로 Gatekeeper 를 통과해야 합니다. 조직 배포용이면
  Apple Developer 인증서로 서명·공증(notarize)을 권장.
- Windows 설치파일은 Windows 에서, macOS dmg 는 macOS 에서 빌드하는 것이 가장 확실합니다.
  (macOS 에서 `npm run dist:win` 도 대체로 동작하지만 서명 옵션에 따라 실패할 수 있음)

### macOS 사용 시 주의
- **마이크 모드**(양방향·라이브 청취)는 그대로 동작합니다. 첫 실행 시 마이크·화면 기록 권한을 허용하세요
  (시스템 설정 → 개인정보 보호 및 보안).
- **시스템 오디오 캡처**(온라인 회의 모드)는 macOS 가 기본 제공하지 않습니다.
  [BlackHole](https://existential.audio/blackhole/) 같은 가상 오디오 드라이버를 설치하고
  멀티 출력 장치를 구성해야 시스템 소리를 잡을 수 있습니다. 그 외 기능은 동일.

(참고: 예전 방식의 폴더형 포터블 빌드는 `npm run dist:portable` 로 여전히 가능)

## 참고
- 메인 창의 오버레이 버튼·투명도 슬라이더는 **Electron 앱에서만** 보입니다(일반 브라우저에선 자동 숨김).
- 새 기능(오버레이 버튼 등)은 **배포 사이트에 반영(재배포)된 뒤** exe에서 보입니다. exe는 코드를 원격 로드하기 때문입니다.
