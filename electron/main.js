const path = require('path');
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { createProfileStore } = require('../src/core/profile-store');
const { createLaunchService } = require('../src/core/launch-service');

let mainWindow = null;
let store = null;
let launchService = null;
const pendingOpenPaths = new Set();
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

function queueOpenPath(targetPath) {
  if (targetPath) pendingOpenPaths.add(targetPath);
}

async function importPendingPaths() {
  if (!launchService || pendingOpenPaths.size === 0) return;
  const paths = [...pendingOpenPaths];
  pendingOpenPaths.clear();
  try {
    await launchService.importPaths(paths);
    emitProfilesUpdated();
  } catch (error) {
    console.error('Failed to import pending paths:', error);
  }
}

function emitProfilesUpdated() {
  if (!store) return;
  const profiles = store.listProfiles();
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('profiles:updated', profiles);
    }
  }
}

async function reconcileAndEmitProfiles() {
  if (!launchService) return;
  await launchService.reconcileProfiles();
  emitProfilesUpdated();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#08141f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'app', 'index.html'));
}

app.whenReady().then(() => {
  store = createProfileStore(path.join(app.getPath('userData'), 'profiles'));
  launchService = createLaunchService({
    store,
    userDataPath: app.getPath('userData'),
  });

  const argvPaths = process.argv.slice(1).filter((value) => value && !value.startsWith('-'));
  for (const argvPath of argvPaths) queueOpenPath(argvPath);

  createWindow();
  reconcileAndEmitProfiles().catch((error) => console.error(error));
  importPendingPaths().catch((error) => console.error(error));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('second-instance', (_event, argv) => {
  const argvPaths = argv.slice(1).filter((value) => value && !value.startsWith('-'));
  for (const argvPath of argvPaths) queueOpenPath(argvPath);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (app.isReady()) {
    importPendingPaths().catch((error) => console.error(error));
  }
});

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  queueOpenPath(filePath);
  if (app.isReady()) {
    importPendingPaths().catch((error) => console.error(error));
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (launchService) launchService.shutdown();
});

ipcMain.handle('dialog:choose-paths', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [
      { name: 'Games and Installers', extensions: ['exe', 'msi', 'iso', 'app', 'zip', 'pck'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('profiles:list', () => store.listProfiles());

ipcMain.handle('profiles:import', async (_, rawPaths = []) => {
  const imported = await launchService.importPaths(rawPaths);
  emitProfilesUpdated();
  return imported;
});

ipcMain.handle('profiles:launch', async (_, profileId) => {
  const result = await launchService.launchProfile(profileId);
  emitProfilesUpdated();
  return result;
});
ipcMain.handle('profiles:rescan', async (_, profileId) => {
  const result = await launchService.rescanProfile(profileId);
  emitProfilesUpdated();
  return result;
});
ipcMain.handle('profiles:download-runtime', async (_, profileId) => {
  const result = await launchService.downloadRuntime(profileId);
  emitProfilesUpdated();
  return result;
});
ipcMain.handle('profiles:crossover', async (_, profileId) => {
  const result = await launchService.tryCrossOver(profileId);
  emitProfilesUpdated();
  return result;
});

ipcMain.handle('profiles:reveal', async (_, profileId) => {
  const profile = store.getProfile(profileId);
  if (!profile) throw new Error(`Unknown profile: ${profileId}`);
  const target = (profile.lastResult && profile.lastResult.launchTarget) || profile.installedPath || profile.sourcePath;
  return shell.showItemInFolder(target);
});
