const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chooseFirstExisting, looksLikeInstaller, slugify } = require('./utils');

const WHISKY_CMD = chooseFirstExisting([
  '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
      } else {
        reject(new Error(stderr || stdout || `Command failed with code ${code}`));
      }
    });
  });
}

function parseShellEnv(shellOutput) {
  const env = {};
  const aliases = {};
  for (const line of String(shellOutput).split('\n')) {
    const exportMatch = line.match(/^export ([A-Z0-9_]+)="?(.*?)"?$/);
    if (exportMatch) {
      let value = exportMatch[2];
      value = value.replace(/\$PATH\b/g, process.env.PATH || '');
      env[exportMatch[1]] = value;
      continue;
    }
    const aliasMatch = line.match(/^alias ([^=]+)="(.*)"$/);
    if (aliasMatch) aliases[aliasMatch[1]] = aliasMatch[2];
  }
  return { env, aliases };
}

function registryFilesExist(bottlePath) {
  return fs.existsSync(path.join(bottlePath, 'system.reg')) && fs.existsSync(path.join(bottlePath, 'user.reg'));
}

async function waitForBottleRegistry(bottlePath, timeoutMs = 60000, intervalMs = 250) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (registryFilesExist(bottlePath)) return true;
    await sleep(intervalMs);
  }
  return registryFilesExist(bottlePath);
}

async function initializeBottle(parsedShellEnv) {
  const env = {
    ...process.env,
    ...parsedShellEnv.env,
  };
  const wineBinary = parsedShellEnv.env.WINE || 'wine64';
  const child = spawn(wineBinary, ['wineboot', '-u'], {
    env,
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  const ready = await waitForBottleRegistry(parsedShellEnv.env.WINEPREFIX, 90000, 250);
  if (!ready) {
    throw new Error(`Whisky bottle initialization did not finish for ${parsedShellEnv.env.WINEPREFIX}.`);
  }
}

function buildBottleName(profile) {
  const slug = slugify(profile.displayName || profile.id || 'game');
  return `ugl-${slug}-${String(profile.id || '').slice(0, 6)}`.slice(0, 46);
}

async function listBottles() {
  if (!WHISKY_CMD) return [];
  const result = await runCommand(WHISKY_CMD, ['list']);
  const rows = result.stdout
    .split('\n')
    .filter((line) => /^\|\s+/.test(line))
    .slice(1);
  return rows.map((line) => {
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    return {
      name: cells[0],
      windowsVersion: cells[1],
      path: cells[2],
    };
  }).filter((entry) => entry.name && entry.path);
}

async function getBottleShellEnv(bottleName) {
  if (!WHISKY_CMD) throw new Error('Whisky is not installed.');
  try {
    return await runCommand(WHISKY_CMD, ['shellenv', bottleName]);
  } catch (error) {
    if (/bottle with that name doesn't exist/i.test(error.message) || /bottle not found/i.test(error.message)) {
      return null;
    }
    throw error;
  }
}

async function waitForBottleShellEnv(bottleName, timeoutMs = 60000, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const shellEnv = await getBottleShellEnv(bottleName);
    if (shellEnv) return shellEnv;
    await sleep(intervalMs);
  }
  return getBottleShellEnv(bottleName);
}

function shouldPatchJapaneseLocale(profile = {}) {
  return ['kirikiri', 'rpgmaker-legacy', 'installer-exe', 'installer-msi', 'iso-installer'].includes(profile.engine);
}

async function ensureBottle(profile) {
  if (!WHISKY_CMD) throw new Error('Whisky is not installed.');
  const bottleName = profile.bottleName || buildBottleName(profile);
  let shellEnv = await getBottleShellEnv(bottleName);
  if (!shellEnv) {
    await runCommand(WHISKY_CMD, ['create', bottleName]);
    shellEnv = await waitForBottleShellEnv(bottleName, 90000, 500);
  }
  if (!shellEnv) {
    throw new Error(`Whisky bottle could not be resolved after creation: ${bottleName}.`);
  }
  const parsed = parseShellEnv(shellEnv.stdout);
  const bottlePath = parsed.env.WINEPREFIX;
  if (!bottlePath) throw new Error(`Could not resolve Whisky bottle path for ${bottleName}.`);
  if (!registryFilesExist(bottlePath)) {
    await initializeBottle(parsed);
  }
  if (shouldPatchJapaneseLocale(profile)) {
    const localePatch = patchJapaneseLocale(bottlePath);
    if (localePatch.changed) {
      await refreshBottleLocale(parsed);
    }
  }
  return {
    bottleName,
    bottlePath,
    shellEnv: parsed.env,
  };
}

function findRegistrySection(lines, sectionName) {
  const escaped = sectionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^\\[${escaped}\\](?:\\s|$)`, 'i');
  return lines.findIndex((line) => pattern.test(line.trim()));
}

function upsertRegistryValue(contents, sectionName, key, value) {
  const lines = contents.split('\n');
  const sectionHeader = `[${sectionName}]`;
  let sectionStart = findRegistrySection(lines, sectionName);
  if (sectionStart === -1) {
    lines.push('', sectionHeader, `"${key}"="${value}"`);
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\[.*\]$/.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }

  const keyPattern = new RegExp(`^"${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"=`);
  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (keyPattern.test(lines[i])) {
      lines[i] = `"${key}"="${value}"`;
      return `${lines.join('\n').replace(/\n+$/, '')}\n`;
    }
  }

  lines.splice(sectionEnd, 0, `"${key}"="${value}"`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function upsertRegistryDefaultValue(contents, sectionName, value) {
  const lines = contents.split('\n');
  const sectionHeader = `[${sectionName}]`;
  let sectionStart = findRegistrySection(lines, sectionName);
  if (sectionStart === -1) {
    lines.push('', sectionHeader, `@="${value}"`);
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }

  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i += 1) {
    if (/^\[.*\]$/.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }

  for (let i = sectionStart + 1; i < sectionEnd; i += 1) {
    if (lines[i].startsWith('@=')) {
      lines[i] = `@="${value}"`;
      return `${lines.join('\n').replace(/\n+$/, '')}\n`;
    }
  }

  lines.splice(sectionEnd, 0, `@="${value}"`);
  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

function patchJapaneseLocale(bottlePath) {
  const systemRegPath = path.join(bottlePath, 'system.reg');
  const userRegPath = path.join(bottlePath, 'user.reg');
  if (!fs.existsSync(systemRegPath) || !fs.existsSync(userRegPath)) {
    throw new Error(`Whisky bottle registry files are missing in ${bottlePath}.`);
  }

  let systemReg = fs.readFileSync(systemRegPath, 'utf8');
  let userReg = fs.readFileSync(userRegPath, 'utf8');
  const previousSystemReg = systemReg;
  const previousUserReg = userReg;

  systemReg = upsertRegistryValue(systemReg, 'System\\CurrentControlSet\\Control\\Nls\\CodePage', 'ACP', '932');
  systemReg = upsertRegistryValue(systemReg, 'System\\CurrentControlSet\\Control\\Nls\\CodePage', 'OEMCP', '932');
  systemReg = upsertRegistryValue(systemReg, 'System\\CurrentControlSet\\Control\\Nls\\Language', 'Default', '0411');
  systemReg = upsertRegistryValue(systemReg, 'System\\CurrentControlSet\\Control\\Nls\\Language', 'InstallLanguage', '0411');
  systemReg = upsertRegistryDefaultValue(systemReg, 'System\\CurrentControlSet\\Control\\Nls\\Locale', '00000411');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International', 'Locale', '00000411');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International', 'LocaleName', 'ja-JP');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International', 'sLanguage', 'JPN');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International', 'sCountry', 'Japan');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International\\Geo', 'Name', 'JP');
  userReg = upsertRegistryValue(userReg, 'Control Panel\\International\\Geo', 'Nation', '122');
  userReg = upsertRegistryValue(userReg, 'Software\\Wine\\Fonts', 'Codepages', '932,932');

  fs.writeFileSync(systemRegPath, systemReg, 'utf8');
  fs.writeFileSync(userRegPath, userReg, 'utf8');

  return {
    systemRegPath,
    userRegPath,
    changed: systemReg !== previousSystemReg || userReg !== previousUserReg,
  };
}

async function refreshBottleLocale(parsedShellEnv) {
  const env = {
    ...process.env,
    ...parsedShellEnv.env,
  };
  const wineBinary = parsedShellEnv.env.WINE || 'wine64';

  try {
    await runCommand('wineserver', ['-k'], { env });
  } catch {
    // Ignore if the bottle is not running yet.
  }

  const registryCommands = [
    ['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'ACP', '/t', 'REG_SZ', '/d', '932', '/f'],
    ['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Control\\Nls\\CodePage', '/v', 'OEMCP', '/t', 'REG_SZ', '/d', '932', '/f'],
    ['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Control\\Nls\\Language', '/v', 'Default', '/t', 'REG_SZ', '/d', '0411', '/f'],
    ['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Control\\Nls\\Language', '/v', 'InstallLanguage', '/t', 'REG_SZ', '/d', '0411', '/f'],
    ['reg', 'add', 'HKLM\\System\\CurrentControlSet\\Control\\Nls\\Locale', '/ve', '/t', 'REG_SZ', '/d', '00000411', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International', '/v', 'Locale', '/t', 'REG_SZ', '/d', '00000411', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International', '/v', 'LocaleName', '/t', 'REG_SZ', '/d', 'ja-JP', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International', '/v', 'sLanguage', '/t', 'REG_SZ', '/d', 'JPN', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International', '/v', 'sCountry', '/t', 'REG_SZ', '/d', 'Japan', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International\\Geo', '/v', 'Name', '/t', 'REG_SZ', '/d', 'JP', '/f'],
    ['reg', 'add', 'HKCU\\Control Panel\\International\\Geo', '/v', 'Nation', '/t', 'REG_SZ', '/d', '122', '/f'],
    ['reg', 'add', 'HKCU\\Software\\Wine\\Fonts', '/v', 'Codepages', '/t', 'REG_SZ', '/d', '932,932', '/f'],
  ];

  for (const args of registryCommands) {
    await runCommand(wineBinary, args, { env });
  }

  await runCommand(wineBinary, ['wineboot', '-u'], { env });
}

function createBottleDriveSnapshot(bottlePath) {
  const driveC = path.join(bottlePath, 'drive_c');
  const found = [];
  const queue = [driveC];

  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (/\.(exe|msi)$/i.test(entry.name) && !looksLikeInstaller(entry.name)) {
        found.push(fullPath);
      }
    }
  }

  return new Set(found);
}

function diffBottleSnapshot(beforeSnapshot, bottlePath) {
  const driveC = path.join(bottlePath, 'drive_c');
  const candidates = [];
  const queue = [driveC];

  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
      } else if (/\.(exe|msi)$/i.test(entry.name) && !beforeSnapshot.has(fullPath) && !looksLikeInstaller(entry.name)) {
        candidates.push(fullPath);
      }
    }
  }

  return candidates.sort();
}

async function runWhiskyProgram({ bottleName, executablePath, launchTarget, args = [] }) {
  if (!WHISKY_CMD) throw new Error('Whisky is not installed.');
  if (path.extname(launchTarget).toLowerCase() === '.msi') {
    const shellResult = await runCommand(WHISKY_CMD, ['shellenv', bottleName]);
    const parsed = parseShellEnv(shellResult.stdout);
    const env = {
      ...process.env,
      ...parsed.env,
    };
    const wineBinary = 'wine64';
    return runCommand(wineBinary, ['msiexec', '/i', launchTarget, ...args], { env });
  }
  return runCommand(executablePath || WHISKY_CMD, ['run', bottleName, launchTarget, ...args]);
}

function spawnWhiskyProgram({ bottleName, launchTarget, args = [] }) {
  if (!WHISKY_CMD) throw new Error('Whisky is not installed.');
  const child = spawn(WHISKY_CMD, ['run', bottleName, launchTarget, ...args], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return child.pid;
}

module.exports = {
  WHISKY_CMD,
  buildBottleName,
  createBottleDriveSnapshot,
  diffBottleSnapshot,
  ensureBottle,
  initializeBottle,
  parseShellEnv,
  patchJapaneseLocale,
  refreshBottleLocale,
  registryFilesExist,
  runCommand,
  runWhiskyProgram,
  spawnWhiskyProgram,
  waitForBottleShellEnv,
  waitForBottleRegistry,
};
