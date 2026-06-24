/**
 * TabPublishManager - Export open tabs and publish a dashboard over SFTP.
 */

export class TabPublishManager {
  constructor(manager) {
    this.manager = manager;
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
      stats,
      tabs: list,
    };
  }

  buildDashboardHtml(title = "ZenTabs Dashboard") {
    const safeTitle = String(title || "ZenTabs Dashboard").replace(/[<>]/g, "");
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    :root {
      --bg: #f6f4ee;
      --panel: #ffffff;
      --ink: #202124;
      --muted: #6b7280;
      --line: #e8e2d4;
      --type-essential: #f7d794;
      --type-pinned: #cde7f0;
      --type-normal: #e5e7eb;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Avenir Next", "Segoe UI", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1000px 400px at 100% -10%, #e9f6f8, transparent),
        radial-gradient(700px 300px at -10% 20%, #fff3df, transparent),
        var(--bg);
    }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 24px; }
    .hero {
      border: 1px solid var(--line);
      background: linear-gradient(135deg, #ffffff, #faf7ef);
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 12px 30px rgba(31,111,120,0.09);
      margin-bottom: 16px;
    }
    h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: 0.2px; }
    .muted { color: var(--muted); font-size: 13px; }
    .cards {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px;
    }
    .card .k { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
    .card .v { font-size: 24px; margin-top: 4px; }
    .panel {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 14px;
      overflow: hidden;
    }
    .toolbar {
      padding: 10px;
      border-bottom: 1px solid var(--line);
      background: #fffdf8;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }
    input, select {
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 13px;
      background: #fff;
    }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td {
      text-align: left;
      border-bottom: 1px solid var(--line);
      padding: 8px;
      font-size: 12px;
      vertical-align: top;
      overflow-wrap: anywhere;
    }
    th { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; }
    .essential { background: var(--type-essential); }
    .pinned { background: var(--type-pinned); }
    .normal { background: var(--type-normal); }
    @media (max-width: 700px) {
      h1 { font-size: 22px; }
      th:nth-child(5), td:nth-child(5) { display: none; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <h1>${safeTitle}</h1>
      <div class="muted" id="generated"></div>
      <div class="cards" id="cards"></div>
    </section>

    <section class="panel">
      <div class="toolbar">
        <input id="q" placeholder="Search title/url/folder" />
        <select id="typeFilter">
          <option value="">All types</option>
          <option value="essential">Essential</option>
          <option value="pinned">Pinned</option>
          <option value="normal">Normal</option>
        </select>
        <select id="spaceFilter"><option value="">All spaces</option></select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Title</th>
            <th>Space</th>
            <th>Folder</th>
            <th>URL</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </section>
  </div>

  <script>
    const el = {
      generated: document.getElementById("generated"),
      cards: document.getElementById("cards"),
      q: document.getElementById("q"),
      typeFilter: document.getElementById("typeFilter"),
      spaceFilter: document.getElementById("spaceFilter"),
      rows: document.getElementById("rows"),
    };

    let tabs = [];

    function drawCards(stats) {
      const entries = [
        ["Total", stats.total],
        ["Essential", stats.essential],
        ["Pinned", stats.pinned],
        ["Normal", stats.normal],
        ["Spaces", stats.spaces],
      ];
      el.cards.innerHTML = entries.map(([k, v]) =>
        '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>'
      ).join("");
    }

    function normalize(s) { return String(s ?? "").toLowerCase(); }

    function renderRows() {
      const q = normalize(el.q.value);
      const t = el.typeFilter.value;
      const s = el.spaceFilter.value;
      const filtered = tabs.filter(tab => {
        if (t && tab.type !== t) return false;
        if (s && tab.space !== s) return false;
        if (q) {
          const text = String(tab.title || "") + " " + String(tab.url || "") + " " + String(tab.folder || "");
          const lowered = text.toLowerCase();
          if (!lowered.includes(q)) return false;
        }
        return true;
      });

      el.rows.innerHTML = filtered.map(tab => {
        return '<tr>' +
          '<td><span class="pill ' + (tab.type || "normal") + '">' + (tab.type || "normal") + '</span></td>' +
          '<td>' + (tab.title || "") + '</td>' +
          '<td>' + (tab.space || "") + '</td>' +
          '<td>' + (tab.folder || "") + '</td>' +
          '<td><a href="' + (tab.url || "about:blank") + '" target="_blank" rel="noreferrer">' + (tab.url || "about:blank") + '</a></td>' +
        '</tr>';
      }).join("");
    }

    async function init() {
      const res = await fetch("./tabs.json", { cache: "no-store" });
      const data = await res.json();
      tabs = data.tabs || [];
      el.generated.textContent = "Generated: " + new Date(data.generatedAt).toLocaleString();
      drawCards(data.stats || { total: 0, essential: 0, pinned: 0, normal: 0, spaces: 0 });

      const spaces = [...new Set(tabs.map(t => t.space).filter(Boolean))].sort();
      for (const space of spaces) {
        const opt = document.createElement("option");
        opt.value = space;
        opt.textContent = space;
        el.spaceFilter.appendChild(opt);
      }

      el.q.addEventListener("input", renderRows);
      el.typeFilter.addEventListener("change", renderRows);
      el.spaceFilter.addEventListener("change", renderRows);
      renderRows();
    }

    init().catch(err => {
      el.rows.innerHTML = '<tr><td colspan="5">Failed to load tabs.json: ' + String(err) + '</td></tr>';
    });
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
      const html = this.buildDashboardHtml(cfg.dashboardTitle);

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
