const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { looksLikeInstaller, looksLikeUninstaller, looksLikeUtilityExecutable, chooseFirstExisting } = require('./utils');

function getElectronShell() {
  // Loaded lazily so plain Node-based tests can import this module.
  // In the packaged app this resolves normally through Electron.
  return require('electron').shell;
}

function walkForMatches(rootPath, matcher, maxDepth = 3) {
  const results = [];
  const queue = [{ dir: rootPath, depth: 0 }];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current.dir, entry.name);
      if (entry.isDirectory()) {
        if (current.depth < maxDepth) queue.push({ dir: fullPath, depth: current.depth + 1 });
      } else if (matcher(fullPath, entry.name, current.depth + 1)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

function chooseWindowsExecutable(rootPath) {
  const exeFiles = walkForMatches(
    rootPath,
    (fullPath, name, depth) => /\.exe$/i.test(name) && depth <= 3,
    3
  ).filter((fullPath) => {
    const name = path.basename(fullPath);
    return !looksLikeInstaller(name) && !looksLikeUninstaller(name);
  });

  const ranked = exeFiles
    .map((fullPath) => {
      const name = path.basename(fullPath);
      let score = 0;
      if (!looksLikeUtilityExecutable(name)) score += 100;
      if (/^game\.exe$/i.test(name) || /^start\.exe$/i.test(name)) score += 20;
      if (/[一-龯ぁ-ゔァ-ヴ]/.test(name)) score += 10;
      score -= fullPath.split(path.sep).length;
      return { fullPath, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.fullPath || null;
}

function hasMacRenPyRuntime(rootPath) {
  return fs.existsSync(path.join(rootPath, 'lib', 'py3-mac-universal'));
}

function spawnDetached(command, args, options = {}) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    ...options,
  });
  child.unref();
  return child.pid;
}

async function quickLaunch(scanResult) {
  const rootPath = scanResult.rootPath && fs.existsSync(scanResult.rootPath) ? scanResult.rootPath : path.dirname(scanResult.launchTarget || scanResult.rootPath || '');

  const appAsar = chooseFirstExisting([
    scanResult.launchTarget && /\.asar$/i.test(scanResult.launchTarget) ? scanResult.launchTarget : null,
    path.join(rootPath, 'resources', 'app.asar'),
    path.join(rootPath, 'app.asar'),
  ]);

  if (appAsar && fs.existsSync('/Applications/Electron.app/Contents/MacOS/Electron')) {
    spawnDetached('/Applications/Electron.app/Contents/MacOS/Electron', [appAsar], { cwd: path.dirname(appAsar) });
    return { strategy: 'quick-electron', target: appAsar };
  }

  const packageJsonDir = scanResult.engine === 'nwjs' || scanResult.engine === 'rpgmaker-mv-mz'
    ? rootPath
    : chooseFirstExisting(walkForMatches(rootPath, (_full, name, depth) => name === 'package.json' && depth <= 2, 2).map((pkg) => path.dirname(pkg)));
  if (packageJsonDir && fs.existsSync('/Applications/nwjs.app/Contents/MacOS/nwjs')) {
    spawnDetached('/Applications/nwjs.app/Contents/MacOS/nwjs', [packageJsonDir], { cwd: packageJsonDir });
    return { strategy: 'quick-nwjs', target: packageJsonDir };
  }

  if (fs.existsSync(path.join(rootPath, 'renpy'))) {
    const macApp = chooseFirstExisting(walkForMatches(rootPath, (_full, name, depth) => /\.app$/i.test(name) && depth <= 2, 2));
    if (macApp) {
      await getElectronShell().openPath(macApp);
      return { strategy: 'quick-renpy-app', target: macApp };
    }
    const shellScript = chooseFirstExisting(walkForMatches(rootPath, (_full, name, depth) => /\.sh$/i.test(name) && depth === 1, 1));
    if (shellScript && hasMacRenPyRuntime(rootPath)) {
      spawnDetached('/bin/sh', [shellScript], { cwd: rootPath });
      return { strategy: 'quick-renpy-shell', target: shellScript };
    }
  }

  if (scanResult.engine === 'iso-installer' && scanResult.launchTarget) {
    return { strategy: 'defer-iso', target: scanResult.launchTarget };
  }

  if (fs.existsSync(path.join(rootPath, 'index.html'))) {
    const python = chooseFirstExisting(['/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']);
    if (python) {
      spawnDetached(python, ['-m', 'http.server', '8080'], { cwd: rootPath });
      await getElectronShell().openExternal('http://127.0.0.1:8080/');
      return { strategy: 'quick-browser', target: path.join(rootPath, 'index.html') };
    }
  }

  return null;
}

module.exports = {
  chooseWindowsExecutable,
  hasMacRenPyRuntime,
  quickLaunch,
};
