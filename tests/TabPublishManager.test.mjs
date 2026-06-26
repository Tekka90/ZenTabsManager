import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { TabPublishManager } from "../content/TabPublishManager.mjs";
import { makeManager } from "./helpers/mocks.mjs";

const DASHBOARD_HTML = readFileSync(
  fileURLToPath(new URL("../content/dashboard.html", import.meta.url)),
  "utf8"
);

function makePublishManager({ tabs = [], preferences = {} } = {}) {
  const mgr = makeManager({ tabs, preferences: { ...preferences } });
  mgr.tabManager = {
    async getAllTabs() {
      return tabs;
    },
  };
  return { mgr, pub: new TabPublishManager(mgr) };
}

describe("TabPublishManager", () => {
  test("buildTabsPayload splits published tabs and open normal tabs", () => {
    const tabs = [
      {
        title: "Mail",
        url: "https://mail.com",
        type: "essential",
        workspace: { name: "Work" },
        folderPath: ["Ops", "Inbox"],
        container: 2,
        lastAccessed: 123,
      },
      {
        title: "Docs",
        url: "https://docs.com",
        type: "normal",
        workspace: { name: "Personal" },
        folderPath: null,
        container: null,
        lastAccessed: 456,
      },
    ];

    const { pub } = makePublishManager({ tabs });
    const payload = pub.buildTabsPayload(tabs);

    assert.equal(payload.version, 1);
    assert.equal(payload.source, "ZenTabsManager");
    assert.equal(payload.stats.total, 2);
    assert.equal(payload.stats.essential, 1);
    assert.equal(payload.stats.normal, 1);
    assert.equal(payload.stats.spaces, 2);
    assert.equal(payload.tabs.length, 1);
    assert.equal(payload.tabs[0].type, "essential");
    assert.equal(payload.tabs[0].folder, "Ops/Inbox");
    assert.equal(payload.openTabs.length, 1);
    assert.equal(payload.openTabs[0].type, "normal");
    assert.equal(typeof payload.title, "string", "payload must include a title field");
  });

  test("dashboard.html is fully static and reads title from JSON at runtime", () => {
    assert.match(DASHBOARD_HTML, /<title>ZenTabs Dashboard<\/title>/);
    assert.match(DASHBOARD_HTML, /fetch\("\.\/tabs\.json"/);
    assert.match(DASHBOARD_HTML, /data\.title/);
    assert.match(DASHBOARD_HTML, /Search tabs/);
  });

  test("dashboard.html renders hierarchical tree structure", () => {
    assert.match(DASHBOARD_HTML, /space-block/);
    assert.match(DASHBOARD_HTML, /folder-block/);
    assert.match(DASHBOARD_HTML, /buildTree/);
    assert.match(DASHBOARD_HTML, /renderFolderNode/);
    assert.match(DASHBOARD_HTML, /expandAll/);
    assert.match(DASHBOARD_HTML, /collapseAll/);
    assert.match(DASHBOARD_HTML, /function setCollapsedForAll\(collapsed\)/);
    assert.match(DASHBOARD_HTML, /space\.querySelectorAll\("\.folder-block"\)/);
    assert.match(DASHBOARD_HTML, /setCollapsedForAll\(true\)/);
  });

  test("dashboard.html includes open tabs section and openTabs fallback", () => {
    assert.match(DASHBOARD_HTML, /<h2>Open Tabs<\/h2>/);
    assert.match(DASHBOARD_HTML, /id="openTabsList"/);
    assert.match(DASHBOARD_HTML, /function renderOpenTabs\(\)/);
    assert.match(DASHBOARD_HTML, /openTabs = data\.openTabs \|\| \[\]/);
    assert.match(DASHBOARD_HTML, /No open normal tabs\./);
  });

  test("dashboard.html includes Kagi quick actions and news highlights", () => {
    assert.match(DASHBOARD_HTML, /kagiResearchQuery/);
    assert.match(DASHBOARD_HTML, /kagiAssistantQuery/);
    assert.match(DASHBOARD_HTML, /buildKagiResearchUrl/);
    assert.match(DASHBOARD_HTML, /buildKagiAssistantUrl/);
    assert.match(DASHBOARD_HTML, /window\.location\.href = buildKagiResearchUrl\(query\)/);
    assert.match(DASHBOARD_HTML, /window\.location\.href = buildKagiAssistantUrl\(query\)/);
    assert.match(DASHBOARD_HTML, /Kagi News Highlights/);
    assert.match(DASHBOARD_HTML, /loadKagiNewsHighlights/);
    assert.match(DASHBOARD_HTML, /https:\/\/news\.kagi\.com\/world\.xml/);
    assert.match(DASHBOARD_HTML, /https:\/\/news\.kagi\.com\/tech\.xml/);
    assert.match(DASHBOARD_HTML, /https:\/\/news\.kagi\.com\/science\.xml/);
    assert.match(DASHBOARD_HTML, /https:\/\/news\.kagi\.com\/sports\.xml/);
    assert.match(DASHBOARD_HTML, /https:\/\/news\.kagi\.com\/gaming\.xml/);
    assert.match(DASHBOARD_HTML, /data-feed="world"/);
    assert.match(DASHBOARD_HTML, /data-feed="tech"/);
    assert.match(DASHBOARD_HTML, /data-feed="science"/);
    assert.match(DASHBOARD_HTML, /data-feed="sports"/);
    assert.match(DASHBOARD_HTML, /data-feed="gaming"/);
    assert.match(DASHBOARD_HTML, /setActiveKagiNewsTab\(activeKagiNewsFeed\)/);
    assert.match(DASHBOARD_HTML, /parseKagiPubDateMs/);
    assert.match(DASHBOARD_HTML, /\.sort\(function\(a, b\)/);
    assert.match(DASHBOARD_HTML, /\.slice\(0, 5\)/);
    assert.match(DASHBOARD_HTML, /Open Kagi News/);
  });

  test("dashboard.html shows world tab before tech tab", () => {
    const worldPos = DASHBOARD_HTML.indexOf('data-feed="world"');
    const techPos = DASHBOARD_HTML.indexOf('data-feed="tech"');
    assert.notEqual(worldPos, -1);
    assert.notEqual(techPos, -1);
    assert.ok(worldPos < techPos, "World feed tab should appear before Tech");
  });

  test("isConfigured reflects required SFTP prefs", () => {
    const { pub } = makePublishManager({
      preferences: {
        publishSftpHost: "host",
        publishSftpUser: "user",
        publishSftpRemoteDir: "/var/www/tabs",
      },
    });
    assert.equal(pub.isConfigured(), true);

    const { pub: pub2 } = makePublishManager({
      preferences: { publishSftpHost: "host", publishSftpUser: "" },
    });
    assert.equal(pub2.isConfigured(), false);
  });

  test("publishTabsToSftp returns config error when required settings are missing", async () => {
    const { pub } = makePublishManager({ preferences: {} });
    const result = await pub.publishTabsToSftp();

    assert.equal(result.success, false);
    assert.match(result.errors[0], /Missing SFTP configuration/);
  });

  test("buildSftpArgs includes host, user, port and optional key", () => {
    const { pub } = makePublishManager();
    const args = pub.buildSftpArgs(
      {
        host: "example.com",
        user: "alice",
        port: 2222,
        privateKeyPath: "/Users/alice/.ssh/id_ed25519",
      },
      "/tmp/upload.sftp"
    );

    assert.deepEqual(args, [
      "-P", "2222",
      "-i", "/Users/alice/.ssh/id_ed25519",
      "-b", "/tmp/upload.sftp",
      "alice@example.com",
    ]);
  });

  test("publishTabsToSftp writes files and reports success when runner succeeds", async () => {
    const tabs = [
      {
        title: "App",
        url: "https://app.local",
        type: "pinned",
        workspace: { name: "Work" },
        folderPath: ["Tools"],
        container: 1,
        lastAccessed: Date.now(),
      },
    ];
    const { mgr, pub } = makePublishManager({
      tabs,
      preferences: {
        publishSftpHost: "example.com",
        publishSftpPort: 2222,
        publishSftpUser: "alice",
        publishSftpRemoteDir: "/remote/site/tabs",
        publishSftpPrivateKeyPath: "/Users/alice/.ssh/id_ed25519",
        publishSftpDashboardTitle: "Team Tabs",
      },
    });

    let captured = null;
    mgr.window.ZenTabsProcessRunner = async (cmd, args) => {
      captured = { cmd, args };
      return { code: 0 };
    };

    // Seed the mock IOUtils with the real dashboard.html at the path
    // that _readDashboardHtml() will resolve from import.meta.url.
    const dashboardFilePath = fileURLToPath(new URL("../content/dashboard.html", import.meta.url));
    globalThis.IOUtils._store.set(dashboardFilePath, DASHBOARD_HTML);

    const result = await pub.publishTabsToSftp();

    assert.equal(result.success, true);
    assert.equal(result.generated.tabCount, 1);
    assert.equal(result.uploaded.json, true);
    assert.equal(result.uploaded.html, true);
    assert.ok(captured, "runner should be called");
    assert.equal(captured.cmd, "/usr/bin/sftp");

    const ioStore = globalThis.IOUtils._store;
    assert.ok([...ioStore.keys()].some(k => k.endsWith("/tabs.json")));
    assert.ok([...ioStore.keys()].some(k => k.endsWith("/index.html")));
    assert.ok([...ioStore.keys()].some(k => k.endsWith("/upload.sftp")));
  });

  test("publishTabsToSftp returns structured error when runner fails", async () => {
    const { mgr, pub } = makePublishManager({
      tabs: [],
      preferences: {
        publishSftpHost: "example.com",
        publishSftpUser: "alice",
        publishSftpRemoteDir: "/remote/site/tabs",
      },
    });

    mgr.window.ZenTabsProcessRunner = async () => {
      throw new Error("permission denied");
    };

    const dashboardFilePath = fileURLToPath(new URL("../content/dashboard.html", import.meta.url));
    globalThis.IOUtils._store.set(dashboardFilePath, DASHBOARD_HTML);

    const result = await pub.publishTabsToSftp();

    assert.equal(result.success, false);
    assert.equal(result.uploaded.json, false);
    assert.equal(result.uploaded.html, false);
    assert.match(result.errors.join(" "), /permission denied/);
  });
});
