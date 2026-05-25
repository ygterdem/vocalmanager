const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vm', {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  logRange: (entry) => ipcRenderer.invoke('range:log', entry),
  rangeHistory: () => ipcRenderer.invoke('range:history'),
  schedulePreview: () => ipcRenderer.invoke('schedule:preview'),
  getStats: () => ipcRenderer.invoke('stats:get'),
  recordSession: (payload) => ipcRenderer.invoke('stats:recordSession', payload),
  achievementsList: () => ipcRenderer.invoke('achievements:list'),
  getRoutines: () => ipcRenderer.invoke('routines:get'),
  saveRoutine: (routine) => ipcRenderer.invoke('routines:save', routine),
  deleteRoutine: (id) => ipcRenderer.invoke('routines:delete', id),
  setActiveRoutine: (id) => ipcRenderer.invoke('routines:setActive', id),
  getVersion: () => ipcRenderer.invoke('app:version'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  listAudioApps: () => ipcRenderer.invoke('appCapture:list'),
  startAppCapture: (pid) => ipcRenderer.invoke('appCapture:start', pid),
  stopAppCapture: () => ipcRenderer.invoke('appCapture:stop'),
  onAppCaptureData: (cb) =>
    ipcRenderer.on('appCapture:data', (_e, chunk) => cb(chunk)),
  onStartSession: (cb) =>
    ipcRenderer.on('start-session', (_e, payload) => cb(payload)),
  onOpenSettings: (cb) =>
    ipcRenderer.on('open-settings', () => cb()),
  onUpdateStatus: (cb) =>
    ipcRenderer.on('update-status', (_e, payload) => cb(payload))
});
