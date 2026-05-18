const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 48) || 'game';
}

function createId(input) {
  return crypto.createHash('sha1').update(String(input)).digest('hex').slice(0, 12);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath);
  } catch {
    return null;
  }
}

function looksLikeInstaller(fileName) {
  return /(?:^|[._ -])(setup|install|installer|autorun|patch|update)(?:[._ -]|$)/i.test(fileName);
}

function looksLikeUninstaller(fileName) {
  return /(?:^|[._ -])(unins|uninstall|remove)(?:[._ -]|$)/i.test(fileName);
}

function looksLikeUtilityExecutable(fileName) {
  return /(?:check|config|setup|install|patch|tool|repair|launcher|crash|diagnostic|update|unins|uninstall)/i.test(fileName)
    || /チェック|設定|ツール|修復|アップデート|アンインストール/i.test(fileName);
}

function getDisplayName(targetPath) {
  const base = path.basename(targetPath, path.extname(targetPath));
  return base.replace(/[_-]+/g, ' ').trim() || path.basename(targetPath);
}

function chooseFirstExisting(candidates) {
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  chooseFirstExisting,
  createId,
  ensureDir,
  getDisplayName,
  looksLikeInstaller,
  looksLikeUtilityExecutable,
  looksLikeUninstaller,
  readJson,
  safeStat,
  slugify,
  unique,
  writeJson,
};
