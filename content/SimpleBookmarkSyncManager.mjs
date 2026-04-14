/**
 * SimpleBookmarkSyncManager — One-way tab → bookmark sync.
 *
 * Syncs only Essential and Pinned tabs from all Zen Spaces into a
 * `ZenTabs/` folder on the Bookmarks Toolbar.  No manifest, no diff —
 * full idempotent overwrite on every run.
 */

export class SimpleBookmarkSyncManager {
  constructor(manager) {
    this.manager = manager;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  async init() {
    this.log("SimpleBookmarkSyncManager initialized");
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Main entry point — full idempotent overwrite sync (tabs → bookmarks).
   * @returns {{ created: number, updated: number, deleted: number, errors: string[] }}
   */
  async syncTabsToBookmarks() {
    this.manager.dispatchEvent("simple-sync-started", {});
    const result = { created: 0, updated: 0, deleted: 0, errors: [] };

    try {
      const PlacesUtils = this.manager.window.PlacesUtils;

      // 1. Build desired bookmark tree from live tabs.
      const desiredRoot = await this.buildDesiredTree();

      // 2. Get or create the ZenTabs root folder on the toolbar.
      const rootGuid = await this._getOrCreateFolder(
        PlacesUtils.bookmarks.toolbarGuid,
        "ZenTabs"
      );

      // 3. Reconcile the desired tree against bookmarks.
      await this._reconcileFolder(rootGuid, desiredRoot.children, result);

      this.log(
        `Sync complete — created:${result.created} updated:${result.updated} deleted:${result.deleted}`
      );
      this.manager.dispatchEvent("simple-sync-completed", {
        created: result.created,
        updated: result.updated,
        deleted: result.deleted,
      });
    } catch (err) {
      console.error("[ZenTabs] SimpleBookmarkSyncManager sync error:", err);
      result.errors.push(String(err));
      this.manager.dispatchEvent("simple-sync-failed", { error: String(err) });
    }

    return result;
  }

  /**
   * Build an in-memory tree of the desired bookmark state from live tabs.
   * @returns {DesiredFolder}  Root node whose children are per-space folders.
   */
  async buildDesiredTree() {
    const win = this.manager.window;
    const allTabs = win.gZenWorkspaces?.allStoredTabs ?? win.gBrowser.tabs;

    // Group tabs by workspace UUID.
    const byWorkspace = new Map(); // uuid → { workspace, tabs: [] }

    for (const tab of allTabs) {
      if (tab.hasAttribute("zen-empty-tab")) continue;

      const type = this._getTabType(tab);
      if (type === "normal") continue; // not synced

      const wsId = tab.getAttribute("zen-workspace-id") ?? "default";

      if (!byWorkspace.has(wsId)) {
        const ws = win.gZenWorkspaces?.getWorkspaceFromId(wsId) ?? null;
        byWorkspace.set(wsId, { workspace: ws, wsId, tabs: [] });
      }
      byWorkspace.get(wsId).tabs.push(tab);
    }

    const rootChildren = [];

    for (const { workspace, wsId, tabs } of byWorkspace.values()) {
      const spaceName = workspace?.name ?? wsId;
      const containerTabId = workspace?.containerTabId ?? 0;

      const spaceFolder = this._buildSpaceSubtree(
        spaceName,
        containerTabId,
        tabs
      );
      if (spaceFolder === null) continue;
      rootChildren.push(spaceFolder);
    }

    return { type: "folder", title: "ZenTabs", children: rootChildren };
  }

  /**
   * Return the pinned/recorded URL for a pinned tab, never the live URL.
   */
  getPinnedUrl(tab) {
    const recorded = tab._zenPinnedInitialState?.entry?.url;
    if (recorded && !this._isBlankUrl(recorded)) return recorded;

    const lazy = this.manager.window.SessionStore?.getLazyTabValue?.(tab, "url");
    if (lazy && !this._isBlankUrl(lazy)) return lazy;

    const live = tab.linkedBrowser?.currentURI?.spec;
    return live ?? null;
  }

  /**
   * Return the URL for an essential tab.
   */
  getEssentialUrl(tab) {
    const lazy = this.manager.window.SessionStore?.getLazyTabValue?.(tab, "url");
    if (lazy && !this._isBlankUrl(lazy)) return lazy;

    const live = tab.linkedBrowser?.currentURI?.spec;
    return live ?? null;
  }

  /**
   * Return the Firefox container display name for `containerTabId`.
   * Returns "Essentials" for the default container (id === 0) or unknown.
   */
  getContainerName(containerTabId) {
    if (!containerTabId) return "Essentials";
    try {
      const svc = this.manager.window.ContextualIdentityService;
      const identity = svc?.getPublicIdentityFromId?.(containerTabId);
      return identity?.name ? `Essentials - ${identity.name}` : "Essentials";
    } catch (_) {
      return "Essentials";
    }
  }

  // ── Tree Building Helpers ─────────────────────────────────────────────────

  /**
   * Build the folder node for one Zen Space.
   * Returns null if the space has no syncable tabs with valid URLs.
   */
  _buildSpaceSubtree(spaceName, containerTabId, tabs) {
    const essentialTabs = tabs
      .filter(t => t.hasAttribute("zen-essential"))
      .sort((a, b) => a._tPos - b._tPos);

    const pinnedTabs = tabs
      .filter(t => t.pinned && !t.hasAttribute("zen-essential"))
      .sort((a, b) => a._tPos - b._tPos);

    const children = [];

    // ── Essentials folder ────────────────────────────────────────────────
    const essentialsBookmarks = [];
    for (const tab of essentialTabs) {
      const url = this.getEssentialUrl(tab);
      if (!url || this._isBlankUrl(url)) continue;
      essentialsBookmarks.push({
        type: "bookmark",
        title: this._getTabTitle(tab, url),
        url,
      });
    }
    if (essentialsBookmarks.length > 0) {
      const folderName = this.getContainerName(containerTabId);
      children.push({
        type: "folder",
        title: folderName,
        children: essentialsBookmarks,
      });
    }

    // ── Pinned tabs: group by Zen folder, then root-level ────────────────
    const pinnedChildren = this._buildPinnedSubtree(pinnedTabs);
    children.push(...pinnedChildren);

    if (children.length === 0) return null;

    return { type: "folder", title: spaceName, children };
  }

  /**
   * Given a sorted list of pinned tabs, build bookmark nodes organised by
   * Zen folder hierarchy.  Tabs with no group appear directly; tabs in a
   * group are nested under a folder named after the group.
   */
  _buildPinnedSubtree(pinnedTabs) {
    // We need to reproduce the visual structure:
    //   - A tab at the root of the space (no group) → bookmark entry
    //   - A tab inside a Zen folder → nested under a folder node
    //
    // We iterate in _tPos order and collect:
    //   rootItems: Array<DesiredBookmark | DesiredFolder>  (order matters)
    //   folderMap:  Map<groupLabel, DesiredFolder>

    // To preserve order we emit items in the order we first encounter them.
    // Folders are inserted at the position of their first contained tab.

    const rootItems = [];
    const foldersByLabel = new Map(); // label → { node: DesiredFolder, insertedAt: index }

    for (const tab of pinnedTabs) {
      const url = this.getPinnedUrl(tab);
      if (!url || this._isBlankUrl(url)) continue;

      const folderPath = this._getTabFolderPath(tab); // [] or [outer, inner, ...]

      if (!folderPath || folderPath.length === 0) {
        // Root-level pinned tab.
        rootItems.push({
          type: "bookmark",
          title: this._getTabTitle(tab, url),
          url,
        });
      } else {
        // Tab belongs to one or more nested Zen folders.
        // Navigate/create the folder chain, inserting at the root when first seen.
        let currentList = rootItems;
        let currentMap = foldersByLabel;

        for (let depth = 0; depth < folderPath.length; depth++) {
          const label = folderPath[depth];
          const mapKey = folderPath.slice(0, depth + 1).join("/");

          if (!currentMap.has(mapKey)) {
            const newFolder = { type: "folder", title: label, children: [] };
            currentList.push(newFolder);
            currentMap.set(mapKey, { node: newFolder, subFolders: new Map() });
          }

          const entry = currentMap.get(mapKey);
          currentList = entry.node.children;
          currentMap = entry.subFolders;
        }

        currentList.push({
          type: "bookmark",
          title: this._getTabTitle(tab, url),
          url,
        });
      }
    }

    return rootItems;
  }

  // ── Reconciliation ────────────────────────────────────────────────────────

  /**
   * Reconcile an existing bookmark folder against a desired list of children.
   * Creates missing items, updates changed titles, deletes stale items,
   * and enforces order.
   */
  async _reconcileFolder(parentGuid, desiredChildren, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    // Fetch existing children of this folder.
    const tree = await PlacesUtils.promiseBookmarksTree(parentGuid);
    const existing = tree?.children ?? [];

    // Split desired into bookmarks and folders for easier matching.
    // Matching: by URL for bookmarks, by title for folders.
    //
    // NOTE: promiseBookmarksTree returns integer types (5 = bookmark, 6 = folder),
    // not the string constants from PlacesUtils.bookmarks.TYPE_BOOKMARK/TYPE_FOLDER.
    // Detect by checking whether a `uri` field is present (bookmarks) or not (folders).
    const _isTreeBookmark = c => c.uri != null;
    const _isTreeFolder   = c => c.uri == null;

    // Build consumable pools of existing items.
    const existingBookmarks = existing.filter(_isTreeBookmark);
    const existingFolders   = existing.filter(_isTreeFolder);

    // Track which existing GUIDs we matched so we can delete the rest.
    const matched = new Set();

    // The ordered list of GUIDs we want to end up with (for reordering).
    const desiredGuids = [];

    for (const desired of desiredChildren) {
      if (desired.type === "bookmark") {
        const guid = await this._reconcileBookmark(
          parentGuid,
          desired,
          existingBookmarks,
          matched,
          result
        );
        if (guid) desiredGuids.push(guid);
      } else {
        const guid = await this._reconcileSubFolder(
          parentGuid,
          desired,
          existingFolders,
          matched,
          result
        );
        if (guid) desiredGuids.push(guid);
      }
    }

    // Delete stale items (not matched by any desired entry).
    for (const item of existing) {
      if (!matched.has(item.guid)) {
        try {
          await PlacesUtils.bookmarks.remove(item.guid);
          result.deleted++;
        } catch (e) {
          result.errors.push(`delete ${item.guid}: ${e.message}`);
        }
      }
    }

    // Enforce order: check if the current order of desiredGuids in the folder
    // matches what we want; if not, reorder using index updates.
    await this._enforceOrder(parentGuid, desiredGuids, result);
  }

  /**
   * Reconcile a single bookmark entry inside a folder.
   * Matches by URL (first available pool entry).  Returns the guid used.
   */
  async _reconcileBookmark(parentGuid, desired, existingPool, matched, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    // Find first unmatched existing bookmark with matching URL.
    // Tree nodes store the URL in `uri`, not `url`.
    const idx = existingPool.findIndex(
      b => !matched.has(b.guid) && b.uri === desired.url
    );

    if (idx !== -1) {
      const existing = existingPool[idx];
      matched.add(existing.guid);

      // Update title if it changed.
      if (existing.title !== desired.title) {
        try {
          await PlacesUtils.bookmarks.update({
            guid: existing.guid,
            title: desired.title,
          });
          result.updated++;
        } catch (e) {
          result.errors.push(`update title ${existing.guid}: ${e.message}`);
        }
      }
      return existing.guid;
    }

    // Not found — create it.
    try {
      const bm = await PlacesUtils.bookmarks.insert({
        parentGuid,
        type: PlacesUtils.bookmarks.TYPE_BOOKMARK,
        title: desired.title,
        url: desired.url,
      });
      result.created++;
      return bm.guid;
    } catch (e) {
      result.errors.push(`create bookmark ${desired.url}: ${e.message}`);
      return null;
    }
  }

  /**
   * Reconcile a subfolder, then recurse.  Returns the guid used.
   */
  async _reconcileSubFolder(parentGuid, desired, existingPool, matched, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    // Find first unmatched existing folder with matching title.
    const idx = existingPool.findIndex(
      f => !matched.has(f.guid) && f.title === desired.title
    );

    let folderGuid;

    if (idx !== -1) {
      const existing = existingPool[idx];
      matched.add(existing.guid);
      folderGuid = existing.guid;
    } else {
      // Create new folder.
      try {
        const folder = await PlacesUtils.bookmarks.insert({
          parentGuid,
          type: PlacesUtils.bookmarks.TYPE_FOLDER,
          title: desired.title,
        });
        result.created++;
        folderGuid = folder.guid;
      } catch (e) {
        result.errors.push(`create folder ${desired.title}: ${e.message}`);
        return null;
      }
    }

    // Recurse into the folder's children.
    await this._reconcileFolder(folderGuid, desired.children, result);
    return folderGuid;
  }

  /**
   * Enforce the order of `desiredGuids` inside the given parent folder.
   * Uses `PlacesUtils.bookmarks.update` to set the index of any item that
   * is out of position.
   */
  async _enforceOrder(parentGuid, desiredGuids, result) {
    if (desiredGuids.length === 0) return;

    const PlacesUtils = this.manager.window.PlacesUtils;

    // Re-fetch the current children to get their actual indices.
    const tree = await PlacesUtils.promiseBookmarksTree(parentGuid);
    const currentChildren = tree?.children ?? [];

    // Build a map of guid → current index.
    const currentIndex = new Map(currentChildren.map((c, i) => [c.guid, i]));

    for (let i = 0; i < desiredGuids.length; i++) {
      const guid = desiredGuids[i];
      if (currentIndex.get(guid) !== i) {
        try {
          await PlacesUtils.bookmarks.update({ guid, parentGuid, index: i });
          result.updated++;
        } catch (e) {
          result.errors.push(`reorder ${guid}: ${e.message}`);
        }
      }
    }
  }

  // ── Folder Management ────────────────────────────────────────────────────

  /**
   * Find-or-create a folder with `title` directly inside `parentGuid`.
   * Matches by title; returns the GUID of the folder.
   */
  async _getOrCreateFolder(parentGuid, title) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    const tree = await PlacesUtils.promiseBookmarksTree(parentGuid);
    // Tree nodes use integer types; detect folders by absent `uri` field.
    const existing = (tree?.children ?? []).find(
      c => c.uri == null && c.title === title
    );
    if (existing) return existing.guid;

    const folder = await PlacesUtils.bookmarks.insert({
      parentGuid,
      type: PlacesUtils.bookmarks.TYPE_FOLDER,
      title,
    });
    return folder.guid;
  }

  // ── Small Helpers ─────────────────────────────────────────────────────────

  _getTabType(tab) {
    if (tab.hasAttribute("zen-essential")) return "essential";
    if (tab.pinned) return "pinned";
    return "normal";
  }

  _getTabTitle(tab, url) {
    const label = tab.label || tab.getAttribute?.("label");
    if (label && label.trim()) return label.trim();
    // Fall back to hostname.
    try {
      return new URL(url).hostname || url;
    } catch (_) {
      return url;
    }
  }

  /**
   * Returns the Zen folder path for a tab as an array of folder names
   * from outermost to innermost, or null/[] if the tab is at the root.
   *
   * Uses `tab.group` traversal (mirrors TabManager.getFolderPath).
   */
  _getTabFolderPath(tab) {
    const path = [];
    let current = tab.group;
    while (current && current.isZenFolder) {
      path.unshift(current.label || "Unnamed Folder");
      current = current.group;
    }
    if (path.length > 0) return path;

    // Fall back to cached attribute (inactive space).
    const cached = tab.getAttribute?.("zentabs-folder-path");
    if (cached) return cached.split("/");
    return null;
  }

  _isBlankUrl(url) {
    if (!url) return true;
    const blank = new Set([
      "about:blank",
      "about:newtab",
      "about:privatebrowsing",
      "",
    ]);
    return blank.has(url);
  }

  log(...args) {
    this.manager.log("[SimpleSyncManager]", ...args);
  }
}
