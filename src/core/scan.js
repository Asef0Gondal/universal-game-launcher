const fs = require('fs');
const path = require('path');
const { getDisplayName, looksLikeInstaller, looksLikeUninstaller, looksLikeUtilityExecutable, safeStat, unique } = require('./utils');

const MAX_SCAN_ENTRIES = 4000;
const MAX_SCAN_DEPTH = 5;

function walkLimited(rootPath, maxDepth = MAX_SCAN_DEPTH, maxEntries = MAX_SCAN_ENTRIES) {
  const results = [];
  const queue = [{ fullPath: rootPath, depth: 0 }];

  while (queue.length && results.length < maxEntries) {
    const current = queue.shift();
    const stat = safeStat(current.fullPath);
    if (!stat || !stat.isDirectory()) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(current.fullPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxEntries) break;
      const fullPath = path.join(current.fullPath, entry.name);
      const relativePath = path.relative(rootPath, fullPath) || entry.name;
      const normalized = relativePath.split(path.sep).join('/');
      results.push({
        fullPath,
        relativePath: normalized,
        name: entry.name,
        isDirectory: entry.isDirectory(),
        depth: current.depth + 1,
      });
      if (entry.isDirectory() && current.depth + 1 < maxDepth) {
        queue.push({ fullPath, depth: current.depth + 1 });
      }
    }
  }

  return results;
}

function classifyPackageJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(raw);
    const keys = Object.keys(pkg || {});
    if (pkg.main && keys.includes('window')) return 'nwjs';
    if (pkg['chromium-args'] || pkg.window || pkg['node-remote']) return 'nwjs';
    if (pkg.main && /electron/i.test(JSON.stringify(pkg))) return 'electron';
    if (pkg.name && (fs.existsSync(path.join(path.dirname(filePath), 'www')) || fs.existsSync(path.join(path.dirname(filePath), 'js')))) {
      return 'rpgmaker-mv-mz';
    }
    if (fs.existsSync(path.join(path.dirname(filePath), 'www')) || fs.existsSync(path.join(path.dirname(filePath), 'js', 'plugins.js'))) {
      return 'rpgmaker-mv-mz';
    }
  } catch {
    return null;
  }
  return null;
}

function rankCandidate(engine, score, evidence, launchTarget) {
  return { engine, score, evidence, launchTarget };
}

function hasMacRenPyRuntime(rootPath) {
  return fs.existsSync(path.join(rootPath, 'lib', 'py3-mac-universal'));
}

function detectPortableExecutableArchitecture(filePath) {
  if (!filePath || path.extname(filePath).toLowerCase() !== '.exe') return null;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(4096);
      const bytesRead = fs.readSync(fd, header, 0, header.length, 0);
      if (bytesRead < 64 || header.toString('ascii', 0, 2) !== 'MZ') return null;
      const peOffset = header.readUInt32LE(0x3c);
      if (peOffset + 6 > bytesRead) return null;
      if (header.toString('ascii', peOffset, peOffset + 4) !== 'PE\u0000\u0000') return null;
      const machine = header.readUInt16LE(peOffset + 4);
      if (machine === 0x14c) return 'x86';
      if (machine === 0x8664) return 'x64';
      if (machine === 0xaa64) return 'arm64';
      return `machine-0x${machine.toString(16)}`;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function inferEngineRoot(engine, launchTarget, fallbackRoot) {
  if (!launchTarget) return fallbackRoot;
  if (engine === 'electron') {
    const parent = path.dirname(launchTarget);
    if (path.basename(parent).toLowerCase() === 'resources') {
      return path.dirname(parent);
    }
    return parent;
  }
  if (engine === 'nwjs' || engine === 'rpgmaker-mv-mz') return launchTarget;
  if (engine === 'tyranoscript') return path.resolve(path.dirname(launchTarget), '..', '..');
  if (engine === 'rpgmaker-legacy' || engine === 'renpy' || engine === 'kirikiri' || engine === 'unity-windows' || engine === 'godot') {
    return path.extname(launchTarget) ? path.dirname(launchTarget) : launchTarget;
  }
  return fallbackRoot;
}

function findCompanionExe(rootPath, entries, preferredBase) {
  const exeCandidates = entries
    .filter((entry) => !entry.isDirectory && /\.exe$/i.test(entry.name))
    .filter((entry) => !looksLikeInstaller(entry.name) && !looksLikeUninstaller(entry.name));

  const primaryCandidates = exeCandidates.filter((entry) => !looksLikeUtilityExecutable(entry.name));
  const rankedCandidates = primaryCandidates.length ? primaryCandidates : exeCandidates;

  if (preferredBase) {
    const exact = rankedCandidates.find((entry) => path.basename(entry.name, '.exe').toLowerCase() === preferredBase.toLowerCase());
    if (exact) return exact.fullPath;
  }

  const topLevel = rankedCandidates.find((entry) => entry.depth === 1);
  return topLevel ? topLevel.fullPath : (rankedCandidates[0] ? rankedCandidates[0].fullPath : null);
}

function detectMountedOrDirectory(rootPath, sourceType = 'directory') {
  const entries = walkLimited(rootPath);
  const topLevelNames = new Set();
  const lowerMap = new Map();

  for (const entry of entries) {
    if (entry.depth === 1) topLevelNames.add(entry.name.toLowerCase());
    lowerMap.set(entry.relativePath.toLowerCase(), entry);
  }

  const candidates = [];
  const evidence = [];

  const topLevelIndex = lowerMap.get('index.html');
  const startupTjs = lowerMap.get('data/system/startup.tjs');
  const appAsar = entries.find((entry) => !entry.isDirectory && /(^|\/)app\.asar$/i.test(entry.relativePath));
  const gameIni = lowerMap.get('game.ini');
  const packageJsonEntry = entries.find((entry) => !entry.isDirectory && entry.name.toLowerCase() === 'package.json');
  const renpyDir = entries.find((entry) => entry.isDirectory && entry.name.toLowerCase() === 'renpy');
  const rpyb = entries.find((entry) => !entry.isDirectory && /\.rpyb$/i.test(entry.name));
  const renpyShell = entries.find((entry) => !entry.isDirectory && /\.sh$/i.test(entry.name) && entry.depth === 1);
  const xp3 = entries.find((entry) => !entry.isDirectory && /\.xp3$/i.test(entry.name));
  const madChook = entries.find((entry) => !entry.isDirectory && entry.name.toLowerCase() === 'madchook.dll');
  const unityPlayer = entries.find((entry) => !entry.isDirectory && entry.name.toLowerCase() === 'unityplayer.dll');
  const unityDataDir = entries.find((entry) => entry.isDirectory && /_data$/i.test(entry.name));
  const pck = entries.find((entry) => !entry.isDirectory && /\.pck$/i.test(entry.name));
  const nestedHtml = entries.find((entry) => !entry.isDirectory && entry.relativePath.toLowerCase().endsWith('/index.html'));
  const topLevelInstaller = entries.find((entry) => !entry.isDirectory && /^(setup|install|installer|autorun)\.(exe|msi)$/i.test(entry.name));
  const nestedFilesExe = entries.find((entry) => !entry.isDirectory && /(^|\/)files\/.+\.exe$/i.test(entry.relativePath));

  if (appAsar) {
    candidates.push(rankCandidate('electron', 110, 'Found app.asar', appAsar.fullPath));
  }

  if (packageJsonEntry) {
    const packageType = classifyPackageJson(packageJsonEntry.fullPath);
    if (packageType === 'nwjs') {
      candidates.push(rankCandidate('nwjs', 104, 'package.json matched NW.js markers', path.dirname(packageJsonEntry.fullPath)));
    } else if (packageType === 'electron') {
      candidates.push(rankCandidate('electron', 103, 'package.json matched Electron markers', path.dirname(packageJsonEntry.fullPath)));
    } else if (packageType === 'rpgmaker-mv-mz') {
      candidates.push(rankCandidate('rpgmaker-mv-mz', 96, 'package.json + web assets matched RPG Maker MV/MZ', path.dirname(packageJsonEntry.fullPath)));
    }
  }

  if (startupTjs) {
    candidates.push(rankCandidate('tyranoscript', 98, 'Found data/system/startup.tjs', topLevelIndex ? topLevelIndex.fullPath : rootPath));
  }

  if (gameIni) {
    const companionExe = findCompanionExe(rootPath, entries);
    candidates.push(rankCandidate('rpgmaker-legacy', 97, 'Found Game.ini', companionExe || rootPath));
  }

  if (renpyDir || rpyb) {
    const renpyExecutable = findCompanionExe(rootPath, entries);
    const renpyMacRuntime = hasMacRenPyRuntime(rootPath);
    if (renpyShell && renpyMacRuntime) {
      candidates.push(rankCandidate('renpy', 94, 'Found Ren\'Py mac shell launcher', renpyShell.fullPath));
    } else if (renpyExecutable) {
      candidates.push(rankCandidate('renpy', 93, 'Found Ren\'Py Windows executable fallback', renpyExecutable));
    } else {
      candidates.push(rankCandidate('renpy', 92, renpyDir ? 'Found renpy/ folder' : 'Found .rpyb bytecode', rootPath));
    }
  }

  if (xp3 || madChook) {
    const companionExe = findCompanionExe(rootPath, entries);
    candidates.push(rankCandidate('kirikiri', 101, xp3 ? 'Found .xp3 archive' : 'Found madCHook.dll', companionExe || rootPath));
  }

  if (unityPlayer || unityDataDir) {
    const companionExe = findCompanionExe(rootPath, entries);
    candidates.push(rankCandidate('unity-windows', 100, unityPlayer ? 'Found UnityPlayer.dll' : 'Found *_Data directory', companionExe || rootPath));
  }

  if (pck) {
    const preferredBase = path.basename(pck.name, '.pck');
    const companionExe = findCompanionExe(rootPath, entries, preferredBase);
    candidates.push(rankCandidate('godot', companionExe ? 95 : 72, companionExe ? 'Found .pck + companion executable' : 'Found loose .pck without executable', companionExe || pck.fullPath));
  }

  if (topLevelIndex) {
    candidates.push(rankCandidate('html5', 60, 'Found top-level index.html', topLevelIndex.fullPath));
  } else if (nestedHtml) {
    candidates.push(rankCandidate('html5', 18, 'Found nested index.html only', nestedHtml.fullPath));
  }

  if (topLevelInstaller) {
    candidates.push(rankCandidate(topLevelInstaller.name.toLowerCase().endsWith('.msi') ? 'installer-msi' : 'installer-exe', 88, 'Found top-level installer entrypoint', topLevelInstaller.fullPath));
  } else if (nestedFilesExe) {
    candidates.push(rankCandidate('installer-exe', 70, 'Found nested executable inside Files/ installer layout', nestedFilesExe.fullPath));
  }

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];

  if (winner) {
    evidence.push(...unique(candidates.map((candidate) => candidate.evidence)));
    const engineRoot = inferEngineRoot(winner.engine, winner.launchTarget, rootPath);
    return {
      displayName: getDisplayName(engineRoot),
      engine: winner.engine,
      confidence: winner.score,
      evidence,
      rootPath: engineRoot,
      launchTarget: winner.launchTarget,
      binaryArchitecture: detectPortableExecutableArchitecture(winner.launchTarget),
      installable: winner.engine === 'installer-exe' || winner.engine === 'installer-msi',
      requiresRuntime: winner.engine === 'renpy'
        ? ((winner.launchTarget && /\.sh$/i.test(winner.launchTarget)) ? null : ((winner.launchTarget && /\.exe$/i.test(winner.launchTarget)) ? null : 'renpy'))
        : (winner.engine === 'godot' && /\.pck$/i.test(winner.launchTarget || '') ? 'godot-runtime' : null),
      requiresMount: false,
      sourceType,
      scanEntries: entries.length,
    };
  }

  return {
    displayName: getDisplayName(rootPath),
    engine: 'unknown',
    confidence: 0,
    evidence: ['No known engine markers found'],
    rootPath,
    launchTarget: topLevelIndex ? topLevelIndex.fullPath : null,
    installable: false,
    requiresRuntime: null,
    requiresMount: false,
    sourceType,
    scanEntries: entries.length,
  };
}

function scanPath(inputPath) {
  const stat = safeStat(inputPath);
  if (!stat) {
    throw new Error(`Path does not exist: ${inputPath}`);
  }

  if (stat.isDirectory()) {
    return detectMountedOrDirectory(path.resolve(inputPath), 'directory');
  }

  const absolutePath = path.resolve(inputPath);
  const extension = path.extname(absolutePath).toLowerCase();

  if (extension === '.iso') {
    return {
      displayName: getDisplayName(absolutePath),
      engine: 'iso-installer',
      confidence: 100,
      evidence: ['Dropped ISO image'],
      rootPath: absolutePath,
      launchTarget: absolutePath,
      binaryArchitecture: null,
      installable: true,
      requiresRuntime: null,
      requiresMount: true,
      sourceType: 'iso',
      scanEntries: 1,
    };
  }

  if (extension === '.msi') {
    return {
      displayName: getDisplayName(absolutePath),
      engine: 'installer-msi',
      confidence: 100,
      evidence: ['Dropped MSI installer'],
      rootPath: path.dirname(absolutePath),
      launchTarget: absolutePath,
      binaryArchitecture: null,
      installable: true,
      requiresRuntime: null,
      requiresMount: false,
      sourceType: 'file',
      scanEntries: 1,
    };
  }

  if (extension === '.exe') {
    const directoryScan = detectMountedOrDirectory(path.dirname(absolutePath), 'directory');
    const installer = looksLikeInstaller(path.basename(absolutePath));
    if (!installer && directoryScan.engine !== 'unknown' && directoryScan.engine !== 'html5') {
      directoryScan.launchTarget = absolutePath;
      directoryScan.evidence.unshift('Dropped executable inside detected game folder');
      directoryScan.binaryArchitecture = detectPortableExecutableArchitecture(absolutePath);
      return directoryScan;
    }
    return {
      displayName: getDisplayName(absolutePath),
      engine: installer ? 'installer-exe' : 'unity-windows',
      confidence: installer ? 100 : 55,
      evidence: installer ? ['Filename matched installer pattern'] : ['Dropped standalone EXE; treating as Windows executable'],
      rootPath: path.dirname(absolutePath),
      launchTarget: absolutePath,
      binaryArchitecture: detectPortableExecutableArchitecture(absolutePath),
      installable: installer,
      requiresRuntime: null,
      requiresMount: false,
      sourceType: 'file',
      scanEntries: 1,
    };
  }

  if (extension === '.pck') {
    const parent = path.dirname(absolutePath);
    const base = path.basename(absolutePath, '.pck');
    const entries = walkLimited(parent, 2, 500);
    const exe = findCompanionExe(parent, entries, base);
    return {
      displayName: getDisplayName(absolutePath),
      engine: 'godot',
      confidence: exe ? 95 : 70,
      evidence: exe ? ['Dropped .pck with matching executable'] : ['Dropped loose .pck without matching executable'],
      rootPath: parent,
      launchTarget: exe || absolutePath,
      binaryArchitecture: detectPortableExecutableArchitecture(exe),
      installable: false,
      requiresRuntime: exe ? null : 'godot-runtime',
      requiresMount: false,
      sourceType: 'file',
      scanEntries: entries.length,
    };
  }

  return {
    displayName: getDisplayName(absolutePath),
    engine: 'unknown',
    confidence: 0,
    evidence: ['Unsupported file type'],
    rootPath: path.dirname(absolutePath),
    launchTarget: absolutePath,
    installable: false,
    requiresRuntime: null,
    requiresMount: false,
    sourceType: 'file',
    scanEntries: 1,
  };
}

module.exports = {
  classifyPackageJson,
  detectMountedOrDirectory,
  inferEngineRoot,
  scanPath,
  walkLimited,
};
