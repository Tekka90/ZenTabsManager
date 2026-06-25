# 🚀 ZenTabs Manager - Full Sine Mod

**Advanced tab management for Zen Browser** with bookmark sync, memory optimization, automatic cleanup, intelligent tab organization, and SFTP dashboard publishing.

> ⚠️ **IMPORTANT:** This mod requires JavaScript. You MUST enable **"External marketplace"** in Sine settings or the mod won't work! See [Installation Guide](INSTALL.md) for details.

## ✨ Features

### 📊 Tab Management
- **Complete Tab Enumeration**: List all tabs with full metadata (type, state, workspace, folder hierarchy)
- **Smart Filtering**: Filter tabs by type, state, workspace, folder, age, and more
- **Folder Hierarchy**: Full support for Zen's nested folder system (up to 5 levels)
- **Tab Classification**: Distinguishes Essential, Pinned, and Normal tabs

### 🔄 Bookmark Sync
- **Tabs → Bookmarks**: Sync your tab structure to bookmarks under `ZenTabs/`
- **Bookmarks → Tabs**: Restore tabs from bookmarks (with dry-run preview)
- **Preserves Structure**: Maintains folder hierarchy and organization
- **Duplicate-safe**: Same URL in multiple folders/spaces syncs correctly (no dedup)
- **Smart Sync**: Only syncs Essential and Pinned tabs (configurable)
- **Space Metadata**: Stores space icons and themes in bookmark annotations

### 🧹 Automatic Cleanup
- **Age-Based Cleanup**: Automatically close tabs older than X days
- **Domain Exceptions**: Protect specific domains from cleanup
- **Protection Rules**: Never close Essential or Pinned tabs (configurable)
- **Scheduled Runs**: Runs hourly when enabled

### 💾 Memory Optimization
- **Smart Unloading**: Unload inactive tabs when memory is high
- **Threshold-Based**: Triggers at configurable memory percentage
- **Least Recently Used**: Unloads oldest unused tabs first
- **Background Monitoring**: Checks memory every 5 minutes

### 🌐 SFTP Dashboard Publish
- **One-click publish**: Export open tabs as `tabs.json` and upload to SFTP
- **Static dashboard page**: Uploads `index.html` that renders the JSON with client-side JS
- **Hierarchical view**: Tabs are grouped by Space, folders, and subfolders
- **Settings-gated UI**: Publish action appears only when required SFTP fields are configured

### 🎨 User Interface
- **Toolbar Button**: Quick access dropdown menu
- **Keyboard Shortcuts**: 
  - `Cmd+Shift+L`: List all tabs
  - `Cmd+Shift+B`: Sync to bookmarks
  - `Cmd+Shift+M`: Optimize memory
  - `Cmd+Shift+K`: Cleanup old tabs
- **Console API**: Full programmatic access
- **Statistics Dashboard**: View comprehensive tab statistics

## 📦 Installation

**Prerequisites:**
1. Zen Browser with [Sine mod loader](https://github.com/CosmoCreeper/Sine) installed
2. **Enable "External marketplace"** in Sine settings (Settings → Sine → Enable external marketplace)

### Quick Install

Via Sine's built-in installer:

1. Open Zen Settings → Sine Mods → "Install new mod"
2. Paste: `Tekka90/ZenTabsManager`
3. Click Install
4. Restart Zen Browser

### Manual Install (Development)

Copy the repo folder into your Zen profile's `chrome/sine-mods/` directory and register it in `mods.json`. See [INSTALL.md](INSTALL.md) for the exact path and steps.

**📖 For detailed instructions, troubleshooting, and requirements, see [INSTALL.md](INSTALL.md)**

### Verifying Installation

1. Open Browser Console: `Cmd+Shift+J`
2. Type: `ZenTabsAPI.getVersion()`
3. Should return: `"1.0.0"`

## 🎮 Usage

### Toolbar Button

Click the **ZenTabs** button in your toolbar to access:
- Sync to Bookmarks
- Sync to Bookmarks (dry run)
- Restore from Bookmarks
- Restore from Bookmarks (dry run)
- Cleanup Old Tabs
- Optimize Memory
- Show Statistics
- Export to JSON
- Publish Tabs Dashboard
- Settings

### Keyboard Shortcuts

- **`Cmd+Shift+B`**: Sync tabs to bookmarks
- **`Cmd+Shift+M`**: Optimize memory (unload inactive tabs)
- **`Cmd+Shift+K`**: Run cleanup (close old tabs)

### Console API

```javascript
// List all tabs
const tabs = await ZenTabsAPI.listAllTabs();

// Filter tabs
const oldTabs = await ZenTabsAPI.getTabsFiltered({ olderThan: 7 });
const pinnedTabs = await ZenTabsAPI.getTabsFiltered({ type: 'pinned' });

// Sync operations
await ZenTabsAPI.syncToBookmarks();
await ZenTabsAPI.syncToBookmarks({ dryRun: true });
await ZenTabsAPI.syncFromBookmarks();
await ZenTabsAPI.syncFromBookmarks({ dryRun: true });

// Cleanup and optimization
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: false });
await ZenTabsAPI.optimizeMemory({ force: true });

// Pause / resume all background activity
ZenTabsAPI.pause();
ZenTabsAPI.resume();
ZenTabsAPI.isPaused(); // → true / false

// Statistics
const stats = await ZenTabsAPI.getStatistics();
console.log(stats);

// Export
const json = await ZenTabsAPI.exportToJSON();

// Publish tabs.json + dashboard index.html to SFTP
await ZenTabsAPI.publishTabsToSftp();
```

### Preferences

To change settings:

1. Click the toolbar button → **Settings**
2. Or modify via the API:

```javascript
await ZenTabsAPI.setPreferences({
  cleanupAge: 14,
  memoryThreshold: 75,
  publishSftpHost: 'example.com',
  publishSftpUser: 'alice',
  publishSftpRemoteDir: '/var/www/tabs'
});
```

## ⚙️ Configuration

All preferences with defaults:

| Preference | Default | Description |
|------------|---------|-------------|
| `enabled` | `true` | Master switch for all features |
| `paused` | `false` | Whether the manager is currently paused |
| `cleanupEnabled` | `false` | Enable automatic age-based cleanup |
| `cleanupAge` | `7` | Close tabs older than N (in `cleanupAgeUnit` units) |
| `cleanupAgeUnit` | `"days"` | Unit for `cleanupAge`: `"hours"` or `"days"` |
| `cleanupExcludeDomains` | `""` | Comma-separated domains to protect |
| `memoryOptimization` | `true` | Enable memory-threshold-based tab unloading |
| `memoryThreshold` | `80` | Unload tabs when memory usage > N% |
| `autoUnloadEnabled` | `false` | Enable time-based idle tab unloading |
| `autoUnloadDelay` | `3600` | Seconds of inactivity before a tab is unloaded |
| `keepEssentialTabs` | `true` | Never close/unload Essential tabs |
| `keepPinnedTabs` | `true` | Never close/unload Pinned tabs |
| `showToolbarButton` | `true` | Show toolbar button in `#nav-bar` |
| `debugMode` | `false` | Enable verbose debug logging |
| `publishSftpHost` | `""` | SFTP host used for dashboard upload |
| `publishSftpPort` | `22` | SFTP port |
| `publishSftpUser` | `""` | SFTP username |
| `publishSftpRemoteDir` | `""` | Remote directory where `tabs.json` and `index.html` are uploaded |
| `publishSftpPrivateKeyPath` | `""` | Optional SSH private key path for SFTP authentication |
| `publishSftpDashboardTitle` | `"ZenTabs Dashboard"` | Dashboard title stored in `tabs.json` and rendered by `index.html` |

## 📂 Project Structure

```
zentabs-manager/
├── theme.json              # Sine mod manifest (id, name, version, entry point)
├── engine/
│   ├── zen.sys.mjs         # Entry point: ZenTabsManager class, init, lifecycle
│   └── zen.api.mjs         # Public API (ZenTabsAPI) exposed on window
├── content/
│   ├── TabManager.mjs      # Tab enumeration, metadata cache, filtering
│   ├── SimpleBookmarkSyncManager.mjs  # Idempotent bookmark sync (tabs↔bookmarks)
│   ├── CleanupManager.mjs  # Age-based cleanup and memory optimization
│   ├── TabPublishManager.mjs  # JSON + dashboard generation and SFTP publish
│   ├── dashboard.html     # Static dashboard template served with tabs.json
│   └── UI.mjs              # Toolbar button (XUL), dropdown menu, keyboard shortcuts
├── README.md               # This file
└── INSTALL.md              # Installation guide
```

## 🔧 Architecture

### Modular Design

The mod is built with a clean separation of concerns:

1. **zen.sys.mjs**: Initializes all managers per chrome window, handles lifecycle
2. **TabManager**: Core tab operations and metadata extraction
3. **SimpleBookmarkSyncManager**: Idempotent overwrite-based bookmark sync (supports duplicate URLs)
4. **CleanupManager**: Age-based cleanup, memory optimization, and idle tab unloading
5. **TabPublishManager**: Builds tabs JSON, stages static dashboard, uploads both via SFTP
6. **UIManager**: User interface components
7. **zen.api.mjs**: Public API (`ZenTabsAPI`) exposed on the chrome window

### Event System

Subscribe to events:

```javascript
ZenTabsManager.on('initialized', () => console.log('Ready!'));
ZenTabsManager.on('simple-sync-completed', (result) => console.log(result));
ZenTabsManager.on('cleanup-completed', (result) => console.log(result));
ZenTabsManager.on('memory-optimized', (result) => console.log(result));
```

## 🐛 Troubleshooting

### Mod Not Loading

1. Check Sine is enabled in Zen
2. Verify folder is in correct location: `~/Library/Application Support/zen/Profiles/xxx.Default (release)/chrome/sine-mods/zentabs-manager/`
3. Check Browser Console for errors: `Cmd+Shift+J`
4. See [INSTALL.md](INSTALL.md) for full troubleshooting steps

### Features Not Working

1. Open Browser Console: `Cmd+Shift+J`
2. Check for initialization message
3. Verify API is available: `typeof ZenTabsAPI`
4. Enable debug mode: `await ZenTabsAPI.setPreferences({ debugMode: true })`

### Sync Issues

1. Check permissions: mod needs `bookmarks` permission
2. Verify PlacesUtils is available: `typeof PlacesUtils`
3. Check sync direction in preferences
4. Look for errors in Browser Console

## 🚦 Why This is Better Than userChrome.js

| Feature | userChrome.js | Sine Mod |
|---------|---------------|----------|
| GUI Integration | Manual buttons | Native toolbar button |
| Settings Panel | No | Yes (via toolbar button or API) |
| Auto-loading | Manual setup | Automatic |
| Preferences | localStorage | Sine preferences system |
| Modularity | Single file | Clean module structure |
| API | Local only | Exposed to other mods |
| Updates | Manual copy/paste | Mod updates |
| Distribution | Copy/paste code | Folder-based mod |

## 🎯 Future Enhancements

- [ ] Settings panel in Zen preferences UI
- [ ] Real-time tab monitoring panel
- [ ] Custom sync schedules per folder
- [ ] Tab session restoration
- [ ] Export/import sync profiles
- [ ] Graphical statistics dashboard
- [ ] Cloud backup integration

## 📝 Development

To modify the mod:

1. Edit files in place
2. Restart Zen to reload changes
3. Check Browser Console for errors
4. Enable debug mode for detailed logging

### Adding New Features

1. Add new manager in `content/NewManager.mjs`
2. Initialize in `engine/zen.sys.mjs`
3. Export methods in `engine/zen.api.mjs`
4. Add UI elements in `content/UI.mjs`

## 📄 License

MIT License - Feel free to modify and distribute

## 🙏 Credits

Built by Stephane for the Zen Browser community

---

**Need Help?** Open an issue or check the Zen Browser Discord for support.
