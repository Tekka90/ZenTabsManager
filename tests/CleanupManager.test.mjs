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

  test("does nothing when paused=true", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 10 * DAY_MS });
    const { cm, mgr } = makeCleanup([old], { cleanupEnabled: true, paused: true });

    const r = await cm.runCleanup();

    assert.equal(r, undefined);
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

// ── cleanupOldTabs: hours unit ────────────────────────────────────────────

describe("cleanupOldTabs — hours unit", () => {
  test("closes tab older than threshold in hours", async () => {
    const HOUR_MS = 3600000;
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 5 * HOUR_MS });
    const { cm, mgr } = makeCleanup([old], { cleanupAge: 2, cleanupAgeUnit: "hours" });

    const r = await cm.cleanupOldTabs({ dryRun: false });

    assert.equal(r.closed, 1);
    assert.equal(mgr.window.gBrowser._removed.length, 1);
  });

  test("keeps tab younger than threshold in hours", async () => {
    const HOUR_MS = 3600000;
    const fresh = makeTab({ url: "https://fresh.com", lastAccessed: Date.now() - 1 * HOUR_MS });
    const { cm } = makeCleanup([fresh], { cleanupAge: 2, cleanupAgeUnit: "hours" });

    const r = await cm.cleanupOldTabs({ dryRun: false });

    assert.equal(r.closed, 0);
  });
});

// ── unloadStaleTabs ───────────────────────────────────────────────────────

describe("unloadStaleTabs", () => {
  function makeUnloadCleanup(tabDefs, prefs = {}) {
    const tabs = tabDefs.map(d => makeTab(d));
    const mgr = makeManager({ tabs, preferences: { autoUnloadEnabled: true, autoUnloadDelay: 3600, ...prefs } });
    const tabData = tabs.map((tab, i) => ({
      tab,
      title: tab.label ?? `Tab ${i}`,
      url: tab.linkedBrowser.currentURI.spec,
      type: tab.hasAttribute("zen-essential") ? "essential" : tab.pinned ? "pinned" : "normal",
      lastAccessedAge: { milliseconds: Date.now() - (tab.lastAccessed ?? Date.now()), seconds: Math.floor((Date.now() - (tab.lastAccessed ?? Date.now())) / 1000) },
      state: tab.selected ? ["active"] : tab.hasAttribute("discarded") ? ["discarded"] : [],
    }));
    mgr.tabManager = { getAllTabs: async () => tabData };
    mgr.window.gBrowser.discardBrowser = (tab) => { tab.setAttribute("discarded", ""); mgr.window.gBrowser._discarded.push(tab); };
    const cm = new CleanupManager(mgr);
    return { cm, mgr, tabs };
  }

  test("does nothing when autoUnloadEnabled=false", async () => {
    const { cm, mgr } = makeUnloadCleanup(
      [{ url: "https://old.com", lastAccessed: Date.now() - 7200000 }],
      { autoUnloadEnabled: false }
    );
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("protects essential tab even when keepEssentialTabs=false", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://ess.com", lastAccessed: Date.now() - 7200000, attrs: { "zen-essential": "" } },
    ], { keepEssentialTabs: false });
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("does nothing when paused", async () => {
    const { cm, mgr } = makeUnloadCleanup(
      [{ url: "https://old.com", lastAccessed: Date.now() - 7200000 }],
      { paused: true }
    );
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("discards tab idle longer than autoUnloadDelay", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://idle.com", lastAccessed: Date.now() - 7200000 }, // 2 hours idle
    ], { autoUnloadDelay: 3600 }); // 1 hour threshold

    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 1);
  });

  test("does not discard tab idle less than autoUnloadDelay", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://recent.com", lastAccessed: Date.now() - 1000 }, // 1 second idle
    ], { autoUnloadDelay: 3600 });

    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("skips active tab", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://active.com", lastAccessed: Date.now() - 7200000, selected: true },
    ]);
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("skips already discarded tab", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://disc.com", lastAccessed: Date.now() - 7200000, attrs: { discarded: "" } },
    ]);
    await cm.unloadStaleTabs();
    // The tab was already discarded, state array contains "discarded" → skip
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("protects essential tab when keepEssentialTabs=true", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://ess.com", lastAccessed: Date.now() - 7200000, attrs: { "zen-essential": "" } },
    ], { keepEssentialTabs: true });
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("protects pinned tab when keepPinnedTabs=true", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://pin.com", pinned: true, lastAccessed: Date.now() - 7200000 },
    ], { keepPinnedTabs: true });
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("protects pinned tab even when keepPinnedTabs=false", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://pin.com", pinned: true, lastAccessed: Date.now() - 7200000 },
    ], { keepPinnedTabs: false });
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
  });

  test("dispatches tabs-auto-unloaded event when tabs are unloaded", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://idle.com", lastAccessed: Date.now() - 7200000 },
    ]);
    let eventFired = false;
    mgr.on("tabs-auto-unloaded", () => { eventFired = true; });
    await cm.unloadStaleTabs();
    assert.ok(eventFired);
  });

  test("second run does not re-discard tabs already unloaded by first run", async () => {
    const { cm, mgr } = makeUnloadCleanup([
      { url: "https://idle.com", lastAccessed: Date.now() - 7200000 },
    ], { autoUnloadDelay: 3600 });

    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 1, "first run discards");

    // Second run — the tab now has the "discarded" attribute set by
    // discardBrowser(), so it should be skipped.
    await cm.unloadStaleTabs();
    assert.equal(mgr.window.gBrowser._discarded.length, 1, "second run should not re-discard");
  });
});

// ── optimizeMemory ────────────────────────────────────────────────────────

describe("optimizeMemory", () => {
  test("skips optimization when not forced and memory is fine", async () => {
    const tab = makeTab({ url: "https://a.com" });
    const mgr = makeManager({ tabs: [tab], preferences: { memoryThreshold: 80 } });
    mgr.tabManager = { getAllTabs: async () => [{ tab, title: "A", url: "https://a.com", type: "normal", state: [], lastAccessedAge: { milliseconds: 0, days: 0 } }] };
    const cm = new CleanupManager(mgr);

    // Inject a getMemoryInfo that reports 10% usage (well under threshold)
    cm.getMemoryInfo = async () => ({ used: 1, total: 10, limit: 10, percentUsed: 10 });

    const r = await cm.optimizeMemory({ force: false });
    assert.equal(r.optimized, 0);
  });

  test("discards oldest inactive tabs when forced", async () => {
    const t1 = makeTab({ url: "https://old.com",  lastAccessed: Date.now() - 7200000 });
    const t2 = makeTab({ url: "https://new.com",  lastAccessed: Date.now() - 100 });
    const mgr = makeManager({ tabs: [t1, t2], preferences: { keepEssentialTabs: true, memoryThreshold: 80 } });
    mgr.window.gBrowser.discardBrowser = (tab) => { tab.setAttribute("discarded", ""); mgr.window.gBrowser._discarded.push(tab); };

    const tabDataList = [
      { tab: t1, title: "old", url: "https://old.com", type: "normal", state: [], lastAccessedAge: { milliseconds: 7200000, days: 0 } },
      { tab: t2, title: "new", url: "https://new.com", type: "normal", state: [], lastAccessedAge: { milliseconds: 100,     days: 0 } },
    ];
    mgr.tabManager = { getAllTabs: async () => tabDataList };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    const r = await cm.optimizeMemory({ force: true });
    assert.ok(r.unloaded >= 1);
    assert.ok(mgr.window.gBrowser._discarded.length >= 1);
  });

  test("does not count pending tabs as newly unloaded", async () => {
    const pending = makeTab({ url: "https://pending.com", attrs: { pending: "" }, lastAccessed: Date.now() - 20 * DAY_MS });
    const loaded = makeTab({ url: "https://loaded.com", lastAccessed: Date.now() - DAY_MS });

    const mgr = makeManager({ tabs: [pending, loaded], preferences: { memoryThreshold: 1 } });
    mgr.window.gBrowser.discardBrowser = (tab) => {
      tab.setAttribute("discarded", "");
      mgr.window.gBrowser._discarded.push(tab);
    };
    mgr.tabManager = {
      getAllTabs: async () => [
        {
          tab: pending,
          title: "pending",
          url: "https://pending.com",
          type: "normal",
          state: ["pending"],
          lastAccessedAge: { milliseconds: 20 * DAY_MS, days: 20 }
        },
        {
          tab: loaded,
          title: "loaded",
          url: "https://loaded.com",
          type: "normal",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: DAY_MS, days: 1 }
        }
      ]
    };

    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    const r = await cm.optimizeMemory({ force: true });

    assert.equal(r.alreadyUnloaded, 1);
    assert.equal(r.unloaded, 1);
    assert.deepEqual(r.tabs.map(t => t.title), ["loaded"]);
  });

  test("optimizer can discard essential and pinned tabs", async () => {
    const essential = makeTab({ url: "https://essential.com", attrs: { "zen-essential": "" }, lastAccessed: Date.now() - 3 * DAY_MS });
    const pinned = makeTab({ url: "https://pinned.com", pinned: true, lastAccessed: Date.now() - 2 * DAY_MS });

    const mgr = makeManager({ tabs: [essential, pinned], preferences: { memoryThreshold: 1, keepEssentialTabs: true, keepPinnedTabs: true } });
    mgr.window.gBrowser.discardBrowser = (tab) => {
      tab.setAttribute("discarded", "");
      mgr.window.gBrowser._discarded.push(tab);
    };
    mgr.tabManager = {
      getAllTabs: async () => [
        {
          tab: essential,
          title: "essential",
          url: "https://essential.com",
          type: "essential",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: 3 * DAY_MS, days: 3 }
        },
        {
          tab: pinned,
          title: "pinned",
          url: "https://pinned.com",
          type: "pinned",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: 2 * DAY_MS, days: 2 }
        }
      ]
    };

    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    const r = await cm.optimizeMemory({ force: true });

    assert.equal(r.unloaded, 2);
    assert.deepEqual(r.tabs.map(t => t.title), ["essential", "pinned"]);
  });

  test("dryRun reports candidates without discarding tabs", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 5 * DAY_MS });
    const newer = makeTab({ url: "https://newer.com", lastAccessed: Date.now() - DAY_MS });

    const mgr = makeManager({ tabs: [old, newer], preferences: { memoryThreshold: 1 } });
    mgr.window.gBrowser.discardBrowser = (tab) => {
      tab.setAttribute("discarded", "");
      mgr.window.gBrowser._discarded.push(tab);
    };
    mgr.tabManager = {
      getAllTabs: async () => [
        {
          tab: old,
          title: "old",
          url: "https://old.com",
          type: "normal",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: 5 * DAY_MS, days: 5 }
        },
        {
          tab: newer,
          title: "newer",
          url: "https://newer.com",
          type: "normal",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: DAY_MS, days: 1 }
        }
      ]
    };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    const r = await cm.optimizeMemory({ force: true, dryRun: true });

    assert.equal(r.dryRun, true);
    assert.equal(r.unloaded, 2);
    assert.equal(mgr.window.gBrowser._discarded.length, 0);
    assert.deepEqual(r.tabs.map(t => t.title), ["old", "newer"]);
  });

  test("manual optimizeMemory still runs while paused", async () => {
    const old = makeTab({ url: "https://old.com", lastAccessed: Date.now() - 5 * DAY_MS });
    const mgr = makeManager({ tabs: [old], preferences: { paused: true, memoryThreshold: 1 } });
    mgr.window.gBrowser.discardBrowser = (tab) => {
      tab.setAttribute("discarded", "");
      mgr.window.gBrowser._discarded.push(tab);
    };
    mgr.tabManager = {
      getAllTabs: async () => [
        {
          tab: old,
          title: "old",
          url: "https://old.com",
          type: "normal",
          state: ["loaded"],
          lastAccessedAge: { milliseconds: 5 * DAY_MS, days: 5 }
        }
      ]
    };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    const r = await cm.optimizeMemory({ force: true, dryRun: false });

    assert.equal(r.unloaded, 1);
    assert.equal(mgr.window.gBrowser._discarded.length, 1);
  });
});

// ── checkMemoryUsage ──────────────────────────────────────────────────────

describe("checkMemoryUsage", () => {
  test("does nothing when memoryOptimization=false", async () => {
    const { cm } = makeCleanup([], { memoryOptimization: false });
    // Should return undefined without calling optimizeMemory
    const r = await cm.checkMemoryUsage();
    assert.equal(r, undefined);
  });

  test("triggers optimizeMemory when usage exceeds threshold", async () => {
    const tab = makeTab({ url: "https://a.com", lastAccessed: Date.now() - 1000 });
    const mgr = makeManager({ tabs: [tab], preferences: { memoryOptimization: true, memoryThreshold: 80 } });
    mgr.window.gBrowser.discardBrowser = (t) => { t.setAttribute("discarded", ""); };
    mgr.tabManager = { getAllTabs: async () => [{ tab, title: "A", url: "https://a.com", type: "normal", state: [], lastAccessedAge: { milliseconds: 1000, days: 0 } }] };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    let optimizeCalled = false;
    const orig = cm.optimizeMemory.bind(cm);
    cm.optimizeMemory = async (opts) => { optimizeCalled = true; return orig(opts); };

    await cm.checkMemoryUsage();
    assert.ok(optimizeCalled);
  });

  test("does not trigger optimizeMemory when usage is below threshold", async () => {
    const mgr = makeManager({ preferences: { memoryOptimization: true, memoryThreshold: 80 } });
    mgr.tabManager = { getAllTabs: async () => [] };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 1, total: 10, limit: 10, percentUsed: 10 });

    let optimizeCalled = false;
    cm.optimizeMemory = async () => { optimizeCalled = true; };

    await cm.checkMemoryUsage();
    assert.ok(!optimizeCalled);
  });

  test("does nothing when paused=true", async () => {
    const mgr = makeManager({ preferences: { paused: true, memoryOptimization: true, memoryThreshold: 80 } });
    mgr.tabManager = { getAllTabs: async () => [] };
    const cm = new CleanupManager(mgr);
    cm.getMemoryInfo = async () => ({ used: 9, total: 10, limit: 10, percentUsed: 90 });

    let optimizeCalled = false;
    cm.optimizeMemory = async () => { optimizeCalled = true; };

    const r = await cm.checkMemoryUsage();

    assert.equal(r, undefined);
    assert.equal(optimizeCalled, false);
  });
});

describe("onTabsChanged", () => {
  test("does not trigger checkMemoryUsage when paused", () => {
    const tabs = Array.from({ length: 101 }, (_, i) => makeTab({ url: `https://tab${i}.com` }));
    const { cm } = makeCleanup(tabs, { paused: true, memoryOptimization: true });

    let checkCalled = false;
    cm.checkMemoryUsage = () => { checkCalled = true; };

    cm.onTabsChanged();

    assert.equal(checkCalled, false);
  });
});
