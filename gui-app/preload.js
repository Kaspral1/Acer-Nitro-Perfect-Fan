/**
 * Preload bridge — safe IPC surface for the renderer.
 * contextIsolation: true, nodeIntegration: false
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Fan / daemon commands
  setFanSpeed: (data) => ipcRenderer.send('set-fan-speed', data),
  setMode: (mode) => ipcRenderer.send('set-mode', mode),
  applyProfile: (profile) => ipcRenderer.send('apply-profile', profile),
  setAutoLogging: (enabled) => ipcRenderer.send('set-auto-logging', enabled),
  getLogSummary: () => ipcRenderer.send('get-log-summary'),
  openLogFile: () => ipcRenderer.send('open-log-file'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  setFanCurve: (curveData) => ipcRenderer.send('set-fan-curve', curveData),
  setCurveSource: (source) => ipcRenderer.send('set-curve-source', source),
  setDefaultCurve: (payload) => ipcRenderer.send('set-default-curve', payload),
  resetDefaultCurves: (profile) => ipcRenderer.send('reset-default-curves', profile),
  setSpeedOffset: (offset) => ipcRenderer.send('set-speed-offset', offset),
  requestFanStatus: () => ipcRenderer.send('request-fan-status'),
  getKbdBacklight: () => ipcRenderer.invoke('get-kbd-backlight'),
  setKbdBacklight: (level) => ipcRenderer.invoke('set-kbd-backlight', level),
  setKbdTimeout: (enabled) => ipcRenderer.invoke('set-kbd-timeout', enabled),
  getThermalProfile: () => ipcRenderer.invoke('get-thermal-profile'),
  setThermalProfile: (profile) => ipcRenderer.invoke('set-thermal-profile', profile),

  // Window controls
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  windowHide: () => ipcRenderer.send('window-hide'),
  windowQuit: () => ipcRenderer.send('window-quit'),
  /** Synchronizuje preferencję X z main (null/'ask' | 'minimize' | 'quit') */
  setCloseActionPref: (action) => ipcRenderer.send('set-close-action-pref', action),

  // Async queries
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // Event subscriptions (return unsubscribe fn)
  onFanData: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('fan-data', handler);
    return () => ipcRenderer.removeListener('fan-data', handler);
  },
  onBackendStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('backend-status', handler);
    return () => ipcRenderer.removeListener('backend-status', handler);
  },
  onCloseRequested: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('close-requested', handler);
    return () => ipcRenderer.removeListener('close-requested', handler);
  },
});
