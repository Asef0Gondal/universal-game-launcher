const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseInstallerCandidate, parseMountPoint } = require('../src/core/iso');

test('parses hdiutil mount output', () => {
  const mountPoint = parseMountPoint([
    '/dev/disk4           GUID_partition_scheme',
    '/dev/disk4s1         Apple_HFS                       /Volumes/My Installer',
  ].join('\n'));
  assert.equal(mountPoint, '/Volumes/My Installer');
});

test('prefers setup executables when choosing installer candidate', () => {
  const installer = chooseInstallerCandidate([
    { fullPath: '/Volumes/Game/manual/readme.txt', name: 'readme.txt', isDirectory: false, depth: 2 },
    { fullPath: '/Volumes/Game/setup.exe', name: 'setup.exe', isDirectory: false, depth: 1 },
    { fullPath: '/Volumes/Game/bin/game.exe', name: 'game.exe', isDirectory: false, depth: 2 },
  ], '/Volumes/Game');
  assert.equal(installer, '/Volumes/Game/setup.exe');
});
