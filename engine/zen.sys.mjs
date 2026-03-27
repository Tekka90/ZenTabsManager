/**
 * ZenTabs Manager - Main System File
 * 
 * Standalone tab management for Zen Browser
 * No Sine dependency required
 */

console.log("[ZenTabs] Loading...");

class ZenTabsManager {
  constructor() {
    this.initialized = false;
    this.preferences = {};
    this.tabManager = null;
    this.syncManager = null;
    this.cleanupManager = null;
    this.uiManager = null;
    this.events = new EventTarget();
    
    console.log("[ZenTabs] Manager created");
  }

  async init() {
    if (this.initialized) {
      console.log("[ZenTabs] Already initialized");
      return;
    }

    try {
      console.log("[ZenTabs] Initializing...");
      
      // Load preferences
      await this.loadPreferences();
      
      if (!this.preferences.enabled) {
        console.log("[ZenTabs] Disabled in preferences");
        return;
      }

      // Wait for browser
      await this.waitForBrowser();
      
      // Initialize managers
      await this.initializeManagers();
      
      // Setup UI
      await this.setupUI();
      
      // Setup events
      this.setupEventListeners();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.initialized = true;
      console.log("✅ [ZenTabs] Initialized successfully");
      
      // Load and expose API
      const { ZenTabsAPI } = await import("./zen.api.mjs");
      
      // Expose globally
      window.ZenTabsManager = this;
      window.ZenTabsAPI = ZenTabsAPI;
      
    } catch (error) {
      console.error("❌ [ZenTabs] Initialization failed:", error);
      console.error(error.stack);
    }
  }

  async waitForBrowser() {
    return new Promise((resolve) => {
      if (window.gBrowser?.tabs) {
        resolve();
        return;
      }
      
      const interval = setInterval(() => {
        if (window.gBrowser?.tabs) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
      
      setTimeout(() => {
        clearInterval(interval);
        resolve();
      }, 10000);
    });
  }

  async initializeManagers() {
    console.log("[ZenTabs] Loading managers...");
    
    const { TabManager } = await import("../content/TabManager.mjs");
    const { SyncManager } = await import("../content/SyncManager.mjs");
    const { CleanupManager } = await import("../content/CleanupManager.mjs");
    
    this.tabManager = new TabManager(this);
    await this.tabManager.init();
    
    this.syncManager = new SyncManager(this);
    await this.syncManager.init();
    
    this.cleanupManager = new CleanupManager(this);
    await this.cleanupManager.init();
    
    console.log("[ZenTabs] Managers loaded");
  }

  async setupUI() {
    if (!this.preferences.showToolbarButton) return;
    
    console.log("[ZenTabs] Setting up UI...");
    
    const { UIManager } = await import("../content/UI.mjs");
    this.uiManager = new UIManager(this);
    await this.uiManager.init();
  }

  setupEventListeners() {
    if (!window.gBrowser) return;
    
    const tabs = window.gBrowser.tabContainer;
    
    tabs.addEventListener("TabOpen", (e) => 
      this.dispatchEvent("tab-created", { tab: e.target }));
    tabs.addEventListener("TabClose", (e) => 
      this.dispatchEvent("tab-removed", { tab: e.target }));
    tabs.addEventListener("TabAttrModified", (e) => 
      this.dispatchEvent("tab-updated", { tab: e.target }));
  }

  startBackgroundTasks() {
    const { syncEnabled, syncInterval, cleanupEnabled, memoryOptimization } = this.preferences;
    
    if (syncEnabled && syncInterval > 0) {
      this.syncInterval = setInterval(() => 
        this.syncManager.performSync(), syncInterval * 1000);
    }
    
    if (cleanupEnabled) {
      this.cleanupInterval = setInterval(() => 
        this.cleanupManager.runCleanup(), 3600 * 1000);
    }
    
    if (memoryOptimization) {
      this.memoryInterval = setInterval(() => 
        this.cleanupManager.checkMemoryUsage(), 300 * 1000);
    }
  }

  async loadPreferences() {
    const defaults = {
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

    try {
      const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
      const prefBranch = Services.prefs.getBranch("zentabs.");
      
      // Try to load from prefs
      if (prefBranch.prefHasUserValue("preferences")) {
        const stored = prefBranch.getStringPref("preferences", "{}");
        this.preferences = { ...defaults, ...JSON.parse(stored) };
      } else {
        this.preferences = defaults;
      }
    } catch (error) {
      console.error("[ZenTabs] Error loading preferences:", error);
      this.preferences = defaults;
    }
  }

  getPreferences() {
    return { ...this.preferences };
  }

  async setPreferences(newPrefs) {
    this.preferences = { ...this.preferences, ...newPrefs };
    
    try {
      const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
      const prefBranch = Services.prefs.getBranch("zentabs.");
      prefBranch.setStringPref("preferences", JSON.stringify(this.preferences));
    } catch (error) {
      console.error("[ZenTabs] Error saving preferences:", error);
    }
    
    this.dispatchEvent("preferences-changed", { preferences: this.preferences });
  }

  dispatchEvent(eventType, data) {
    this.events.dispatchEvent(new CustomEvent(eventType, { detail: data }));
  }

  on(eventType, callback) {
    this.events.addEventListener(eventType, (e) => callback(e.detail));
    return () => this.events.removeEventListener(eventType, callback);
  }

  async shutdown() {
    clearInterval(this.syncInterval);
    clearInterval(this.cleanupInterval);
    clearInterval(this.memoryInterval);
    
    await this.uiManager?.shutdown();
    await this.cleanupManager?.shutdown();
    await this.syncManager?.shutdown();
    await this.tabManager?.shutdown();
    
    this.initialized = false;
    console.log("[ZenTabs] Shut down");
  }
}

// Create and export manager
const manager = new ZenTabsManager();

// Auto-init when browser window is ready
function initZenTabs(window) {
  if (window.location.href !== "chrome://browser/content/browser.xhtml") {
    return;
  }
  
  console.log("[ZenTabs] Browser window ready, initializing manager...");
  manager.init().catch(error => {
    console.error("[ZenTabs] Initialization failed:", error);
  });
}

// Hook into window loading
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

const windowListener = {
  onOpenWindow(xulWindow) {
    const window = xulWindow.docShell.domWindow;
    window.addEventListener("load", () => initZenTabs(window), { once: true });
  }
};

Services.wm.addListener(windowListener);

// Check existing windows
const windows = Services.wm.getEnumerator("navigator:browser");
while (windows.hasMoreElements()) {
  const win = windows.getNext();
  if (win.document.readyState === "complete") {
    initZenTabs(win);
  } else {
    win.addEventListener("load", () => initZenTabs(win), { once: true });
  }
}

console.log("[ZenTabs] Module loaded successfully");

export default manager;
export { ZenTabsManager };
