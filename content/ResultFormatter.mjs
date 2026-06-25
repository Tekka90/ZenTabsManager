function toInt(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function toStringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function buildTabsListResult({ tabs = [], stats = {} } = {}) {
  const byType = stats.byType ?? {};
  const rows = tabs.map((tab) => {
    const age = tab.lastAccessedAge ?? {};
    const workspaceName = tab.workspace?.name ?? "default";
    const folder = Array.isArray(tab.folderPath) && tab.folderPath.length > 0
      ? tab.folderPath.join(" / ")
      : "";
    return {
      Title: toStringValue(tab.title),
      Type: toStringValue(tab.type),
      Workspace: toStringValue(workspaceName),
      Folder: folder,
      URL: toStringValue(tab.url),
      Age: `${toInt(age.days)}d ${toInt(age.hours) % 24}h`,
    };
  });

  return {
    title: "ZenTabs - List All Tabs",
    mode: "tabs-list",
    timestamp: new Date().toISOString(),
    summary: [
      { label: "Total", value: toInt(stats.total, tabs.length) },
      { label: "Essential", value: toInt(byType.essential) },
      { label: "Pinned", value: toInt(byType.pinned) },
      { label: "Normal", value: toInt(byType.normal) },
      { label: "Folders", value: toInt(stats.folders) },
      { label: "Workspaces", value: toInt(stats.workspaces) },
    ],
    sections: [
      {
        heading: "Tabs",
        rows,
      },
    ],
  };
}

function makeResultSummary(result = {}) {
  return [
    { label: "Created", value: toInt(result.created) },
    { label: "Updated", value: toInt(result.updated) },
    { label: "Deleted", value: toInt(result.deleted) },
    { label: "Errors", value: Array.isArray(result.errors) ? result.errors.length : 0 },
  ];
}

export function buildSyncSummaryResult(result = {}) {
  return {
    title: "ZenTabs - Sync To Bookmarks",
    mode: "sync-summary",
    timestamp: new Date().toISOString(),
    summary: makeResultSummary(result),
  };
}

export function buildSyncDryRunResult(result = {}) {
  const plan = Array.isArray(result.plan) ? result.plan : [];
  const changes = plan.filter((entry) => {
    const action = toStringValue(entry.action);
    return (
      action.startsWith("create-") ||
      action.startsWith("update-") ||
      action.startsWith("delete-") ||
      action.startsWith("reorder-") ||
      action.startsWith("rename-")
    );
  });

  return {
    title: "ZenTabs - Sync To Bookmarks Dry Run",
    mode: "sync-dry-run",
    timestamp: new Date().toISOString(),
    summary: makeResultSummary(result),
    sections: [
      {
        heading: "Planned Bookmark Changes",
        rows: changes.map((entry) => ({
          Action: toStringValue(entry.action),
          Description: toStringValue(entry.description),
        })),
      },
    ],
    emptyState: changes.length === 0 ? "No changes needed." : "",
  };
}

export function buildRestoreSummaryResult(result = {}) {
  return {
    title: "ZenTabs - Restore From Bookmarks",
    mode: "restore-summary",
    timestamp: new Date().toISOString(),
    summary: makeResultSummary(result),
  };
}

function isChangingDryRunAction(action) {
  const value = toStringValue(action);
  return (
    value.startsWith("create-") ||
    value.startsWith("delete-") ||
    value.startsWith("reorder-")
  );
}

export function buildRestoreDryRunResult(result = {}) {
  const plan = Array.isArray(result.plan) ? result.plan : [];
  const changes = plan.filter((entry) => isChangingDryRunAction(entry.action));

  return {
    title: "ZenTabs - Restore Dry Run",
    mode: "restore-dry-run",
    timestamp: new Date().toISOString(),
    summary: makeResultSummary(result),
    sections: [
      {
        heading: "Planned Changes",
        rows: changes.map((entry) => ({
          Action: toStringValue(entry.action),
          Description: toStringValue(entry.description),
        })),
      },
    ],
    emptyState: changes.length === 0 ? "No changes needed." : "",
  };
}

export function buildCleanupSummaryResult(result = {}) {
  const isDryRun = !!result.dryRun;
  const rows = Array.isArray(result.tabs)
    ? result.tabs.map((tab) => ({
        Title: toStringValue(tab.title),
        URL: toStringValue(tab.url),
        AgeDays: toInt(tab.age),
      }))
    : [];

  return {
    title: isDryRun ? "ZenTabs - Cleanup Preview" : "ZenTabs - Cleanup Old Tabs",
    mode: isDryRun ? "cleanup-preview" : "cleanup-summary",
    timestamp: new Date().toISOString(),
    summary: [
      { label: "Checked", value: toInt(result.checked) },
      { label: isDryRun ? "WouldClose" : "Closed", value: toInt(result.closed) },
      { label: "Skipped", value: toInt(result.skipped) },
      { label: "Protected", value: toInt(result.protected) },
      { label: "Excluded", value: toInt(result.excluded) },
    ],
    sections: rows.length > 0
      ? [{ heading: isDryRun ? "Tabs To Close" : "Closed Tabs", rows }]
      : [],
    emptyState: isDryRun && rows.length === 0 ? "No tabs would be closed." : "",
  };
}

export function buildMemorySummaryResult(result = {}) {
  const isDryRun = !!result.dryRun;
  const rows = Array.isArray(result.tabs)
    ? result.tabs.map((tab) => ({
        Title: toStringValue(tab.title),
        AgeDays: toInt(tab.age),
      }))
    : [];

  return {
    title: isDryRun ? "ZenTabs - Optimize Memory Preview" : "ZenTabs - Optimize Memory",
    mode: isDryRun ? "memory-preview" : "memory-summary",
    timestamp: new Date().toISOString(),
    summary: [
      { label: "Checked", value: toInt(result.checked ?? result.optimized) },
      { label: isDryRun ? "WouldUnload" : "Unloaded", value: toInt(result.unloaded) },
      { label: "AlreadyUnloaded", value: toInt(result.alreadyUnloaded) },
      { label: "SavedMB", value: toInt(result.saved) },
    ],
    sections: rows.length > 0
      ? [{ heading: isDryRun ? "Tabs To Unload" : "Unloaded Tabs", rows }]
      : [],
    emptyState: isDryRun && rows.length === 0 ? "No tabs would be unloaded." : "",
  };
}

export function buildStatisticsResult({ stats = {}, memoryInfo = {} } = {}) {
  const byType = stats.byType ?? {};
  const byState = stats.byState ?? {};

  return {
    title: "ZenTabs - Statistics",
    mode: "statistics",
    timestamp: new Date().toISOString(),
    summary: [
      { label: "Total", value: toInt(stats.total) },
      { label: "Essential", value: toInt(byType.essential) },
      { label: "Pinned", value: toInt(byType.pinned) },
      { label: "Normal", value: toInt(byType.normal) },
      { label: "MemoryUsagePercent", value: toInt(memoryInfo.percentUsed) },
      { label: "EstimatedSavingsMB", value: toInt(stats.memorySavings) },
    ],
    sections: [
      {
        heading: "Tab Breakdown",
        rows: [
          {
            Folders: toInt(stats.folders),
            InFolders: toInt(stats.inFolders),
            Workspaces: toInt(stats.workspaces),
          },
        ],
      },
      {
        heading: "States",
        rows: Object.entries(byState).map(([state, count]) => ({
          State: toStringValue(state),
          Count: toInt(count),
        })),
      },
    ],
  };
}

export function buildErrorResult(title, error) {
  return {
    title,
    mode: "error",
    timestamp: new Date().toISOString(),
    summary: [{ label: "Error", value: formatErrorMessage(error) }],
    sections: [],
  };
}
