# Specification — Space Metadata in Bookmarks

**Status:** Implemented — 2026-04-14  
**Author:** GitHub Copilot  
**Date:** 2026-04-14 (revised)  

---

## 1. Purpose

The `SimpleBookmarkSyncManager` currently stores each Zen Space as a bookmark folder named after the space. This loses two pieces of display metadata:

- **Icon** — the emoji or SVG URL assigned to the space
- **Theme** — the gradient/colour theme applied to the space

This spec proposes a lightweight mechanism to persist that metadata inside the same `ZenTabs/` bookmark tree, and to detect space renames so the bookmark folder hierarchy stays accurate without a delete-and-recreate cycle.

---

## 2. The Problem with Bookmarks as Storage

Firefox bookmarks expose only four writable fields per entry:

| Field | Type | Usable? |
|---|---|---|
| `title` | string | ✅ but must remain the human-readable space name |
| `url` | string | ✅ can encode arbitrary data via `data:` URI |
| Tags | flat global list | ❌ not per-folder, pollutes global tag namespace |
| Description/Annotation | string | ❌ removed in modern Gecko |

This leaves the bookmark **URL** as the only safe container for structured metadata.

---

## 3. Key Design Constraint — No UUIDs in Persistent Storage

`space.uuid` is a locally-generated identifier that changes when the user installs Zen on a new machine, migrates their profile, or resets their browser. **UUIDs must never be stored in bookmarks or any artefact that must survive cross-profile use.**

The **space name** is the user-visible stable key used throughout this spec. Rename detection (§6) handles the case where a name changes.

---

## 4. Proposed Storage Approach — Dedicated Metadata Folder

### Structure

Add a `__spaces__/` subfolder directly inside `ZenTabs/`:

```
ZenTabs/
├── __spaces__/                          ← metadata folder (one per ZenTabs root)
│   ├── <SpaceName>  →  data:...         ← one metadata bookmark per space, keyed by name
│   └── ...
├── <SpaceName>/                         ← existing space content folders (unchanged)
│   └── ...
└── ...
```

### Metadata bookmark format

- **Title**: the space's **display name** (same string as the space folder title)
- **URL**: a `data:application/json,<URL-encoded JSON>` URI containing:

```json
{
  "v": 1,
  "name": "<space display name>",
  "icon": "<emoji string, SVG URL, or null>",
  "theme": <space.theme object — stored as-is>
}
```

Example URL:
```
data:application/json,%7B%22v%22%3A1%2C%22name%22%3A%22Work%22%2C%22icon%22%3A%22%F0%9F%94%A5%22%2C%22theme%22%3A%7B%7D%7D
```

### Why a dedicated folder?

| Criterion | Dedicated `__spaces__/` folder | Sentinel inside each space folder |
|---|---|---|
| Visual pollution | One hidden folder at root | One ugly entry per space |
| Skip logic in reconcile | One skip at root level | Guard repeated in every space folder |
| Resilience to manual edits | User deletes space content without losing metadata | Metadata deleted alongside space folder |

---

## 5. Icon Encoding

`space.icon` is one of:
- An **emoji** string (e.g. `"🔥"`) — stored as-is in JSON
- A **URL ending in `.svg`** — stored as-is (may be a `chrome://` URL)
- `null` or `""` — stored as `null`

---

## 6. Theme Encoding

`space.theme` is a JavaScript plain object managed by Zen internally. The spec treats it as **opaque JSON**: `JSON.stringify(space.theme)` on write, `JSON.parse(...)` on read. No validation of its shape is performed.

---

## 7. Space Rename Detection

Since names are mutable, the sync must detect renames and update folder/metadata titles in-place rather than deleting and recreating.

### When is it a rename vs. a delete + new space?

At the start of each sync run, compute two name sets:
- **`knownNames`** — space folder titles currently present inside `ZenTabs/` (excluding `__spaces__/`)
- **`liveNames`** — names of spaces returned by `gZenWorkspaces.getWorkspaces()`

Then:
- Names in **both** → same space, proceed normally
- Names **only in `liveNames`** (added) → candidate for either a new space or a rename target
- Names **only in `knownNames`** (removed) → candidate for either a deleted space or a rename source

For each (removed-name, added-name) pair, compute a **URL-set Jaccard similarity**:

```
similarity(A, B) = |urls(A) ∩ urls(B)| / |urls(A) ∪ urls(B)|
```

where:
- `urls(A)` = set of bookmark URLs currently inside the `A` folder in `ZenTabs/`
- `urls(B)` = set of tab URLs in the live space named `B`

**Decision rules** (applied greedily in descending similarity order):

| Condition | Decision |
|---|---|
| `similarity ≥ 0.5` | **Rename**: rename the bookmark folder from A to B; rename the metadata bookmark title from A to B; proceed to normal sync |
| `similarity < 0.5` | **Delete + New**: delete the A folder (and its metadata bookmark); create a fresh B folder |

If there are multiple removed/added names, pair them greedily: sort candidate pairs by similarity descending, assign each removed name to its highest-similarity added name (each name used at most once). Unpaired removed names are treated as deletes; unpaired added names are treated as new spaces.

**Edge case — empty space (no pinned/essential tabs)**: `urls(A)` and `urls(B)` are both empty → similarity = 0/0 → undefined. Treat undefined similarity as **0** (i.e., treat as delete + new, not rename).

---

## 8. Sync Behaviour

### Write (during `syncTabsToBookmarks()`)

At the start of the sync, before reconciling folder content:

1. Run rename detection (§7) — rename bookmark folders and metadata entries in-place as needed.

After reconciling all space content folders:

2. Get or create the `__spaces__/` folder inside `ZenTabs/`.
3. For each space that was synced, upsert a metadata bookmark:
   - If a bookmark with `title === space.name` already exists in `__spaces__/`, **update its URL** if the encoded metadata has changed.
   - If no bookmark exists for this name, **create** one.
4. Delete metadata bookmarks in `__spaces__/` whose titles no longer appear in the current space list (after renames have been applied).

### No additional sync direction

This is **write-only** in this spec. Reading metadata back is available via `readSpaceMetadata()` (see §9) but no space creation from bookmarks is in scope here.

---

## 9. Impact on Existing Reconciliation

The `_reconcileFolder` method must skip the `__spaces__/` folder when processing the `ZenTabs/` root:

```javascript
// In _reconcileFolder, when iterating existing children of ZenTabs root:
if (existing.type === "folder" && existing.title === "__spaces__") {
  continue; // managed separately by _syncSpaceMetadata()
}
```

No other changes to existing reconcile logic.

---

## 10. New Public API

```javascript
class SimpleBookmarkSyncManager {
  // --- existing methods (unchanged) ---

  // Called automatically at start of syncTabsToBookmarks(), before reconcile
  async _detectAndApplyRenames(zenTabsRootGuid, liveSpaces)
  // Computes knownNames vs liveNames, runs Jaccard similarity, renames folders
  // and metadata bookmarks in-place. Private.

  // Called automatically at end of syncTabsToBookmarks(), after reconcile
  async _syncSpaceMetadata(zenTabsRootGuid, syncedSpaces)
  // syncedSpaces: Array<{ name, icon, theme }>
  // Upserts one metadata bookmark per space into __spaces__/ folder. Private.

  // Optional utility for future "restore" feature
  async readSpaceMetadata()
  // Returns Map<name, { icon, theme }> from __spaces__/ folder.
  // Returns empty Map if folder does not exist or on any read error.
}
```

`syncTabsToBookmarks()` orchestrates the full flow:
1. `_detectAndApplyRenames()` — rename in-place
2. `_reconcileFolder()` — existing content sync
3. `_syncSpaceMetadata()` — write icon/theme

---

## 11. Changes to `syncTabsToBookmarks()`

```javascript
// 1. Run rename detection before reconcile
await this._detectAndApplyRenames(rootGuid, liveSpaces);

// 2. (existing) _reconcileFolder call
await this._reconcileFolder(rootGuid, desiredRoot.children, result);

// 3. Upsert space metadata after reconcile
const syncedSpaces = [...byWorkspace.values()].map(({ workspace }) => ({
  name: workspace.name,
  icon: workspace.icon ?? null,
  theme: workspace.theme ?? {},
}));
await this._syncSpaceMetadata(rootGuid, syncedSpaces);
```

---

## 12. Data Structure Additions

```javascript
// New internal type
type SpaceMetadata = {
  v: 1,
  name: string,
  icon: string | null,
  theme: object,
}
```

---

## 13. Out of Scope

- Creating or modifying Zen Spaces from bookmark metadata (future spec)
- Displaying metadata anywhere in the ZenTabs UI
- Syncing Space ordering
- Importing icons from bookmark metadata on browser launch
- Multi-way rename resolution (more than one removed + one added name resolved simultaneously beyond the greedy algorithm above)

---

## 14. Test Cases

### Metadata storage

| # | Scenario | Expected |
|---|---|---|
| T1 | First sync with 2 spaces (one with emoji icon, one with null icon) | `__spaces__/` created with 2 bookmarks; correct JSON in URLs; no UUID in payload |
| T2 | Second sync, one space icon changed | Existing metadata bookmark URL updated |
| T3 | Space removed between syncs | Stale metadata bookmark deleted from `__spaces__/` |
| T4 | `readSpaceMetadata()` called after T1 | Returns Map with 2 entries, icon/theme match what was written |
| T5 | `readSpaceMetadata()` called on fresh install (no `__spaces__/` folder) | Returns empty Map, no error |
| T6 | `theme` is a nested object | Survives round-trip through `JSON.stringify` / `JSON.parse` |
| T7 | Icon is an SVG URL string | Stored and read back unchanged |

### Rename detection

| # | Scenario | Expected |
|---|---|---|
| R1 | Space "Work" renamed to "Work 2"; tabs mostly unchanged (similarity ≥ 0.5) | Bookmark folder renamed in-place; metadata bookmark title updated; content re-synced |
| R2 | Space "Work" deleted and new space "Personal" created (no URL overlap) | "Work" folder deleted; new "Personal" folder created |
| R3 | Two spaces swapped names simultaneously (A→B, B→A; each has 0 URL overlap with the other) | Both treated as delete+new (similarity < 0.5 for cross-pairs) |
| R4 | Empty space renamed | Similarity = 0 (both URL sets empty) → treated as delete + new |
| R5 | Space renamed; one of its original tabs is still open in new space (similarity = 1/n) | Outcome depends on threshold; if similarity ≥ 0.5, rename; otherwise delete+new |

---

## 15. File Mapping

| File | Change |
|---|---|
| `content/SimpleBookmarkSyncManager.mjs` | Add `_detectAndApplyRenames()`, `_syncSpaceMetadata()`, `readSpaceMetadata()`; update `syncTabsToBookmarks()`; skip `__spaces__/` in reconcile |
| `tests/SimpleBookmarkSyncManager.test.mjs` | Add test cases T1–T7 and R1–R5 |
