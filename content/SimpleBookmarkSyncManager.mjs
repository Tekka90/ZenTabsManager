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
    const result = { created: 0, updated: 0, deleted: 0, errors: [],
      details: { titleUpdates: 0, reorders: 0, metadataUpdates: 0, folderCreates: 0, bookmarkCreates: 0 } };

    try {
      const PlacesUtils = this.manager.window.PlacesUtils;
      const win = this.manager.window;

      // 1. Build desired bookmark tree from live tabs.
      const desiredRoot = await this.buildDesiredTree();

      // 2. Get or create the ZenTabs root folder on the toolbar.
      const rootGuid = await this._getOrCreateFolder(
        PlacesUtils.bookmarks.toolbarGuid,
        "ZenTabs"
      );

      // 3. Get live spaces for rename detection and metadata sync.
      const liveSpaces = win.gZenWorkspaces?.getWorkspaces() ?? [];

      // 4. Detect and apply renames before reconciling content.
      await this._detectAndApplyRenames(rootGuid, liveSpaces, result);

      // 5. Reconcile the desired tree against bookmarks.
      await this._reconcileFolder(rootGuid, desiredRoot.children, result);

      // 6. Sync space metadata (icon, theme) after content.
      const syncedSpaces = liveSpaces.map(ws => ({
        name: ws.name,
        icon: ws.icon ?? null,
        theme: ws.theme ?? {},
      }));
      await this._syncSpaceMetadata(rootGuid, syncedSpaces, result);

      this.log(
        `Sync complete — created:${result.created} updated:${result.updated} deleted:${result.deleted}`,
        `| breakdown: titleUpdates=${result.details.titleUpdates} reorders=${result.details.reorders} metadataUpdates=${result.details.metadataUpdates}`
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

    // Group tabs by workspace ID (UUID used only as a transient in-memory key —
    // never stored in bookmarks; the stable key written to disk is the space name).
    const byWorkspace = new Map(); // wsId → { workspace, tabs: [] }

    for (const tab of allTabs) {
      if (tab.hasAttribute("zen-empty-tab")) continue;

      const type = this._getTabType(tab);
      if (type === "normal") continue; // not synced

      const wsId = tab.getAttribute("zen-workspace-id");
      // Skip tabs with no space assignment — they are transient/system tabs
      // that don't belong to any Zen Space and should not appear in sync output.
      if (!wsId) continue;

      if (!byWorkspace.has(wsId)) {
        const ws = win.gZenWorkspaces?.getWorkspaceFromId(wsId) ?? null;
        // Skip if the space no longer exists in the browser.
        if (!ws) continue;
        byWorkspace.set(wsId, { workspace: ws, wsId, tabs: [] });
      }
      byWorkspace.get(wsId).tabs.push(tab);
    }

    const rootChildren = [];

    for (const { workspace, tabs } of byWorkspace.values()) {
      const spaceName = workspace.name;
      const containerTabId = workspace.containerTabId ?? 0;

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
    if (live && !this._isBlankUrl(live)) return live;

    // Lazy/inactive tabs: Zen's ZenSessionManager stores the URL in
    // __SS_data on the browser element when a tab is unloaded or in an
    // inactive space.
    try {
      const ssData = tab.linkedBrowser?.__SS_data;
      if (ssData) {
        const entries = ssData.tabData?.entries ?? ssData.entries ?? [];
        const last = entries[entries.length - 1];
        if (last?.url && !this._isBlankUrl(last.url) &&
            !last.url.startsWith("chrome:")) {
          return last.url;
        }
      }
    } catch (_) { /* non-fatal */ }

    // Tabs created by syncBookmarksToTabs store the intended URL in a
    // zentabs-pending-url attribute so matching works even before the tab
    // has loaded or the session manager has persisted it.
    const pending = tab.getAttribute?.("zentabs-pending-url");
    if (pending && !this._isBlankUrl(pending)) return pending;

    return live ?? null;
  }

  /**
   * Return the URL for an essential tab.
   * Essential tabs are pinned, so use the same recorded-URL logic.
   */
  getEssentialUrl(tab) {
    return this.getPinnedUrl(tab);
  }

  /**
   * Return the Firefox container display name for `containerTabId`.
   * Returns "Essentials" for the default container (id === 0) or when the
   * identity cannot be resolved.
   *
   * ContextualIdentityService is placed on window by zen.sys.mjs during init
   * (same pattern used by SyncManager).
   */
  getContainerName(containerTabId) {
    if (!containerTabId) return "Essentials";
    try {
      const svc = this.manager.window.ContextualIdentityService;
      const identity = svc?.getPublicIdentityFromId?.(containerTabId);
      if (!identity) return "Essentials";
      // Custom containers have `name`; built-in ones (Personal, Work, etc.)
      // have `l10nId` like "user-context-personal" but no `name` field.
      const label = identity.name ||
        (identity.l10nId
          ? identity.l10nId
              .replace(/^user-context-/, "")
              .replace(/^./, c => c.toUpperCase())
          : null);
      return label ? `Essentials - ${label}` : "Essentials";
    } catch (e) {
      console.error("[ZenTabs] getContainerName failed for id", containerTabId, e);
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
      if (matched.has(item.guid)) continue;
      // Skip the __spaces__ metadata folder — managed separately by _syncSpaceMetadata().
      if (item.uri == null && item.title === "__spaces__") continue;
      try {
        await PlacesUtils.bookmarks.remove(item.guid);
        result.deleted++;
      } catch (e) {
        result.errors.push(`delete ${item.guid}: ${e.message}`);
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
          result.details.titleUpdates++;
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
      result.details.bookmarkCreates++;
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
        result.details.folderCreates++;
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
          result.details.reorders++;
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

  // ── Space Rename Detection ───────────────────────────────────────────────

  /**
   * Before reconciling folder content, detect spaces that were renamed
   * (vs. deleted+new) using Jaccard URL-set similarity.
   * Applies renames in-place so the subsequent reconcile sees correct titles.
   */
  async _detectAndApplyRenames(rootGuid, liveSpaces, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    const tree = await PlacesUtils.promiseBookmarksTree(rootGuid);
    const existingFolders = (tree?.children ?? []).filter(
      c => c.uri == null && c.title !== "__spaces__"
    );

    const knownNames = new Set(existingFolders.map(f => f.title));
    const liveNames  = new Set(liveSpaces.map(ws => ws.name));

    const removed = [...knownNames].filter(n => !liveNames.has(n));
    const added   = [...liveNames].filter(n => !knownNames.has(n));

    if (removed.length === 0 || added.length === 0) return;

    const win = this.manager.window;
    const allTabs = win.gZenWorkspaces?.allStoredTabs ?? win.gBrowser.tabs;

    // Build URL sets for each "added" (new-name) space from live tabs.
    // ws.uuid is used here only as a transient runtime key (the only Zen API
    // available to map a tab to its space).  It is never written to bookmarks.
    const liveUrlsByName = new Map();
    for (const ws of liveSpaces) {
      if (!added.includes(ws.name)) continue;
      const urls = new Set();
      for (const tab of allTabs) {
        if (tab.getAttribute("zen-workspace-id") !== ws.uuid) continue;
        const type = this._getTabType(tab);
        if (type === "normal") continue;
        const url = type === "pinned"
          ? this.getPinnedUrl(tab)
          : this.getEssentialUrl(tab);
        if (url && !this._isBlankUrl(url)) urls.add(url);
      }
      liveUrlsByName.set(ws.name, urls);
    }

    // Build URL sets for each "removed" (old-name) space from existing bookmarks.
    const bookmarkUrlsByName = new Map();
    for (const name of removed) {
      const folder = existingFolders.find(f => f.title === name);
      if (!folder) continue;
      const urls = await this._collectBookmarkUrls(folder.guid);
      bookmarkUrlsByName.set(name, urls);
    }

    // Score all (removed, added) pairs and sort by similarity descending.
    const pairs = [];
    for (const rName of removed) {
      for (const aName of added) {
        const A = bookmarkUrlsByName.get(rName) ?? new Set();
        const B = liveUrlsByName.get(aName)    ?? new Set();
        pairs.push({ rName, aName, sim: this._jaccard(A, B) });
      }
    }
    pairs.sort((a, b) => b.sim - a.sim);

    // Greedy assignment: highest-similarity pair first.
    const usedRemoved = new Set();
    const usedAdded   = new Set();
    for (const { rName, aName, sim } of pairs) {
      if (usedRemoved.has(rName) || usedAdded.has(aName)) continue;
      if (sim >= 0.5) {
        usedRemoved.add(rName);
        usedAdded.add(aName);
        await this._renameSpaceInBookmarks(
          rootGuid, rName, aName, existingFolders, result
        );
      }
      // sim < 0.5 → treat as delete + new (handled by reconcile naturally).
    }
  }

  /**
   * Recursively collect all bookmark URLs inside a folder.
   */
  async _collectBookmarkUrls(folderGuid) {
    const PlacesUtils = this.manager.window.PlacesUtils;
    const tree = await PlacesUtils.promiseBookmarksTree(folderGuid);
    const urls = new Set();
    const collect = (children) => {
      for (const child of children ?? []) {
        if (child.uri != null) {
          urls.add(child.uri);
        } else {
          collect(child.children);
        }
      }
    };
    collect(tree?.children);
    return urls;
  }

  /**
   * Return the Jaccard similarity between two URL sets.
   * Returns 0 when both sets are empty (undefined case treated as no match).
   */
  _jaccard(A, B) {
    if (A.size === 0 && B.size === 0) return 0;
    let intersection = 0;
    for (const u of A) { if (B.has(u)) intersection++; }
    const union = new Set([...A, ...B]).size;
    return union === 0 ? 0 : intersection / union;
  }

  /**
   * Rename a space folder and its metadata bookmark from `oldName` to `newName`.
   */
  async _renameSpaceInBookmarks(rootGuid, oldName, newName, existingFolders, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    // Rename the content folder.
    const folder = existingFolders.find(f => f.title === oldName);
    if (folder) {
      try {
        await PlacesUtils.bookmarks.update({ guid: folder.guid, title: newName });
        result.updated++;
      } catch (e) {
        result.errors.push(`rename folder ${oldName}→${newName}: ${e.message}`);
      }
    }

    // Rename the metadata bookmark inside __spaces__/ if it exists.
    try {
      const rootTree  = await PlacesUtils.promiseBookmarksTree(rootGuid);
      const metaEntry = (rootTree?.children ?? []).find(
        c => c.uri == null && c.title === "__spaces__"
      );
      if (metaEntry) {
        const metaTree = await PlacesUtils.promiseBookmarksTree(metaEntry.guid);
        const metaBm   = (metaTree?.children ?? []).find(
          c => c.uri != null && c.title === oldName
        );
        if (metaBm) {
          await PlacesUtils.bookmarks.update({ guid: metaBm.guid, title: newName });
          result.updated++;
        }
      }
    } catch (e) {
      result.errors.push(`rename metadata ${oldName}→${newName}: ${e.message}`);
    }
  }

  // ── Space Metadata Sync ──────────────────────────────────────────────────

  /**
   * Upsert one metadata bookmark per space into the __spaces__/ folder.
   * syncedSpaces: Array<{ name, icon, theme }>
   */
  async _syncSpaceMetadata(rootGuid, syncedSpaces, result) {
    const PlacesUtils = this.manager.window.PlacesUtils;

    const metaFolderGuid = await this._getOrCreateFolder(rootGuid, "__spaces__");

    const tree     = await PlacesUtils.promiseBookmarksTree(metaFolderGuid);
    const existing = tree?.children ?? [];

    const matched = new Set();

    for (const space of syncedSpaces) {
      const encoded  = this._encodeSpaceMetadata(space);
      const existing_ = existing.find(c => c.uri != null && c.title === space.name);

      if (existing_) {
        matched.add(existing_.guid);
        if (existing_.uri !== encoded) {
          try {
            await PlacesUtils.bookmarks.update({ guid: existing_.guid, url: encoded });
            result.updated++;
            result.details.metadataUpdates++;
          } catch (e) {
            result.errors.push(`update metadata ${space.name}: ${e.message}`);
          }
        }
      } else {
        try {
          await PlacesUtils.bookmarks.insert({
            parentGuid: metaFolderGuid,
            type:       PlacesUtils.bookmarks.TYPE_BOOKMARK,
            title:      space.name,
            url:        encoded,
          });
          result.created++;
        } catch (e) {
          result.errors.push(`create metadata ${space.name}: ${e.message}`);
        }
      }
    }

    // Delete stale metadata bookmarks.
    for (const item of existing) {
      if (!matched.has(item.guid)) {
        try {
          await PlacesUtils.bookmarks.remove(item.guid);
          result.deleted++;
        } catch (e) {
          result.errors.push(`delete metadata ${item.title}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Encode space metadata as a data: URI containing URL-encoded JSON.
   */
  _encodeSpaceMetadata({ name, icon, theme }) {
    const payload = { v: 1, name, icon: icon ?? null, theme: theme ?? {} };
    return "data:application/json," + encodeURIComponent(JSON.stringify(payload));
  }

  // ── Bookmarks → Tabs Sync ─────────────────────────────────────────────────

  /**
   * Main entry point — full idempotent overwrite sync (bookmarks → tabs).
   *
   * @param {{ dryRun?: boolean }} opts
   * @returns {Promise<{ created: number, updated: number, deleted: number, errors: string[], plan?: Array }>}
   *   When dryRun:true, `plan` is an array of PlanEntry objects describing
   *   every action that would have been taken; no browser state is mutated.
   */
  async syncBookmarksToTabs({ dryRun = false } = {}) {
    this.manager.dispatchEvent("simple-restore-started", {});
    const result = { created: 0, updated: 0, deleted: 0, errors: [] };
    if (dryRun) result.plan = [];

    /**
     * Helper: record a plan entry (always) and return whether execution
     * should proceed (true = live, false = dry-run / skip).
     * When dry-run, also increments `result[counterKey]` so counters stay
     * accurate without executing.
     */
    const dryRecord = (counterKey, action, description, extras = {}) => {
      if (dryRun) {
        result.plan.push({ action, description, ...extras });
        this.log("[DryRun]", description);
        if (counterKey) result[counterKey]++;
        return false; // skip execution
      }
      return true; // proceed with execution
    };

    try {
      const PlacesUtils = this.manager.window.PlacesUtils;
      const win = this.manager.window;

      // 1. Locate ZenTabs/ on the Bookmarks Toolbar.
      const toolbarTree = await PlacesUtils.promiseBookmarksTree(
        PlacesUtils.bookmarks.toolbarGuid
      );
      const zenTabsEntry = (toolbarTree?.children ?? []).find(
        c => c.uri == null && c.title === "ZenTabs"
      );
      if (!zenTabsEntry) {
        this.log("syncBookmarksToTabs: ZenTabs/ folder not found — nothing to restore.");
        return result;
      }

      // 2. Read space icon/theme metadata from __spaces__/.
      const spaceMetadata = await this.readSpaceMetadata();

      // 3. Parse the bookmark tree into structured space descriptors.
      //    Fetch the ZenTabs tree by its own GUID.
      const zenTabsTree = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);

      const spaceFolders = this._parseBookmarkTree(zenTabsTree);

      // 4. Find or create each Zen Space.
      const spaceMap = new Map(); // spaceName → workspace object
      for (const sf of spaceFolders) {
        const ws = await this._findOrCreateSpace(sf.name, spaceMetadata, dryRecord, result);
        if (ws) spaceMap.set(sf.name, ws);
      }

      // 5. Collect live Essential and Pinned tabs.
      const allLiveTabs = win.gZenWorkspaces?.allStoredTabs ?? win.gBrowser.tabs;
      // Essential tabs must be pinned — exclude phantom tabs from previous
      // broken restores that have the attribute but were never properly
      // registered with Zen (not pinned, not in essentials section).
      const liveEssentials = allLiveTabs.filter(t => t.hasAttribute("zen-essential") && t.pinned);
      const livePinnedBySpace = new Map();
      for (const ws of spaceMap.values()) {
        livePinnedBySpace.set(
          ws.uuid,
          allLiveTabs.filter(
            t =>
              t.pinned &&
              !t.hasAttribute("zen-essential") &&
              t.getAttribute("zen-workspace-id") === ws.uuid
          )
        );
      }

      // 6. Build deduplicated desired essential tab list across all spaces.
      const desiredEssentials = this._buildDesiredEssentials(spaceFolders);
      this.log(
        `Restore: ${spaceFolders.length} space(s),`,
        `essentials per space: [${spaceFolders.map(sf => `${sf.name}:${sf.essentials.reduce((n, e) => n + e.items.length, 0)}`).join(", ")}],`,
        `desired: ${desiredEssentials.length}, live: ${liveEssentials.length}`,
        desiredEssentials.length ? desiredEssentials.map(d => d.url) : ""
      );

      // 7. Reconcile essential tabs globally.
      await this._reconcileEssentialTabs(
        desiredEssentials,
        liveEssentials,
        allLiveTabs,
        dryRecord,
        result
      );

      // 8. Reconcile pinned tabs per space.
      for (const sf of spaceFolders) {
        const ws = spaceMap.get(sf.name);
        if (!ws) continue;
        await this._reconcilePinnedTabsForSpace(
          sf,
          ws,
          livePinnedBySpace.get(ws.uuid) ?? [],
          dryRecord,
          result
        );
      }

      const tag = dryRun ? "(dry-run) " : "";
      this.log(
        `Restore ${tag}complete — created:${result.created} updated:${result.updated} deleted:${result.deleted}`
      );
      this.manager.dispatchEvent(
        dryRun ? "simple-restore-dry-run-completed" : "simple-restore-completed",
        { created: result.created, updated: result.updated, deleted: result.deleted }
      );
    } catch (err) {
      console.error("[ZenTabs] SimpleBookmarkSyncManager restore error:", err);
      result.errors.push(String(err));
      this.manager.dispatchEvent("simple-restore-failed", { error: String(err) });
    }

    return result;
  }

  // ── Restore helpers ───────────────────────────────────────────────────────

  /**
   * Parse the ZenTabs/ bookmark tree into an array of space folder descriptors.
   * This is a pure read-only method — no browser state is modified.
   *
   * Accepts the ZenTabs/ tree node directly (from promiseBookmarksTree) and
   * traverses its already-populated recursive children.  This avoids redundant
   * promiseBookmarksTree calls, which in the real browser can return folder
   * nodes without children populated.
   *
   * Each descriptor:
   *   { name: string,
   *     essentials: [{ containerName: string, items: [{title, url}] }],
   *     pinned:     [DesiredItem] }
   *
   * DesiredItem is either:
   *   { type: "bookmark", title, url }            ← root-level pinned tab
   *   { type: "folder",   title, children: [...] } ← Zen folder (pinned tabs)
   */
  _parseBookmarkTree(zenTabsNode) {
    const spaceFolders = [];

    for (const child of zenTabsNode?.children ?? []) {
      if (child.uri != null) continue;           // bare bookmarks at root — skip
      if (child.title === "__spaces__") continue; // metadata folder — skip

      const sf = { name: child.title, essentials: [], pinned: [] };

      for (const item of child?.children ?? []) {
        if (item.uri != null) {
          // Direct bookmark inside the space folder → root-level pinned tab.
          sf.pinned.push({ type: "bookmark", title: item.title, url: item.uri });
        } else if (this._isEssentialsFolder(item.title)) {
          // Essentials sub-folder.
          const items = (item?.children ?? [])
            .filter(c => c.uri != null)
            .map(c => ({ title: c.title, url: c.uri }));
          sf.essentials.push({ containerName: item.title, items });
        } else {
          // Named subfolder → Zen folder wrapping pinned tabs.
          // Recursively collects bookmarks preserving parent-child hierarchy
          // so nested Zen folders can be created properly.
          sf.pinned.push(this._collectFolderItems(item));
        }
      }

      spaceFolders.push(sf);
    }

    return spaceFolders;
  }

  /**
   * Recursively collect bookmarks from a named bookmark folder node.
   *
   * Direct bookmarks and sub-folders both become children of the returned
   * entry, preserving the bookmark hierarchy.  Sub-folders appear as
   * { type: "folder" } children so the restore code can nest Zen folders.
   *
   * @returns {{ type: "folder", title: string, children: Array }}
   */
  _collectFolderItems(folderNode) {
    const entry = { type: "folder", title: folderNode.title, children: [] };

    for (const child of folderNode?.children ?? []) {
      if (child.uri != null) {
        entry.children.push({ type: "bookmark", title: child.title, url: child.uri });
      } else {
        // Sub-folder → recurse and nest as a child of this entry.
        entry.children.push(this._collectFolderItems(child));
      }
    }

    return entry;
  }

  /**
   * Build the deduplicated desired essential tab list across all space folders.
   * Duplicates (same URL + same container name) across multiple spaces are
   * collapsed into a single entry — essentials are shared across spaces.
   *
   * @returns {Array<{ url, title, containerName }>}
   */
  _buildDesiredEssentials(spaceFolders) {
    const seen = new Set(); // key = `${url}::${containerName}`
    const result = [];

    for (const sf of spaceFolders) {
      for (const ef of sf.essentials) {
        for (const item of ef.items) {
          const key = `${item.url}::${ef.containerName}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push({ url: item.url, title: item.title, containerName: ef.containerName });
        }
      }
    }

    return result;
  }

  /**
   * Return true if a bookmark folder title represents a Zen essentials folder.
   * Matches "Essentials" (default container) or "Essentials - <ContainerName>".
   */
  _isEssentialsFolder(title) {
    return title === "Essentials" || title.startsWith("Essentials - ");
  }

  /**
   * Find or create a Zen Space by name.
   * Returns the workspace object (or a synthetic stub during dry-run).
   */
  async _findOrCreateSpace(name, spaceMetadata, dryRecord, result) {
    const win = this.manager.window;
    const existing = win.gZenWorkspaces?.getWorkspaces().find(ws => ws.name === name);
    if (existing) return existing;

    const meta  = spaceMetadata.get(name) ?? null;
    const icon  = meta?.icon ?? null;
    const theme = meta?.theme ?? {};

    if (!dryRecord("created", "create-space", `Create space "${name}"`, { space: name })) {
      // dry-run recorded — return synthetic stub so planning continues correctly.
      return { uuid: `dry-run-uuid-${name}`, name, icon, theme, containerTabId: 0 };
    }

    // Live: actually create the space.
    try {
      const ws = await win.gZenWorkspaces.createAndSaveWorkspace(
        name, icon, /* dontChange= */ true, 0
      );
      if (theme && Object.keys(theme).length > 0) {
        ws.theme = theme;
        await win.gZenWorkspaces.saveWorkspace(ws);
      }
      return ws;
    } catch (e) {
      result.errors.push(`create space "${name}": ${e.message}`);
      return null;
    }
  }

  /**
   * Resolve an Essentials folder title to a Firefox container userContextId.
   * "Essentials"           → 0  (default container)
   * "Essentials - <Name>" → look up existing identity by name, or create one.
   */
  async _resolveContainerName(containerName) {
    if (containerName === "Essentials") return 0;

    const plainName = containerName.replace(/^Essentials - /, "");
    const svc = this.manager.window.ContextualIdentityService;
    if (!svc) return 0;

    const identities = svc.getPublicIdentities?.() ?? [];
    const found = identities.find(id => {
      const label =
        id.name ||
        (id.l10nId
          ? id.l10nId.replace(/^user-context-/, "").replace(/^./, c => c.toUpperCase())
          : null);
      return label === plainName;
    });
    if (found) return found.userContextId;

    // No match — create a new container.
    try {
      const newIdentity = svc.create?.(plainName, "circle", "blue");
      return newIdentity?.userContextId ?? 0;
    } catch (e) {
      this.log("Could not create container for", containerName, e);
      return 0;
    }
  }

  /**
   * Reconcile essential tabs globally across all spaces.
   * Creates missing ones, deletes stale ones.  Essential tabs are matched by
   * (url, containerTabId) pairs.
   */
  async _reconcileEssentialTabs(desired, liveEssentials, allLiveTabs, dryRecord, result) {
    const win     = this.manager.window;
    const gBrowser = win.gBrowser;

    // Clean up phantom essentials: tabs that have zen-essential attribute but
    // are NOT pinned.  These are leftovers from a broken previous restore where
    // addToEssentials was skipped.  They are invisible in the UI but prevent
    // correct matching.
    const phantomEssentials = Array.from(allLiveTabs).filter(
      t => t.hasAttribute("zen-essential") && !t.pinned
    );
    for (const phantom of phantomEssentials) {
      const url = this.getEssentialUrl(phantom) ?? "(unknown)";
      const desc = `Delete phantom essential tab "${url}" (has attribute but not pinned)`;
      if (dryRecord("deleted", "delete-tab", desc, { url })) {
        try {
          gBrowser.removeTab(phantom, { skipPermitUnload: true });
          result.deleted++;
        } catch (_) { /* non-fatal */ }
      }
    }

    // Resolve containerTabId for each desired entry.
    const resolved = [];
    for (const d of desired) {
      const containerTabId = await this._resolveContainerName(d.containerName);
      resolved.push({ ...d, containerTabId });
    }

    // Build a consumable pool of live essentials.
    const livePool = liveEssentials.map(t => ({
      tab:           t,
      url:           this.getEssentialUrl(t) ?? "",
      containerTabId: parseInt(t.getAttribute("usercontextid") ?? "0", 10),
      matched:       false,
    }));

    // Match desired → live by URL only.  Essential tabs in Zen are global
    // (shared across all spaces) and may not carry a containerTabId matching
    // the one resolved from the bookmark folder name.
    for (const d of resolved) {
      const idx = livePool.findIndex(
        lp => !lp.matched && lp.url === d.url
      );
      if (idx !== -1) {
        livePool[idx].matched = true;
      } else {
        const desc = `Create essential tab "${d.title}" (${d.url}) [container: ${d.containerName}]`;
        if (dryRecord("created", "create-tab", desc, { url: d.url, title: d.title, container: d.containerName })) {
          try {
            // Use gBrowser.addTab (not addTrustedTab) with inBackground to
            // match SyncManager's proven approach.  Set zen-essential BEFORE
            // pinTab — Zen's pinTab override routes essential-flagged tabs
            // to the essentials DOM section.  Do NOT use addToEssentials()
            // because it doesn't move unpinned tabs to the section.
            const tab = gBrowser.addTab(d.url, {
              inBackground:      true,
              createLazyBrowser: true,
              lazyTabTitle:      d.title,
              skipAnimation:     true,
              userContextId:     d.containerTabId,
              triggeringPrincipal:
                win.Services?.scriptSecurityManager?.getSystemPrincipal?.(),
            });
            tab.setAttribute("skipbackgroundnotify", "true");
            tab.setAttribute("zentabs-pending-url", d.url);
            tab.setAttribute("zen-essential", "true");
            gBrowser.pinTab(tab);
            result.created++;
          } catch (e) {
            result.errors.push(`create essential tab ${d.url}: ${e.message}`);
          }
        }
      }
    }

    // Delete unmatched live essentials.
    for (const lp of livePool) {
      if (lp.matched) continue;
      const desc = `Delete essential tab "${lp.url}" [container: ${lp.containerTabId}]`;
      if (dryRecord("deleted", "delete-tab", desc, { url: lp.url })) {
        try {
          gBrowser.removeTab(lp.tab, { skipPermitUnload: true });
          result.deleted++;
        } catch (e) {
          result.errors.push(`delete essential tab ${lp.url}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Reconcile pinned tabs for one space.
   *
   * sf          — parsed space descriptor { name, pinned: [DesiredItem] }
   * ws          — Zen workspace object
   * livePinned  — live pinned tabs currently in this space
   */
  async _reconcilePinnedTabsForSpace(sf, ws, livePinned, dryRecord, result) {
    const win          = this.manager.window;
    const gBrowser     = win.gBrowser;
    const gZenWorkspaces = win.gZenWorkspaces;

    // Build a consumable pool of live pinned tabs in this space.
    const livePool = livePinned.map(t => ({
      tab:        t,
      url:        this.getPinnedUrl(t) ?? "",
      folderLabel: (t.group?.isZenFolder) ? (t.group.label ?? null) : null,
      matched:    false,
    }));

    // Process pinned items in bookmark order (preserving interleaved
    // bookmarks and folders so tabs/folders appear in the correct order).
    for (const item of sf.pinned) {
      if (item.type === "bookmark") {
        if (!item.url || this._isBlankUrl(item.url)) continue;

        const idx = livePool.findIndex(
          lp => !lp.matched && lp.url === item.url && !lp.folderLabel
        );
        if (idx !== -1) {
          livePool[idx].matched = true;
        } else {
          const desc =
            `Create pinned tab "${item.title}" (${item.url}) in space "${sf.name}" [root]`;
          if (dryRecord("created", "create-tab", desc,
            { url: item.url, title: item.title, space: sf.name })) {
            try {
              const tab = gBrowser.addTab(item.url, {
                inBackground:      true,
                createLazyBrowser: true,
                lazyTabTitle:      item.title,
                skipAnimation:     true,
                triggeringPrincipal:
                  win.Services?.scriptSecurityManager?.getSystemPrincipal?.(),
              });
              tab.setAttribute("skipbackgroundnotify", "true");
              tab.setAttribute("zentabs-pending-url", item.url);
              tab.setAttribute("zen-workspace-id", ws.uuid);
              gBrowser.pinTab(tab);
              gZenWorkspaces.moveTabToWorkspace(tab, ws.uuid);
              result.created++;
            } catch (e) {
              result.errors.push(`create pinned tab ${item.url}: ${e.message}`);
            }
          }
        }
      } else if (item.type === "folder") {
        await this._reconcileFolderRecursive(
          item, null, sf, ws, livePool, dryRecord, result
        );
      }
    }

    // ── Delete unmatched live pinned tabs in this space ────────────────
    for (const lp of livePool) {
      if (lp.matched) continue;
      const desc = `Delete pinned tab "${lp.url}" from space "${sf.name}"`;
      if (dryRecord("deleted", "delete-tab", desc, { url: lp.url, space: sf.name })) {
        try {
          gBrowser.removeTab(lp.tab, { skipPermitUnload: true });
          result.deleted++;
        } catch (e) {
          result.errors.push(`delete pinned tab ${lp.url}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Recursively reconcile a Zen folder entry and its nested sub-folders.
   *
   * Creates the folder (or finds an existing one), creates missing tabs
   * inside it, then recurses into any sub-folder children — nesting them
   * inside the parent via `insertAfter` on the parent's groupContainer.
   */
  async _reconcileFolderRecursive(folderEntry, parentFolder, sf, ws, livePool, dryRecord, result) {
    const win          = this.manager.window;
    const gBrowser     = win.gBrowser;
    const gZenWorkspaces = win.gZenWorkspaces;
    const gZenFolders  = win.gZenFolders;

    // Separate direct bookmarks from sub-folders within this folder entry.
    const directBookmarks = (folderEntry.children ?? []).filter(
      c => c.type === "bookmark" && c.url && !this._isBlankUrl(c.url)
    );
    const subFolders = (folderEntry.children ?? []).filter(c => c.type === "folder");

    if (directBookmarks.length === 0 && subFolders.length === 0) return;

    // Match direct bookmarks against the live pool.
    const toCreate = [];
    for (const bm of directBookmarks) {
      const idx = livePool.findIndex(
        lp => !lp.matched && lp.url === bm.url && lp.folderLabel === folderEntry.title
      );
      if (idx !== -1) {
        livePool[idx].matched = true;
      } else {
        toCreate.push(bm);
      }
    }

    // Resolve or create the Zen folder reference.
    let folderRef = null;

    // Look for an existing Zen folder with this name in this workspace.
    // Walk the full group chain for each tab because `tab.group` points to
    // the innermost folder — a tab in "Projects > Sub" has group.label
    // "Sub", not "Projects".  We need to find the group at the right level.
    const allLiveTabs = gZenWorkspaces?.allStoredTabs ?? gBrowser.tabs;
    for (const lt of allLiveTabs) {
      if (lt.getAttribute("zen-workspace-id") !== ws.uuid) continue;
      let g = lt.group;
      while (g && g.isZenFolder) {
        if (g.label === folderEntry.title) {
          folderRef = g;
          break;
        }
        g = g.group; // walk up to parent folder
      }
      if (folderRef) break;
    }

    if (toCreate.length > 0) {
      const desc = `Create Zen folder "${folderEntry.title}" with ${toCreate.length} tab(s) in space "${sf.name}"`;
      const executing = dryRecord("created", "create-zen-folder", desc,
        { folder: folderEntry.title, space: sf.name });
      if (executing) {
        try {
          if (folderRef) {
            // Folder exists — insert new tabs into it.
            for (const bm of toCreate) {
              const tab = gBrowser.addTab(bm.url, {
                inBackground:      true,
                createLazyBrowser: true,
                lazyTabTitle:      bm.title,
                skipAnimation:     true,
                triggeringPrincipal:
                  win.Services?.scriptSecurityManager?.getSystemPrincipal?.(),
              });
              tab.setAttribute("skipbackgroundnotify", "true");
              tab.setAttribute("zentabs-pending-url", bm.url);
              tab.setAttribute("zen-workspace-id", ws.uuid);
              gBrowser.pinTab(tab);
              folderRef.addTabs([tab]);
              result.created++;
            }
          } else {
            // Create new tabs and wrap them in a new Zen folder.
            const newTabs = [];
            for (const bm of toCreate) {
              const tab = gBrowser.addTab(bm.url, {
                inBackground:      true,
                createLazyBrowser: true,
                lazyTabTitle:      bm.title,
                skipAnimation:     true,
                triggeringPrincipal:
                  win.Services?.scriptSecurityManager?.getSystemPrincipal?.(),
              });
              tab.setAttribute("skipbackgroundnotify", "true");
              tab.setAttribute("zentabs-pending-url", bm.url);
              tab.setAttribute("zen-workspace-id", ws.uuid);
              newTabs.push(tab);
            }
            if (gZenFolders?.createFolder) {
              const opts = {
                label:       folderEntry.title,
                workspaceId: ws.uuid,
              };
              // Nest inside parent folder if one was provided.
              if (parentFolder?.groupContainer) {
                opts.insertAfter = parentFolder.groupContainer.lastElementChild;
              }
              folderRef = gZenFolders.createFolder(newTabs, opts);
            } else {
              // Fallback: pin each tab and assign to workspace.
              for (const tab of newTabs) {
                gBrowser.pinTab(tab);
                gZenWorkspaces.moveTabToWorkspace(tab, ws.uuid);
              }
            }
            result.created += toCreate.length;
          }
        } catch (e) {
          result.errors.push(`create folder "${folderEntry.title}": ${e.message}`);
        }
      } else if (toCreate.length > 1) {
        // Dry-run: dryRecord already counted +1 for the folder entry;
        // increment for the remaining tabs so the total matches reality.
        result.created += toCreate.length - 1;
      }
    } else if (!folderRef && subFolders.length > 0 && gZenFolders?.createFolder) {
      // No tabs to create, but sub-folders need a parent.  Create an empty
      // folder (Zen always adds an internal empty-tab placeholder).
      const desc = `Create empty Zen folder "${folderEntry.title}" (parent for sub-folders) in space "${sf.name}"`;
      if (dryRecord("created", "create-zen-folder", desc,
        { folder: folderEntry.title, space: sf.name })) {
        const opts = {
          label:       folderEntry.title,
          workspaceId: ws.uuid,
        };
        if (parentFolder?.groupContainer) {
          opts.insertAfter = parentFolder.groupContainer.lastElementChild;
        }
        folderRef = gZenFolders.createFolder([], opts);
      }
    }

    // Recursively handle sub-folders, nesting them inside this folder.
    for (const subFolder of subFolders) {
      await this._reconcileFolderRecursive(
        subFolder, folderRef, sf, ws, livePool, dryRecord, result
      );
    }
  }

  /**
   * Read back space metadata from the __spaces__/ bookmark folder.
   * Returns Map<name, { icon, theme }>.  Returns empty Map on any error.
   */
  async readSpaceMetadata() {
    const PlacesUtils = this.manager.window.PlacesUtils;
    const result = new Map();
    try {
      const toolbarTree = await PlacesUtils.promiseBookmarksTree(
        PlacesUtils.bookmarks.toolbarGuid
      );
      const zenTabsEntry = (toolbarTree?.children ?? []).find(
        c => c.uri == null && c.title === "ZenTabs"
      );
      if (!zenTabsEntry) return result;

      const zenTabsTree = await PlacesUtils.promiseBookmarksTree(zenTabsEntry.guid);
      const metaEntry   = (zenTabsTree?.children ?? []).find(
        c => c.uri == null && c.title === "__spaces__"
      );
      if (!metaEntry) return result;

      const metaTree = await PlacesUtils.promiseBookmarksTree(metaEntry.guid);
      for (const item of metaTree?.children ?? []) {
        if (item.uri == null) continue;
        try {
          const json   = decodeURIComponent(item.uri.replace("data:application/json,", ""));
          const parsed = JSON.parse(json);
          result.set(parsed.name, { icon: parsed.icon ?? null, theme: parsed.theme ?? {} });
        } catch (_) {
          // Malformed entry — skip silently.
        }
      }
    } catch (_) {
      // Return empty Map on any unexpected error.
    }
    return result;
  }
}
