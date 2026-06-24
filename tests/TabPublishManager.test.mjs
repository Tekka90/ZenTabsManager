import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { TabPublishManager } from "../content/TabPublishManager.mjs";
import { makeManager } from "./helpers/mocks.mjs";

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
  test("buildTabsPayload includes stats and normalized tab fields", () => {
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
    assert.equal(payload.tabs[0].folder, "Ops/Inbox");
  });

  test("buildDashboardHtml contains fetch to tabs.json and page title", () => {
    const { pub } = makePublishManager();
    const html = pub.buildDashboardHtml("My Dashboard");
    assert.match(html, /<title>My Dashboard<\/title>/);
    assert.match(html, /fetch\("\.\/tabs\.json"/);
    assert.match(html, /Search title\/url\/folder/);
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

    const result = await pub.publishTabsToSftp();

    assert.equal(result.success, false);
    assert.equal(result.uploaded.json, false);
    assert.equal(result.uploaded.html, false);
    assert.match(result.errors.join(" "), /permission denied/);
  });
});
