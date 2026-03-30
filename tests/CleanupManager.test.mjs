/**
 * CleanupManager unit tests
 *
 * Run with: node --test tests/CleanupManager.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeManager, makeTab } from "./helpers/mocks.mjs";
import { CleanupManager } from "../content/CleanupManager.mjs";

const DAY_MS = 86400000;

// Build a manager + CleanupManager with a stubbed tabManager
function makeCleanup(tabs = [], prefs = {}) {
  const mgr = makeManager({ tabs, preferences: prefs });
  mgr.tabManager = {
    getAllTabs: async () => tabs.map((tab, i) => ({
      tab,
      title: tab.label ?? `Tab ${i}`,
      url:   tab.linkedBrowser.currentURI.spec,
      type:  tab.hasAttribute("zen-essential") ? "essential"
           : tab.pinned ? "pinned" : "normal",
      lastAccessedAge: {
        milliseconds: Date.now() - (tab.lastAccessed ?? Date.now()),
        days: Math.floor((Date.now() - (tab.lastAccessed ?? Date.now())) / DAY_MS),
      },
      state: [],
    })),
  };
  const cm = new CleanupManager(mgr);
  return { cm, mgr };
}

// ── cleanupOldTabs ────────────────────────────────────────────────────────

describe("cleanupOldTabs", () => {
  test("closes a normal tab older than maxAge", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 10 * DAY_MS });
    const { cm, mgr } = makeCleanup([old], {
      cleanupEnabled: true, keepEssentialTabs: true, keepPinnedTabs: true,
    });

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    assert.equal(r.closed, 1);
    assert.equal(mgr.window.gBrowser._removed.length, 1);
  });

  test("does not close a tab younger than maxAge", async () => {
    const fresh = makeTab({ url: "https://fresh.com", lastAccessed: Date.now() - DAY_MS });
    const { cm } = makeCleanup([fresh]);

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    assert.equal(r.closed, 0);
    assert.equal(r.skipped, 1);
  });

  test("dryRun reports without closing", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 10 * DAY_MS });
    const { cm, mgr } = makeCleanup([old]);

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: true });

    assert.equal(r.closed, 1);                           // reported as would-close
    assert.equal(mgr.window.gBrowser._removed.length, 0); // but not actually removed
  });

  test("protects essential tab when keepEssentialTabs=true", async () => {
    const ess = makeTab({
      url: "https://essential.com",
      lastAccessed: Date.now() - 10 * DAY_MS,
      attrs: { "zen-essential": "" },
    });
    const { cm } = makeCleanup([ess], { keepEssentialTabs: true });

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    assert.equal(r.closed, 0);
    assert.equal(r.protected, 1);
  });

  test("protects pinned tab when keepPinnedTabs=true", async () => {
    const pinned = makeTab({
      url: "https://pinned.com",
      pinned: true,
      lastAccessed: Date.now() - 10 * DAY_MS,
    });
    const { cm } = makeCleanup([pinned], { keepPinnedTabs: true });

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    assert.equal(r.closed, 0);
    assert.equal(r.protected, 1);
  });

  test("essential/pinned tabs are always skipped (only normal tabs are ever closed)", async () => {
    // CleanupManager has a hard guard: 'Only close normal tabs'.
    // Even with keepEssentialTabs=false the type guard still skips non-normal tabs.
    const ess = makeTab({
      url: "https://unlocked-essential.com",
      lastAccessed: Date.now() - 10 * DAY_MS,
      attrs: { "zen-essential": "" },
    });
    const { cm, mgr } = makeCleanup([ess], { keepEssentialTabs: false, keepPinnedTabs: false });

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    // Type guard skips non-normal tab regardless of preference
    assert.equal(r.skipped, 1);
    assert.equal(r.closed, 0);
    assert.equal(mgr.window.gBrowser._removed.length, 0);
  });

  test("excludes domains in excludeDomains list", async () => {
    const excluded = makeTab({
      url: "https://safe.example.com/page",
      lastAccessed: Date.now() - 10 * DAY_MS,
    });
    const { cm } = makeCleanup([excluded]);

    const r = await cm.cleanupOldTabs({ maxAge: 7, excludeDomains: ["safe.example.com"], dryRun: false });

    assert.equal(r.closed, 0);
    assert.equal(r.excluded, 1);
  });

  test("closes multiple qualifying tabs", async () => {
    const tabs = [
      makeTab({ url: "https://old1.com", lastAccessed: Date.now() - 10 * DAY_MS }),
      makeTab({ url: "https://old2.com", lastAccessed: Date.now() - 15 * DAY_MS }),
      makeTab({ url: "https://fresh.com", lastAccessed: Date.now() - 2  * DAY_MS }),
    ];
    const { cm } = makeCleanup(tabs);

    const r = await cm.cleanupOldTabs({ maxAge: 7, dryRun: false });

    assert.equal(r.closed, 2);
    assert.equal(r.skipped, 1);
  });
});

// ── runCleanup ────────────────────────────────────────────────────────────

describe("runCleanup", () => {
  test("does nothing when cleanupEnabled=false", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 10 * DAY_MS });
    const { cm } = makeCleanup([old], { cleanupEnabled: false });
    const r = await cm.runCleanup();
    assert.equal(r, undefined);
  });

  test("uses cleanupAge preference", async () => {
    const borderline = makeTab({ url: "https://borderline.com", lastAccessed: Date.now() - 10 * DAY_MS });
    const { cm, mgr } = makeCleanup([borderline], {
      cleanupEnabled: true, cleanupAge: 14,
      keepEssentialTabs: false, keepPinnedTabs: false,
    });
    const r = await cm.runCleanup();
    // 10 days old, threshold 14 — should NOT be closed
    assert.equal(r.closed, 0);
    assert.equal(mgr.window.gBrowser._removed.length, 0);
  });
});

// ── Domain exclusion ──────────────────────────────────────────────────────

describe("isDomainExcluded", () => {
  test("exact domain match", () => {
    const { cm } = makeCleanup([], { cleanupExcludeDomains: "example.com" });
    assert.equal(cm.isDomainExcluded("https://example.com/path", ["example.com"]), true);
  });

  test("subdomain is excluded when parent domain listed", () => {
    const { cm } = makeCleanup();
    assert.equal(cm.isDomainExcluded("https://sub.example.com", ["example.com"]), true);
  });

  test("unrelated domain is not excluded", () => {
    const { cm } = makeCleanup();
    assert.equal(cm.isDomainExcluded("https://other.com", ["example.com"]), false);
  });

  test("invalid URL does not throw", () => {
    const { cm } = makeCleanup();
    assert.doesNotThrow(() => cm.isDomainExcluded("not-a-url", ["example.com"]));
  });
});
