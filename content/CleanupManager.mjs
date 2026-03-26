/**
 * CleanupManager - Tab cleanup and memory optimization
 * 
 * Handles automatic cleanup of old tabs and memory optimization
 * by unloading tabs when memory is low.
 */

export class CleanupManager {
  constructor(manager) {
    this.manager = manager;
    this.lastCleanupTime = 0;
    this.lastMemoryCheck = 0;
    this.unloadedTabs = new Set();
    this.log("CleanupManager created");
  }

  async init() {
    this.log("CleanupManager initializing...");
    
    // Subscribe to tab events
    this.manager.on("tab-created", () => this.onTabsChanged());
    this.manager.on("tab-removed", () => this.onTabsChanged());
    
    // Perform initial memory check
    if (this.manager.preferences.memoryOptimization) {
      await this.checkMemoryUsage();
    }
    
    this.log("CleanupManager initialized");
  }

  /**
   * Run scheduled cleanup
   */
  async runCleanup() {
    if (!this.manager.preferences.cleanupEnabled) {
      return;
    }
    
    this.log("Running scheduled cleanup...");
    
    const result = await this.cleanupOldTabs({
      maxAge: this.manager.preferences.cleanupAge,
      excludeDomains: this.parseExcludeDomains(),
      dryRun: false
    });
    
    this.lastCleanupTime = Date.now();
    this.manager.dispatchEvent("cleanup-completed", result);
    
    return result;
  }

  /**
   * Clean up old tabs
   */
  async cleanupOldTabs(options = {}) {
    const opts = {
      maxAge: this.manager.preferences.cleanupAge || 7,
      excludeDomains: options.excludeDomains || this.parseExcludeDomains(),
      dryRun: options.dryRun || false
    };
    
    this.log("Cleaning up tabs older than", opts.maxAge, "days");
    
    const result = {
      checked: 0,
      closed: 0,
      skipped: 0,
      protected: 0,
      excluded: 0,
      tabs: []
    };
    
    const allTabs = await this.manager.tabManager.getAllTabs();
    const maxAgeMs = opts.maxAge * 24 * 60 * 60 * 1000;
    
    for (const tabData of allTabs) {
      result.checked++;
      
      // Skip Essential tabs if protected
      if (tabData.type === "essential" && this.manager.preferences.keepEssentialTabs) {
        result.protected++;
        continue;
      }
      
      // Skip Pinned tabs if protected
      if (tabData.type === "pinned" && this.manager.preferences.keepPinnedTabs) {
        result.protected++;
        continue;
      }
      
      // Only close normal tabs
      if (tabData.type !== "normal") {
        result.skipped++;
        continue;
      }
      
      // Check exclude domains
      if (this.isDomainExcluded(tabData.url, opts.excludeDomains)) {
        result.excluded++;
        continue;
      }
      
      // Check age
      const age = tabData.lastAccessedAge.milliseconds;
      if (age < maxAgeMs) {
        result.skipped++;
        continue;
      }
      
      // Close the tab
      if (!opts.dryRun) {
        try {
          window.gBrowser.removeTab(tabData.tab);
          result.closed++;
          result.tabs.push({
            title: tabData.title,
            url: tabData.url,
            age: tabData.lastAccessedAge.days
          });
          this.log(`Closed old tab: ${tabData.title} (${tabData.lastAccessedAge.days} days old)`);
        } catch (error) {
          console.error("Error closing tab:", error);
        }
      } else {
        result.closed++;
        result.tabs.push({
          title: tabData.title,
          url: tabData.url,
          age: tabData.lastAccessedAge.days
        });
      }
    }
    
    this.log(`Cleanup complete: closed ${result.closed}, protected ${result.protected}, excluded ${result.excluded}`);
    
    return result;
  }

  /**
   * Check memory usage and unload tabs if needed
   */
  async checkMemoryUsage() {
    if (!this.manager.preferences.memoryOptimization) {
      return;
    }
    
    const memoryInfo = await this.getMemoryInfo();
    const threshold = this.manager.preferences.memoryThreshold || 80;
    
    if (memoryInfo.percentUsed >= threshold) {
      this.log(`Memory usage at ${memoryInfo.percentUsed}%, threshold ${threshold}% - optimizing...`);
      return await this.optimizeMemory({ force: true });
    }
    
    this.lastMemoryCheck = Date.now();
  }

  /**
   * Optimize memory by unloading tabs
   */
  async optimizeMemory(options = {}) {
    const opts = {
      threshold: this.manager.preferences.memoryThreshold || 80,
      force: options.force || false
    };
    
    // Get memory info
    const memoryInfo = await this.getMemoryInfo();
    
    if (!opts.force && memoryInfo.percentUsed < opts.threshold) {
      this.log(`Memory usage OK (${memoryInfo.percentUsed}%), skipping optimization`);
      return { optimized: 0, saved: 0 };
    }
    
    this.log("Optimizing memory by unloading tabs...");
    
    const result = {
      checked: 0,
      unloaded: 0,
      alreadyUnloaded: 0,
      protected: 0,
      saved: 0, // Estimated MB saved
      tabs: []
    };
    
    const allTabs = await this.manager.tabManager.getAllTabs();
    
    // Sort tabs by last accessed (oldest first)
    const sortedTabs = allTabs.sort((a, b) => 
      a.lastAccessedAge.milliseconds - b.lastAccessedAge.milliseconds
    );
    
    for (const tabData of sortedTabs) {
      result.checked++;
      
      // Skip active tab
      if (tabData.state.includes("active")) {
        continue;
      }
      
      // Skip Essential tabs if protected
      if (tabData.type === "essential" && this.manager.preferences.keepEssentialTabs) {
        result.protected++;
        continue;
      }
      
      // Skip already discarded tabs
      if (tabData.state.includes("discarded")) {
        result.alreadyUnloaded++;
        continue;
      }
      
      // Skip tabs loading
      if (tabData.state.includes("loading")) {
        continue;
      }
      
      // Discard/unload the tab
      try {
        const tab = tabData.tab;
        if (tab.linkedBrowser && !tab.linkedBrowser.isRemoteBrowser) {
          // Mark for unload
          tab.setAttribute("pending", "true");
        }
        
        // Use Firefox's built-in tab discard
        if (window.gBrowser.discardBrowser) {
          window.gBrowser.discardBrowser(tab);
          result.unloaded++;
          result.saved += 50; // Estimate 50MB saved per tab
          this.unloadedTabs.add(tab);
          result.tabs.push({
            title: tabData.title,
            age: tabData.lastAccessedAge.days
          });
          this.log(`Unloaded tab: ${tabData.title}`);
        }
      } catch (error) {
        console.error("Error unloading tab:", error);
      }
      
      // Stop if we've freed enough memory
      if (result.unloaded >= 20) {
        this.log("Unloaded 20 tabs, stopping optimization");
        break;
      }
    }
    
    this.log(`Memory optimization complete: unloaded ${result.unloaded} tabs, ~${result.saved}MB saved`);
    this.manager.dispatchEvent("memory-optimized", result);
    
    return result;
  }

  /**
   * Get memory information
   */
  async getMemoryInfo() {
    try {
      // Try to get memory info from Firefox
      if (window.performance && window.performance.memory) {
        const mem = window.performance.memory;
        return {
          used: mem.usedJSHeapSize,
          total: mem.totalJSHeapSize,
          limit: mem.jsHeapSizeLimit,
          percentUsed: Math.round((mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100)
        };
      }
      
      // Fallback: estimate based on tab count
      const tabs = await this.manager.tabManager.getAllTabs();
      const activeTabs = tabs.filter(t => !t.state.includes("discarded")).length;
      const estimatedUsed = activeTabs * 50; // 50MB per tab
      const estimatedLimit = 4000; // 4GB estimate
      
      return {
        used: estimatedUsed * 1024 * 1024,
        total: estimatedUsed * 1024 * 1024,
        limit: estimatedLimit * 1024 * 1024,
        percentUsed: Math.round((estimatedUsed / estimatedLimit) * 100)
      };
    } catch (error) {
      console.error("Error getting memory info:", error);
      return {
        used: 0,
        total: 0,
        limit: 1,
        percentUsed: 0
      };
    }
  }

  /**
   * Parse excluded domains from preferences
   */
  parseExcludeDomains() {
    const domains = this.manager.preferences.cleanupExcludeDomains || "";
    return domains.split(",").map(d => d.trim()).filter(d => d.length > 0);
  }

  /**
   * Check if domain should be excluded from cleanup
   */
  isDomainExcluded(url, excludeDomains) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      
      for (const domain of excludeDomains) {
        if (hostname.includes(domain)) {
          return true;
        }
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Event handlers
   */
  onTabsChanged() {
    // Could trigger memory check if tab count is high
    const tabs = window.gBrowser.tabs;
    if (tabs.length > 100 && this.manager.preferences.memoryOptimization) {
      // Check memory, but not too frequently (max once per 5 minutes)
      const now = Date.now();
      if (now - this.lastMemoryCheck > 300000) {
        this.checkMemoryUsage();
      }
    }
  }

  /**
   * Log helper
   */
  log(...args) {
    this.manager.log("[CleanupManager]", ...args);
  }

  /**
   * Shutdown
   */
  async shutdown() {
    this.unloadedTabs.clear();
    this.log("CleanupManager shut down");
  }
}
