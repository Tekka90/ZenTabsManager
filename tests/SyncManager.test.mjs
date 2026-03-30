/**
 * SyncManager unit tests
 *
 * Tests the manifest-based 3-way sync logic using in-memory mocks.
 * Run with: node --test tests/SyncManager.test.mjs
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeManager, makeTab } from "./helpers/mocks.mjs";
import { SyncManager } from "../content/SyncManager.mjs";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeWorkspace(name, uuid = `uuid-${name}`) {
  return { uuid, name, icon: null, theme: {}, containerTabId: 0 };
}

/**
 * Seed a "Zen/<spaceName>/<subFolder>" bookmark and return its guid.
 */
async function seedBookmark(PlacesUtils, spaceName, url, title = url, subFolder = null) {
  const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
  const zenFolder = await PlacesUtils.bookmarks.insert({
    parentGuid: toolbarGuid, type: "folder", title: "Zen"
  });
  const spaceFolder = await PlacesUtils.bookmarks.insert({
    parentGuid: zenFolder.guid, type: "folder", title: spaceName
  });
  let parentGuid = spaceFolder.guid;
  if (subFolder) {
    const sf = await PlacesUtils.bookmarks.insert({
      parentGuid, type: "folder", title: subFolder
    });
    parentGuid = sf.guid;
  }
  const bm = await PlacesUtils.bookmarks.insert({
    parentGuid, type: "bookmark", title, url
  });
  return { bmGuid: bm.guid, spaceFolderGuid: spaceFolder.guid, zenFolderGuid: zenFolder.guid };
}

// ── Manifest persistence ────────────────────────────────────────────────────

describe("Manifest persistence", () => {
  test("loadManifest returns empty map when no prefs stored", () => {
    const mgr = makeManager();
    const sync = new SyncManager(mgr);
    const m = sync.loadManifest();
    assert.equal(m.size, 0);
  });

  test("saveManifest then loadManifest round-trips correctly", () => {
    const mgr = makeManager();
    const sync = new SyncManager(mgr);

    const manifest = new Map([
      ["uuid-A", new Set(["https://a.com", "https://b.com"])],
      ["uuid-B", new Set(["https://c.com"])],
    ]);
    sync.saveManifest(manifest);

    const loaded = sync.loadManifest();
    assert.equal(loaded.size, 2);
    assert.ok(loaded.get("uuid-A").has("https://a.com"));
    assert.ok(loaded.get("uuid-A").has("https://b.com"));
    assert.ok(loaded.get("uuid-B").has("https://c.com"));
  });

  test("loadManifest survives corrupted prefs gracefully", () => {
    const mgr = makeManager({ prefStore: { "zentabs.": { syncManifest: "not-json{{" } } });
    const sync = new SyncManager(mgr);
    const m = sync.loadManifest();
    assert.equal(m.size, 0);
  });
});

// ── syncBidirectional: bootstrap (empty manifest) ─────────────────────────

describe("syncBidirectional — first install (empty manifest)", () => {
  test("local essential tabs get pushed to bookmarks", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://example.com", title: "Example",
      attrs: { "zen-workspace-id": ws.uuid, "zen-essential": "" } });

    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    mgr.tabManager = {
      getAllTabs: async () => [{
        url: "https://example.com", title: "Example",
        type: "essential", workspace: { id: ws.uuid, name: ws.name },
        tab,
      }]
    };

    const sync = new SyncManager(mgr);
    const result = await sync.syncBidirectional();

    assert.equal(result.bookmarksCreated, 1);
    assert.equal(result.tabsOpened, 0);

    // Bookmark should be in the store
    const bms = await mgr.window.PlacesUtils.bookmarks.search({ url: "https://example.com" });
    assert.equal(bms.length, 1);
  });

  test("bookmarks from another computer open as tabs", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    // Seed a bookmark (simulating Firefox Sync delivering it)
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://remote.example.com");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const result = await sync.syncBidirectional();

    assert.equal(result.tabsOpened, 1);
    assert.equal(result.bookmarksCreated, 0);

    // A new tab should have been opened
    assert.equal(mgr.window.gBrowser.tabs.length, 1);
    assert.equal(mgr.window.gBrowser.tabs[0].linkedBrowser.currentURI.spec, "https://remote.example.com");
  });

  test("normal tabs are never pushed to bookmarks", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://normal.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://normal.com", title: "Normal", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncBidirectional();

    assert.equal(r.bookmarksCreated, 0);
    const bms = await mgr.window.PlacesUtils.bookmarks.search({ url: "https://normal.com" });
    assert.equal(bms.length, 0);
  });

  test("normal tabs are not tracked in the manifest", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://normal.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://normal.com", title: "Normal", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    await sync.syncBidirectional();

    const m = sync.loadManifest();
    const urls = m.get(ws.uuid);
    assert.ok(!urls?.has("https://normal.com"), "normal URL must not be in manifest");
  });

  test("normal tab already in bookmarks — not re-opened, not deleted", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://shared.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenF   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenF.guid,   type: "folder", title: ws.name });
    const normF  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Normal" });
    await PlacesUtils.bookmarks.insert({ parentGuid: normF.guid, type: "bookmark", title: "Shared", url: "https://shared.com" });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://shared.com", title: "Shared", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncBidirectional();

    // Normal tab: not pushed to bookmarks (already there from before, but no new creation)
    assert.equal(r.bookmarksCreated, 0);
    // Already open, so not opened again
    assert.equal(r.tabsOpened, 0);
    assert.equal(mgr.window.gBrowser._removed.length, 0);
  });
});

// ── syncBidirectional: subsequent syncs ───────────────────────────────────

describe("syncBidirectional — subsequent syncs (non-empty manifest)", () => {
  test("URL closed locally → bookmark deleted", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    // Seed bookmark for a URL that was previously synced (now closed locally)
    const { bmGuid } = await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://closed-locally.com");

    // Manifest records it was agreed on last time
    const sync = new SyncManager(mgr);
    sync.saveManifest(new Map([[ws.uuid, new Set(["https://closed-locally.com"])]]));

    mgr.tabManager = { getAllTabs: async () => [] };

    const r = await sync.syncBidirectional();

    assert.equal(r.bookmarksDeleted, 1);
    // Bookmark must be gone
    const bms = await mgr.window.PlacesUtils.bookmarks.search({ url: "https://closed-locally.com" });
    assert.equal(bms.length, 0);
  });

  test("URL removed from bookmarks → tab closed (when syncCloseRemovedTabs=true)", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://remote-deleted.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({
      workspaces: [ws], tabs: [tab],
      preferences: { syncCloseRemovedTabs: true },
    });
    // No bookmark for this URL (deleted on another computer)

    const sync = new SyncManager(mgr);
    sync.saveManifest(new Map([[ws.uuid, new Set(["https://remote-deleted.com"])]]));

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://remote-deleted.com", title: "t", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const r = await sync.syncBidirectional();

    assert.equal(r.tabsClosed, 1);
    assert.equal(mgr.window.gBrowser._removed.length, 1);
  });

  test("essential tab is never auto-closed even when syncCloseRemovedTabs=true", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://essential.com", attrs: { "zen-workspace-id": ws.uuid, "zen-essential": "" } });
    const mgr = makeManager({
      workspaces: [ws], tabs: [tab],
      preferences: { syncCloseRemovedTabs: true },
    });

    const sync = new SyncManager(mgr);
    sync.saveManifest(new Map([[ws.uuid, new Set(["https://essential.com"])]]));

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://essential.com", title: "E", type: "essential",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const r = await sync.syncBidirectional();

    assert.equal(r.tabsClosed, 0);
    assert.equal(mgr.window.gBrowser._removed.length, 0);
  });

  test("syncCloseRemovedTabs=false does not close tabs", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://keep-tab.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({
      workspaces: [ws], tabs: [tab],
      preferences: { syncCloseRemovedTabs: false },
    });

    const sync = new SyncManager(mgr);
    sync.saveManifest(new Map([[ws.uuid, new Set(["https://keep-tab.com"])]]));

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://keep-tab.com", title: "t", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const r = await sync.syncBidirectional();

    assert.equal(r.tabsClosed, 0);
  });

  test("manifest is updated correctly after sync", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const tab = makeTab({ url: "https://new-local.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    // Seed an existing bookmark from another computer
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://remote.com");

    const sync = new SyncManager(mgr);
    // Start with empty manifest

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://new-local.com", title: "L", type: "pinned",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    await sync.syncBidirectional();

    // New manifest should include both URLs
    const m = sync.loadManifest();
    const urls = m.get(ws.uuid);
    assert.ok(urls?.has("https://new-local.com"), "local URL in manifest");
    assert.ok(urls?.has("https://remote.com"),    "remote URL in manifest");
  });
});

// ── syncToBookmarks (tabs-are-authority) ──────────────────────────────────

describe("syncToBookmarks — tabs are authority", () => {
  test("orphan bookmarks are deleted", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    // Seed orphan
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://orphan.com");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncToBookmarks();

    assert.equal(r.bookmarksDeleted, 1);
    const bms = await mgr.window.PlacesUtils.bookmarks.search({ url: "https://orphan.com" });
    assert.equal(bms.length, 0);
  });

  test("open tabs create bookmarks", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://open.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://open.com", title: "Open", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncToBookmarks({ includeNormal: true });

    assert.equal(r.bookmarksCreated, 1);
    const bms = await mgr.window.PlacesUtils.bookmarks.search({ url: "https://open.com" });
    assert.equal(bms.length, 1);
  });

  test("about: URLs are skipped", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "about:newtab", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "about:newtab", title: "New Tab", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncToBookmarks({ includeNormal: true });

    assert.equal(r.bookmarksCreated, 0);
    assert.equal(r.skipped, 1);
  });
});

// ── syncFromBookmarks ─────────────────────────────────────────────────────

describe("syncFromBookmarks — bookmarks are authority", () => {
  test("missing tabs are opened from bookmarks", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://bookmarked.com");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.tabsCreated, 1);
    assert.equal(mgr.window.gBrowser.tabs.length, 1);
  });

  test("already-open tabs are not duplicated", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://already-open.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://already-open.com");

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://already-open.com", title: "t", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.tabsCreated, 0);
    assert.equal(r.tabsExisting, 1);
    // Still only one tab
    assert.equal(mgr.window.gBrowser.tabs.length, 1);
  });

  test("opened tabs are assigned the correct workspace UUID", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://work-site.com");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const newTab = mgr.window.gBrowser.tabs[0];
    assert.equal(newTab.getAttribute("zen-workspace-id"), ws.uuid);
  });
});

// ── getOrCreateFolder ─────────────────────────────────────────────────────

describe("getOrCreateFolder", () => {
  test("creates a new folder on first call", async () => {
    const mgr = makeManager();
    const sync = new SyncManager(mgr);
    const toolbarGuid = mgr.window.PlacesUtils.bookmarks.toolbarGuid;
    const guid = await sync.getOrCreateFolder(toolbarGuid, "Zen");
    assert.ok(guid, "should return a guid");
  });

  test("is idempotent — returns same guid on second call", async () => {
    const mgr = makeManager();
    const sync = new SyncManager(mgr);
    const toolbarGuid = mgr.window.PlacesUtils.bookmarks.toolbarGuid;
    const guid1 = await sync.getOrCreateFolder(toolbarGuid, "Zen");
    const guid2 = await sync.getOrCreateFolder(toolbarGuid, "Zen");
    assert.equal(guid1, guid2);
  });
});

// ── findTabByUrl ──────────────────────────────────────────────────────────

describe("findTabByUrl", () => {
  test("finds an open tab by URL", () => {
    const tab = makeTab({ url: "https://find-me.com" });
    const mgr = makeManager({ tabs: [tab] });
    const sync = new SyncManager(mgr);
    const found = sync.findTabByUrl("https://find-me.com");
    assert.strictEqual(found, tab);
  });

  test("returns null for unknown URL", () => {
    const mgr = makeManager({ tabs: [] });
    const sync = new SyncManager(mgr);
    assert.equal(sync.findTabByUrl("https://not-open.com"), null);
  });

  test("ignores zen-empty-tab", () => {
    const emptyTab = makeTab({ url: "https://ghost.com", attrs: { "zen-empty-tab": "" } });
    const mgr = makeManager({ tabs: [emptyTab] });
    const sync = new SyncManager(mgr);
    assert.equal(sync.findTabByUrl("https://ghost.com"), null);
  });
});
