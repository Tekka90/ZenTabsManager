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
      // Real Firefox promiseBookmarksTree returns integer types from nsINavBookmarksService:
      //   TYPE_FOLDER = 6 (nsINavHistoryResultNode.RESULT_TYPE_FOLDER)
      //   TYPE_BOOKMARK = 5 (nsINavHistoryResultNode.RESULT_TYPE_URI)
      // These do NOT match PlacesUtils.bookmarks.TYPE_FOLDER ("folder" string).
      // Code must not use TYPE_FOLDER to detect folder nodes in tree output.
      type:     node.type === "folder" ? 6 : 5,
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

    async fetch(guid) {
      const entry = bm.get(guid);
      if (!entry) return null;
      return entry;
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
  const tab = {
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
      // Optional internal session data for lazy/pending tab simulation
      __SS_data: overrides.__SS_data ?? undefined,
    },
    hasAttribute(name) { return attrs.has(name); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    setAttribute(name, val) { attrs.set(name, val); },
    removeAttribute(name) { attrs.delete(name); },
    _attrs: attrs,
  };
  if (overrides._zenPinnedInitialState !== undefined) {
    tab._zenPinnedInitialState = overrides._zenPinnedInitialState;
  }
  return tab;
}

export function makeGBrowser(tabs = []) {
  const openTabs = [...tabs];
  const removed = [];
  const discarded = [];
  const addTabCalls = []; // records { url, opts } for every addTab invocation
  return {
    get tabs() { return openTabs; },
    get _addTabCalls() { return addTabCalls; },
    addTab(url, opts) {
      addTabCalls.push({ url, opts: { ...opts } });
      const tab = makeTab({ url, lastAccessed: Date.now() });
      if (opts?.userContextId !== undefined) tab.setAttribute("usercontextid", String(opts.userContextId));
      if (opts?.lazyTabTitle) tab.setAttribute("label", opts.lazyTabTitle);
      openTabs.push(tab);
      return tab;
    },
    addTrustedTab(url, opts) {
      addTabCalls.push({ url, opts: { ...opts, trusted: true } });
      const tab = makeTab({ url, lastAccessed: Date.now() });
      if (opts?.userContextId !== undefined) tab.setAttribute("usercontextid", String(opts.userContextId));
      if (opts?.lazyTabTitle) tab.setAttribute("label", opts.lazyTabTitle);
      openTabs.push(tab);
      return tab;
    },
    removeTab(tab) {
      const idx = openTabs.indexOf(tab);
      if (idx !== -1) openTabs.splice(idx, 1);
      removed.push(tab);
    },
    discardBrowser(tab) {
      tab.setAttribute("discarded", "");
      discarded.push(tab);
    },
    pinTab(tab) {
      tab.pinned = true;
    },
    moveTabTo(tab, opts) {
      const newIndex = typeof opts === "number" ? opts : opts?.tabIndex ?? 0;
      tab._tPos = newIndex;
    },
    tabContainer: { addEventListener: () => {} },
    _removed: removed,
    _discarded: discarded,
  };
}

// ── Workspaces (gZenWorkspaces) ───────────────────────────────────────────

export function makeGZenWorkspaces(workspaces = [], allTabs = []) {
  const byUuid = new Map(workspaces.map(ws => [ws.uuid, ws]));
  let _counter = 1;
  let _activeUuid = workspaces[0]?.uuid ?? null;
  let _switchCount = 0;
  let _allStoredTabs = allTabs;
  const obj = {
    getWorkspaces: ()           => workspaces,
    getWorkspaceFromId: (uuid)  => byUuid.get(uuid) ?? null,
    isWorkspaceActive: (ws)     => ws.uuid === _activeUuid,
    get activeWorkspace()       { return _activeUuid; },
    // Allow tests to set the active uuid directly without async changeWorkspaceWithID
    set _activeUuid(uuid)       { _activeUuid = uuid; },
    get _activeUuid()           { return _activeUuid; },
    get allStoredTabs()         { return _allStoredTabs; },
    set allStoredTabs(val)      { _allStoredTabs = val; },
    get _allStoredTabs()        { return _allStoredTabs; },
    set _allStoredTabs(val)     { _allStoredTabs = val; },
    get switchCount()           { return _switchCount; },
    async changeWorkspaceWithID(uuid) {
      _switchCount++;
      if (byUuid.has(uuid)) _activeUuid = uuid;
    },
    async createAndSaveWorkspace(name, icon = null, dontChange = false, containerTabId = 0) {
      const uuid = `uuid-created-${_counter++}`;
      const ws = { uuid, name, icon, theme: {}, containerTabId };
      workspaces.push(ws);
      byUuid.set(uuid, ws);
      if (!dontChange) _activeUuid = uuid;
      return ws;
    },
    async saveWorkspace(workspaceData) {
      const existing = byUuid.get(workspaceData.uuid);
      if (existing) Object.assign(existing, workspaceData);
    },
    moveTabToWorkspace(tab, uuid) {
      tab.setAttribute("zen-workspace-id", uuid);
    },
  };
  return obj;
}

// ── Zen Folders (gZenFolders) ───────────────────────────────────────────

// ── ContextualIdentityService (Firefox containers) ──────────────────────

export function makeContextualIdentityService(initialIdentities = []) {
  let _nextId = 100;
  const _identities = [...initialIdentities];
  return {
    create(name, icon, color) {
      const identity = { userContextId: _nextId++, name, icon, color };
      _identities.push(identity);
      return identity;
    },
    getPublicIdentities() {
      return [..._identities];
    },
    _identities,
  };
}

// ── Zen Folders (gZenFolders) ───────────────────────────────────────────────

export function makeGZenFolders() {
  const createdFolders = [];
  return {
    createFolder(tabs, options = {}) {
      // Mirror real behaviour: pin all non-essential tabs
      for (const tab of tabs) {
        tab.pinned = true;
      }

      // Simulate the DOM-like groupContainer that the real Zen folder
      // element exposes.  In the real browser, nesting is achieved by
      // inserting the child folder's DOM node inside the parent's
      // groupContainer.  `lastElementChild` is used by the SyncManager
      // to tell the next createFolder call where to insert.
      const containerChildren = [];
      // Zen always creates an empty tab inside the folder
      containerChildren.push({ _emptyTab: true });
      for (const tab of tabs) {
        containerChildren.push(tab);
      }

      const groupContainer = {
        get lastElementChild() {
          return containerChildren[containerChildren.length - 1] || null;
        },
        _children: containerChildren,
      };

      const entry = {
        label: options.label,
        workspaceId: options.workspaceId,
        parentFolder: null,
        tabs: [...tabs],
        groupContainer,
        isZenFolder: true,
        // Allow the chain to walk up: entry.group points to the parent
        // folder's group object (set below if nested).
        group: null,
        // Support addTabs for appending tabs to an existing folder.
        addTabs(newTabs) {
          for (const t of newTabs) {
            t.pinned = true;
            t.group = entry;
            groupContainer._children.push(t);
            entry.tabs.push(t);
          }
        },
      };

      // Set tab.group on all tabs to point to this folder entry.
      for (const tab of tabs) {
        tab.group = entry;
      }

      // Resolve parent folder from `insertAfter` (DOM-based nesting).
      // If `insertAfter` is an element that belongs to another folder's
      // groupContainer, then this folder is nested inside that parent.
      if (options.insertAfter) {
        for (const folder of createdFolders) {
          if (folder.groupContainer._children.includes(options.insertAfter)) {
            entry.parentFolder = folder;
            entry.group = folder; // chain walk: entry.group → parent folder
            folder.groupContainer._children.push(entry);
            break;
          }
        }
      }

      createdFolders.push(entry);
      return entry;
    },
    _createdFolders: createdFolders,
  };
}

// ── IOUtils / PathUtils (file I/O) ────────────────────────────────────────

export function makeIOUtils(initialFiles = {}) {
  const _store = new Map(Object.entries(initialFiles));
  const _dirs  = new Set();
  return {
    async exists(path)                    { return _store.has(path); },
    async readUTF8(path)                  {
      if (!_store.has(path)) throw new Error(`File not found: ${path}`);
      return _store.get(path);
    },
    async writeUTF8(path, content)        { _store.set(path, content); },
    async makeDirectory(path)             { _dirs.add(path); },
    async getChildren(dir)                {
      return [..._store.keys()].filter(p => {
        const parent = p.substring(0, p.lastIndexOf("/"));
        return parent === dir;
      });
    },
    async remove(path)                    { _store.delete(path); },
    _store,
    _dirs,
  };
}

export function makePathUtils(profileDir = "/tmp/test-profile") {
  return {
    profileDir,
    join: (...parts) => parts.join("/"),
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
  const gZenFolders    = makeGZenFolders();
  const ContextualIdentityService = makeContextualIdentityService();
  const gZenPinnedTabManager = {
    addToEssentialsCalls: [],
    addToEssentials(tab) {
      // Match Zen's real behavior: skip tabs that already have zen-essential
      if (tab.hasAttribute("zen-essential")) return false;
      tab.setAttribute("zen-essential", "true");
      if (tab.hasAttribute("zen-workspace-id")) {
        tab.removeAttribute("zen-workspace-id");
      }
      tab.pinned = true;
      this.addToEssentialsCalls.push(tab);
      return true;
    },
  };
  const ioUtils   = makeIOUtils();
  const pathUtils = makePathUtils();

  // Expose globals for modules that reference them directly.
  globalThis.Services  = Services;
  globalThis.IOUtils   = ioUtils;
  globalThis.PathUtils = pathUtils;
  // dump() writes to browser stdout in the chrome context; no-op in tests.
  if (typeof globalThis.dump === "undefined") globalThis.dump = () => {};

  const defaultPrefs = {
    enabled:              true,
    syncEnabled:          true,
    syncDirection:        "bidirectional",
    syncInterval:         0,
    syncCloseRemovedTabs: false,
    cleanupEnabled:       false,
    cleanupAge:           7,
    cleanupAgeUnit:       "days",
    cleanupExcludeDomains: "",
    memoryOptimization:   false,
    memoryThreshold:      80,
    autoUnloadEnabled:    false,
    autoUnloadDelay:      3600,
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
      gZenFolders,
      gZenPinnedTabManager,
      ContextualIdentityService,
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
