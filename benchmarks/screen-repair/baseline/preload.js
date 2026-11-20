const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('liveDesk', {
  isElectron: true,
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (c) => ipcRenderer.invoke('config:save', c),
  onConfigUpdated: (cb) => ipcRenderer.on('config-updated', (_e, c) => cb(c)),
  openPractice: () => ipcRenderer.invoke('practice:open'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  setCollapsed: (v) => ipcRenderer.invoke('overlay:collapse', v),
  setStealth: (v) => ipcRenderer.invoke('overlay:stealth', v),
  quitApp: () => ipcRenderer.invoke('app:quit'),
  llmChat: (req) => ipcRenderer.invoke('llm:chat', req),
  llmAbort: (id) => ipcRenderer.invoke('llm:abort', id),
  onLlmEvent: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('llm:event', h);
    return () => ipcRenderer.removeListener('llm:event', h);
  },
  transcribe: (req) => ipcRenderer.invoke('stt:transcribe', req),
  testLlm: (req) => ipcRenderer.invoke('llm:test', req),
  testStt: (req) => ipcRenderer.invoke('stt:test', req),
  ensureStt: () => ipcRenderer.invoke('stt:ensure'),
  ping: (url) => ipcRenderer.invoke('net:ping', { url }),
  screenCapture: (options) => ipcRenderer.invoke('screen:capture', options),
  screenDisplays: () => ipcRenderer.invoke('screen:displays'),
  visionRead: (req) => ipcRenderer.invoke('vision:read', req),
  cancelVision: () => ipcRenderer.invoke('vision:cancel'),
  llmModels: (req) => ipcRenderer.invoke('llm:models', req),
  ollamaEnsure: (model) => ipcRenderer.invoke('ollama:ensure', { model }),
  onOllamaProgress: (cb) => {
    const h = (_e, d) => cb(d);
    ipcRenderer.on('ollama:progress', h);
    return () => ipcRenderer.removeListener('ollama:progress', h);
  },
  onAnswerNow: (cb) => ipcRenderer.on('answer-now', () => cb()),
  onCurrentScreen: (cb) => ipcRenderer.on('current-screen', () => cb()),
  onToggleCollapse: (cb) => ipcRenderer.on('toggle-collapse', () => cb())
});
