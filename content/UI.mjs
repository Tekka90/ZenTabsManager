/**
 * UIManager - User interface components
 * 
 * Handles toolbar buttons, settings panel, and other UI elements.
 */

export class UIManager {
  constructor(manager) {
    this.manager = manager;
    this.toolbarButton = null;
    this.menuPopup = null;
    this.log("UIManager created");
  }

  async init() {
    this.log("UIManager initializing...");
    
    if (this.manager.preferences.showToolbarButton) {
      this.createToolbarButton();
    }
    
    // Add keyboard shortcuts
    this.setupKeyboardShortcuts();
    
    // Add to settings/preferences if possible
    this.setupPreferencesPanel();
    
    this.log("UIManager initialized");
  }

  /**
   * Create toolbar button
   */
  createToolbarButton() {
    try {
      const navbar = document.getElementById("nav-bar");
      if (!navbar) {
        this.log("Navigation bar not found");
        return;
      }

      // Create toolbar button
      const button = document.createXULElement("toolbarbutton");
      button.id = "zentabs-toolbar-button";
      button.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional");
      button.setAttribute("label", "ZenTabs");
      button.setAttribute("tooltiptext", "ZenTabs Manager - Click for options");
      button.setAttribute("type", "menu");
      
      // Add icon (SVG data URI)
      button.style.listStyleImage = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23666\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"4\" rx=\"1\"/><rect x=\"3\" y=\"10\" width=\"18\" height=\"4\" rx=\"1\"/><rect x=\"3\" y=\"17\" width=\"18\" height=\"4\" rx=\"1\"/><circle cx=\"18\" cy=\"5\" r=\"2\" fill=\"%23ff6b6b\"/></svg>')";
      
      // Create menu popup
      const popup = document.createXULElement("menupopup");
      popup.id = "zentabs-menu-popup";
      
      // Add menu items
      this.addMenuItem(popup, "List All Tabs", () => this.listAllTabs(), "Cmd+Shift+L");
      this.addMenuItem(popup, "Sync to Bookmarks", () => this.syncToBookmarks(), "Cmd+Shift+B");
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Sync from Bookmarks", () => this.syncFromBookmarks());
      this.addMenuItem(popup, "Bidirectional Sync", () => this.syncBidirectional());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Cleanup Old Tabs", () => this.cleanupOldTabs());
      this.addMenuItem(popup, "Optimize Memory", () => this.optimizeMemory());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Show Statistics", () => this.showStatistics());
      this.addMenuItem(popup, "Export to JSON", () => this.exportToJSON());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Settings...", () => this.openSettings());
      
      button.appendChild(popup);
      navbar.appendChild(button);
      
      this.toolbarButton = button;
      this.menuPopup = popup;
      
      this.log("Toolbar button created");
    } catch (error) {
      console.error("Error creating toolbar button:", error);
    }
  }

  /**
   * Add menu item
   */
  addMenuItem(popup, label, onClick, shortcut = null) {
    const item = document.createXULElement("menuitem");
    item.setAttribute("label", label);
    if (shortcut) {
      item.setAttribute("acceltext", shortcut);
    }
    item.addEventListener("command", onClick);
    popup.appendChild(item);
    return item;
  }

  /**
   * Add menu separator
   */
  addMenuSeparator(popup) {
    const sep = document.createXULElement("menuseparator");
    popup.appendChild(sep);
    return sep;
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    this.keyHandler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        if (event.key === 'L') {
          event.preventDefault();
          this.listAllTabs();
        } else if (event.key === 'B') {
          event.preventDefault();
          this.syncToBookmarks();
        } else if (event.key === 'M') {
          event.preventDefault();
          this.optimizeMemory();
        } else if (event.key === 'K') {
          event.preventDefault();
          this.cleanupOldTabs();
        }
      }
    };
    
    window.addEventListener("keydown", this.keyHandler, true);
    this.log("Keyboard shortcuts registered");
  }

  /**
   * Setup preferences panel in Zen settings
   */
  setupPreferencesPanel() {
    // This would integrate with Zen's settings system
    // For now, we'll use a simple dialog
    this.log("Preferences panel setup (dialog-based)");
  }

  /**
   * UI Actions
   */
  async listAllTabs() {
    console.log("\n" + "=".repeat(80));
    console.log("📑 ZENTABS MANAGER - ALL TABS");
    console.log("=".repeat(80) + "\n");
    
    const tabs = await this.manager.tabManager.getAllTabs();
    const stats = await this.manager.tabManager.getStatistics();
    
    console.log(`📊 Total: ${stats.total} tabs`);
    console.log(`   Essential: ${stats.byType.essential}`);
    console.log(`   Pinned: ${stats.byType.pinned}`);
    console.log(`   Normal: ${stats.byType.normal}`);
    console.log(`   In folders: ${stats.inFolders}`);
    console.log(`   Workspaces: ${stats.workspaces}\n`);
    
    tabs.forEach((tab, index) => {
      const emoji = tab.type === "essential" ? "⭐" : tab.type === "pinned" ? "📌" : "📄";
      console.log(`[${index + 1}] ${emoji} ${tab.title}`);
      console.log(`    Type: ${tab.type} | State: ${tab.state.join(", ")}`);
      if (tab.folderPath) {
        console.log(`    Folder: 📁 ${tab.folderPath.join(" / ")}`);
      }
      console.log(`    URL: ${tab.url}`);
      console.log(`    Age: ${tab.lastAccessedAge.days}d ${tab.lastAccessedAge.hours % 24}h\n`);
    });
    
    console.log("=".repeat(80) + "\n");
  }

  async syncToBookmarks() {
    console.log("🔖 Syncing tabs to bookmarks...");
    const result = await this.manager.syncManager.syncToBookmarks();
    console.log("✅ Sync complete:", result);
    this.showNotification("Sync Complete", `Created ${result.bookmarksCreated}, updated ${result.bookmarksUpdated} bookmarks`);
  }

  async syncFromBookmarks() {
    console.log("📥 Syncing bookmarks to tabs...");
    const result = await this.manager.syncManager.syncFromBookmarks();
    console.log("✅ Sync complete:", result);
    this.showNotification("Sync Complete", `Created ${result.tabsCreated} tabs, ${result.tabsExisting} already open`);
  }

  async syncBidirectional() {
    console.log("🔄 Performing bidirectional sync...");
    const result = await this.manager.syncManager.syncBidirectional();
    console.log("✅ Bidirectional sync complete:", result);
    this.showNotification("Bidirectional Sync", `Bookmarks: +${result.total.bookmarksCreated}, Tabs: +${result.total.tabsCreated}`);
  }

  async cleanupOldTabs() {
    const confirmed = confirm(`Clean up tabs older than ${this.manager.preferences.cleanupAge} days?`);
    if (!confirmed) return;
    
    console.log("🧹 Cleaning up old tabs...");
    const result = await this.manager.cleanupManager.cleanupOldTabs();
    console.log("✅ Cleanup complete:", result);
    this.showNotification("Cleanup Complete", `Closed ${result.closed} old tabs`);
  }

  async optimizeMemory() {
    console.log("💾 Optimizing memory...");
    const result = await this.manager.cleanupManager.optimizeMemory({ force: true });
    console.log("✅ Memory optimization complete:", result);
    this.showNotification("Memory Optimized", `Unloaded ${result.unloaded} tabs, saved ~${result.saved}MB`);
  }

  async showStatistics() {
    console.log("\n" + "=".repeat(80));
    console.log("📊 ZENTABS STATISTICS");
    console.log("=".repeat(80) + "\n");
    
    const stats = await this.manager.tabManager.getStatistics();
    const memoryInfo = await this.manager.cleanupManager.getMemoryInfo();
    
    console.log("📑 Tabs:");
    console.log(`   Total: ${stats.total}`);
    console.log(`   Essential: ${stats.byType.essential}`);
    console.log(`   Pinned: ${stats.byType.pinned}`);
    console.log(`   Normal: ${stats.byType.normal}`);
    console.log(`   In folders: ${stats.inFolders}`);
    console.log(`   Folders: ${stats.folders}`);
    console.log(`   Workspaces: ${stats.workspaces}\n`);
    
    console.log("💾 Memory:");
    console.log(`   Usage: ${memoryInfo.percentUsed}%`);
    console.log(`   Estimated savings from unloaded tabs: ~${stats.memorySavings}MB\n`);
    
    console.log("📈 States:");
    for (const [state, count] of Object.entries(stats.byState)) {
      console.log(`   ${state}: ${count}`);
    }
    
    console.log("\n" + "=".repeat(80) + "\n");
  }

  async exportToJSON() {
    try {
      const json = await window.ZenTabsAPI.exportToJSON();
      
      // Create and download file
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zentabs-export-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      
      console.log("✅ Exported to JSON");
      this.showNotification("Export Complete", "Tab data exported to JSON file");
    } catch (error) {
      console.error("Export error:", error);
      this.showNotification("Export Failed", error.message);
    }
  }

  openSettings() {
    // Create a simple settings dialog
    const dialog = `
      <dialog id="zentabs-settings-dialog" style="padding: 20px; min-width: 500px;">
        <h2>ZenTabs Manager Settings</h2>
        <p>Open about:config and search for "zentabs" to configure preferences.</p>
        <p>Or edit preferences in localStorage:</p>
        <pre style="background: #f5f5f5; padding: 10px; border-radius: 4px; overflow: auto;">
${JSON.stringify(this.manager.getPreferences(), null, 2)}
        </pre>
        <div style="margin-top: 20px; text-align: right;">
          <button onclick="document.getElementById('zentabs-settings-dialog').close()">Close</button>
        </div>
      </dialog>
    `;
    
    // Insert and show dialog
    const container = document.createElement("div");
    container.innerHTML = dialog;
    document.body.appendChild(container);
    document.getElementById("zentabs-settings-dialog").showModal();
  }

  /**
   * Show notification
   */
  showNotification(title, message) {
    // Use Firefox notification system or fallback to console
    if (window.Notification && Notification.permission === "granted") {
      new Notification(title, { body: message });
    } else {
      console.log(`[${title}] ${message}`);
    }
  }

  /**
   * Log helper
   */
  log(...args) {
    this.manager.log("[UIManager]", ...args);
  }

  /**
   * Shutdown
   */
  async shutdown() {
    if (this.keyHandler) {
      window.removeEventListener("keydown", this.keyHandler, true);
    }
    
    if (this.toolbarButton && this.toolbarButton.parentNode) {
      this.toolbarButton.remove();
    }
    
    this.log("UIManager shut down");
  }
}
