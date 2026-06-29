import { describe, test } from "node:test";
import assert from "node:assert/strict";

globalThis.dump = () => {};

const fakeEnumerator = {
  hasMoreElements() {
    return false;
  },
  getNext() {
    return null;
  },
};

globalThis.Services = {
  wm: {
    addListener() {},
    getEnumerator() {
      return fakeEnumerator;
    },
  },
};

const { ZenTabsManager } = await import("../engine/zen.sys.mjs");

function makeWindowHarness() {
  let nextId = 1;
  const scheduled = new Map();
  const cleared = [];
  return {
    window: {
      setInterval(fn, ms) {
        const id = nextId++;
        scheduled.set(id, { fn, ms });
        return id;
      },
      clearInterval(id) {
        cleared.push(id);
        scheduled.delete(id);
      },
    },
    scheduled,
    cleared,
  };
}

function makeManagerForBackgroundTests() {
  const manager = new ZenTabsManager();
  const harness = makeWindowHarness();

  manager.window = harness.window;
  manager.cleanupManager = {
    runCleanup() {},
    checkMemoryUsage() {},
    unloadStaleTabs() {},
  };
  manager.tabPublishManager = {
    async publishTabsToSftp() {
      return { success: true };
    },
  };

  manager.preferences = {
    paused: false,
    cleanupEnabled: true,
    memoryOptimization: true,
    autoUnloadEnabled: true,
    publishAutoEnabled: true,
    publishAutoIntervalMinutes: 30,
  };

  return { manager, harness };
}

describe("ZenTabsManager background scheduling", () => {
  test("startBackgroundTasks schedules nothing while paused", () => {
    const { manager, harness } = makeManagerForBackgroundTests();
    manager.preferences.paused = true;

    manager.startBackgroundTasks();

    assert.equal(harness.scheduled.size, 0);
    assert.equal(manager.cleanupInterval, null);
    assert.equal(manager.memoryInterval, null);
    assert.equal(manager.autoUnloadInterval, null);
    assert.equal(manager.publishInterval, null);
  });

  test("pause clears all running intervals including auto-publish", () => {
    const { manager, harness } = makeManagerForBackgroundTests();

    manager.startBackgroundTasks();
    assert.equal(harness.scheduled.size, 4);

    manager.pause();

    assert.equal(harness.scheduled.size, 0);
    assert.equal(manager.cleanupInterval, null);
    assert.equal(manager.memoryInterval, null);
    assert.equal(manager.autoUnloadInterval, null);
    assert.equal(manager.publishInterval, null);
    assert.ok(harness.cleared.length >= 4);
  });

  test("startBackgroundTasks is idempotent and does not duplicate intervals", () => {
    const { manager, harness } = makeManagerForBackgroundTests();

    manager.startBackgroundTasks();
    const firstIds = [
      manager.cleanupInterval,
      manager.memoryInterval,
      manager.autoUnloadInterval,
      manager.publishInterval,
    ];
    assert.equal(harness.scheduled.size, 4);

    manager.startBackgroundTasks();
    const secondIds = [
      manager.cleanupInterval,
      manager.memoryInterval,
      manager.autoUnloadInterval,
      manager.publishInterval,
    ];

    assert.equal(harness.scheduled.size, 4);
    assert.notDeepEqual(secondIds, firstIds);
  });
});
