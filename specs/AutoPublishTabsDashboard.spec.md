# Specification — Auto Publish Tabs Dashboard

**Status:** Implemented — 2026-06-27
**Author:** GitHub Copilot
**Date:** 2026-06-26

---

## 1. Purpose

Run the dashboard publish extract automatically every 30 minutes and avoid rewriting/uploading the JSON and HTML files when the generated content has not changed.

This keeps the published dashboard fresh without repeatedly touching files or re-uploading identical artifacts.

---

## 2. Module and File Locations

Updated files:
- `content/TabPublishManager.mjs`
- `engine/zen.sys.mjs`
- `tests/TabPublishManager.test.mjs`
- `.github/copilot-instructions.md`
- `theme.json`

No new runtime module is required.

---

## 3. Public API / Preferences

### 3.1 Preferences

Add a new preference block for automatic dashboard publishing:

- `publishAutoEnabled` (boolean, default `false`)
- `publishAutoIntervalMinutes` (number, default `30`)

Behavior:
1. When enabled, the manager runs the dashboard publish pass on a fixed interval.
2. The default cadence is every 30 minutes.
3. The manual publish action remains available and continues to work independently of the auto schedule.

### 3.2 Internal Publish Result

Extend the publish result returned by `TabPublishManager.publishTabsToSftp()` to indicate whether work was skipped because nothing changed.

Suggested fields:
- `success` remains a boolean
- `skipped` (boolean)
- `reason` (string, optional)

---

## 4. Data and State

`TabPublishManager` stores a small in-memory cache of the last published content fingerprint.

Recommended fingerprint inputs:
- normalized JSON payload string for `tabs.json`
- dashboard HTML contents used for `index.html`

Cache behavior:
1. On the first successful publish, record the fingerprints.
2. On later runs, compare the new fingerprints to the cache.
3. If both match, skip disk writes and SFTP upload.
4. If either differs, write both files and upload as usual.

---

## 5. Behavior Rules

1. Auto-publish runs only after the manager is initialized and browser setup has completed.
2. Auto-publish uses the existing publish pipeline and does not duplicate the dashboard generation logic.
3. If SFTP config is missing, the auto-publish task does nothing and logs a clear message.
4. If there is no change in generated payload and dashboard HTML, no local files are rewritten and no SFTP upload is attempted.
5. A publish skip must be a clean no-op, not an error.
6. A later change to tabs or dashboard HTML must cause the next run to write and upload again.
7. Shutdown must clear the interval so the auto-publish task does not leak across browser window teardown.

---

## 6. Integration Points

### 6.1 `engine/zen.sys.mjs`
- Start a 30-minute interval when `publishAutoEnabled` is true.
- Clear the interval on pause/shutdown.
- Reuse the existing background-task lifecycle pattern used by cleanup and memory optimization.

### 6.2 `content/TabPublishManager.mjs`
- Build a stable fingerprint from the generated payload and dashboard HTML.
- Skip file writes and upload when the fingerprint matches the previous successful run.
- Keep the manual publish API behavior intact.

### 6.3 `tests/TabPublishManager.test.mjs`
- Cover first-run write/upload.
- Cover unchanged-content skip behavior.
- Cover changed-content rerun behavior.
- Cover interval configuration if the auto-scheduler is exposed in the manager lifecycle.

---

## 7. Out of Scope

- Real-time file watching
- Hash persistence across browser restarts
- Incremental/delta uploads
- User-visible progress UI for the background interval
- Changing the dashboard layout beyond the already implemented Open Tabs section

---

## 8. Test Plan

Update `tests/TabPublishManager.test.mjs` with at least:
1. First publish writes JSON, HTML, and SFTP batch file.
2. Second publish with identical generated content skips writes and upload.
3. Changed tab data causes the next publish to write and upload again.
4. Auto-publish scheduling is enabled at 30 minutes when preference is set.
5. Auto-publish interval is cleared on shutdown.

All existing tests must remain passing.

---

## 9. Acceptance Criteria

1. Dashboard publish runs automatically every 30 minutes when enabled.
2. Unchanged content does not rewrite local files or re-upload them.
3. Changed content triggers a fresh write and upload.
4. Manual publish still works.
5. Unit tests are added and passing.
6. `.github/copilot-instructions.md` is updated after implementation.
7. `theme.json.updatedAt` is bumped after implementation.
