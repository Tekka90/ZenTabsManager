/**
 * ZenTabs Manager - Main System File
 * 
 * Standalone tab management for Zen Browser
 * No Sine dependency required
 */

console.log("[ZenTabs] Loading...");
dump("[ZenTabs] zen.sys.mjs loading...\n");

class ZenTabsManager {
  constructor() {
    this.initialized = false;
    this.window = null;
    this.preferences = {};
    this.tabManager = null;
    this.cleanupManager = null;
    this.simpleBookmarkSyncManager = null;
    this.tabPublishManager = null;
    this.uiManager = null;
    this.events = new EventTarget();
    this.cleanupInterval = null;
    this.memoryInterval = null;
    this.autoUnloadInterval = null;
    this.publishInterval = null;
    
    console.log("[ZenTabs] Manager created");
  }

  log(...args) {
    console.log("[ZenTabs]", ...args);
  }

  async init(win) {
    this.window = win;

    try {
      console.log("[ZenTabs] Initializing for window...");
      
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
      this.window.ZenTabsManager = this;
      this.window.ZenTabsAPI = ZenTabsAPI;
      
    } catch (error) {
      console.error("❌ [ZenTabs] Initialization failed:", error);
      console.error(error.stack);
    }
  }

  async waitForBrowser() {
    const win = this.window;

    // 1. Wait for gBrowser.tabs to exist
    await new Promise((resolve) => {
      if (win.gBrowser?.tabs) {
        resolve();
        return;
      }
      const interval = win.setInterval(() => {
        if (win.gBrowser?.tabs) {
          win.clearInterval(interval);
          resolve();
        }
      }, 100);
      win.setTimeout(() => {
        win.clearInterval(interval);
        resolve();
      }, 10000);
    });

    // 2. Wait for session restore to finish so that tab URLs are populated.
    //    Without this, tabs still show about:blank during lazy restore and
    //    syncToBookmarks skips them all.
    await new Promise((resolve) => {
      // SessionStore sets __SSi on the window once restore is complete
      if (win.__SSi !== undefined) {
        resolve();
        return;
      }
      const onRestore = () => {
        win.removeEventListener("SSWindowStateReady", onRestore);
        resolve();
      };
      win.addEventListener("SSWindowStateReady", onRestore);
      // Safety timeout — don't block forever if the event already fired
      win.setTimeout(resolve, 15000);
    });

    console.log("[ZenTabs] Browser and session restore ready");
  }

  async initializeManagers() {
    console.log("[ZenTabs] Loading managers...");

    // Make ContextualIdentityService available for SimpleBookmarkSyncManager's container helpers.
    // Must happen here (chrome script scope) because dynamic-import ESM modules
    // cannot reliably call ChromeUtils.importESModule themselves.
    try {
      if (typeof ChromeUtils !== "undefined" && ChromeUtils.importESModule) {
        const { ContextualIdentityService } = ChromeUtils.importESModule(
          "resource://gre/modules/ContextualIdentityService.sys.mjs"
        );
        this.window.ContextualIdentityService = ContextualIdentityService;
      }
    } catch (e) {
      console.warn("[ZenTabs] Could not import ContextualIdentityService:", e.message);
    }

    const { TabManager } = await import("../content/TabManager.mjs");
    const { CleanupManager } = await import("../content/CleanupManager.mjs");
    const { SimpleBookmarkSyncManager } = await import("../content/SimpleBookmarkSyncManager.mjs");
    const { TabPublishManager } = await import("../content/TabPublishManager.mjs");
    
    this.tabManager = new TabManager(this);
    await this.tabManager.init();
    
    this.cleanupManager = new CleanupManager(this);
    await this.cleanupManager.init();

    this.simpleBookmarkSyncManager = new SimpleBookmarkSyncManager(this);
    await this.simpleBookmarkSyncManager.init();

    this.tabPublishManager = new TabPublishManager(this);
    await this.tabPublishManager.init();
    
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
    if (!this.window.gBrowser) return;
    
    const tabs = this.window.gBrowser.tabContainer;
    
    tabs.addEventListener("TabOpen", (e) => 
      this.dispatchEvent("tab-created", { tab: e.target }));
    tabs.addEventListener("TabClose", (e) => 
      this.dispatchEvent("tab-removed", { tab: e.target }));
    tabs.addEventListener("TabAttrModified", (e) => 
      this.dispatchEvent("tab-updated", { tab: e.target }));
  }

  startBackgroundTasks() {
    const {
      cleanupEnabled,
      memoryOptimization,
      autoUnloadEnabled,
      publishAutoEnabled,
      publishAutoIntervalMinutes,
    } = this.preferences;
    
    if (cleanupEnabled) {
      this.cleanupInterval = this.window.setInterval(() => 
        this.cleanupManager.runCleanup(), 3600 * 1000);
    }
    
    if (memoryOptimization) {
      this.memoryInterval = this.window.setInterval(() => 
        this.cleanupManager.checkMemoryUsage(), 300 * 1000);
    }

    if (autoUnloadEnabled) {
      // Check every minute; actual threshold is compared inside
      this.autoUnloadInterval = this.window.setInterval(() =>
        this.cleanupManager.unloadStaleTabs(), 60 * 1000);
    }

    if (publishAutoEnabled && this.tabPublishManager) {
      const intervalMinutes = Number(publishAutoIntervalMinutes) > 0
        ? Number(publishAutoIntervalMinutes)
        : 30;
      this.publishInterval = this.window.setInterval(async () => {
        try {
          const result = await this.tabPublishManager.publishTabsToSftp({ skipIfUnchanged: true });
          if (!result.success) {
            this.log("Auto-publish failed:", (result.errors || []).join("; ") || "Unknown error");
          }
        } catch (error) {
          this.log("Auto-publish error:", String(error));
        }
      }, intervalMinutes * 60 * 1000);
    }
  }

  async loadPreferences() {
    const defaults = {
      enabled: true,
      paused: false,
      cleanupEnabled: false,
      cleanupAge: 7,
      cleanupAgeUnit: "days",
      cleanupExcludeDomains: "",
      memoryOptimization: true,
      memoryThreshold: 80,
      autoUnloadEnabled: false,
      autoUnloadDelay: 3600,
      keepEssentialTabs: true,
      keepPinnedTabs: true,
      showToolbarButton: true,
      debugMode: false,
      publishSftpHost: "",
      publishSftpPort: 22,
      publishSftpUser: "",
      publishSftpRemoteDir: "",
      publishSftpPrivateKeyPath: "",
      publishSftpDashboardTitle: "ZenTabs Dashboard",
      publishAutoEnabled: true,
      publishAutoIntervalMinutes: 30,
    };

    try {
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
      const prefBranch = Services.prefs.getBranch("zentabs.");
      prefBranch.setStringPref("preferences", JSON.stringify(this.preferences));
    } catch (error) {
      console.error("[ZenTabs] Error saving preferences:", error);
    }

    if (this.initialized && !this.preferences.paused) {
      this.window?.clearInterval(this.cleanupInterval);
      this.window?.clearInterval(this.memoryInterval);
      this.window?.clearInterval(this.autoUnloadInterval);
      this.window?.clearInterval(this.publishInterval);
      this.cleanupInterval = null;
      this.memoryInterval = null;
      this.autoUnloadInterval = null;
      this.publishInterval = null;
      this.startBackgroundTasks();
    }
    
    this.dispatchEvent("preferences-changed", { preferences: this.preferences });
  }

  pause() {
    this.preferences.paused = true;
    this.window?.clearInterval(this.cleanupInterval);
    this.window?.clearInterval(this.memoryInterval);
    this.window?.clearInterval(this.autoUnloadInterval);
    this.window?.clearInterval(this.publishInterval);
    this.cleanupInterval = null;
    this.memoryInterval = null;
    this.autoUnloadInterval = null;
    this.publishInterval = null;
    this.dispatchEvent("paused", {});
    this.log("ZenTabs paused");
  }

  resume() {
    this.preferences.paused = false;
    this.startBackgroundTasks();
    this.dispatchEvent("resumed", {});
    this.log("ZenTabs resumed");
  }

  isPaused() {
    return this.preferences.paused === true;
  }

  dispatchEvent(eventType, data) {
    this.events.dispatchEvent(new CustomEvent(eventType, { detail: data }));
  }

  on(eventType, callback) {
    this.events.addEventListener(eventType, (e) => callback(e.detail));
    return () => this.events.removeEventListener(eventType, callback);
  }

  async shutdown() {
    this.window?.clearInterval(this.cleanupInterval);
    this.window?.clearInterval(this.memoryInterval);
    this.window?.clearInterval(this.autoUnloadInterval);
    this.window?.clearInterval(this.publishInterval);
    
    await this.uiManager?.shutdown();
    await this.cleanupManager?.shutdown();
    await this.tabPublishManager?.shutdown?.();
    await this.tabManager?.shutdown();
    
    this.initialized = false;
    console.log("[ZenTabs] Shut down");
  }
}

// Per-window manager registry — one ZenTabsManager instance per chrome window
const windowManagers = new WeakMap();

// Auto-init when browser window is ready
function initZenTabs(win) {
  if (win.location.href !== "chrome://browser/content/browser.xhtml") {
    return;
  }
  if (windowManagers.has(win)) {
    // Already initialised for this exact window object
    return;
  }

  console.log("[ZenTabs] Browser window ready, initializing manager...");
  const manager = new ZenTabsManager();
  windowManagers.set(win, manager);

  manager.init(win).catch(error => {
    console.error("[ZenTabs] Initialization failed:", error);
    windowManagers.delete(win);
  });

  // Clean up when the window closes
  win.addEventListener("unload", () => {
    manager.shutdown().catch(console.error);
    windowManagers.delete(win);
  }, { once: true });
}

// Hook into window loading
dump("[ZenTabs] Services loaded, registering window listener...\n");

const windowListener = {
  onOpenWindow(xulWindow) {
    const window = xulWindow.docShell.domWindow;
    window.addEventListener("load", () => initZenTabs(window), { once: true });
  }
};

Services.wm.addListener(windowListener);

// Check existing windows (e.g. when mod is installed while browser is running)
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
dump("[ZenTabs] Module loaded successfully\n");

export { windowManagers };
export { ZenTabsManager };
