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

    // Group tabs by workspace ID (UUID used only as a transient in-memory key —
    // never stored in bookmarks; the stable key written to disk is the space name).
    const byWorkspace = new Map(); // wsId → { workspace, tabs: [] }

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
