/**
 * SimpleBookmarkSyncManager unit tests
 *
 * Run with: node --test tests/SimpleBookmarkSyncManager.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  makeManager,
  makeTab,
  makeGZenWorkspaces,
} from "./helpers/mocks.mjs";
import { SimpleBookmarkSyncManager } from "../content/SimpleBookmarkSyncManager.mjs";

// ── Helpers ───────────────────────────────────────────────────────────────

function makeWorkspace(name, uuid = `uuid-${name}`, containerTabId = 0) {
  return { uuid, name, icon: null, theme: {}, containerTabId };
}

function makeSyncManager(workspaces = [], allTabs = [], extraWindowProps = {}) {
  const mgr = makeManager({ workspaces, tabs: allTabs });
  // allStoredTabs must return exactly allTabs (already set via makeGZenWorkspaces)
  // Override window props when supplied.
  Object.assign(mgr.window, extraWindowProps);
  return new SimpleBookmarkSyncManager(mgr);
}

function makeEssentialTab(url, tPos, wsUuid, extra = {}) {
  return makeTab({
    url,
    _tPos: tPos,
    attrs: { "zen-workspace-id": wsUuid, "zen-essential": "" },
    ...extra,
  });
}

function makePinnedTab(url, tPos, wsUuid, extra = {}) {
  return makeTab({
    url,
    _tPos: tPos,
    pinned: true,
    attrs: { "zen-workspace-id": wsUuid },
    ...extra,
  });
}

// ── buildDesiredTree ─────────────────────────────────────────────────────

describe("buildDesiredTree — empty spaces", () => {
  test("returns root folder with no children when there are no syncable tabs", async () => {
    const ws = makeWorkspace("Work");
    const normalTab = makeTab({
      url: "https://example.com",
      attrs: { "zen-workspace-id": ws.uuid },
    });
    const sm = makeSyncManager([ws], [normalTab]);
    const tree = await sm.buildDesiredTree();

    assert.equal(tree.type, "folder");
    assert.equal(tree.title, "ZenTabs");
    assert.equal(tree.children.length, 0);
  });

  test("returns root folder with no children when there are no tabs at all", async () => {
    const sm = makeSyncManager([], []);
    const tree = await sm.buildDesiredTree();
    assert.equal(tree.children.length, 0);
  });
});

describe("buildDesiredTree — essential tabs only", () => {
  test("creates Essentials folder under space folder", async () => {
    const ws = makeWorkspace("Personal");
    const tab = makeEssentialTab("https://mail.example.com", 0, ws.uuid, {
      label: "Mail",
    });
    const sm = makeSyncManager([ws], [tab]);
    const tree = await sm.buildDesiredTree();

    assert.equal(tree.children.length, 1);
    const spaceFolder = tree.children[0];
    assert.equal(spaceFolder.title, "Personal");

    // Should have one child: the Essentials folder (default container).
    assert.equal(spaceFolder.children.length, 1);
    const essFolder = spaceFolder.children[0];
    assert.equal(essFolder.type, "folder");
    assert.equal(essFolder.title, "Essentials");
    assert.equal(essFolder.children.length, 1);
    assert.equal(essFolder.children[0].type, "bookmark");
    assert.equal(essFolder.children[0].url, "https://mail.example.com");
    assert.equal(essFolder.children[0].title, "Mail");
  });

  test("skips essential tab with about:blank URL", async () => {
    const ws = makeWorkspace("Personal");
    const blankTab = makeEssentialTab("about:blank", 0, ws.uuid, {
      label: "New Tab",
    });
    const sm = makeSyncManager([ws], [blankTab]);
    const tree = await sm.buildDesiredTree();
    // No valid essentials → no Essentials folder → no space folder.
    assert.equal(tree.children.length, 0);
  });
});

describe("buildDesiredTree — pinned tabs no folder", () => {
  test("pinned tabs appear directly under space folder", async () => {
    const ws = makeWorkspace("Work");
    const tab = makePinnedTab("https://github.com", 0, ws.uuid, {
      label: "GitHub",
      _zenPinnedInitialState: { entry: { url: "https://github.com" } },
    });
    const sm = makeSyncManager([ws], [tab]);
    const tree = await sm.buildDesiredTree();

    const spaceFolder = tree.children[0];
    assert.equal(spaceFolder.title, "Work");

    // No Essentials, one pinned bookmark at root.
    assert.equal(spaceFolder.children.length, 1);
    const bm = spaceFolder.children[0];
    assert.equal(bm.type, "bookmark");
    assert.equal(bm.url, "https://github.com");
    assert.equal(bm.title, "GitHub");
  });
});

describe("buildDesiredTree — pinned tabs in Zen folder", () => {
  test("subfolder mirrors Zen folder", async () => {
    const ws = makeWorkspace("Work");
    const group = { isZenFolder: true, label: "Dev Tools", group: null };
    const tab = makePinnedTab("https://devtools.example.com", 0, ws.uuid, {
      label: "Dev",
      _zenPinnedInitialState: {
        entry: { url: "https://devtools.example.com" },
      },
      group,
    });
    const sm = makeSyncManager([ws], [tab]);
    const tree = await sm.buildDesiredTree();

    const spaceFolder = tree.children[0];
    assert.equal(spaceFolder.children.length, 1);

    const folder = spaceFolder.children[0];
    assert.equal(folder.type, "folder");
    assert.equal(folder.title, "Dev Tools");
    assert.equal(folder.children.length, 1);
    assert.equal(folder.children[0].url, "https://devtools.example.com");
  });
});

describe("buildDesiredTree — recursive Zen folders", () => {
  test("nested subfolders are mirrored recursively", async () => {
    const ws = makeWorkspace("Research");
    const outerGroup = {
      isZenFolder: true,
      label: "Science",
      group: null,
    };
    const innerGroup = {
      isZenFolder: true,
      label: "Physics",
      group: outerGroup,
    };
    const tab = makePinnedTab("https://arxiv.org", 0, ws.uuid, {
      label: "arXiv",
      _zenPinnedInitialState: { entry: { url: "https://arxiv.org" } },
      group: innerGroup,
    });
    const sm = makeSyncManager([ws], [tab]);
    const tree = await sm.buildDesiredTree();

    const spaceFolder = tree.children[0];
    // Outer folder "Science"
    const scienceFolder = spaceFolder.children[0];
    assert.equal(scienceFolder.type, "folder");
    assert.equal(scienceFolder.title, "Science");
    // Inner folder "Physics" inside "Science"
    const physicsFolder = scienceFolder.children[0];
    assert.equal(physicsFolder.type, "folder");
    assert.equal(physicsFolder.title, "Physics");
    assert.equal(physicsFolder.children[0].url, "https://arxiv.org");
  });
});

describe("buildDesiredTree — tab order preserved", () => {
  test("entries are sorted by _tPos ascending", async () => {
    const ws = makeWorkspace("Work");
    const tab1 = makeEssentialTab("https://a.com", 5, ws.uuid, { label: "A" });
    const tab2 = makeEssentialTab("https://b.com", 1, ws.uuid, { label: "B" });
    const tab3 = makeEssentialTab("https://c.com", 3, ws.uuid, { label: "C" });
    const sm = makeSyncManager([ws], [tab1, tab2, tab3]);
    const tree = await sm.buildDesiredTree();

    const essFolder = tree.children[0].children[0];
    const urls = essFolder.children.map(b => b.url);
    assert.deepEqual(urls, [
      "https://b.com", // _tPos 1
      "https://c.com", // _tPos 3
      "https://a.com", // _tPos 5
    ]);
  });

  test("pinned tabs at root sorted by _tPos", async () => {
    const ws = makeWorkspace("Work");
    const tab1 = makePinnedTab("https://z.com", 10, ws.uuid, {
      label: "Z",
      _zenPinnedInitialState: { entry: { url: "https://z.com" } },
    });
    const tab2 = makePinnedTab("https://a.com", 2, ws.uuid, {
      label: "A",
      _zenPinnedInitialState: { entry: { url: "https://a.com" } },
    });
    const sm = makeSyncManager([ws], [tab1, tab2]);
    const tree = await sm.buildDesiredTree();

    const spaceFolder = tree.children[0];
    const urls = spaceFolder.children.map(b => b.url);
    assert.deepEqual(urls, ["https://a.com", "https://z.com"]);
  });
});

describe("buildDesiredTree — skips about:blank", () => {
  test("tabs with no real URL are skipped entirely", async () => {
    const ws = makeWorkspace("Work");
    const blankPinned = makePinnedTab("about:blank", 0, ws.uuid, {
      label: "New Tab",
    });
    // No _zenPinnedInitialState, no SessionStore lazy value → blank URL
    const sm = makeSyncManager([ws], [blankPinned]);
    const tree = await sm.buildDesiredTree();
    // No valid items → no space folder
    assert.equal(tree.children.length, 0);
  });
});

describe("buildDesiredTree — skips normal tabs", () => {
  test("non-essential non-pinned tabs are excluded", async () => {
    const ws = makeWorkspace("Work");
    const normal = makeTab({
      url: "https://example.com",
      attrs: { "zen-workspace-id": ws.uuid },
      label: "Example",
    });
    const sm = makeSyncManager([ws], [normal]);
    const tree = await sm.buildDesiredTree();
    assert.equal(tree.children.length, 0);
  });
});

// ── getPinnedUrl ──────────────────────────────────────────────────────────

describe("getPinnedUrl", () => {
  test("returns recorded home URL from _zenPinnedInitialState", () => {
    const mgr = makeManager();
    const sm = new SimpleBookmarkSyncManager(mgr);
    const tab = makeTab({
      url: "https://live.example.com",
      pinned: true,
      _zenPinnedInitialState: { entry: { url: "https://home.example.com" } },
    });
    assert.equal(sm.getPinnedUrl(tab), "https://home.example.com");
  });

  test("falls back to SessionStore lazy value when _zenPinnedInitialState is absent", () => {
    const lazyUrl = "https://lazy.example.com";
    const mgr = makeManager();
    // Inject a mock SessionStore with getLazyTabValue.
    mgr.window.SessionStore = {
      getLazyTabValue: (_tab, _key) => lazyUrl,
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    const tab = makeTab({ url: "about:blank", pinned: true });
    assert.equal(sm.getPinnedUrl(tab), lazyUrl);
  });

  test("falls back to currentURI when no lazy value", () => {
    const mgr = makeManager();
    mgr.window.SessionStore = { getLazyTabValue: () => null };
    const sm = new SimpleBookmarkSyncManager(mgr);
    const tab = makeTab({ url: "https://current.example.com", pinned: true });
    assert.equal(sm.getPinnedUrl(tab), "https://current.example.com");
  });

  test("ignores about:blank _zenPinnedInitialState and falls back", () => {
    const mgr = makeManager();
    mgr.window.SessionStore = {
      getLazyTabValue: () => "https://fallback.example.com",
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    const tab = makeTab({
      url: "about:blank",
      pinned: true,
      _zenPinnedInitialState: { entry: { url: "about:blank" } },
    });
    assert.equal(sm.getPinnedUrl(tab), "https://fallback.example.com");
  });
});

// ── getContainerName ──────────────────────────────────────────────────────

describe("getContainerName", () => {
  test("returns 'Essentials' for containerTabId 0", () => {
    const mgr = makeManager();
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(0), "Essentials");
  });

  test("returns 'Essentials' when containerTabId is falsy", () => {
    const mgr = makeManager();
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(null), "Essentials");
    assert.equal(sm.getContainerName(undefined), "Essentials");
  });

  test("returns identity name when a named container is found", () => {
    const mgr = makeManager();
    mgr.window.ContextualIdentityService = {
      getPublicIdentityFromId: (id) =>
        id === 42 ? { name: "Work" } : null,
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(42), "Essentials - Work");
  });

  test("returns 'Essentials' when identity is not found for a numeric id", () => {
    const mgr = makeManager();
    mgr.window.ContextualIdentityService = {
      getPublicIdentityFromId: () => null,
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(99), "Essentials");
  });
});

// ── syncTabsToBookmarks — result shape ───────────────────────────────────

describe("syncTabsToBookmarks", () => {
  test("returns object with created/updated/deleted/errors keys", async () => {
    const ws = makeWorkspace("Work");
    const tab = makeEssentialTab("https://example.com", 0, ws.uuid, {
      label: "Example",
    });
    const sm = makeSyncManager([ws], [tab]);
    const result = await sm.syncTabsToBookmarks();

    assert.ok("created" in result, "result should have 'created'");
    assert.ok("updated" in result, "result should have 'updated'");
    assert.ok("deleted" in result, "result should have 'deleted'");
    assert.ok("errors" in result, "result should have 'errors'");
    assert.ok(Array.isArray(result.errors), "'errors' should be an array");
    assert.equal(result.errors.length, 0);
  });

  test("creates bookmark entries for essential tabs", async () => {
    const ws = makeWorkspace("MySpace");
    const tab = makeEssentialTab("https://essentialsite.com", 0, ws.uuid, {
      label: "Essential",
    });
    const sm = makeSyncManager([ws], [tab]);
    const result = await sm.syncTabsToBookmarks();

    // At minimum: ZenTabs folder + MySpace subfolder + Essentials subfolder + 1 bookmark = 3 creates
    assert.ok(result.created >= 1, `expected at least 1 created, got ${result.created}`);
    assert.equal(result.errors.length, 0);
  });

  test("dispatches simple-sync-started and simple-sync-completed events", async () => {
    const ws = makeWorkspace("Work");
    const tab = makeEssentialTab("https://example.com", 0, ws.uuid, {
      label: "Example",
    });
    const mgr = makeManager({ workspaces: [ws], tabs: [tab] });
    const sm = new SimpleBookmarkSyncManager(mgr);

    const events = [];
    mgr.on("simple-sync-started",    () => events.push("started"));
    mgr.on("simple-sync-completed",  () => events.push("completed"));
    mgr.on("simple-sync-failed",     () => events.push("failed"));

    await sm.syncTabsToBookmarks();

    assert.deepEqual(events, ["started", "completed"]);
  });

  test("second run is idempotent (no duplicates)", async () => {
    const ws = makeWorkspace("Work");
    const tab = makeEssentialTab("https://example.com", 0, ws.uuid, {
      label: "Example",
    });
    const sm = makeSyncManager([ws], [tab]);

    const r1 = await sm.syncTabsToBookmarks();
    const r2 = await sm.syncTabsToBookmarks();

    // Second run: no new creates, nothing deleted, possibly title-update no-ops.
    assert.equal(r2.created, 0, "second run should not create duplicates");
    assert.equal(r2.deleted, 0, "second run should not delete anything");
    assert.equal(r2.errors.length, 0);
    // r1 created the structure
    assert.ok(r1.created > 0);
  });
});
