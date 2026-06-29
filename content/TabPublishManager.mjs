/**
 * TabPublishManager - Export open tabs and publish a dashboard over SFTP.
 */

// Cached dashboard HTML to avoid repeated file I/O issues
let _cachedDashboardHtml = null;

export class TabPublishManager {
  constructor(manager) {
    this.manager = manager;
    this.lastPublishedFingerprint = null;
  }

  log(...args) {
    this.manager.log("[TabPublishManager]", ...args);
  }

  async init() {
    this.log("TabPublishManager initialized");
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

    const publishedTabs = list.filter(t => t.type === "essential" || t.type === "pinned");
    const openTabs = list.filter(t => t.type === "normal");

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
      tabs: publishedTabs,
      openTabs,
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
      }
    } catch (err) {
      this.log(`Fetch failed: ${err.message}`);
    }
    
    // 2. Try direct file I/O from content directory (same dir as this file)
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
      this.log(`File I/O failed: ${err.message}`);
    }
    
    // If all paths failed, throw error
    throw new Error("Could not load dashboard.html - verify the file exists in content/ directory");
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

  buildPayloadFingerprint(payload, html) {
    const {
      generatedAt,
      ...stablePayload
    } = payload;

    return JSON.stringify({
      payload: stablePayload,
      html,
    });
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
    const skipIfUnchanged = options.skipIfUnchanged !== false;
    const forceUpload = options.forceUpload === true;

    if (!cfg.host || !cfg.user || !cfg.remoteDir) {
      return {
        success: false,
        skipped: false,
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
        skipped: false,
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
      const fingerprint = this.buildPayloadFingerprint(payload, html);

      if (!forceUpload && skipIfUnchanged && this.lastPublishedFingerprint === fingerprint) {
        return {
          success: true,
          skipped: true,
          reason: "No changes detected in dashboard payload",
          exportedAt: payload.generatedAt,
          generated: {
            jsonFileName: "tabs.json",
            htmlFileName: "index.html",
            tabCount: payload.tabs.length,
          },
          uploaded: { json: false, html: false },
          errors,
        };
      }

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
      this.lastPublishedFingerprint = fingerprint;

      return {
        success: true,
        skipped: false,
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
        skipped: false,
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
