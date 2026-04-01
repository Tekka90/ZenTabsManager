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
  async rebuildCache({ silent = false } = {}) {
    this.tabMetadataCache.clear();
    const win = this.manager.window;
    // allStoredTabs covers all spaces; fall back to gBrowser.tabs before Zen initializes
    const tabs = win.gZenWorkspaces?.allStoredTabs ?? win.gBrowser.tabs;

    for (const tab of tabs) {
      if (tab.hasAttribute("zen-empty-tab")) continue;
      this.cacheTabMetadata(tab);
    }

    if (!silent) this.log(`Cache rebuilt with ${this.tabMetadataCache.size} tabs`);
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
      url: this._extractTabUrl(tab),
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
   * Extract the best available URL for a tab.
   *
   * During session restore, or for tabs in inactive Zen Spaces, the browser's
   * currentURI is "about:blank".  In those cases we consult SessionStore for
   * the real URL that will be loaded when the tab is restored/activated.
   */
  _extractTabUrl(tab) {
    // For pinned tabs, Zen stores the canonical "pinned URL" in _zenPinnedInitialState.
    // The currently-loaded page may be an SSO redirect or auth wall — always prefer the
    // stored pinned URL to avoid bookmarking ephemeral navigation targets.
    if (tab.pinned && tab._zenPinnedInitialState?.entry?.url) {
      return tab._zenPinnedInitialState.entry.url;
    }

    const browser = tab.linkedBrowser;
    const uri = browser?.currentURI?.spec;
    if (uri && uri !== "about:blank") return uri;

    // Pending tabs: Firefox stores a userTypedValue on the browser
    if (browser?.userTypedValue) return browser.userTypedValue;

    // SessionStore keeps the full tab state including the URL
    try {
      const ss = this.manager.window.SessionStore;
      if (ss?.getTabState) {
        const state = JSON.parse(ss.getTabState(tab));
        const lastEntry = state?.entries?.[state.entries.length - 1];
        if (lastEntry?.url) return lastEntry.url;
      }
    } catch (e) { /* non-fatal */ }

    return uri || "about:blank";
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
   * Get workspace (Space) information
   * Zen calls these "Spaces" in the UI but "workspaces" in code.
   * Space object shape: { uuid, name, icon, theme, containerTabId }
   */
  getWorkspaceInfo(tab) {
    if (typeof this.manager.window.gZenWorkspaces !== "undefined") {
      const workspaceId = tab.getAttribute("zen-workspace-id");
      if (workspaceId) {
        try {
          const workspace = this.manager.window.gZenWorkspaces.getWorkspaceFromId(workspaceId);
          return {
            id: workspaceId,
            name: workspace?.name ?? workspaceId,
            icon: workspace?.icon ?? null,
            containerTabId: workspace?.containerTabId ?? 0
          };
        } catch (e) {
          return { id: workspaceId, name: workspaceId, icon: null, containerTabId: 0 };
        }
      }
    }
    return { id: "default", name: "default", icon: null, containerTabId: 0 };
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
   * Get all tabs with full metadata.
   * IMPORTANT: In Zen Browser, gBrowser.tabs only returns tabs from the ACTIVE
   * space. To get tabs across all spaces, use gZenWorkspaces.allStoredTabs.
   */
  async getAllTabs() {
    const win = this.manager.window;
    // Use allStoredTabs when available — it covers tabs from all Spaces.
    const tabs = (win.gZenWorkspaces?.allStoredTabs) ?? win.gBrowser.tabs;
    const result = [];

    for (const tab of tabs) {
      if (tab.hasAttribute("zen-empty-tab")) continue;
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
      bySpace: {}, // { [spaceName]: { id, icon, total, essential, pinned, normal } }
      inFolders: 0,
      spaces: 0,
      folders: new Set(),
      oldestTab: null,
      newestTab: null,
      memorySavings: 0
    };
    
    const spaceMap = new Map(); // spaceId -> accumulator
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
      
      // Per-space breakdown
      const { id: spaceId, name: spaceName, icon: spaceIcon } = tabData.workspace;
      if (!spaceMap.has(spaceId)) {
        spaceMap.set(spaceId, { id: spaceId, name: spaceName, icon: spaceIcon, total: 0, essential: 0, pinned: 0, normal: 0 });
      }
      const spaceStat = spaceMap.get(spaceId);
      spaceStat.total++;
      spaceStat[tabData.type]++;
      
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
    
    stats.spaces = spaceMap.size;
    stats.folders = stats.folders.size;
    for (const [, data] of spaceMap) {
      stats.bySpace[data.name] = { id: data.id, icon: data.icon, total: data.total, essential: data.essential, pinned: data.pinned, normal: data.normal };
    }
    
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
