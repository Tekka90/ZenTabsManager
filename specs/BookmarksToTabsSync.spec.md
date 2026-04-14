# Specification — Bookmarks → Tabs Restore Sync

**Status:** Implemented — 2026-04-14  
**Author:** GitHub Copilot  
**Date:** 2026-04-14  

---

## 1. Purpose

Add the reverse direction to `SimpleBookmarkSyncManager`: read the `ZenTabs/` bookmark folder and **replicate its state into live Zen tabs**. Bookmarks are the source of truth — anything that differs in tabs is overwritten.

---

## 2. Scope

### In scope
- Read `ZenTabs/` from the Bookmarks Toolbar and restore its full structure as live tabs
- Create missing Firefox containers (by name) when an "Essentials - ContainerName" folder is encountered
- Create missing Zen Spaces (by name) if a space folder in bookmarks has no matching live space
- Restore space icon and theme from the `__spaces__` metadata folder (using existing `readSpaceMetadata()`)
- Create missing Essential and Pinned tabs as **unloaded (lazy)** tabs
- Create missing Zen tab folders (groups) for pinned tabs nested inside named subfolders
- Delete Essential and Pinned tabs that exist in Zen but have no matching bookmark entry
- Normal tabs: **untouched** (never created or deleted by this sync)
- Enforce order of Essential and Pinned tabs within each space to match bookmark order
- New menu item: **"New Sync — From Bookmarks"**

### Out of scope
- Auto-sync interval (manual trigger only)
- Conflict resolution for tabs that are loading at the time of sync
- Syncing Normal tabs
- Syncing tab groups across window boundaries
- Handling bookmarks outside the `ZenTabs/` folder

---

## 3. New Method

Added to the existing `SimpleBookmarkSyncManager` class.

| Item | Value |
|---|---|
| Method name | `syncBookmarksToTabs({ dryRun = false } = {})` |
| File | `content/SimpleBookmarkSyncManager.mjs` (existing class) |
| Test file | `tests/SimpleBookmarkSyncManager.test.mjs` (extend existing) |
| UI entry | New menu item in `content/UI.mjs` |

### Dry-run mode

When `dryRun: true` is passed:
- **No tabs, spaces, containers, or Zen folders are created or deleted.** All browser-mutating calls are skipped.
- The method goes through every phase of the algorithm exactly as in normal mode (reading bookmarks, building desired state, matching against live tabs) but replaces every write with a log entry.
- The return value has the same shape but also includes a `plan` array describing every action that *would* have been taken:

```javascript
{
  created: number,   // tabs that would be created
  updated: number,   // tabs that would be reordered
  deleted: number,   // tabs that would be removed
  errors:  string[], // errors encountered while reading (same as live mode)
  plan:    Array<PlanEntry>  // only present when dryRun: true
}
```

`PlanEntry` shape:

```javascript
{
  action: "create-tab" | "delete-tab" | "reorder-tab"
        | "create-space" | "create-container" | "create-zen-folder",
  description: string,  // human-readable, e.g. "Create pinned tab 'GitHub' (https://github.com) in space 'Work'"
  // optional extra fields per action type:
  url?: string,
  title?: string,
  space?: string,
  container?: string,
  folder?: string,
}
```

The plan entries are also logged to the browser console (one line per entry, prefixed `[ZenTabs][DryRun]`) so users can review what would happen without opening DevTools.

---

## 4. Bookmark Structure Interpretation

```
ZenTabs/                               ← already exists (from tabs→bookmarks sync)
├── __spaces__/                        ← metadata — read for icon/theme, not for tabs
│   ├── SpaceA  →  data:…json          ← space metadata bookmark
│   └── SpaceB  →  data:…json
├── SpaceA/                            ← Zen Space named "SpaceA"
│   ├── Essentials/                    ← default container (containerTabId = 0)
│   │   └── bookmark1  →  url1
│   ├── Essentials - Work/             ← "Work" Firefox container
│   │   └── bookmark2  →  url2
│   ├── pinned-title  →  pinned-url    ← pinned tab at space root (no Zen folder)
│   └── FolderName/                    ← Zen folder containing pinned tabs
│       └── nested-title  →  nested-url
└── SpaceB/
    └── Essentials - Work/             ← same "Work" container as SpaceA — dedup!
        └── bookmark2  →  url2         ← same essential tab — NOT created again
```

Folder classification rules within a space folder:
- A subfolder whose title starts with `"Essentials"` → Essential tab folder
- Any other subfolder → Zen folder (group) containing pinned tabs
- A direct bookmark inside the space folder (no subfolder) → Pinned tab at space root

---

## 5. Essential Tab Deduplication

Essential tabs in Zen are **container-scoped** — a single essential tab with `userContextId=N` appears in every Space that uses container N. They are NOT duplicated per space.

When the same URL appears under the same base container name (e.g., `Essentials - Work`) across multiple space folders, **only create ONE essential tab**. The first occurrence (by space folder order in bookmarks) wins.

**Deduplication key**: `(url, resolvedContainerName)` — where `resolvedContainerName` is the base container. "Essentials" maps to `containerTabId = 0`; "Essentials - Work" maps to the "Work" container's `userContextId`.

Resolved essential tab space assignment: assign the tab to the **first space** that listed it under that container's folder. Subsequent spaces that list the same essential URL under the same container folder are no-ops for tab creation.

---

## 6. Algorithm

### Phase 1 — Read bookmark tree

1. Locate `ZenTabs/` under Bookmarks Toolbar via `PlacesUtils.promiseBookmarksTree(toolbarGuid)`.
2. If `ZenTabs/` does not exist: log a warning and return an empty result (nothing to restore).
3. Read `__spaces__` metadata once via `readSpaceMetadata()` for icon/theme info.
4. Collect all space folders from `ZenTabs/` children (exclude `__spaces__`).

### Phase 2 — Prepare containers and spaces

For each space folder (in bookmark order):

1. **Space matching**: Look up `gZenWorkspaces.getWorkspaces()` for a space with the same name.
   - If found: use it as-is.
   - If not found: create it via `gZenWorkspaces.createAndSaveWorkspace(name, icon, true, 0)`.
     - `icon` is taken from the `__spaces__` metadata if available; otherwise `null`.
     - Theme is applied via `gZenWorkspaces.saveWorkspace(...)` after creation if metadata was found.
     - `dontChange = true` so the new space does not become active.
     - `containerTabId = 0` initially; if the space has Essential tabs under a container folder, use the most common container.

2. **Container matching** (for Essentials folders): parse the container name from the folder title:
   - `"Essentials"` → `containerTabId = 0` (default)
   - `"Essentials - <Name>"` → look up `ContextualIdentityService.getPublicIdentityFromId(id)` across all identities to find one with matching name.
   - If no matching container exists: create a new one via `ContextualIdentityService.createIdentity({ name, color: "blue", icon: "circle" })`.

### Phase 3 — Build desired live-tab state

From the parsed bookmark tree, build a flat desired state per space:

```
DesiredTab {
  type: "essential" | "pinned"
  url: string
  title: string
  spaceUuid: string
  containerTabId: number          // only for essential tabs
  zenFolderPath: string[] | null  // only for pinned tabs; null = space root
  bookmarkIndex: number           // 0-based position within its parent in bookmarks
}
```

Essential tabs are deduplicated here (see §5) before this list is finalized.

### Phase 4 — Reconcile essential tabs

Essential tabs are shared across spaces — reconcile them globally (across all spaces), keyed by `(url, containerTabId)`:

1. Collect all live essential tabs from `allStoredTabs`.
2. For each desired essential tab not already present (by `url + containerTabId`): create it (§7).
3. For each live essential tab whose `(url, containerTabId)` has no entry in desired list: **remove it**.

### Phase 5 — Reconcile pinned tabs per space

For each space (in bookmark order):

1. Collect live **pinned** (non-essential) tabs for the space via `allStoredTabs` filtered by `zen-workspace-id`.
2. Build a desired list of pinned tabs for this space from the bookmark tree.
3. **Match** live pinned tabs to desired by URL (consumable pool, same as `_reconcileFolder` does for bookmarks).
4. **Create** desired pinned tabs with no match (§7).
5. **Delete** live pinned tabs with no desired match.
6. **Reconcile Zen folders**: ensure desired pinned tabs in named subfolders are assigned to the correct Zen folder (create the folder if missing).
7. **Enforce order** within each space: reorder tabs to match bookmark order.

### Phase 6 — Return result

```javascript
// live mode:
{ created: number, updated: number, deleted: number, errors: string[] }
// dry-run mode — same counters (incremented as if actions were taken) plus plan:
{ created: number, updated: number, deleted: number, errors: string[], plan: PlanEntry[] }
```

In dry-run mode the counters still reflect what **would** have happened, making it easy to compare a dry run with a live run.

---

## 7. Tab Creation

All tabs created by this sync are **unloaded/lazy** — they must not trigger a page load.

```javascript
const tab = gBrowser.addTab(url, {
  createLazyBrowser: true,
  lazyTabTitle: title,
  skipAnimation: true,
  userContextId: containerTabId,  // for essential tabs
});
```

After creation:
- **Assign to space**: `gZenWorkspaces.moveTabToWorkspace(tab, spaceUuid)` (exact method name to verify against Zen source during implementation).
- **Pin**: `gBrowser.pinTab(tab)` for pinned tabs.
- **Essential**: `tab.setAttribute("zen-essential", "true")` — mirrors what Zen does; also pin the tab as Zen essentials are pinned.
- **Zen folder**: `tab.group = zenFolderObject` or the appropriate Zen folder assignment API (exact API to verify against `ZenFolders.mjs` during implementation).

> **Note**: The exact method names for workspace assignment and Zen folder assignment are implementation-time details that must be verified against the Zen Browser source (`src/zen/spaces/ZenSpaceManager.mjs`, `src/zen/tabs/ZenFolders.mjs`) before writing the code. These will be documented once verified.

---

## 8. Tab Deletion

Delete tabs using:
```javascript
gBrowser.removeTab(tab, { skipPermitUnload: true });
```

Only **Essential** and **Pinned** tabs are candidates for deletion.  
**Never delete Normal tabs** — they are invisible to this sync.

---

## 9. Order Enforcement

Within each space, Essential tabs and Pinned tabs must appear in the same order as their corresponding bookmarks.

Order is enforced by calling `gBrowser.moveTabTo(tab, targetIndex)` for any tab whose current `_tPos` differs from the target position.

Essential tabs (space-shared) come first within their container; pinned tabs follow, ordered to match their bookmark positions within the space.

---

## 10. Events

| Event | When fired |
|-------|------------|
| `simple-restore-started` | Sync begins |
| `simple-restore-completed` | Sync completed successfully |
| `simple-restore-failed` | Sync threw an error |

---

## 11. Return Value

```javascript
{
  created: number,   // tabs created
  updated: number,   // tabs reordered or renamed (future, currently 0)
  deleted: number,   // tabs removed
  errors: string[]   // any non-fatal errors
}
```

---

## 12. UI

Add two new menu items to the existing toolbar button popup in `content/UI.mjs`:

```
New Sync — From Bookmarks         ← calls simpleSyncFromBookmarks()      (live)
New Sync — From Bookmarks (dry)   ← calls simpleSyncFromBookmarksDryRun() (dry-run, logs to console)
```

Both placed immediately after the existing `"New Sync — To Bookmarks"` item, grouped together with a separator above them.

---

## 13. Preferences

No new preferences. The feature is always available when `SimpleBookmarkSyncManager` is initialized.

---

## 14. Test Cases

### `syncBookmarksToTabs` — requires DOM stubs (low coverage in unit tests)

Because tab creation, space creation, and container creation all require browser globals not easily mockable in Node.js, the **unit test focus** is on the pure parsing and planning logic extracted into testable helpers:

| Test | Description |
|---|---|
| `_parseBookmarkTree` — spaces extracted | Given a mock bookmark tree, returns the expected list of space+tab descriptors |
| `_parseBookmarkTree` — `__spaces__` excluded | The metadata folder is not treated as a space |
| Essential deduplication | Same URL + container across two spaces → only one desired essential entry |
| Essential deduplication — different containers | Same URL, different container → two desired essential entries |
| `_resolveContainerName` — default | `"Essentials"` → `containerTabId = 0` |
| `_resolveContainerName` — named | `"Essentials - Work"` → matches existing Work container |
| `_resolveContainerName` — not found | Unknown container name → creates new container and returns its id |
| Space matching | Space with matching name exists → reuse; no matching name → mark for creation |
| Dry-run — no mutations | `dryRun: true` calls no write APIs; all plan entries captured |
| Dry-run — counters match | counters in dry-run result equal what a live run would produce |
| Dry-run — plan entries | each planned action has correct `action`, `description`, and relevant fields |

> High-level integration tests (full sync round-trip) are deferred — the algorithm must be validated manually in the browser before being unit-tested.

---

## 15. Out-of-Scope Clarifications

- No manifest tracking. The sync is always a full idempotent overwrite from bookmarks.
- No support for partial space sync (either all spaces in `ZenTabs/` are synced or none are).
- No preference to toggle this feature independently — it is always available.
- No handling for bookmarks added manually outside of the `ZenTabs/` folder structure.
