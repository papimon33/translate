/* KAC Translator 데스크톱 앱 (통합형)
   - 메인 창: 배포된 웹앱 전체(로그인·세션·녹음)를 그대로 로드.
   - 오버레이 창: 앱 안에서 '오버레이 열기'로 띄우는 투명·항상위·클릭통과 자막 창.
   - 투명도/클릭통과는 메인 창 UI(또는 단축키)에서 IPC로 오버레이에 실시간 반영.
   웹앱 코드는 그대로 두고(원격 로드) 이 폴더만 독립 빌드한다.

   환경변수:
     KAC_URL / OVERLAY_URL  로드할 사이트 베이스 URL (기본: 배포 사이트)

   단축키:
     Ctrl+Shift+O  오버레이 잠금(클릭 통과) 토글
     Ctrl+Shift+Q  종료
*/
const { app, BrowserWindow, globalShortcut, ipcMain, desktopCapturer } = require('electron');
const path = require('path');

const SITE = (process.env.KAC_URL || process.env.OVERLAY_URL || 'https://translate-voxm.onrender.com').replace(/\/$/, '');

let mainWin = null;
let overlayWin = null;
let overlayLocked = false;

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
  // Windows 는 audio:'loopback' 으로 시스템 출력음을 캡처.
  mainWin.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: 'loopback' });
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

function applyOverlayLock() {
  if (!overlayWin) return;
  overlayWin.setIgnoreMouseEvents(overlayLocked, { forward: true });
  overlayWin.webContents.executeJavaScript(`window.__setLock && window.__setLock(${overlayLocked})`).catch(() => {});
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
  overlayLocked = false;
  overlayWin.webContents.on('did-finish-load', applyOverlayLock);
  overlayWin.on('closed', () => { overlayWin = null; });
}

ipcMain.on('kac-open-overlay', (e, opts) => openOverlay(opts || {}));
ipcMain.on('kac-close-overlay', () => { if (overlayWin) overlayWin.close(); });
ipcMain.on('kac-overlay-opacity', (e, v) => {
  if (overlayWin) overlayWin.webContents.executeJavaScript(`window.__setCap && window.__setCap(${Number(v)})`).catch(() => {});
});
ipcMain.on('kac-overlay-clickthrough', (e, on) => { overlayLocked = !!on; applyOverlayLock(); });
ipcMain.on('overlay-quit', () => app.quit());

app.whenReady().then(() => {
  createMain();
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (overlayWin) { overlayLocked = !overlayLocked; applyOverlayLock(); }
  });
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());
});
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
