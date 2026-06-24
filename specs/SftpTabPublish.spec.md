# Specification — SFTP Tab Publish + Web Dashboard

**Status:** Proposed
**Author:** GitHub Copilot
**Date:** 2026-06-24

---

## 1. Purpose

Add a new user action that publishes current open tabs to:
- a JSON data file (`tabs.json`)
- a static HTML dashboard (`index.html`) that reads `tabs.json` with JavaScript and renders a clean UI

Then upload both files to a configured SFTP destination so they can be served by nginx and viewed from other browsers.

---

## 2. Constraints and Runtime Notes

This project runs inside Zen Browser privileged chrome context (no Node.js runtime, no npm dependencies).

Direct SFTP protocol implementation in pure browser code is out of scope. Upload will be done by invoking the system `sftp` CLI (`/usr/bin/sftp`) through chrome-process APIs when available.

If `sftp` is unavailable or upload fails, the feature returns a clear error notification and logs detailed diagnostics.

---

## 3. Modules and File Locations

New module:
- `content/TabPublishManager.mjs`

Updated modules:
- `engine/zen.sys.mjs` (initialize manager)
- `engine/zen.api.mjs` (expose API method)
- `content/UI.mjs` (menu item, action handler, settings fields)

No bundler/dependency changes.

---

## 4. Public API

Add to `ZenTabsAPI`:

```javascript
await ZenTabsAPI.publishTabsToSftp(options?)
```

Returns:

```javascript
{
  success: boolean,
  exportedAt: string, // ISO timestamp
  generated: {
    jsonFileName: "tabs.json",
    htmlFileName: "index.html",
    tabCount: number
  },
  uploaded: {
    json: boolean,
    html: boolean
  },
  errors: string[]
}
```

---

## 5. Preferences / Settings

New preferences under `zentabs.preferences`:
- `publishSftpHost` (string, default `""`)
- `publishSftpPort` (number, default `22`)
- `publishSftpUser` (string, default `""`)
- `publishSftpRemoteDir` (string, default `""`)
- `publishSftpPrivateKeyPath` (string, default `""`) // optional
- `publishSftpDashboardTitle` (string, default `"ZenTabs Dashboard"`)

UI rule:
- The menu item `Publish Tabs Dashboard` is only visible if required SFTP fields are present:
  - `publishSftpHost`
  - `publishSftpUser`
  - `publishSftpRemoteDir`

If not configured, menu item is hidden.

Settings dialog:
- Add editable fields for all preferences above.
- Save behavior follows existing settings flow.

---

## 6. Data Structures

`tabs.json` shape:

```json
{
  "version": 1,
  "generatedAt": "2026-06-24T00:00:00.000Z",
  "source": "ZenTabsManager",
  "stats": {
    "total": 0,
    "essential": 0,
    "pinned": 0,
    "normal": 0,
    "spaces": 0
  },
  "tabs": [
    {
      "title": "...",
      "url": "...",
      "type": "essential|pinned|normal",
      "space": "...",
      "folder": "...",
      "container": "...",
      "lastAccessed": 0
    }
  ]
}
```

`index.html` requirements:
- Reads `tabs.json` via `fetch('./tabs.json')`
- Displays:
  - header with dashboard title + generated timestamp
  - summary cards (counts)
  - searchable/filterable tab table
  - badges for tab type and space
- Pure HTML/CSS/JS in one file, no external dependencies

---

## 7. Behavior Rules

1. Trigger
- User clicks `Publish Tabs Dashboard` menu item.

2. Gather
- Collect all tabs via existing `TabManager.getAllTabs()` + metadata helpers.

3. Generate files
- Build JSON payload (`tabs.json`).
- Build static dashboard page (`index.html`) that loads `tabs.json`.

4. Stage files
- Write both files into a temporary local directory under profile temp.

5. Upload via SFTP
- Execute `sftp` in batch mode to upload `tabs.json` and `index.html` to `publishSftpRemoteDir`.
- Respect port/user/host and optional key path.

6. Result handling
- On success: show notification and results window summary.
- On failure: show error notification + structured error result.

7. Visibility
- If required SFTP settings missing, do not show publish menu item.

---

## 8. Integration Points

`content/UI.mjs`
- Add conditional menu item creation for `Publish Tabs Dashboard`.
- Add handler `publishTabsDashboard()` that calls manager/API and opens results window.
- Extend settings fields with SFTP config entries.

`engine/zen.sys.mjs`
- Initialize `TabPublishManager` during manager setup.
- Store as `this.tabPublishManager`.

`engine/zen.api.mjs`
- Add `publishTabsToSftp(options)` pass-through.

---

## 9. Out of Scope

- Incremental diff upload
- Real-time live websocket dashboard
- Authentication UI for password prompts
- Multi-file theme/custom template engine
- SFTP server provisioning

---

## 10. Tests

Primary test file:
- `tests/TabPublishManager.test.mjs` (new)

Additional updates:
- `tests/helpers/mocks.mjs` (process/file stubs as needed)
- `tests/UI.test.mjs` or `tests/UIManager.test.mjs` (new/minimal for menu visibility logic)

Required test cases:
1. JSON payload includes expected stats and tabs.
2. HTML template contains dashboard title and `fetch('./tabs.json')`.
3. Publish action returns failure when required SFTP fields missing.
4. UI menu item hidden when SFTP config incomplete.
5. UI menu item shown when config complete.
6. Upload command composition includes host/user/port/remote dir.
7. Error path returns structured `errors[]` without throwing.

---

## 11. Acceptance Criteria

- User can configure SFTP destination in settings.
- `Publish Tabs Dashboard` button only appears when SFTP config is complete.
- Clicking publish uploads `tabs.json` and `index.html` to remote SFTP directory.
- nginx can serve uploaded `index.html` and it renders `tabs.json` in a readable dashboard.
- Unit tests added and passing.
- Documentation updated in `.github/copilot-instructions.md`.
- `theme.json` `updatedAt` bumped at implementation completion.
