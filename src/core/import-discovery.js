const fs = require('fs');
const path = require('path');
const { safeStat } = require('./utils');
const { scanPath } = require('./scan');

const SKIP_NAMES = new Set([
  '.ds_store',
]);

const SKIP_EXTENSIONS = new Set([
  '.txt',
  '.url',
  '.md',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
]);

function listImmediateChildren(dirPath) {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true })
      .filter((entry) => !SKIP_NAMES.has(entry.name.toLowerCase()))
      .map((entry) => ({
        name: entry.name,
        fullPath: path.join(dirPath, entry.name),
        isDirectory: entry.isDirectory(),
      }));
  } catch {
    return [];
  }
}

function maybeNestedGameDir(dirPath) {
  const children = listImmediateChildren(dirPath)
    .filter((entry) => entry.isDirectory);
  if (children.length !== 1) return null;
  return children[0].fullPath;
}

function nestedImportableChildren(dirPath) {
  const results = [];
  for (const child of listImmediateChildren(dirPath)) {
    const ext = path.extname(child.name).toLowerCase();
    if (!child.isDirectory && SKIP_EXTENSIONS.has(ext)) continue;
    try {
      const scan = scanPath(child.fullPath);
      if (isPotentiallyImportable(scan)) {
        results.push(child.fullPath);
      }
    } catch {
      // Ignore nested import scan failures.
    }
  }
  return results;
}

function isPotentiallyImportable(scan) {
  return scan.engine !== 'unknown' || scan.installable || scan.requiresMount || scan.requiresRuntime;
}

function discoverImportTargets(inputPath) {
  const stat = safeStat(inputPath);
  if (!stat) return [];
  if (!stat.isDirectory()) return [path.resolve(inputPath)];

  const directScan = scanPath(inputPath);
  const children = listImmediateChildren(inputPath);
  const childCandidates = [];

  for (const child of children) {
    const ext = path.extname(child.name).toLowerCase();
    if (!child.isDirectory && SKIP_EXTENSIONS.has(ext)) continue;
    const childPath = child.fullPath;

    try {
      const childScan = scanPath(childPath);
      if (isPotentiallyImportable(childScan)) {
        childCandidates.push(childPath);
        continue;
      }
    } catch {
      // Ignore per-child scan failure.
    }

    if (child.isDirectory) {
      const nested = maybeNestedGameDir(childPath);
      if (nested) {
        try {
          const nestedScan = scanPath(nested);
          if (isPotentiallyImportable(nestedScan)) {
            childCandidates.push(nested);
            continue;
          }
        } catch {
          // Ignore nested scan failure.
        }
      }

      childCandidates.push(...nestedImportableChildren(childPath));
    }
  }

  const uniqueCandidates = [...new Set(childCandidates.map((candidate) => path.resolve(candidate)))];

  if (uniqueCandidates.length >= 2) {
    return uniqueCandidates;
  }

  if (isPotentiallyImportable(directScan)) {
    return [path.resolve(inputPath)];
  }

  return uniqueCandidates;
}

module.exports = {
  discoverImportTargets,
};
