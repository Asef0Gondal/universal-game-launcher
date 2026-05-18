const { runCommand } = require('./whisky');

function parseMountPoint(output) {
  const lines = String(output).split('\n').map((line) => line.trim()).filter(Boolean);
  const mountLine = [...lines].reverse().find((line) => /\/Volumes\//.test(line));
  if (!mountLine) return null;
  const match = mountLine.match(/(\/Volumes\/.*)$/);
  return match ? match[1] : null;
}

async function mountIso(isoPath) {
  const result = await runCommand('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', isoPath]);
  const mountPoint = parseMountPoint(result.stdout);
  if (!mountPoint) throw new Error(`Could not determine mount point for ${isoPath}`);
  return {
    mountPoint,
    rawOutput: result.stdout,
  };
}

async function detachIso(mountPoint) {
  await runCommand('/usr/bin/hdiutil', ['detach', mountPoint]);
}

function chooseInstallerCandidate(scanEntries, rootPath) {
  const weights = [
    [/^setup\.exe$/i, 100],
    [/^install\.exe$/i, 98],
    [/^installer\.exe$/i, 96],
    [/^autorun\.exe$/i, 92],
    [/\.msi$/i, 90],
    [/setup/i, 80],
    [/install/i, 76],
    [/\.exe$/i, 45],
  ];

  const candidates = scanEntries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const weight = weights.find(([pattern]) => pattern.test(entry.name));
      return {
        path: entry.fullPath,
        score: (weight ? weight[1] : 0) - (entry.depth * 4),
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0] ? candidates[0].path : rootPath;
}

module.exports = {
  chooseInstallerCandidate,
  detachIso,
  mountIso,
  parseMountPoint,
};
