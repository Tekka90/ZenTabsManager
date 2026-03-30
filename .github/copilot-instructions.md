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

> **Note:** The README references files like `sine.api.mjs`, `browser.mjs`, `install-sine-mod.sh`, and directories like `archive/` that do not currently exist. The actual manifest is `theme.json`, not `engine.json`.

## Architecture

### Initialization Flow

1. Sine loads `engine/zen.sys.mjs` as the entry point (declared in `theme.json` under `scripts`).
2. `ZenTabsManager` class is instantiated and `init(win)` is called with the chrome window.
3. `init()` loads preferences from `Services.prefs`, waits for `gBrowser` to be ready, then dynamically imports managers.
4. Managers are initialized sequentially: `TabManager` → `SyncManager` → `CleanupManager` → `UIManager`.
5. `ZenTabsManager` and `ZenTabsAPI` are exposed on `window` for console access.

### Class Responsibilities

- **`ZenTabsManager`** (`zen.sys.mjs`): Central coordinator. Owns preferences, event bus (`EventTarget`), window reference, and manager instances. Background intervals live here.
- **`TabManager`** (`content/TabManager.mjs`): Maintains an in-memory `Map<tab, metadata>` cache. Extracts type/state/workspace/folder/URL from each tab. Provides `getAllTabs()`, `getTabsFiltered(filters)`, `getStatistics()`.
- **`SyncManager`** (`content/SyncManager.mjs`): Maps URLs to bookmark GUIDs. Syncs to/from a "Zen" folder on the bookmarks toolbar. Uses `PlacesUtils.promiseBookmarksTree()`.
- **`CleanupManager`** (`content/CleanupManager.mjs`): Age-based tab closure and memory unloading (LRU). Respects `keepEssentialTabs` and `keepPinnedTabs` preferences.
- **`UIManager`** (`content/UI.mjs`): Creates a XUL `toolbarbutton` in `#nav-bar` with a `menupopup`. Registers keyboard shortcuts via `document.addEventListener("keydown", ...)`.
- **`ZenTabsAPI`** (`zen.api.mjs`): Thin facade over `window.ZenTabsManager`. All methods guard against uninitialized state.

### Event System

Internal events are dispatched via `ZenTabsManager.dispatchEvent(type, data)` using an `EventTarget`. Subscribe with `ZenTabsManager.on(type, callback)`.

Core events: `initialized`, `tab-created`, `tab-removed`, `tab-updated`, `cleanup-completed`.

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

**Per-space bookmarks**: `window.ZenWorkspaceBookmarksStorage` manages a SQLite table `zen_bookmarks_workspaces(bookmark_guid, workspace_uuid)` that associates bookmarks with specific spaces. Use `getBookmarkWorkspaces(guid)` and `getBookmarkGuidsByWorkspace()` to query it.

### Tab Classification

| Type | Detection |
|------|-----------|
| `essential` | `tab.hasAttribute("zen-essential")` |
| `pinned` | `tab.pinned === true` |
| `normal` | Everything else |

### Preferences

Stored under `Services.prefs.getBranch("zentabs.")` as a JSON string in `"preferences"` key. Defaults are defined inline in `loadPreferences()`. Key preferences: `enabled`, `syncEnabled`, `syncDirection`, `syncInterval`, `cleanupEnabled`, `cleanupAge`, `cleanupExcludeDomains`, `memoryOptimization`, `memoryThreshold`, `keepEssentialTabs`, `keepPinnedTabs`, `showToolbarButton`, `debugMode`.

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
await ZenTabsAPI.syncFromBookmarks(folderPath)
await ZenTabsAPI.syncBidirectional()
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: true })
await ZenTabsAPI.optimizeMemory({ force: true })
await ZenTabsAPI.getStatistics()
await ZenTabsAPI.exportToJSON()
ZenTabsAPI.getPreferences()
await ZenTabsAPI.setPreferences({ cleanupAge: 14 })
ZenTabsAPI.on('cleanup-completed', (data) => console.log(data))
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
