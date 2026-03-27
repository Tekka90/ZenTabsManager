/**
 * ZenTabs Manager - Public API
 * 
 * Public API for interacting with ZenTabs Manager
 */

export const ZenTabsAPI = {
  getVersion() {
    return "1.0.0";
  },

  async listAllTabs() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getAllTabs();
  },

  async getTabsFiltered(filters = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getTabsFiltered(filters);
  },

  async syncToBookmarks(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncToBookmarks(options);
  },

  async syncFromBookmarks(folderPath) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncFromBookmarks(folderPath);
  },

  async syncBidirectional() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncBidirectional();
  },

  async cleanupOldTabs(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.cleanupManager.cleanupOldTabs(options);
  },

  async optimizeMemory(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.cleanupManager.optimizeMemory(options);
  },

  async getStatistics() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getStatistics();
  },

  getPreferences() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.getPreferences();
  },

  async setPreferences(prefs) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.setPreferences(prefs);
  },

  on(eventType, callback) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.on(eventType, callback);
  },

  async exportToJSON(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    const tabs = await this.listAllTabs();
    const stats = await this.getStatistics();
    
    return JSON.stringify({
      version: "1.0.0",
      timestamp: new Date().toISOString(),
      statistics: stats,
      tabs: tabs
    }, null, 2);
  }
};

export default ZenTabsAPI;
