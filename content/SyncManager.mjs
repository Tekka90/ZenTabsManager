/**
 * SyncManager - Bi-directional bookmark synchronization
 * 
 * Handles syncing between tabs and bookmarks in both directions.
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
    
    // Load bookmark cache
    await this.rebuildBookmarkCache();
    
    // Subscribe to bookmark changes
    this.setupBookmarkObserver();
    
    this.log("SyncManager initialized");
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
        if (child.type === PlacesUtils.bookmarks.TYPE_FOLDER) {
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
   * Setup bookmark observer for changes
   */
  setupBookmarkObserver() {
    // Listen for bookmark changes
    if (this.manager.window.PlacesUtils && this.manager.window.PlacesUtils.observers) {
      const observer = {
        onItemAdded: (id, parent, index, type, uri) => {
          if (uri) {
            this.onBookmarkAdded(uri.spec);
          }
        },
        onItemRemoved: (id, parent, index, type, uri) => {
          if (uri) {
            this.onBookmarkRemoved(uri.spec);
          }
        },
        onItemChanged: (id, property, isAnnotation, value, lastModified, type, parent, guid, parentGuid, oldValue, source) => {
          this.onBookmarkChanged(guid);
        }
      };
      
      // This might not work in all Firefox versions, fallback gracefully
      try {
        this.manager.window.PlacesUtils.observers.addListener(["bookmark-added", "bookmark-removed", "bookmark-title-changed", "bookmark-url-changed"], observer);
      } catch (e) {
        this.log("Could not setup bookmark observer:", e.message);
      }
    }
  }

  /**
   * Perform sync based on preferences
   */
  async performSync() {
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
   * Sync tabs to bookmarks, organized per Space.
   * Bookmark structure: Zen/<SpaceName>/Essentials/, Zen/<SpaceName>/<FolderPath>/, Zen/<SpaceName>/Normal/
   */
  async syncToBookmarks(options = {}) {
    const opts = {
      includeEssential: true,
      includePinned: true,
      includeNormal: false,
      ...options
    };

    this.log("Syncing tabs to bookmarks (space-aware)...");

    const PlacesUtils = this.manager.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;

    const allTabs = await this.manager.tabManager.getAllTabs();
    const result = {
      essentialCount: 0,
      pinnedCount: 0,
      normalCount: 0,
      foldersCreated: 0,
      bookmarksCreated: 0,
      bookmarksUpdated: 0,
      skipped: 0,
      bySpace: {}
    };

    // Group tabs by space (uuid -> { space, tabs[] })
    const tabsBySpace = new Map();

    if (gZenWorkspaces) {
      for (const workspace of gZenWorkspaces.getWorkspaces()) {
        tabsBySpace.set(workspace.uuid, { space: workspace, tabs: [] });
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
          tabs: []
        });
      }
      tabsBySpace.get(spaceId).tabs.push(tabData);
    }

    // Sync each space into Zen/<SpaceName>/
    for (const [spaceId, { space, tabs }] of tabsBySpace) {
      if (tabs.length === 0) continue;

      const spaceFolderGuid = await this.getOrCreateFolder(zenFolderGuid, space.name);
      const spaceResult = { essential: 0, pinned: 0, normal: 0 };

      const essentialTabs = tabs.filter(t => t.type === "essential" && opts.includeEssential);
      const pinnedTabs    = tabs.filter(t => t.type === "pinned"    && opts.includePinned);
      const normalTabs    = tabs.filter(t => t.type === "normal"    && opts.includeNormal);

      // Essential tabs -> Zen/<Space>/Essentials/
      if (essentialTabs.length > 0) {
        const essentialsFolderGuid = await this.getOrCreateFolder(spaceFolderGuid, "Essentials");
        for (const tabData of essentialTabs) {
          const created = await this.createOrUpdateBookmark(essentialsFolderGuid, tabData.title, tabData.url);
          if (created) result.bookmarksCreated++; else result.bookmarksUpdated++;
          result.essentialCount++;
          spaceResult.essential++;
        }
      }

      // Pinned tabs — preserve Zen folder hierarchy under Zen/<Space>/
      const folderStructure = new Map();
      const pinnedNoFolder = [];
      for (const tabData of pinnedTabs) {
        if (tabData.folderPath) {
          const pathKey = tabData.folderPath.join('/');
          if (!folderStructure.has(pathKey)) {
            folderStructure.set(pathKey, { path: tabData.folderPath, tabs: [] });
          }
          folderStructure.get(pathKey).tabs.push(tabData);
        } else {
          pinnedNoFolder.push(tabData);
        }
      }

      const folderGuidCache = new Map();
      for (const folder of [...folderStructure.values()].sort((a, b) => a.path.length - b.path.length)) {
        let currentParentGuid = spaceFolderGuid;
        for (let i = 0; i < folder.path.length; i++) {
          const folderName = folder.path[i];
          const pathKey = folder.path.slice(0, i + 1).join('/');
          if (folderGuidCache.has(pathKey)) {
            currentParentGuid = folderGuidCache.get(pathKey);
          } else {
            const guid = await this.getOrCreateFolder(currentParentGuid, folderName);
            folderGuidCache.set(pathKey, guid);
            currentParentGuid = guid;
            result.foldersCreated++;
          }
        }
        for (const tabData of folder.tabs) {
          const created = await this.createOrUpdateBookmark(currentParentGuid, tabData.title, tabData.url);
          if (created) result.bookmarksCreated++; else result.bookmarksUpdated++;
          result.pinnedCount++;
          spaceResult.pinned++;
        }
      }

      for (const tabData of pinnedNoFolder) {
        const created = await this.createOrUpdateBookmark(spaceFolderGuid, tabData.title, tabData.url);
        if (created) result.bookmarksCreated++; else result.bookmarksUpdated++;
        result.pinnedCount++;
        spaceResult.pinned++;
      }

      // Normal tabs -> Zen/<Space>/Normal/
      if (normalTabs.length > 0) {
        const normalFolderGuid = await this.getOrCreateFolder(spaceFolderGuid, "Normal");
        for (const tabData of normalTabs) {
          const created = await this.createOrUpdateBookmark(normalFolderGuid, tabData.title, tabData.url);
          if (created) result.bookmarksCreated++; else result.bookmarksUpdated++;
          result.normalCount++;
          spaceResult.normal++;
        }
      }

      result.bySpace[space.name] = spaceResult;
    }

    await this.rebuildBookmarkCache();
    return result;
  }

  /**
   * Sync bookmarks to tabs, space-aware.
   * Reads Zen/<SpaceName>/ subfolders and opens bookmarks into the matching Space.
   */
  async syncFromBookmarks(folderPath = "Zen") {
    this.log("Syncing bookmarks to tabs (space-aware)...");

    const PlacesUtils = this.manager.window.PlacesUtils;
    const toolbarGuid = PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");
    const gZenWorkspaces = this.manager.window.gZenWorkspaces;

    const result = {
      bookmarksFound: 0,
      tabsCreated: 0,
      tabsExisting: 0,
      errors: 0
    };

    // Build space name -> uuid map
    const spaceByName = new Map();
    if (gZenWorkspaces) {
      for (const workspace of gZenWorkspaces.getWorkspaces()) {
        spaceByName.set(workspace.name, workspace.uuid);
      }
    }

    // Get current tab URLs to avoid duplicates
    const existingUrls = new Set();
    for (const tabData of await this.manager.tabManager.getAllTabs()) {
      existingUrls.add(tabData.url);
    }

    // Walk Zen/<SpaceName>/ subfolders
    const zenTree = await PlacesUtils.promiseBookmarksTree(zenFolderGuid, { includeItemIds: false });
    if (!zenTree || !zenTree.children) return result;

    for (const spaceFolder of zenTree.children) {
      if (spaceFolder.type !== PlacesUtils.bookmarks.TYPE_FOLDER) continue;

      const spaceUuid = spaceByName.get(spaceFolder.title) || null;
      const bookmarks = await this.getAllBookmarksInFolder(spaceFolder.guid);
      result.bookmarksFound += bookmarks.length;

      for (const bm of bookmarks) {
        if (!bm.url || existingUrls.has(bm.url)) {
          result.tabsExisting++;
          continue;
        }
        try {
          const tab = this.manager.window.gBrowser.addTab(bm.url, {
            inBackground: true,
            triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
          });
          // Assign to the correct Space
          if (spaceUuid && tab) {
            tab.setAttribute("zen-workspace-id", spaceUuid);
          }
          result.tabsCreated++;
          existingUrls.add(bm.url);
        } catch (error) {
          console.error(`Error opening tab for ${bm.url}:`, error);
          result.errors++;
        }
      }
    }

    return result;
  }

  /**
   * Bi-directional sync
   */
  async syncBidirectional() {
    this.log("Performing bidirectional sync...");
    
    const toBookmarks = await this.syncToBookmarks();
    const fromBookmarks = await this.syncFromBookmarks();
    
    return {
      toBookmarks,
      fromBookmarks,
      total: {
        bookmarksCreated: toBookmarks.bookmarksCreated,
        bookmarksUpdated: toBookmarks.bookmarksUpdated,
        tabsCreated: fromBookmarks.tabsCreated,
        tabsExisting: fromBookmarks.tabsExisting
      }
    };
  }

  /**
   * Get or create bookmark folder
   */
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
   * Create or update bookmark
   * @returns {boolean} true if created, false if updated
   */
  async createOrUpdateBookmark(parentId, title, url) {
    const existing = await this.manager.window.PlacesUtils.bookmarks.search({ url: url });
    
    for (const bookmark of existing) {
      if (bookmark.parentGuid === parentId) {
        if (bookmark.title !== title) {
          await this.manager.window.PlacesUtils.bookmarks.update(bookmark.guid, { title });
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

  /**
   * Event handlers
   */
  onBookmarkAdded(url) {
    this.log("Bookmark added:", url);
    // If bidirectional sync, open tab
    if (this.manager.preferences.syncDirection === "bidirectional" && 
        this.manager.preferences.syncEnabled) {
      // Check if tab already exists
      const tabs = this.manager.window.gBrowser.tabs;
      for (const tab of tabs) {
        if (tab.linkedBrowser.currentURI?.spec === url) {
          return; // Tab exists
        }
      }
      // Open tab
      this.manager.window.gBrowser.addTab(url, { inBackground: true });
    }
  }

  onBookmarkRemoved(url) {
    this.log("Bookmark removed:", url);
    this.bookmarkMap.delete(url);
  }

  onBookmarkChanged(guid) {
    this.log("Bookmark changed:", guid);
  }

  /**
   * Log helper
   */
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
