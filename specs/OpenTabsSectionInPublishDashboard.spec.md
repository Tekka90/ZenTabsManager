# Specification — Open Tabs Section in Published Dashboard

**Status:** Implemented — 2026-06-26
**Author:** GitHub Copilot
**Date:** 2026-06-26

---

## 1. Purpose

Extend the Publish Tabs Dashboard feature so the generated page includes a dedicated section at the end listing currently open tabs that are:
- in any Zen Space/workspace
- not `essential`
- not `pinned`

This section complements the existing published content (essential + pinned hierarchy) and gives a full view of normal open tabs.

---

## 2. Module and File Locations

Updated files:
- `content/TabPublishManager.mjs`
- `content/dashboard.html`
- `tests/TabPublishManager.test.mjs`
- `.github/copilot-instructions.md`
- `theme.json`

No new runtime module is introduced.

---

## 3. Public Data Contract

`tabs.json` gains a new top-level array:

```json
{
  "tabs": [
    { "type": "essential|pinned", "...": "..." }
  ],
  "openTabs": [
    { "type": "normal", "...": "..." }
  ]
}
```

Rules:
1. `tabs` continues to represent the existing published section (essential + pinned).
2. `openTabs` contains only tabs with `type === "normal"`.
3. `openTabs` spans all spaces/workspaces from `TabManager.getAllTabs()`.
4. Each `openTabs` item uses the same normalized tab shape as `tabs` (`title`, `url`, `type`, `space`, `folder`, `container`, `lastAccessed`).

---

## 4. Dashboard UI Changes

Add a new section after the existing tree:
- heading: `Open Tabs`
- subtext indicating it includes non-essential and non-pinned tabs across all spaces
- list/table rendering of `openTabs`

Behavior rules:
1. The section appears at the end of the page.
2. If `openTabs` is empty, show a compact empty-state message.
3. Existing search/filter controls for the main tree remain unchanged.
4. Main tree behavior (expand/collapse, filtering) remains unchanged.
5. Dashboard still renders safely when `openTabs` is absent (backward compatibility with older `tabs.json`).

---

## 5. Integration Points

### 5.1 `TabPublishManager.buildTabsPayload`
- Normalize all tabs once.
- Split normalized tabs into:
  - `tabs`: `essential` and `pinned`
  - `openTabs`: `normal`
- Keep existing stats fields intact.

### 5.2 `dashboard.html`
- Continue loading `data.tabs` for existing tree.
- Load `data.openTabs || []` for the new bottom section.
- Render links/title/url/space consistently with existing style language.

---

## 6. Out of Scope

- Editing or closing tabs from the dashboard
- Adding open-tab filters/sorting controls specific to the new section
- Including `essential` or `pinned` tabs in the new section
- Server-side processing changes

---

## 7. Test Plan

Update `tests/TabPublishManager.test.mjs` with at least:
1. Payload split test:
   - `tabs` includes only `essential`/`pinned`
   - `openTabs` includes only `normal`
2. Dashboard static assertions:
   - open tabs section container/heading exists
   - script references `openTabs` data and fallback (`data.openTabs || []`)
3. Backward compatibility assertion:
   - rendering logic handles missing `openTabs` key without throwing (via static pattern check)

All existing tests must remain passing.

---

## 8. Acceptance Criteria

1. Published `tabs.json` includes `openTabs` with non-essential and non-pinned tabs from all spaces.
2. Generated dashboard shows an `Open Tabs` section at the end.
3. Existing main tree content and controls keep their current behavior.
4. Unit tests are updated and passing.
5. `.github/copilot-instructions.md` specification index includes this spec entry after implementation.
6. `theme.json.updatedAt` is bumped at the end of implementation.
