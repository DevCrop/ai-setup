// The only bridge to page code: one method per channel of docs/api-claude-monitor.md section 4.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('monitor', Object.freeze({
  getStatus: () => ipcRenderer.invoke('status:get'),
  onStatusChanged: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('status:changed', listener);
    return () => ipcRenderer.removeListener('status:changed', listener);
  },
  getViewHtml: () => ipcRenderer.invoke('view:html'),
  listFindings: () => ipcRenderer.invoke('findings:list'),
  getCodexDetail: () => ipcRenderer.invoke('codex:detail'),
  listHistory: () => ipcRenderer.invoke('history:list'),
  copySummary: () => ipcRenderer.invoke('app:copy-summary'),
  previewFix: (findingId) => ipcRenderer.invoke('fix:preview', { findingId }),
  applyFix: (findingId, previewId) => ipcRenderer.invoke('fix:apply', { findingId, previewId }),
  restoreFix: (findingId) => ipcRenderer.invoke('fix:restore', { findingId }),
  openMain: (tab) => ipcRenderer.invoke('app:open-main', tab === undefined ? undefined : { tab }),
  refresh: () => ipcRenderer.invoke('app:refresh'),
  quit: () => ipcRenderer.invoke('app:quit'),
  showStripMenu: () => ipcRenderer.invoke('app:strip-menu'),
}));
