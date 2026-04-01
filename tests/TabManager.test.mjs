/**
 * TabManager unit tests
 *
 * Run with: node --test tests/TabManager.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeManager, makeTab } from "./helpers/mocks.mjs";
import { TabManager } from "../content/TabManager.mjs";

function makeWorkspace(name, uuid = `uuid-${name}`) {
  return { uuid, name, icon: null, theme: {}, containerTabId: 0 };
}

// ── Tab type classification ───────────────────────────────────────────────

describe("Tab type classification", () => {
  test("normal tab returns type=normal", () => {
    const tab = makeTab({ url: "https://example.com" });
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    assert.equal(tm.getTabType(tab), "normal");
  });

  test("pinned tab returns type=pinned", () => {
    const tab = makeTab({ pinned: true });
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    assert.equal(tm.getTabType(tab), "pinned");
  });

  test("essential tab returns type=essential", () => {
    const tab = makeTab({ attrs: { "zen-essential": "" } });
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    assert.equal(tm.getTabType(tab), "essential");
  });

  test("essential takes precedence over pinned", () => {
    const tab = makeTab({ pinned: true, attrs: { "zen-essential": "" } });
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    assert.equal(tm.getTabType(tab), "essential");
  });
});

// ── getAllTabs ────────────────────────────────────────────────────────────

describe("getAllTabs", () => {
  test("returns all non-empty tabs from allStoredTabs", async () => {
    const ws = makeWorkspace("Personal");
    const tab1 = makeTab({ url: "https://a.com", attrs: { "zen-workspace-id": ws.uuid } });
    const tab2 = makeTab({ url: "https://b.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab1, tab2] });

    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const tabs = await tm.getAllTabs();
    assert.equal(tabs.length, 2);
  });

  test("filters out zen-empty-tab", async () => {
    const ws = makeWorkspace("Work");
    const real  = makeTab({ url: "https://real.com",  attrs: { "zen-workspace-id": ws.uuid } });
    const ghost = makeTab({ url: "about:blank",       attrs: { "zen-empty-tab": "" } });
    const mgr = makeManager({ workspaces: [ws], tabs: [real, ghost] });

    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const tabs = await tm.getAllTabs();
    assert.equal(tabs.length, 1);
    assert.equal(tabs[0].url, "https://real.com");
  });

  test("falls back to gBrowser.tabs when gZenWorkspaces is absent", async () => {
    const tab = makeTab({ url: "https://fallback.com" });
    const mgr = makeManager({ tabs: [tab] });
    mgr.window.gZenWorkspaces = undefined;

    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const tabs = await tm.getAllTabs();
    assert.equal(tabs.length, 1);
  });
});

// ── getTabsFiltered ──────────────────────────────────────────────────────

describe("getTabsFiltered", () => {
  async function buildTm(tabs, workspaces = []) {
    const mgr = makeManager({ tabs, workspaces });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    return tm;
  }

  test("filter by type=pinned", async () => {
    const tabs = [
      makeTab({ url: "https://a.com", pinned: true }),
      makeTab({ url: "https://b.com" }),
    ];
    const tm = await buildTm(tabs);
    const result = await tm.getTabsFiltered({ type: "pinned" });
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://a.com");
  });

  test("filter by URL substring", async () => {
    const tabs = [
      makeTab({ url: "https://github.com/foo" }),
      makeTab({ url: "https://example.com" }),
    ];
    const tm = await buildTm(tabs);
    const result = await tm.getTabsFiltered({ url: "github" });
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://github.com/foo");
  });

  test("filter by URL regex", async () => {
    const tabs = [
      makeTab({ url: "https://news.ycombinator.com" }),
      makeTab({ url: "https://example.com" }),
    ];
    const tm = await buildTm(tabs);
    const result = await tm.getTabsFiltered({ url: /ycombinator/ });
    assert.equal(result.length, 1);
  });

  test("filter by olderThan days", async () => {
    const old  = makeTab({ url: "https://old.com",   lastAccessed: Date.now() - 10 * 86400000 });
    const fresh = makeTab({ url: "https://fresh.com", lastAccessed: Date.now() });
    const tm = await buildTm([old, fresh]);
    const result = await tm.getTabsFiltered({ olderThan: 7 });
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://old.com");
  });

  test("filter by workspace name", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const inWs  = makeTab({ url: "https://work.com",  attrs: { "zen-workspace-id": ws.uuid } });
    const outWs = makeTab({ url: "https://other.com", attrs: { "zen-workspace-id": "other-uuid" } });
    const tm = await buildTm([inWs, outWs], [ws]);
    const result = await tm.getTabsFiltered({ workspace: "Work" });
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://work.com");
  });
});

// ── getWorkspaceInfo ──────────────────────────────────────────────────────

describe("getWorkspaceInfo", () => {
  test("returns workspace data when gZenWorkspaces is present", () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws] });
    const tm = new TabManager(mgr);
    const info = tm.getWorkspaceInfo(tab);
    assert.equal(info.id,   ws.uuid);
    assert.equal(info.name, ws.name);
  });

  test("falls back to uuid as name when workspace not found", () => {
    const tab = makeTab({ attrs: { "zen-workspace-id": "unknown-uuid" } });
    const mgr = makeManager({ workspaces: [] });
    const tm = new TabManager(mgr);
    const info = tm.getWorkspaceInfo(tab);
    assert.equal(info.id,   "unknown-uuid");
    assert.equal(info.name, "unknown-uuid");
  });

  test("returns default when gZenWorkspaces absent", () => {
    const tab = makeTab({});
    const mgr = makeManager();
    mgr.window.gZenWorkspaces = undefined;
    const tm = new TabManager(mgr);
    const info = tm.getWorkspaceInfo(tab);
    assert.equal(info.id, "default");
  });
});

// ── getTabState ───────────────────────────────────────────────────────────

describe("getTabState", () => {
  test("active tab includes 'active'", () => {
    const tab = makeTab({ selected: true });
    const tm = new TabManager(makeManager());
    assert.ok(tm.getTabState(tab).includes("active"));
  });

  test("pending tab includes 'pending'", () => {
    const tab = makeTab({ attrs: { pending: "" } });
    const tm = new TabManager(makeManager());
    assert.ok(tm.getTabState(tab).includes("pending"));
  });

  test("discarded tab includes 'discarded'", () => {
    const tab = makeTab({ attrs: { discarded: "" } });
    const tm = new TabManager(makeManager());
    assert.ok(tm.getTabState(tab).includes("discarded"));
  });

  test("muted tab includes 'muted'", () => {
    const tab = makeTab({ muted: true });
    const tm = new TabManager(makeManager());
    assert.ok(tm.getTabState(tab).includes("muted"));
  });

  test("idle tab returns ['loaded']", () => {
    const tab = makeTab({});
    const tm = new TabManager(makeManager());
    assert.deepEqual(tm.getTabState(tab), ["loaded"]);
  });
});

// ── getFolderPath ─────────────────────────────────────────────────────────

describe("getFolderPath", () => {
  test("returns null when tab has no group", () => {
    const tab = makeTab({ group: null });
    const tm = new TabManager(makeManager());
    assert.equal(tm.getFolderPath(tab), null);
  });

  test("returns null when group is not a Zen folder", () => {
    const tab = makeTab({ group: { isZenFolder: false, label: "not a folder" } });
    const tm = new TabManager(makeManager());
    assert.equal(tm.getFolderPath(tab), null);
  });

  test("returns single-level folder path", () => {
    const tab = makeTab({ group: { isZenFolder: true, label: "Work", group: null } });
    const tm = new TabManager(makeManager());
    assert.deepEqual(tm.getFolderPath(tab), ["Work"]);
  });

  test("returns nested folder path in order", () => {
    const tab = makeTab({
      group: {
        isZenFolder: true, label: "Projects",
        group: { isZenFolder: true, label: "Work", group: null }
      }
    });
    const tm = new TabManager(makeManager());
    assert.deepEqual(tm.getFolderPath(tab), ["Work", "Projects"]);
  });

  test("uses 'Unnamed Folder' when label is missing", () => {
    const tab = makeTab({ group: { isZenFolder: true, label: "", group: null } });
    const tm = new TabManager(makeManager());
    assert.deepEqual(tm.getFolderPath(tab), ["Unnamed Folder"]);
  });
});

// ── getTabsFiltered: state filter ─────────────────────────────────────────

describe("getTabsFiltered — state filter", () => {
  test("filter by state=active", async () => {
    const activeTab = makeTab({ url: "https://active.com", selected: true });
    const idleTab   = makeTab({ url: "https://idle.com" });
    const mgr = makeManager({ tabs: [activeTab, idleTab] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const results = await tm.getTabsFiltered({ state: "active" });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://active.com");
  });

  test("filter by state=discarded", async () => {
    const discarded = makeTab({ url: "https://disc.com", attrs: { discarded: "" } });
    const normal    = makeTab({ url: "https://norm.com" });
    const mgr = makeManager({ tabs: [discarded, normal] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const results = await tm.getTabsFiltered({ state: "discarded" });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://disc.com");
  });
});

// ── getTabsFiltered: folder filter ────────────────────────────────────────

describe("getTabsFiltered — folder filter", () => {
  test("filter by folder name", async () => {
    const folderTab = makeTab({ url: "https://in-folder.com", group: { isZenFolder: true, label: "Dev", group: null } });
    const plainTab  = makeTab({ url: "https://no-folder.com" });
    const mgr = makeManager({ tabs: [folderTab, plainTab] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const results = await tm.getTabsFiltered({ folder: "Dev" });
    assert.equal(results.length, 1);
    assert.equal(results[0].url, "https://in-folder.com");
  });
});

// ── getStatistics ─────────────────────────────────────────────────────────

describe("getStatistics", () => {
  test("counts tabs by type correctly", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const essential = makeTab({ url: "https://ess.com", attrs: { "zen-essential": "", "zen-workspace-id": ws.uuid } });
    const pinned    = makeTab({ url: "https://pin.com", pinned: true, attrs: { "zen-workspace-id": ws.uuid } });
    const normal    = makeTab({ url: "https://nor.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [essential, pinned, normal] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();

    const stats = await tm.getStatistics();
    assert.equal(stats.total, 3);
    assert.equal(stats.byType.essential, 1);
    assert.equal(stats.byType.pinned, 1);
    assert.equal(stats.byType.normal, 1);
  });

  test("counts tabs per space", async () => {
    const ws1 = makeWorkspace("Work",     "uuid-work");
    const ws2 = makeWorkspace("Personal", "uuid-personal");
    const t1 = makeTab({ url: "https://a.com", attrs: { "zen-workspace-id": ws1.uuid } });
    const t2 = makeTab({ url: "https://b.com", attrs: { "zen-workspace-id": ws2.uuid } });
    const mgr = makeManager({ workspaces: [ws1, ws2], tabs: [t1, t2] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();

    const stats = await tm.getStatistics();
    assert.equal(stats.spaces, 2);
    assert.equal(stats.bySpace["Work"].total, 1);
    assert.equal(stats.bySpace["Personal"].total, 1);
  });

  test("counts tabs in folders", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const inFolder = makeTab({ url: "https://a.com", attrs: { "zen-workspace-id": ws.uuid }, group: { isZenFolder: true, label: "Dev", group: null } });
    const noFolder = makeTab({ url: "https://b.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [inFolder, noFolder] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();

    const stats = await tm.getStatistics();
    assert.equal(stats.inFolders, 1);
    assert.equal(stats.folders, 1); // 1 unique folder name
  });
});

// ── Event handlers ────────────────────────────────────────────────────────

describe("Event handlers", () => {
  test("onTabCreated adds tab to cache", () => {
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    const tab = makeTab({ url: "https://new.com" });
    tm.onTabCreated(tab);
    assert.ok(tm.tabMetadataCache.has(tab));
  });

  test("onTabRemoved removes tab from cache", () => {
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    const tab = makeTab({ url: "https://gone.com" });
    tm.onTabCreated(tab);
    assert.ok(tm.tabMetadataCache.has(tab));
    tm.onTabRemoved(tab);
    assert.ok(!tm.tabMetadataCache.has(tab));
  });

  test("onTabUpdated refreshes cache entry", () => {
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    const tab = makeTab({ url: "https://updated.com" });
    tm.onTabCreated(tab);
    const before = tm.tabMetadataCache.get(tab);
    // Simulate URL change
    tab.linkedBrowser.currentURI.spec = "https://updated.com/new-path";
    tm.onTabUpdated(tab);
    const after = tm.tabMetadataCache.get(tab);
    assert.equal(after.url, "https://updated.com/new-path");
  });
});

// ── getTabAge ────────────────────────────────────────────────────────────

describe("getTabAge", () => {
  test("correctly computes days since last access", () => {
    const twoDaysAgo = Date.now() - 2 * 86400000;
    const tab = makeTab({ lastAccessed: twoDaysAgo });
    const mgr = makeManager();
    const tm = new TabManager(mgr);
    const age = tm.getTabAge(tab);
    assert.equal(age.lastAccessedAge.days, 2);
  });
});

// ── Metadata cache ────────────────────────────────────────────────────────

describe("Metadata cache", () => {
  test("rebuildCache populates cache entries", async () => {
    const tab = makeTab({ url: "https://cached.com" });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    assert.equal(tm.tabMetadataCache.size, 1);
  });

  test("getAllTabs uses cache and does not rebuild", async () => {
    const tab = makeTab({ url: "https://cached.com" });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    await tm.rebuildCache();
    const result = await tm.getAllTabs();
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://cached.com");
  });
});

// ── URL extraction (_extractTabUrl) ───────────────────────────────────────

describe("URL extraction (_extractTabUrl)", () => {
  test("returns currentURI when available", () => {
    const tab = makeTab({ url: "https://example.com" });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://example.com");
  });

  test("falls back to userTypedValue when currentURI is about:blank", () => {
    const tab = makeTab({ url: "about:blank" });
    tab.linkedBrowser.userTypedValue = "https://pending.com";
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://pending.com");
  });

  test("falls back to SessionStore when currentURI is about:blank and no userTypedValue", () => {
    const tab = makeTab({ url: "about:blank" });
    const mgr = makeManager({ tabs: [tab] });
    mgr.window.SessionStore = {
      getTabState: () => JSON.stringify({
        entries: [{ url: "https://restored.com" }]
      })
    };
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://restored.com");
  });

  test("returns about:blank when no fallback available", () => {
    const tab = makeTab({ url: "about:blank" });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "about:blank");
  });

  // ── Pinned tab: canonical URL via _zenPinnedInitialState ─────────────────

  test("pinned tab: returns _zenPinnedInitialState.entry.url over currentURI (SSO redirect scenario)", () => {
    const tab = makeTab({
      pinned: true,
      url: "https://login.microsoft.com/redirect?to=teams",
      _zenPinnedInitialState: { entry: { url: "https://teams.microsoft.com" }, image: null },
    });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://teams.microsoft.com");
  });

  test("pinned tab: falls back to currentURI when _zenPinnedInitialState is absent", () => {
    const tab = makeTab({ pinned: true, url: "https://teams.microsoft.com" });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://teams.microsoft.com");
  });

  test("pinned tab: falls back to currentURI when _zenPinnedInitialState has no entry", () => {
    const tab = makeTab({
      pinned: true,
      url: "https://teams.microsoft.com",
      _zenPinnedInitialState: { entry: null, image: null },
    });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://teams.microsoft.com");
  });

  test("essential tab: also returns _zenPinnedInitialState.entry.url (essential tabs are pinned)", () => {
    // In Zen, addToEssentials() calls gBrowser.pinTab(), so tab.pinned is always true
    // for essential tabs. ZenWindowSync.on_TabPinned fires and sets _zenPinnedInitialState,
    // so essential tabs benefit from the same canonical-URL protection as pinned tabs.
    const tab = makeTab({
      pinned: true,
      attrs: { "zen-essential": "" },
      url: "https://redirected.com",
      _zenPinnedInitialState: { entry: { url: "https://original-essential.com" }, image: null },
    });
    const mgr = makeManager({ tabs: [tab] });
    const tm = new TabManager(mgr);
    assert.equal(tm._extractTabUrl(tab), "https://original-essential.com");
  });
});
