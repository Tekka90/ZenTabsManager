/**
 * UIManager - User interface components
 * 
 * Handles toolbar buttons, settings panel, and other UI elements.
 */

import {
  buildSyncSummaryResult,
  buildSyncDryRunResult,
  buildRestoreSummaryResult,
  buildRestoreDryRunResult,
  buildCleanupSummaryResult,
  buildMemorySummaryResult,
  buildStatisticsResult,
  buildErrorResult,
} from "./ResultFormatter.mjs";

export class UIManager {
  constructor(manager) {
    this.manager = manager;
    this.toolbarButton = null;
    this.menuPopup = null;
    this.pauseMenuItem = null;
    this.publishMenuItem = null;
    this.resultsDialog = null;
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
      
      // Pause toggle — always first for quick access
      this.pauseMenuItem = this.addMenuItem(popup, this.getPauseLabel(), () => this.togglePause());
      this.addMenuSeparator(popup);

      // Add menu items
      this.addMenuItem(popup, "Sync to Bookmarks", () => this.simpleSyncToBookmarks(), "Cmd+Shift+B");
      this.addMenuItem(popup, "Sync to Bookmarks (dry run)", () => this.simpleSyncToBookmarksDryRun());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Restore from Bookmarks", () => this.simpleSyncFromBookmarks());
      this.addMenuItem(popup, "Restore from Bookmarks (dry run)", () => this.simpleSyncFromBookmarksDryRun());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Cleanup Old Tabs", () => this.cleanupOldTabs());
      this.addMenuItem(popup, "Optimize Memory", () => this.optimizeMemory());
      this.addMenuSeparator(popup);
      this.addMenuItem(popup, "Show Statistics", () => this.showStatistics());
      this.addMenuItem(popup, "Export to JSON", () => this.exportToJSON());
      this.publishMenuItem = this.addMenuItem(popup, "Publish Tabs Dashboard", () => this.publishTabsDashboard());
      this.refreshPublishMenuVisibility();
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

  isSftpPublishConfigured() {
    const prefs = this.manager.preferences ?? {};
    return !!(prefs.publishSftpHost && prefs.publishSftpUser && prefs.publishSftpRemoteDir);
  }

  refreshPublishMenuVisibility() {
    if (!this.publishMenuItem) return;
    this.publishMenuItem.hidden = !this.isSftpPublishConfigured();
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

  getPauseLabel() {
    return this.manager.preferences.paused ? "▶ Resume ZenTabs" : "⏸ Pause ZenTabs";
  }

  togglePause() {
    if (this.manager.preferences.paused) {
      this.manager.resume();
    } else {
      this.manager.pause();
    }
    if (this.pauseMenuItem) {
      this.pauseMenuItem.setAttribute("label", this.getPauseLabel());
    }
    this.showNotification("ZenTabs", this.manager.preferences.paused ? "Syncing paused" : "Syncing resumed");
  }

  /**
   * Setup keyboard shortcuts
   */
  setupKeyboardShortcuts() {
    this.keyHandler = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        if (event.key === 'B') {
          event.preventDefault();
          this.simpleSyncToBookmarks();
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
  async simpleSyncFromBookmarks() {
    console.log("[ZenTabs] Restore — syncing bookmarks to tabs...");
    try {
      const result = await this.manager.simpleBookmarkSyncManager.syncBookmarksToTabs();
      console.log("Restore complete:", result);
      this.openResultsWindow(buildRestoreSummaryResult(result));
      this.showNotification(
        "Restore Complete",
        `Created ${result.created}, deleted ${result.deleted}`
      );
    } catch (error) {
      console.error("[ZenTabs] Restore failed:", error);
      this.openResultsWindow(buildErrorResult("ZenTabs - Restore From Bookmarks", error));
      this.showNotification("Restore Failed", String(error));
    }
  }

  async simpleSyncFromBookmarksDryRun() {
    console.log("[ZenTabs] Restore (dry-run) — previewing restore plan...");
    try {
      const result = await this.manager.simpleBookmarkSyncManager.syncBookmarksToTabs({ dryRun: true });
      console.log("[ZenTabs][DryRun] Plan:", result.plan);
      this.openResultsWindow(buildRestoreDryRunResult(result));
      this.showNotification(
        "Dry Run Complete",
        `Would create ${result.created}, delete ${result.deleted} tabs — see console`
      );
    } catch (error) {
      console.error("[ZenTabs] Dry run failed:", error);
      this.openResultsWindow(buildErrorResult("ZenTabs - Restore Dry Run", error));
      this.showNotification("Dry Run Failed", String(error));
    }
  }

  async simpleSyncToBookmarks() {
    console.log("[ZenTabs] New Sync — syncing tabs to bookmarks...");
    try {
      const result = await this.manager.simpleBookmarkSyncManager.syncTabsToBookmarks();
      console.log("✅ New Sync complete:", result);
      this.openResultsWindow(buildSyncSummaryResult(result));
      this.showNotification(
        "New Sync Complete",
        `Created ${result.created}, updated ${result.updated}, deleted ${result.deleted}`
      );
    } catch (error) {
      console.error("[ZenTabs] New Sync failed:", error);
      this.openResultsWindow(buildErrorResult("ZenTabs - Sync To Bookmarks", error));
      this.showNotification("New Sync Failed", String(error));
    }
  }

  async simpleSyncToBookmarksDryRun() {
    console.log("[ZenTabs] Sync (dry-run) — previewing tabs->bookmarks changes...");
    try {
      const result = await this.manager.simpleBookmarkSyncManager.syncTabsToBookmarks({ dryRun: true });
      console.log("[ZenTabs][DryRun] Sync plan:", result.plan);
      this.openResultsWindow(buildSyncDryRunResult(result));
      this.showNotification(
        "Dry Run Complete",
        `Would create ${result.created}, update ${result.updated}, delete ${result.deleted} bookmarks`
      );
    } catch (error) {
      console.error("[ZenTabs] Sync dry run failed:", error);
      this.openResultsWindow(buildErrorResult("ZenTabs - Sync To Bookmarks Dry Run", error));
      this.showNotification("Dry Run Failed", String(error));
    }
  }

  async cleanupOldTabs() {
    const msg = `Clean up tabs older than ${this.manager.preferences.cleanupAge} days?`;
    const confirmed = this.manager.window.Services.prompt.confirm(null, "ZenTabs Manager", msg);
    if (!confirmed) return;
    
    console.log("🧹 Cleaning up old tabs...");
    try {
      const result = await this.manager.cleanupManager.cleanupOldTabs();
      console.log("✅ Cleanup complete:", result);
      this.openResultsWindow(buildCleanupSummaryResult(result));
      this.showNotification("Cleanup Complete", `Closed ${result.closed} old tabs`);
    } catch (error) {
      this.openResultsWindow(buildErrorResult("ZenTabs - Cleanup Old Tabs", error));
      this.showNotification("Cleanup Failed", String(error));
    }
  }

  async optimizeMemory() {
    console.log("💾 Optimizing memory...");
    try {
      const result = await this.manager.cleanupManager.optimizeMemory({ force: true });
      console.log("✅ Memory optimization complete:", result);
      this.openResultsWindow(buildMemorySummaryResult(result));
      this.showNotification("Memory Optimized", `Unloaded ${result.unloaded} tabs, saved ~${result.saved}MB`);
    } catch (error) {
      this.openResultsWindow(buildErrorResult("ZenTabs - Optimize Memory", error));
      this.showNotification("Optimize Failed", String(error));
    }
  }

  async showStatistics() {
    try {
      const stats = await this.manager.tabManager.getStatistics();
      const memoryInfo = await this.manager.cleanupManager.getMemoryInfo();
      this.openResultsWindow(buildStatisticsResult({ stats, memoryInfo }));
    } catch (error) {
      this.openResultsWindow(buildErrorResult("ZenTabs - Statistics", error));
    }
  }

  openResultsWindow(viewModel) {
    const doc = this.manager.window.document;
    if (!doc) {
      console.log("[ZenTabs] Results:", viewModel);
      return;
    }

    doc.getElementById("zentabs-results-dialog")?.remove();

    const dialog = doc.createElementNS("http://www.w3.org/1999/xhtml", "dialog");
    dialog.id = "zentabs-results-dialog";
    dialog.style.cssText = "padding:16px; min-width:640px; max-width:880px; width:70vw; max-height:78vh; border-radius:8px; border:1px solid #ccc; font-family:system-ui,sans-serif;";

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "h2");
    title.textContent = viewModel.title || "ZenTabs - Results";
    title.style.cssText = "margin:0 0 8px; font-size:16px;";
    dialog.appendChild(title);

    const subtitle = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    subtitle.textContent = `Generated at ${new Date(viewModel.timestamp || Date.now()).toLocaleString()}`;
    subtitle.style.cssText = "font-size:12px; color:#666; margin-bottom:12px;";
    dialog.appendChild(subtitle);

    const summaryWrap = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    summaryWrap.style.cssText = "display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;";
    for (const item of viewModel.summary || []) {
      const chip = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      chip.style.cssText = "padding:4px 8px; border:1px solid #ddd; border-radius:999px; font-size:12px; background:#fafafa;";
      chip.textContent = `${item.label}: ${item.value}`;
      summaryWrap.appendChild(chip);
    }
    dialog.appendChild(summaryWrap);

    const body = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    body.style.cssText = "max-height:50vh; overflow:auto; border:1px solid #eee; border-radius:6px; padding:8px;";

    if (viewModel.emptyState) {
      const empty = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
      empty.style.cssText = "font-size:13px; color:#666; padding:6px 2px;";
      empty.textContent = viewModel.emptyState;
      body.appendChild(empty);
    }

    for (const section of viewModel.sections || []) {
      const heading = doc.createElementNS("http://www.w3.org/1999/xhtml", "h3");
      heading.textContent = section.heading;
      heading.style.cssText = "margin:8px 0 6px; font-size:13px;";
      body.appendChild(heading);

      if (!section.rows || section.rows.length === 0) {
        const none = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
        none.style.cssText = "font-size:12px; color:#777; margin-bottom:8px;";
        none.textContent = "No rows.";
        body.appendChild(none);
        continue;
      }

      const columns = Object.keys(section.rows[0]);
      const table = doc.createElementNS("http://www.w3.org/1999/xhtml", "table");
      table.style.cssText = "width:100%; border-collapse:collapse; margin-bottom:10px; table-layout:fixed;";

      const thead = doc.createElementNS("http://www.w3.org/1999/xhtml", "thead");
      const htr = doc.createElementNS("http://www.w3.org/1999/xhtml", "tr");
      for (const col of columns) {
        const th = doc.createElementNS("http://www.w3.org/1999/xhtml", "th");
        th.textContent = col;
        th.style.cssText = "font-size:11px; text-align:left; border-bottom:1px solid #ddd; padding:4px;";
        htr.appendChild(th);
      }
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = doc.createElementNS("http://www.w3.org/1999/xhtml", "tbody");
      for (const row of section.rows) {
        const tr = doc.createElementNS("http://www.w3.org/1999/xhtml", "tr");
        for (const col of columns) {
          const td = doc.createElementNS("http://www.w3.org/1999/xhtml", "td");
          td.textContent = row[col] === undefined || row[col] === null ? "" : String(row[col]);
          td.style.cssText = "font-size:12px; vertical-align:top; border-bottom:1px solid #f1f1f1; padding:4px; overflow-wrap:anywhere;";
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      body.appendChild(table);
    }

    dialog.appendChild(body);

    const buttonRow = doc.createElementNS("http://www.w3.org/1999/xhtml", "div");
    buttonRow.style.cssText = "display:flex; justify-content:flex-end; margin-top:12px;";
    const closeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "button");
    closeBtn.textContent = "Close";
    closeBtn.style.cssText = "padding:6px 16px; font-size:13px; cursor:pointer;";
    closeBtn.addEventListener("click", () => dialog.close());
    buttonRow.appendChild(closeBtn);
    dialog.appendChild(buttonRow);

    doc.documentElement.appendChild(dialog);
    dialog.showModal();
    this.resultsDialog = dialog;
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

  async publishTabsDashboard() {
    try {
      if (!this.isSftpPublishConfigured()) {
        this.showNotification("Publish Unavailable", "Configure SFTP settings first");
        return;
      }

      const result = await this.manager.tabPublishManager.publishTabsToSftp();
      if (result.success) {
        this.openResultsWindow({
          title: "ZenTabs - Publish Tabs Dashboard",
          timestamp: result.exportedAt,
          summary: [
            { label: "Success", value: "Yes" },
            { label: "Tabs", value: result.generated.tabCount },
            { label: "JSON", value: result.generated.jsonFileName },
            { label: "HTML", value: result.generated.htmlFileName },
          ],
          sections: [
            {
              heading: "Upload",
              rows: [
                { Target: result.target ?? "(configured server)", JSON: result.uploaded.json, HTML: result.uploaded.html },
              ],
            },
          ],
        });
        this.showNotification("Publish Complete", `Uploaded ${result.generated.tabCount} tabs`);
      } else {
        const message = (result.errors ?? []).join("; ") || "Unknown error";
        this.openResultsWindow(buildErrorResult("ZenTabs - Publish Tabs Dashboard", message));
        this.showNotification("Publish Failed", message);
      }
    } catch (error) {
      this.openResultsWindow(buildErrorResult("ZenTabs - Publish Tabs Dashboard", error));
      this.showNotification("Publish Failed", String(error));
    }
  }

  openSettings() {
    const doc = this.manager.window.document;

    // Remove any existing dialog
    doc.getElementById("zentabs-settings-dialog")?.remove();

    const prefs = this.manager.getPreferences();

    const fields = [
      {
        key: "cleanupEnabled", label: "Enable automatic cleanup", type: "checkbox",
        tooltip: "Runs every hour and automatically closes normal tabs that haven't been accessed for longer than the threshold below. Essential and pinned tabs are protected. Domains in the exclude list are also skipped."
      },
      {
        key: "cleanupAge", label: "Close tabs older than", type: "number-with-unit",
        unitKey: "cleanupAgeUnit", unitOptions: ["hours", "days"],
        tooltip: "Tabs not accessed for longer than this duration will be automatically closed by the cleanup job. Applies to normal tabs only."
      },
      {
        key: "cleanupExcludeDomains", label: "Exclude domains (comma-separated)", type: "text",
        tooltip: "Tabs whose URL matches any of these domains (or subdomains) will never be closed by automatic cleanup. Example: github.com, notion.so"
      },
      {
        key: "memoryOptimization", label: "Enable memory optimization", type: "checkbox",
        tooltip: "Every 5 minutes, checks if JS heap usage exceeds the threshold below. If so, the oldest inactive tabs are discarded (unloaded from RAM) using Firefox's built-in tab discard. Discarded tabs stay visible in the tab bar and silently reload when clicked."
      },
      {
        key: "memoryThreshold", label: "Memory threshold (%)", type: "number",
        tooltip: "Percentage of physical RAM used by all browser processes before memory optimisation kicks in. Default is 80%. Measured via ChromeUtils.requestProcInfo() and Services.sysinfo."
      },
      {
        key: "autoUnloadEnabled", label: "Auto-unload idle tabs", type: "checkbox",
        tooltip: "When enabled, tabs that haven't been touched for longer than the delay below are automatically discarded (unloaded from RAM). The tab stays in the tab bar and reloads when you click it. Checked every minute."
      },
      {
        key: "autoUnloadDelay", label: "Unload tabs idle for (seconds)", type: "number",
        tooltip: "How long a tab must be idle (not accessed) before it is automatically unloaded. Default is 3600 (1 hour). Essential and pinned tabs are protected when the corresponding 'Never cleanup' options are on."
      },
      {
        key: "keepEssentialTabs", label: "Never cleanup Essential tabs", type: "checkbox",
        tooltip: "When enabled, Essential tabs (marked with the zen-essential attribute) are never closed by automatic cleanup, regardless of age."
      },
      {
        key: "keepPinnedTabs", label: "Never cleanup Pinned tabs", type: "checkbox",
        tooltip: "When enabled, Pinned tabs are never closed by automatic cleanup, regardless of age."
      },
      {
        key: "showToolbarButton", label: "Show toolbar button", type: "checkbox",
        tooltip: "Displays the ZenTabs toolbar button in the navigation bar. Takes effect after restarting Zen Browser."
      },
      {
        key: "debugMode", label: "Debug logging", type: "checkbox",
        tooltip: "Enables verbose logging to the browser console (Cmd+Shift+J). Useful for troubleshooting sync or cleanup issues."
      },
      {
        key: "publishSftpHost", label: "Publish SFTP host", type: "text",
        tooltip: "SFTP hostname used to upload tabs.json and index.html."
      },
      {
        key: "publishSftpPort", label: "Publish SFTP port", type: "number",
        tooltip: "SFTP port (default 22)."
      },
      {
        key: "publishSftpUser", label: "Publish SFTP user", type: "text",
        tooltip: "SFTP username used for upload."
      },
      {
        key: "publishSftpRemoteDir", label: "Publish SFTP remote directory", type: "text",
        tooltip: "Remote directory where tabs.json and index.html are uploaded."
      },
      {
        key: "publishSftpPrivateKeyPath", label: "Publish SFTP private key path", type: "text",
        tooltip: "Optional path to SSH private key for SFTP authentication."
      },
      {
        key: "publishSftpDashboardTitle", label: "Dashboard page title", type: "text",
        tooltip: "Title displayed in the generated web dashboard."
      },
    ];

    const dialog = doc.createElementNS("http://www.w3.org/1999/xhtml", "dialog");
    dialog.id = "zentabs-settings-dialog";
    dialog.style.cssText = "padding:24px; min-width:520px; border-radius:8px; border:1px solid #ccc; font-family:system-ui,sans-serif;";

    const title = doc.createElementNS("http://www.w3.org/1999/xhtml", "h2");
    title.textContent = "ZenTabs Manager — Settings";
    title.style.cssText = "margin:0 0 16px; font-size:16px;";
    dialog.appendChild(title);

    const form = doc.createElementNS("http://www.w3.org/1999/xhtml", "form");
    form.style.cssText = "display:grid; grid-template-columns:1fr auto; gap:8px 16px; align-items:center;";

    for (const field of fields) {
      const labelEl = doc.createElementNS("http://www.w3.org/1999/xhtml", "label");
      labelEl.setAttribute("for", `zentabs-pref-${field.key}`);
      labelEl.style.cssText = "font-size:13px; display:flex; align-items:center; gap:4px; cursor:default;";

      const labelText = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
      labelText.textContent = field.label;
      labelEl.appendChild(labelText);

      if (field.tooltip) {
        const hint = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        hint.textContent = "ⓘ";
        hint.title = field.tooltip;
        hint.style.cssText = "color:#888; font-size:11px; cursor:help; flex-shrink:0;";
        labelEl.appendChild(hint);
      }

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
      } else if (field.type === "number-with-unit") {
        // Render number input + unit select side by side
        input = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
        input.style.cssText = "display:flex; align-items:center; gap:4px;";

        const numInput = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
        numInput.type = "number";
        numInput.id = `zentabs-pref-${field.key}`;
        numInput.value = prefs[field.key] ?? "";
        numInput.style.cssText = "font-size:13px; padding:2px 6px; width:80px;";
        input.appendChild(numInput);

        const unitSelect = doc.createElementNS("http://www.w3.org/1999/xhtml", "select");
        unitSelect.id = `zentabs-pref-${field.unitKey}`;
        unitSelect.style.cssText = "font-size:13px; padding:2px 4px;";
        for (const opt of field.unitOptions) {
          const o = doc.createElementNS("http://www.w3.org/1999/xhtml", "option");
          o.value = opt;
          o.textContent = opt;
          if (prefs[field.unitKey] === opt) o.selected = true;
          unitSelect.appendChild(o);
        }
        input.appendChild(unitSelect);
      } else {
        input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input");
        input.type = field.type;
        input.value = prefs[field.key] ?? "";
        input.style.cssText = "font-size:13px; padding:2px 6px; width:160px;";
      }
      if (field.type !== "number-with-unit") {
        input.id = `zentabs-pref-${field.key}`;
      }

      form.appendChild(labelEl);
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
        if (field.type === "checkbox")        newPrefs[field.key] = el.checked;
        else if (field.type === "number")     newPrefs[field.key] = Number(el.value);
        else if (field.type === "number-with-unit") {
          newPrefs[field.key] = Number(el.value);
          const unitEl = doc.getElementById(`zentabs-pref-${field.unitKey}`);
          if (unitEl) newPrefs[field.unitKey] = unitEl.value;
        } else                                newPrefs[field.key] = el.value;
      }
      try {
        await this.manager.setPreferences(newPrefs);
        this.refreshPublishMenuVisibility();
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
    this.resultsDialog?.remove();

    if (this.keyHandler) {
      this.manager.window.removeEventListener("keydown", this.keyHandler, true);
    }
    
    if (this.toolbarButton && this.toolbarButton.parentNode) {
      this.toolbarButton.remove();
    }
    
    this.log("UIManager shut down");
  }
}
