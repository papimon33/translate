/* KAC Translator 데스크톱 앱 (통합형)
   - 메인 창: 배포된 웹앱 전체(로그인·세션·녹음)를 그대로 로드.
   - 오버레이 창: 앱 안에서 '오버레이 열기'로 띄우는 투명·항상위·클릭통과 자막 창.
   - 투명도/클릭통과는 메인 창 UI(또는 단축키)에서 IPC로 오버레이에 실시간 반영.
   웹앱 코드는 그대로 두고(원격 로드) 이 폴더만 독립 빌드한다.

   환경변수:
     KAC_URL / OVERLAY_URL  로드할 사이트 베이스 URL (기본: 배포 사이트)

   단축키:
     Ctrl+Shift+Q  종료
*/
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

const SITE = (process.env.KAC_URL || process.env.OVERLAY_URL || 'https://translate-voxm.onrender.com').replace(/\/$/, '');

let mainWin = null;
let overlayWin = null;

function createMain() {
  mainWin = new BrowserWindow({
    width: 1180, height: 820, minWidth: 900, minHeight: 600,
    backgroundColor: '#0f1115',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  try { mainWin.removeMenu(); } catch {}
  mainWin.loadURL(SITE);

  // 시스템 오디오 캡처: 웹의 getDisplayMedia(시스템 소리 공유) 요청을 Electron이 처리.
  // audio:'loopback' 은 Windows 전용 — macOS 에서 지정하면 요청 전체가 실패해 화면공유까지 죽는다.
  // macOS 는 비디오만 승인(시스템 오디오는 BlackHole 등 가상 드라이버 필요, desktop/README.md 참고).
  mainWin.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      if (!sources.length) { callback({}); return; } // 화면 기록 권한 미허용 등 — 명시적 거부
      callback({ video: sources[0], ...(process.platform === 'win32' ? { audio: 'loopback' } : {}) });
    }).catch(() => callback({}));
  });

  mainWin.on('closed', () => { mainWin = null; });
}

function overlayUrl(opts) {
  const u = new URL(SITE + '/overlay.html');
  if (opts && opts.session) u.searchParams.set('session', opts.session);
  if (opts && opts.cap != null) u.searchParams.set('cap', String(opts.cap));
  if (opts && opts.lang) u.searchParams.set('lang', opts.lang);
  return u.toString();
}

function openOverlay(opts) {
  if (overlayWin) {
    overlayWin.loadURL(overlayUrl(opts));
    overlayWin.show();
    return;
  }
  overlayWin = new BrowserWindow({
    width: 820, height: 260, minWidth: 320, minHeight: 110,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true,
    hasShadow: false, resizable: true, fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.loadURL(overlayUrl(opts));
  overlayWin.on('closed', () => { overlayWin = null; });
}

ipcMain.on('kac-open-overlay', (e, opts) => openOverlay(opts || {}));
ipcMain.on('kac-close-overlay', () => { if (overlayWin) overlayWin.close(); });
ipcMain.on('overlay-quit', () => app.quit());

app.whenReady().then(() => {
  createMain();
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
