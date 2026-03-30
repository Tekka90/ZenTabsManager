/**
 * Browser API mocks for ZenTabsManager unit tests.
 *
 * The mod runs in a Zen Browser privileged chrome context where APIs like
 * Services, PlacesUtils, gBrowser, and gZenWorkspaces are globals. This file
 * provides lightweight in-memory stubs that mirror the shapes the code relies on.
 */

// ── Prefs ─────────────────────────────────────────────────────────────────

export function makePrefBranch(initial = {}) {
  const store = { ...initial };
  return {
    prefHasUserValue: (key) => key in store,
    getStringPref:    (key, def) => store[key] ?? def,
    setStringPref:    (key, val) => { store[key] = val; },
    _store: store,
  };
}

export function makeServices(prefStore = {}) {
  const branches = {};
  return {
    prefs: {
      getBranch(prefix) {
        if (!branches[prefix]) branches[prefix] = makePrefBranch(prefStore[prefix] ?? {});
        return branches[prefix];
      }
    },
    scriptSecurityManager: {
      getSystemPrincipal: () => ({ isSystemPrincipal: true }),
    },
    _branches: branches,
  };
}

// ── Bookmark (PlacesUtils) ────────────────────────────────────────────────

let _guidCounter = 1;
function nextGuid() { return `guid-${_guidCounter++}`; }

/**
 * In-memory bookmark store that mirrors the PlacesUtils.bookmarks API surface.
 * Supports: insert, remove, update, search, TYPE_BOOKMARK, TYPE_FOLDER.
 * Also provides promiseBookmarksTree (used by getAllBookmarksInFolder).
 */
export function makePlacesUtils() {
  // bookmarks: Map<guid, { guid, parentGuid, type, title, url? }>
  const bm = new Map();

  // Seed with the standard toolbar root
  bm.set("toolbar", { guid: "toolbar", parentGuid: null, type: "folder", title: "Bookmarks Toolbar", children: [] });

  function getChildren(parentGuid) {
    return [...bm.values()].filter(b => b.parentGuid === parentGuid);
  }

  function buildTree(guid) {
    const node = bm.get(guid);
    if (!node) return null;
    const children = getChildren(guid).map(c => buildTree(c.guid)).filter(Boolean);
    return {
      guid:     node.guid,
      title:    node.title,
      uri:      node.url ?? null,
      type:     node.type === "folder" ? "folder" : "bookmark",
      children: children.length ? children : undefined,
    };
  }

  const bookmarks = {
    TYPE_BOOKMARK: "bookmark",
    TYPE_FOLDER:   "folder",
    toolbarGuid:   "toolbar",

    async insert({ parentGuid, type, title, url }) {
      const guid = nextGuid();
      bm.set(guid, { guid, parentGuid, type, title, url: url ?? null });
      return { guid, parentGuid, type, title, url };
    },

    async remove(guid) {
      // Remove recursively
      function removeRec(g) {
        bm.delete(g);
        getChildren(g).forEach(c => removeRec(c.guid));
      }
      removeRec(guid);
    },

    async update({ guid, title, url }) {
      const entry = bm.get(guid);
      if (!entry) throw new Error(`Bookmark not found: ${guid}`);
      if (title !== undefined) entry.title = title;
      if (url   !== undefined) entry.url   = url;
      return entry;
    },

    async search({ url, query, type } = {}) {
      return [...bm.values()].filter(b => {
        if (url   && b.url   !== url)   return false;
        if (query && !b.title?.includes(query)) return false;
        if (type  && b.type  !== type)  return false;
        return true;
      });
    },

    // Direct access for test inspection
    _store: bm,
    _getChildren: getChildren,
  };

  const PlacesUtils = {
    bookmarks,
    async promiseBookmarksTree(guid) {
      return buildTree(guid);
    },
  };

  return PlacesUtils;
}

// ── Tabs / gBrowser ───────────────────────────────────────────────────────

export function makeTab(overrides = {}) {
  const attrs = new Map(Object.entries(overrides.attrs ?? {}));
  return {
    _tPos:        overrides._tPos ?? 0,
    pinned:       overrides.pinned       ?? false,
    hidden:       overrides.hidden       ?? false,
    selected:     overrides.selected     ?? false,
    muted:        overrides.muted        ?? false,
    soundPlaying: overrides.soundPlaying ?? false,
    label:        overrides.label        ?? overrides.title ?? "Untitled",
    image:        overrides.favicon      ?? null,
    lastAccessed: overrides.lastAccessed ?? Date.now(),
    createdAt:    overrides.createdAt    ?? Date.now(),
    userContextId: overrides.userContextId ?? 0,
    group:        overrides.group        ?? null,
    linkedBrowser: {
      currentURI: { spec: overrides.url ?? "about:blank" },
      isRemoteBrowser: true,
    },
    hasAttribute(name) { return attrs.has(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, val) { attrs.set(name, val); },
    removeAttribute(name) { attrs.delete(name); },
    _attrs: attrs,
  };
}

export function makeGBrowser(tabs = []) {
  const openTabs = [...tabs];
  const removed = [];
  return {
    get tabs() { return openTabs; },
    addTab(url, opts) {
      const tab = makeTab({ url, lastAccessed: Date.now() });
      openTabs.push(tab);
      return tab;
    },
    removeTab(tab) {
      const idx = openTabs.indexOf(tab);
      if (idx !== -1) openTabs.splice(idx, 1);
      removed.push(tab);
    },
    tabContainer: { addEventListener: () => {} },
    _removed: removed,
  };
}

// ── Workspaces (gZenWorkspaces) ───────────────────────────────────────────

export function makeGZenWorkspaces(workspaces = [], allTabs = []) {
  const byUuid = new Map(workspaces.map(ws => [ws.uuid, ws]));
  return {
    getWorkspaces: ()           => workspaces,
    getWorkspaceFromId: (uuid)  => byUuid.get(uuid) ?? null,
    isWorkspaceActive: (ws)     => false,
    get activeWorkspace()       { return workspaces[0]?.uuid ?? null; },
    get allStoredTabs()         { return allTabs; },
  };
}

// ── Manager stub (central coordinator) ────────────────────────────────────

/**
 * Minimal stub of ZenTabsManager that SyncManager / TabManager / CleanupManager
 * receive as `this.manager`.
 */
export function makeManager({
  preferences = {},
  workspaces  = [],
  tabs        = [],
  prefStore   = {},
} = {}) {
  const Services    = makeServices(prefStore);
  const PlacesUtils = makePlacesUtils();
  const gBrowser    = makeGBrowser(tabs);
  const gZenWorkspaces = makeGZenWorkspaces(workspaces, tabs);

  // Expose Services as a global for modules that reference it directly
  // (SyncManager calls Services.prefs and Services.scriptSecurityManager)
  globalThis.Services = Services;

  const defaultPrefs = {
    enabled:              true,
    syncEnabled:          true,
    syncDirection:        "bidirectional",
    syncInterval:         0,
    syncCloseRemovedTabs: false,
    cleanupEnabled:       false,
    cleanupAge:           7,
    cleanupExcludeDomains: "",
    memoryOptimization:   false,
    memoryThreshold:      80,
    keepEssentialTabs:    true,
    keepPinnedTabs:       true,
    showToolbarButton:    false,
    debugMode:            false,
    ...preferences,
  };

  const events = new EventTarget();

  const manager = {
    preferences: defaultPrefs,
    window: {
      PlacesUtils,
      gBrowser,
      gZenWorkspaces,
      Services,
      setInterval:   (fn, ms) => null,
      clearInterval: () => {},
    },
    log:   (...args) => { /* silent in tests */ },
    on:    (type, cb) => events.addEventListener(type, e => cb(e.detail)),
    dispatchEvent: (type, data) =>
      events.dispatchEvent(new CustomEvent(type, { detail: data })),
    getPreferences: () => ({ ...defaultPrefs }),
    setPreferences: async (p) => { Object.assign(defaultPrefs, p); },
    tabManager: null, // set by caller after TabManager.init()
  };

  return manager;
}
