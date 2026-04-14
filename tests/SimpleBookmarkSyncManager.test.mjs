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
