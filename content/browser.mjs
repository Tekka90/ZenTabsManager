/**
 * Browser Integration Layer
 * 
 * This module ensures the mod loads correctly in Zen Browser
 * and provides integration with browser-specific features.
 */

// Wait for browser to be fully loaded
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

async function init() {
  console.log("ZenTabs Manager: Browser integration initializing...");
  
  // Wait for the main manager to initialize
  let attempts = 0;
  const maxAttempts = 50; // 5 seconds
  
  while (!window.ZenTabsManager && attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, 100));
    attempts++;
  }
  
  if (window.ZenTabsManager) {
    console.log("✅ ZenTabs Manager is ready!");
    
    // Subscribe to events and provide UI feedback
    window.ZenTabsManager.on("initialized", () => {
      console.log("🎉 ZenTabs Manager initialized successfully");
    });
    
    window.ZenTabsManager.on("sync-completed", (result) => {
      console.log("📥 Sync completed:", result);
    });
    
    window.ZenTabsManager.on("cleanup-completed", (result) => {
      console.log("🧹 Cleanup completed:", result);
    });
    
    window.ZenTabsManager.on("memory-optimized", (result) => {
      console.log("💾 Memory optimized:", result);
    });
    
    console.log("ZenTabs API available globally:");
    console.log("  - window.ZenTabsAPI");
    console.log("  - window.ZenTabsManager");
    console.log("\nQuick commands:");
    console.log("  - ZenTabsAPI.listAllTabs()");
    console.log("  - ZenTabsAPI.syncToBookmarks()");
    console.log("  - ZenTabsAPI.syncBidirectional()");
    console.log("  - ZenTabsAPI.cleanupOldTabs()");
    console.log("  - ZenTabsAPI.optimizeMemory()");
    console.log("  - ZenTabsAPI.getStatistics()");
    console.log("\nKeyboard shortcuts:");
    console.log("  - Cmd/Ctrl+Shift+L: List all tabs");
    console.log("  - Cmd/Ctrl+Shift+B: Sync to bookmarks");
    console.log("  - Cmd/Ctrl+Shift+M: Optimize memory");
    console.log("  - Cmd/Ctrl+Shift+K: Cleanup old tabs");
  } else {
    console.error("❌ ZenTabs Manager failed to initialize after 5 seconds");
  }
}

// Export to ensure module is loaded
export default { init };
