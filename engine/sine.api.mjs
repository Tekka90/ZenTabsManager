/**
 * ZenTabs Manager - Sine API Definition
 * 
 * This file defines the public API that other mods can use to interact
 * with ZenTabs Manager functionality.
 */

export const ZenTabsAPI = {
  /**
   * Get version information
   */
  getVersion() {
    return "1.0.0";
  },

  /**
   * List all tabs with full metadata
   * @returns {Promise<Array>} Array of tab objects with metadata
   */
  async listAllTabs() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getAllTabs();
  },

  /**
   * Get tabs filtered by criteria
   * @param {Object} filters - Filter criteria
   * @param {string} filters.type - Tab type: 'essential', 'pinned', 'normal'
   * @param {string} filters.state - Tab state: 'active', 'loading', 'discarded', etc.
   * @param {string} filters.workspace - Workspace name or ID
   * @param {string} filters.folder - Folder path
   * @returns {Promise<Array>} Filtered array of tabs
   */
  async getTabsFiltered(filters = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getTabsFiltered(filters);
  },

  /**
   * Sync tabs to bookmarks
   * @param {Object} options - Sync options
   * @param {boolean} options.includeEssential - Include Essential tabs
   * @param {boolean} options.includePinned - Include Pinned tabs
   * @param {boolean} options.includeNormal - Include Normal tabs
   * @returns {Promise<Object>} Sync result with counts
   */
  async syncToBookmarks(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncToBookmarks(options);
  },

  /**
   * Sync bookmarks to tabs
   * @param {string} folderPath - Bookmark folder path (e.g., 'Zen/Essentials')
   * @returns {Promise<Object>} Sync result with counts
   */
  async syncFromBookmarks(folderPath) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncFromBookmarks(folderPath);
  },

  /**
   * Perform bidirectional sync
   * @returns {Promise<Object>} Sync result
   */
  async syncBidirectional() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.syncManager.syncBidirectional();
  },

  /**
   * Clean up old tabs based on criteria
   * @param {Object} options - Cleanup options
   * @param {number} options.maxAge - Maximum age in days
   * @param {Array<string>} options.excludeDomains - Domains to exclude
   * @param {boolean} options.dryRun - If true, only return what would be cleaned
   * @returns {Promise<Object>} Cleanup result with closed tab count
   */
  async cleanupOldTabs(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.cleanupManager.cleanupOldTabs(options);
  },

  /**
   * Optimize memory by unloading tabs
   * @param {Object} options - Optimization options
   * @param {number} options.threshold - Memory threshold percentage
   * @param {boolean} options.force - Force unload regardless of threshold
   * @returns {Promise<Object>} Optimization result
   */
  async optimizeMemory(options = {}) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.cleanupManager.optimizeMemory(options);
  },

  /**
   * Get statistics about current tabs
   * @returns {Promise<Object>} Statistics object
   */
  async getStatistics() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.tabManager.getStatistics();
  },

  /**
   * Get current preferences
   * @returns {Object} Current preference values
   */
  getPreferences() {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.getPreferences();
  },

  /**
   * Update preferences
   * @param {Object} prefs - Preference key-value pairs to update
   * @returns {Promise<void>}
   */
  async setPreferences(prefs) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.setPreferences(prefs);
  },

  /**
   * Subscribe to tab events
   * @param {string} eventType - Event type: 'created', 'removed', 'updated', 'synced'
   * @param {Function} callback - Callback function
   * @returns {Function} Unsubscribe function
   */
  on(eventType, callback) {
    if (typeof window.ZenTabsManager === "undefined") {
      throw new Error("ZenTabsManager not initialized");
    }
    return window.ZenTabsManager.events.on(eventType, callback);
  },

  /**
   * Export tab data to JSON
   * @param {Object} options - Export options
   * @returns {Promise<string>} JSON string
   */
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

// Export for Sine mod system
export default ZenTabsAPI;
