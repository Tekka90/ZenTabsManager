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
    // Mutate the mock tab after cache build to confirm cache is used
    tab.linkedBrowser.currentURI.spec = "https://mutated.com";
    const tabs = await tm.getAllTabs();
    // Still shows original cached URL
    assert.equal(tabs[0].url, "https://cached.com");
  });
});
