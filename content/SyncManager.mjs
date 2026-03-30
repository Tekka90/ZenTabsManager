/**
 * SyncManager - Bi-directional bookmark synchronization
 *
 * Sync strategy: bookmark folder is the cross-computer shared channel (via Firefox Sync).
 * A local manifest (stored in Services.prefs) records what both sides last agreed on.
 * Comparing manifest vs. current tabs vs. current bookmarks drives all decisions.
 *
 * Decision table (per URL per Space):
 *   in T, not in M            → opened locally since last sync  → push to bookmarks
 *   in M, not in T, in B      → closed locally since last sync  → delete from bookmarks
 *   in B, not in M, not in T  → added on another computer       → open as tab
 *   in M, not in B, in T      → deleted on another computer     → close tab (if pref enabled)
 *
 * On first install manifest = ∅, which is the correct bootstrap state.
 */

export class SyncManager {
  constructor(manager) {
    this.manager = manager;
    this.bookmarkMap = new Map(); // URL -> bookmark GUID
    this.lastSyncTime = 0;
    this.syncInProgress = false;
    this.log("SyncManager created");
  }

  async init() {
    this.log("SyncManager initializing...");
    await this.rebuildBookmarkCache();
    this.setupBookmarkObserver();
    this.log("SyncManager initialized");
  }

  // ── Manifest persistence ────────────────────────────────────────────────

  /**
   * Load the sync manifest from prefs.
   * @returns {Map<string, Set<string>>} spaceUuid → Set of URLs
   */
  loadManifest() {
    try {
      const prefBranch = Services.prefs.getBranch("zentabs.");
      if (!prefBranch.prefHasUserValue("syncManifest")) return new Map();
      const stored = JSON.parse(prefBranch.getStringPref("syncManifest", "{}"));
      const manifest = new Map();
      for (const [uuid, urls] of Object.entries(stored)) {
        manifest.set(uuid, new Set(urls));
      }
      return manifest;
    } catch (e) {
      console.error("[ZenTabs] Failed to load sync manifest:", e);
      return new Map();
    }
  }

  /**
   * Persist the sync manifest to prefs.
   * @param {Map<string, Set<string>>} manifest
   */
  saveManifest(manifest) {
    try {
      const obj = {};
      for (const [uuid, urls] of manifest) {
        obj[uuid] = [...urls];
      }
      Services.prefs.getBranch("zentabs.").setStringPref("syncManifest", JSON.stringify(obj));
    } catch (e) {
      console.error("[ZenTabs] Failed to save sync manifest:", e);
    }
  }

  /**
   * Rebuild bookmark cache from Places database
   */
  async rebuildBookmarkCache() {
    this.bookmarkMap.clear();
    
    try {
      // Get Zen folder bookmarks
      const zenFolder = await this.getOrCreateFolder(this.manager.window.PlacesUtils.bookmarks.toolbarGuid, "Zen");
      const bookmarks = await this.getAllBookmarksInFolder(zenFolder);
      
      for (const bm of bookmarks) {
        if (bm.url) {
          this.bookmarkMap.set(bm.url, bm.guid);
        }
      }
      
      this.log(`Bookmark cache rebuilt: ${this.bookmarkMap.size} bookmarks`);
    } catch (error) {
      console.error("Error rebuilding bookmark cache:", error);
    }
  }

  /**
   * Get all bookmarks in a folder recursively
   */
  async getAllBookmarksInFolder(folderGuid) {
    const bookmarks = [];
    try {
      const PlacesUtils = this.manager.window.PlacesUtils;
      const tree = await PlacesUtils.promiseBookmarksTree(folderGuid, { includeItemIds: false });
      if (!tree || !tree.children) return bookmarks;

      for (const child of tree.children) {
        if (child.uri) {
          bookmarks.push({ url: child.uri, guid: child.guid, title: child.title || "" });
        }
        if (child.uri == null && child.children !== undefined) {
          // node has no URI and has children → it's a folder; recurse
          const subBookmarks = await this.getAllBookmarksInFolder(child.guid);
          bookmarks.push(...subBookmarks);
        }
      }
    } catch (error) {
      console.error("Error getting bookmarks in folder:", error);
    }
    return bookmarks;
  }

  /**
   * Returns Map<spaceUuid|null, Map<url, guid>> for all bookmarks under Zen/<SpaceName>/.
   * Space folders whose name doesn't match a current workspace get uuid = null (skipped in sync).
   */
  async getBookmarkUrlsBySpace() {
    const PlacesUtils = this.manager.window.PlacesUtils;
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");

    const spaceByName = new Map();
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) {
        spaceByName.set(ws.name, ws.uuid);
      }
    }

    const result = new Map(); // spaceUuid|null → Map<url, guid>
    const zenTree = await PlacesUtils.promiseBookmarksTree(zenFolderGuid, { includeItemIds: false });
    if (!zenTree || !zenTree.children) return result;

    for (const spaceFolder of zenTree.children) {
      // Use uri == null to detect folders: promiseBookmarksTree returns integer types
      // that do NOT match the PlacesUtils.bookmarks.TYPE_FOLDER string constant.
      if (spaceFolder.uri != null) continue; // skip bookmarks / separators
      const spaceUuid = spaceByName.get(spaceFolder.title) ?? null;
      if (!result.has(spaceUuid)) result.set(spaceUuid, new Map());
      const urlMap = result.get(spaceUuid);
      const bookmarks = await this.getAllBookmarksInFolder(spaceFolder.guid);
      for (const bm of bookmarks) {
        if (bm.url) urlMap.set(bm.url, bm.guid);
      }
    }

    return result;
  }

  async deleteBookmark(guid) {
    try {
      await this.manager.window.PlacesUtils.bookmarks.remove(guid);
    } catch (e) {
      console.error("[ZenTabs] Failed to delete bookmark:", guid, e);
    }
  }

  findTabByUrl(url) {
    const tabs = this.manager.window.gZenWorkspaces?.allStoredTabs ?? this.manager.window.gBrowser.tabs;
    for (const tab of tabs) {
      if (tab.hasAttribute("zen-empty-tab")) continue;
      if (tab.linkedBrowser?.currentURI?.spec === url) return tab;
    }
    return null;
  }

  // (bookmark observer defined below in ── Bookmark observer ── section)

  /**
   * Perform sync based on preferences
   */
  async performSync() {
    if (this.manager.preferences.paused) {
      this.log("Paused — skipping sync");
      return null;
    }
    if (this.syncInProgress) {
      this.log("Sync already in progress, skipping");
      return;
    }

    const direction = this.manager.preferences.syncDirection;
    this.log(`Performing ${direction} sync...`);
    
    this.syncInProgress = true;
    
    try {
      let result;
      
      switch (direction) {
        case "tabs-to-bookmarks":
          result = await this.syncToBookmarks();
          break;
        case "bookmarks-to-tabs":
          result = await this.syncFromBookmarks();
          break;
        case "bidirectional":
          result = await this.syncBidirectional();
          break;
        default:
          throw new Error(`Unknown sync direction: ${direction}`);
      }
      
      this.lastSyncTime = Date.now();
      this.manager.dispatchEvent("sync-completed", result);
      this.log("Sync completed:", result);
      
      return result;
    } catch (error) {
      console.error("Sync error:", error);
      this.manager.dispatchEvent("sync-failed", { error: error.message });
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Tabs-are-authority: push all open tabs to bookmarks, delete orphan bookmarks.
   * After this call the Zen/ folder is an exact mirror of the current session.
   */
  async syncToBookmarks(options = {}) {
    const opts = {
      includeEssential: true,
      includePinned: true,
      includeNormal: false,
      ...options
    };

    this.log("Syncing tabs → bookmarks (tabs are authority)...");

    const PlacesUtils = this.manager.window.PlacesUtils;
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");

    const allTabs = await this.manager.tabManager.getAllTabs();
    const result = {
      bookmarksCreated: 0,
      bookmarksUpdated: 0,
      bookmarksDeleted: 0,
      skipped: 0,
      bySpace: {}
    };

    // Build tab groups by space, tracking URL sets for orphan detection
    const tabsBySpace = new Map(); // spaceUuid → { space, tabs[], urlSet }
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) {
        tabsBySpace.set(ws.uuid, { space: ws, tabs: [], urlSet: new Set() });
      }
    }
    for (const tabData of allTabs) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) {
        result.skipped++;
        continue;
      }
      const spaceId = tabData.workspace.id;
      if (!tabsBySpace.has(spaceId)) {
        tabsBySpace.set(spaceId, {
          space: { uuid: spaceId, name: tabData.workspace.name || "Other" },
          tabs: [], urlSet: new Set()
        });
      }
      const entry = tabsBySpace.get(spaceId);
      entry.tabs.push(tabData);
      entry.urlSet.add(tabData.url);
    }

    const bmBySpace = await this.getBookmarkUrlsBySpace();

    for (const [spaceId, { space, tabs, urlSet }] of tabsBySpace) {
      const spaceFolderGuid = await this.getOrCreateFolder(zenFolderGuid, space.name);
      const spaceResult = { created: 0, updated: 0, deleted: 0 };

      const syncTabs = tabs.filter(t =>
        (t.type === "essential" && opts.includeEssential) ||
        (t.type === "pinned"    && opts.includePinned) ||
        (t.type === "normal"    && opts.includeNormal)
      );

      for (const tabData of syncTabs) {
        const folderGuid = await this.getBookmarkFolderForTab(spaceFolderGuid, tabData);
        const created = await this.createOrUpdateBookmark(folderGuid, tabData.title, tabData.url);
        created ? (result.bookmarksCreated++, spaceResult.created++) : (result.bookmarksUpdated++, spaceResult.updated++);
      }

      // Delete orphan bookmarks (bookmarked but no longer open)
      const spaceBookmarks = bmBySpace.get(spaceId) ?? new Map();
      for (const [url, guid] of spaceBookmarks) {
        if (!urlSet.has(url)) {
          await this.deleteBookmark(guid);
          result.bookmarksDeleted++;
          spaceResult.deleted++;
        }
      }

      result.bySpace[space.name] = spaceResult;
    }

    // Clean up orphan bookmarks from spaces with no open tabs at all.
    // Skip null — these are space folders whose name no longer matches any workspace
    // (renamed, deleted, etc.). Never delete what we can't positively identify.
    for (const [spaceUuid, urlMap] of bmBySpace) {
      if (spaceUuid === null) continue;
      if (tabsBySpace.has(spaceUuid)) continue;
      for (const [, guid] of urlMap) {
        await this.deleteBookmark(guid);
        result.bookmarksDeleted++;
      }
    }

    await this.rebuildBookmarkCache();
    return result;
  }

  /**
   * Bookmarks-are-authority: open tabs for bookmarks not already open.
   *
   * Walks the Zen/ bookmark folder directly.  If a space folder's name doesn't
   * match any currently-existing Zen Space (e.g. fresh install), the space is
   * created automatically via gZenWorkspaces.createAndSaveWorkspace.
   *
   * Tab type is inferred from the bookmark's containing sub-folder:
   *   • Bookmark directly in the space root       → pinned (no Zen folder)
   *   • Inside "Essentials/" sub-folder           → essential
   *   • Inside "Temporary tabs/" sub-folder       → normal
   *   • Inside any other named sub-folder         → normal (Zen folder, type lost)
   *
   * Before opening tabs for a space we call changeWorkspaceWithID() so Zen
   * places the new tabs in the correct workspace.  The previously active
   * workspace is restored afterwards.
   */
  async syncFromBookmarks() {
    this.log("Syncing bookmarks → tabs...");

    const result = { spacesCreated: 0, bookmarksFound: 0, tabsCreated: 0, tabsExisting: 0, errors: 0 };

    const PlacesUtils    = this.manager.window.PlacesUtils;
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;

    const existingUrls = new Set(
      (await this.manager.tabManager.getAllTabs()).map(t => t.url)
    );

    // Build name → uuid lookup for all existing spaces
    const spaceByName = new Map();
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) {
        spaceByName.set(ws.name, ws.uuid);
      }
    }

    const toolbarGuid   = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");
    const zenTree = await PlacesUtils.promiseBookmarksTree(zenFolderGuid, { includeItemIds: false });
    if (!zenTree || !zenTree.children) return result;

    // Remember current workspace so we can restore it when done
    const previousWorkspace = gZenWorkspaces?.activeWorkspace ?? null;

    for (const spaceFolder of zenTree.children) {
      if (spaceFolder.uri != null) continue; // skip plain bookmarks / separators
      const folderName = spaceFolder.title;

      // Look up or create the matching Zen Space
      let spaceUuid = spaceByName.get(folderName);
      if (!spaceUuid && gZenWorkspaces?.createAndSaveWorkspace) {
        try {
          await gZenWorkspaces.createAndSaveWorkspace(folderName, null, /* dontChange */ true);
          for (const ws of gZenWorkspaces.getWorkspaces()) {
            if (ws.name === folderName) {
              spaceUuid = ws.uuid;
              spaceByName.set(folderName, spaceUuid);
              result.spacesCreated++;
              break;
            }
          }
        } catch (e) {
          console.error(`[ZenTabs] Failed to create space "${folderName}":`, e);
        }
      }

      if (!spaceUuid) continue;

      // Switch to this workspace BEFORE opening tabs so Zen assigns them here
      if (gZenWorkspaces?.changeWorkspaceWithID) {
        try { await gZenWorkspaces.changeWorkspaceWithID(spaceUuid); } catch (e) { /* non-fatal */ }
      }

      if (!spaceFolder.children) continue;

      for (const child of spaceFolder.children) {
        if (child.uri) {
          // Direct bookmark in the space root = pinned tab (had no Zen folder)
          result.bookmarksFound++;
          await this._openRestoredTab(child.uri, spaceUuid, "pinned", existingUrls, result);
        } else if (child.uri == null && child.children !== undefined) {
          if (child.title === "Essentials") {
            const bms = await this.getAllBookmarksInFolder(child.guid);
            result.bookmarksFound += bms.length;
            for (const bm of bms) {
              await this._openRestoredTab(bm.url, spaceUuid, "essential", existingUrls, result);
            }
          } else if (child.title === "Temporary tabs") {
            const bms = await this.getAllBookmarksInFolder(child.guid);
            result.bookmarksFound += bms.length;
            for (const bm of bms) {
              await this._openRestoredTab(bm.url, spaceUuid, "normal", existingUrls, result);
            }
          } else {
            // Named folder = pinned tab group with a Zen folder
            await this._openRestoredFolder(child, spaceUuid, existingUrls, result);
          }
        }
      }
    }

    // Restore the workspace the user was in before the sync
    if (gZenWorkspaces?.changeWorkspaceWithID && previousWorkspace) {
      try { await gZenWorkspaces.changeWorkspaceWithID(previousWorkspace); } catch (e) { /* non-fatal */ }
    }

    return result;
  }

  /**
   * Open one tab during a bookmark restore, applying the correct workspace
   * assignment and tab-type attributes (essential / pinned / normal).
   */
  async _openRestoredTab(url, spaceUuid, tabType, existingUrls, result) {
    if (!url) return;
    if (existingUrls.has(url)) { result.tabsExisting++; return; }
    const { gBrowser } = this.manager.window;
    try {
      const tab = gBrowser.addTab(url, {
        inBackground: true,
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
      });
      if (!tab) { result.errors++; return; }
      tab.setAttribute("zen-workspace-id", spaceUuid);
      if (tabType === "essential") {
        tab.setAttribute("zen-essential", "");
      } else if (tabType === "pinned") {
        gBrowser.pinTab(tab);
      }
      result.tabsCreated++;
      existingUrls.add(url);
    } catch (e) {
      console.error(`[ZenTabs] Error opening tab for ${url}:`, e);
      result.errors++;
    }
  }

  /**
   * Restore a named bookmark subfolder as a Zen folder (pinned tab group).
   * Uses gZenFolders.createFolder() which handles pinning and folder DOM creation.
   */
  async _openRestoredFolder(folderChild, spaceUuid, existingUrls, result) {
    const { gBrowser } = this.manager.window;
    const gZenFolders = this.manager.window.gZenFolders;
    if (!gZenFolders) {
      // Fallback: restore as individual pinned tabs
      const bms = await this.getAllBookmarksInFolder(folderChild.guid);
      result.bookmarksFound += bms.length;
      for (const bm of bms) {
        await this._openRestoredTab(bm.url, spaceUuid, "pinned", existingUrls, result);
      }
      return;
    }

    const createdTabs = [];
    for (const bm of (folderChild.children || [])) {
      if (!bm.uri) continue; // skip any nested structure
      result.bookmarksFound++;
      if (existingUrls.has(bm.uri)) { result.tabsExisting++; continue; }
      try {
        const tab = gBrowser.addTab(bm.uri, {
          inBackground: true,
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
        if (!tab) { result.errors++; continue; }
        tab.setAttribute("zen-workspace-id", spaceUuid);
        createdTabs.push(tab);
        existingUrls.add(bm.uri);
      } catch (e) {
        console.error(`[ZenTabs] Error opening tab for ${bm.uri}:`, e);
        result.errors++;
      }
    }

    if (createdTabs.length > 0) {
      try {
        gZenFolders.createFolder(createdTabs, {
          label: folderChild.title,
          workspaceId: spaceUuid,
        });
        result.tabsCreated += createdTabs.length;
      } catch (e) {
        console.error(`[ZenTabs] Error creating folder "${folderChild.title}":`, e);
        for (const tab of createdTabs) { gBrowser.pinTab(tab); }
        result.tabsCreated += createdTabs.length;
      }
    }
  }

  /**
   * True bidirectional sync using a manifest-based 3-way merge.
   *
   * Sets:
   *   M = manifest URLs for this space (what both sides agreed on last time)
   *   T = current tab URLs for this space
   *   B = current bookmark URLs for this space
   *
   * After all operations the new manifest = T_final ∩ B_final, where:
   *   T_final = (T - remote_deletions) ∪ remote_additions
   *   B_final = (B - local_closures) ∪ local_additions
   */
  async syncBidirectional() {
    this.log("Bidirectional sync with manifest...");

    const { gZenWorkspaces, gBrowser } = this.manager.window;
    const PlacesUtils = this.manager.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");

    const manifest   = this.loadManifest();
    const bmBySpace  = await this.getBookmarkUrlsBySpace();
    const closeRemoved = this.manager.preferences.syncCloseRemovedTabs ?? false;

    // Build tabs by space: spaceUuid → Map<url, tabData>
    const tabsBySpace = new Map();
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) tabsBySpace.set(ws.uuid, new Map());
    }
    for (const tabData of await this.manager.tabManager.getAllTabs()) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) continue;
      const uuid = tabData.workspace.id;
      if (!tabsBySpace.has(uuid)) tabsBySpace.set(uuid, new Map());
      tabsBySpace.get(uuid).set(tabData.url, tabData);
    }

    const result = {
      bookmarksCreated: 0,
      bookmarksDeleted: 0,
      tabsOpened: 0,
      tabsClosed: 0,
      bySpace: {}
    };

    const newManifest = new Map();

    // Union of all space UUIDs seen across any source
    const allSpaceUuids = new Set([
      ...manifest.keys(),
      ...tabsBySpace.keys(),
      ...[...bmBySpace.keys()].filter(k => k !== null)
    ]);

    for (const spaceUuid of allSpaceUuids) {
      if (spaceUuid === null) continue; // skip unrecognized/renamed space folders
      const M = manifest.get(spaceUuid)   ?? new Set();
      const T = tabsBySpace.get(spaceUuid) ?? new Map();
      const B = bmBySpace.get(spaceUuid)   ?? new Map();

      const workspace = gZenWorkspaces?.getWorkspaceFromId(spaceUuid);
      const spaceName = workspace?.name ?? spaceUuid;
      const spaceResult = { bookmarksCreated: 0, bookmarksDeleted: 0, tabsOpened: 0, tabsClosed: 0 };

      // ── Tabs side ──────────────────────────────────────────────────────

      for (const [url, tabData] of T) {
        if (!M.has(url) && tabData.type !== "normal") {
          // Opened locally (essential or pinned only) → push to bookmarks
          const spaceFolderGuid = await this.getOrCreateFolder(zenFolderGuid, spaceName);
          const subFolder = await this.getBookmarkFolderForTab(spaceFolderGuid, tabData);
          const created = await this.createOrUpdateBookmark(subFolder, tabData.title, url);
          if (created) { result.bookmarksCreated++; spaceResult.bookmarksCreated++; }
        }
      }

      for (const url of M) {
        if (!T.has(url) && B.has(url)) {
          // Closed locally → delete from bookmarks
          await this.deleteBookmark(B.get(url));
          result.bookmarksDeleted++;
          spaceResult.bookmarksDeleted++;
        }
      }

      // ── Bookmarks side ─────────────────────────────────────────────────

      for (const [url] of B) {
        if (!M.has(url) && !T.has(url)) {
          // Added on another computer → open as tab
          try {
            const tab = gBrowser.addTab(url, {
              inBackground: true,
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            });
            if (tab) tab.setAttribute("zen-workspace-id", spaceUuid);
            result.tabsOpened++;
            spaceResult.tabsOpened++;
          } catch (e) {
            console.error(`[ZenTabs] Failed to open tab for ${url}:`, e);
          }
        }
      }

      if (closeRemoved) {
        for (const url of M) {
          if (!B.has(url) && T.has(url)) {
            // Deleted on another computer → close tab (never essential/pinned)
            const tab = this.findTabByUrl(url);
            if (tab && !tab.hasAttribute("zen-essential") && !tab.pinned) {
              gBrowser.removeTab(tab);
              result.tabsClosed++;
              spaceResult.tabsClosed++;
            }
          }
        }
      }

      // ── Compute new manifest for this space ────────────────────────────
      // T_final = (T - remote_deletions) ∪ remote_additions
      const T_final = new Set(T.keys());
      if (closeRemoved) {
        for (const url of M) {
          if (!B.has(url) && T.has(url)) T_final.delete(url);
        }
      }
      for (const [url] of B) {
        if (!M.has(url) && !T.has(url)) T_final.add(url);
      }

      // B_final = (B - local_closures) ∪ local_additions
      const B_final = new Set(B.keys());
      for (const url of M) {
        if (!T.has(url) && B.has(url)) B_final.delete(url);
      }
      for (const [url, tabData] of T) {
        // Only track essential + pinned in the manifest — never normal tabs
        if (!M.has(url) && tabData.type !== "normal") B_final.add(url);
      }

      // New manifest = intersection (what both sides now have)
      newManifest.set(spaceUuid, new Set([...T_final].filter(u => B_final.has(u))));

      result.bySpace[spaceName] = spaceResult;
    }

    this.saveManifest(newManifest);
    await this.rebuildBookmarkCache();
    return result;
  }
  // ── PlacesUtils helpers ────────────────────────────────────────────────

  /**
   * Resolve the bookmark folder for a tab, mirroring its Zen folder hierarchy.
   * Falls back to an "Essentials" subfolder for unfoldered essential tabs,
   * and the space root for unfoldered pinned/normal tabs.
   */
  async getBookmarkFolderForTab(spaceFolderGuid, tabData) {
    const folderPath = tabData.folderPath;
    if (folderPath && folderPath.length > 0) {
      let parentGuid = spaceFolderGuid;
      for (const name of folderPath) {
        parentGuid = await this.getOrCreateFolder(parentGuid, name);
      }
      return parentGuid;
    }
    // No Zen folder — fall back to type-based location
    if (tabData.type === "essential") {
      return await this.getOrCreateFolder(spaceFolderGuid, "Essentials");
    }
    if (tabData.type === "normal") {
      return await this.getOrCreateFolder(spaceFolderGuid, "Temporary tabs");
    }
    return spaceFolderGuid; // pinned with no folder → space root
  }

  async getOrCreateFolder(parentId, title) {
    const existing = await this.manager.window.PlacesUtils.bookmarks.search({
      query: title,
      type: this.manager.window.PlacesUtils.bookmarks.TYPE_FOLDER
    });
    for (const bookmark of existing) {
      if (bookmark.title === title && bookmark.parentGuid === parentId) {
        return bookmark.guid;
      }
    }
    const folder = await this.manager.window.PlacesUtils.bookmarks.insert({
      parentGuid: parentId,
      type: this.manager.window.PlacesUtils.bookmarks.TYPE_FOLDER,
      title: title
    });
    return folder.guid;
  }

  /**
   * Create or update bookmark.
   * @returns {boolean} true if created, false if updated
   */
  async createOrUpdateBookmark(parentId, title, url) {
    const existing = await this.manager.window.PlacesUtils.bookmarks.search({ url: url });
    for (const bookmark of existing) {
      if (bookmark.parentGuid === parentId) {
        if (bookmark.title !== title) {
          await this.manager.window.PlacesUtils.bookmarks.update({ guid: bookmark.guid, title });
        }
        return false; // Updated
      }
    }
    await this.manager.window.PlacesUtils.bookmarks.insert({
      parentGuid: parentId,
      type: this.manager.window.PlacesUtils.bookmarks.TYPE_BOOKMARK,
      title: title,
      url: url
    });
    return true; // Created
  }

  // ── Bookmark observer ──────────────────────────────────────────────────

  setupBookmarkObserver() {
    if (!this.manager.window.PlacesUtils?.observers) return;
    const observer = {
      onItemAdded:   (id, parent, index, type, uri) => { if (uri) this.onBookmarkAdded(uri.spec); },
      onItemRemoved: (id, parent, index, type, uri) => { if (uri) this.onBookmarkRemoved(uri.spec); },
      onItemChanged: (id, prop, isAnnotation, value, lastModified, type, parent, guid) => {
        this.onBookmarkChanged(guid);
      }
    };
    try {
      this.manager.window.PlacesUtils.observers.addListener(
        ["bookmark-added", "bookmark-removed", "bookmark-title-changed", "bookmark-url-changed"],
        observer
      );
    } catch (e) {
      this.log("Could not setup bookmark observer:", e.message);
    }
  }

  onBookmarkAdded(url)  { this.log("Bookmark added:", url); }
  onBookmarkRemoved(url) { this.log("Bookmark removed:", url); this.bookmarkMap.delete(url); }
  onBookmarkChanged(guid) { this.log("Bookmark changed:", guid); }

  // ── Log / shutdown ─────────────────────────────────────────────────────

  log(...args) {
    this.manager.log("[SyncManager]", ...args);
  }


  /**
   * Shutdown
   */
  async shutdown() {
    this.bookmarkMap.clear();
    this.log("SyncManager shut down");
  }
}
