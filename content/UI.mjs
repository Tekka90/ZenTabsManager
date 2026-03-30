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
      const navbar = this.manager.window.document.getElementById("nav-bar");
      if (!navbar) {
        this.log("Navigation bar not found");
        return;
      }

      // Create toolbar button
      const button = this.manager.window.document.createXULElement("toolbarbutton");
      button.id = "zentabs-toolbar-button";
      button.setAttribute("class", "toolbarbutton-1 chromeclass-toolbar-additional");
      button.setAttribute("label", "ZenTabs");
      button.setAttribute("tooltiptext", "ZenTabs Manager - Click for options");
      button.setAttribute("type", "menu");
      
      // Add icon (SVG data URI)
      button.style.listStyleImage = "url('data:image/svg+xml;utf8,<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"%23666\" stroke-width=\"2\"><rect x=\"3\" y=\"3\" width=\"18\" height=\"4\" rx=\"1\"/><rect x=\"3\" y=\"10\" width=\"18\" height=\"4\" rx=\"1\"/><rect x=\"3\" y=\"17\" width=\"18\" height=\"4\" rx=\"1\"/><circle cx=\"18\" cy=\"5\" r=\"2\" fill=\"%23ff6b6b\"/></svg>')";
      
      // Create menu popup
      const popup = this.manager.window.document.createXULElement("menupopup");
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
    const item = this.manager.window.document.createXULElement("menuitem");
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
    const sep = this.manager.window.document.createXULElement("menuseparator");
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
    
    this.manager.window.addEventListener("keydown", this.keyHandler, true);
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
    const msg = `Clean up tabs older than ${this.manager.preferences.cleanupAge} days?`;
    const confirmed = this.manager.window.Services.prompt.confirm(null, "ZenTabs Manager", msg);
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
      const json = await this.manager.window.ZenTabsAPI.exportToJSON();
      
      // Create and download file
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = this.manager.window.document.createElement("a");
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
    const doc = this.manager.window.document;

    // Remove any existing dialog
    doc.getElementById("zentabs-settings-dialog")?.remove();

    const prefs = this.manager.getPreferences();

    const fields = [
      { key: "syncEnabled",           label: "Enable bookmark sync",          type: "checkbox" },
      { key: "syncDirection",          label: "Sync direction",                type: "select",   options: ["tabs-to-bookmarks", "bookmarks-to-tabs", "bidirectional"] },
      { key: "syncInterval",           label: "Auto-sync interval (seconds, 0 = manual)", type: "number" },
      { key: "cleanupEnabled",         label: "Enable automatic cleanup",      type: "checkbox" },
      { key: "cleanupAge",             label: "Close tabs older than (days)",  type: "number" },
      { key: "cleanupExcludeDomains",  label: "Exclude domains (comma-separated)", type: "text" },
      { key: "memoryOptimization",     label: "Enable memory optimization",    type: "checkbox" },
      { key: "memoryThreshold",        label: "Memory threshold (%)",          type: "number" },
      { key: "keepEssentialTabs",      label: "Never cleanup Essential tabs",  type: "checkbox" },
      { key: "keepPinnedTabs",         label: "Never cleanup Pinned tabs",     type: "checkbox" },
      { key: "showToolbarButton",      label: "Show toolbar button",           type: "checkbox" },
      { key: "debugMode",              label: "Debug logging",                 type: "checkbox" },
    ];

    const dialog = doc.createElementNS("http://www.w3.org/1999/xhtml", "dialog");
    dialog.id = "zentabs-settings-dialog";
    dialog.style.cssText = "padding:24px; min-width:480px; border-radius:8px; border:1px solid #ccc; font-family:system-ui,sans-serif;";

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "h2");
    title.textContent = "ZenTabs Manager — Settings";
    title.style.cssText = "margin:0 0 16px; font-size:16px;";
    dialog.appendChild(title);

    const form = doc.createElementNS("http://www.w3.org/1999/xhtml", "form");
    form.style.cssText = "display:grid; grid-template-columns:1fr auto; gap:8px 16px; align-items:center;";

    for (const field of fields) {
      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
      label.textContent = field.label;
      label.setAttribute("for", `zentabs-pref-${field.key}`);
      label.style.fontSize = "13px";

      let input;
      if (field.type === "checkbox") {
        input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
        input.type = "checkbox";
        input.checked = !!prefs[field.key];
      } else if (field.type === "select") {
        input = doc.createElementNS("http://www.w3.org/1999/xhtml", "select");
        input.style.cssText = "font-size:13px; padding:2px 4px;";
        for (const opt of field.options) {
          const o = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
          o.value = opt;
          o.textContent = opt;
          if (prefs[field.key] === opt) o.selected = true;
          input.appendChild(o);
        }
      } else {
        input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
        input.type = field.type;
        input.value = prefs[field.key] ?? "";
        input.style.cssText = "font-size:13px; padding:2px 6px; width:160px;";
      }
      input.id = `zentabs-pref-${field.key}`;

      form.appendChild(label);
      form.appendChild(input);
    }
    dialog.appendChild(form);

    // Buttons row
    const btnRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    btnRow.style.cssText = "display:flex; justify-content:flex-end; gap:8px; margin-top:20px;";

    const btnCancel = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    btnCancel.textContent = "Cancel";
    btnCancel.style.cssText = "padding:6px 16px; font-size:13px; cursor:pointer;";
    btnCancel.addEventListener("click", () => dialog.close());

    const btnSave = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    btnSave.textContent = "Save";
    btnSave.style.cssText = "padding:6px 16px; font-size:13px; cursor:pointer; background:#0060df; color:#fff; border:none; border-radius:4px;";
    btnSave.addEventListener("click", async () => {
      const newPrefs = {};
      for (const field of fields) {
        const el = doc.getElementById(`zentabs-pref-${field.key}`);
        if (!el) continue;
        if (field.type === "checkbox")   newPrefs[field.key] = el.checked;
        else if (field.type === "number") newPrefs[field.key] = Number(el.value);
        else                              newPrefs[field.key] = el.value;
      }
      try {
        await this.manager.setPreferences(newPrefs);
        this.showNotification("ZenTabs", "Settings saved");
        dialog.close();
      } catch (e) {
        console.error("[ZenTabs] Failed to save settings:", e);
      }
    });

    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnSave);
    dialog.appendChild(btnRow);

    doc.documentElement.appendChild(dialog);
    dialog.showModal();
  }

  /**
   * Show notification
   */
  showNotification(title, message) {
    console.log(`[ZenTabs] ${title}: ${message}`);
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
      this.manager.window.removeEventListener("keydown", this.keyHandler, true);
    }
    
    if (this.toolbarButton && this.toolbarButton.parentNode) {
      this.toolbarButton.remove();
    }
    
    this.log("UIManager shut down");
  }
}
