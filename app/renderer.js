const runtimeSummary = document.getElementById('runtimeSummary');
const profilesRoot = document.getElementById('profiles');
const emptyState = document.getElementById('emptyState');
const libraryCount = document.getElementById('libraryCount');
const dropZone = document.getElementById('dropZone');
const pickButton = document.getElementById('pickButton');
const refreshButton = document.getElementById('refreshButton');
const template = document.getElementById('profileTemplate');

function summarizeProfile(profile) {
  const strategy = profile.launchCommand?.strategy || 'unknown';
  const error = profile.lastError || '';
  const evidence = profile.lastResult?.evidence?.join(' • ') || 'No evidence captured yet.';
  const launchTarget = profile.lastResult?.launchTarget || profile.installedPath || profile.sourcePath;
  return {
    strategy,
    error,
    evidence,
    launchTarget,
  };
}

function updateRuntimeSummary(profiles) {
  const strategies = new Set(profiles.map((profile) => profile.launchCommand?.strategy).filter(Boolean));
  runtimeSummary.textContent = strategies.size
    ? `Observed strategies: ${Array.from(strategies).join(', ')}`
    : 'Drop a title to inspect available launch strategies.';
}

function renderProfiles(profiles) {
  profilesRoot.textContent = '';
  libraryCount.textContent = `${profiles.length} item${profiles.length === 1 ? '' : 's'}`;
  emptyState.classList.toggle('hidden', profiles.length > 0);
  updateRuntimeSummary(profiles);

  for (const profile of profiles) {
    const node = template.content.firstElementChild.cloneNode(true);
    const summary = summarizeProfile(profile);
    node.querySelector('.profile-name').textContent = profile.displayName;
    node.querySelector('.profile-path').textContent = profile.sourcePath;
    node.querySelector('.profile-target').textContent = `Will open: ${summary.launchTarget}`;
    node.querySelector('.engine-badge').textContent = profile.engine;
    node.querySelector('.strategy-badge').textContent = summary.strategy;

    const statusBadge = node.querySelector('.status-badge');
    statusBadge.textContent = profile.status || 'ready';
    statusBadge.classList.add(profile.status || 'ready');

    node.querySelector('.profile-evidence').textContent = summary.evidence;
    node.querySelector('.profile-error').textContent = summary.error;

    const runtimeButton = node.querySelector('.runtime-button');
    const crossoverButton = node.querySelector('.crossover-button');

    runtimeButton.classList.toggle('hidden', !(profile.lastResult?.requiresRuntime));
    crossoverButton.classList.toggle('hidden', !(profile.lastError));

    node.querySelector('.launch-button').addEventListener('click', async () => {
      await window.ugl.launchProfile(profile.id);
      await refreshProfiles();
    });
    node.querySelector('.rescan-button').addEventListener('click', async () => {
      await window.ugl.rescanProfile(profile.id);
      await refreshProfiles();
    });
    node.querySelector('.reveal-button').addEventListener('click', async () => {
      await window.ugl.revealProfile(profile.id);
    });
    runtimeButton.addEventListener('click', async () => {
      await window.ugl.downloadRuntime(profile.id);
      await refreshProfiles();
    });
    crossoverButton.addEventListener('click', async () => {
      await window.ugl.tryCrossOver(profile.id);
      await refreshProfiles();
    });

    profilesRoot.appendChild(node);
  }
}

async function refreshProfiles() {
  const profiles = await window.ugl.getProfiles();
  renderProfiles(profiles);
}

async function importPaths(paths) {
  if (!paths.length) return;
  await window.ugl.importPaths(paths);
  await refreshProfiles();
}

pickButton.addEventListener('click', async () => {
  const paths = await window.ugl.choosePaths();
  await importPaths(paths);
});

refreshButton.addEventListener('click', refreshProfiles);

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
});

['dragleave', 'dragend', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    if (eventName !== 'drop') dropZone.classList.remove('dragging');
  });
});

dropZone.addEventListener('drop', async (event) => {
  dropZone.classList.remove('dragging');
  const files = Array.from(event.dataTransfer.files || []);
  const paths = files.map((file) => file.path).filter(Boolean);
  await importPaths(paths);
});

refreshProfiles().catch((error) => {
  runtimeSummary.textContent = error.message;
});

window.ugl.onProfilesUpdated((profiles) => {
  renderProfiles(profiles);
});
