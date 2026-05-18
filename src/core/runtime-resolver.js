const path = require('path');
const { chooseFirstExisting } = require('./utils');

function getInstalledRuntimePaths() {
  return {
    electron: chooseFirstExisting([
      '/Applications/Electron.app/Contents/MacOS/Electron',
    ]),
    nwjs: chooseFirstExisting([
      '/Applications/nwjs.app/Contents/MacOS/nwjs',
    ]),
    whiskyCmd: chooseFirstExisting([
      '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
    ]),
    crossover: chooseFirstExisting([
      '/Applications/CrossOver.app',
    ]),
    python: chooseFirstExisting([
      '/usr/bin/python3',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
    ]),
  };
}

function resolveRuntime(scanResult, options = {}) {
  const runtimes = options.runtimes || getInstalledRuntimePaths();
  const is32BitWindowsBinary = scanResult.binaryArchitecture === 'x86';

  if (scanResult.engine === 'electron') {
    if (runtimes.electron) {
      return {
        strategy: 'native-electron',
        executablePath: runtimes.electron,
        args: [scanResult.launchTarget || scanResult.rootPath],
        env: {},
        downloadRequirement: null,
        reason: 'Electron runtime is installed locally.',
      };
    }
    return {
      strategy: 'blocked',
      executablePath: null,
      args: [],
      env: {},
      downloadRequirement: null,
      reason: 'Electron runtime is not installed.',
    };
  }

  if (scanResult.engine === 'nwjs') {
    if (runtimes.nwjs) {
      return {
        strategy: 'native-nwjs',
        executablePath: runtimes.nwjs,
        args: [scanResult.rootPath],
        env: {},
        downloadRequirement: null,
        reason: 'NW.js runtime is installed locally.',
      };
    }
    if (runtimes.python) {
      return {
        strategy: 'browser',
        executablePath: runtimes.python,
        args: ['-m', 'http.server', '8080'],
        env: {},
        downloadRequirement: null,
        reason: 'NW.js runtime is missing, so browser fallback will be used.',
      };
    }
  }

  if (['tyranoscript', 'rpgmaker-mv-mz', 'html5'].includes(scanResult.engine)) {
    if (scanResult.engine === 'rpgmaker-mv-mz' && runtimes.nwjs) {
      return {
        strategy: 'native-nwjs',
        executablePath: runtimes.nwjs,
        args: [scanResult.rootPath],
        env: {},
        downloadRequirement: null,
        reason: 'RPG Maker MV/MZ can run with the installed NW.js runtime.',
      };
    }
    if (runtimes.python) {
      return {
        strategy: 'browser',
        executablePath: runtimes.python,
        args: ['-m', 'http.server', '8080'],
        env: {},
        downloadRequirement: null,
        reason: 'HTML-based game will run via a temporary local web server.',
      };
    }
  }

  if (['rpgmaker-legacy', 'kirikiri', 'unity-windows', 'installer-exe', 'installer-msi', 'iso-installer'].includes(scanResult.engine)) {
    if (is32BitWindowsBinary) {
      if (runtimes.crossover) {
        return {
          strategy: 'crossover',
          executablePath: '/usr/bin/open',
          args: ['-a', 'CrossOver', scanResult.launchTarget],
          env: {},
          downloadRequirement: null,
          reason: 'Detected 32-bit Windows binary; CrossOver is preferred over Whisky on this Mac.',
        };
      }
      return {
        strategy: 'blocked',
        executablePath: null,
        args: [],
        env: {},
        downloadRequirement: null,
        reason: 'Detected 32-bit Windows binary. Whisky is not a reliable runtime for this title on this Mac.',
      };
    }
    if (runtimes.whiskyCmd) {
      return {
        strategy: 'whisky',
        executablePath: runtimes.whiskyCmd,
        args: [],
        env: {},
        downloadRequirement: null,
        reason: 'Windows-native title will run inside a managed Whisky bottle.',
      };
    }
    return {
      strategy: 'blocked',
      executablePath: null,
      args: [],
      env: {},
      downloadRequirement: null,
      reason: 'Whisky is required but not installed.',
    };
  }

  if (scanResult.engine === 'renpy') {
    if (scanResult.launchTarget && path.extname(scanResult.launchTarget).toLowerCase() === '.sh') {
      return {
        strategy: 'native-script',
        executablePath: '/bin/sh',
        args: [scanResult.launchTarget],
        env: {},
        downloadRequirement: null,
        reason: 'Ren\'Py mac shell launcher is present.',
      };
    }
    if (scanResult.launchTarget && path.extname(scanResult.launchTarget).toLowerCase() === '.exe' && runtimes.whiskyCmd) {
      if (is32BitWindowsBinary) {
        if (runtimes.crossover) {
          return {
            strategy: 'crossover',
            executablePath: '/usr/bin/open',
            args: ['-a', 'CrossOver', scanResult.launchTarget],
            env: {},
            downloadRequirement: null,
            reason: 'Detected 32-bit RenPy Windows binary; CrossOver is preferred over Whisky on this Mac.',
          };
        }
        return {
          strategy: 'blocked',
          executablePath: null,
          args: [],
          env: {},
          downloadRequirement: null,
          reason: 'Detected 32-bit RenPy Windows binary. Whisky is not a reliable runtime for this title on this Mac.',
        };
      }
      return {
        strategy: 'whisky',
        executablePath: runtimes.whiskyCmd,
        args: [],
        env: {},
        downloadRequirement: null,
        reason: 'Ren\'Py Windows executable fallback will run inside a managed Whisky bottle.',
      };
    }
    return {
      strategy: 'blocked',
      executablePath: null,
      args: [],
      env: {},
      downloadRequirement: {
        runtime: 'renpy',
        source: 'https://www.renpy.org/latest.html',
      },
      reason: 'Ren\'Py runtime is not bundled and must be downloaded from the official source.',
    };
  }

  if (scanResult.engine === 'godot') {
    const launchTarget = scanResult.launchTarget || '';
    if (path.extname(launchTarget).toLowerCase() === '.exe' && runtimes.whiskyCmd) {
      if (is32BitWindowsBinary) {
        if (runtimes.crossover) {
          return {
            strategy: 'crossover',
            executablePath: '/usr/bin/open',
            args: ['-a', 'CrossOver', launchTarget],
            env: {},
            downloadRequirement: null,
            reason: 'Detected 32-bit Godot Windows binary; CrossOver is preferred over Whisky on this Mac.',
          };
        }
        return {
          strategy: 'blocked',
          executablePath: null,
          args: [],
          env: {},
          downloadRequirement: null,
          reason: 'Detected 32-bit Godot Windows binary. Whisky is not a reliable runtime for this title on this Mac.',
        };
      }
      return {
        strategy: 'whisky',
        executablePath: runtimes.whiskyCmd,
        args: [],
        env: {},
        downloadRequirement: null,
        reason: 'Godot Windows export has a companion executable and can run in Whisky.',
      };
    }
    return {
      strategy: 'blocked',
      executablePath: null,
      args: [],
      env: {},
      downloadRequirement: {
        runtime: 'godot-runtime',
        source: 'https://godotengine.org/download',
      },
      reason: 'Loose Godot .pck lacks a safe runtime match.',
    };
  }

  return {
    strategy: 'blocked',
    executablePath: null,
    args: [],
    env: {},
    downloadRequirement: null,
    reason: 'No compatible runtime strategy was found.',
  };
}

module.exports = {
  getInstalledRuntimePaths,
  resolveRuntime,
};
