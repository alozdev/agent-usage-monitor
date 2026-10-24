const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('usageMonitor', {
  read: () => ipcRenderer.invoke('qa:read'),
  connectClaude: () => Promise.reject(new Error('QA never installs')),
  quit: () => {},
  expand: expanded => ipcRenderer.invoke('qa:expand', expanded),
  move: (x, y) => ipcRenderer.invoke('qa:move', x, y),
  onUpdate: () => {},
  onGlass: () => {},
});
