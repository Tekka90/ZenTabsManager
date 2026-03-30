# ZenTabs Manager — Copilot Instructions

## Project Overview

ZenTabs Manager is a **Zen Browser mod** that provides advanced tab management: bi-directional bookmark sync, automatic cleanup, memory optimization, and a toolbar UI. It is distributed via the [Sine mod loader](https://github.com/CosmoCreeper/Sine) and requires the "External marketplace" option enabled in Sine settings.

## Runtime Environment

This code runs in the **Zen Browser privileged chrome context**, NOT in a web page. Key implications:

- `window` refers to the browser's chrome window, not a web window.
- XUL/XPCOM APIs are available: `Services`, `PlacesUtils`, `gBrowser`.
- DOM elements can be XUL elements created with `document.createXULElement(...)`.
- Modules are loaded via dynamic `import()` using privileged ESM.
- There is **no bundler, no npm, no transpilation** — plain `.mjs` files loaded directly by the browser.
- `dump()` writes to the browser's stdout; `console.log()` goes to the browser console.

## Key Browser APIs Used

| API | Purpose |
|-----|---------|
| `window.gBrowser` | Access tabs, tab container, linked browsers |
| `window.gBrowser.tabs` | Live array of all open tabs |
| `window.gBrowser.tabContainer` | TabOpen / TabClose / TabAttrModified events |
| `window.PlacesUtils` | Bookmark operations (read/write/tree) |
| `window.PlacesUtils.bookmarks` | GUID-based bookmark CRUD |
| `Services.prefs.getBranch("zentabs.")` | Persistent preference storage |
| `tab.linkedBrowser` | The browser element associated with a tab |
| `tab._tPos` | Tab index position |
| `tab.hasAttribute("zen-essential")` | Zen-specific Essential tab flag |
| `tab.pinned` | Whether the tab is pinned |
| `tab.lastAccessed` | Timestamp of last access |
| `tab.group` | Zen tab group / folder info (`.level`, `.collapsed`) |
| `tab.getAttribute("zen-workspace-id")` | UUID of the Space the tab belongs to |
| `window.gZenWorkspaces` | Global Space manager (`nsZenWorkspaces` class) |

## Project Structure

```
ZenTabsManager/
├── theme.json              # Sine mod manifest (id, name, version, entry point)
├── engine/
│   ├── zen.sys.mjs         # Entry point: ZenTabsManager class, init, lifecycle
│   └── zen.api.mjs         # Public API (ZenTabsAPI) exposed on window
└── content/
    ├── TabManager.mjs      # Tab enumeration, metadata cache, filtering
    ├── SyncManager.mjs     # Bi-directional bookmark sync via PlacesUtils
    ├── CleanupManager.mjs  # Age-based cleanup and memory optimization
    └── UI.mjs              # Toolbar button (XUL), dropdown menu, keyboard shortcuts
```

> **Note:** The actual manifest is `theme.json`, not `engine.json`. Files like `sine.api.mjs`, `browser.mjs`, `install-sine-mod.sh`, and directories like `archive/` do not exist.

## Architecture

### Initialization Flow

1. Sine loads `engine/zen.sys.mjs` as the entry point (declared in `theme.json` under `scripts`).
2. A `WeakMap<window, ZenTabsManager>` (`windowManagers`) stores one `ZenTabsManager` instance **per chrome window**. When Sine calls the entry point for a window, a new instance is created and stored in the map.
3. `init(win)` loads preferences from `Services.prefs`, waits for `gBrowser` to be ready, then dynamically imports managers.
4. Managers are initialized sequentially: `TabManager` → `SyncManager` → `CleanupManager` → `UIManager`.
5. `window.ZenTabsManager` and `window.ZenTabsAPI` are set on the chrome window for console access.

### Class Responsibilities

- **`ZenTabsManager`** (`zen.sys.mjs`): Central coordinator. Owns preferences, event bus (`EventTarget`), window reference, and manager instances. Background intervals live here.
- **`TabManager`** (`content/TabManager.mjs`): Maintains an in-memory `Map<tab, metadata>` cache. Extracts type/state/workspace/folder/URL from each tab. Provides `getAllTabs()`, `getTabsFiltered(filters)`, `getStatistics()`.
- **`SyncManager`** (`content/SyncManager.mjs`): Manifest-based 3-way bookmark sync. Maintains a `syncManifest` (stored in `zentabs.syncManifest` pref) that records the last-synced URL→GUID mapping per space. Uses `getBookmarkFolderForTab()` to mirror Zen folder hierarchy under `Zen/<SpaceName>/`. Uses `PlacesUtils.promiseBookmarksTree()`.
- **`CleanupManager`** (`content/CleanupManager.mjs`): Age-based tab closure and memory optimization. Also supports **auto-unload of idle tabs** (`unloadStaleTabs()`) based on `autoUnloadDelay`. Memory reporting uses `ChromeUtils.requestProcInfo()` and `Services.sysinfo`. Respects `keepEssentialTabs` and `keepPinnedTabs` preferences.
- **`UIManager`** (`content/UI.mjs`): Creates a XUL `toolbarbutton` in `#nav-bar` with a `menupopup`. Registers keyboard shortcuts via `document.addEventListener("keydown", ...)`.
- **`ZenTabsAPI`** (`zen.api.mjs`): Thin facade over `window.ZenTabsManager`. All methods guard against uninitialized state.

### Event System

Internal events are dispatched via `ZenTabsManager.dispatchEvent(type, data)` using an `EventTarget`. Subscribe with `ZenTabsManager.on(type, callback)`.

Core events:

| Event | When fired |
|-------|------------|
| `initialized` | Manager fully ready |
| `tab-created` | A new tab was opened |
| `tab-removed` | A tab was closed |
| `tab-updated` | Tab metadata changed |
| `cleanup-completed` | Age-based cleanup run finished |
| `sync-completed` | Sync operation succeeded |
| `sync-failed` | Sync operation threw an error |
| `memory-optimized` | Memory optimization pass finished |
| `tabs-auto-unloaded` | Idle-tab unload pass finished |
| `paused` | Manager was paused |
| `resumed` | Manager was resumed |

### Zen Spaces (Workspaces)

Zen calls this feature **Spaces** in the UI, but the internal code uses the term **workspaces**. The global manager is `window.gZenWorkspaces` (class `nsZenWorkspaces`). Source: [`src/zen/spaces/ZenSpaceManager.mjs`](https://github.com/zen-browser/desktop/blob/main/src/zen/spaces/ZenSpaceManager.mjs).

**Space object shape:**
```javascript
{
  uuid: string,          // unique identifier (used as the tab attribute value)
  name: string,          // display name
  icon: string | null,   // emoji, or a URL ending in ".svg", or null/empty
  theme: object,         // gradient/theme data
  containerTabId: number // Firefox contextual identity (userContextId), 0 = default
}
```

**Key `gZenWorkspaces` API:**

| Method | Description |
|--------|-------------|
| `gZenWorkspaces.getWorkspaces()` | Array of all space objects |
| `gZenWorkspaces.activeWorkspace` | Getter/setter for the active space UUID (string) |
| `gZenWorkspaces.getActiveWorkspaceFromCache()` | Returns the active space object |
| `gZenWorkspaces.getWorkspaceFromId(uuid)` | Look up a space by UUID |
| `gZenWorkspaces.isWorkspaceActive(workspace)` | Boolean: is this the current space? |
| `gZenWorkspaces.workspaceHasIcon(workspace)` | Boolean: does the space have an icon? |
| `gZenWorkspaces.getWorkspaceIcon(workspace)` | Icon string, or first letter of name as fallback |
| `gZenWorkspaces.saveWorkspace(workspaceData)` | Persist changes to a space object |
| `gZenWorkspaces.createAndSaveWorkspace(name, icon, dontChange, containerTabId)` | Create a new space |
| `gZenWorkspaces.removeWorkspace(uuid)` | Delete a space and its tabs |
| `gZenWorkspaces.changeWorkspaceWithID(uuid)` | Switch to a different space |

**Important**: DO NOT use `getWorkspaceById()` — it does not exist. The correct method is `getWorkspaceFromId(uuid)`.

**Critical — `gBrowser.tabs` only returns the active Space's tabs**: Zen physically moves tabs into per-space `<zen-workspace>` DOM containers inside `#tabbrowser-arrowscrollbox`. As a result, `gBrowser.tabs` only returns tabs from the currently active Space. To get tabs across **all** Spaces, always use `gZenWorkspaces.allStoredTabs` (falls back gracefully to `gBrowser.tabs` before Zen initializes). Example:
```javascript
const tabs = window.gZenWorkspaces?.allStoredTabs ?? gBrowser.tabs;
```

**Per-space bookmarks**: `window.ZenWorkspaceBookmarksStorage` manages a SQLite table `zen_bookmarks_workspaces(bookmark_guid, workspace_uuid)` that associates bookmarks with specific spaces. Use `getBookmarkWorkspaces(guid)` and `getBookmarkGuidsByWorkspace()` to query it.

### Sync Strategy (Manifest-based 3-way merge)

`SyncManager` does not do a simple push or pull. It performs a **3-way merge** using a persistent manifest:

- **Manifest** (`zentabs.syncManifest` pref): A JSON map of `spaceUuid → { url → bookmarkGuid }` recording the last-synced state.
- On each sync, the manifest is compared against the current bookmark tree (T = truth in bookmarks) and the live tabs (B = browser state) to decide what to add, remove, or leave alone.
- `loadManifest()` / `saveManifest()` read and write this JSON string from/to prefs.

### Bookmark Folder Structure

Bookmarks are organized under a **`Zen/`** root folder, then by space name, then mirroring the tab's Zen folder hierarchy:

```
Zen/
└── <SpaceName>/
    ├── <direct bookmark>      ← pinned tab with no Zen folder
    ├── <FolderName>/          ← pinned tab WITH a Zen folder (folder IS the Zen folder)
    ├── Essentials/            ← essential tabs with no Zen folder
    └── Temporary tabs/        ← normal tabs with no Zen folder
```

Type is fully recoverable on restore:
- Direct bookmark in space root → `pinned`, no Zen folder
- Named subfolder (not `Essentials` / `Temporary tabs`) → `pinned`, Zen folder = folder name
- `Essentials/` subfolder → `essential`
- `Temporary tabs/` subfolder → `normal`

`getBookmarkFolderForTab(spaceFolderGuid, tabData)` resolves or creates the correct subfolder for any given tab.

### Tab Classification

| Type | Detection |
|------|-----------|
| `essential` | `tab.hasAttribute("zen-essential")` |
| `pinned` | `tab.pinned === true` |
| `normal` | Everything else |

### Preferences

Stored under `Services.prefs.getBranch("zentabs.")` as a JSON string in `"preferences"` key. Defaults are defined inline in `loadPreferences()`.

| Preference | Default | Description |
|---|---|---|
| `enabled` | `true` | Master on/off switch |
| `syncEnabled` | `true` | Enable bookmark sync |
| `syncDirection` | `"bidirectional"` | `"toBookmarks"`, `"fromBookmarks"`, or `"bidirectional"` |
| `syncInterval` | `300` | Seconds between automatic sync runs |
| `syncCloseRemovedTabs` | `false` | Close tabs that were removed from bookmarks during sync |
| `paused` | `false` | Whether the manager is currently paused |
| `cleanupEnabled` | `false` | Enable age-based tab cleanup |
| `cleanupAge` | `7` | Age threshold for cleanup (in `cleanupAgeUnit` units) |
| `cleanupAgeUnit` | `"days"` | Unit for `cleanupAge`: `"hours"` or `"days"` |
| `cleanupExcludeDomains` | `""` | Comma-separated domains to exclude from cleanup |
| `memoryOptimization` | `true` | Enable memory-based tab unloading |
| `memoryThreshold` | `80` | Memory usage % at which optimization triggers |
| `autoUnloadEnabled` | `false` | Enable time-based idle tab unloading |
| `autoUnloadDelay` | `3600` | Seconds of inactivity before a tab is unloaded |
| `keepEssentialTabs` | `true` | Never close/unload essential tabs |
| `keepPinnedTabs` | `true` | Never close/unload pinned tabs |
| `showToolbarButton` | `true` | Show the toolbar button in `#nav-bar` |
| `debugMode` | `false` | Verbose logging to browser console |

## Coding Conventions

- All source files are ES modules (`.mjs`) using `export class` / `export const`.
- Dynamic `import()` is used for lazy-loading content modules from `engine/`.
- Logging via `this.log(...args)` which prefixes `[ZenTabs]` using `console.log`.
- Error handling: `try/catch` with `console.error(...)` — never crash the browser.
- No external dependencies, no build step, no TypeScript.

## Public API (console access)

```javascript
ZenTabsAPI.getVersion()                          // "1.0.0"
await ZenTabsAPI.listAllTabs()                   // full tab metadata array
await ZenTabsAPI.getTabsFiltered({ olderThan: 7, type: 'normal' })
await ZenTabsAPI.syncToBookmarks()
await ZenTabsAPI.syncFromBookmarks()
await ZenTabsAPI.syncBidirectional()
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: true })
await ZenTabsAPI.optimizeMemory({ force: true })
await ZenTabsAPI.getStatistics()
await ZenTabsAPI.exportToJSON()
ZenTabsAPI.getPreferences()
await ZenTabsAPI.setPreferences({ cleanupAge: 14 })
ZenTabsAPI.on('cleanup-completed', (data) => console.log(data))
ZenTabsAPI.pause()
ZenTabsAPI.resume()
ZenTabsAPI.isPaused()
```

## Manifest (`theme.json`)

```json
{
  "id": "zentabs-manager",
  "name": "ZenTabs Manager",
  "version": "1.0.0",
  "scripts": {
    "engine/zen.sys.mjs": {}
  }
}
```

The entry point must be listed under `scripts`. Sine injects it into the browser chrome at startup.

## Zen Browser Source Reference

When researching internal Zen Browser APIs, components, or behavior, refer to the official source repository:

- **Zen Browser desktop**: https://github.com/zen-browser/desktop
- Zen-specific components live under `src/browser/base/content/zen-components/` in the repo (e.g., `ZenPinnedTabManager.mjs`, `ZenFolders.mjs`, `ZenGlanceManager.mjs`).
- Firefox/Gecko APIs used by Zen (e.g., `PlacesUtils`, `Services`, `gBrowser`) are documented at https://searchfox.org/mozilla-central/source

## Development Notes

- Open the browser console with `Cmd+Shift+J` to test API calls.
- Verify load: `ZenTabsAPI.getVersion()` should return `"1.0.0"`.
- Debug mode: `await ZenTabsAPI.setPreferences({ debugMode: true })` for verbose logging.
- There is no hot-reload — changes require restarting Zen Browser or reinstalling the mod.
- The mod targets Zen Browser's internal structure; APIs like `tab.group`, `zen-essential`, and workspace attributes are Zen-specific and not present in standard Firefox.

## Testing Requirements

**Every code change must be accompanied by unit tests.** This is a hard rule.

### Test stack
- Framework: Node.js built-in `node:test` + `node:assert/strict`
- Run: `npm test` (or `node --test tests/*.test.mjs`)
- Coverage: `node --test --experimental-test-coverage tests/*.test.mjs`
- Mock helpers live in `tests/helpers/mocks.mjs` — extend them when new browser APIs are needed

### Rules
1. **New method added** → add at least one happy-path and one edge-case test.
2. **Bug fixed** → add a regression test that would have caught the bug.
3. **New preference added** → test both the default value behaviour and the non-default value behaviour.
4. **Tests must pass before considering a task done** — run `npm test` after every change.
5. **Do not use browser globals in tests** — use the stubs in `tests/helpers/mocks.mjs`. Add new stubs there rather than patching `globalThis` ad-hoc inside individual tests (except for `globalThis.Services` which mocks.mjs already sets).
6. **Documentation updated** → when adding or changing any feature, update all .md files to reflect: new preferences (add to the Preferences table), new API methods (add to the Public API section), architectural changes (update the Architecture section), new events (add to the Event System table).
7. **`theme.json` `updatedAt` bumped** → after every change session, update the `updatedAt` field in `theme.json` to the current UTC datetime (`YYYY-MM-DDTHH:MM:SS`). Sine uses this timestamp to detect that the mod has changed and prompt the user to reload.

### File mapping
| Source file | Test file |
|---|---|
| `content/SyncManager.mjs` | `tests/SyncManager.test.mjs` |
| `content/TabManager.mjs` | `tests/TabManager.test.mjs` |
| `content/CleanupManager.mjs` | `tests/CleanupManager.test.mjs` |
| `content/UI.mjs` | UI is XUL-only — no unit tests; verify manually in browser |
| `engine/zen.sys.mjs` | Lifecycle/init — no unit tests; verified via integration |
