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
      maxAgeUnit: this.manager.preferences.cleanupAgeUnit || "days",
      excludeDomains: options.excludeDomains || this.parseExcludeDomains(),
      dryRun: options.dryRun || false
    };
    
    this.log("Cleaning up tabs older than", opts.maxAge, opts.maxAgeUnit);
    
    const result = {
      checked: 0,
      closed: 0,
      skipped: 0,
      protected: 0,
      excluded: 0,
      tabs: []
    };
    
    const allTabs = await this.manager.tabManager.getAllTabs();
    const unitMs = opts.maxAgeUnit === "hours" ? 3600 * 1000 : 24 * 3600 * 1000;
    const maxAgeMs = opts.maxAge * unitMs;
    
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
          this.manager.window.gBrowser.removeTab(tabData.tab);
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
   * Unload tabs that haven't been touched for longer than autoUnloadDelay seconds.
   * Works the same as memory optimisation (discard, not close) but is time-driven.
   * Respects keepEssentialTabs / keepPinnedTabs and never unloads the active tab.
   */
  async unloadStaleTabs() {
    if (!this.manager.preferences.autoUnloadEnabled) return;
    if (this.manager.preferences.paused) return;

    const delayMs = (this.manager.preferences.autoUnloadDelay || 3600) * 1000;
    const allTabs = await this.manager.tabManager.getAllTabs();
    let unloaded = 0;

    for (const tabData of allTabs) {
      const tab = tabData.tab;
      // Check live DOM state — cached metadata may be stale after a previous
      // discardBrowser() call that didn't trigger a cache refresh.
      if (tab.selected)                    continue;
      if (tab.hasAttribute("discarded"))   continue;
      if (tab.hasAttribute("busy"))        continue;
      if (tab.hasAttribute("pending"))     continue;
      if (tabData.type === "essential" && this.manager.preferences.keepEssentialTabs) continue;
      if (tabData.type === "pinned"    && this.manager.preferences.keepPinnedTabs)    continue;

      if (tabData.lastAccessedAge.milliseconds < delayMs) continue;

      try {
        if (this.manager.window.gBrowser.discardBrowser) {
          this.manager.window.gBrowser.discardBrowser(tabData.tab);
          unloaded++;
          this.log(`Unloaded tab (idle timeout): ${tabData.title} — idle ${tabData.lastAccessedAge.seconds}s, threshold ${this.manager.preferences.autoUnloadDelay}s`);
        }
      } catch (e) {
        console.error("[ZenTabs] Error auto-unloading tab:", e);
      }
    }

    if (unloaded > 0) {
      this.manager.dispatchEvent("tabs-auto-unloaded", { count: unloaded });
    }
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
    
    // Sort tabs by last accessed (oldest first — highest age first)
    const sortedTabs = allTabs.sort((a, b) => 
      b.lastAccessedAge.milliseconds - a.lastAccessedAge.milliseconds
    );
    
    for (const tabData of sortedTabs) {
      result.checked++;

      const tab = tabData.tab;
      const state = Array.isArray(tabData.state) ? tabData.state : [];

      // Skip active tab
      if (state.includes("active") || tab.selected) {
        continue;
      }

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

      // Skip tabs already unloaded/lazy-restored.
      // In Firefox/Zen, "pending" means tab content is not currently loaded.
      if (state.includes("discarded") || state.includes("pending") || tab.hasAttribute("discarded") || tab.hasAttribute("pending")) {
        result.alreadyUnloaded++;
        continue;
      }

      // Skip tabs loading
      if (state.includes("loading") || tab.hasAttribute("busy")) {
        continue;
      }

      // Verify tab is still live in DOM before attempting to discard.
      if (!tab.parentNode || tab.hasAttribute("closing") || tab.isConnected === false) {
        continue;
      }

      // Verify linkedBrowser is valid
      if (!tab.linkedBrowser) {
        continue;
      }

      // Discard/unload the tab
      try {
        if (this.manager.window.gBrowser.discardBrowser) {
          const discardResult = this.manager.window.gBrowser.discardBrowser(tab);
          if (discardResult && typeof discardResult.then === "function") {
            await discardResult;
          }

          const nowDiscarded = tab.hasAttribute("discarded") || tab.hasAttribute("pending");
          if (!nowDiscarded) {
            continue;
          }

          result.unloaded++;
          result.saved += 50; // Estimated savings
          this.unloadedTabs.add(tab);
          result.tabs.push({
            title: tabData.title,
            age: tabData.lastAccessedAge.days
          });
          this.log(`Unloaded tab (memory pressure): ${tabData.title} — RAM at ${memoryInfo.percentUsed}%, threshold ${opts.threshold}%`);
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
   * Get memory information using Gecko-native APIs.
   * - ChromeUtils.requestProcInfo() → actual RSS of all browser processes
   * - Services.sysinfo.getProperty("memsize") → total physical RAM
   * Falls back to a tab-count heuristic if native APIs are unavailable.
   */
  async getMemoryInfo() {
    try {
      // Total physical RAM (bytes)
      const totalRam = parseInt(Services.sysinfo.getProperty("memsize")) || (8 * 1024 * 1024 * 1024);

      // Actual browser memory usage: sum RSS across main + content processes
      const procInfo = await ChromeUtils.requestProcInfo();
      let usedBytes = procInfo.memory ?? 0;
      for (const child of procInfo.children ?? []) {
        usedBytes += child.memory ?? 0;
      }

      return {
        used: usedBytes,
        total: totalRam,
        limit: totalRam,
        percentUsed: Math.min(100, Math.round((usedBytes / totalRam) * 100))
      };
    } catch (error) {
      // Fallback: estimate based on tab count (50 MB per active tab, 8 GB ceiling)
      try {
        const tabs = await this.manager.tabManager.getAllTabs();
        const activeTabs = tabs.filter(t => !t.state.includes("discarded")).length;
        const estimatedUsed = activeTabs * 50 * 1024 * 1024;
        const estimatedLimit = 8 * 1024 * 1024 * 1024;
        return {
          used: estimatedUsed,
          total: estimatedLimit,
          limit: estimatedLimit,
          percentUsed: Math.min(100, Math.round((estimatedUsed / estimatedLimit) * 100))
        };
      } catch (e) {
        return { used: 0, total: 0, limit: 1, percentUsed: 0 };
      }
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
    const tabs = this.manager.window.gBrowser.tabs;
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
