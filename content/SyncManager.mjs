/**
 * SyncManager - Bi-directional bookmark synchronization
 *
 * Sync strategy: bookmark folder is the cross-computer shared channel (via Firefox Sync).
 * A local manifest (stored in Services.prefs) records what both sides last agreed on.
 * Comparing manifest vs. current tabs vs. current bookmarks drives all decisions.
 *
 * Decision table (per entry per Space):
 *   in T, not in M            → opened locally since last sync  → push to bookmarks
 *   in M, not in T, in B      → closed locally since last sync  → delete from bookmarks
 *   in B, not in M, not in T  → added on another computer       → open as tab
 *   in M, not in B, in T      → deleted on another computer     → close tab (if pref enabled)
 *
 * IMPORTANT: URL is NOT treated as a unique key. Duplicate URLs within a space,
 * folder, or even the same subfolder are perfectly valid. The sync operates on
 * bookmark entries (identified by GUID) and tab instances — not on URLs.
 *
 * On first install manifest = ∅, which is the correct bootstrap state.
 */



export class SyncManager {
  constructor(manager) {
    this.manager = manager;
    this.lastSyncTime = 0;
    this.syncInProgress = false;
    this._manifestData = new Map();
    this.log("SyncManager created");
  }

  async init() {
    this.log("SyncManager initializing...");
    await this._initManifest();
    this.setupBookmarkObserver();
    this.log("SyncManager initialized");
  }

  // ── Manifest persistence ────────────────────────────────────────────────

  /**
   * Return the current in-memory manifest.
   * Populated by _initManifest() on startup; updated by saveManifest().
   */
  loadManifest() {
    return this._manifestData;
  }

  /**
   * Update the in-memory manifest and asynchronously persist it to the
   * profile-dir JSON file (fire-and-forget).
   *
   * Normalises entries on the way in (strips legacy `guid` fields) so the
   * in-memory cache and the on-disk file are always in v3 format.
   *
   * @param {Map<string, Array<{url, folder, type}>>} manifest
   */
  saveManifest(manifest) {
    const normalized = new Map();
    for (const [spaceUuid, entries] of manifest) {
      normalized.set(spaceUuid, entries.map(({ url, folder = "", type = "normal" }) => ({ url, folder, type })));
    }
    this._manifestData = normalized;
    this._writeManifestFile(this._manifestData).catch(e =>
      console.error("[ZenTabs] Failed to write manifest file:", e)
    );
  }

  /**
   * Initialise the in-memory manifest cache on startup.
   *
   * Priority:
   *   1. Profile-dir JSON file (zentabs-manifest.json) — normal operation.
   *   2. zentabs.syncManifest pref — one-time migration from the old storage
   *      that caused "attempting to write N bytes to preference" warnings.
   *      After migrating, the pref is cleared.
   */
  async _initManifest() {
    const IOUtils   = globalThis.IOUtils;
    const PathUtils = globalThis.PathUtils;
    if (IOUtils && PathUtils) {
      const filePath = PathUtils.join(PathUtils.profileDir, "zentabs-manifest.json");
      try {
        if (await IOUtils.exists(filePath)) {
          const text = await IOUtils.readUTF8(filePath);
          this._manifestData = this._parseManifestJSON(text);
          this.log("Loaded manifest from file");
          return;
        }
      } catch (e) {
        console.error("[ZenTabs] Failed to read manifest file:", e);
      }
    }

    // Migration: read from pref, write to file, clear pref.
    const prefBranch = Services.prefs.getBranch("zentabs.");
    if (prefBranch.prefHasUserValue("syncManifest")) {
      try {
        const text = prefBranch.getStringPref("syncManifest", "{}");
        this._manifestData = this._parseManifestJSON(text);
        await this._writeManifestFile(this._manifestData);
        prefBranch.clearUserPref?.("syncManifest");
        this.log("Migrated syncManifest from prefs to file");
      } catch (e) {
        console.error("[ZenTabs] Failed to migrate manifest from prefs:", e);
      }
    }
  }

  /**
   * Parse a raw JSON string into a v3 manifest Map.
   * Discards legacy v1 (URL-array) entries and strips `guid` from v2 entries.
   * @param {string} jsonStr
   * @returns {Map<string, Array<{url, folder, type}>>}
   */
  _parseManifestJSON(jsonStr) {
    const stored = JSON.parse(jsonStr);
    const manifest = new Map();
    for (const [uuid, entries] of Object.entries(stored)) {
      if (!Array.isArray(entries)) continue;             // malformed
      if (entries.length > 0 && typeof entries[0] === "string") continue; // legacy v1
      manifest.set(uuid, entries.map(({ url, folder = "", type = "normal" }) => ({ url, folder, type })));
    }
    return manifest;
  }

  /**
   * Write the manifest to the profile-dir JSON file.
   * No-op if IOUtils / PathUtils are unavailable (e.g. test environment).
   * @param {Map<string, Array<{url, folder, type}>>} manifest
   */
  async _writeManifestFile(manifest) {
    const IOUtils   = globalThis.IOUtils;
    const PathUtils = globalThis.PathUtils;
    if (!IOUtils || !PathUtils) return;
    const obj = {};
    for (const [uuid, entries] of manifest) obj[uuid] = entries;
    await IOUtils.writeUTF8(
      PathUtils.join(PathUtils.profileDir, "zentabs-manifest.json"),
      JSON.stringify(obj)
    );
  }

  // ── Bookmark tree helpers ───────────────────────────────────────────────

  /**
   * Get all bookmarks in a folder recursively.
   * Returns an array of { url, guid, title, folder } where `folder` is the
   * path relative to the start folder (empty string for direct children).
   */
  async getAllBookmarksInFolder(folderGuid, relativePath = "") {
    const bookmarks = [];
    try {
      const PlacesUtils = this.manager.window.PlacesUtils;
      const tree = await PlacesUtils.promiseBookmarksTree(folderGuid, { includeItemIds: false });
      if (!tree || !tree.children) return bookmarks;

      for (const child of tree.children) {
        if (child.uri) {
          bookmarks.push({ url: child.uri, guid: child.guid, title: child.title || "", folder: relativePath });
        }
        if (child.uri == null && child.children !== undefined) {
          const subPath = relativePath ? `${relativePath}/${child.title}` : child.title;
          const subBookmarks = await this.getAllBookmarksInFolder(child.guid, subPath);
          bookmarks.push(...subBookmarks);
        }
      }
    } catch (error) {
      console.error("Error getting bookmarks in folder:", error);
    }
    return bookmarks;
  }

  /**
   * Returns Map<spaceUuid|null, Array<{url, guid, title, folder}>> for all
   * bookmarks under Zen/<SpaceName>/.
   *
   * `folder` is the subfolder path relative to the space folder (e.g. "Essentials",
   * "My Projects/React"). Empty string means directly in the space root.
   *
   * Space folders whose name doesn't match a current workspace get uuid = null.
   * Duplicate URLs are preserved — each bookmark is its own entry.
   */
  async getBookmarkEntriesBySpace() {
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

    const result = new Map(); // spaceUuid|null → Array<{url, guid, title, folder}>
    const zenTree = await PlacesUtils.promiseBookmarksTree(zenFolderGuid, { includeItemIds: false });
    if (!zenTree || !zenTree.children) return result;

    for (const spaceFolder of zenTree.children) {
      if (spaceFolder.uri != null) continue; // skip bookmarks / separators
      const spaceUuid = spaceByName.get(spaceFolder.title) ?? null;
      if (!result.has(spaceUuid)) result.set(spaceUuid, []);
      const entries = result.get(spaceUuid);
      const bookmarks = await this.getAllBookmarksInFolder(spaceFolder.guid);
      entries.push(...bookmarks);
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

  // ── Sync entry point ────────────────────────────────────────────────────

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

  // ── syncToBookmarks ─────────────────────────────────────────────────────

  /**
   * Tabs-are-authority: push all open tabs to bookmarks, delete orphan bookmarks.
   * After this call the Zen/ folder is an exact structural mirror of the current
   * session. Duplicate URLs are handled correctly — each tab instance gets its
   * own bookmark.
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

    // Build tab groups by space
    const tabsBySpace = new Map(); // spaceUuid → { space, tabs[] }
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) {
        tabsBySpace.set(ws.uuid, { space: ws, tabs: [] });
      }
    }
    for (const tabData of allTabs) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) {
        result.skipped++;
        continue;
      }
      const spaceId = tabData.workspace.id;
      // Skip tabs that have no real workspace ("default" fallback from
      // TabManager) when gZenWorkspaces is available — these are system
      // tabs or tabs that lost their workspace attribute.
      if (gZenWorkspaces && !tabsBySpace.has(spaceId)) {
        result.skipped++;
        continue;
      }
      if (!tabsBySpace.has(spaceId)) {
        tabsBySpace.set(spaceId, {
          space: { uuid: spaceId, name: tabData.workspace.name || "Other" },
          tabs: []
        });
      }
      tabsBySpace.get(spaceId).tabs.push(tabData);
    }

    const bmBySpace = await this.getBookmarkEntriesBySpace();

    for (const [spaceId, { space, tabs }] of tabsBySpace) {
      const spaceFolderGuid = await this.getOrCreateFolder(zenFolderGuid, space.name);
      const spaceResult = { created: 0, updated: 0, deleted: 0 };

      const syncTabs = tabs.filter(t =>
        (t.type === "essential" && opts.includeEssential) ||
        (t.type === "pinned"    && opts.includePinned) ||
        (t.type === "normal"    && opts.includeNormal)
      );

      // Build a pool of existing bookmarks for this space that can be matched
      // to tabs. Each bookmark can only be matched once (consumed from pool).
      // Normalize folder names so old "Essentials" matches new "Essentials (Name)".
      const bookmarkPool = (bmBySpace.get(spaceId) ?? []).map(
        bm => ({ ...bm, folder: this._normalizeFolder(bm.folder, spaceId) })
      );

      for (const tabData of syncTabs) {
        const folderGuid = await this.getBookmarkFolderForTab(spaceFolderGuid, tabData);
        const folderName = this._subfolderNameForTab(tabData);

        // Try to find an existing bookmark in the same folder with the same URL
        const poolIdx = bookmarkPool.findIndex(
          bm => bm.url === tabData.url && bm.folder === folderName
        );

        if (poolIdx !== -1) {
          // Matched — consume from pool, update title if needed
          const matched = bookmarkPool.splice(poolIdx, 1)[0];
          const stored = await this.manager.window.PlacesUtils.bookmarks.search({ url: tabData.url });
          const entry = stored.find(b => b.guid === matched.guid);
          if (entry && entry.title !== tabData.title) {
            await this.manager.window.PlacesUtils.bookmarks.update({ guid: matched.guid, title: tabData.title });
          }
          result.bookmarksUpdated++;
          spaceResult.updated++;
        } else {
          // No match — create a new bookmark
          await this.manager.window.PlacesUtils.bookmarks.insert({
            parentGuid: folderGuid,
            type: this.manager.window.PlacesUtils.bookmarks.TYPE_BOOKMARK,
            title: tabData.title,
            url: tabData.url
          });
          result.bookmarksCreated++;
          spaceResult.created++;
        }
      }

      // Delete unmatched bookmarks (orphans: in bookmarks but no corresponding tab)
      for (const orphan of bookmarkPool) {
        await this.deleteBookmark(orphan.guid);
        result.bookmarksDeleted++;
        spaceResult.deleted++;
      }

      result.bySpace[space.name] = spaceResult;
    }

    // Clean up bookmarks from spaces with no open tabs at all.
    for (const [spaceUuid, entries] of bmBySpace) {
      if (spaceUuid === null) continue;
      if (tabsBySpace.has(spaceUuid)) continue;
      for (const entry of entries) {
        await this.deleteBookmark(entry.guid);
        result.bookmarksDeleted++;
      }
    }

    // Keep the manifest in sync so subsequent syncBidirectional calls don't
    // treat every tab as a "new local open" and create duplicate bookmarks.
    await this.rebuildManifest();

    return result;
  }

  // ── syncFromBookmarks ───────────────────────────────────────────────────

  /**
   * Bookmarks-are-authority: open tabs for bookmarks not already matched to
   * an open tab.
   *
   * Duplicate URLs are handled correctly: if there are 3 bookmarks with the
   * same URL and only 1 matching tab, 2 new tabs are opened.
   */
  async syncFromBookmarks() {
    this.log("Syncing bookmarks → tabs...");

    const result = { spacesCreated: 0, bookmarksFound: 0, tabsCreated: 0, tabsExisting: 0, errors: 0 };

    const PlacesUtils    = this.manager.window.PlacesUtils;
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;

    // Build a pool of open tabs per space: spaceUuid → Array<{url, type, folder, consumed}>
    // Each tab can only be matched to one bookmark (consumed from pool).
    const allTabs = await this.manager.tabManager.getAllTabs();
    const tabPoolBySpace = new Map();
    for (const tabData of allTabs) {
      const spaceId = tabData.workspace.id;
      if (!tabPoolBySpace.has(spaceId)) tabPoolBySpace.set(spaceId, []);
      tabPoolBySpace.get(spaceId).push({ url: tabData.url, type: tabData.type, folder: this._subfolderNameForTab(tabData), consumed: false });
    }

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

      // Essential tabs in Zen are scoped by container (contextual identity).
      // The container name is encoded in the Essentials folder title:
      //   "Essentials"            → no specific container
      //   "Essentials (<name>)"   → container name is <name>
      let containerName = null;
      let hasEssentials = false;
      if (spaceFolder.children) {
        for (const c of spaceFolder.children) {
          if (c.uri == null && c.children !== undefined && this._isEssentialsFolder(c.title)) {
            hasEssentials = true;
            containerName = this._parseEssentialsFolderName(c.title);
            break;
          }
        }
      }

      if (!spaceUuid && gZenWorkspaces?.createAndSaveWorkspace) {
        try {
          let containerTabId = 0;
          if (containerName) {
            containerTabId = this._findOrCreateContainer(containerName);
          } else if (hasEssentials) {
            // No marker yet — fall back to workspace name
            containerTabId = this._findOrCreateContainer(folderName);
          }
          await gZenWorkspaces.createAndSaveWorkspace(folderName, null, /* dontChange */ true, containerTabId);
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
      } else if (spaceUuid && (containerName || hasEssentials)) {
        // Existing workspace — ensure it has a container for essential tab scoping
        await this._ensureWorkspaceContainer(spaceUuid, containerName);
      }

      if (!spaceUuid) continue;

      // Ensure we have a tab pool for this space
      if (!tabPoolBySpace.has(spaceUuid)) tabPoolBySpace.set(spaceUuid, []);
      const spaceTabPool = tabPoolBySpace.get(spaceUuid);

      if (!spaceFolder.children) continue;

      // Create a lazy-switch callback for this space. On the first call that
      // actually needs to open a new tab it switches Zen to this workspace so
      // gBrowser.addTab assigns the tab to the right space. Subsequent calls in
      // the same space are no-ops.
      // WHY LAZY? Switching workspace unconditionally fires TabAttrModified for
      // every tab being shown/hidden. That synchronously refreshes the TabManager
      // cache for those tabs — potentially with wrong folderPath values if
      // tab.group is temporarily disconnected during the DOM move. By delaying
      // the switch until we actually need to open a tab, we avoid polluting the
      // cache for the common steady-state case where all bookmarks are already open.
      let workspaceSwitchedForThisSpace = false;
      const lazySwitch = async () => {
        if (!workspaceSwitchedForThisSpace && gZenWorkspaces?.changeWorkspaceWithID) {
          workspaceSwitchedForThisSpace = true;
          try { await gZenWorkspaces.changeWorkspaceWithID(spaceUuid); } catch (e) { /* non-fatal */ }
        }
      };

      for (const child of spaceFolder.children) {
        if (child.uri) {
          // Direct bookmark in the space root = pinned tab (had no Zen folder)
          result.bookmarksFound++;
          await this._openOrMatchTab(child.uri, spaceUuid, "pinned", "", spaceTabPool, result, lazySwitch);
        } else if (child.uri == null && child.children !== undefined) {
          if (this._isEssentialsFolder(child.title)) {
            const bms = await this.getAllBookmarksInFolder(child.guid);
            result.bookmarksFound += bms.length;
            for (const bm of bms) {
              const fullFolder = bm.folder ? `${child.title}/${bm.folder}` : child.title;
              await this._openOrMatchTab(bm.url, spaceUuid, "essential", fullFolder, spaceTabPool, result, lazySwitch);
            }
          } else if (child.title === "Temporary tabs") {
            const bms = await this.getAllBookmarksInFolder(child.guid);
            result.bookmarksFound += bms.length;
            for (const bm of bms) {
              const fullFolder = bm.folder ? `Temporary tabs/${bm.folder}` : "Temporary tabs";
              await this._openOrMatchTab(bm.url, spaceUuid, "normal", fullFolder, spaceTabPool, result, lazySwitch);
            }
          } else {
            // Named folder = pinned tab group with a Zen folder
            await this._openRestoredFolder(child, spaceUuid, spaceTabPool, result, null, "", lazySwitch);
          }
        }
      }
    }

    // Restore the workspace the user was in before the sync
    if (gZenWorkspaces?.changeWorkspaceWithID && previousWorkspace) {
      try { await gZenWorkspaces.changeWorkspaceWithID(previousWorkspace); } catch (e) { /* non-fatal */ }
    }

    // Keep the manifest in sync so subsequent syncBidirectional calls don't
    // re-open tabs that were just matched.
    await this.rebuildManifest();

    return result;
  }

  /**
   * Try to match a bookmark to an unconsumed tab in the pool. If no match,
   * switch workspace (lazily, once) and open a new tab.
   *
   * @param {string} url
   * @param {string} spaceUuid
   * @param {string} tabType - "essential" | "pinned" | "normal"
   * @param {string} folder  - subfolder path relative to space root (e.g. "", "Essentials", "Projects")
   * @param {Array}  spaceTabPool - mutable pool of {url, type, folder, consumed} entries
   * @param {object} result - mutation target for counters
   * @param {Function|null} lazySwitch - async callback that switches workspace on first call
   */
  async _openOrMatchTab(url, spaceUuid, tabType, folder, spaceTabPool, result, lazySwitch = null) {
    if (!url) return;

    // Try to consume an unconsumed tab with the same URL and same folder
    const poolIdx = spaceTabPool.findIndex(e => !e.consumed && e.url === url && e.folder === folder);
    if (poolIdx !== -1) {
      spaceTabPool[poolIdx].consumed = true;
      result.tabsExisting++;
      return;
    }

    // No match — ensure workspace is active BEFORE opening the tab
    if (lazySwitch) await lazySwitch();

    // Open a new tab
    const { gBrowser, gZenWorkspaces } = this.manager.window;
    try {
      const addTabOpts = { inBackground: true, triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() };
      if (tabType === "essential") {
        const containerTabId = gZenWorkspaces?.getWorkspaceFromId(spaceUuid)?.containerTabId ?? 0;
        if (containerTabId) addTabOpts.userContextId = containerTabId;
      }
      const tab = gBrowser.addTab(url, addTabOpts);
      if (!tab) { result.errors++; return; }
      tab.setAttribute("zen-workspace-id", spaceUuid);
      if (tabType === "essential") {
        tab.setAttribute("zen-essential", "true");
        gBrowser.pinTab(tab);
      } else if (tabType === "pinned") {
        gBrowser.pinTab(tab);
      }
      // Add the new tab to the pool as consumed so subsequent bookmarks with
      // the same URL don't match against it.
      spaceTabPool.push({ url, type: tabType, folder, consumed: true });
      result.tabsCreated++;
    } catch (e) {
      console.error(`[ZenTabs] Error opening tab for ${url}:`, e);
      result.errors++;
    }
  }

  /**
   * Restore a named bookmark subfolder as nested Zen folder(s).
   */
  async _openRestoredFolder(folderChild, spaceUuid, spaceTabPool, result, parentFolder = null, parentPath = "", lazySwitch = null) {
    const { gBrowser } = this.manager.window;
    const gZenFolders = this.manager.window.gZenFolders;

    // Build the full folder path relative to space root for pool matching
    const currentPath = parentPath ? `${parentPath}/${folderChild.title}` : folderChild.title;

    const children = folderChild.children || [];

    // Partition direct bookmark children from sub-folder children
    const directUrls = children.filter(c => c.uri != null).map(c => c.uri);
    const subFolders  = children.filter(c => c.uri == null && c.children !== undefined);

    let createdFolder = null;

    // Create a Zen folder for this node's direct bookmark children (if any)
    if (directUrls.length > 0) {
      result.bookmarksFound += directUrls.length;

      if (!gZenFolders) {
        // Fallback: restore as individual pinned tabs
        for (const url of directUrls) {
          await this._openOrMatchTab(url, spaceUuid, "pinned", currentPath, spaceTabPool, result, lazySwitch);
        }
      } else {
        const createdTabs = [];
        for (const url of directUrls) {
          // Try to match to existing pinned tab in the same folder
          const poolIdx = spaceTabPool.findIndex(e => !e.consumed && e.url === url && e.folder === currentPath);
          if (poolIdx !== -1) {
            spaceTabPool[poolIdx].consumed = true;
            result.tabsExisting++;
            continue;
          }
          try {
            if (lazySwitch) await lazySwitch();
            const tab = gBrowser.addTab(url, {
              inBackground: true,
              triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
            });
            if (!tab) { result.errors++; continue; }
            tab.setAttribute("zen-workspace-id", spaceUuid);
            createdTabs.push(tab);
            spaceTabPool.push({ url, type: "pinned", folder: currentPath, consumed: true });
          } catch (e) {
            console.error(`[ZenTabs] Error opening tab for ${url}:`, e);
            result.errors++;
          }
        }
        if (createdTabs.length > 0) {
          try {
            const opts = { label: folderChild.title, workspaceId: spaceUuid };
            if (parentFolder?.groupContainer?.lastElementChild) {
              opts.insertAfter = parentFolder.groupContainer.lastElementChild;
            }
            createdFolder = gZenFolders.createFolder(createdTabs, opts);
            result.tabsCreated += createdTabs.length;
          } catch (e) {
            console.error(`[ZenTabs] Error creating Zen folder "${folderChild.title}":`, e);
            for (const tab of createdTabs) {
              try { gBrowser.pinTab(tab); } catch (_) { /* best-effort */ }
            }
            result.tabsCreated += createdTabs.length;
          }
        }
      }
    } else if (subFolders.length > 0 && gZenFolders) {
      // No direct bookmarks but has sub-folders: create an empty container
      try {
        const opts = { label: folderChild.title, workspaceId: spaceUuid };
        if (parentFolder?.groupContainer?.lastElementChild) {
          opts.insertAfter = parentFolder.groupContainer.lastElementChild;
        }
        createdFolder = gZenFolders.createFolder([], opts);
      } catch (e) {
        this.log(`Could not create container folder "${folderChild.title}":`, e.message);
      }
    }

    // Recurse into each sub-folder, nesting under the folder we just created
    const nextParent = createdFolder || parentFolder;
    for (const sub of subFolders) {
      await this._openRestoredFolder(sub, spaceUuid, spaceTabPool, result, nextParent, currentPath, lazySwitch);
    }
  }

  // ── syncBidirectional ───────────────────────────────────────────────────

  /**
   * True bidirectional sync using a manifest-based 3-way merge.
   *
   * The manifest stores entries as {url, folder, type} — no GUIDs — making it
   * immune to Firefox Sync reassigning bookmark GUIDs. Duplicate URLs are
   * tracked correctly by count per URL+folder key.
   *
   * Decision logic per space:
   *   1. Tabs not covered by manifest (new local opens) → create bookmarks
   *   2. Manifest entries whose tab is gone but bookmark exists → delete bookmark
   *   3. Bookmarks not covered by manifest (new remote adds) → open tabs
   *   4. Manifest entries whose bookmark is gone but tab exists → close tab (if pref)
   *   5. New manifest = all surviving tab↔bookmark pairs
   */
  async syncBidirectional() {
    this.log("Bidirectional sync with manifest...");

    const { gZenWorkspaces, gBrowser } = this.manager.window;
    const PlacesUtils = this.manager.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");

    const manifest   = this.loadManifest();
    const bmBySpace  = await this.getBookmarkEntriesBySpace();
    const closeRemoved = this.manager.preferences.syncCloseRemovedTabs ?? false;

    // Build tabs by space: spaceUuid → Array<tabData>
    // Tabs are kept as arrays (not maps) to allow duplicate URLs.
    const tabsBySpace = new Map();
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) tabsBySpace.set(ws.uuid, []);
    }
    for (const tabData of await this.manager.tabManager.getAllTabs()) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) continue;
      const uuid = tabData.workspace.id;
      // Skip tabs with no real workspace when gZenWorkspaces is available
      if (gZenWorkspaces && !tabsBySpace.has(uuid)) continue;
      if (!tabsBySpace.has(uuid)) tabsBySpace.set(uuid, []);
      tabsBySpace.get(uuid).push(tabData);
    }

    // ── Bootstrap: empty manifest with existing data ─────────────────
    // When the manifest is completely empty but we already have both tabs
    // and bookmarks, this is a first-run / format-migration scenario.
    // Instead of treating all bookmarks as "new remote adds" (which would
    // open hundreds of duplicate tabs), we bootstrap the manifest by
    // matching existing tabs to existing bookmarks — no opens, no deletes.
    const manifestIsEmpty = manifest.size === 0;
    const hasTabs = [...tabsBySpace.values()].some(arr => arr.length > 0);
    const hasBookmarks = [...bmBySpace.values()].some(arr => arr.length > 0);

    if (manifestIsEmpty && hasTabs && hasBookmarks) {
      this.log("Empty manifest with existing tabs & bookmarks — bootstrapping manifest (no changes)");
      const bootstrapManifest = new Map();

      for (const [spaceUuid, tabs] of tabsBySpace) {
        const B = bmBySpace.get(spaceUuid) ?? [];
        const entries = [];
        const bmPool = B.map(bm => ({ ...bm, folder: this._normalizeFolder(bm.folder, spaceUuid), consumed: false }));

        for (const tabData of tabs) {
          const tabFolder = this._subfolderNameForTab(tabData);
          const poolIdx = bmPool.findIndex(
            e => !e.consumed && e.url === tabData.url && e.folder === tabFolder
          );
          if (poolIdx !== -1) {
            const bm = bmPool[poolIdx];
            entries.push({ url: bm.url, folder: tabFolder, type: tabData.type });
            bmPool[poolIdx].consumed = true;
          }
        }
        // Always set entries (even empty) so manifest.size > 0 and we
        // don't re-bootstrap on the next call.
        bootstrapManifest.set(spaceUuid, entries);
      }

      this.saveManifest(bootstrapManifest);
      return {
        bookmarksCreated: 0,
        bookmarksDeleted: 0,
        tabsOpened: 0,
        tabsClosed: 0,
        bySpace: {},
        bootstrapped: true
      };
    }

    const result = {
      bookmarksCreated: 0,
      bookmarksDeleted: 0,
      tabsOpened: 0,
      tabsClosed: 0,
      bySpace: {}
    };

    // Remember current workspace so we can restore it after the loop
    // (Step 3 may switch workspaces to open tabs in the right space).
    const previousWorkspace = gZenWorkspaces?.activeWorkspace ?? null;

    // Union of all space UUIDs seen across any source
    const allSpaceUuids = new Set([
      ...manifest.keys(),
      ...tabsBySpace.keys(),
      ...[...bmBySpace.keys()].filter(k => k !== null)
    ]);

    for (const spaceUuid of allSpaceUuids) {
      if (spaceUuid === null) continue;
      const M = manifest.get(spaceUuid) ?? [];  // Array<{url, folder, type}>
      const T = tabsBySpace.get(spaceUuid) ?? []; // Array<tabData>
      const B = bmBySpace.get(spaceUuid) ?? [];   // Array<{url, guid, title, folder}>

      const workspace = gZenWorkspaces?.getWorkspaceFromId(spaceUuid);
      const spaceName = workspace?.name ?? spaceUuid;
      const spaceResult = { bookmarksCreated: 0, bookmarksDeleted: 0, tabsOpened: 0, tabsClosed: 0 };

      // ── Step 1: New local tabs → push to bookmarks ─────────────────
      // Tabs not accounted for in the manifest are new local opens.
      // We match manifest entries to tabs by URL + folder (consuming one
      // manifest entry per tab) to find truly new tabs.
      // Normalize manifest folders so old "Essentials" matches the current canonical name.
      const unmatchedManifestKeys = M.map(e => ({ url: e.url, folder: this._normalizeFolder(e.folder, spaceUuid) }));
      const newLocalTabs = [];
      for (const tabData of T) {
        const tabFolder = this._subfolderNameForTab(tabData);
        const mIdx = unmatchedManifestKeys.findIndex(e => e.url === tabData.url && e.folder === tabFolder);
        if (mIdx !== -1) {
          unmatchedManifestKeys.splice(mIdx, 1); // consume
        } else {
          newLocalTabs.push(tabData);
        }
      }

      for (const tabData of newLocalTabs) {
        if (tabData.type === "normal") continue; // never push normal tabs
        const spaceFolderGuid = await this.getOrCreateFolder(zenFolderGuid, spaceName);
        const subFolder = await this.getBookmarkFolderForTab(spaceFolderGuid, tabData);
        await this.manager.window.PlacesUtils.bookmarks.insert({
          parentGuid: subFolder,
          type: this.manager.window.PlacesUtils.bookmarks.TYPE_BOOKMARK,
          title: tabData.title,
          url: tabData.url
        });
        result.bookmarksCreated++;
        spaceResult.bookmarksCreated++;
      }

      // ── Step 2: Closed locally → delete from bookmarks ─────────────
      // Manifest entries whose URL+folder no longer has a tab but whose
      // bookmark still exists.
      const _tabKey = (url, folder) => `${url}\t${folder}`;

      const tabKeyCounts = new Map();
      for (const td of T) {
        const key = _tabKey(td.url, this._subfolderNameForTab(td));
        tabKeyCounts.set(key, (tabKeyCounts.get(key) ?? 0) + 1);
      }

      const manifestKeyCounts = new Map();
      for (const me of M) {
        const key = _tabKey(me.url, this._normalizeFolder(me.folder, spaceUuid));
        manifestKeyCounts.set(key, (manifestKeyCounts.get(key) ?? 0) + 1);
      }

      // For each URL+folder in manifest, if tab count < manifest count, some were closed
      const closedLocally = []; // guids of bookmarks to delete
      const closedKeyBudget = new Map();
      for (const [key, mCount] of manifestKeyCounts) {
        const tCount = tabKeyCounts.get(key) ?? 0;
        if (tCount < mCount) {
          closedKeyBudget.set(key, mCount - tCount);
        }
      }
      // Pool-based deletion: find actual bookmarks in B by URL+folder key.
      // No manifest GUIDs needed — correct even after Firefox Sync replaces them.
      const bmStep2Pool = B.map(bm => ({
        guid: bm.guid, url: bm.url,
        normFolder: this._normalizeFolder(bm.folder, spaceUuid), consumed: false
      }));
      for (const [key, budget] of closedKeyBudget) {
        let remaining = budget;
        for (const entry of bmStep2Pool) {
          if (remaining <= 0) break;
          if (entry.consumed) continue;
          if (_tabKey(entry.url, entry.normFolder) === key) {
            closedLocally.push(entry.guid);
            entry.consumed = true;
            remaining--;
          }
        }
      }

      for (const guid of closedLocally) {
        await this.deleteBookmark(guid);
        result.bookmarksDeleted++;
        spaceResult.bookmarksDeleted++;
      }

      // Ensure workspace has a dedicated container if essential bookmarks
      // are present, so essential tabs are properly scoped per-workspace.
      if (B.some(bm => this._inferTabTypeFromFolder(bm.folder) === "essential")) {
        await this._ensureWorkspaceContainer(spaceUuid, null);
      }

      // ── Step 3: New remote bookmarks → open as tabs ────────────────
      // Count-based detection: bookmarks exceeding manifest count per URL+folder
      // key are "new remote adds". GUID-neutral — immune to Firefox Sync replacing
      // GUIDs on existing bookmarks, which previously caused mass spurious tab opens.
      const bmKeyMap = new Map(); // normalized-key → Array<bm>
      for (const bm of B) {
        const k = _tabKey(bm.url, this._normalizeFolder(bm.folder, spaceUuid));
        if (!bmKeyMap.has(k)) bmKeyMap.set(k, []);
        bmKeyMap.get(k).push(bm);
      }
      const unmatchedBookmarks = [];
      for (const [key, bms] of bmKeyMap) {
        const mCount = manifestKeyCounts.get(key) ?? 0;
        const extra = Math.max(0, bms.length - mCount);
        for (let i = 0; i < extra; i++) unmatchedBookmarks.push(bms[i]);
      }
      // But some of these may already have matching open tabs. Match by URL + folder.
      const unmatchedTabPool = T.map(td => ({ url: td.url, type: td.type, folder: this._subfolderNameForTab(td), consumed: false }));

      // Also mark tabs that were consumed by manifest matching
      // (rebuild: for each manifest entry with a matching tab, consume one tab)
      const manifestTabConsume = M.map(e => ({ url: e.url, folder: this._normalizeFolder(e.folder, spaceUuid) }));
      for (const poolEntry of unmatchedTabPool) {
        const idx = manifestTabConsume.findIndex(e => e.url === poolEntry.url && e.folder === poolEntry.folder);
        if (idx !== -1) {
          poolEntry.consumed = true;
          manifestTabConsume.splice(idx, 1);
        }
      }

      // Switch to this workspace BEFORE opening tabs so Zen assigns them
      // to the correct space (Zen uses the active workspace for new tabs).
      let needsTabOpening = false;
      for (const bm of unmatchedBookmarks) {
        const bmFolder = this._normalizeFolder(bm.folder, spaceUuid);
        const poolIdx = unmatchedTabPool.findIndex(e => !e.consumed && e.url === bm.url && e.folder === bmFolder);
        if (poolIdx === -1) { needsTabOpening = true; break; }
      }
      if (needsTabOpening && gZenWorkspaces?.changeWorkspaceWithID) {
        try { await gZenWorkspaces.changeWorkspaceWithID(spaceUuid); } catch (e) { /* non-fatal */ }
      }

      // Partition unmatched bookmarks: simple cases (essential, normal, space-root
      // pinned) are opened inline; named Zen folder bookmarks are grouped into a
      // virtual tree and restored via _openRestoredFolder — the same path used by
      // syncFromBookmarks — so tabs land inside proper Zen folders instead of as
      // flat pinned tabs.
      const namedFolderUnmatched = [];
      for (const bm of unmatchedBookmarks) {
        // Try to match to an unconsumed tab with same URL and same folder
        const bmFolder = this._normalizeFolder(bm.folder, spaceUuid);
        const tabType  = this._inferTabTypeFromFolder(bmFolder);
        const poolIdx  = unmatchedTabPool.findIndex(e => !e.consumed && e.url === bm.url && e.folder === bmFolder);
        if (poolIdx !== -1) {
          unmatchedTabPool[poolIdx].consumed = true;
          continue; // already open
        }

        if (tabType === "pinned" && bmFolder !== "") {
          // Named Zen folder — defer to folder-restoration logic below
          namedFolderUnmatched.push({ ...bm, folder: bmFolder });
          continue;
        }

        // Simple open: essential, normal, or space-root pinned (bmFolder === "")
        try {
          const addTabOpts = {
            inBackground: true,
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
          };
          if (tabType === "essential") {
            const containerTabId = gZenWorkspaces?.getWorkspaceFromId(spaceUuid)?.containerTabId ?? 0;
            if (containerTabId) addTabOpts.userContextId = containerTabId;
          }
          const tab = gBrowser.addTab(bm.url, addTabOpts);
          if (tab) {
            tab.setAttribute("zen-workspace-id", spaceUuid);
            if (tabType === "essential") {
              tab.setAttribute("zen-essential", "true");
              gBrowser.pinTab(tab);
            } else if (tabType === "pinned") {
              gBrowser.pinTab(tab);
            }
          }
          unmatchedTabPool.push({ url: bm.url, type: tabType, folder: bmFolder, consumed: true });
          result.tabsOpened++;
          spaceResult.tabsOpened++;
        } catch (e) {
          console.error(`[ZenTabs] Failed to open tab for ${bm.url}:`, e);
        }
      }

      // Restore named Zen folder bookmarks as proper Zen folder groups.
      if (namedFolderUnmatched.length > 0) {
        const virtualTree = this._buildVirtualFolderTree(namedFolderUnmatched);
        // shimResult bridges _openRestoredFolder's counter names to syncBidirectional's.
        const shimResult = { bookmarksFound: 0, tabsCreated: 0, tabsExisting: 0, errors: 0 };
        for (const rootNode of virtualTree) {
          await this._openRestoredFolder(rootNode, spaceUuid, unmatchedTabPool, shimResult, null, "");
        }
        result.tabsOpened      += shimResult.tabsCreated;
        spaceResult.tabsOpened += shimResult.tabsCreated;
      }

      // ── Step 4: Deleted on another computer → close tab ────────────
      if (closeRemoved) {
        // Count-based: for each URL+folder key in manifest, if bookmark count
        // is lower than manifest count, some were deleted remotely → close tabs.
        const deletedBudgetByUrl = new Map();
        for (const [key, mCount] of manifestKeyCounts) {
          const bmCount = bmKeyMap.get(key)?.length ?? 0;
          if (bmCount < mCount) {
            const url = key.slice(0, key.indexOf("\t"));
            deletedBudgetByUrl.set(url, (deletedBudgetByUrl.get(url) ?? 0) + (mCount - bmCount));
          }
        }
        for (const [url, count] of deletedBudgetByUrl) {
          let remaining = count;
          // Find matching tabs to close (never close essential/pinned)
          const tabs = this.manager.window.gZenWorkspaces?.allStoredTabs ?? gBrowser.tabs;
          for (const tab of [...tabs]) {
            if (remaining <= 0) break;
            if (tab.hasAttribute("zen-empty-tab")) continue;
            if (tab.linkedBrowser?.currentURI?.spec !== url) continue;
            if (tab.hasAttribute("zen-essential") || tab.pinned) continue;
            if (tab.getAttribute("zen-workspace-id") !== spaceUuid) continue;
            gBrowser.removeTab(tab);
            result.tabsClosed++;
            spaceResult.tabsClosed++;
            remaining--;
          }
        }
      }

      result.bySpace[spaceName] = spaceResult;
    }

    // Restore the workspace the user was in before the sync
    if (gZenWorkspaces?.changeWorkspaceWithID && previousWorkspace) {
      try { await gZenWorkspaces.changeWorkspaceWithID(previousWorkspace); } catch (e) { /* non-fatal */ }
    }

    // Rebuild the manifest once, after all mutations, using a single
    // getBookmarkEntriesBySpace() call (replaces the old per-space Step 5
    // that called it N times inside the loop).
    await this.rebuildManifest();
    return result;
  }

  // ── Manifest rebuild ───────────────────────────────────────────────────

  /**
   * Rebuild the sync manifest from scratch by matching current bookmarks to
   * current tabs (URL + folder, pool-based, one-to-one).
   *
   * Must be called at the end of EVERY sync operation that changes bookmarks
   * or tabs — not just syncBidirectional. If syncToBookmarks or
   * syncFromBookmarks run without updating the manifest, the next
   * syncBidirectional will see those tabs/bookmarks as "new" and create
   * duplicates.
   *
   * Replaces the old per-space Step 5 loop in syncBidirectional (which called
   * getBookmarkEntriesBySpace() once per space — N round-trips — instead of
   * one).
   */
  async rebuildManifest() {
    // Refresh the tab metadata cache before reading it.
    //
    // Root cause: workspace switching in syncFromBookmarks (and syncBidirectional)
    // fires TabAttrModified on every tab that is shown/hidden during the transition.
    // The manager's onTabUpdated handler updates the cache synchronously for each
    // event. During the DOM reorganisation, tab.group can be temporarily null or
    // point to a detached element, so getFolderPath() returns null for tabs that
    // ARE in Zen folders. The cache then holds a stale folderPath=null value.
    //
    // By the time rebuildManifest is awaited, all workspace switches are complete
    // and the DOM is in a stable state. A full rebuildCache() here re-reads every
    // tab's live group/workspace attributes once, giving us correct folderPaths.
    // Using optional chaining for test-compat with stubs that only provide getAllTabs.
    await this.manager.tabManager?.rebuildCache?.({ silent: true });

    const { gZenWorkspaces } = this.manager.window;
    const bmBySpace = await this.getBookmarkEntriesBySpace();

    // Build tabs by space (same logic as syncBidirectional preamble)
    const tabsBySpace = new Map();
    if (gZenWorkspaces) {
      for (const ws of gZenWorkspaces.getWorkspaces()) tabsBySpace.set(ws.uuid, []);
    }
    for (const tabData of await this.manager.tabManager.getAllTabs()) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) continue;
      const uuid = tabData.workspace.id;
      if (gZenWorkspaces && !tabsBySpace.has(uuid)) continue;
      if (!tabsBySpace.has(uuid)) tabsBySpace.set(uuid, []);
      tabsBySpace.get(uuid).push(tabData);
    }

    const newManifest = new Map();
    for (const [spaceUuid, tabs] of tabsBySpace) {
      const B = bmBySpace.get(spaceUuid) ?? [];
      const entries = [];
      const bmPool = B.map(bm => ({
        url: bm.url,
        normFolder: this._normalizeFolder(bm.folder, spaceUuid),
        consumed: false,
      }));
      for (const tabData of tabs) {
        const tabFolder = this._subfolderNameForTab(tabData);
        const poolIdx = bmPool.findIndex(
          e => !e.consumed && e.url === tabData.url && e.normFolder === tabFolder
        );
        if (poolIdx !== -1) {
          entries.push({ url: tabData.url, folder: tabFolder, type: tabData.type });
          bmPool[poolIdx].consumed = true;
        }
      }
      // Always set an entry array (even if empty) so that manifest.size > 0
      // and the bootstrap guard in syncBidirectional doesn't re-trigger.
      newManifest.set(spaceUuid, entries);
    }

    this.saveManifest(newManifest);
  }

  // ── PlacesUtils helpers ────────────────────────────────────────────────

  /**
   * Resolve the bookmark folder for a tab, mirroring its Zen folder hierarchy.
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
      return await this.getOrCreateFolder(spaceFolderGuid, this._essentialsFolderName(tabData.workspace.id));
    }
    if (tabData.type === "normal") {
      return await this.getOrCreateFolder(spaceFolderGuid, "Temporary tabs");
    }
    return spaceFolderGuid; // pinned with no folder → space root
  }

  /**
   * Return the subfolder name string for a tab (used for matching bookmarks
   * to tabs in syncToBookmarks).
   */
  _subfolderNameForTab(tabData) {
    const folderPath = tabData.folderPath;
    if (folderPath && folderPath.length > 0) return folderPath.join("/");
    if (tabData.type === "essential") return this._essentialsFolderName(tabData.workspace.id);
    if (tabData.type === "normal") return "Temporary tabs";
    return ""; // pinned with no folder → space root
  }

  /**
   * Infer the tab type from a bookmark's folder path (relative to space root).
   *   ""                → pinned (direct in space root)
   *   "Essentials"      → essential
   *   "Essentials/..."  → essential
   *   "Temporary tabs"  → normal
   *   "Temporary tabs/..." → normal
   *   anything else     → pinned (named Zen folder)
   */
  _inferTabTypeFromFolder(folder) {
    if (!folder || folder === "") return "pinned";
    const topLevel = folder.split("/")[0];
    if (this._isEssentialsFolder(topLevel)) return "essential";
    if (topLevel === "Temporary tabs") return "normal";
    return "pinned"; // named folder = pinned tab group
  }

  /**
   * Build a virtual bookmark folder tree from a flat array of bookmark objects
   * whose `folder` field is a non-empty path string relative to the space root
   * (e.g. "Projects" or "Projects/React").
   *
   * Returns root-level virtual folder nodes in the shape expected by
   * _openRestoredFolder:
   *   { title, uri: null, children: Array<{ uri, title } | folder node> }
   *
   * This allows syncBidirectional Step 3 to restore named Zen folder bookmarks
   * using the same path as syncFromBookmarks, instead of silently falling back
   * to flat pinned tabs.
   */
  _buildVirtualFolderTree(bookmarks) {
    const roots = [];
    const nodesByPath = new Map(); // pathKey → folder node

    const getOrCreateFolder = (pathParts) => {
      const key = pathParts.join("/");
      if (nodesByPath.has(key)) return nodesByPath.get(key);
      const node = { title: pathParts[pathParts.length - 1], uri: null, children: [] };
      nodesByPath.set(key, node);
      if (pathParts.length === 1) {
        roots.push(node);
      } else {
        const parent = getOrCreateFolder(pathParts.slice(0, -1));
        parent.children.push(node);
      }
      return node;
    };

    for (const bm of bookmarks) {
      const folderNode = getOrCreateFolder(bm.folder.split("/"));
      folderNode.children.push({ uri: bm.url, title: bm.title || bm.url });
    }

    return roots;
  }

  // ── Container helpers (essential-tab scoping) ───────────────────────────

  /**
   * Look up a container identity by its userContextId.
   * ContextualIdentityService is placed on window by zen.sys.mjs during init.
   * In tests it is placed on window by the mock helper.
   * @returns {{ userContextId, name, icon, color } | null}
   */
  _getContainerIdentity(containerTabId) {
    try {
      const CIS = this.manager.window.ContextualIdentityService
        ?? globalThis.ContextualIdentityService;
      if (!CIS) return null;
      // Prefer the direct lookup (real Firefox API)
      if (CIS.getPublicIdentityFromId) {
        return CIS.getPublicIdentityFromId(containerTabId) ?? null;
      }
      // Fallback: iterate (used by the test mock)
      if (CIS.getPublicIdentities) {
        return CIS.getPublicIdentities().find(
          id => id.userContextId === containerTabId
        ) ?? null;
      }
    } catch (e) { /* non-fatal */ }
    return null;
  }

  /**
   * Find an existing container by name.
   * @returns {{ userContextId, name, icon, color } | null}
   */
  _findContainerByName(name) {
    try {
      const CIS = this.manager.window.ContextualIdentityService
        ?? globalThis.ContextualIdentityService;
      if (CIS?.getPublicIdentities) {
        return CIS.getPublicIdentities().find(
          id => (id.name ?? id.l10nId) === name
        ) ?? null;
      }
    } catch (e) { /* non-fatal */ }
    return null;
  }

  /**
   * Find an existing container by name, or create one if it doesn't exist.
   * @param {string} name - container display name to match/create
   * @returns {number} userContextId (0 if creation fails)
   */
  _findOrCreateContainer(name) {
    const existing = this._findContainerByName(name);
    if (existing) return existing.userContextId;
    try {
      const CIS = this.manager.window.ContextualIdentityService
        ?? globalThis.ContextualIdentityService;
      if (CIS?.create) {
        const identity = CIS.create(name, "circle", "blue");
        return identity.userContextId;
      }
    } catch (e) {
      this.log("Could not create container:", name, e.message);
    }
    return 0;
  }

  /**
   * Compute the Essentials folder title for a workspace.
   * If the workspace has a container, the name is encoded as
   * "Essentials (<containerName>)". Otherwise plain "Essentials".
   */
  _essentialsFolderName(spaceUuid) {
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;
    const ws = gZenWorkspaces?.getWorkspaceFromId(spaceUuid);
    if (ws?.containerTabId) {
      const identity = this._getContainerIdentity(ws.containerTabId);
      const name = identity?.name ?? identity?.l10nId ?? null;
      if (name) return `Essentials (${name})`;
    }
    return "Essentials";
  }

  /**
   * Check whether a folder title represents the Essentials folder
   * (with or without a container suffix).
   */
  _isEssentialsFolder(title) {
    return title === "Essentials" || title.startsWith("Essentials (");
  }

  /**
   * Normalize a bookmark `folder` path for a given space so that any variant
   * of the Essentials folder ("Essentials", "Essentials (OldName)", etc.) is
   * replaced with the canonical name from `_essentialsFolderName(spaceUuid)`.
   *
   * This prevents folder-rename drift from causing infinite bookmark creation
   * when the container name changes or the feature is first enabled.
   */
  _normalizeFolder(folder, spaceUuid) {
    if (!folder) return folder;
    // Split on "/" to handle nested paths like "Essentials/sub"
    const parts = folder.split("/");
    if (this._isEssentialsFolder(parts[0])) {
      parts[0] = this._essentialsFolderName(spaceUuid);
    }
    return parts.join("/");
  }

  /**
   * Extract the container name from an Essentials folder title.
   * Returns null if the title is plain "Essentials" (no container encoded).
   * @param {string} title - e.g. "Essentials (Work)"
   * @returns {string|null}
   */
  _parseEssentialsFolderName(title) {
    const match = title.match(/^Essentials \((.+)\)$/);
    return match ? match[1] : null;
  }

  /**
   * Ensure a workspace has a dedicated container for essential-tab scoping.
   * If the workspace already has a non-zero containerTabId, this is a no-op.
   * Otherwise looks up a container by name (preferring containerName if given,
   * falling back to workspace name), or creates one.
   *
   * @param {string} spaceUuid
   * @param {string|null} containerName - preferred container name from marker
   * @returns {number} the (possibly new) containerTabId
   */
  async _ensureWorkspaceContainer(spaceUuid, containerName = null) {
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;
    if (!gZenWorkspaces) return 0;
    const ws = gZenWorkspaces.getWorkspaceFromId(spaceUuid);
    if (!ws) return 0;
    if (ws.containerTabId) return ws.containerTabId;

    const name = containerName || ws.name;
    const newId = this._findOrCreateContainer(name);
    if (newId) {
      ws.containerTabId = newId;
      if (gZenWorkspaces.saveWorkspace) {
        await gZenWorkspaces.saveWorkspace(ws);
      }
    }
    return newId;
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
  onBookmarkRemoved(url) { this.log("Bookmark removed:", url); }
  onBookmarkChanged(guid) { this.log("Bookmark changed:", guid); }

  // ── Log / shutdown ─────────────────────────────────────────────────────

  log(...args) {
    this.manager.log("[SyncManager]", ...args);
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.log("SyncManager shut down");
  }
}
