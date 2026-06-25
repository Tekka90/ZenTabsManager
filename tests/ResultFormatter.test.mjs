/**
 * ResultFormatter unit tests
 *
 * Run with: node --test tests/ResultFormatter.test.mjs
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRestoreDryRunResult,
  buildSyncSummaryResult,
  buildSyncDryRunResult,
  buildRestoreSummaryResult,
  buildCleanupSummaryResult,
  buildMemorySummaryResult,
  buildStatisticsResult,
  buildErrorResult,
} from "../content/ResultFormatter.mjs";

describe("buildRestoreDryRunResult", () => {
  test("includes counts and only changing plan entries", () => {
    const result = buildRestoreDryRunResult({
      created: 2,
      updated: 1,
      deleted: 1,
      errors: [],
      plan: [
        { action: "create-tab", description: "create a" },
        { action: "noop", description: "should not show" },
        { action: "reorder-tab", description: "reorder a" },
      ],
    });

    assert.equal(result.summary.find((s) => s.label === "Created")?.value, 2);
    assert.equal(result.summary.find((s) => s.label === "Updated")?.value, 1);
    assert.equal(result.sections?.[0]?.rows?.length, 2);
    assert.deepEqual(
      result.sections?.[0]?.rows?.map((r) => r.Action),
      ["create-tab", "reorder-tab"]
    );
  });

  test("shows no changes needed when plan is empty", () => {
    const result = buildRestoreDryRunResult({
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [],
      plan: [],
    });

    assert.equal(result.emptyState, "No changes needed.");
    assert.equal(result.sections?.[0]?.rows?.length, 0);
  });
});

describe("summary formatters", () => {
  test("sync and restore summary use created/updated/deleted/errors", () => {
    const source = { created: 3, updated: 4, deleted: 1, errors: ["x", "y"] };

    const sync = buildSyncSummaryResult(source);
    const restore = buildRestoreSummaryResult(source);

    assert.equal(sync.summary.find((s) => s.label === "Created")?.value, 3);
    assert.equal(sync.summary.find((s) => s.label === "Updated")?.value, 4);
    assert.equal(sync.summary.find((s) => s.label === "Deleted")?.value, 1);
    assert.equal(sync.summary.find((s) => s.label === "Errors")?.value, 2);

    assert.equal(restore.summary.find((s) => s.label === "Created")?.value, 3);
    assert.equal(restore.summary.find((s) => s.label === "Errors")?.value, 2);
  });
});

describe("buildSyncDryRunResult", () => {
  test("renders summary and includes only change entries", () => {
    const result = buildSyncDryRunResult({
      created: 1,
      updated: 2,
      deleted: 3,
      errors: [],
      plan: [
        { action: "create-folder", description: "Create folder A" },
        { action: "update-bookmark-title", description: "Update title" },
        { action: "noop", description: "Ignore" },
      ],
    });

    assert.equal(result.summary.find((s) => s.label === "Created")?.value, 1);
    assert.equal(result.summary.find((s) => s.label === "Updated")?.value, 2);
    assert.equal(result.sections?.[0]?.rows?.length, 2);
    assert.deepEqual(
      result.sections?.[0]?.rows?.map((r) => r.Action),
      ["create-folder", "update-bookmark-title"]
    );
  });

  test("shows no changes needed when plan has no change entries", () => {
    const result = buildSyncDryRunResult({
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [],
      plan: [{ action: "noop", description: "Nothing" }],
    });

    assert.equal(result.emptyState, "No changes needed.");
    assert.equal(result.sections?.[0]?.rows?.length, 0);
  });
});

describe("buildCleanupSummaryResult", () => {
  test("includes closed tab details when present", () => {
    const result = buildCleanupSummaryResult({
      checked: 5,
      closed: 2,
      skipped: 1,
      protected: 1,
      excluded: 1,
      tabs: [
        { title: "A", url: "https://a.test", age: 12 },
        { title: "B", url: "https://b.test", age: 8 },
      ],
    });

    assert.equal(result.summary.find((s) => s.label === "Closed")?.value, 2);
    assert.equal(result.sections?.length, 1);
    assert.equal(result.sections?.[0]?.rows?.length, 2);
    assert.equal(result.sections?.[0]?.rows?.[0]?.Title, "A");
  });

  test("renders preview labels and empty state in dry run", () => {
    const result = buildCleanupSummaryResult({
      dryRun: true,
      checked: 3,
      closed: 0,
      skipped: 3,
      protected: 0,
      excluded: 0,
      tabs: [],
    });

    assert.equal(result.title, "ZenTabs - Cleanup Preview");
    assert.equal(result.mode, "cleanup-preview");
    assert.equal(result.summary.find((s) => s.label === "WouldClose")?.value, 0);
    assert.equal(result.emptyState, "No tabs would be closed.");
  });
});

describe("buildMemorySummaryResult", () => {
  test("includes unloaded tab details when present", () => {
    const result = buildMemorySummaryResult({
      checked: 10,
      unloaded: 3,
      alreadyUnloaded: 2,
      protected: 1,
      saved: 150,
      tabs: [
        { title: "X", age: 20 },
        { title: "Y", age: 18 },
      ],
    });

    assert.equal(result.summary.find((s) => s.label === "Unloaded")?.value, 3);
    assert.equal(result.summary.find((s) => s.label === "SavedMB")?.value, 150);
    assert.equal(result.sections?.[0]?.rows?.length, 2);
  });

  test("renders preview labels in dry run", () => {
    const result = buildMemorySummaryResult({
      dryRun: true,
      checked: 4,
      unloaded: 2,
      alreadyUnloaded: 1,
      saved: 100,
      tabs: [
        { title: "A", age: 9 },
        { title: "B", age: 5 },
      ],
    });

    assert.equal(result.title, "ZenTabs - Optimize Memory Preview");
    assert.equal(result.mode, "memory-preview");
    assert.equal(result.summary.find((s) => s.label === "WouldUnload")?.value, 2);
    assert.equal(result.sections?.[0]?.heading, "Tabs To Unload");
  });
});

describe("buildStatisticsResult", () => {
  test("includes tab totals and memory usage fields", () => {
    const result = buildStatisticsResult({
      stats: {
        total: 12,
        byType: { essential: 3, pinned: 4, normal: 5 },
        byState: { loaded: 10, pending: 2 },
        memorySavings: 200,
        folders: 2,
        inFolders: 4,
        workspaces: 3,
      },
      memoryInfo: { percentUsed: 67 },
    });

    assert.equal(result.summary.find((s) => s.label === "Total")?.value, 12);
    assert.equal(result.summary.find((s) => s.label === "MemoryUsagePercent")?.value, 67);
    const states = result.sections?.find((s) => s.heading === "States")?.rows ?? [];
    assert.deepEqual(states.map((r) => r.State), ["loaded", "pending"]);
  });
});

describe("buildErrorResult", () => {
  test("creates stable error payload", () => {
    const result = buildErrorResult("ZenTabs - Example", new Error("boom"));
    assert.equal(result.title, "ZenTabs - Example");
    assert.equal(result.mode, "error");
    assert.equal(result.summary[0].label, "Error");
    assert.equal(result.summary[0].value, "boom");
  });
});
