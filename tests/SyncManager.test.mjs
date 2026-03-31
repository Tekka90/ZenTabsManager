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
      ["uuid-A", [
        { url: "https://a.com", guid: "g-a", folder: "", type: "pinned" },
        { url: "https://b.com", guid: "g-b", folder: "Essentials", type: "essential" },
      ]],
      ["uuid-B", [
        { url: "https://c.com", guid: "g-c", folder: "", type: "pinned" },
      ]],
    ]);
    sync.saveManifest(manifest);

    const loaded = sync.loadManifest();
    assert.equal(loaded.size, 2);
    assert.equal(loaded.get("uuid-A").length, 2);
    assert.equal(loaded.get("uuid-A")[0].url, "https://a.com");
    assert.equal(loaded.get("uuid-A")[0].guid, "g-a");
    assert.equal(loaded.get("uuid-A")[1].url, "https://b.com");
    assert.equal(loaded.get("uuid-B").length, 1);
    assert.equal(loaded.get("uuid-B")[0].url, "https://c.com");
  });

  test("legacy v1 manifest (URL arrays) is treated as empty", () => {
    const mgr = makeManager({
      prefStore: { "zentabs.": { syncManifest: JSON.stringify({ "uuid-old": ["https://old.com"] }) } }
    });
    const sync = new SyncManager(mgr);
    const m = sync.loadManifest();
    assert.equal(m.size, 0, "legacy v1 format should be discarded");
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

  test("bookmarks from another computer open as tabs with correct type", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    // Seed a bookmark directly in the space root (simulating Firefox Sync delivering it)
    // Space root = pinned tab
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://remote.example.com");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const result = await sync.syncBidirectional();

    assert.equal(result.tabsOpened, 1);
    assert.equal(result.bookmarksCreated, 0);

    // A new tab should have been opened
    assert.equal(mgr.window.gBrowser.tabs.length, 1);
    const tab = mgr.window.gBrowser.tabs[0];
    assert.equal(tab.linkedBrowser.currentURI.spec, "https://remote.example.com");
    // Bookmark is in space root → tab should be pinned
    assert.equal(tab.pinned, true, "tab from space root bookmark should be pinned");
  });

  test("remote bookmark in Essentials/ folder opens as essential tab", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential-remote.com", "Essential Remote", "Essentials");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const result = await sync.syncBidirectional();

    assert.equal(result.tabsOpened, 1);
    const tab = mgr.window.gBrowser.tabs[0];
    assert.ok(tab.hasAttribute("zen-essential"), "tab from Essentials/ should have zen-essential attribute");
    assert.equal(tab.pinned, true, "essential tabs are pinned in Zen");
  });

  test("remote bookmark in Temporary tabs/ folder opens as normal tab", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://normal-remote.com", "Normal Remote", "Temporary tabs");

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const result = await sync.syncBidirectional();

    assert.equal(result.tabsOpened, 1);
    const tab = mgr.window.gBrowser.tabs[0];
    assert.ok(!tab.hasAttribute("zen-essential"), "tab from Temporary tabs/ should not be essential");
    assert.equal(tab.pinned, false, "tab from Temporary tabs/ should not be pinned");
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
    const entries = m.get(ws.uuid) ?? [];
    const normalUrls = entries.filter(e => e.url === "https://normal.com");
    assert.equal(normalUrls.length, 0, "normal URL must not be in manifest");
  });

  test("normal tab already in bookmarks — not re-opened, not deleted", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const tab = makeTab({ url: "https://shared.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenF   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenF.guid,   type: "folder", title: ws.name });
    const normF  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Temporary tabs" });
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

    // Manifest records it was agreed on last time (v2 format with GUID)
    const sync = new SyncManager(mgr);
    sync.saveManifest(new Map([[ws.uuid, [
      { url: "https://closed-locally.com", guid: bmGuid, folder: "", type: "pinned" }
    ]]]));

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
    sync.saveManifest(new Map([[ws.uuid, [
      { url: "https://remote-deleted.com", guid: "guid-deleted-remote", folder: "", type: "normal" }
    ]]]));

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
    sync.saveManifest(new Map([[ws.uuid, [
      { url: "https://essential.com", guid: "guid-deleted-essential", folder: "Essentials", type: "essential" }
    ]]]));

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
    sync.saveManifest(new Map([[ws.uuid, [
      { url: "https://keep-tab.com", guid: "guid-deleted-keep", folder: "", type: "normal" }
    ]]]));

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://keep-tab.com", title: "t", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const r = await sync.syncBidirectional();

    assert.equal(r.tabsClosed, 0);
  });

  test("manifest is updated correctly after sync", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    const tab = makeTab({ url: "https://new-local.com", pinned: true, attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    // Seed an existing bookmark from another computer
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://remote.com");

    const sync = new SyncManager(mgr);
    // Start with empty manifest

    // Dynamic getAllTabs that reflects gBrowser.tabs (including tabs opened
    // during sync) so that the manifest step sees newly opened tabs.
    mgr.tabManager = { getAllTabs: async () =>
      mgr.window.gBrowser.tabs
        .filter(t => !t.hasAttribute("zen-empty-tab"))
        .map(t => ({
          url: t.linkedBrowser.currentURI.spec,
          title: t.label || "Untitled",
          type: t.hasAttribute("zen-essential") ? "essential" : t.pinned ? "pinned" : "normal",
          workspace: { id: t.getAttribute("zen-workspace-id") ?? ws.uuid, name: ws.name },
          tab: t,
        }))
    };

    // First call with empty manifest + existing tabs + bookmarks → bootstraps.
    // URLs don't match, so no pairs, but manifest gets initialized (empty
    // arrays) to prevent re-bootstrapping.
    const r1 = await sync.syncBidirectional();
    assert.ok(r1.bootstrapped, "first call should bootstrap");
    assert.equal(r1.tabsOpened, 0, "bootstrap should not open tabs");

    const m1 = sync.loadManifest();
    assert.ok(m1.size > 0, "manifest should be initialized after bootstrap");
    const entries1 = m1.get(ws.uuid);
    assert.ok(Array.isArray(entries1), "manifest entries should be an array");
    assert.equal(entries1.length, 0, "no matching pairs during bootstrap");

    // Second call uses the populated manifest — NOW it will open tabs for
    // unmatched bookmarks and push unmatched tabs to bookmarks.
    const r2 = await sync.syncBidirectional();
    assert.ok(!r2.bootstrapped, "second call should not bootstrap");

    const m2 = sync.loadManifest();
    const entries2 = m2.get(ws.uuid);
    assert.ok(Array.isArray(entries2), "manifest entries should be an array after second sync");
    const urls = entries2.map(e => e.url);
    assert.ok(urls.includes("https://new-local.com"), "local URL in manifest");
    assert.ok(urls.includes("https://remote.com"),    "remote URL in manifest");
    for (const entry of entries2) {
      assert.ok(entry.guid, "entry should have a guid");
      assert.ok("folder" in entry, "entry should have a folder field");
      assert.ok(entry.type, "entry should have a type");
    }
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
      url: "https://already-open.com", title: "t", type: "pinned",
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

  test("active workspace is restored after sync completes", async () => {
    const ws1 = makeWorkspace("Work",     "uuid-work");
    const ws2 = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws1, ws2], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws2.name, "https://example.com");
    mgr.tabManager = { getAllTabs: async () => [] };

    // Active workspace starts as ws1 (first in list)
    assert.equal(mgr.window.gZenWorkspaces.activeWorkspace, ws1.uuid);

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    // Should be restored to ws1, not left on ws2
    assert.equal(mgr.window.gZenWorkspaces.activeWorkspace, ws1.uuid);
  });

  test("Essentials subfolder → tab gets zen-essential attribute", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential.com", "Essential", "Essentials");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.tabsCreated, 1);
    const tab = mgr.window.gBrowser.tabs[0];
    assert.ok(tab.hasAttribute("zen-essential"), "tab should have zen-essential attribute");
    assert.equal(tab.pinned, true, "essential tabs are pinned in Zen");
    assert.equal(tab.getAttribute("zen-workspace-id"), ws.uuid, "essential tabs keep workspace-id for per-space scoping");
  });

  test("Essentials subfolder → tab gets usercontextid from space containerTabId", async () => {
    const ws = { ...makeWorkspace("Personal", "uuid-personal"), containerTabId: 5 };
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential.com", "Essential", "Essentials");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const tab = mgr.window.gBrowser.tabs[0];
    assert.equal(tab.getAttribute("usercontextid"), "5", "essential tab should carry space containerTabId as userContextId");
  });

  test("Essentials subfolder → workspace with containerTabId 0 gets a container created", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal"); // containerTabId: 0
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential.com", "Essential", "Essentials");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    // The workspace should now have a non-zero containerTabId
    assert.ok(ws.containerTabId > 0, "workspace should have been assigned a container");
    const tab = mgr.window.gBrowser.tabs[0];
    assert.ok(tab.hasAttribute("usercontextid"), "essential tab should carry the new container id");
    assert.equal(tab.getAttribute("usercontextid"), String(ws.containerTabId),
      "essential tab's usercontextid should match workspace's containerTabId");
  });

  test("bookmark in space root → tab is pinned", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    // No subFolder → lands directly in the space root
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://pinned.com");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const tab = mgr.window.gBrowser.tabs[0];
    assert.equal(tab.pinned, true, "tab should be pinned");
    assert.ok(!tab.hasAttribute("zen-essential"));
  });

  test("named Zen folder bookmark → gZenFolders.createFolder called with correct label and tabs pinned", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://foldered.com", "Foldered", "My Projects");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 1, "one folder should be created");
    assert.equal(folders[0].label, "My Projects");
    assert.equal(folders[0].workspaceId, ws.uuid);
    assert.equal(folders[0].tabs.length, 1);
    assert.equal(folders[0].tabs[0].pinned, true, "createFolder pins its tabs");
  });

  test("nested bookmark subfolders → intermediate empty folder becomes container, leaf folder is nested inside it", async () => {
    // Structure: Zen/Personal/Work/React/{react.com, vue.com}
    // Expected:  container folder "Work" (no tabs) containing nested folder "React" with two tabs
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid,      type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid,   type: "folder", title: "Personal" });
    const workFolder  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "folder", title: "Work" });
    const reactFolder = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid,  type: "folder", title: "React" });
    await PlacesUtils.bookmarks.insert({ parentGuid: reactFolder.guid, type: "bookmark", title: "React", url: "https://react.com" });
    await PlacesUtils.bookmarks.insert({ parentGuid: reactFolder.guid, type: "bookmark", title: "Vue",   url: "https://vue.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 2, "two Zen folders: container 'Work' + nested 'React'");
    const workF  = folders.find(f => f.label === "Work");
    const reactF = folders.find(f => f.label === "React");
    assert.ok(workF,  "Work container folder exists");
    assert.ok(reactF, "React folder exists");
    assert.equal(workF.tabs.length, 0, "Work is an empty container");
    assert.equal(workF.parentFolder, null, "Work is at root (no parent)");
    assert.strictEqual(reactF.parentFolder, workF, "React is nested inside Work");
    assert.equal(reactF.tabs.length, 2, "both bookmarks present in React");
    const tabUrls = reactF.tabs.map(t => t.linkedBrowser.currentURI.spec);
    assert.ok(tabUrls.includes("https://react.com"), "React URL present");
    assert.ok(tabUrls.includes("https://vue.com"),   "Vue URL present");
  });

  test("multiple nested subfolders → each nested under common parent", async () => {
    // Structure: Zen/Personal/Work/React/{url1}  and  Zen/Personal/Work/Vue/{url2}
    // Expected:  container "Work" with two nested folders: "React" and "Vue"
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid,      type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid,   type: "folder", title: "Personal" });
    const workFolder  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "folder", title: "Work" });
    const reactFolder = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid,  type: "folder", title: "React" });
    await PlacesUtils.bookmarks.insert({ parentGuid: reactFolder.guid, type: "bookmark", title: "React", url: "https://react.com" });
    const vueFolder   = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid,  type: "folder", title: "Vue" });
    await PlacesUtils.bookmarks.insert({ parentGuid: vueFolder.guid,   type: "bookmark", title: "Vue",   url: "https://vue.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 3, "three Zen folders: container 'Work' + 'React' + 'Vue'");
    const workF  = folders.find(f => f.label === "Work");
    const reactF = folders.find(f => f.label === "React");
    const vueF   = folders.find(f => f.label === "Vue");
    assert.ok(workF, "Work container exists");
    assert.equal(workF.parentFolder, null, "Work is at root");
    assert.strictEqual(reactF.parentFolder, workF, "React nested inside Work");
    assert.strictEqual(vueF.parentFolder, workF, "Vue nested inside Work");
  });

  test("fresh install — no spaces — creates the space and opens tabs", async () => {
    // No workspaces configured at all (e.g. first boot after restoring bookmarks)
    const mgr = makeManager({ workspaces: [], tabs: [] });

    // Seed bookmarks manually under one Zen/Personal folder
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder  = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Personal" });
    await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "bookmark", title: "Example", url: "https://example.com" });

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.spacesCreated, 1, "should have created the missing space");
    assert.equal(r.tabsCreated, 1,   "should have opened the bookmarked tab");
    assert.equal(mgr.window.gBrowser.tabs.length, 1);

    // The created space should have the right name
    const spaces = mgr.window.gZenWorkspaces.getWorkspaces();
    assert.equal(spaces.length, 1);
    assert.equal(spaces[0].name, "Personal");

    // The tab should be assigned to the new space
    const newTab = mgr.window.gBrowser.tabs[0];
    assert.equal(newTab.getAttribute("zen-workspace-id"), spaces[0].uuid);
  });

  test("fresh install — multiple space folders — creates all spaces and opens all tabs", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });

    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder  = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const workFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Work" });
    await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid, type: "bookmark", title: "Work", url: "https://work.com" });
    const persFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Personal" });
    await PlacesUtils.bookmarks.insert({ parentGuid: persFolder.guid, type: "bookmark", title: "Personal", url: "https://personal.com" });

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.spacesCreated, 2, "should have created 2 spaces");
    assert.equal(r.tabsCreated, 2,   "should have opened 2 tabs");
    assert.equal(mgr.window.gZenWorkspaces.getWorkspaces().length, 2);
  });

  test("folder with direct bookmarks AND subfolders → subfolder nested inside parent", async () => {
    // Structure: Zen/Personal/Work/{url1, React/{url2, url3}}
    // Expected:  "Work" folder with [url1], "React" nested inside "Work" with [url2, url3]
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid,      type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid,   type: "folder", title: "Personal" });
    const workFolder  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "folder", title: "Work" });
    await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid,  type: "bookmark", title: "Work",  url: "https://work.com" });
    const reactFolder = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid,  type: "folder", title: "React" });
    await PlacesUtils.bookmarks.insert({ parentGuid: reactFolder.guid, type: "bookmark", title: "React", url: "https://react.com" });
    await PlacesUtils.bookmarks.insert({ parentGuid: reactFolder.guid, type: "bookmark", title: "Vue",   url: "https://vue.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 2, "two Zen folders: 'Work' + nested 'React'");
    const workF  = folders.find(f => f.label === "Work");
    const reactF = folders.find(f => f.label === "React");
    assert.ok(workF,  "Work folder exists");
    assert.ok(reactF, "React folder exists");
    assert.equal(workF.tabs.length, 1, "Work has one direct tab");
    assert.equal(workF.tabs[0].linkedBrowser.currentURI.spec, "https://work.com");
    assert.equal(workF.parentFolder, null, "Work is at root");
    assert.strictEqual(reactF.parentFolder, workF, "React is nested inside Work");
    assert.equal(reactF.tabs.length, 2, "React has two tabs");
  });

  test("deeply nested bookmark hierarchy → three-level nesting", async () => {
    // Structure: Zen/Personal/A/{url1, B/{url2, C/{url3}}}
    // Expected: A[url1] → B[url2] → C[url3] with correct parent chain
    const ws = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid,      type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid,   type: "folder", title: "Personal" });
    const folderA     = await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "folder", title: "A" });
    await PlacesUtils.bookmarks.insert({ parentGuid: folderA.guid, type: "bookmark", title: "a", url: "https://a.com" });
    const folderB     = await PlacesUtils.bookmarks.insert({ parentGuid: folderA.guid,     type: "folder", title: "B" });
    await PlacesUtils.bookmarks.insert({ parentGuid: folderB.guid, type: "bookmark", title: "b", url: "https://b.com" });
    const folderC     = await PlacesUtils.bookmarks.insert({ parentGuid: folderB.guid,     type: "folder", title: "C" });
    await PlacesUtils.bookmarks.insert({ parentGuid: folderC.guid, type: "bookmark", title: "c", url: "https://c.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 3, "three nested Zen folders");
    const fA = folders.find(f => f.label === "A");
    const fB = folders.find(f => f.label === "B");
    const fC = folders.find(f => f.label === "C");
    assert.equal(fA.parentFolder, null, "A is at root");
    assert.strictEqual(fB.parentFolder, fA, "B nested inside A");
    assert.strictEqual(fC.parentFolder, fB, "C nested inside B");
  });

  test("same URL in Essentials and Temporary tabs — normal tab does NOT match essential bookmark", async () => {
    const ws = makeWorkspace("Personal", "uuid-personal");
    // One normal tab with example.com already open
    const tab = makeTab({ url: "https://example.com", attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenF   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenF.guid,   type: "folder", title: ws.name });
    const essF   = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Essentials" });
    const tmpF   = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Temporary tabs" });
    await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: "E", url: "https://example.com" });
    await PlacesUtils.bookmarks.insert({ parentGuid: tmpF.guid, type: "bookmark", title: "T", url: "https://example.com" });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://example.com", title: "t", type: "normal",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    // The normal tab should match the Temporary tabs bookmark,
    // and a new essential tab should be created for the Essentials bookmark.
    assert.equal(r.tabsExisting, 1, "normal tab matches Temporary tabs bookmark");
    assert.equal(r.tabsCreated, 1, "new essential tab created for Essentials bookmark");
    // Verify the new tab is essential (pinned + zen-essential)
    const newTab = mgr.window.gBrowser.tabs.find(t => t !== tab);
    assert.ok(newTab, "a new tab was added");
    assert.ok(newTab.hasAttribute("zen-essential"), "new tab is essential");
    assert.equal(newTab.pinned, true, "new essential tab is pinned");
  });

  test("same URL in space root and Essentials — pinned tab matches root, new essential created", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    // One pinned tab already open
    const tab = makeTab({ url: "https://example.com", pinned: true, attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenF   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenF.guid,   type: "folder", title: ws.name });
    const essF   = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Essentials" });
    // Direct bookmark in space root = pinned
    await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "bookmark", title: "R", url: "https://example.com" });
    // Bookmark in Essentials = essential
    await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: "E", url: "https://example.com" });

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://example.com", title: "t", type: "pinned",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.tabsExisting, 1, "pinned tab matches space-root bookmark");
    assert.equal(r.tabsCreated, 1, "new essential tab created");
    const newTab = mgr.window.gBrowser.tabs.find(t => t !== tab);
    assert.ok(newTab.hasAttribute("zen-essential"), "new tab is essential");
  });

  test("same URL in two different named folders — tab in Projects does NOT match Research bookmark", async () => {
    const ws = makeWorkspace("Work", "uuid-work");
    // One pinned tab in "Projects" folder
    const tab = makeTab({ url: "https://example.com", pinned: true, attrs: { "zen-workspace-id": ws.uuid } });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenF   = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenF.guid,   type: "folder", title: ws.name });
    const projF  = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Projects" });
    const resF   = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Research" });
    await PlacesUtils.bookmarks.insert({ parentGuid: projF.guid, type: "bookmark", title: "P", url: "https://example.com" });
    await PlacesUtils.bookmarks.insert({ parentGuid: resF.guid,  type: "bookmark", title: "R", url: "https://example.com" });

    // Tab reports folderPath: ["Projects"] → _subfolderNameForTab returns "Projects"
    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://example.com", title: "t", type: "pinned",
      folderPath: ["Projects"],
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    // The Projects tab matches the Projects bookmark (same folder)
    assert.equal(r.tabsExisting, 1, "Projects tab matches Projects bookmark");
    // Research bookmark has no matching tab → new tab created
    assert.equal(r.tabsCreated, 1, "new tab created for Research bookmark");
  });
});

// ── Essential tab container scoping ───────────────────────────────────────

describe("Essential tab container scoping", () => {
  test("syncFromBookmarks: fresh profile with 2 workspaces → each gets unique container for essentials", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });

    // Work: 1 essential
    const workFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Work" });
    const workEssF   = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid, type: "folder", title: "Essentials" });
    await PlacesUtils.bookmarks.insert({ parentGuid: workEssF.guid, type: "bookmark", title: "Gmail", url: "https://mail.google.com" });

    // Personal: 3 essentials
    const persFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Personal" });
    const persEssF   = await PlacesUtils.bookmarks.insert({ parentGuid: persFolder.guid, type: "folder", title: "Essentials" });
    await PlacesUtils.bookmarks.insert({ parentGuid: persEssF.guid, type: "bookmark", title: "Proton", url: "https://proton.me" });
    await PlacesUtils.bookmarks.insert({ parentGuid: persEssF.guid, type: "bookmark", title: "WhatsApp", url: "https://whatsapp.com" });
    await PlacesUtils.bookmarks.insert({ parentGuid: persEssF.guid, type: "bookmark", title: "Signal", url: "https://signal.org" });

    // Hobby: no essentials (only pinned)
    const hobbyFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Hobby" });
    await PlacesUtils.bookmarks.insert({ parentGuid: hobbyFolder.guid, type: "bookmark", title: "Reddit", url: "https://reddit.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    assert.equal(r.spacesCreated, 3, "3 spaces created");
    assert.equal(r.tabsCreated, 5, "5 tabs created (1+3+1)");

    const workspaces = mgr.window.gZenWorkspaces.getWorkspaces();
    const workWs  = workspaces.find(w => w.name === "Work");
    const persWs  = workspaces.find(w => w.name === "Personal");
    const hobbyWs = workspaces.find(w => w.name === "Hobby");

    // Work and Personal should have non-zero, different containerTabIds
    assert.ok(workWs.containerTabId > 0, "Work has a container");
    assert.ok(persWs.containerTabId > 0, "Personal has a container");
    assert.notEqual(workWs.containerTabId, persWs.containerTabId,
      "Work and Personal have different containers");

    // Hobby has no essentials → containerTabId stays 0
    assert.equal(hobbyWs.containerTabId, 0, "Hobby has no container (no essentials)");

    // Verify essential tabs carry the correct container id
    const workEssTabs = mgr.window.gBrowser.tabs.filter(
      t => t.getAttribute("zen-workspace-id") === workWs.uuid && t.hasAttribute("zen-essential")
    );
    const persEssTabs = mgr.window.gBrowser.tabs.filter(
      t => t.getAttribute("zen-workspace-id") === persWs.uuid && t.hasAttribute("zen-essential")
    );
    assert.equal(workEssTabs.length, 1, "1 essential in Work");
    assert.equal(persEssTabs.length, 3, "3 essentials in Personal");

    for (const tab of workEssTabs) {
      assert.equal(tab.getAttribute("usercontextid"), String(workWs.containerTabId),
        "Work essential tab has Work container id");
    }
    for (const tab of persEssTabs) {
      assert.equal(tab.getAttribute("usercontextid"), String(persWs.containerTabId),
        "Personal essential tab has Personal container id");
    }
  });

  test("syncFromBookmarks: existing workspace with non-zero containerTabId → container preserved", async () => {
    const ws = { ...makeWorkspace("Work", "uuid-work"), containerTabId: 42 };
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential.com", "Essential", "Essentials");
    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    assert.equal(ws.containerTabId, 42, "existing non-zero container should not be replaced");
    const tab = mgr.window.gBrowser.tabs[0];
    assert.equal(tab.getAttribute("usercontextid"), "42");
  });

  test("syncFromBookmarks: workspace without Essentials → no container created", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "PinnedOnly" });
    await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "bookmark", title: "Site", url: "https://site.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const ws = mgr.window.gZenWorkspaces.getWorkspaces().find(w => w.name === "PinnedOnly");
    assert.equal(ws.containerTabId, 0, "no container for workspace without essentials");
    // No containers created
    const cisIdentities = mgr.window.ContextualIdentityService._identities;
    assert.equal(cisIdentities.length, 0, "no containers created");
  });

  test("syncBidirectional: workspace with containerTabId 0 and essential bookmarks → container created", async () => {
    const ws = makeWorkspace("Work", "uuid-work"); // containerTabId: 0
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    // Seed an essential bookmark that appears as new remote (not in manifest)
    await seedBookmark(mgr.window.PlacesUtils, ws.name, "https://essential.com", "Essential", "Essentials");

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    // Empty manifest → bookmark is new from remote
    const r = await sync.syncBidirectional();

    assert.ok(ws.containerTabId > 0, "workspace should have been assigned a container");
    assert.equal(r.tabsOpened, 1);
    const tab = mgr.window.gBrowser.tabs[0];
    assert.ok(tab.hasAttribute("zen-essential"), "tab is essential");
    assert.equal(tab.getAttribute("usercontextid"), String(ws.containerTabId),
      "essential tab carries workspace container id");
  });
});

// ── Essentials folder — container name encoding ───────────────────────────

describe("Essentials folder — container name encoding", () => {
  test("syncToBookmarks names folder 'Essentials (<containerName>)' when workspace has a container", async () => {
    const ws = { ...makeWorkspace("Work", "uuid-work"), containerTabId: 5 };
    const mgr = makeManager({ workspaces: [ws], tabs: [] });
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 5, name: "Work Projects", icon: "briefcase", color: "blue" }
    );

    const tab = makeTab({
      url: "https://example.com", title: "Ex",
      attrs: { "zen-workspace-id": ws.uuid, "zen-essential": "" },
    });
    mgr.window.gBrowser.tabs.push(tab);

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://example.com", title: "Ex", type: "essential",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    await sync.syncToBookmarks();

    // The Essentials folder should be named "Essentials (Work Projects)"
    const allFolders = await mgr.window.PlacesUtils.bookmarks.search({ type: "folder" });
    const essFolder = allFolders.find(f => f.title.startsWith("Essentials"));
    assert.ok(essFolder, "Essentials folder exists");
    assert.equal(essFolder.title, "Essentials (Work Projects)",
      "folder title encodes container name");
  });

  test("syncToBookmarks: workspace without container → folder is plain 'Essentials'", async () => {
    const ws = makeWorkspace("Work", "uuid-work"); // containerTabId: 0
    const mgr = makeManager({ workspaces: [ws], tabs: [] });

    const tab = makeTab({
      url: "https://example.com", title: "Ex",
      attrs: { "zen-workspace-id": ws.uuid, "zen-essential": "" },
    });
    mgr.window.gBrowser.tabs.push(tab);

    mgr.tabManager = { getAllTabs: async () => [{
      url: "https://example.com", title: "Ex", type: "essential",
      workspace: { id: ws.uuid, name: ws.name }, tab,
    }]};

    const sync = new SyncManager(mgr);
    await sync.syncToBookmarks();

    const allFolders = await mgr.window.PlacesUtils.bookmarks.search({ type: "folder" });
    const essFolder = allFolders.find(f => f.title === "Essentials");
    assert.ok(essFolder, "plain 'Essentials' folder when no container");
  });

  test("syncFromBookmarks: 'Essentials (X)' folder → reuses existing container by name", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 77, name: "My Work Container", icon: "briefcase", color: "red" }
    );

    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const workFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Work" });
    const essF = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid, type: "folder", title: "Essentials (My Work Container)" });
    await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: "Gmail", url: "https://mail.google.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const ws = mgr.window.gZenWorkspaces.getWorkspaces().find(w => w.name === "Work");
    assert.equal(ws.containerTabId, 77,
      "should reuse existing container id 77, not create a new one");
    assert.equal(mgr.window.ContextualIdentityService._identities.length, 1,
      "no new containers created — reused existing");
  });

  test("syncFromBookmarks: 'Essentials (X)' folder → creates container if none matches", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });

    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const workFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Work" });
    const essF = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid, type: "folder", title: "Essentials (Custom Container)" });
    await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: "Gmail", url: "https://mail.google.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const ws = mgr.window.gZenWorkspaces.getWorkspaces().find(w => w.name === "Work");
    assert.ok(ws.containerTabId > 0, "container was created");
    const created = mgr.window.ContextualIdentityService._identities;
    assert.equal(created.length, 1, "one container created");
    assert.equal(created[0].name, "Custom Container",
      "container name matches folder suffix, not workspace name");
  });

  test("syncFromBookmarks: plain 'Essentials' folder → falls back to workspace name for container", async () => {
    const mgr = makeManager({ workspaces: [], tabs: [] });

    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: toolbarGuid, type: "folder", title: "Zen" });
    const workFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Work" });
    const essF = await PlacesUtils.bookmarks.insert({ parentGuid: workFolder.guid, type: "folder", title: "Essentials" });
    await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: "Gmail", url: "https://mail.google.com" });

    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    await sync.syncFromBookmarks();

    const ws = mgr.window.gZenWorkspaces.getWorkspaces().find(w => w.name === "Work");
    assert.ok(ws.containerTabId > 0, "container was created");
    const created = mgr.window.ContextualIdentityService._identities;
    assert.equal(created.length, 1);
    assert.equal(created[0].name, "Work",
      "container name falls back to workspace name when no suffix in folder title");
  });

  test("full round-trip: tabs→bookmarks (with container) → bookmarks→tabs reuses container by name", async () => {
    // Profile A: workspace with container
    const wsA = { ...makeWorkspace("Dev", "uuid-dev"), containerTabId: 42 };
    const mgrA = makeManager({ workspaces: [wsA], tabs: [] });
    mgrA.window.ContextualIdentityService._identities.push(
      { userContextId: 42, name: "Development", icon: "circle", color: "green" }
    );
    const tabA = makeTab({
      url: "https://github.com", title: "GitHub",
      attrs: { "zen-workspace-id": wsA.uuid, "zen-essential": "" },
    });
    mgrA.window.gBrowser.tabs.push(tabA);
    mgrA.tabManager = { getAllTabs: async () => [{
      url: "https://github.com", title: "GitHub", type: "essential",
      workspace: { id: wsA.uuid, name: wsA.name }, tab: tabA,
    }]};

    const syncA = new SyncManager(mgrA);
    await syncA.syncToBookmarks();

    // Verify Essentials folder was named with container
    const allFolders = await mgrA.window.PlacesUtils.bookmarks.search({ type: "folder" });
    const essFolder = allFolders.find(f => f.title === "Essentials (Development)");
    assert.ok(essFolder, "Essentials folder named with container");

    // Profile B: fresh, with a pre-existing "Development" container
    const mgrB = makeManager({ workspaces: [], tabs: [] });
    mgrB.window.ContextualIdentityService._identities.push(
      { userContextId: 99, name: "Development", icon: "circle", color: "green" }
    );
    // Copy Profile A's bookmarks into Profile B's PlacesUtils (simulating Firefox Sync)
    const treeA = await mgrA.window.PlacesUtils.promiseBookmarksTree("toolbar");
    async function cloneTree(srcNode, destParentGuid, destPU) {
      for (const child of srcNode.children || []) {
        if (child.uri != null) {
          await destPU.bookmarks.insert({
            parentGuid: destParentGuid, type: "bookmark",
            title: child.title, url: child.uri,
          });
        } else if (child.children !== undefined) {
          const folder = await destPU.bookmarks.insert({
            parentGuid: destParentGuid, type: "folder", title: child.title,
          });
          await cloneTree(child, folder.guid, destPU);
        }
      }
    }
    await cloneTree(treeA, "toolbar", mgrB.window.PlacesUtils);

    mgrB.tabManager = { getAllTabs: async () => [] };
    const syncB = new SyncManager(mgrB);
    await syncB.syncFromBookmarks();

    const ws = mgrB.window.gZenWorkspaces.getWorkspaces().find(w => w.name === "Dev");
    assert.ok(ws, "Dev workspace created on profile B");
    assert.equal(ws.containerTabId, 99,
      "reused existing 'Development' container (id 99) instead of creating new");
    assert.equal(mgrB.window.ContextualIdentityService._identities.length, 1,
      "no new containers created on profile B");
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

// ── Complex realistic scenario: bookmarks → tabs (multi-workspace) ────────

describe("Complex scenario — bookmarks → empty tabs (2 workspaces × 15 bookmarks, cross-workspace duplicates)", () => {
  /**
   * Bookmark structure (per workspace, 15 each = 30 total):
   *
   *   Zen/Work/
   *     Essentials/  mail.google.com, shared.com, slack.com
   *     FolderA/     github.com, shared.com
   *       SubA/      jira.com, shared.com
   *     FolderB/     figma.com, notion.com
   *       SubB/      linear.com, vercel.com
   *     FolderC/     docs.google.com, drive.google.com
   *       SubC/      calendar.google.com, meet.google.com
   *
   *   Zen/Personal/
   *     Essentials/  proton.me, shared.com, whatsapp.com       ← shared.com cross-workspace dup
   *     FolderD/     reddit.com, shared.com
   *       SubD/      youtube.com, shared.com
   *     FolderE/     spotify.com, netflix.com
   *       SubE/      twitch.com, discord.com
   *     FolderF/     amazon.com, ebay.com
   *       SubF/      etsy.com, aliexpress.com
   *
   * shared.com: 3× in Work + 3× in Personal = 6 total bookmark entries
   */

  async function buildSpaceBookmarks(PlacesUtils, zenFolderGuid, spaceName, urls) {
    const spaceF = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolderGuid, type: "folder", title: spaceName });

    // Essentials (3)
    const essF = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: "Essentials" });
    for (const u of urls.essentials) {
      await PlacesUtils.bookmarks.insert({ parentGuid: essF.guid, type: "bookmark", title: u.title, url: u.url });
    }

    // 3 folders, each with 2 direct + 1 subfolder with 2
    for (const folderDef of urls.folders) {
      const folder = await PlacesUtils.bookmarks.insert({ parentGuid: spaceF.guid, type: "folder", title: folderDef.name });
      for (const u of folderDef.direct) {
        await PlacesUtils.bookmarks.insert({ parentGuid: folder.guid, type: "bookmark", title: u.title, url: u.url });
      }
      const sub = await PlacesUtils.bookmarks.insert({ parentGuid: folder.guid, type: "folder", title: folderDef.sub.name });
      for (const u of folderDef.sub.bookmarks) {
        await PlacesUtils.bookmarks.insert({ parentGuid: sub.guid, type: "bookmark", title: u.title, url: u.url });
      }
    }
  }

  const workUrls = {
    essentials: [
      { title: "Gmail",  url: "https://mail.google.com" },
      { title: "Shared", url: "https://shared.com" },
      { title: "Slack",  url: "https://slack.com" },
    ],
    folders: [
      { name: "FolderA", direct: [
          { title: "GitHub", url: "https://github.com" },
          { title: "Shared", url: "https://shared.com" },
        ], sub: { name: "SubA", bookmarks: [
          { title: "Jira",   url: "https://jira.com" },
          { title: "Shared", url: "https://shared.com" },
        ]}},
      { name: "FolderB", direct: [
          { title: "Figma",  url: "https://figma.com" },
          { title: "Notion", url: "https://notion.com" },
        ], sub: { name: "SubB", bookmarks: [
          { title: "Linear", url: "https://linear.com" },
          { title: "Vercel", url: "https://vercel.com" },
        ]}},
      { name: "FolderC", direct: [
          { title: "Docs",  url: "https://docs.google.com" },
          { title: "Drive", url: "https://drive.google.com" },
        ], sub: { name: "SubC", bookmarks: [
          { title: "Calendar", url: "https://calendar.google.com" },
          { title: "Meet",     url: "https://meet.google.com" },
        ]}},
    ],
  };

  const personalUrls = {
    essentials: [
      { title: "Proton",   url: "https://proton.me" },
      { title: "Shared",   url: "https://shared.com" },
      { title: "WhatsApp", url: "https://whatsapp.com" },
    ],
    folders: [
      { name: "FolderD", direct: [
          { title: "Reddit", url: "https://reddit.com" },
          { title: "Shared", url: "https://shared.com" },
        ], sub: { name: "SubD", bookmarks: [
          { title: "YouTube", url: "https://youtube.com" },
          { title: "Shared",  url: "https://shared.com" },
        ]}},
      { name: "FolderE", direct: [
          { title: "Spotify", url: "https://spotify.com" },
          { title: "Netflix", url: "https://netflix.com" },
        ], sub: { name: "SubE", bookmarks: [
          { title: "Twitch",  url: "https://twitch.com" },
          { title: "Discord", url: "https://discord.com" },
        ]}},
      { name: "FolderF", direct: [
          { title: "Amazon", url: "https://amazon.com" },
          { title: "eBay",   url: "https://ebay.com" },
        ], sub: { name: "SubF", bookmarks: [
          { title: "Etsy",       url: "https://etsy.com" },
          { title: "AliExpress", url: "https://aliexpress.com" },
        ]}},
    ],
  };

  test("syncFromBookmarks creates 30 tabs across 2 workspaces with correct types, folders, and workspace isolation", async () => {
    const wsWork     = makeWorkspace("Work",     "uuid-work");
    const wsPersonal = makeWorkspace("Personal", "uuid-personal");
    const mgr = makeManager({ workspaces: [wsWork, wsPersonal], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    // Build shared Zen root, then both space folders
    const zenF = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, type: "folder", title: "Zen" });
    await buildSpaceBookmarks(PlacesUtils, zenF.guid, "Work",     workUrls);
    await buildSpaceBookmarks(PlacesUtils, zenF.guid, "Personal", personalUrls);

    mgr.tabManager = { getAllTabs: async () => [] };

    const sync = new SyncManager(mgr);
    const r = await sync.syncFromBookmarks();

    // 30 bookmarks total → 30 tabs
    assert.equal(r.bookmarksFound, 30, "should find 30 bookmarks across 2 spaces");
    assert.equal(r.tabsCreated, 30, "should create 30 tabs");
    assert.equal(r.tabsExisting, 0, "no pre-existing tabs");
    assert.equal(r.errors, 0, "no errors");
    assert.equal(mgr.window.gBrowser.tabs.length, 30, "30 tabs in gBrowser");

    // ── Per-workspace tab counts ────────────────────────────────────
    const workTabs     = mgr.window.gBrowser.tabs.filter(t => t.getAttribute("zen-workspace-id") === wsWork.uuid);
    const personalTabs = mgr.window.gBrowser.tabs.filter(t => t.getAttribute("zen-workspace-id") === wsPersonal.uuid);
    assert.equal(workTabs.length, 15, "15 tabs in Work space");
    assert.equal(personalTabs.length, 15, "15 tabs in Personal space");

    // ── Essential tabs per workspace ────────────────────────────────
    const workEssentials     = workTabs.filter(t => t.hasAttribute("zen-essential"));
    const personalEssentials = personalTabs.filter(t => t.hasAttribute("zen-essential"));
    assert.equal(workEssentials.length, 3, "3 essential tabs in Work");
    assert.equal(personalEssentials.length, 3, "3 essential tabs in Personal");
    for (const t of [...workEssentials, ...personalEssentials]) {
      assert.equal(t.pinned, true, "all essential tabs are pinned");
    }

    // Verify the exact essential URLs per workspace (no cross-workspace leakage)
    const workEssUrls = workEssentials.map(t => t.linkedBrowser.currentURI.spec).sort();
    assert.deepEqual(workEssUrls, [
      "https://mail.google.com",
      "https://shared.com",
      "https://slack.com",
    ].sort(), "Work essentials have correct URLs");
    const persEssUrls = personalEssentials.map(t => t.linkedBrowser.currentURI.spec).sort();
    assert.deepEqual(persEssUrls, [
      "https://proton.me",
      "https://shared.com",
      "https://whatsapp.com",
    ].sort(), "Personal essentials have correct URLs");

    // ── Cross-workspace duplicate: shared.com = 6 total tabs ────────
    const sharedTabs = mgr.window.gBrowser.tabs.filter(
      t => t.linkedBrowser.currentURI.spec === "https://shared.com"
    );
    assert.equal(sharedTabs.length, 6, "shared.com appears as 6 tabs (3 per workspace)");
    const sharedInWork     = sharedTabs.filter(t => t.getAttribute("zen-workspace-id") === wsWork.uuid);
    const sharedInPersonal = sharedTabs.filter(t => t.getAttribute("zen-workspace-id") === wsPersonal.uuid);
    assert.equal(sharedInWork.length, 3, "3× shared.com in Work");
    assert.equal(sharedInPersonal.length, 3, "3× shared.com in Personal");

    // ── Folder structure ────────────────────────────────────────────
    const folders = mgr.window.gZenFolders._createdFolders;
    // 6 folders per workspace = 12 total
    assert.equal(folders.length, 12, "12 Zen folders total (6 per workspace)");

    // Work folders
    const workFolders = folders.filter(f => f.workspaceId === wsWork.uuid);
    assert.equal(workFolders.length, 6, "6 folders in Work");
    const wfNames = workFolders.map(f => f.label).sort();
    assert.deepEqual(wfNames, ["FolderA", "FolderB", "FolderC", "SubA", "SubB", "SubC"].sort());

    // Personal folders
    const persFolders = folders.filter(f => f.workspaceId === wsPersonal.uuid);
    assert.equal(persFolders.length, 6, "6 folders in Personal");
    const pfNames = persFolders.map(f => f.label).sort();
    assert.deepEqual(pfNames, ["FolderD", "FolderE", "FolderF", "SubD", "SubE", "SubF"].sort());

    // Nesting: each sub is inside its parent, scoped per workspace
    for (const [parentName, childName, wsFolders] of [
      ["FolderA", "SubA", workFolders],
      ["FolderB", "SubB", workFolders],
      ["FolderC", "SubC", workFolders],
      ["FolderD", "SubD", persFolders],
      ["FolderE", "SubE", persFolders],
      ["FolderF", "SubF", persFolders],
    ]) {
      const parent = wsFolders.find(f => f.label === parentName);
      const child  = wsFolders.find(f => f.label === childName);
      assert.equal(parent.parentFolder, null, `${parentName} is at root`);
      assert.strictEqual(child.parentFolder, parent, `${childName} nested inside ${parentName}`);
      assert.equal(parent.tabs.length, 2, `${parentName} has 2 direct tabs`);
      assert.equal(child.tabs.length, 2, `${childName} has 2 tabs`);
    }
  });

  test("full round-trip: bookmarks → tabs (clear) → bookmarks recreates identical tree", async () => {
    const wsWork     = makeWorkspace("Work",     "uuid-work");
    const wsPersonal = makeWorkspace("Personal", "uuid-personal");
    const spaceNameById = { [wsWork.uuid]: "Work", [wsPersonal.uuid]: "Personal" };
    const mgr = makeManager({ workspaces: [wsWork, wsPersonal], tabs: [] });
    const PlacesUtils = mgr.window.PlacesUtils;

    const zenF = await PlacesUtils.bookmarks.insert({ parentGuid: PlacesUtils.bookmarks.toolbarGuid, type: "folder", title: "Zen" });
    await buildSpaceBookmarks(PlacesUtils, zenF.guid, "Work",     workUrls);
    await buildSpaceBookmarks(PlacesUtils, zenF.guid, "Personal", personalUrls);

    // Step 1: bookmarks → tabs (empty)
    mgr.tabManager = { getAllTabs: async () => [] };
    const sync = new SyncManager(mgr);
    const r1 = await sync.syncFromBookmarks();
    assert.equal(r1.tabsCreated, 30, "step 1: 30 tabs created from bookmarks");

    // Verify Zen folders were created
    const foldersAfterStep1 = mgr.window.gZenFolders._createdFolders;
    assert.equal(foldersAfterStep1.length, 12, "step 1: 12 Zen folders created");

    // Step 2: clear all bookmarks under toolbar (simulate fresh device)
    // Keep the toolbar root itself so promiseBookmarksTree still works
    const zenRoot = (await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid))
      .children?.find(c => c.title === "Zen");
    if (zenRoot) await PlacesUtils.bookmarks.remove(zenRoot.guid);

    // Build getAllTabs from the tabs that were just created
    mgr.tabManager = { getAllTabs: async () =>
      mgr.window.gBrowser.tabs
        .filter(t => !t.hasAttribute("zen-empty-tab"))
        .map(t => {
          const url = t.linkedBrowser.currentURI.spec;
          const type = t.hasAttribute("zen-essential") ? "essential" : t.pinned ? "pinned" : "normal";
          const folder = foldersAfterStep1.find(f => f.tabs.includes(t));
          const parentFolder = folder?.parentFolder ? foldersAfterStep1.find(f => f === folder.parentFolder) : null;
          const folderPath = folder
            ? (parentFolder ? [parentFolder.label, folder.label] : [folder.label])
            : undefined;
          const wsId = t.getAttribute("zen-workspace-id");
          return {
            url, title: t.label || "Untitled", type,
            folderPath,
            workspace: { id: wsId, name: spaceNameById[wsId] ?? wsId },
            tab: t,
          };
        })
    };

    // Step 3: tabs → empty bookmarks
    const r2 = await sync.syncToBookmarks({ includeEssential: true, includePinned: true, includeNormal: false });
    assert.equal(r2.bookmarksCreated, 30, "step 3: 30 bookmarks recreated");
    assert.equal(r2.bookmarksDeleted, 0, "step 3: no orphan deletions");

    // Verify the bookmark tree structure matches the original
    const zenTree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenFolder = zenTree.children.find(c => c.title === "Zen");
    assert.ok(zenFolder, "Zen root recreated");

    for (const [spaceName, folderNames, subNames, essUrls] of [
      ["Work", ["FolderA", "FolderB", "FolderC"], ["SubA", "SubB", "SubC"],
        ["https://mail.google.com", "https://shared.com", "https://slack.com"]],
      ["Personal", ["FolderD", "FolderE", "FolderF"], ["SubD", "SubE", "SubF"],
        ["https://proton.me", "https://shared.com", "https://whatsapp.com"]],
    ]) {
      const spaceFolder = zenFolder.children.find(c => c.title === spaceName);
      assert.ok(spaceFolder, `${spaceName} folder recreated`);

      // Essentials (may include container name suffix after round-trip)
      const essF = spaceFolder.children.find(c => c.title?.startsWith("Essentials"));
      assert.ok(essF, `Essentials folder in ${spaceName}`);
      const essBms = essF.children.filter(c => c.uri);
      assert.equal(essBms.length, 3, `3 essentials in ${spaceName}`);
      assert.deepEqual(essBms.map(b => b.uri).sort(), essUrls.sort(), `correct essential URLs in ${spaceName}`);

      // Named folders + subfolders
      for (let i = 0; i < folderNames.length; i++) {
        const folder = spaceFolder.children.find(c => c.title === folderNames[i]);
        assert.ok(folder, `${folderNames[i]} exists in ${spaceName}`);
        assert.equal(folder.children.filter(c => c.uri).length, 2, `${folderNames[i]} has 2 direct bookmarks`);
        const sub = folder.children.find(c => c.title === subNames[i]);
        assert.ok(sub, `${subNames[i]} inside ${folderNames[i]}`);
        assert.equal(sub.children.filter(c => c.uri).length, 2, `${subNames[i]} has 2 bookmarks`);
      }
    }

    // Cross-workspace shared.com
    const allShared = await PlacesUtils.bookmarks.search({ url: "https://shared.com" });
    assert.equal(allShared.length, 6, "shared.com bookmarked 6 times across both workspaces");
  });
});

// ── Complex realistic scenario: tabs → bookmarks (multi-workspace) ────────

describe("Complex scenario — tabs → empty bookmarks (2 workspaces × 15 tabs, cross-workspace duplicates)", () => {
  /**
   * Mirror of the bookmark scenario but starting from tabs.
   * 2 workspaces (Work + Personal), each with 15 tabs.
   * shared.com appears 3× per workspace = 6 total.
   */

  function buildSpaceTabs(wsUuid, wsName, urlDefs) {
    const allTabs = [];
    const tabDataList = [];

    // Essential tabs
    for (const u of urlDefs.essentials) {
      const tab = makeTab({ url: u.url, title: u.title, attrs: { "zen-workspace-id": wsUuid, "zen-essential": "" } });
      allTabs.push(tab);
      tabDataList.push({
        url: u.url, title: u.title, type: "essential",
        workspace: { id: wsUuid, name: wsName }, tab,
      });
    }

    // Folder tabs
    for (const folderDef of urlDefs.folders) {
      for (const u of folderDef.direct) {
        const tab = makeTab({ url: u.url, title: u.title, pinned: true, attrs: { "zen-workspace-id": wsUuid } });
        allTabs.push(tab);
        tabDataList.push({
          url: u.url, title: u.title, type: "pinned",
          folderPath: [folderDef.name],
          workspace: { id: wsUuid, name: wsName }, tab,
        });
      }
      for (const u of folderDef.sub.bookmarks) {
        const tab = makeTab({ url: u.url, title: u.title, pinned: true, attrs: { "zen-workspace-id": wsUuid } });
        allTabs.push(tab);
        tabDataList.push({
          url: u.url, title: u.title, type: "pinned",
          folderPath: [folderDef.name, folderDef.sub.name],
          workspace: { id: wsUuid, name: wsName }, tab,
        });
      }
    }

    return { allTabs, tabDataList };
  }

  const workUrls = {
    essentials: [
      { title: "Gmail",  url: "https://mail.google.com" },
      { title: "Shared", url: "https://shared.com" },
      { title: "Slack",  url: "https://slack.com" },
    ],
    folders: [
      { name: "FolderA", direct: [
          { title: "GitHub", url: "https://github.com" },
          { title: "Shared", url: "https://shared.com" },
        ], sub: { name: "SubA", bookmarks: [
          { title: "Jira",   url: "https://jira.com" },
          { title: "Shared", url: "https://shared.com" },
        ]}},
      { name: "FolderB", direct: [
          { title: "Figma",  url: "https://figma.com" },
          { title: "Notion", url: "https://notion.com" },
        ], sub: { name: "SubB", bookmarks: [
          { title: "Linear", url: "https://linear.com" },
          { title: "Vercel", url: "https://vercel.com" },
        ]}},
      { name: "FolderC", direct: [
          { title: "Docs",  url: "https://docs.google.com" },
          { title: "Drive", url: "https://drive.google.com" },
        ], sub: { name: "SubC", bookmarks: [
          { title: "Calendar", url: "https://calendar.google.com" },
          { title: "Meet",     url: "https://meet.google.com" },
        ]}},
    ],
  };

  const personalUrls = {
    essentials: [
      { title: "Proton",   url: "https://proton.me" },
      { title: "Shared",   url: "https://shared.com" },
      { title: "WhatsApp", url: "https://whatsapp.com" },
    ],
    folders: [
      { name: "FolderD", direct: [
          { title: "Reddit", url: "https://reddit.com" },
          { title: "Shared", url: "https://shared.com" },
        ], sub: { name: "SubD", bookmarks: [
          { title: "YouTube", url: "https://youtube.com" },
          { title: "Shared",  url: "https://shared.com" },
        ]}},
      { name: "FolderE", direct: [
          { title: "Spotify", url: "https://spotify.com" },
          { title: "Netflix", url: "https://netflix.com" },
        ], sub: { name: "SubE", bookmarks: [
          { title: "Twitch",  url: "https://twitch.com" },
          { title: "Discord", url: "https://discord.com" },
        ]}},
      { name: "FolderF", direct: [
          { title: "Amazon", url: "https://amazon.com" },
          { title: "eBay",   url: "https://ebay.com" },
        ], sub: { name: "SubF", bookmarks: [
          { title: "Etsy",       url: "https://etsy.com" },
          { title: "AliExpress", url: "https://aliexpress.com" },
        ]}},
    ],
  };

  test("syncToBookmarks creates 30 bookmarks across 2 workspaces with correct folder hierarchy", async () => {
    const wsWork     = makeWorkspace("Work",     "uuid-work");
    const wsPersonal = makeWorkspace("Personal", "uuid-personal");
    const work     = buildSpaceTabs(wsWork.uuid,     "Work",     workUrls);
    const personal = buildSpaceTabs(wsPersonal.uuid,  "Personal", personalUrls);
    const allTabs     = [...work.allTabs, ...personal.allTabs];
    const tabDataList = [...work.tabDataList, ...personal.tabDataList];
    const mgr = makeManager({ workspaces: [wsWork, wsPersonal], tabs: allTabs });

    mgr.tabManager = { getAllTabs: async () => tabDataList };

    const sync = new SyncManager(mgr);
    const r = await sync.syncToBookmarks({ includeEssential: true, includePinned: true, includeNormal: false });

    assert.equal(r.bookmarksCreated, 30, "30 bookmarks created");
    assert.equal(r.bookmarksDeleted, 0, "no bookmarks deleted");
    assert.equal(r.skipped, 0, "nothing skipped");

    // Verify bookmark tree
    const PlacesUtils = mgr.window.PlacesUtils;
    const zenTree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenFolder = zenTree.children.find(c => c.title === "Zen");
    assert.ok(zenFolder, "Zen folder exists");

    // Both workspace folders exist
    const workBmFolder = zenFolder.children.find(c => c.title === "Work");
    const persBmFolder = zenFolder.children.find(c => c.title === "Personal");
    assert.ok(workBmFolder, "Work bookmark folder exists");
    assert.ok(persBmFolder, "Personal bookmark folder exists");

    // Verify per-workspace structure
    for (const [spaceFolder, folderNames, subNames] of [
      [workBmFolder, ["FolderA", "FolderB", "FolderC"], ["SubA", "SubB", "SubC"]],
      [persBmFolder, ["FolderD", "FolderE", "FolderF"], ["SubD", "SubE", "SubF"]],
    ]) {
      // Essentials
      const essF = spaceFolder.children.find(c => c.title === "Essentials");
      assert.ok(essF, `Essentials in ${spaceFolder.title}`);
      const essBms = essF.children.filter(c => c.uri);
      assert.equal(essBms.length, 3, `3 essentials in ${spaceFolder.title}`);
      const essUrls = essBms.map(b => b.uri).sort();
      const expectedEssUrls = spaceFolder.title === "Work"
        ? ["https://mail.google.com", "https://shared.com", "https://slack.com"].sort()
        : ["https://proton.me", "https://shared.com", "https://whatsapp.com"].sort();
      assert.deepEqual(essUrls, expectedEssUrls, `correct essential URLs in ${spaceFolder.title}`);

      // Named folders + subfolders
      for (let i = 0; i < folderNames.length; i++) {
        const folder = spaceFolder.children.find(c => c.title === folderNames[i]);
        assert.ok(folder, `${folderNames[i]} exists in ${spaceFolder.title}`);
        assert.equal(folder.children.filter(c => c.uri).length, 2, `${folderNames[i]} has 2 direct bookmarks`);
        const sub = folder.children.find(c => c.title === subNames[i]);
        assert.ok(sub, `${subNames[i]} exists inside ${folderNames[i]}`);
        assert.equal(sub.children.filter(c => c.uri).length, 2, `${subNames[i]} has 2 bookmarks`);
      }
    }

    // Cross-workspace duplicate: shared.com = 6 total
    const allShared = await PlacesUtils.bookmarks.search({ url: "https://shared.com" });
    assert.equal(allShared.length, 6, "shared.com bookmarked 6 times across both workspaces");
  });

  test("full round-trip: tabs → bookmarks (clear tabs) → bookmarks → tabs recreates identical folder structure", async () => {
    const wsWork     = makeWorkspace("Work",     "uuid-work");
    const wsPersonal = makeWorkspace("Personal", "uuid-personal");
    const work     = buildSpaceTabs(wsWork.uuid,     "Work",     workUrls);
    const personal = buildSpaceTabs(wsPersonal.uuid,  "Personal", personalUrls);
    const allTabs     = [...work.allTabs, ...personal.allTabs];
    const tabDataList = [...work.tabDataList, ...personal.tabDataList];
    const mgr = makeManager({ workspaces: [wsWork, wsPersonal], tabs: allTabs });

    mgr.tabManager = { getAllTabs: async () => tabDataList };

    // Step 1: tabs → bookmarks
    const sync = new SyncManager(mgr);
    const r1 = await sync.syncToBookmarks({ includeEssential: true, includePinned: true, includeNormal: false });
    assert.equal(r1.bookmarksCreated, 30, "step 1: 30 bookmarks created");

    // Step 2: clear ALL tabs (simulate fresh device / new browser window)
    while (mgr.window.gBrowser.tabs.length > 0) {
      mgr.window.gBrowser.removeTab(mgr.window.gBrowser.tabs[0]);
    }
    assert.equal(mgr.window.gBrowser.tabs.length, 0, "all tabs cleared");

    // Clear the folder tracker so we can verify fresh creation
    mgr.window.gZenFolders._createdFolders.length = 0;

    // Update tabManager to reflect empty tab state
    mgr.tabManager = { getAllTabs: async () => [] };

    // Step 3: bookmarks → empty tabs
    const r2 = await sync.syncFromBookmarks();
    assert.equal(r2.tabsCreated, 30, "step 3: 30 tabs recreated from bookmarks");
    assert.equal(r2.tabsExisting, 0, "step 3: no pre-existing tabs");
    assert.equal(r2.errors, 0, "step 3: no errors");
    assert.equal(mgr.window.gBrowser.tabs.length, 30, "30 tabs in gBrowser");

    // ── Per-workspace tab counts ────────────────────────────────────
    const workTabs     = mgr.window.gBrowser.tabs.filter(t => t.getAttribute("zen-workspace-id") === wsWork.uuid);
    const personalTabs = mgr.window.gBrowser.tabs.filter(t => t.getAttribute("zen-workspace-id") === wsPersonal.uuid);
    assert.equal(workTabs.length, 15, "15 tabs in Work space");
    assert.equal(personalTabs.length, 15, "15 tabs in Personal space");

    // ── Essential tabs per workspace ────────────────────────────────
    const workEssentials     = workTabs.filter(t => t.hasAttribute("zen-essential"));
    const personalEssentials = personalTabs.filter(t => t.hasAttribute("zen-essential"));
    assert.equal(workEssentials.length, 3, "3 essential tabs in Work");
    assert.equal(personalEssentials.length, 3, "3 essential tabs in Personal");
    assert.deepEqual(
      workEssentials.map(t => t.linkedBrowser.currentURI.spec).sort(),
      ["https://mail.google.com", "https://shared.com", "https://slack.com"].sort(),
      "Work essential URLs correct"
    );
    assert.deepEqual(
      personalEssentials.map(t => t.linkedBrowser.currentURI.spec).sort(),
      ["https://proton.me", "https://shared.com", "https://whatsapp.com"].sort(),
      "Personal essential URLs correct"
    );

    // ── Zen folder structure recreated ──────────────────────────────
    const folders = mgr.window.gZenFolders._createdFolders;
    assert.equal(folders.length, 12, "12 Zen folders recreated (6 per workspace)");

    // Work folders
    const workFolders = folders.filter(f => f.workspaceId === wsWork.uuid);
    assert.equal(workFolders.length, 6, "6 folders in Work");
    assert.deepEqual(
      workFolders.map(f => f.label).sort(),
      ["FolderA", "FolderB", "FolderC", "SubA", "SubB", "SubC"].sort()
    );

    // Personal folders
    const persFolders = folders.filter(f => f.workspaceId === wsPersonal.uuid);
    assert.equal(persFolders.length, 6, "6 folders in Personal");
    assert.deepEqual(
      persFolders.map(f => f.label).sort(),
      ["FolderD", "FolderE", "FolderF", "SubD", "SubE", "SubF"].sort()
    );

    // Nesting + tab counts
    for (const [parentName, childName, wsFolders] of [
      ["FolderA", "SubA", workFolders],
      ["FolderB", "SubB", workFolders],
      ["FolderC", "SubC", workFolders],
      ["FolderD", "SubD", persFolders],
      ["FolderE", "SubE", persFolders],
      ["FolderF", "SubF", persFolders],
    ]) {
      const parent = wsFolders.find(f => f.label === parentName);
      const child  = wsFolders.find(f => f.label === childName);
      assert.equal(parent.parentFolder, null, `${parentName} at root`);
      assert.strictEqual(child.parentFolder, parent, `${childName} nested inside ${parentName}`);
      assert.equal(parent.tabs.length, 2, `${parentName} has 2 direct tabs`);
      assert.equal(child.tabs.length, 2, `${childName} has 2 tabs`);
    }

    // ── Cross-workspace shared.com = 6 tabs ─────────────────────────
    const sharedTabs = mgr.window.gBrowser.tabs.filter(
      t => t.linkedBrowser.currentURI.spec === "https://shared.com"
    );
    assert.equal(sharedTabs.length, 6, "shared.com: 6 tabs (3 per workspace)");
  });
});

// ── Folder normalization ────────────────────────────────────────────────────

describe("Folder normalization (_normalizeFolder)", () => {
  test("normalizes bare 'Essentials' to canonical name with container", () => {
    const ws = makeWorkspace("Dev", "uuid-dev");
    ws.containerTabId = 1;
    const mgr = makeManager({ workspaces: [ws] });
    // Seed CIS with a container matching the workspace's containerTabId
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 1, name: "Dev-Container", icon: "circle", color: "blue" }
    );
    const sync = new SyncManager(mgr);
    const result = sync._normalizeFolder("Essentials", "uuid-dev");
    assert.equal(result, "Essentials (Dev-Container)");
  });

  test("normalizes old Essentials variant to canonical name", () => {
    const ws = makeWorkspace("Dev", "uuid-dev");
    ws.containerTabId = 1;
    const mgr = makeManager({ workspaces: [ws] });
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 1, name: "Dev-Container", icon: "circle", color: "blue" }
    );
    const sync = new SyncManager(mgr);
    const result = sync._normalizeFolder("Essentials (OldName)", "uuid-dev");
    assert.equal(result, "Essentials (Dev-Container)");
  });

  test("normalizes nested Essentials path", () => {
    const ws = makeWorkspace("Dev", "uuid-dev");
    ws.containerTabId = 1;
    const mgr = makeManager({ workspaces: [ws] });
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 1, name: "Dev-Container", icon: "circle", color: "blue" }
    );
    const sync = new SyncManager(mgr);
    const result = sync._normalizeFolder("Essentials/subfolder", "uuid-dev");
    assert.equal(result, "Essentials (Dev-Container)/subfolder");
  });

  test("does not normalize non-Essentials folders", () => {
    const ws = makeWorkspace("Dev", "uuid-dev");
    const mgr = makeManager({ workspaces: [ws] });
    const sync = new SyncManager(mgr);
    assert.equal(sync._normalizeFolder("Temporary tabs", "uuid-dev"), "Temporary tabs");
    assert.equal(sync._normalizeFolder("MyFolder", "uuid-dev"), "MyFolder");
    assert.equal(sync._normalizeFolder("", "uuid-dev"), "");
  });

  test("syncToBookmarks does not duplicate when old Essentials folder exists", async () => {
    const ws = makeWorkspace("Dev", "uuid-dev");
    ws.containerTabId = 1;

    const essentialTab = makeTab({
      url: "https://essential.com", title: "Essential",
      pinned: true,
      attrs: { "zen-essential": "true", "zen-workspace-id": "uuid-dev" }
    });

    const mgr = makeManager({ workspaces: [ws], tabs: [essentialTab] });
    mgr.window.ContextualIdentityService._identities.push(
      { userContextId: 1, name: "Dev-Container", icon: "circle", color: "blue" }
    );

    // Init TabManager so syncToBookmarks can enumerate tabs
    const { TabManager } = await import("../content/TabManager.mjs");
    mgr.tabManager = new TabManager(mgr);
    await mgr.tabManager.init();

    const sync = new SyncManager(mgr);
    await sync.init();

    const PlacesUtils = mgr.window.PlacesUtils;

    // Seed old-style "Essentials" folder with the same bookmark
    const zenFolder = await PlacesUtils.bookmarks.insert({ parentGuid: "toolbar", type: "folder", title: "Zen" });
    const spaceFolder = await PlacesUtils.bookmarks.insert({ parentGuid: zenFolder.guid, type: "folder", title: "Dev" });
    const oldEsFolder = await PlacesUtils.bookmarks.insert({ parentGuid: spaceFolder.guid, type: "folder", title: "Essentials" });
    await PlacesUtils.bookmarks.insert({ parentGuid: oldEsFolder.guid, type: "bookmark", title: "Essential", url: "https://essential.com" });

    // Run syncToBookmarks twice
    const result1 = await sync.syncToBookmarks();
    const result2 = await sync.syncToBookmarks();

    // Second run should not create any new bookmarks
    assert.equal(result2.bookmarksCreated, 0, "no duplicates on second sync");
  });
});
