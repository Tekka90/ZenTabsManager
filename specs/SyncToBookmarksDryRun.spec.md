# Specification — Sync To Bookmarks Dry Run (Replace List Tabs)

**Status:** Proposed
**Author:** GitHub Copilot
**Date:** 2026-06-24

---

## 1. Purpose

Replace the current `List All Tabs` toolbar action with `Sync to Bookmarks (dry run)` so users can preview bookmark sync changes before applying them.

---

## 2. Scope

### In scope
- Remove `List All Tabs` menu entry.
- Add `Sync to Bookmarks (dry run)` menu entry in the same section.
- Add dry-run support to tabs->bookmarks sync API.
- Show dry-run output in the existing compact results dialog, with:
  - Summary counts: created, updated, deleted, errors.
  - Detailed change list showing only items that would change.
- Keep live `Sync to Bookmarks` action unchanged.

### Out of scope
- Automatic sync scheduling.
- Changes to restore dry-run logic.
- Changes to cleanup/memory/statistics actions.

---

## 3. Module and Files

- Update: `content/SimpleBookmarkSyncManager.mjs`
- Update: `content/UI.mjs`
- Update: `content/ResultFormatter.mjs`
- Update: `engine/zen.api.mjs`
- Update tests: `tests/SimpleBookmarkSyncManager.test.mjs`, `tests/ResultFormatter.test.mjs`

---

## 4. Public API

### `SimpleBookmarkSyncManager`
- Change signature:

```javascript
async syncTabsToBookmarks({ dryRun = false } = {})
```

- Return shape in dry-run mode:

```javascript
{
  created: number,
  updated: number,
  deleted: number,
  errors: string[],
  details: object,
  plan: Array<{ action: string, description: string }>
}
```

`plan` is present only when `dryRun: true`.

### `ZenTabsAPI`
- Update to pass options through:

```javascript
ZenTabsAPI.syncToBookmarks(options = {})
```

---

## 5. Behavior Rules

### Menu/UI changes
- Remove `List All Tabs` menu item.
- Add `Sync to Bookmarks (dry run)` menu item near `Sync to Bookmarks`.
- Optional shortcut for dry-run action is allowed but not required.

### Dry-run sync behavior
- Dry-run performs a full reconciliation pass but does not mutate bookmarks.
- Counters (`created`, `updated`, `deleted`) still reflect what would happen.
- `plan` captures only changing actions (create/update/delete/reorder metadata/folder/bookmark actions).
- If no changes are needed, show explicit empty state in results dialog.

### Live sync behavior
- Existing live sync behavior remains unchanged.

---

## 6. Integration Points

- `UIManager`:
  - Replace `listAllTabs()` action wiring with `syncToBookmarksDryRun()`.
  - `syncToBookmarksDryRun()` calls `syncTabsToBookmarks({ dryRun: true })` and opens results dialog.

- `ResultFormatter`:
  - Add formatter for sync dry-run summary + detailed changes.

- `SimpleBookmarkSyncManager`:
  - Reconcile helpers accept optional dry-run recorder.
  - No bookmark writes when `dryRun: true`.

---

## 7. Tests

Required additions:
1. `syncTabsToBookmarks({ dryRun: true })` returns plan and does not write bookmarks.
2. Dry-run counters match would-change operations.
3. Dry-run plan includes only changing entries.
4. Formatter renders sync dry-run summary + details.
5. Formatter shows empty state when dry-run has no changes.

---

## 8. Acceptance Criteria

- `List All Tabs` menu entry no longer appears.
- `Sync to Bookmarks (dry run)` is available and functional.
- Dry-run does not mutate bookmarks.
- Results dialog shows counts + details of would-change operations.
- Tests pass with `npm test`.
- `.github/copilot-instructions.md` spec index updated.
- `theme.json` `updatedAt` bumped.
