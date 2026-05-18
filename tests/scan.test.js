const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scanPath } = require('../src/core/scan');

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-scan-'));
}

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

function writeMinimalPe(filePath, machine) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buffer = Buffer.alloc(512);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'ascii');
  buffer.writeUInt16LE(machine, 0x84);
  fs.writeFileSync(filePath, buffer);
}

test('detects Electron via app.asar', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'resources', 'app.asar'), 'asar');
  const result = scanPath(root);
  assert.equal(result.engine, 'electron');
  assert.match(result.launchTarget, /app\.asar$/);
});

test('detects NW.js via package.json markers', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo',
    main: 'index.html',
    window: { toolbar: false },
  }));
  const result = scanPath(root);
  assert.equal(result.engine, 'nwjs');
});

test('native engine outranks nested manual index.html', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'manual', 'index.html'), '<html>manual</html>');
  writeFile(path.join(root, 'UnityPlayer.dll'), 'dll');
  writeFile(path.join(root, 'Game.exe'), 'exe');
  const result = scanPath(root);
  assert.equal(result.engine, 'unity-windows');
  assert.match(result.launchTarget, /Game\.exe$/);
});

test('top-level index.html resolves to HTML5 when no stronger marker exists', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'index.html'), '<html></html>');
  const result = scanPath(root);
  assert.equal(result.engine, 'html5');
  assert.match(result.launchTarget, /index\.html$/);
});

test('recognizes ISO installers', () => {
  const root = makeTempDir();
  const isoPath = path.join(root, 'setup-disc.iso');
  writeFile(isoPath, 'fake');
  const result = scanPath(isoPath);
  assert.equal(result.engine, 'iso-installer');
  assert.equal(result.requiresMount, true);
});

test('recognizes Ren\'Py markers', () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, 'renpy'), { recursive: true });
  writeFile(path.join(root, 'game', 'script.rpyb'), 'compiled');
  const result = scanPath(root);
  assert.equal(result.engine, 'renpy');
  assert.equal(result.requiresRuntime, 'renpy');
});

test('prefers native Ren\'Py shell launcher when present', () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, 'renpy'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib', 'py3-mac-universal'), { recursive: true });
  writeFile(path.join(root, 'Story.sh'), '#!/bin/sh');
  const result = scanPath(root);
  assert.equal(result.engine, 'renpy');
  assert.match(result.launchTarget, /Story\.sh$/);
  assert.equal(result.requiresRuntime, null);
});

test('falls back to Ren\'Py windows executable when mac runtime is missing', () => {
  const root = makeTempDir();
  fs.mkdirSync(path.join(root, 'renpy'), { recursive: true });
  writeFile(path.join(root, 'Story.sh'), '#!/bin/sh');
  writeFile(path.join(root, 'Story.exe'), 'exe');
  const result = scanPath(root);
  assert.equal(result.engine, 'renpy');
  assert.match(result.launchTarget, /Story\.exe$/);
  assert.equal(result.requiresRuntime, null);
});

test('sets nested NW.js engine root to the actual package directory', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'wrapper', 'package.json'), JSON.stringify({
    name: 'demo',
    main: 'index.html',
    window: {},
  }));
  const result = scanPath(root);
  assert.equal(result.engine, 'nwjs');
  assert.equal(result.rootPath, path.join(root, 'wrapper'));
});

test('detects installer layouts with top-level INSTALL.EXE', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'INSTALL.EXE'), 'installer');
  writeFile(path.join(root, 'Files', 'Game.exe'), 'game');
  const result = scanPath(root);
  assert.equal(result.engine, 'installer-exe');
  assert.equal(result.installable, true);
});

test('avoids selecting utility exes when a main game exe exists', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'data.xp3'), 'archive');
  writeFile(path.join(root, 'Game.exe'), 'main');
  writeFile(path.join(root, 'FileCheckTool.exe'), 'utility');
  const result = scanPath(root);
  assert.equal(result.engine, 'kirikiri');
  assert.match(result.launchTarget, /Game\.exe$/);
});

test('preserves folder display name when dropping an exe inside a detected game folder', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'madCHook.dll'), 'dll');
  writeFile(path.join(root, 'start.exe'), 'exe');
  const result = scanPath(path.join(root, 'start.exe'));
  assert.equal(result.engine, 'kirikiri');
  assert.equal(result.displayName, path.basename(root).replace(/[_-]+/g, ' '));
});

test('recognizes Godot .pck without companion executable as blocked-runtime candidate', () => {
  const root = makeTempDir();
  writeFile(path.join(root, 'MyGame.pck'), 'pck');
  const result = scanPath(path.join(root, 'MyGame.pck'));
  assert.equal(result.engine, 'godot');
  assert.equal(result.requiresRuntime, 'godot-runtime');
});

test('detects x86 architecture for dropped PE32 executables', () => {
  const root = makeTempDir();
  const exePath = path.join(root, 'Game.exe');
  writeMinimalPe(exePath, 0x14c);
  const result = scanPath(exePath);
  assert.equal(result.binaryArchitecture, 'x86');
});
