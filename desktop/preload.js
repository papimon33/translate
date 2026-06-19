const { contextBridge, ipcRenderer } = require('electron');

// 오버레이 페이지에서 window.overlay.quit() 로 앱 종료 가능
contextBridge.exposeInMainWorld('overlay', {
  quit: () => ipcRenderer.send('overlay-quit'),
});
