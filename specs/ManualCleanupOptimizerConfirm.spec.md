# Specification — Manual Cleanup/Optimizer Preview + Confirm

**Status:** Proposed
**Author:** GitHub Copilot
**Date:** 2026-06-25

---

## 1. Purpose

When the user launches actions manually from the ZenTabs menu:
- `Cleanup Old Tabs`
- `Optimize Memory`

show a pre-execution preview dialog with:
- **OK** => execute action
- **Cancel** => do nothing

Automatic background jobs must stay silent and unchanged.

---

## 2. Scope

### In scope
- Add a dry-run preview step for manual cleanup and manual memory optimization.
- Add a confirmation dialog before execution for both actions.
- Keep existing post-execution result window behavior.
- Ensure Cancel does not mutate tabs.

### Out of scope
- Any change to automatic scheduled behavior (`runCleanup`, `checkMemoryUsage`, `unloadStaleTabs`).
- Changes to bookmark sync flows.
- New settings/preferences for this behavior.

---

## 3. Module and Files

- Update: `content/UI.mjs`
- Update: `content/CleanupManager.mjs`
- Update: `content/ResultFormatter.mjs`
- Update tests: `tests/CleanupManager.test.mjs`, `tests/ResultFormatter.test.mjs`

---

## 4. Public API Changes

### `CleanupManager.cleanupOldTabs(options = {})`
Already supports dry-run.

No breaking signature changes required.

### `CleanupManager.optimizeMemory(options = {})`
Add dry-run support:

```javascript
async optimizeMemory({ threshold, force = false, dryRun = false } = {})
```

Behavior in dry-run mode:
- Evaluate eligible tabs with same selection logic.
- Do not call `discardBrowser`.
- Return would-unload list and counters as preview.

Return payload adds:

```javascript
{
  dryRun: boolean,
  // existing fields:
  checked, unloaded, alreadyUnloaded, saved, tabs
}
```

In dry-run, `unloaded` means "would unload" count.

---

## 5. Behavior Rules

### Manual `Cleanup Old Tabs`
1. UI runs `cleanupOldTabs({ dryRun: true })`.
2. Show preview window:
   - summary: checked, wouldClose, skipped, protected, excluded
   - table: tabs that would be closed
3. Prompt confirm:
   - OK => run `cleanupOldTabs({ dryRun: false })`, then show existing final results window.
   - Cancel => close flow, no mutation, optional small notification.

### Manual `Optimize Memory`
1. UI runs `optimizeMemory({ force: true, dryRun: true })`.
2. Show preview window:
   - summary: checked, wouldUnload, alreadyUnloaded, savedMBEstimate
   - table: tabs that would be unloaded
3. Prompt confirm:
   - OK => run `optimizeMemory({ force: true, dryRun: false })`, then show existing final results window.
   - Cancel => close flow, no mutation, optional small notification.

### Automatic jobs
- `runCleanup()` remains direct execution (no popup/confirm).
- `checkMemoryUsage()` remains direct execution (no popup/confirm).
- `unloadStaleTabs()` remains direct execution (no popup/confirm).

---

## 6. Integration Points

### `content/UI.mjs`
- `cleanupOldTabs()` becomes two-phase (preview -> confirm -> execute).
- `optimizeMemory()` becomes two-phase (preview -> confirm -> execute).
- Add helper(s) for consistent confirm prompts with action-specific text.

### `content/ResultFormatter.mjs`
- Add preview formatter(s) or mode flags for:
  - `cleanup-preview`
  - `memory-preview`
- Keep existing summary result formats for final execution result.

### `content/CleanupManager.mjs`
- `optimizeMemory()` dry-run branch computes candidates but does not discard tabs.

---

## 7. Test Plan

### `tests/CleanupManager.test.mjs`
1. `optimizeMemory({ dryRun: true })` does not call `discardBrowser`.
2. `optimizeMemory({ dryRun: true })` returns would-unload tabs sorted by age.
3. `optimizeMemory({ dryRun: false })` behavior remains unchanged.

### `tests/ResultFormatter.test.mjs`
4. preview formatter contains expected summary labels and candidate rows.
5. preview formatter renders empty state when no candidate tabs.

---

## 8. Acceptance Criteria

- Manual Cleanup shows preview + OK/Cancel before execution.
- Manual Optimize Memory shows preview + OK/Cancel before execution.
- Cancel performs zero tab mutations.
- Automatic background jobs continue without popups.
- Existing final result windows still appear after confirmed execution.
- Unit tests pass via `npm test`.
- `theme.json` `updatedAt` bumped.
- `.github/copilot-instructions.md` spec index updated.
