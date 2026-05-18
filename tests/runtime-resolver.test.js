const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveRuntime } = require('../src/core/runtime-resolver');

test('routes Electron games to native Electron when installed', () => {
  const result = resolveRuntime({
    engine: 'electron',
    rootPath: '/games/demo',
    launchTarget: '/games/demo/resources/app.asar',
  }, {
    runtimes: {
      electron: '/Applications/Electron.app/Contents/MacOS/Electron',
    },
  });
  assert.equal(result.strategy, 'native-electron');
});

test('routes RPG Maker MV/MZ to NW.js when available', () => {
  const result = resolveRuntime({
    engine: 'rpgmaker-mv-mz',
    rootPath: '/games/rpg',
    launchTarget: '/games/rpg/index.html',
  }, {
    runtimes: {
      nwjs: '/Applications/nwjs.app/Contents/MacOS/nwjs',
      python: '/usr/bin/python3',
    },
  });
  assert.equal(result.strategy, 'native-nwjs');
});

test('routes HTML exports to browser fallback', () => {
  const result = resolveRuntime({
    engine: 'html5',
    rootPath: '/games/html',
    launchTarget: '/games/html/index.html',
  }, {
    runtimes: {
      python: '/usr/bin/python3',
    },
  });
  assert.equal(result.strategy, 'browser');
  assert.deepEqual(result.args, ['-m', 'http.server', '8080']);
});

test('routes Windows-native engines to Whisky', () => {
  const result = resolveRuntime({
    engine: 'kirikiri',
    rootPath: '/games/krkr',
    launchTarget: '/games/krkr/Game.exe',
  }, {
    runtimes: {
      whiskyCmd: '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
    },
  });
  assert.equal(result.strategy, 'whisky');
});

test('blocks loose Godot pck without safe runtime', () => {
  const result = resolveRuntime({
    engine: 'godot',
    rootPath: '/games/godot',
    launchTarget: '/games/godot/Game.pck',
  }, {
    runtimes: {
      whiskyCmd: '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
    },
  });
  assert.equal(result.strategy, 'blocked');
  assert.equal(result.downloadRequirement.runtime, 'godot-runtime');
});

test('routes RenPy windows fallback executable to Whisky', () => {
  const result = resolveRuntime({
    engine: 'renpy',
    rootPath: '/games/renpy',
    launchTarget: '/games/renpy/Story.exe',
    binaryArchitecture: 'x64',
  }, {
    runtimes: {
      whiskyCmd: '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
    },
  });
  assert.equal(result.strategy, 'whisky');
});

test('routes 32-bit windows binaries to CrossOver when available', () => {
  const result = resolveRuntime({
    engine: 'kirikiri',
    rootPath: '/games/krkr',
    launchTarget: '/games/krkr/Game.exe',
    binaryArchitecture: 'x86',
  }, {
    runtimes: {
      whiskyCmd: '/Applications/Whisky.app/Contents/Resources/WhiskyCmd',
      crossover: '/Applications/CrossOver.app',
    },
  });
  assert.equal(result.strategy, 'crossover');
});
