const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chooseWindowsExecutable, hasMacRenPyRuntime, quickLaunch } = require('../src/core/quick-launch');

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

test('chooseWindowsExecutable prefers main game exe over helper tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-quick-'));
  writeFile(path.join(root, 'notification_helper.exe'));
  writeFile(path.join(root, 'Game.exe'));
  const chosen = chooseWindowsExecutable(root);
  assert.match(chosen, /Game\.exe$/);
});

test('hasMacRenPyRuntime detects compiled mac renpy runtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-renpy-'));
  fs.mkdirSync(path.join(root, 'lib', 'py3-mac-universal'), { recursive: true });
  assert.equal(hasMacRenPyRuntime(root), true);
});

test('quickLaunch does not bypass managed Whisky for windows exe games', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-win-'));
  writeFile(path.join(root, 'start.exe'));
  const result = await quickLaunch({
    engine: 'kirikiri',
    rootPath: root,
    launchTarget: path.join(root, 'start.exe'),
  });
  assert.equal(result, null);
});
