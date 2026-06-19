/* KAC Translator 줌 오버레이 (Electron 래퍼)
   배포된 웹앱의 /overlay.html 을 투명·항상위·클릭통과 창으로 띄운다.
   웹앱 자체는 건드리지 않는다(이 폴더는 별도 프로젝트).

   환경변수:
     OVERLAY_URL  오버레이를 띄울 베이스 URL (기본: 배포 사이트)
     SESSION      자동 연결할 세션 코드(선택). 없으면 창에서 입력.

   단축키:
     Ctrl+Shift+O  잠금(클릭 통과) 토글  ← 줌 위에 올려두고 클릭은 줌으로 통과
     Ctrl+Shift+Q  종료
*/
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const path = require('path');

const SITE = (process.env.OVERLAY_URL || 'https://translate-voxm.onrender.com').replace(/\/$/, '');
const SESSION = process.env.SESSION || '';

let win = null;
let locked = false;

function createWindow() {
  win = new BrowserWindow({
    width: 780,
    height: 260,
    minWidth: 320,
    minHeight: 120,
    transparent: true,    // 창 배경 투명 → 뒤(줌)가 비침
    frame: false,         // 테두리 없음
    alwaysOnTop: true,    // 항상 위
    skipTaskbar: true,    // 작업표시줄 미표시
    hasShadow: false,
    resizable: true,
    fullscreenable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 줌 전체화면/화면공유 위에도 유지
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  const url = SITE + '/overlay.html' + (SESSION ? ('?session=' + encodeURIComponent(SESSION)) : '');
  win.loadURL(url);

  const applyLock = () => {
    // forward:true → 통과시키면서도 hover 이벤트는 전달(필요 시)
    win.setIgnoreMouseEvents(locked, { forward: true });
    win.webContents.executeJavaScript(`window.__setLock && window.__setLock(${locked})`).catch(() => {});
  };
  win.webContents.on('did-finish-load', applyLock);

  globalShortcut.register('CommandOrControl+Shift+O', () => { locked = !locked; applyLock(); });
  globalShortcut.register('CommandOrControl+Shift+Q', () => app.quit());

  win.on('closed', () => { win = null; });
}

ipcMain.on('overlay-quit', () => app.quit());

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
