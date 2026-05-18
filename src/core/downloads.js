const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');
const { ensureDir } = require('./utils');

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        resolve(httpsGet(response.headers.location, headers));
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

function downloadToFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destination);
        resolve(downloadToFile(response.headers.location, destination));
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destination));
      });
    }).on('error', (error) => {
      file.close();
      reject(error);
    });
  });
}

function extractZip(zipPath, targetDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/ditto', ['-x', '-k', zipPath, targetDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(targetDir);
      else reject(new Error(stderr || `ditto failed with ${code}`));
    });
  });
}

function findFileRecursive(rootPath, fileName) {
  const queue = [rootPath];
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
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.name === fileName) return fullPath;
    }
  }
  return null;
}

async function fetchLatestRenPyZipUrl() {
  const page = await httpsGet('https://www.renpy.org/latest.html', { 'User-Agent': 'UniversalGameLauncher/0.1' });
  const match = page.match(/https:\/\/www\.renpy\.org\/dl\/[^"]+\/renpy-[^"]+-sdk\.zip/);
  if (!match) throw new Error('Could not locate the latest official Ren\'Py SDK zip URL.');
  return match[0];
}

async function ensureRenPyRuntime(cacheRoot) {
  const runtimeRoot = ensureDir(path.join(cacheRoot, 'renpy'));
  const existing = findFileRecursive(runtimeRoot, 'renpy.sh');
  if (existing) {
    return {
      runtimePath: existing,
      cacheRoot: runtimeRoot,
      source: 'cache',
    };
  }

  const zipUrl = await fetchLatestRenPyZipUrl();
  const zipName = path.basename(zipUrl);
  const zipPath = path.join(runtimeRoot, zipName);
  const extractPath = path.join(runtimeRoot, path.basename(zipName, '.zip'));
  ensureDir(extractPath);
  await downloadToFile(zipUrl, zipPath);
  await extractZip(zipPath, extractPath);
  const runtimePath = findFileRecursive(extractPath, 'renpy.sh');
  if (!runtimePath) throw new Error('Downloaded Ren\'Py SDK but could not locate renpy.sh.');
  return {
    runtimePath,
    cacheRoot: extractPath,
    source: zipUrl,
  };
}

module.exports = {
  ensureRenPyRuntime,
  fetchLatestRenPyZipUrl,
};
