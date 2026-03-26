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
      const zenFolder = await this.getOrCreateFolder(window.PlacesUtils.bookmarks.toolbarGuid, "Zen");
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
    const children = await window.PlacesUtils.bookmarks.getChildBookmarks(folderGuid);
    
    for (const child of children) {
      if (child.type === window.PlacesUtils.bookmarks.TYPE_BOOKMARK) {
        bookmarks.push(child);
      } else if (child.type === window.PlacesUtils.bookmarks.TYPE_FOLDER) {
        const subBookmarks = await this.getAllBookmarksInFolder(child.guid);
        bookmarks.push(...subBookmarks);
      }
    }
    
    return bookmarks;
  }

  /**
   * Setup bookmark observer for changes
   */
  setupBookmarkObserver() {
    // Listen for bookmark changes
    if (window.PlacesUtils && window.PlacesUtils.observers) {
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
        window.PlacesUtils.observers.addListener(["bookmark-added", "bookmark-removed", "bookmark-changed"], observer);
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
   * Sync tabs to bookmarks
   */
  async syncToBookmarks(options = {}) {
    const opts = {
      includeEssential: true,
      includePinned: true,
      includeNormal: false,
      ...options
    };
    
    this.log("Syncing tabs to bookmarks...");
    
    const toolbarGuid = window.PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");
    const essentialsFolderGuid = await this.getOrCreateFolder(zenFolderGuid, "Essentials");
    
    const tabs = await this.manager.tabManager.getAllTabs();
    const result = {
      essentialCount: 0,
      pinnedCount: 0,
      normalCount: 0,
      foldersCreated: 0,
      bookmarksCreated: 0,
      bookmarksUpdated: 0,
      skipped: 0
    };
    
    const folderStructure = new Map();
    const essentialTabs = [];
    const pinnedTabs = [];
    const normalTabs = [];
    
    // Collect tabs
    for (const tabData of tabs) {
      if (tabData.url.startsWith("about:") || tabData.url.startsWith("chrome://")) {
        result.skipped++;
        continue;
      }
      
      if (tabData.type === "essential" && opts.includeEssential) {
        essentialTabs.push(tabData);
        result.essentialCount++;
      } else if (tabData.type === "pinned" && opts.includePinned) {
        if (tabData.folderPath) {
          const pathKey = tabData.folderPath.join('/');
          if (!folderStructure.has(pathKey)) {
            folderStructure.set(pathKey, { path: tabData.folderPath, tabs: [] });
          }
          folderStructure.get(pathKey).tabs.push(tabData);
        } else {
          pinnedTabs.push(tabData);
        }
        result.pinnedCount++;
      } else if (tabData.type === "normal" && opts.includeNormal) {
        normalTabs.push(tabData);
        result.normalCount++;
      }
    }
    
    // Create Essential bookmarks
    for (const tabData of essentialTabs) {
      const created = await this.createOrUpdateBookmark(essentialsFolderGuid, tabData.title, tabData.url);
      if (created) result.bookmarksCreated++;
      else result.bookmarksUpdated++;
    }
    
    // Create folder structure with pinned tabs
    const sortedFolders = Array.from(folderStructure.values()).sort((a, b) => a.path.length - b.path.length);
    const folderGuidCache = new Map();
    
    for (const folder of sortedFolders) {
      let currentParentGuid = zenFolderGuid;
      
      for (let i = 0; i < folder.path.length; i++) {
        const folderName = folder.path[i];
        const pathKey = folder.path.slice(0, i + 1).join('/');
        
        if (folderGuidCache.has(pathKey)) {
          currentParentGuid =folderGuidCache.get(pathKey);
        } else {
          const guid = await this.getOrCreateFolder(currentParentGuid, folderName);
          folderGuidCache.set(pathKey, guid);
          currentParentGuid = guid;
          result.foldersCreated++;
        }
      }
      
      for (const tabData of folder.tabs) {
        const created = await this.createOrUpdateBookmark(currentParentGuid, tabData.title, tabData.url);
        if (created) result.bookmarksCreated++;
        else result.bookmarksUpdated++;
      }
    }
    
    // Create pinned tabs not in folders
    if (pinnedTabs.length > 0) {
      const pinnedFolderGuid = await this.getOrCreateFolder(zenFolderGuid, "Pinned");
      for (const tabData of pinnedTabs) {
        const created = await this.createOrUpdateBookmark(pinnedFolderGuid, tabData.title, tabData.url);
        if (created) result.bookmarksCreated++;
        else result.bookmarksUpdated++;
      }
    }
    
    // Create normal tabs folder if needed
    if (normalTabs.length > 0) {
      const normalFolderGuid = await this.getOrCreateFolder(zenFolderGuid, "Normal");
      for (const tabData of normalTabs) {
        const created = await this.createOrUpdateBookmark(normalFolderGuid, tabData.title, tabData.url);
        if (created) result.bookmarksCreated++;
        else result.bookmarksUpdated++;
      }
    }
    
    await this.rebuildBookmarkCache();
    
    return result;
  }

  /**
   * Sync bookmarks to tabs
   */
  async syncFromBookmarks(folderPath = "Zen") {
    this.log("Syncing bookmarks to tabs...");
    
    const toolbarGuid = window.PlacesUtils.bookmarks.toolbarGuid;
    const zenFolderGuid = await this.getOrCreateFolder(toolbarGuid, "Zen");
    
    const bookmarks = await this.getAllBookmarksInFolder(zenFolderGuid);
    
    const result = {
      bookmarksFound: bookmarks.length,
      tabsCreated: 0,
      tabsExisting: 0,
      errors: 0
    };
    
    // Get current tab URLs
    const existingUrls = new Set();
    const tabs = await this.manager.tabManager.getAllTabs();
    for (const tabData of tabs) {
      existingUrls.add(tabData.url);
    }
    
    // Open bookmarks that don't have tabs
    for (const bm of bookmarks) {
      if (!bm.url || existingUrls.has(bm.url)) {
        result.tabsExisting++;
        continue;
      }
      
      try {
        // Open tab in background
        window.gBrowser.addTab(bm.url, {
          inBackground: true,
          triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()
        });
        result.tabsCreated++;
      } catch (error) {
        console.error(`Error opening tab for ${bm.url}:`, error);
        result.errors++;
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
    const existing = await window.PlacesUtils.bookmarks.search({ 
      query: title,
      type: window.PlacesUtils.bookmarks.TYPE_FOLDER 
    });
    
    for (const bookmark of existing) {
      if (bookmark.title === title && bookmark.parentGuid === parentId) {
        return bookmark.guid;
      }
    }
    
    const folder = await window.PlacesUtils.bookmarks.insert({
      parentGuid: parentId,
      type: window.PlacesUtils.bookmarks.TYPE_FOLDER,
      title: title
    });
    
    return folder.guid;
  }

  /**
   * Create or update bookmark
   * @returns {boolean} true if created, false if updated
   */
  async createOrUpdateBookmark(parentId, title, url) {
    const existing = await window.PlacesUtils.bookmarks.search({ url: url });
    
    for (const bookmark of existing) {
      if (bookmark.parentGuid === parentId) {
        if (bookmark.title !== title) {
          await window.PlacesUtils.bookmarks.update(bookmark.guid, { title });
        }
        return false; // Updated
      }
    }
    
    await window.PlacesUtils.bookmarks.insert({
      parentGuid: parentId,
      type: window.PlacesUtils.bookmarks.TYPE_BOOKMARK,
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
      const tabs = window.gBrowser.tabs;
      for (const tab of tabs) {
        if (tab.linkedBrowser.currentURI?.spec === url) {
          return; // Tab exists
        }
      }
      // Open tab
      window.gBrowser.addTab(url, { inBackground: true });
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
