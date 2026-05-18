const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { spawn } = require('child_process');
const { ensureDir } = require('./utils');
const { scanPath, walkLimited } = require('./scan');
const { resolveRuntime, getInstalledRuntimePaths } = require('./runtime-resolver');
const { mountIso, detachIso, chooseInstallerCandidate } = require('./iso');
const {
  buildBottleName,
  createBottleDriveSnapshot,
  diffBottleSnapshot,
  ensureBottle,
  runWhiskyProgram,
  spawnWhiskyProgram,
} = require('./whisky');
const { ensureRenPyRuntime } = require('./downloads');
const { discoverImportTargets } = require('./import-discovery');
const { quickLaunch } = require('./quick-launch');

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...options,
  });
  child.unref();
  return child;
}

function createBrowserServerManager() {
  const servers = new Map();
  let activeRootPath = null;

  function stopServer(child) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Ignore cleanup failures on shutdown.
    }
  }

  function ensureServer(rootPath) {
    const existing = servers.get(rootPath);
    if (existing && !existing.killed) {
      return existing;
    }

    if (activeRootPath && activeRootPath !== rootPath) {
      const activeServer = servers.get(activeRootPath);
      if (activeServer) stopServer(activeServer);
      servers.delete(activeRootPath);
      activeRootPath = null;
    }

    const child = spawn('/usr/bin/python3', ['-m', 'http.server', '8080'], {
      cwd: rootPath,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    servers.set(rootPath, child);
    activeRootPath = rootPath;
    return child;
  }

  function stopAll() {
    for (const child of servers.values()) {
      stopServer(child);
    }
    servers.clear();
    activeRootPath = null;
  }

  return {
    ensureServer,
    stopAll,
  };
}

function createLaunchService({ store, userDataPath }) {
  const runtimes = getInstalledRuntimePaths();
  const browserServers = createBrowserServerManager();
  const cacheRoot = ensureDir(path.join(userDataPath, 'runtime-cache'));

  async function createProfileFromPath(targetPath) {
    const scanResult = scanPath(targetPath);
    const canonicalSourcePath = (!scanResult.installable && !scanResult.requiresMount && scanResult.rootPath)
      ? scanResult.rootPath
      : path.resolve(targetPath);
    const profileId = require('./utils').createId(canonicalSourcePath);
    const runtimeResolution = resolveRuntime(scanResult, { runtimes });
    const needsManagedBottle = runtimeResolution.strategy === 'whisky';
    const profile = store.upsertProfile({
      id: profileId,
      displayName: scanResult.displayName,
      sourcePath: canonicalSourcePath,
      installedPath: null,
      engine: scanResult.engine,
      bottleName: needsManagedBottle
        ? buildBottleName({ id: profileId, displayName: scanResult.displayName })
        : null,
      launchCommand: runtimeResolution,
      runtimeCacheRef: null,
      lastResult: scanResult,
      lastError: null,
      status: runtimeResolution.strategy === 'blocked' ? 'attention' : 'ready',
    });
    return profile;
  }

  async function importPaths(rawPaths = []) {
    const imported = [];
    const seen = new Set();
    for (const rawPath of rawPaths) {
      const discovered = discoverImportTargets(rawPath);
      const targets = discovered.length ? discovered : [rawPath];
      for (const target of targets) {
        const resolved = path.resolve(target);
        if (seen.has(resolved)) continue;
        seen.add(resolved);
        imported.push(await createProfileFromPath(resolved));
      }
    }
    return imported;
  }

  async function rescanProfile(profileId) {
    const profile = store.getProfile(profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);
    const scanResult = scanPath(profile.installedPath || profile.sourcePath);
    const runtimeResolution = resolveRuntime(scanResult, { runtimes });
    return store.patchProfile(profileId, {
      engine: scanResult.engine,
      bottleName: runtimeResolution.strategy === 'whisky'
        ? (profile.bottleName || buildBottleName({ id: profile.id, displayName: scanResult.displayName }))
        : null,
      launchCommand: runtimeResolution,
      lastResult: scanResult,
      lastError: null,
      status: runtimeResolution.strategy === 'blocked' ? 'attention' : 'ready',
    });
  }

  async function reconcileProfiles() {
    const profiles = store.listProfiles();
    const reconciled = [];
    for (const profile of profiles) {
      try {
        const scanResult = scanPath(profile.installedPath || profile.sourcePath);
        const runtimeResolution = resolveRuntime(scanResult, { runtimes });
        reconciled.push(store.patchProfile(profile.id, {
          displayName: scanResult.displayName,
          sourcePath: (!scanResult.installable && !scanResult.requiresMount && scanResult.rootPath)
            ? scanResult.rootPath
            : profile.sourcePath,
          engine: scanResult.engine,
          bottleName: runtimeResolution.strategy === 'whisky'
            ? (profile.bottleName || buildBottleName({ id: profile.id, displayName: scanResult.displayName }))
            : null,
          launchCommand: runtimeResolution,
          lastResult: scanResult,
          lastError: runtimeResolution.strategy === 'blocked' ? profile.lastError : null,
          status: runtimeResolution.strategy === 'blocked' ? 'attention' : 'ready',
        }));
      } catch {
        reconciled.push(profile);
      }
    }
    return reconciled;
  }

  async function downloadRuntime(profileId) {
    const profile = store.getProfile(profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);
    if (profile.engine !== 'renpy') {
      throw new Error(`No downloadable runtime is configured for ${profile.engine}.`);
    }
    const runtime = await ensureRenPyRuntime(cacheRoot);
    return store.patchProfile(profileId, {
      runtimeCacheRef: runtime.runtimePath,
      status: 'ready',
      lastError: null,
      launchCommand: {
        strategy: 'blocked',
        executablePath: runtime.runtimePath,
        args: [profile.sourcePath],
        env: {},
        downloadRequirement: null,
        reason: 'Ren\'Py runtime was downloaded from the official source and cached locally.',
      },
    });
  }

  async function resolveInstallerTarget(scanResult) {
    if (scanResult.engine === 'iso-installer') {
      const mount = await mountIso(scanResult.launchTarget);
      const mountedScan = scanPath(mount.mountPoint);
      const entries = walkLimited(mount.mountPoint, 4, 1500);
      const installerPath = chooseInstallerCandidate(entries, mount.mountPoint);
      return {
        installerPath,
        mountPoint: mount.mountPoint,
        mountedScan,
      };
    }
    return {
      installerPath: scanResult.launchTarget,
      mountPoint: null,
      mountedScan: null,
    };
  }

  async function performInstall(profile, scanResult) {
    const bottle = await ensureBottle(profile);
    const preInstallSnapshot = createBottleDriveSnapshot(bottle.bottlePath);
    const installer = await resolveInstallerTarget(scanResult);

    try {
      await runWhiskyProgram({
        bottleName: bottle.bottleName,
        executablePath: runtimes.whiskyCmd,
        launchTarget: installer.installerPath,
      });
      const newPrograms = diffBottleSnapshot(preInstallSnapshot, bottle.bottlePath);
      const launchTarget = newPrograms[0] || installer.installerPath;
      return {
        bottle,
        launchTarget,
        installedPath: path.dirname(launchTarget),
      };
    } finally {
      if (installer.mountPoint) {
        try {
          await detachIso(installer.mountPoint);
        } catch {
          // Ignore detach errors after install attempt.
        }
      }
    }
  }

  async function launchProfile(profileId) {
    const profile = store.getProfile(profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);
    const scanResult = profile.lastResult || scanPath(profile.installedPath || profile.sourcePath);
    let runtimeResolution = resolveRuntime(scanResult, { runtimes });

    try {
      const quick = await quickLaunch(scanResult);
      if (quick && quick.strategy !== 'defer-iso') {
        return store.patchProfile(profileId, {
          launchCommand: {
            ...runtimeResolution,
            strategy: quick.strategy,
            reason: `Quick launch opened ${quick.target}`,
          },
          status: 'ready',
          lastError: null,
        });
      }

      if (scanResult.installable) {
        const install = await performInstall(profile, scanResult);
        const rescanned = scanPath(install.installedPath);
        runtimeResolution = resolveRuntime(rescanned, { runtimes });
        store.patchProfile(profileId, {
          bottleName: install.bottle.bottleName,
          installedPath: install.installedPath,
          lastResult: rescanned,
          launchCommand: runtimeResolution,
          status: 'ready',
          lastError: null,
        });
        return launchProfile(profileId);
      }

      if (scanResult.engine === 'renpy') {
        const runtimePath = profile.runtimeCacheRef;
        if (!runtimePath) {
          throw new Error('Ren\'Py runtime is missing. Use Download Runtime first.');
        }
        spawnDetached('/bin/sh', [runtimePath, scanResult.rootPath], {
          cwd: path.dirname(runtimePath),
        });
      } else if (runtimeResolution.strategy === 'native-electron' || runtimeResolution.strategy === 'native-nwjs' || runtimeResolution.strategy === 'native-script') {
        spawnDetached(runtimeResolution.executablePath, runtimeResolution.args, {
          cwd: scanResult.rootPath,
        });
      } else if (runtimeResolution.strategy === 'browser') {
        browserServers.ensureServer(scanResult.rootPath);
        const relativeTarget = path.relative(scanResult.rootPath, scanResult.launchTarget || '').split(path.sep).join('/');
        const url = `http://127.0.0.1:8080/${relativeTarget || ''}`;
        await shell.openExternal(url);
      } else if (runtimeResolution.strategy === 'crossover') {
        spawnDetached('/usr/bin/open', ['-a', 'CrossOver', scanResult.launchTarget], {
          cwd: path.dirname(scanResult.launchTarget),
        });
      } else if (runtimeResolution.strategy === 'whisky') {
        const bottle = await ensureBottle(profile);
        spawnWhiskyProgram({
          bottleName: bottle.bottleName,
          launchTarget: scanResult.launchTarget,
        });
        store.patchProfile(profileId, {
          bottleName: bottle.bottleName,
        });
      } else {
        throw new Error(runtimeResolution.reason);
      }

      return store.patchProfile(profileId, {
        launchCommand: runtimeResolution,
        status: 'ready',
        lastError: null,
      });
    } catch (error) {
      return store.patchProfile(profileId, {
        launchCommand: runtimeResolution,
        status: 'attention',
        lastError: error.message,
      });
    }
  }

  async function tryCrossOver(profileId) {
    const profile = store.getProfile(profileId);
    if (!profile) throw new Error(`Unknown profile: ${profileId}`);
    const target = (profile.lastResult && profile.lastResult.launchTarget) || profile.installedPath || profile.sourcePath;
    const crossOverApp = '/Applications/CrossOver.app';
    if (!fs.existsSync(crossOverApp)) {
      throw new Error('CrossOver is not installed.');
    }
    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/open', ['-a', 'CrossOver', target], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr || 'Failed to open target in CrossOver.'));
      });
    });
    return store.patchProfile(profileId, {
      lastError: null,
      status: 'ready',
    });
  }

  function shutdown() {
    browserServers.stopAll();
  }

  return {
    createProfileFromPath,
    importPaths,
    downloadRuntime,
    launchProfile,
    reconcileProfiles,
    rescanProfile,
    shutdown,
    tryCrossOver,
  };
}

module.exports = {
  createLaunchService,
};
