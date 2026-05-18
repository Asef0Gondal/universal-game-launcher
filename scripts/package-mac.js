const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const distRoot = path.join(projectRoot, 'dist');
const appName = 'Universal Game Launcher';
const bundlePath = path.join(distRoot, `${appName}.app`);
const sourceElectronApp = '/Applications/Electron.app';
const bundleResources = path.join(bundlePath, 'Contents', 'Resources');
const embeddedAppPath = path.join(bundleResources, 'app');
const plistPath = path.join(bundlePath, 'Contents', 'Info.plist');
const binaryDir = path.join(bundlePath, 'Contents', 'MacOS');
const originalExecutable = path.join(binaryDir, 'Electron');
const renamedExecutable = path.join(binaryDir, appName);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyProjectContents(sourceDir, targetDir) {
  ensureDir(targetDir);
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.name === 'dist' || entry.name === '.git' || entry.name === '.DS_Store') continue;
    const src = path.join(sourceDir, entry.name);
    const dest = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      fs.cpSync(src, dest, { recursive: true });
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

function rewritePlist() {
  run('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', appName, plistPath]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', appName, plistPath]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleExecutable', '-string', appName, plistPath]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'com.asifgondal.universalgamelauncher', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleShortVersionString', '-string', '0.1.0', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'CFBundleVersion', '-string', '0.1.0', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'LSApplicationCategoryType', '-string', 'public.app-category.games', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'NSCameraUsageDescription', '-string', 'Universal Game Launcher can proxy game runtime camera requests.', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'NSMicrophoneUsageDescription', '-string', 'Universal Game Launcher can proxy game runtime microphone requests.', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'NSBluetoothAlwaysUsageDescription', '-string', 'Universal Game Launcher can proxy game runtime Bluetooth requests.', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'NSBluetoothPeripheralUsageDescription', '-string', 'Universal Game Launcher can proxy game runtime Bluetooth requests.', plistPath]);
  run('/usr/bin/plutil', ['-replace', 'NSAudioCaptureUsageDescription', '-string', 'Universal Game Launcher can proxy game runtime audio capture requests.', plistPath]);
  run('/usr/bin/plutil', ['-remove', 'ElectronAsarIntegrity', plistPath]);
}

function packageApp() {
  if (!fs.existsSync(sourceElectronApp)) {
    throw new Error('Electron.app is required in /Applications.');
  }

  ensureDir(distRoot);
  removeIfExists(bundlePath);
  run('/usr/bin/ditto', [sourceElectronApp, bundlePath]);
  removeIfExists(path.join(bundleResources, 'default_app.asar'));
  removeIfExists(embeddedAppPath);
  copyProjectContents(projectRoot, embeddedAppPath);

  if (fs.existsSync(originalExecutable)) {
    fs.renameSync(originalExecutable, renamedExecutable);
  }

  rewritePlist();
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundlePath]);
  console.log(`Built ${bundlePath}`);
}

packageApp();
