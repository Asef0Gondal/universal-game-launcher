# Universal Game Launcher

Universal Game Launcher is a macOS Electron helper app for opening indie games from mixed ecosystems with one drop target. It fingerprints the dropped path, picks the best launch strategy, manages per-game Whisky bottles for Windows titles, and keeps a lightweight recent games library.

## Features

- Drag and drop folders, `.exe`, `.msi`, and `.iso` files.
- Detect Electron, NW.js, TyranoScript, RPG Maker XP/VX/Ace, RPG Maker MV/MZ, Ren'Py, KiriKiri, Unity, Godot, and generic HTML5 exports.
- Prefer native mac runtimes when they are available.
- Fall back to managed Whisky bottles for Windows-native titles and installers.
- Patch newly created Whisky bottles to Japanese code page `932` to reduce mojibake issues.
- Mount `.iso` installers, pick likely installer entrypoints, and rescan the bottle after install.
- Keep a persistent profile/history list.
- Offer manual CrossOver fallback when Whisky fails.

## Requirements

- macOS Sequoia 15+
- `/Applications/Electron.app`
- `/Applications/Whisky.app`
- Optional: `/Applications/nwjs.app`
- Optional: `/Applications/CrossOver.app`

## Run

```bash
cd "/Users/asifgondal/Documents/New project 6/universal-game-launcher"
npm start
```

This uses the installed system Electron runtime and opens the app folder directly.

## Test

```bash
cd "/Users/asifgondal/Documents/New project 6/universal-game-launcher"
npm test
```

## App Structure

- `electron/`: Electron main/preload process code.
- `app/`: Renderer HTML/CSS/JS.
- `src/core/`: Detection, runtime resolution, Whisky integration, ISO handling, persistence.
- `tests/`: Node test runner coverage for scanning, runtime resolution, bottle patching, and install heuristics.

## Runtime Notes

- Browser fallback uses a temporary local Python server rooted at the detected game directory.
- Ren'Py runtime downloads come from official `renpy.org` pages and are cached under the app data directory.
- Loose Godot `.pck` files only auto-launch if a matching companion executable is detected. Otherwise the app reports a blocked state instead of guessing.

## Programmatic Interfaces

These are the internal shapes used by the app and exposed to the renderer through Electron IPC:

### `ScanResult`

```js
{
  engine: "electron" | "nwjs" | "tyranoscript" | "rpgmaker-legacy" | "rpgmaker-mv-mz" |
    "renpy" | "kirikiri" | "unity-windows" | "godot" | "html5" |
    "installer-exe" | "installer-msi" | "iso-installer" | "unknown",
  confidence: Number,
  evidence: String[],
  rootPath: String,
  launchTarget: String | null,
  installable: Boolean,
  requiresRuntime: String | null,
  requiresMount: Boolean,
  sourceType: "directory" | "file" | "iso" | "mounted-volume"
}
```

### `RuntimeResolution`

```js
{
  strategy: "native-electron" | "native-nwjs" | "whisky" | "browser" |
    "crossover-manual" | "blocked",
  executablePath: String | null,
  args: String[],
  env: Object,
  downloadRequirement: {
    runtime: String,
    source: String
  } | null,
  reason: String
}
```

### `GameProfile`

```js
{
  id: String,
  displayName: String,
  sourcePath: String,
  installedPath: String | null,
  engine: String,
  bottleName: String | null,
  launchCommand: Object | null,
  runtimeCacheRef: String | null,
  lastResult: Object | null,
  lastError: String | null,
  status: String,
  createdAt: String,
  updatedAt: String
}
```

### `InstallSession`

```js
{
  sourceType: "iso" | "exe" | "msi",
  mountedVolume: String | null,
  installerPath: String | null,
  bottleName: String,
  state: "created" | "mounted" | "running" | "finished" | "failed"
}
```
