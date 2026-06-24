# Specification — Action Results Window

**Status:** Proposed
**Author:** GitHub Copilot
**Date:** 2026-06-24

---

## 1. Purpose

Provide a small in-app window that displays human-readable results for key ZenTabs actions, replacing the current console-only workflow for operational feedback.

Target actions:
- List all tabs
- Sync to bookmarks
- Restore from bookmarks
- Restore from bookmarks (dry run)
- Clean up old tabs
- Optimize memory
- Show statistics

---

## 2. Module and File Location

- Existing class to extend: `UIManager`
- File: `content/UI.mjs`
- No new runtime dependency
- No build tooling changes

Optional small helper module (only if needed for testability):
- `content/ResultFormatter.mjs` (pure formatting helpers)

---

## 3. Public API

No external API surface changes are required.

Internal `UIManager` methods to add:
- `openResultsWindow({ title, mode, payload })`
- `renderResultsDocument({ title, mode, payload })`
- `formatResultSummary(payload)`
- `formatDryRunDetails(plan)`

`mode` values:
- `tabs-list`
- `sync-summary`
- `restore-summary`
- `restore-dry-run`
- `cleanup-summary`
- `memory-summary`
- `statistics`

---

## 4. Data Structures

Results view model:

```javascript
{
  title: string,
  mode: "tabs-list" | "sync-summary" | "restore-summary" | "restore-dry-run" | "cleanup-summary" | "memory-summary" | "statistics",
  timestamp: string, // ISO
  summary: Array<{ label: string, value: string | number }>,
  sections?: Array<{
    heading: string,
    rows: Array<Record<string, string | number | boolean>>
  }>
}
```

Dry-run section rows will be built from `result.plan` and filtered to include only effective changes.

---

## 5. Behavior Rules

General rules:
- Opening any target action result must show a compact dialog window in UI (not console-only).
- Keep existing console logs for diagnostics; UI window becomes the primary user-visible output.
- One results dialog instance at a time; opening new results replaces prior dialog content.
- Window is scrollable and readable in small dimensions.
- Use plain HTML elements inside chrome document (same approach as current settings dialog).
- Do not mutate business logic in managers; UI consumes returned results.

Action-specific rendering:
- List all tabs:
  - Show totals (total, essential, pinned, normal, workspaces, folders).
  - Show tab rows with title, type, workspace, folder path (if any), URL, age.
- Sync to bookmarks:
  - Show summary only: created, updated, deleted, errors count.
- Restore from bookmarks:
  - Show summary only: created, updated, deleted, errors count.
- Restore from bookmarks dry run:
  - Show summary counts.
  - Show detailed change rows from `plan` with action + description.
  - Include only entries representing changes (`create-*`, `delete-*`, `reorder-*`, `create-space`, `create-container`, `create-zen-folder`).
  - If no planned changes, show explicit "No changes needed".
- Clean up old tabs:
  - Show summary: checked, closed, skipped, protected, excluded.
  - Show closed tab details table (title, URL, age) when available.
- Optimize memory:
  - Show summary: checked, unloaded, alreadyUnloaded, protected, saved.
  - Show unloaded tab details (title, age) when available.
- Show statistics:
  - Show current statistics and memory values in structured sections.

Error handling:
- If an action throws, show error dialog with action name and message.
- Never crash the UI; dialog should still open with error state.

---

## 6. Integration Points

Changes in `content/UI.mjs`:
- `listAllTabs()` will call the new results window renderer with tab/stat payload.
- `simpleSyncToBookmarks()` will call results window with sync summary.
- `simpleSyncFromBookmarks()` will call results window with restore summary.
- `simpleSyncFromBookmarksDryRun()` will call results window with summary + plan details.
- `cleanupOldTabs()` will call results window with cleanup summary/details.
- `optimizeMemory()` will call results window with memory summary/details.
- `showStatistics()` will call results window with statistics payload.

No changes required to:
- `content/SimpleBookmarkSyncManager.mjs`
- `content/CleanupManager.mjs`
- `content/TabManager.mjs`
- `engine/zen.sys.mjs`
- `engine/zen.api.mjs`

---

## 7. Out of Scope

- Auto-refreshing live result window
- Persisted history of past action runs
- Exporting result window as file
- New preferences for result window styling
- Replacing existing settings dialog implementation

---

## 8. Tests

Primary test file:
- `tests/UIManager.test.mjs` (new)

If helper extraction is used:
- `tests/ResultFormatter.test.mjs` (new)

Required test cases:
1. `restore-dry-run` formatting includes counts and only changing plan entries.
2. `restore-dry-run` formatting shows "No changes needed" when plan is empty.
3. Sync/restore summary formatting uses created/updated/deleted/errors correctly.
4. Cleanup formatting includes closed tab details when `tabs.length > 0`.
5. Memory formatting includes unloaded tab details when present.
6. Statistics formatting includes tab totals + memory usage fields.
7. Error state rendering produces a stable fallback payload.

Note:
- UI is chrome/XUL-facing; tests should focus on pure formatting/view-model helpers and avoid browser globals by using mocks from `tests/helpers/mocks.mjs`.

---

## 9. Acceptance Criteria

- Every listed menu action opens a compact results dialog.
- Dry-run restore shows both summary counts and detailed plan rows for changes.
- Summary-only actions do not dump large details into the dialog.
- Existing action behavior (business logic) remains unchanged.
- Unit tests added for formatter/view-model logic and pass via `npm test`.
- Documentation (`.github/copilot-instructions.md`) updated after implementation.
- `theme.json` `updatedAt` bumped after implementation.
