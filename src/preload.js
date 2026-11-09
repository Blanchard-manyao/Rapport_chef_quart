const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("cq", {
  bootstrap: () => ipcRenderer.invoke("bootstrap"),
  auth: (x) => ipcRenderer.invoke("auth", x),
  focusApp: () => ipcRenderer.invoke("focus-app"),
  ackRecovery: () => ipcRenderer.invoke("ack-recovery"),
  resetTeamPassword: (x) => ipcRenderer.invoke("reset-team-password", x),
  importLegacyDb: (x) => ipcRenderer.invoke("import-legacy-db", x),
  captureSynthesis: (r) => ipcRenderer.invoke("capture-synthesis", r),
  openCaptures: () => ipcRenderer.invoke("open-captures"),
  saveReport: (x) => ipcRenderer.invoke("save-report", x),
  logout: () => ipcRenderer.invoke("logout"),
  exportXlsx: (x) => ipcRenderer.invoke("export-xlsx", x),
  changePassword: (x) => ipcRenderer.invoke("change-password", x),
  exportBackup: () => ipcRenderer.invoke("export-backup"),
});
