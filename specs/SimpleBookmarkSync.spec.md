# Specification — SimpleBookmarkSync

**Status:** Approved — ready for implementation  
**Author:** GitHub Copilot  
**Date:** 2026-04-14  

---

## 1. Purpose

The existing `SyncManager` is complex and unstable. This feature introduces a new, independent `SimpleBookmarkSyncManager` class alongside the old one. It covers **one direction only — tabs to bookmarks** — with a deliberately simple and predictable algorithm. The old sync is not removed; both coexist until the new one is validated.

---

## 2. Scope

### In scope
- One-way sync: live Zen tabs → Firefox bookmarks
- Tab types synced: **Essential** and **Pinned** only (normal tabs are ignored)
- All **spaces** are synced, not just the active one
- Bookmark structure mirrors space + folder hierarchy
- Order of bookmarks must match the order of tabs and folders
- URL recorded is the **pinned/essential URL** (the URL the tab was set to), not the live navigation URL
- New menu entries in the existing toolbar button ("New Sync — To Bookmarks")

### Out of scope (future iterations)
- Bookmark → tab (restore tabs from bookmarks)
- Bidirectional sync
- Duplicate URL handling beyond what Firefox bookmarks natively allow
- Conflict resolution
- Manifest / 3-way merge
- Preferences / settings UI for this class
- Auto-sync interval (manual trigger only for now)

---

## 3. New Class

| Item | Value |
|---|---|
| Class name | `SimpleBookmarkSyncManager` |
| File | `content/SimpleBookmarkSyncManager.mjs` |
| Test file | `tests/SimpleBookmarkSyncManager.test.mjs` |
| Entry point wiring | Imported and instantiated in `engine/zen.sys.mjs` alongside the existing `SyncManager` |

---

## 4. Bookmark Tree Structure

```
Bookmarks Menu (or Toolbar)
└── ZenTabs/                              ← root folder, created once, never duplicated
    └── <SpaceName>/                  ← one folder per space
        ├── Essentials - <ContainerName>/ ← one folder for all essential tabs in this space
        │   ├── <essential tab title>  →  <essential tab URL>
        │   └── ...
        ├── <pinned tab title>         →  <pinned URL>   ← pinned tab NOT in any Zen folder
        ├── <ZenFolderName>/              ← mirrors a Zen folder containing pinned tabs
        │   ├── <pinned tab title>     →  <pinned URL>
        │   └── <SubFolderName>/          ← recursive Zen sub-folder
        │       └── <pinned tab title> →  <pinned URL>
        └── ...
```

### Notes on the container name
- Each Zen space has one associated Firefox container (`containerTabId` / `userContextId`).
- The container name is retrieved via `window.ContextualIdentityService?.getPublicIdentityFromId(containerTabId)?.name`.
- If `containerTabId === 0` (default container) or the identity cannot be resolved, the folder is named **"Essentials"** (no suffix).

### Notes on the root folder placement
- The `ZenTabs` root folder is always placed in the **Bookmarks Toolbar** (`PlacesUtils.bookmarks.toolbarGuid`).
- If a `ZenTabs` folder already exists there, it is reused (matched by title, not GUID).

---

## 5. URL Selection Rule

**Pinned tabs — use the recorded/initial URL, not the live URL.**

Zen stores the "home" URL of a pinned tab in `tab._zenPinnedInitialState?.entry?.url`. This is a JavaScript property set by Zen's session restore / workspace init code (`ZenPinnedTabManager.mjs`). When a user navigates a pinned tab away from its home URL, Zen shows a "reset" indicator — the bookmark should always point to the home URL, not where the tab has wandered to.

```javascript
getPinnedUrl(tab) {
  // Zen's stored home URL for pinned tabs
  const recorded = tab._zenPinnedInitialState?.entry?.url;
  if (recorded && recorded !== "about:blank" && recorded !== "about:newtab") {
    return recorded;
  }
  // For unloaded/pending tabs, currentURI is about:blank — use SessionStore lazy state
  const lazy = window.SessionStore?.getLazyTabValue(tab, "url");
  if (lazy && lazy !== "about:blank" && lazy !== "about:newtab") {
    return lazy;
  }
  return tab.linkedBrowser?.currentURI?.spec ?? null;
}
```

**Essential tabs — no recorded URL concept.**

Zen explicitly excludes essential tabs from the pinned-URL tracking logic (see `onLocationChange` in `ZenPinnedTabManager.mjs`). Essential tabs do not have `_zenPinnedInitialState`. Use the same fallback chain:

```javascript
getEssentialUrl(tab) {
  // For unloaded/pending tabs, currentURI is about:blank
  const lazy = window.SessionStore?.getLazyTabValue(tab, "url");
  if (lazy && lazy !== "about:blank" && lazy !== "about:newtab") {
    return lazy;
  }
  return tab.linkedBrowser?.currentURI?.spec ?? null;
}
```

**Live URL is always ignored**: the sync never uses `tab.linkedBrowser.currentURI.spec` as the bookmark URL — it is only a fallback for unloaded (pending) tabs where no recorded or lazy URL is available yet.

**Skip rule**: if the resolved URL is `null`, `about:blank`, `about:newtab`, `about:privatebrowsing`, or empty, the tab is **skipped**.

---

## 6. Tab Title Rule

- Use `tab.label` or `tab.getAttribute("label")` as the bookmark title.
- If the tab has a custom name set by the user (via Zen's rename feature), that name takes precedence — it is already reflected in `tab.label`.
- If the title is empty or `undefined`, fall back to the URL hostname.

---

## 7. Tab Enumeration

```javascript
const allTabs = window.gZenWorkspaces?.allStoredTabs ?? window.gBrowser.tabs;
```

Filter:
- Skip `tab.hasAttribute("zen-empty-tab")`
- Skip `tab.hasAttribute("pending")` where the tab has never been loaded (no URL yet)
- Keep only: `tab.hasAttribute("zen-essential")` OR `tab.pinned === true`

---

## 8. Order Preservation

The sync must reproduce the **visual order** of tabs and folders.

- **Essential tabs**: sorted by `tab._tPos` (ascending) within the space.
- **Pinned tabs in space root (no Zen folder)**: sorted by `tab._tPos`.
- **Pinned tabs inside a Zen folder**: sorted by `tab._tPos`.
- **Zen folders themselves**: sorted by the lowest `tab._tPos` of any pinned tab they contain.

To enforce order in bookmarks, after writing all items the sync must verify the bookmark positions match the desired order and reorder if necessary, using `PlacesUtils.bookmarks.update({ guid, parentGuid, index })`.

---

## 9. Sync Algorithm (Idempotent Overwrite)

The algorithm is a **full idempotent overwrite** — not a diff. On every run:

1. **Read** the current `ZenTabs/` bookmark tree (if it exists).
2. **Build** the desired tree from live tabs (see §4–§8).
3. **Apply** changes:
   - Create any missing folders or bookmark entries.
   - Update the title of existing bookmarks if the tab title changed.
   - Delete bookmarks/folders that no longer correspond to a live tab.
   - Reorder entries to match tab order.

**Key design decision**: do not attempt a diff — enumerate the desired state and reconcile. This is simpler and less error-prone than the manifest-based 3-way merge.

**Matching bookmarks to tabs**: within each parent folder, match existing bookmarks to tabs by URL. If multiple bookmarks share a URL, match them in document order (first bookmark ↔ first tab with that URL).

---

## 10. Public API

```javascript
class SimpleBookmarkSyncManager {
  constructor(manager) { ... }   // manager = ZenTabsManager instance

  async init()
  // Called once during ZenTabsManager.init().
  // Performs no sync; just sets up internal state.

  async syncTabsToBookmarks()
  // Main entry point. Full idempotent overwrite sync (tabs → bookmarks).
  // Returns: { created: number, updated: number, deleted: number, errors: string[] }

  async buildDesiredTree()
  // Builds an in-memory tree of the desired bookmark state from live tabs.
  // Returns: DesiredFolder (see §11).
  // Separated for unit-testability.

  getPinnedUrl(tab)
  // Returns the pinned URL string for a tab (see §5).

  getContainerName(containerTabId)
  // Returns the container display name for a given userContextId.
  // Returns "Essentials" when containerTabId === 0 or not found.
}
```

---

## 11. Internal Data Structures

```javascript
// Tree nodes used in buildDesiredTree()

type DesiredBookmark = {
  type: "bookmark",
  title: string,
  url: string,
}

type DesiredFolder = {
  type: "folder",
  title: string,
  children: Array<DesiredFolder | DesiredBookmark>,  // ordered
}
```

---

## 12. Integration with `zen.sys.mjs`

- Import and instantiate `SimpleBookmarkSyncManager` in `ZenTabsManager.init()` after existing managers.
- Assign to `this.simpleBookmarkSyncManager`.
- Expose on `window.ZenTabsManager.simpleBookmarkSyncManager` for console access.

---

## 13. Integration with `UI.mjs`

Add two new menu items after the existing "Bidirectional Sync" separator:

```
── (separator) ──
New Sync — To Bookmarks    ← calls simpleBookmarkSyncManager.syncTabsToBookmarks()
```

Place these **before** the existing "Cleanup Old Tabs" group, under a new separator labeled clearly. 

---

## 14. Events

The class dispatches events on the `ZenTabsManager` event bus:

| Event | When |
|---|---|
| `simple-sync-started` | `syncTabsToBookmarks()` begins |
| `simple-sync-completed` | Sync finished successfully; data = `{ created, updated, deleted }` |
| `simple-sync-failed` | Sync threw an error; data = `{ error: string }` |

---

## 15. Required Tests (`tests/SimpleBookmarkSyncManager.test.mjs`)

| Test | Description |
|---|---|
| `buildDesiredTree — empty spaces` | Returns a root with no children |
| `buildDesiredTree — essential tabs only` | Essentials folder created per space |
| `buildDesiredTree — pinned tabs no folder` | Pinned tabs appear directly under space folder |
| `buildDesiredTree — pinned tabs in Zen folder` | Subfolder mirrors Zen folder |
| `buildDesiredTree — recursive Zen folders` | Nested subfolders mirrored recursively |
| `buildDesiredTree — tab order preserved` | Entries sorted by `_tPos` |
| `buildDesiredTree — skips about:blank` | Tabs with no real URL are skipped |
| `buildDesiredTree — skips normal tabs` | Non-essential, non-pinned tabs are excluded |
| `getPinnedUrl — uses _zenPinnedInitialState` | Returns recorded home URL when present |
| `getPinnedUrl — falls back to SessionStore lazy value` | Falls back to lazy URL for unloaded tabs |
| `getContainerName — default container` | Returns "Essentials" for containerTabId 0 |
| `getContainerName — named container` | Returns identity name when available |
| `syncTabsToBookmarks — returns result object` | Result has created/updated/deleted/errors keys |

---

## 16. Design Decisions (resolved)

1. **Root folder location**: `ZenTabs/` is placed in the **Bookmarks Toolbar** (`PlacesUtils.bookmarks.toolbarGuid`).

2. **Essentials folder name**: `"Essentials - <ContainerName>"` when a named container is assigned; `"Essentials"` for the default container. Confirmed correct.

3. **Sync trigger**: manual only for now. No auto-interval in this phase.

4. **Live URL**: always ignored. The bookmark always records the pinned/lazy URL. The live navigation URL is never synced.

---

*This spec is approved. Ready for implementation.*
