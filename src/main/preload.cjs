const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usageMonitor', Object.freeze({
  read: force => ipcRenderer.invoke('monitor:read', force === true),
  connectClaude: () => ipcRenderer.invoke('monitor:connect-claude'),
  quit: () => ipcRenderer.invoke('monitor:quit'),
  expand: expanded => ipcRenderer.invoke('monitor:expand', expanded),
  move: (x, y) => ipcRenderer.invoke('monitor:move', x, y),
  onUpdate: listener => { ipcRenderer.on('monitor:update', (_event, data) => listener(data)); },
  onGlass: listener => { ipcRenderer.on('monitor:glass', (_event, contrast) => listener(contrast)); },
}));
