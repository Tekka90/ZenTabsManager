# Specification — Dashboard Kagi Integrations

**Status:** Implemented
**Author:** GitHub Copilot
**Date:** 2026-06-25

---

## 1. Purpose

Add lightweight Kagi tools directly in the static dashboard page so users can:
- launch a Kagi Research query from a text field
- launch a Kagi Assistant query from a text field
- see a small highlights section for Kagi News

All navigation opens in the same page/tab (`window.location`), per user request.

---

## 2. Module and File Location

Updated file:
- `content/dashboard.html`

No runtime module changes (`TabPublishManager`, `zen.sys`, `zen.api`) are required for this feature.

---

## 3. UI Additions

### 3.1 Kagi Actions Panel

Add a compact panel above the tree with:
- `Research` text input + `Go` button
- `Assistant` text input + `Go` button

Behavior:
- Clicking `Go` for Research builds a URL and navigates current page.
- Clicking `Go` for Assistant builds a URL and navigates current page.
- Pressing Enter in each field triggers its corresponding action.

### 3.2 Kagi News Highlights Panel

Add a small section (3-5 items max) with:
- heading: `Kagi News Highlights`
- list of clickable headlines
- each headline opens in same page (normal anchor navigation)
- fallback message when feed cannot be loaded

---

## 4. URL Strategy

Because public Kagi endpoints may evolve and some endpoints may not be CORS-friendly, use stable URL builders and graceful fallback.

### 4.1 Research URL

Preferred:
- `https://kagi.com/search?q=<encoded_query>&source=zentabs-dashboard`

### 4.2 Assistant URL

Preferred:
- `https://kagi.com/assistant?q=<encoded_query>&source=zentabs-dashboard`

Fallback behavior:
- If Assistant query is empty, navigate to `https://kagi.com/assistant`.

---

## 5. News Highlights Data Source

Attempt to fetch from a Kagi news endpoint list in order (first successful response wins), for example:
- `https://kagi.com/news/rss`
- `https://kagi.com/news`

Implementation rules:
- Use a short timeout and robust `try/catch`.
- Parse only the first few items (max 5).
- If CORS/network/parsing fails, display fallback text and a `Open Kagi News` link to `https://kagi.com/news`.

---

## 6. Behavior Rules

1. Dashboard initial rendering behavior remains unchanged (including default collapsed tree).
2. Kagi actions do not affect filters or tree state before navigation.
3. Empty Research query does nothing.
4. Empty Assistant query opens Assistant home.
5. News highlights load asynchronously after initial dashboard render.
6. News loading failure must never break page rendering.

---

## 7. Out of Scope

- Backend proxy for news feeds
- Auth/session management for Kagi
- Persisting recent Kagi queries
- Rich news cards/thumbnails

---

## 8. Test Plan

Update test file:
- `tests/TabPublishManager.test.mjs`

Required test coverage (static HTML assertions):
1. Contains Kagi Research input/button and URL builder logic.
2. Contains Kagi Assistant input/button and URL builder logic.
3. Contains Kagi News highlights section container and loader function.
4. Contains graceful fallback text/path for news failures.

---

## 9. Acceptance Criteria

- Dashboard contains both query fields and they navigate in the same page.
- Dashboard displays a Kagi News highlights block or a clear fallback.
- Existing dashboard functionality (search/filter/tree expand/collapse/default collapsed) still works.
- Tests pass.
