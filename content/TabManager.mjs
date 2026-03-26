/**
 * TabManager - Core tab metadata and operations
 * 
 * Handles tab enumeration, classification, and metadata extraction.
 */

export class TabManager {
  constructor(manager) {
    this.manager = manager;
    this.tabMetadataCache = new Map();
    this.log("TabManager created");
  }

  async init() {
    this.log("TabManager initializing...");
    
    // Subscribe to tab events to update cache
    this.manager.on("tab-created", (data) => this.onTabCreated(data.tab));
    this.manager.on("tab-removed", (data) => this.onTabRemoved(data.tab));
    this.manager.on("tab-updated", (data) => this.onTabUpdated(data.tab));
    
    // Build initial cache
    await this.rebuildCache();
    
    this.log("TabManager initialized");
  }

  /**
   * Rebuild the tab metadata cache
   */
  async rebuildCache() {
    this.tabMetadataCache.clear();
    const tabs = window.gBrowser.tabs;
    
    for (const tab of tabs) {
      this.cacheTabMetadata(tab);
    }
    
    this.log(`Cache rebuilt with ${this.tabMetadataCache.size} tabs`);
  }

  /**
   * Cache metadata for a tab
   */
  cacheTabMetadata(tab) {
    const metadata = this.extractTabMetadata(tab);
    this.tabMetadataCache.set(tab, metadata);
    return metadata;
  }

  /**
   * Extract full metadata from a tab
   */
  extractTabMetadata(tab) {
    const browser = tab.linkedBrowser;
    const type = this.getTabType(tab);
    const state = this.getTabState(tab);
    const workspace = this.getWorkspaceInfo(tab);
    const folderPath = this.getFolderPath(tab);
    
    return {
      tab,
      id: tab._tPos,
      type,
      state,
      workspace,
      folderPath,
      folderLevel: tab.group?.level ?? -1,
      folderCollapsed: tab.group?.collapsed ?? false,
      title: tab.label || tab.getAttribute("label") || "Untitled",
      url: browser.currentURI?.spec || "about:blank",
      favicon: tab.image || null,
      visible: tab.visible !== false,
      hidden: tab.hidden,
      muted: tab.muted,
      soundPlaying: tab.soundPlaying,
      container: tab.userContextId || null,
      lastAccessed: tab.lastAccessed || Date.now(),
      createdAt: tab.createdAt || Date.now(),
      ...this.getTabAge(tab)
    };
  }

  /**
   * Get tab type
   */
  getTabType(tab) {
    if (tab.hasAttribute("zen-essential")) return "essential";
    if (tab.pinned) return "pinned";
    return "normal";
  }

  /**
   * Get tab state
   */
  getTabState(tab) {
    const states = [];
    if (tab.selected) states.push("active");
    if (tab.hasAttribute("pending")) states.push("pending");
    if (tab.hasAttribute("busy")) states.push("loading");
    if (tab.hasAttribute("crashed")) states.push("crashed");
    if (tab.hidden) states.push("hidden");
    if (tab.muted) states.push("muted");
    if (tab.soundPlaying) states.push("playing-sound");
    if (tab.hasAttribute("discarded")) states.push("discarded");
    return states.length > 0 ? states : ["loaded"];
  }

  /**
   * Get workspace information
   */
  getWorkspaceInfo(tab) {
    if (typeof window.gZenWorkspaces !== "undefined") {
      const workspaceId = tab.getAttribute("zen-workspace-id");
      if (workspaceId) {
        try {
          const workspace = window.gZenWorkspaces.getWorkspaceById(workspaceId);
          return {
            id: workspaceId,
            name: workspace ? workspace.name : workspaceId
          };
        } catch (e) {
          return { id: workspaceId, name: workspaceId };
        }
      }
    }
    return { id: "default", name: "default" };
  }

  /**
   * Get folder path for a tab
   */
  getFolderPath(tab) {
    const path = [];
    let current = tab.group;
    
    while (current && current.isZenFolder) {
      path.unshift(current.label || 'Unnamed Folder');
      current = current.group;
    }
    
    return path.length > 0 ? path : null;
  }

  /**
   * Get tab age information
   */
  getTabAge(tab) {
    const now = Date.now();
    const lastAccessed = tab.lastAccessed || tab.createdAt || now;
    const createdAt = tab.createdAt || lastAccessed;
    
    const ageMs = now - lastAccessed;
    const createdAgeMs = now - createdAt;
    
    return {
      lastAccessedAge: {
        milliseconds: ageMs,
        seconds: Math.floor(ageMs / 1000),
        minutes: Math.floor(ageMs / 60000),
        hours: Math.floor(ageMs / 3600000),
        days: Math.floor(ageMs / 86400000)
      },
      createdAge: {
        milliseconds: createdAgeMs,
        seconds: Math.floor(createdAgeMs / 1000),
        minutes: Math.floor(createdAgeMs / 60000),
        hours: Math.floor(createdAgeMs / 3600000),
        days: Math.floor(createdAgeMs / 86400000)
      }
    };
  }

  /**
   * Get all tabs with full metadata
   */
  async getAllTabs() {
    const tabs = window.gBrowser.tabs;
    const result = [];
    
    for (const tab of tabs) {
      let metadata = this.tabMetadataCache.get(tab);
      if (!metadata) {
        metadata = this.cacheTabMetadata(tab);
      }
      result.push(metadata);
    }
    
    return result;
  }

  /**
   * Get tabs filtered by criteria
   */
  async getTabsFiltered(filters = {}) {
    const allTabs = await this.getAllTabs();
    
    return allTabs.filter(tabData => {
      // Type filter
      if (filters.type && tabData.type !== filters.type) {
        return false;
      }
      
      // State filter (any of the states)
      if (filters.state && !tabData.state.includes(filters.state)) {
        return false;
      }
      
      // Workspace filter
      if (filters.workspace && tabData.workspace.id !== filters.workspace && 
          tabData.workspace.name !== filters.workspace) {
        return false;
      }
      
      // Folder filter (contains folder in path)
      if (filters.folder) {
        if (!tabData.folderPath) return false;
        const folderStr = tabData.folderPath.join(' / ');
        if (!folderStr.includes(filters.folder)) return false;
      }
      
      // URL filter (regex or string match)
      if (filters.url) {
        if (filters.url instanceof RegExp) {
          if (!filters.url.test(tabData.url)) return false;
        } else if (!tabData.url.includes(filters.url)) {
          return false;
        }
      }
      
      // Age filter (in days)
      if (filters.olderThan !== undefined) {
        if (tabData.lastAccessedAge.days < filters.olderThan) {
          return false;
        }
      }
      
      return true;
    });
  }

  /**
   * Get statistics about current tabs
   */
  async getStatistics() {
    const allTabs = await this.getAllTabs();
    
    const stats = {
      total: allTabs.length,
      byType: {
        essential: 0,
        pinned: 0,
        normal: 0
      },
      byState: {},
      inFolders: 0,
      workspaces: new Set(),
      folders: new Set(),
      oldestTab: null,
      newestTab: null,
      memorySavings: 0
    };
    
    let oldestDate = Date.now();
    let newestDate = 0;
    
    for (const tabData of allTabs) {
      // Count by type
      stats.byType[tabData.type]++;
      
      // Count by state
      for (const state of tabData.state) {
        stats.byState[state] = (stats.byState[state] || 0) + 1;
      }
      
      // Count folders
      if (tabData.folderPath) {
        stats.inFolders++;
        tabData.folderPath.forEach(f => stats.folders.add(f));
      }
      
      // Count workspaces
      stats.workspaces.add(tabData.workspace.name);
      
      // Track oldest/newest
      const created = tabData.tab.createdAt || tabData.tab.lastAccessed;
      if (created < oldestDate) {
        oldestDate = created;
        stats.oldestTab = tabData;
      }
      if (created > newestDate) {
        newestDate = created;
        stats.newestTab = tabData;
      }
      
      // Estimate memory savings from discarded tabs
      if (tabData.state.includes("discarded")) {
        stats.memorySavings += 50; // Rough estimate: 50MB per discarded tab
      }
    }
    
    stats.workspaces = stats.workspaces.size;
    stats.folders = stats.folders.size;
    
    return stats;
  }

  /**
   * Event handlers
   */
  onTabCreated(tab) {
    this.cacheTabMetadata(tab);
    this.manager.dispatchEvent("tabs-changed", { action: "created", tab });
  }

  onTabRemoved(tab) {
    this.tabMetadataCache.delete(tab);
    this.manager.dispatchEvent("tabs-changed", { action: "removed", tab });
  }

  onTabUpdated(tab) {
    this.cacheTabMetadata(tab);
    this.manager.dispatchEvent("tabs-changed", { action: "updated", tab });
  }

  /**
   * Log helper
   */
  log(...args) {
    this.manager.log("[TabManager]", ...args);
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.tabMetadataCache.clear();
    this.log("TabManager shut down");
  }
}
