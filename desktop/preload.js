const { contextBridge, ipcRenderer } = require('electron');

// 메인 창의 웹앱(React)에서 Electron 기능을 호출하는 다리.
// 일반 브라우저에는 window.kac 이 없으므로 React 쪽에서 존재 여부로 분기한다.
contextBridge.exposeInMainWorld('kac', {
  isElectron: true,
  openOverlay: (opts) => ipcRenderer.send('kac-open-overlay', opts || {}),
  closeOverlay: () => ipcRenderer.send('kac-close-overlay'),
  setOverlayOpacity: (v) => ipcRenderer.send('kac-overlay-opacity', v),
  setOverlayClickThrough: (on) => ipcRenderer.send('kac-overlay-clickthrough', on),
});

// 오버레이 창에서 앱 종료(필요 시)
contextBridge.exposeInMainWorld('overlay', {
  quit: () => ipcRenderer.send('overlay-quit'),
});
