# ZenTabs Manager — Copilot Instructions

> **Workflow rules** (spec-first, review before implement, etc.) are defined in `.github/agent.md`. Read it before starting any task.

## Project Overview

ZenTabs Manager is a **Zen Browser mod** that provides advanced tab management: bookmark sync, automatic cleanup, memory optimization, and a toolbar UI. It is distributed via the [Sine mod loader](https://github.com/CosmoCreeper/Sine) and requires the "External marketplace" option enabled in Sine settings.

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
    ├── SimpleBookmarkSyncManager.mjs  # Idempotent bookmark sync (tabs↔bookmarks)
    ├── CleanupManager.mjs  # Age-based cleanup and memory optimization
  ├── TabPublishManager.mjs  # JSON + dashboard generation and SFTP publish
    └── UI.mjs              # Toolbar button (XUL), dropdown menu, keyboard shortcuts
```

> **Note:** The actual manifest is `theme.json`, not `engine.json`. Files like `sine.api.mjs`, `browser.mjs`, `install-sine-mod.sh`, and directories like `archive/` do not exist.

## Architecture

### Initialization Flow

1. Sine loads `engine/zen.sys.mjs` as the entry point (declared in `theme.json` under `scripts`).
2. A `WeakMap<window, ZenTabsManager>` (`windowManagers`) stores one `ZenTabsManager` instance **per chrome window**. When Sine calls the entry point for a window, a new instance is created and stored in the map.
3. `init(win)` loads preferences from `Services.prefs`, waits for `gBrowser` to be ready, then dynamically imports managers.
4. Managers are initialized sequentially: `TabManager` → `SimpleBookmarkSyncManager` → `CleanupManager` → `TabPublishManager` → `UIManager`.
5. `window.ZenTabsManager` and `window.ZenTabsAPI` are set on the chrome window for console access.

### Class Responsibilities

- **`ZenTabsManager`** (`zen.sys.mjs`): Central coordinator. Owns preferences, event bus (`EventTarget`), window reference, and manager instances. Background intervals live here.
- **`TabManager`** (`content/TabManager.mjs`): Maintains an in-memory `Map<tab, metadata>` cache. Extracts type/state/workspace/folder/URL from each tab. Provides `getAllTabs()`, `getTabsFiltered(filters)`, `getStatistics()`.
- **`SimpleBookmarkSyncManager`** (`content/SimpleBookmarkSyncManager.mjs`): Idempotent overwrite-based bookmark sync. Stores bookmarks under `ZenTabs/<SpaceName>/` with optional space metadata annotations. Supports `syncTabsToBookmarks()` (tabs → bookmarks) and `syncBookmarksToTabs()` (bookmarks → tabs, with optional dry-run). Uses pool-based matching. No manifest required.
- **`CleanupManager`** (`content/CleanupManager.mjs`): Age-based tab closure and memory optimization. Also supports **auto-unload of idle tabs** (`unloadStaleTabs()`) based on `autoUnloadDelay`. Memory reporting uses `ChromeUtils.requestProcInfo()` and `Services.sysinfo`. Respects `keepEssentialTabs` and `keepPinnedTabs` preferences.
- **`TabPublishManager`** (`content/TabPublishManager.mjs`): Builds `tabs.json` and a static `index.html` dashboard, writes them to profile temp, and uploads both files to an SFTP destination using the system `sftp` CLI.
- **`UIManager`** (`content/UI.mjs`): Creates a XUL `toolbarbutton` in `#nav-bar` with a `menupopup`. Registers keyboard shortcuts via `document.addEventListener("keydown", ...)`.
- **`ResultFormatter`** (`content/ResultFormatter.mjs`): Builds normalized, UI-friendly view models for action result dialogs (tab list, sync summaries, restore dry-run plan, cleanup/memory summaries, statistics, and errors).
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
| `simple-sync-started` | Tabs-to-bookmarks sync began |
| `simple-sync-completed` | Tabs-to-bookmarks sync succeeded |
| `simple-sync-failed` | Tabs-to-bookmarks sync threw an error |
| `memory-optimized` | Memory optimization pass finished |
| `tabs-auto-unloaded` | Idle-tab unload pass finished |
| `paused` | Manager was paused |
| `resumed` | Manager was resumed |
| `simple-restore-started` | `syncBookmarksToTabs` call began |
| `simple-restore-completed` | Restore succeeded (live run) |
| `simple-restore-dry-run-completed` | Dry-run planning pass finished |
| `simple-restore-failed` | Restore threw an error |

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

**Critical — `space.uuid` is NOT a stable identity across profiles or browsers**: The UUID is generated locally and will differ if the user installs Zen on another machine, migrates their profile, or starts fresh. Never store a space UUID in bookmarks, exported data, or any artefact that must survive cross-profile use. Use the **space name** as the user-visible stable key, and pair it with rename detection (content similarity) when names change.

**Critical — `gBrowser.tabs` only returns the active Space's tabs**: Zen physically moves tabs into per-space `<zen-workspace>` DOM containers inside `#tabbrowser-arrowscrollbox`. As a result, `gBrowser.tabs` only returns tabs from the currently active Space. To get tabs across **all** Spaces, always use `gZenWorkspaces.allStoredTabs` (falls back gracefully to `gBrowser.tabs` before Zen initializes). Example:
```javascript
const tabs = window.gZenWorkspaces?.allStoredTabs ?? gBrowser.tabs;
```

**Per-space bookmarks**: `window.ZenWorkspaceBookmarksStorage` manages a SQLite table `zen_bookmarks_workspaces(bookmark_guid, workspace_uuid)` that associates bookmarks with specific spaces. Use `getBookmarkWorkspaces(guid)` and `getBookmarkGuidsByWorkspace()` to query it.

### Sync Strategy (Idempotent overwrite)

`SimpleBookmarkSyncManager` performs a full idempotent overwrite sync — no manifest or 3-way merge needed:

- **Tabs → Bookmarks** (`syncTabsToBookmarks()`): Reads all live tabs, groups by space, and writes the complete bookmark tree under `ZenTabs/<SpaceName>/`. Existing bookmarks are matched by URL and updated; extras are deleted; missing ones are created.
- **Bookmarks → Tabs** (`syncBookmarksToTabs(options)`): Reads the `ZenTabs/` bookmark tree and opens missing tabs, optionally closing tabs not represented in bookmarks. Supports `{ dryRun: true }` to preview changes without mutating.
- Space metadata (icon, theme) is stored as a JSON annotation bookmark (`__meta__`) inside each space folder.

### Bookmark Folder Structure

Bookmarks are organized under a **`ZenTabs/`** root folder, then by space name, then mirroring the tab's Zen folder hierarchy:

```
ZenTabs/
└── <SpaceName>/
    ├── __meta__               ← JSON annotation with space icon/theme
    ├── <direct bookmark>      ← pinned tab with no Zen folder
    ├── <FolderName>/          ← pinned tab WITH a Zen folder
    ├── Essentials/            ← essential tabs
    └── Temporary tabs/        ← normal tabs
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
| `publishSftpHost` | `""` | SFTP host used for dashboard upload |
| `publishSftpPort` | `22` | SFTP port |
| `publishSftpUser` | `""` | SFTP username |
| `publishSftpRemoteDir` | `""` | Remote directory where `tabs.json` and `index.html` are uploaded |
| `publishSftpPrivateKeyPath` | `""` | Optional SSH private key path for SFTP authentication |
| `publishSftpDashboardTitle` | `"ZenTabs Dashboard"` | Page title used in generated dashboard HTML |

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
await ZenTabsAPI.syncToBookmarks({ dryRun: true })
await ZenTabsAPI.syncFromBookmarks()
await ZenTabsAPI.syncFromBookmarks({ dryRun: true })
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: true })
await ZenTabsAPI.optimizeMemory({ force: true })
await ZenTabsAPI.getStatistics()
await ZenTabsAPI.exportToJSON()
await ZenTabsAPI.publishTabsToSftp()
ZenTabsAPI.getPreferences()
await ZenTabsAPI.setPreferences({ cleanupAge: 14 })
ZenTabsAPI.on('cleanup-completed', (data) => console.log(data))
ZenTabsAPI.pause()
ZenTabsAPI.resume()
ZenTabsAPI.isPaused()
```

### SimpleBookmarkSyncManager API (direct access)

```javascript
await ZenTabsManager.simpleBookmarkSyncManager.syncTabsToBookmarks()
await ZenTabsManager.simpleBookmarkSyncManager.syncBookmarksToTabs()            // restore bookmarks → tabs (live)
await ZenTabsManager.simpleBookmarkSyncManager.syncBookmarksToTabs({ dryRun: true }) // preview without mutations
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

## Specifications

All approved feature specs live in the `specs/` directory. Consult the relevant spec before working on any feature listed here.

| Spec file | Feature | Status |
|---|---|---|
| `specs/SimpleBookmarkSync.spec.md` | Idempotent tab-to-bookmark sync (`SimpleBookmarkSyncManager`) | Implemented |
| `specs/SpaceMetadataSync.spec.md` | Space icon/theme metadata in bookmarks + rename detection | Implemented — 2026-04-14 |
| `specs/BookmarksToTabsSync.spec.md` | Reverse sync: bookmarks → tabs with dry-run mode | Implemented — 2026-04-14 |
| `specs/ActionResultsWindow.spec.md` | Compact action results dialog for list/sync/restore/dry-run/cleanup/memory/statistics | Implemented — 2026-06-24 |
| `specs/SyncToBookmarksDryRun.spec.md` | Replace List All Tabs with Sync to Bookmarks dry-run preview | Implemented — 2026-06-24 |
| `specs/SftpTabPublish.spec.md` | Export tabs to JSON + static dashboard and upload to SFTP | Implemented — 2026-06-24 |
| `specs/KagiDashboardIntegrations.spec.md` | Dashboard Kagi Research/Assistant launchers + Kagi News highlights | Implemented — 2026-06-25 |

---

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
| `content/SimpleBookmarkSyncManager.mjs` | `tests/SimpleBookmarkSyncManager.test.mjs` |
| `content/TabManager.mjs` | `tests/TabManager.test.mjs` |
| `content/CleanupManager.mjs` | `tests/CleanupManager.test.mjs` |
| `content/TabPublishManager.mjs` | `tests/TabPublishManager.test.mjs` |
| `content/UI.mjs` | UI is XUL-only — no unit tests; verify manually in browser |
| `content/ResultFormatter.mjs` | `tests/ResultFormatter.test.mjs` |
| `engine/zen.sys.mjs` | Lifecycle/init — no unit tests; verified via integration |
