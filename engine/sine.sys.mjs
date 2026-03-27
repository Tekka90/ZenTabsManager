/**
 * ZenTabs Manager - System Integration
 * 
 * Main entry point for the Sine mod. This file initializes all managers
 * and integrates with Zen Browser's UI and systems.
 */

// Debug: Log that this file is being loaded
console.log("[ZenTabs] sine.sys.mjs is loading...");

// Export mods array FIRST to ensure it exists even if initialization fails
export const mods = [];

console.log("[ZenTabs] About to import ZenTabsAPI...");
import { ZenTabsAPI } from "./sine.api.mjs";
console.log("[ZenTabs] ZenTabsAPI imported successfully");

class ZenTabsManager {
  constructor() {
    this.initialized = false;
    this.preferences = {};
    this.tabManager = null;
    this.syncManager = null;
    this.cleanupManager = null;
    this.uiManager = null;
    this.events = new EventTarget();
    
    this.log("ZenTabsManager constructor called");
  }

  /**
   * Initialize the mod with Sine system
   */
  async init() {
    if (this.initialized) {
      this.log("Already initialized, skipping");
      return;
    }

    try {
      this.log("Initializing ZenTabsManager...");
      
      // Load preferences from Sine
      await this.loadPreferences();
      
      // Check if enabled
      if (!this.preferences.enabled) {
        this.log("ZenTabs Manager is disabled in preferences");
        return;
      }

      // Wait for browser to be ready
      await this.waitForBrowser();
      
      // Initialize managers in order
      await this.initializeManagers();
      
      // Setup UI components
      await this.setupUI();
      
      // Setup event listeners
      this.setupEventListeners();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.initialized = true;
      this.log("✅ ZenTabsManager initialized successfully");
      
      // Expose API globally
      window.ZenTabsManager = this;
      window.ZenTabsAPI = ZenTabsAPI;
      
      // Dispatch init event
      this.dispatchEvent("initialized", {});
      
    } catch (error) {
      console.error("❌ Failed to initialize ZenTabsManager:", error);
      console.error(error.stack);
    }
  }

  /**
   * Wait for browser components to be ready
   */
  async waitForBrowser() {
    return new Promise((resolve) => {
      if (window.gBrowser && window.gBrowser.tabs) {
        resolve();
        return;
      }
      
      const interval = setInterval(() => {
        if (window.gBrowser && window.gBrowser.tabs) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 10000);
    });
  }

  /**
   * Initialize all manager modules
   */
  async initializeManagers() {
    this.log("Initializing managers...");
    
    // Dynamically import managers
    const { TabManager } = await import("../content/TabManager.mjs");
    const { SyncManager } = await import("../content/SyncManager.mjs");
    const { CleanupManager } = await import("../content/CleanupManager.mjs");
    
    this.tabManager = new TabManager(this);
    await this.tabManager.init();
    
    this.syncManager = new SyncManager(this);
    await this.syncManager.init();
    
    this.cleanupManager = new CleanupManager(this);
    await this.cleanupManager.init();
    
    this.log("All managers initialized");
  }

  /**
   * Setup UI components
   */
  async setupUI() {
    if (!this.preferences.showToolbarButton) {
      return;
    }
    
    this.log("Setting up UI...");
    
    const { UIManager } = await import("../content/UI.mjs");
    this.uiManager = new UIManager(this);
    await this.uiManager.init();
    
    this.log("UI setup complete");
  }

  /**
   * Setup event listeners for browser events
   */
  setupEventListeners() {
    this.log("Setting up event listeners...");
    
    // Tab events
    if (window.gBrowser) {
      const tabContainer = window.gBrowser.tabContainer;
      
      tabContainer.addEventListener("TabOpen", (e) => {
        this.dispatchEvent("tab-created", { tab: e.target });
      });
      
      tabContainer.addEventListener("TabClose", (e) => {
        this.dispatchEvent("tab-removed", { tab: e.target });
      });
      
      tabContainer.addEventListener("TabAttrModified", (e) => {
        this.dispatchEvent("tab-updated", { tab: e.target });
      });
      
      tabContainer.addEventListener("TabPinned", (e) => {
        this.dispatchEvent("tab-pinned", { tab: e.target });
      });
      
      tabContainer.addEventListener("TabUnpinned", (e) => {
        this.dispatchEvent("tab-unpinned", { tab: e.target });
      });
    }
    
    // Bookmark events (if available)
    if (window.PlacesUtils) {
      // We'll handle this in SyncManager
    }
    
    this.log("Event listeners setup complete");
  }

  /**
   * Start background tasks (sync, cleanup, etc.)
   */
  startBackgroundTasks() {
    this.log("Starting background tasks...");
    
    // Auto-sync task
    if (this.preferences.syncEnabled && this.preferences.syncInterval > 0) {
      this.syncInterval = setInterval(() => {
        this.log("Running scheduled sync...");
        this.syncManager.performSync();
      }, this.preferences.syncInterval * 1000);
    }
    
    // Cleanup task (runs every hour)
    if (this.preferences.cleanupEnabled) {
      this.cleanupInterval = setInterval(() => {
        this.log("Running scheduled cleanup...");
        this.cleanupManager.runCleanup();
      }, 3600 * 1000);
    }
    
    // Memory optimization check (runs every 5 minutes)
    if (this.preferences.memoryOptimization) {
      this.memoryInterval = setInterval(() => {
        this.cleanupManager.checkMemoryUsage();
      }, 300 * 1000);
    }
    
    this.log("Background tasks started");
  }

  /**
   * Load preferences from Sine system or localStorage
   */
  async loadPreferences() {
    try {
      // Try to load from Sine preferences system
      if (typeof window.SinePreferences !== "undefined") {
        this.preferences = window.SinePreferences.get("zentabs-manager") || {};
      } else {
        // Fallback to localStorage
        const stored = localStorage.getItem("zentabs-manager-prefs");
        if (stored) {
          this.preferences = JSON.parse(stored);
        }
      }
      
      // Apply defaults from engine.json
      this.preferences = {
        enabled: true,
        syncEnabled: true,
        syncDirection: "bidirectional",
        syncInterval: 300,
        cleanupEnabled: false,
        cleanupAge: 7,
        cleanupExcludeDomains: "",
        memoryOptimization: true,
        memoryThreshold: 80,
        keepEssentialTabs: true,
        keepPinnedTabs: true,
        showToolbarButton: true,
        debugMode: false,
        ...this.preferences
      };
      
      this.log("Preferences loaded:", this.preferences);
    } catch (error) {
      console.error("Error loading preferences:", error);
      // Use defaults
      this.preferences = {
        enabled: true,
        syncEnabled: true,
        syncDirection: "bidirectional",
        syncInterval: 300,
        cleanupEnabled: false,
        cleanupAge: 7,
        cleanupExcludeDomains: "",
        memoryOptimization: true,
        memoryThreshold: 80,
        keepEssentialTabs: true,
        keepPinnedTabs: true,
        showToolbarButton: true,
        debugMode: false
      };
    }
  }

  /**
   * Get current preferences
   */
  getPreferences() {
    return { ...this.preferences };
  }

  /**
   * Update preferences
   */
  async setPreferences(newPrefs) {
    this.preferences = { ...this.preferences, ...newPrefs };
    
    // Save to Sine system or localStorage
    try {
      if (typeof window.SinePreferences !== "undefined") {
        window.SinePreferences.set("zentabs-manager", this.preferences);
      } else {
        localStorage.setItem("zentabs-manager-prefs", JSON.stringify(this.preferences));
      }
    } catch (error) {
      console.error("Error saving preferences:", error);
    }
    
    // Notify listeners
    this.dispatchEvent("preferences-changed", { preferences: this.preferences });
    
    this.log("Preferences updated:", newPrefs);
  }

  /**
   * Dispatch event
   */
  dispatchEvent(eventType, data) {
    const event = new CustomEvent(eventType, { detail: data });
    this.events.dispatchEvent(event);
  }

  /**
   * Subscribe to events
   */
  on(eventType, callback) {
    this.events.addEventListener(eventType, (e) => callback(e.detail));
    return () => this.events.removeEventListener(eventType, callback);
  }

  /**
   * Log debug messages
   */
  log(...args) {
    if (this.preferences.debugMode) {
      console.log("[ZenTabs]", ...args);
    }
  }

  /**
   * Shutdown the mod
   */
  async shutdown() {
    this.log("Shutting down ZenTabsManager...");
    
    // Clear intervals
    if (this.syncInterval) clearInterval(this.syncInterval);
    if (this.cleanupInterval) clearInterval(this.cleanupInterval);
    if (this.memoryInterval) clearInterval(this.memoryInterval);
    
    // Shutdown managers
    if (this.uiManager) await this.uiManager.shutdown();
    if (this.cleanupManager) await this.cleanupManager.shutdown();
    if (this.syncManager) await this.syncManager.shutdown();
    if (this.tabManager) await this.tabManager.shutdown();
    
    this.initialized = false;
    this.log("ZenTabsManager shut down");
  }
}

// Create singleton instance
console.log("[ZenTabs] Creating ZenTabsManager instance...");
let manager;
try {
  manager = new ZenTabsManager();
  console.log("[ZenTabs] Manager instance created successfully");
} catch (error) {
  console.error("[ZenTabs] Failed to create manager instance:", error);
  throw error;
}

// Populate the mods array (exported at top of file)
console.log("[ZenTabs] Populating mods array...");
mods.push({
  id: "zentabs-manager",
  name: "ZenTabs Manager",
  version: "1.0.0",
  init: () => {
    console.log("[ZenTabs] Sine called init()");
    return manager.init();
  },
  shutdown: () => manager.shutdown(),
  instance: manager
});
console.log("[ZenTabs] Mods array populated, length:", mods.length);

// Auto-initialize if Sine doesn't call init (fallback)
setTimeout(() => {
  console.log("[ZenTabs] Fallback timer triggered, initialized:", manager.initialized);
  if (!manager.initialized) {
    console.log("[ZenTabs] Auto-initializing (Sine didn't call init)");
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => manager.init());
    } else {
      manager.init();
    }
  }
}, 2000);

// Also export for direct access
export default manager;
export { ZenTabsManager };

console.log("[ZenTabs] sine.sys.mjs fully loaded and exported");
