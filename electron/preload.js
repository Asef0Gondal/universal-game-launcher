const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ugl', {
  choosePaths: () => ipcRenderer.invoke('dialog:choose-paths'),
  getProfiles: () => ipcRenderer.invoke('profiles:list'),
  importPaths: (paths) => ipcRenderer.invoke('profiles:import', paths),
  launchProfile: (id) => ipcRenderer.invoke('profiles:launch', id),
  rescanProfile: (id) => ipcRenderer.invoke('profiles:rescan', id),
  revealProfile: (id) => ipcRenderer.invoke('profiles:reveal', id),
  tryCrossOver: (id) => ipcRenderer.invoke('profiles:crossover', id),
  downloadRuntime: (id) => ipcRenderer.invoke('profiles:download-runtime', id),
  onProfilesUpdated: (handler) => {
    const wrapped = (_event, profiles) => handler(profiles);
    ipcRenderer.on('profiles:updated', wrapped);
    return () => ipcRenderer.removeListener('profiles:updated', wrapped);
  },
});
