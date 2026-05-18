const fs = require('fs');
const path = require('path');
const { createId, ensureDir, readJson, writeJson } = require('./utils');

function createProfileStore(baseDir) {
  const storeDir = ensureDir(baseDir);
  const storeFile = path.join(storeDir, 'profiles.json');

  function loadProfiles() {
    const data = readJson(storeFile, { profiles: [] });
    return Array.isArray(data.profiles) ? data.profiles : [];
  }

  function saveProfiles(profiles) {
    writeJson(storeFile, { profiles });
  }

  function listProfiles() {
    return loadProfiles()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  function getProfile(id) {
    return loadProfiles().find((profile) => profile.id === id) || null;
  }

  function upsertProfile(nextProfile) {
    const profiles = loadProfiles();
    const now = new Date().toISOString();
    const profile = {
      id: nextProfile.id || createId(nextProfile.sourcePath || nextProfile.displayName || now),
      createdAt: nextProfile.createdAt || now,
      updatedAt: now,
      ...nextProfile,
    };
    const index = profiles.findIndex((entry) => entry.id === profile.id || entry.sourcePath === profile.sourcePath);
    if (index >= 0) profiles[index] = { ...profiles[index], ...profile, updatedAt: now };
    else profiles.push(profile);
    saveProfiles(profiles);
    return profile;
  }

  function patchProfile(id, updates) {
    const profile = getProfile(id);
    if (!profile) return null;
    return upsertProfile({ ...profile, ...updates, id });
  }

  function removeProfile(id) {
    const profiles = loadProfiles().filter((profile) => profile.id !== id);
    saveProfiles(profiles);
  }

  function writeArtifact(relativeFile, contents) {
    const artifactPath = path.join(storeDir, relativeFile);
    ensureDir(path.dirname(artifactPath));
    fs.writeFileSync(artifactPath, contents, 'utf8');
    return artifactPath;
  }

  return {
    listProfiles,
    getProfile,
    patchProfile,
    removeProfile,
    storeDir,
    upsertProfile,
    writeArtifact,
  };
}

module.exports = {
  createProfileStore,
};
