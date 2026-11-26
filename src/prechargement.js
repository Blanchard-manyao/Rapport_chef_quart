const { contextBridge, ipcRenderer } = require("electron");
// API autorisée du navigateur vers le processus principal Electron.
contextBridge.exposeInMainWorld("rapportQuart", {
  chargerDonneesInitiales: () => ipcRenderer.invoke("bootstrap"),
  connecterUtilisateur: (x) => ipcRenderer.invoke("auth", x),
  activerApplication: () => ipcRenderer.invoke("focus-app"),
  confirmerCleRecuperation: () => ipcRenderer.invoke("ack-recovery"),
  reinitialiserMotDePasseEquipe: (x) => ipcRenderer.invoke("reset-equipe-password", x),
  capturerSynthese: (r) => ipcRenderer.invoke("capture-synthesis", r),
  ouvrirDossierCaptures: () => ipcRenderer.invoke("open-captures"),
  enregistrerRapport: (x) => ipcRenderer.invoke("save-report", x),
  configurerIdentifiantsSynchronisation: (x) => ipcRenderer.invoke("configure-sync-credentials", x),
  synchroniserRapportsDistants: (options) => ipcRenderer.invoke("sync-reports", options),
  deconnecterUtilisateur: () => ipcRenderer.invoke("logout"),
  exporterClasseurExcel: (x) => ipcRenderer.invoke("export-xlsx", x),
  changerMotDePasse: (x) => ipcRenderer.invoke("change-password", x),
});
