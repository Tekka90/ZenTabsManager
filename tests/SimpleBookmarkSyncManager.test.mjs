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

  test("tabs with no zen-workspace-id are skipped — no 'default' folder created", async () => {
    const ws  = makeWorkspace("Work");
    // Tab missing the zen-workspace-id attribute entirely.
    const tab = makeTab({ url: "https://example.com", pinned: true });
    tab._zenPinnedInitialState = { entry: { url: "https://example.com" } };
    const sm  = makeSyncManager([ws], [tab]);
    const tree = await sm.buildDesiredTree();
    assert.equal(tree.children.length, 0, "no folder should be created for unassigned tabs");
    const hasDefault = tree.children.some(c => c.title === "default");
    assert.ok(!hasDefault, "'default' folder must never appear");
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

  test("uses l10nId when name is absent (built-in containers)", () => {
    const mgr = makeManager();
    mgr.window.ContextualIdentityService = {
      getPublicIdentityFromId: (id) =>
        id === 1 ? { l10nId: "user-context-personal" } : null,
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(1), "Essentials - Personal");
  });

  test("uses l10nId without user-context- prefix", () => {
    const mgr = makeManager();
    mgr.window.ContextualIdentityService = {
      getPublicIdentityFromId: (id) =>
        id === 2 ? { l10nId: "user-context-work" } : null,
    };
    const sm = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm.getContainerName(2), "Essentials - Work");
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

// ── _syncSpaceMetadata / readSpaceMetadata (T1–T7) ───────────────────────

describe("space metadata — T1: creates __spaces__ folder on first sync", () => {
  test("metadata bookmarks created for each synced space; no UUID in payload", async () => {
    const ws1 = makeWorkspace("Work");
    ws1.icon  = "🔥";
    ws1.theme = { gradient: "#f00" };
    const ws2 = makeWorkspace("Personal");
    ws2.icon  = null;
    ws2.theme = {};

    const tab1 = makeEssentialTab("https://work.com",     0, ws1.uuid, { label: "Work" });
    const tab2 = makeEssentialTab("https://personal.com", 0, ws2.uuid, { label: "Personal" });
    const sm   = makeSyncManager([ws1, ws2], [tab1, tab2]);

    await sm.syncTabsToBookmarks();

    const meta = await sm.readSpaceMetadata();
    assert.equal(meta.size, 2);

    const workMeta = meta.get("Work");
    assert.ok(workMeta, "Work metadata should exist");
    assert.equal(workMeta.icon, "🔥");
    assert.deepEqual(workMeta.theme, { gradient: "#f00" });

    const personalMeta = meta.get("Personal");
    assert.ok(personalMeta, "Personal metadata should exist");
    assert.equal(personalMeta.icon, null);

    // Verify no UUID in the raw encoded payload.
    const PlacesUtils = sm.manager.window.PlacesUtils;
    const toolbarTree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenTabsEntry = toolbarTree.children.find(c => c.uri == null && c.title === "ZenTabs");
    const zenTabsTree  = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
    const metaFolder   = zenTabsTree.children.find(c => c.uri == null && c.title === "__spaces__");
    const metaTree     = await PlacesUtils.promiseBookmarksTree(metaFolder.guid);
    for (const bm of metaTree.children ?? []) {
      const decoded = decodeURIComponent(bm.uri.replace("data:application/json,", ""));
      const parsed  = JSON.parse(decoded);
      assert.ok(!("uuid" in parsed), `UUID must not appear in stored metadata for ${bm.title}`);
    }
  });
});

describe("space metadata — T2: updates metadata when icon changes", () => {
  test("second sync updates existing metadata bookmark URL", async () => {
    const ws  = makeWorkspace("Work");
    ws.icon   = "🔥";
    ws.theme  = {};
    const tab = makeEssentialTab("https://work.com", 0, ws.uuid, { label: "Work" });
    const sm  = makeSyncManager([ws], [tab]);

    await sm.syncTabsToBookmarks();
    ws.icon = "💼";
    const r2 = await sm.syncTabsToBookmarks();

    assert.equal(r2.errors.length, 0);
    const meta = await sm.readSpaceMetadata();
    assert.equal(meta.get("Work").icon, "💼");
  });
});

describe("space metadata — T3: deletes stale metadata when space removed", () => {
  test("metadata bookmark deleted when space no longer exists", async () => {
    const ws1  = makeWorkspace("Work");
    const ws2  = makeWorkspace("Personal");
    const tab1 = makeEssentialTab("https://work.com",     0, ws1.uuid, { label: "Work" });
    const tab2 = makeEssentialTab("https://personal.com", 0, ws2.uuid, { label: "Personal" });

    const workspaces = [ws1, ws2];
    const allTabs    = [tab1, tab2];
    const mgr = makeManager({ workspaces, tabs: allTabs });
    const sm  = new SimpleBookmarkSyncManager(mgr);

    await sm.syncTabsToBookmarks();

    // Remove ws2/tab2 from the live arrays the mock returns.
    workspaces.splice(1, 1);
    allTabs.splice(1, 1);

    await sm.syncTabsToBookmarks();

    const meta = await sm.readSpaceMetadata();
    assert.equal(meta.size, 1);
    assert.ok(meta.has("Work"),     "Work metadata should remain");
    assert.ok(!meta.has("Personal"), "Personal metadata should be deleted");
  });
});

describe("space metadata — T4: readSpaceMetadata round-trips icon and theme", () => {
  test("icon and theme values match what was written", async () => {
    const ws  = makeWorkspace("Research");
    ws.icon   = "🔬";
    ws.theme  = { bg: "#001", fg: "#fff", accent: "#0f0" };
    const tab = makeEssentialTab("https://arxiv.org", 0, ws.uuid, { label: "arXiv" });
    const sm  = makeSyncManager([ws], [tab]);

    await sm.syncTabsToBookmarks();

    const meta   = await sm.readSpaceMetadata();
    const parsed = meta.get("Research");
    assert.equal(parsed.icon, "🔬");
    assert.deepEqual(parsed.theme, { bg: "#001", fg: "#fff", accent: "#0f0" });
  });
});

describe("space metadata — T5: readSpaceMetadata returns empty Map when no folder", () => {
  test("returns empty Map without error on fresh install", async () => {
    const sm  = makeSyncManager([], []);
    const meta = await sm.readSpaceMetadata();
    assert.ok(meta instanceof Map);
    assert.equal(meta.size, 0);
  });
});

describe("space metadata — T6: theme survives JSON round-trip", () => {
  test("deeply nested theme object is preserved exactly", async () => {
    const ws  = makeWorkspace("Design");
    ws.icon   = null;
    ws.theme  = { colors: { primary: "#aaa", secondary: "#bbb" }, opacity: 0.9 };
    const tab = makeEssentialTab("https://figma.com", 0, ws.uuid, { label: "Figma" });
    const sm  = makeSyncManager([ws], [tab]);

    await sm.syncTabsToBookmarks();

    const meta = await sm.readSpaceMetadata();
    assert.deepEqual(meta.get("Design").theme, ws.theme);
  });
});

describe("space metadata — T7: SVG icon URL stored and read back unchanged", () => {
  test("chrome:// SVG icon URL is preserved verbatim", async () => {
    const ws  = makeWorkspace("Dev");
    ws.icon   = "chrome://browser/skin/devtools.svg";
    ws.theme  = {};
    const tab = makeEssentialTab("https://devtools.example.com", 0, ws.uuid, { label: "Dev" });
    const sm  = makeSyncManager([ws], [tab]);

    await sm.syncTabsToBookmarks();

    const meta = await sm.readSpaceMetadata();
    assert.equal(meta.get("Dev").icon, "chrome://browser/skin/devtools.svg");
  });
});

// ── Rename detection (R1–R5) ─────────────────────────────────────────────

describe("rename detection — R1: high-similarity rename", () => {
  test("bookmark folder renamed in-place when space is renamed with same tabs", async () => {
    const ws  = makeWorkspace("Work");
    const tab = makeEssentialTab("https://work.com", 0, ws.uuid, { label: "Work" });
    const workspaces = [ws];
    const allTabs    = [tab];
    const mgr = makeManager({ workspaces, tabs: allTabs });
    const sm  = new SimpleBookmarkSyncManager(mgr);

    await sm.syncTabsToBookmarks();

    // Rename the space — mutate the live object.
    ws.name = "Work 2";

    const r2 = await sm.syncTabsToBookmarks();
    assert.equal(r2.errors.length, 0);

    // "Work 2" folder should exist; "Work" folder should not.
    const PlacesUtils = mgr.window.PlacesUtils;
    const toolbarTree = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenTabsEntry = toolbarTree.children.find(c => c.uri == null && c.title === "ZenTabs");
    const zenTabsTree  = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
    const titles = (zenTabsTree.children ?? [])
      .filter(c => c.uri == null && c.title !== "__spaces__")
      .map(c => c.title);

    assert.ok(titles.includes("Work 2"), `Expected "Work 2" in [${titles}]`);
    assert.ok(!titles.includes("Work"),  `"Work" should be gone after rename`);

    // Metadata bookmark should also be renamed.
    const meta = await sm.readSpaceMetadata();
    assert.ok(meta.has("Work 2"),  "Metadata should have 'Work 2'");
    assert.ok(!meta.has("Work"),   "Metadata should not have 'Work'");
  });
});

describe("rename detection — R2: delete + new when no URL overlap", () => {
  test("old folder deleted and new folder created when URLs differ completely", async () => {
    const ws1  = makeWorkspace("Work");
    const tab1 = makeEssentialTab("https://work.com", 0, ws1.uuid, { label: "Work" });
    const mgr1 = makeManager({ workspaces: [ws1], tabs: [tab1] });
    const sm1  = new SimpleBookmarkSyncManager(mgr1);

    await sm1.syncTabsToBookmarks();

    // Second sync: completely different workspace + URL → Jaccard = 0 → delete + new.
    const ws2  = makeWorkspace("Personal");
    const tab2 = makeEssentialTab("https://personal.com", 0, ws2.uuid, { label: "Personal" });
    const mgr2 = makeManager({ workspaces: [ws2], tabs: [tab2] });
    mgr2.window.PlacesUtils = mgr1.window.PlacesUtils; // share same bookmark store
    const sm2  = new SimpleBookmarkSyncManager(mgr2);

    const r2 = await sm2.syncTabsToBookmarks();
    assert.equal(r2.errors.length, 0);

    const PlacesUtils  = mgr2.window.PlacesUtils;
    const toolbarTree  = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenTabsEntry = toolbarTree.children.find(c => c.uri == null && c.title === "ZenTabs");
    const zenTabsTree  = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
    const titles = (zenTabsTree.children ?? [])
      .filter(c => c.uri == null && c.title !== "__spaces__")
      .map(c => c.title);

    assert.ok(titles.includes("Personal"), `Expected "Personal" in [${titles}]`);
    assert.ok(!titles.includes("Work"),    `"Work" should have been deleted`);
  });
});

describe("rename detection — R3: two spaces swap names, no URL overlap", () => {
  test("both treated as delete + new when cross-pair similarity is 0", async () => {
    const wsA  = makeWorkspace("Alpha");
    const wsB  = makeWorkspace("Beta");
    const tabA = makeEssentialTab("https://alpha.com", 0, wsA.uuid, { label: "A" });
    const tabB = makeEssentialTab("https://beta.com",  1, wsB.uuid, { label: "B" });
    const workspaces = [wsA, wsB];
    const allTabs    = [tabA, tabB];
    const mgr = makeManager({ workspaces, tabs: allTabs });
    const sm  = new SimpleBookmarkSyncManager(mgr);

    await sm.syncTabsToBookmarks();

    // Swap names but keep the same distinct URLs → cross-pair Jaccard = 0.
    wsA.name = "Beta";
    wsB.name = "Alpha";

    const r2 = await sm.syncTabsToBookmarks();
    assert.equal(r2.errors.length, 0);

    // Both "Alpha" and "Beta" should still exist (they were re-created).
    const PlacesUtils  = mgr.window.PlacesUtils;
    const toolbarTree  = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenTabsEntry = toolbarTree.children.find(c => c.uri == null && c.title === "ZenTabs");
    const zenTabsTree  = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
    const titles = (zenTabsTree.children ?? [])
      .filter(c => c.uri == null && c.title !== "__spaces__")
      .map(c => c.title);

    assert.ok(titles.includes("Alpha"), `Expected "Alpha" in [${titles}]`);
    assert.ok(titles.includes("Beta"),  `Expected "Beta" in [${titles}]`);
    assert.equal(r2.errors.length, 0);
  });
});

describe("rename detection — R4: empty space renamed treated as delete + new", () => {
  test("empty spaces have similarity 0 — treated as delete + new", async () => {
    // First sync with "Work" that has NO syncable tabs → no folder created.
    // Rename to "Work 2" → nothing to rename because the folder never existed.
    const ws  = makeWorkspace("Work");
    const workspaces = [ws];
    const allTabs    = []; // no tabs → no folder
    const mgr = makeManager({ workspaces, tabs: allTabs });
    const sm  = new SimpleBookmarkSyncManager(mgr);

    await sm.syncTabsToBookmarks(); // creates no space folder

    ws.name = "Work 2";
    const r2 = await sm.syncTabsToBookmarks();
    assert.equal(r2.errors.length, 0);

    // No folder should exist since there are still no tabs.
    const PlacesUtils  = mgr.window.PlacesUtils;
    const toolbarTree  = await PlacesUtils.promiseBookmarksTree(PlacesUtils.bookmarks.toolbarGuid);
    const zenTabsEntry = toolbarTree.children?.find(c => c.uri == null && c.title === "ZenTabs");
    if (zenTabsEntry) {
      const zenTabsTree = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
      const titles = (zenTabsTree.children ?? [])
        .filter(c => c.uri == null && c.title !== "__spaces__")
        .map(c => c.title);
      assert.ok(!titles.includes("Work"),   "Empty 'Work' folder should not exist");
      assert.ok(!titles.includes("Work 2"), "Empty 'Work 2' folder should not exist");
    }
  });
});

describe("rename detection — _jaccard helper", () => {
  test("returns 0 for two empty sets", () => {
    const mgr = makeManager();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm._jaccard(new Set(), new Set()), 0);
  });

  test("returns 1 for identical sets", () => {
    const mgr = makeManager();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    const s   = new Set(["a", "b", "c"]);
    assert.equal(sm._jaccard(s, s), 1);
  });

  test("returns 0 for fully disjoint sets", () => {
    const mgr = makeManager();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    assert.equal(sm._jaccard(new Set(["a"]), new Set(["b"])), 0);
  });

  test("returns 0.5 for half-overlapping sets", () => {
    const mgr = makeManager();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    // |{a,b} ∩ {b,c}| / |{a,b,c}| = 1/3? No: {a,b} ∩ {b,c} = {b}, union = {a,b,c} → 1/3
    // For 0.5: {a,b} ∩ {a,c} = {a}, union = {a,b,c} → 1/3
    // For exactly 0.5: {a,b} and {a,b,c,d} → 2/4 = 0.5
    assert.equal(sm._jaccard(new Set(["a","b"]), new Set(["a","b","c","d"])), 0.5);
  });
});

// ── _isEssentialsFolder ───────────────────────────────────────────────────

describe("_isEssentialsFolder", () => {
  const sm = new SimpleBookmarkSyncManager(makeManager());

  test("returns true for 'Essentials'", () => {
    assert.ok(sm._isEssentialsFolder("Essentials"));
  });

  test("returns true for 'Essentials - Work'", () => {
    assert.ok(sm._isEssentialsFolder("Essentials - Work"));
  });

  test("returns true for 'Essentials - My Container'", () => {
    assert.ok(sm._isEssentialsFolder("Essentials - My Container"));
  });

  test("returns false for 'Dev Tools'", () => {
    assert.ok(!sm._isEssentialsFolder("Dev Tools"));
  });

  test("returns false for 'Temporary tabs'", () => {
    assert.ok(!sm._isEssentialsFolder("Temporary tabs"));
  });

  test("returns false for empty string", () => {
    assert.ok(!sm._isEssentialsFolder(""));
  });
});

// ── _buildDesiredEssentials ───────────────────────────────────────────────

describe("_buildDesiredEssentials", () => {
  const sm = new SimpleBookmarkSyncManager(makeManager());

  test("returns empty array when no essentials anywhere", () => {
    const result = sm._buildDesiredEssentials([
      { name: "Work", essentials: [], pinned: [] },
    ]);
    assert.deepEqual(result, []);
  });

  test("returns items from a single essentials folder", () => {
    const result = sm._buildDesiredEssentials([{
      name: "Work",
      essentials: [{
        containerName: "Essentials",
        items: [{ url: "https://a.com", title: "A" }],
      }],
      pinned: [],
    }]);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, "https://a.com");
    assert.equal(result[0].containerName, "Essentials");
  });

  test("deduplicates identical url+containerName across two spaces", () => {
    const entry = { url: "https://a.com", title: "A" };
    const result = sm._buildDesiredEssentials([
      { name: "Work",     essentials: [{ containerName: "Essentials", items: [entry] }], pinned: [] },
      { name: "Personal", essentials: [{ containerName: "Essentials", items: [entry] }], pinned: [] },
    ]);
    assert.equal(result.length, 1, "duplicate across spaces must be collapsed");
  });

  test("keeps same URL in different containers as separate entries", () => {
    const result = sm._buildDesiredEssentials([{
      name: "Work",
      essentials: [
        { containerName: "Essentials",        items: [{ url: "https://a.com", title: "A" }] },
        { containerName: "Essentials - Work", items: [{ url: "https://a.com", title: "A" }] },
      ],
      pinned: [],
    }]);
    assert.equal(result.length, 2, "same URL in different containers = separate entries");
  });

  test("keeps distinct URLs as separate entries", () => {
    const result = sm._buildDesiredEssentials([{
      name: "Work",
      essentials: [{
        containerName: "Essentials",
        items: [
          { url: "https://a.com", title: "A" },
          { url: "https://b.com", title: "B" },
        ],
      }],
      pinned: [],
    }]);
    assert.equal(result.length, 2);
  });
});

// ── _parseBookmarkTree ────────────────────────────────────────────────────

/**
 * Build a minimal bookmark store for _parseBookmarkTree tests.
 * Returns { sm, zenTabsGuid } — the sync manager and the guid of ZenTabs/.
 *
 * Tree shape produced:
 *   ZenTabs/                   guid: "zt"
 *   └── Work/                  guid: "ws-work"
 *       ├── Essentials/        guid: "ess-work"
 *       │   └── mail.com       guid: "bm-mail",  uri: "https://mail.com"
 *       ├── https://gh.com     guid: "bm-gh"  (direct bookmark = root pinned)
 *       └── Dev/               guid: "folder-dev"
 *           └── https://vs.com guid: "bm-vs"
 */
function makeSyncManagerForParseTree() {
  const mgr = makeManager();
  const store = mgr.window.PlacesUtils.bookmarks._store;

  // Clear the default toolbar entry and seed our own tree.
  store.clear();
  store.set("zt",          { guid: "zt",          parentGuid: null,      type: "folder",   title: "ZenTabs",    url: null });
  store.set("ws-work",     { guid: "ws-work",      parentGuid: "zt",      type: "folder",   title: "Work",       url: null });
  store.set("ess-work",    { guid: "ess-work",     parentGuid: "ws-work", type: "folder",   title: "Essentials", url: null });
  store.set("bm-mail",     { guid: "bm-mail",      parentGuid: "ess-work",type: "bookmark", title: "Mail",       url: "https://mail.com" });
  store.set("bm-gh",       { guid: "bm-gh",        parentGuid: "ws-work", type: "bookmark", title: "GitHub",     url: "https://gh.com" });
  store.set("folder-dev",  { guid: "folder-dev",   parentGuid: "ws-work", type: "folder",   title: "Dev",        url: null });
  store.set("bm-vs",       { guid: "bm-vs",        parentGuid: "folder-dev", type: "bookmark", title: "VSCode", url: "https://vs.com" });

  return { sm: new SimpleBookmarkSyncManager(mgr), zenTabsGuid: "zt" };
}

/** Helper: get the ZenTabs tree node for _parseBookmarkTree tests. */
async function getZenTabsNode(sm, guid) {
  return sm.manager.window.PlacesUtils.promiseBookmarksTree(guid);
}

describe("_parseBookmarkTree", () => {
  test("returns one space descriptor per top-level folder (skipping __spaces__)", async () => {
    const { sm, zenTabsGuid } = makeSyncManagerForParseTree();
    const node = await getZenTabsNode(sm, zenTabsGuid);
    const spaces = sm._parseBookmarkTree(node);
    assert.equal(spaces.length, 1);
    assert.equal(spaces[0].name, "Work");
  });

  test("skips __spaces__ folder", async () => {
    const { sm, zenTabsGuid } = makeSyncManagerForParseTree();
    const store = sm.manager.window.PlacesUtils.bookmarks._store;
    store.set("meta", { guid: "meta", parentGuid: "zt", type: "folder", title: "__spaces__", url: null });
    const node = await getZenTabsNode(sm, zenTabsGuid);
    const spaces = sm._parseBookmarkTree(node);
    assert.ok(!spaces.find(s => s.name === "__spaces__"), "__spaces__ must be excluded");
  });

  test("essentials folder is parsed correctly", async () => {
    const { sm, zenTabsGuid } = makeSyncManagerForParseTree();
    const node = await getZenTabsNode(sm, zenTabsGuid);
    const spaces = sm._parseBookmarkTree(node);
    const work = spaces[0];
    assert.equal(work.essentials.length, 1);
    assert.equal(work.essentials[0].containerName, "Essentials");
    assert.equal(work.essentials[0].items.length, 1);
    assert.equal(work.essentials[0].items[0].url, "https://mail.com");
    assert.equal(work.essentials[0].items[0].title, "Mail");
  });

  test("direct bookmark in space folder → root-level pinned", async () => {
    const { sm, zenTabsGuid } = makeSyncManagerForParseTree();
    const node = await getZenTabsNode(sm, zenTabsGuid);
    const spaces = sm._parseBookmarkTree(node);
    const work = spaces[0];
    const rootPinned = work.pinned.filter(i => i.type === "bookmark");
    assert.equal(rootPinned.length, 1);
    assert.equal(rootPinned[0].url, "https://gh.com");
    assert.equal(rootPinned[0].title, "GitHub");
  });

  test("named subfolder → Zen folder descriptor", async () => {
    const { sm, zenTabsGuid } = makeSyncManagerForParseTree();
    const node = await getZenTabsNode(sm, zenTabsGuid);
    const spaces = sm._parseBookmarkTree(node);
    const work = spaces[0];
    const folders = work.pinned.filter(i => i.type === "folder");
    assert.equal(folders.length, 1);
    assert.equal(folders[0].title, "Dev");
    assert.equal(folders[0].children.length, 1);
    assert.equal(folders[0].children[0].url, "https://vs.com");
  });

  test("empty ZenTabs folder returns empty array", async () => {
    const mgr   = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    store.set("zt-empty", { guid: "zt-empty", parentGuid: null, type: "folder", title: "ZenTabs", url: null });
    const sm = new SimpleBookmarkSyncManager(mgr);
    const node = await getZenTabsNode(sm, "zt-empty");
    const spaces = sm._parseBookmarkTree(node);
    assert.deepEqual(spaces, []);
  });

  test("nested sub-folders are extracted as independent folder entries", async () => {
    const mgr = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    store.set("zt",           { guid: "zt",           parentGuid: null,          type: "folder",   title: "ZenTabs", url: null });
    store.set("ws-work",      { guid: "ws-work",      parentGuid: "zt",          type: "folder",   title: "Work",    url: null });
    store.set("folder-outer", { guid: "folder-outer",  parentGuid: "ws-work",     type: "folder",   title: "Outer",   url: null });
    store.set("bm-a",         { guid: "bm-a",          parentGuid: "folder-outer", type: "bookmark", title: "A",       url: "https://a.com" });
    store.set("folder-inner", { guid: "folder-inner",  parentGuid: "folder-outer", type: "folder",   title: "Inner",   url: null });
    store.set("bm-b",         { guid: "bm-b",          parentGuid: "folder-inner", type: "bookmark", title: "B",       url: "https://b.com" });

    const sm = new SimpleBookmarkSyncManager(mgr);
    const node = await getZenTabsNode(sm, "zt");
    const spaces = sm._parseBookmarkTree(node);
    const work = spaces[0];

    const folders = work.pinned.filter(i => i.type === "folder");
    assert.equal(folders.length, 2, "Outer + Inner should be two separate folder entries");

    const inner = folders.find(f => f.title === "Inner");
    assert.ok(inner, "Inner folder should exist as a top-level entry");
    assert.equal(inner.children.length, 1);
    assert.equal(inner.children[0].url, "https://b.com");

    const outer = folders.find(f => f.title === "Outer");
    assert.ok(outer, "Outer folder should exist as a top-level entry");
    assert.equal(outer.children.length, 1);
    assert.equal(outer.children[0].url, "https://a.com");
  });

  test("deeply nested bookmarks at 3+ levels are all collected", async () => {
    const mgr = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    store.set("zt",     { guid: "zt",     parentGuid: null,   type: "folder",   title: "ZenTabs",  url: null });
    store.set("ws",     { guid: "ws",     parentGuid: "zt",   type: "folder",   title: "Space",    url: null });
    store.set("f-a",    { guid: "f-a",    parentGuid: "ws",   type: "folder",   title: "A",        url: null });
    store.set("f-b",    { guid: "f-b",    parentGuid: "f-a",  type: "folder",   title: "B",        url: null });
    store.set("f-c",    { guid: "f-c",    parentGuid: "f-b",  type: "folder",   title: "C",        url: null });
    store.set("bm-deep",{ guid: "bm-deep",parentGuid: "f-c",  type: "bookmark", title: "Deep",     url: "https://deep.com" });

    const sm = new SimpleBookmarkSyncManager(mgr);
    const node = await getZenTabsNode(sm, "zt");
    const spaces = sm._parseBookmarkTree(node);
    const folders = spaces[0].pinned.filter(i => i.type === "folder");

    assert.equal(folders.length, 3, "A, B, C should all be extracted");
    const c = folders.find(f => f.title === "C");
    assert.ok(c);
    assert.equal(c.children.length, 1);
    assert.equal(c.children[0].url, "https://deep.com");
  });
});

// ── _resolveContainerName ────────────────────────────────────────────────

describe("_resolveContainerName", () => {
  test("'Essentials' resolves to 0 (default container)", async () => {
    const sm = new SimpleBookmarkSyncManager(makeManager());
    assert.equal(await sm._resolveContainerName("Essentials"), 0);
  });

  test("'Essentials - Work' resolves existing identity by name", async () => {
    const mgr = makeManager();
    // Pre-seed a container named "Work"
    mgr.window.ContextualIdentityService.create("Work", "circle", "blue");
    const sm = new SimpleBookmarkSyncManager(mgr);
    const id = await sm._resolveContainerName("Essentials - Work");
    assert.equal(typeof id, "number");
    assert.ok(id > 0, "should return the userContextId for the Work container");
  });

  test("'Essentials - New' creates a new container when not found", async () => {
    const mgr = makeManager();
    const sm = new SimpleBookmarkSyncManager(mgr);
    const idBefore = mgr.window.ContextualIdentityService.getPublicIdentities().length;
    const id = await sm._resolveContainerName("Essentials - New");
    const idAfter = mgr.window.ContextualIdentityService.getPublicIdentities().length;
    assert.equal(idAfter, idBefore + 1, "a new container should be created");
    assert.ok(id > 0);
  });

  test("returns 0 when ContextualIdentityService is unavailable", async () => {
    const mgr = makeManager();
    delete mgr.window.ContextualIdentityService;
    const sm = new SimpleBookmarkSyncManager(mgr);
    const result = await sm._resolveContainerName("Essentials - Anything");
    assert.equal(result, 0);
  });
});

// ── syncBookmarksToTabs — dry-run ─────────────────────────────────────────

describe("syncBookmarksToTabs — dry-run", () => {
  function makeSyncManagerWithTree() {
    const mgr   = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    // Toolbar → ZenTabs/ → Work/ → Essentials/ → mail.com
    //                             → GitHub (direct = pinned)
    store.set("toolbar",  { guid: "toolbar",  parentGuid: null,      type: "folder",   title: "Bookmarks Toolbar", url: null });
    store.set("zt",       { guid: "zt",       parentGuid: "toolbar", type: "folder",   title: "ZenTabs",          url: null });
    store.set("ws-work",  { guid: "ws-work",  parentGuid: "zt",      type: "folder",   title: "Work",             url: null });
    store.set("ess-work", { guid: "ess-work", parentGuid: "ws-work", type: "folder",   title: "Essentials",       url: null });
    store.set("bm-mail",  { guid: "bm-mail",  parentGuid: "ess-work",type: "bookmark", title: "Mail",             url: "https://mail.com" });
    store.set("bm-gh",    { guid: "bm-gh",    parentGuid: "ws-work", type: "bookmark", title: "GitHub",           url: "https://gh.com" });
    // Space "Work" already exists in gZenWorkspaces so no space creation needed.
    mgr.window.gZenWorkspaces = makeGZenWorkspaces(
      [{ uuid: "uuid-work", name: "Work", icon: null, theme: {}, containerTabId: 0 }],
      [] // no live tabs
    );
    return new SimpleBookmarkSyncManager(mgr);
  }

  test("result has plan array when dryRun:true", async () => {
    const sm = makeSyncManagerWithTree();
    const result = await sm.syncBookmarksToTabs({ dryRun: true });
    assert.ok(Array.isArray(result.plan), "plan must be an array");
    assert.ok(result.errors.length === 0, "no errors expected");
  });

  test("created count matches number of tabs that would be created", async () => {
    const sm = makeSyncManagerWithTree();
    const result = await sm.syncBookmarksToTabs({ dryRun: true });
    // 1 essential tab (mail.com) + 1 pinned tab (gh.com) = 2
    assert.equal(result.created, 2);
  });

  test("deleted count is 0 when no live tabs exist", async () => {
    const sm = makeSyncManagerWithTree();
    const result = await sm.syncBookmarksToTabs({ dryRun: true });
    assert.equal(result.deleted, 0);
  });

  test("plan entries contain required action field", async () => {
    const sm = makeSyncManagerWithTree();
    const result = await sm.syncBookmarksToTabs({ dryRun: true });
    for (const entry of result.plan) {
      assert.ok(typeof entry.action === "string", "each plan entry must have an action");
      assert.ok(typeof entry.description === "string", "each plan entry must have a description");
    }
  });

  test("no browser tabs are created during dry-run", async () => {
    const sm = makeSyncManagerWithTree();
    const tabsBefore = sm.manager.window.gBrowser.tabs.length;
    await sm.syncBookmarksToTabs({ dryRun: true });
    assert.equal(sm.manager.window.gBrowser.tabs.length, tabsBefore, "no tabs must be created");
  });

  test("stops gracefully when ZenTabs/ folder does not exist", async () => {
    const mgr   = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    store.set("toolbar", { guid: "toolbar", parentGuid: null, type: "folder", title: "Bookmarks Toolbar", url: null });
    const sm = new SimpleBookmarkSyncManager(mgr);
    const result = await sm.syncBookmarksToTabs({ dryRun: true });
    assert.equal(result.created, 0);
    assert.equal(result.plan?.length, 0);
  });
});

// ── syncBookmarksToTabs — live (tab creation) ─────────────────────────────

describe("syncBookmarksToTabs — live", () => {
  function makeSyncManagerWithTree() {
    const mgr   = makeManager();
    const store = mgr.window.PlacesUtils.bookmarks._store;
    store.clear();
    store.set("toolbar",  { guid: "toolbar",  parentGuid: null,      type: "folder",   title: "Bookmarks Toolbar", url: null });
    store.set("zt",       { guid: "zt",       parentGuid: "toolbar", type: "folder",   title: "ZenTabs",          url: null });
    store.set("ws-work",  { guid: "ws-work",  parentGuid: "zt",      type: "folder",   title: "Work",             url: null });
    store.set("ess-work", { guid: "ess-work", parentGuid: "ws-work", type: "folder",   title: "Essentials",       url: null });
    store.set("bm-mail",  { guid: "bm-mail",  parentGuid: "ess-work",type: "bookmark", title: "Mail",             url: "https://mail.com" });
    mgr.window.gZenWorkspaces = makeGZenWorkspaces(
      [{ uuid: "uuid-work", name: "Work", icon: null, theme: {}, containerTabId: 0 }],
      []
    );
    return mgr;
  }

  test("creates an essential tab for a bookmark in Essentials/", async () => {
    const mgr = makeSyncManagerWithTree();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    const result = await sm.syncBookmarksToTabs();
    assert.equal(result.created, 1);
    assert.equal(result.errors.length, 0);
    // The tab should have been added
    const tabs = mgr.window.gBrowser.tabs;
    const essTab = tabs.find(t => t.linkedBrowser.currentURI.spec === "https://mail.com");
    assert.ok(essTab, "essential tab should be created");
  });

  test("marks new tab as essential via gZenPinnedTabManager.addToEssentials", async () => {
    const mgr = makeSyncManagerWithTree();
    const sm  = new SimpleBookmarkSyncManager(mgr);
    await sm.syncBookmarksToTabs();
    const calls = mgr.window.gZenPinnedTabManager.addToEssentialsCalls;
    assert.ok(calls.length >= 1, "addToEssentials must be called");
    assert.ok(calls[0].hasAttribute("zen-essential"), "tab must have zen-essential attribute");
  });

  test("deletes a live essential tab that has no matching bookmark", async () => {
    const mgr = makeSyncManagerWithTree();
    // Add a stale essential tab not in bookmarks
    const staleTab = makeTab({
      url: "https://stale.com",
      pinned: true,
      attrs: { "zen-essential": "", "zen-workspace-id": "uuid-work" },
    });
    mgr.window.gBrowser.tabs.push(staleTab);
    mgr.window.gZenWorkspaces = makeGZenWorkspaces(
      [{ uuid: "uuid-work", name: "Work", icon: null, theme: {}, containerTabId: 0 }],
      [staleTab]
    );
    mgr.window.gZenWorkspaces._allStoredTabs = [staleTab];

    const sm = new SimpleBookmarkSyncManager(mgr);
    const result = await sm.syncBookmarksToTabs();
    assert.equal(result.deleted, 1);
  });

  test("does not re-create an essential tab that already exists", async () => {
    const mgr = makeSyncManagerWithTree();
    // Pre-create the tab in live state
    const existingTab = makeTab({
      url: "https://mail.com",
      pinned: true,
      attrs: { "zen-essential": "", "usercontextid": "0" },
    });
    mgr.window.gZenWorkspaces = makeGZenWorkspaces(
      [{ uuid: "uuid-work", name: "Work", icon: null, theme: {}, containerTabId: 0 }],
      [existingTab]
    );
    const sm = new SimpleBookmarkSyncManager(mgr);
    const result = await sm.syncBookmarksToTabs();
    assert.equal(result.created, 0, "existing essential tab must not be duplicated");
  });
});
