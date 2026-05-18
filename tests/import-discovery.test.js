const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { discoverImportTargets } = require('../src/core/import-discovery');

function writeFile(filePath, contents = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

test('expands collection folders into multiple import targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-import-'));
  writeFile(path.join(root, 'Game A', 'package.json'), JSON.stringify({
    name: 'a',
    main: 'index.html',
    window: {},
  }));
  fs.mkdirSync(path.join(root, 'Game B', 'renpy'), { recursive: true });
  writeFile(path.join(root, 'Game B', 'Game B.sh'), '#!/bin/sh');
  writeFile(path.join(root, 'notes.txt'), 'ignore');

  const targets = discoverImportTargets(root);
  assert.equal(targets.length, 2);
  assert.ok(targets.some((entry) => entry.endsWith(path.join('Game A'))));
  assert.ok(targets.some((entry) => entry.endsWith(path.join('Game B'))));
});

test('finds nested ISO files inside wrapper directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-import-iso-'));
  writeFile(path.join(root, 'Wrapper', 'DISC.ISO'), 'fake iso');
  const targets = discoverImportTargets(root);
  assert.equal(targets.length, 1);
  assert.ok(targets[0].endsWith(path.join('Wrapper', 'DISC.ISO')));
});
