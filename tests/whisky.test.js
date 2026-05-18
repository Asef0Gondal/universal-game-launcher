const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  registryFilesExist,
  parseShellEnv,
  patchJapaneseLocale,
} = require('../src/core/whisky');

test('parses Whisky shellenv exports', () => {
  const parsed = parseShellEnv([
    'export PATH="/tmp/wine/bin:$PATH"',
    'export WINEPREFIX="/tmp/bottle"',
    'alias wine="wine64"',
  ].join('\n'));

  assert.equal(parsed.env.WINEPREFIX, '/tmp/bottle');
  assert.equal(parsed.aliases.wine, 'wine64');
});

test('expands PATH exports from Whisky shellenv', () => {
  const parsed = parseShellEnv('export PATH="/tmp/wine/bin:$PATH"');
  assert.match(parsed.env.PATH, /^\/tmp\/wine\/bin:/);
  assert.ok(!parsed.env.PATH.includes('$PATH'));
});

test('patchJapaneseLocale rewrites code page 932 and locale keys', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-bottle-'));
  const systemReg = path.join(root, 'system.reg');
  const userReg = path.join(root, 'user.reg');

  fs.writeFileSync(systemReg, [
    'REGEDIT4',
    '',
    '[System\\CurrentControlSet\\Control\\Nls\\CodePage] 1775500205',
    '"ACP"="1252"',
    '"OEMCP"="437"',
    '',
    '[System\\CurrentControlSet\\Control\\Nls\\Language] 1775500205',
    '"Default"="0409"',
    '"InstallLanguage"="0409"',
    '',
    '[System\\CurrentControlSet\\Control\\Nls\\Locale] 1775500205',
    '@="00000409"',
    '',
  ].join('\n'));
  fs.writeFileSync(userReg, [
    'REGEDIT4',
    '',
    '[Control Panel\\International] 1775500205',
    '"Locale"="00000409"',
    '"LocaleName"="en-US"',
    '"sLanguage"="ENU"',
    '"sCountry"="United States"',
    '',
    '[Control Panel\\International\\Geo] 1775500205',
    '"Name"="US"',
    '"Nation"="244"',
    '',
    '[Software\\Wine\\Fonts] 1775500205',
    '"Codepages"="1252,437"',
    '',
  ].join('\n'));

  patchJapaneseLocale(root);

  const nextSystem = fs.readFileSync(systemReg, 'utf8');
  const nextUser = fs.readFileSync(userReg, 'utf8');

  assert.match(nextSystem, /"ACP"="932"/);
  assert.match(nextSystem, /"OEMCP"="932"/);
  assert.match(nextSystem, /"Default"="0411"/);
  assert.match(nextSystem, /"InstallLanguage"="0411"/);
  assert.match(nextSystem, /@="00000411"/);
  assert.match(nextUser, /"Locale"="00000411"/);
  assert.match(nextUser, /"LocaleName"="ja-JP"/);
  assert.match(nextUser, /"sLanguage"="JPN"/);
  assert.match(nextUser, /"sCountry"="Japan"/);
  assert.match(nextUser, /"Name"="JP"/);
  assert.match(nextUser, /"Nation"="122"/);
  assert.match(nextUser, /"Codepages"="932,932"/);
});

test('registryFilesExist detects partially initialized bottles', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ugl-bottle-state-'));
  assert.equal(registryFilesExist(root), false);
  fs.writeFileSync(path.join(root, 'system.reg'), '');
  fs.writeFileSync(path.join(root, 'user.reg'), '');
  assert.equal(registryFilesExist(root), true);
});
