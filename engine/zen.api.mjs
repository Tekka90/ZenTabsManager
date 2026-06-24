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
    return window.ZenTabsManager.simpleBookmarkSyncManager.syncTabsToBookmarks(options);
  },

  async syncFromBookmarks(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.simpleBookmarkSyncManager.syncBookmarksToTabs(options);
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
  },

  async publishTabsToSftp(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    if (!window.ZenTabsManager.tabPublishManager) {
      throw new Error("TabPublishManager not initialized");
    }
    return window.ZenTabsManager.tabPublishManager.publishTabsToSftp(options);
  },

  pause() {
    if (typeof window.ZenTabsManager === "undefined") throw new Error("ZenTabsManager not initialized");
    window.ZenTabsManager.pause();
  },

  resume() {
    if (typeof window.ZenTabsManager === "undefined") throw new Error("ZenTabsManager not initialized");
    window.ZenTabsManager.resume();
  },

  isPaused() {
    if (typeof window.ZenTabsManager === "undefined") throw new Error("ZenTabsManager not initialized");
    return window.ZenTabsManager.isPaused();
  },
};

export default ZenTabsAPI;
