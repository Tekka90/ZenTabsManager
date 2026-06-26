/**
 * TabPublishManager - Export open tabs and publish a dashboard over SFTP.
 */

// Cached dashboard HTML to avoid repeated file I/O issues
let _cachedDashboardHtml = null;

export class TabPublishManager {
  constructor(manager) {
    this.manager = manager;
  }

  log(...args) {
    this.manager.log("[TabPublishManager]", ...args);
  }

  async init() {
    this.log("TabPublishManager initialized");
    // Save dashboard HTML to profile directory and cache it on init
    try {
      await this._ensureDashboardHtmlAvailable();
      _cachedDashboardHtml = await this._readDashboardHtml();
    } catch (err) {
      this.log("Warning: Could not pre-load dashboard.html on init:", err.message);
      // Caching is optional - will fall back to generated fallback at publish time
    }
  }

  async _ensureDashboardHtmlAvailable() {
    const io = globalThis.IOUtils;
    const PathUtils = globalThis.PathUtils;
    
    if (!io || !PathUtils) return;
    
    try {
      const cacheDir = PathUtils.join(PathUtils.profileDir, "zentabs-dashboard");
      const cachedPath = PathUtils.join(cacheDir, "dashboard.html");
      
      // Check if already cached
      if (await io.exists(cachedPath)) {
        return; // Already cached
      }
      
      // Try to read from mod directory first
      await io.makeDirectory(cacheDir);
      
      // Try using fetch (mod-friendly approach)
      try {
        // Try to fetch from content/ directory (this file's directory)
        const baseUrl = new URL(".", import.meta.url).href;
        const dashboardUrl = new URL("dashboard.html", baseUrl).href;
        const response = await fetch(dashboardUrl);
        if (response.ok) {
          const content = await response.text();
          await io.writeUTF8(cachedPath, content);
          return; // Success
        }
      } catch (fetchErr) {
        this.log("Fetch from content/ failed:", fetchErr.message);
      }
      
      // Fallback: Try direct file I/O from content directory
      const possibleSources = [];
      
      // This file is in content/, so dashboard.html is in the same directory
      try {
        const moduleUrl = new URL(import.meta.url);
        if (moduleUrl.protocol === "file:") {
          const dir = new URL(".", moduleUrl).pathname;
          possibleSources.push(PathUtils.join(dir, "dashboard.html"));
        }
      } catch (e) {
        // ignore
      }
      
      // Try to read from each source
      for (const sourcePath of possibleSources) {
        try {
          const content = await io.readUTF8(sourcePath);
          // Found it! Cache to profile directory
          await io.writeUTF8(cachedPath, content);
          return; // Success
        } catch (err) {
          // continue to next source
        }
      }
    } catch (err) {
      this.log("Could not ensure dashboard HTML availability:", err.message);
      // Not critical - will fall back to generated version
    }
  }

  isConfigured() {
    const p = this.manager.preferences ?? {};
    return !!(p.publishSftpHost && p.publishSftpUser && p.publishSftpRemoteDir);
  }

  getMissingConfig() {
    const p = this.manager.preferences ?? {};
    const missing = [];
    if (!p.publishSftpHost) missing.push("publishSftpHost");
    if (!p.publishSftpUser) missing.push("publishSftpUser");
    if (!p.publishSftpRemoteDir) missing.push("publishSftpRemoteDir");
    return missing;
  }

  buildTabsPayload(tabs) {
    const list = (tabs ?? []).map(tab => ({
      title: tab.title ?? "Untitled",
      url: tab.url ?? "about:blank",
      type: tab.type ?? "normal",
      space: tab.workspace?.name ?? "default",
      folder: Array.isArray(tab.folderPath) ? tab.folderPath.join("/") : (tab.folderPath ?? ""),
      container: tab.container ?? null,
      lastAccessed: tab.lastAccessed ?? Date.now(),
    }));

    const stats = {
      total: list.length,
      essential: list.filter(t => t.type === "essential").length,
      pinned: list.filter(t => t.type === "pinned").length,
      normal: list.filter(t => t.type === "normal").length,
      spaces: new Set(list.map(t => t.space)).size,
    };

    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      source: "ZenTabsManager",
      title: this.manager.preferences?.publishSftpDashboardTitle || "ZenTabs Dashboard",
      stats,
      tabs: list,
    };
  }
  async _readDashboardHtml() {
    // Use cached copy if available
    if (_cachedDashboardHtml) {
      return _cachedDashboardHtml;
    }
    
    const io = globalThis.IOUtils;
    const PathUtils = globalThis.PathUtils;
    
    if (!io) throw new Error("IOUtils not available");
    
    const errors = [];
    
    // 1. Try fetch first (works in mod context)
    // TabPublishManager.mjs is in content/, same dir as dashboard.html
    try {
      const baseUrl = new URL(".", import.meta.url).href;
      const dashboardUrl = new URL("dashboard.html", baseUrl).href;
      this.log(`Attempting to fetch dashboard from: ${dashboardUrl}`);
      const response = await fetch(dashboardUrl);
      if (response.ok) {
        const content = await response.text();
        this.log("Successfully loaded dashboard.html via fetch");
        _cachedDashboardHtml = content;
        return content;
      } else {
        errors.push(`fetch returned ${response.status}`);
      }
    } catch (err) {
      errors.push(`fetch error: ${err.message}`);
      this.log(`Fetch failed: ${err.message}`);
    }
    
    // 2. Try cached copy in profile directory
    if (PathUtils) {
      try {
        const cachedPath = PathUtils.join(PathUtils.profileDir, "zentabs-dashboard", "dashboard.html");
        this.log(`Trying profile cache: ${cachedPath}`);
        const content = await io.readUTF8(cachedPath);
        this.log("Successfully loaded dashboard.html from profile cache");
        _cachedDashboardHtml = content;
        return content;
      } catch (err) {
        errors.push(`profile cache error: ${err.message}`);
        this.log(`Profile cache failed: ${err.message}`);
      }
    }
    
    // 3. Try direct file I/O from content directory (same dir as this file)
    try {
      const moduleUrl = new URL(import.meta.url);
      if (moduleUrl.protocol === "file:") {
        const dir = new URL(".", moduleUrl).pathname;
        const filePath = dir + "dashboard.html";
        this.log(`Trying file I/O: ${filePath}`);
        const content = await io.readUTF8(filePath);
        this.log("Successfully loaded dashboard.html via file I/O");
        _cachedDashboardHtml = content;
        return content;
      }
    } catch (err) {
      errors.push(`file I/O error: ${err.message}`);
      this.log(`File I/O failed: ${err.message}`);
    }
    
    // If all paths failed, log diagnostics and generate a minimal fallback dashboard
    this.log("Warning: Could not read dashboard.html from any source, using fallback");
    this.log(`This file (TabPublishManager.mjs) location: ${import.meta.url}`);
    this.log(`Errors encountered: ${errors.join("; ")}`);
    
    const fallback = this._generateFallbackDashboardHtml();
    _cachedDashboardHtml = fallback;
    return fallback;
  }

  _generateFallbackDashboardHtml() {
    // Minimal fallback dashboard HTML in case file is not found
    // This ensures the feature works even if asset loading fails
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>ZenTabs Dashboard</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 800px; margin: 0 auto; background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    h1 { margin-top: 0; color: #333; }
    .error { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; padding: 12px; border-radius: 4px; margin: 12px 0; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
    .stat { background: #f9f9f9; padding: 16px; border-radius: 4px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #1f6f78; }
    .stat-label { font-size: 12px; color: #666; margin-top: 4px; }
    .tabs-list { list-style: none; padding: 0; margin: 16px 0; }
    .tabs-list li { padding: 8px; border-bottom: 1px solid #eee; }
    .tab-title { font-weight: 500; }
    .tab-url { font-size: 12px; color: #666; margin-top: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1 id="pageTitle">ZenTabs Dashboard</h1>
    <div class="error">⚠️ Note: This is a minimal fallback dashboard. The full dashboard HTML file was not found.</div>
    <div id="generated"></div>
    <div class="stats" id="cards"></div>
    <div id="tree"></div>
  </div>
  <script>
    function drawCards(stats) {
      const entries = [["Total", stats.total], ["Essential", stats.essential], ["Pinned", stats.pinned], ["Normal", stats.normal], ["Spaces", stats.spaces]];
      document.getElementById("cards").innerHTML = entries.map(e => '<div class="stat"><div class="stat-value">' + e[1] + '</div><div class="stat-label">' + e[0] + '</div></div>').join("");
    }
    fetch("./tabs.json", { cache: "no-store" }).then(r => r.json()).then(data => {
      if (data.title) { document.getElementById("pageTitle").textContent = data.title; document.title = data.title; }
      document.getElementById("generated").textContent = "Generated: " + new Date(data.generatedAt).toLocaleString();
      drawCards(data.stats || {});
      const html = '<ul class="tabs-list">' + (data.tabs || []).map(t => '<li><div class="tab-title"><a href="' + (t.url || "about:blank") + '" target="_blank">' + (t.title || "Untitled") + '</a></div><div class="tab-url">' + (t.url || "") + '</div></li>').join("") + '</ul>';
      document.getElementById("tree").innerHTML = html;
    }).catch(err => { document.getElementById("tree").innerHTML = '<div class="error">Failed to load tabs.json: ' + err + '</div>'; });
  </script>
</body>
</html>`;
  }

  _quoteForBatch(value) {
    return `"${String(value).replaceAll("\"", "\\\"")}"`;
  }

  buildSftpBatchContent(localJsonPath, localHtmlPath, remoteDir) {
    const safeRemoteDir = String(remoteDir || ".");
    return [
      `cd ${this._quoteForBatch(safeRemoteDir)}`,
      `put ${this._quoteForBatch(localJsonPath)} tabs.json`,
      `put ${this._quoteForBatch(localHtmlPath)} index.html`,
      "bye",
      "",
    ].join("\n");
  }

  buildSftpArgs(cfg, batchPath) {
    const args = ["-P", String(cfg.port || 22)];
    if (cfg.privateKeyPath) {
      args.push("-i", cfg.privateKeyPath);
    }
    args.push("-b", batchPath, `${cfg.user}@${cfg.host}`);
    return args;
  }

  async _runSftp(args) {
    if (typeof this.manager.window?.ZenTabsProcessRunner === "function") {
      return this.manager.window.ZenTabsProcessRunner("/usr/bin/sftp", args);
    }

    const Cc = globalThis.Cc;
    const Ci = globalThis.Ci;
    if (!Cc || !Ci) {
      throw new Error("SFTP execution is unavailable in this runtime");
    }

    const exe = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
    exe.initWithPath("/usr/bin/sftp");
    if (!exe.exists()) throw new Error("/usr/bin/sftp not found");

    const proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(exe);
    proc.run(true, args, args.length);
    if (proc.exitValue !== 0) {
      throw new Error(`sftp exited with code ${proc.exitValue}`);
    }
    return { code: 0 };
  }

  async publishTabsToSftp(options = {}) {
    const errors = [];
    const prefs = this.manager.preferences ?? {};
    const cfg = {
      host: options.host ?? prefs.publishSftpHost,
      port: options.port ?? prefs.publishSftpPort ?? 22,
      user: options.user ?? prefs.publishSftpUser,
      remoteDir: options.remoteDir ?? prefs.publishSftpRemoteDir,
      privateKeyPath: options.privateKeyPath ?? prefs.publishSftpPrivateKeyPath,
      dashboardTitle: options.dashboardTitle ?? prefs.publishSftpDashboardTitle ?? "ZenTabs Dashboard",
    };

    if (!cfg.host || !cfg.user || !cfg.remoteDir) {
      return {
        success: false,
        exportedAt: new Date().toISOString(),
        generated: { jsonFileName: "tabs.json", htmlFileName: "index.html", tabCount: 0 },
        uploaded: { json: false, html: false },
        errors: ["Missing SFTP configuration (host/user/remoteDir)"],
      };
    }

    const IOUtils = globalThis.IOUtils;
    const PathUtils = globalThis.PathUtils;
    if (!IOUtils || !PathUtils) {
      return {
        success: false,
        exportedAt: new Date().toISOString(),
        generated: { jsonFileName: "tabs.json", htmlFileName: "index.html", tabCount: 0 },
        uploaded: { json: false, html: false },
        errors: ["File APIs unavailable (IOUtils/PathUtils)"],
      };
    }

    try {
      const tabs = await this.manager.tabManager.getAllTabs();
      const payload = this.buildTabsPayload(tabs);
      const html = await this._readDashboardHtml();

      const baseDir = PathUtils.join(PathUtils.profileDir, "zentabs-publish");
      await IOUtils.makeDirectory(baseDir);

      const jsonPath = PathUtils.join(baseDir, "tabs.json");
      const htmlPath = PathUtils.join(baseDir, "index.html");
      const batchPath = PathUtils.join(baseDir, "upload.sftp");

      await IOUtils.writeUTF8(jsonPath, JSON.stringify(payload, null, 2));
      await IOUtils.writeUTF8(htmlPath, html);
      await IOUtils.writeUTF8(batchPath, this.buildSftpBatchContent(jsonPath, htmlPath, cfg.remoteDir));

      const args = this.buildSftpArgs(cfg, batchPath);
      await this._runSftp(args);

      return {
        success: true,
        exportedAt: payload.generatedAt,
        generated: {
          jsonFileName: "tabs.json",
          htmlFileName: "index.html",
          tabCount: payload.tabs.length,
        },
        uploaded: { json: true, html: true },
        errors,
      };
    } catch (e) {
      errors.push(String(e?.message || e));
      return {
        success: false,
        exportedAt: new Date().toISOString(),
        generated: {
          jsonFileName: "tabs.json",
          htmlFileName: "index.html",
          tabCount: 0,
        },
        uploaded: { json: false, html: false },
        errors,
      };
    }
  }
}
