# 🚀 ZenTabs Manager - Full Sine Mod

**Advanced tab management for Zen Browser** with bi-directional bookmark sync, memory optimization, automatic cleanup, and intelligent tab organization.

## ✨ Features

### 📊 Tab Management
- **Complete Tab Enumeration**: List all tabs with full metadata (type, state, workspace, folder hierarchy)
- **Smart Filtering**: Filter tabs by type, state, workspace, folder, age, and more
- **Folder Hierarchy**: Full support for Zen's nested folder system (up to 5 levels)
- **Tab Classification**: Distinguishes Essential, Pinned, and Normal tabs

### 🔄 Bi-Directional Sync
- **Tabs → Bookmarks**: Sync your tab structure to bookmarks
- **Bookmarks → Tabs**: Open bookmarks as tabs automatically
- **Bidirectional**: Keep tabs and bookmarks in perfect sync
- **Preserves Structure**: Maintains folder hierarchy and organization
- **Smart Sync**: Only syncs Essential and Pinned tabs (configurable)

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

### One-Command Installation (Recommended)

Run the installer script:

```bash
cd /path/to/ZenTabs
./install-sine-mod.sh
```

This will:
- Copy the mod to your Zen mods directory
- Set up all necessary files
- Clean up temporary files

**Then restart Zen Browser.**

### Manual Installation

If you prefer to install manually:

**Step 1:** Copy this entire folder to your Zen mods directory:

```bash
# macOS/Linux
cp -r /path/to/ZenTabs ~/Library/Application\ Support/zen/mods/zentabs-manager/

# Or manually place the folder in:
# macOS: ~/Library/Application Support/zen/mods/
# Linux: ~/.zen/mods/
# Windows: %APPDATA%\\zen\\mods\\
```

**Step 2:** Restart Zen Browser

**Step 3:** Verify installation in Browser Console (`Cmd+Shift+J`):

```
✅ ZenTabs Manager initialized successfully
```

### Verifying Installation

1. Open Browser Console: `Cmd+Shift+J`
2. Type: `ZenTabsAPI.getVersion()`
3. Should return: `"1.0.0"`

## 🎮 Usage

### Toolbar Button

Click the **ZenTabs** button in your toolbar to access:
- List All Tabs
- Sync to Bookmarks
- Sync from Bookmarks  
- Bidirectional Sync
- Cleanup Old Tabs
- Optimize Memory
- Show Statistics
- Export to JSON
- Settings

### Keyboard Shortcuts

- **`Cmd+Shift+L`**: List all tabs in console (with full metadata)
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
await ZenTabsAPI.syncFromBookmarks();
await ZenTabsAPI.syncBidirectional();

// Cleanup and optimization
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: false });
await ZenTabsAPI.optimizeMemory({ force: true });

// Statistics
const stats = await ZenTabsAPI.getStatistics();
console.log(stats);

// Export
const json = await ZenTabsAPI.exportToJSON();
```

### Preferences

The mod loads preferences from `engine.json`. To change settings:

1. Click the toolbar button → **Settings**
2. Or edit `engine.json` and restart Zen
3. Or modify via localStorage:

```javascript
ZenTabsManager.setPreferences({
  syncEnabled: true,
  syncDirection: 'bidirectional',
  cleanupAge: 14,
  memoryThreshold: 75
});
```

## ⚙️ Configuration

All preferences with defaults:

| Preference | Default | Description |
|------------|---------|-------------|
| `enabled` | `true` | Master switch for all features |
| `syncEnabled` | `true` | Enable bookmark sync |
| `syncDirection` | `bidirectional` | Sync direction: `tabs-to-bookmarks`, `bookmarks-to-tabs`, `bidirectional` |
| `syncInterval` | `300` | Auto-sync interval in seconds (0 = manual only) |
| `cleanupEnabled` | `false` | Enable automatic cleanup |
| `cleanupAge` | `7` | Close tabs older than N days |
| `cleanupExcludeDomains` | `""` | Comma-separated domains to protect |
| `memoryOptimization` | `true` | Enable memory optimization |
| `memoryThreshold` | `80` | Unload tabs when memory > N% |
| `keepEssentialTabs` | `true` | Never cleanup/unload Essential tabs |
| `keepPinnedTabs` | `true` | Never cleanup Pinned tabs |
| `showToolbarButton` | `true` | Show toolbar button |
| `debugMode` | `false` | Enable debug logging |

## 📂 Project Structure

```
zentabs-manager/
├── engine.json              # Sine mod manifest with preferences
├── engine/
│   ├── sine.api.mjs        # Public API definitions
│   └── sine.sys.mjs         # System integration & initialization
├── content/
│   ├── TabManager.mjs       # Tab enumeration & metadata
│   ├── SyncManager.mjs      # Bi-directional bookmark sync
│   ├── CleanupManager.mjs   # Cleanup & memory optimization
│   ├── UI.mjs               # Toolbar button & keyboard shortcuts
│   └── browser.mjs          # Browser integration layer
├── icons/                   # Mod icons (for future)
├── install-sine-mod.sh      # One-command installer
├── README.md                # This file (complete documentation)
├── QUICKSTART.md            # Quick start guide
├── WHATS-BUILT.md           # Architecture overview
└── archive/                 # Old implementations (userChrome.js)
```

## 🔧 Architecture

### Modular Design

The mod is built with a clean separation of concerns:

1. **sine.sys.mjs**: Initializes all managers, handles lifecycle
2. **TabManager**: Core tab operations and metadata extraction
3. **SyncManager**: Bookmark synchronization logic
4. **CleanupManager**: Cleanup and memory optimization
5. **UIManager**: User interface components
6. **sine.api.mjs**: Public API for other mods/scripts

### Event System

Subscribe to events:

```javascript
ZenTabsManager.on('initialized', () => console.log('Ready!'));
ZenTabsManager.on('sync-completed', (result) => console.log(result));
ZenTabsManager.on('cleanup-completed', (result) => console.log(result));
ZenTabsManager.on('memory-optimized', (result) => console.log(result));
```

## 🐛 Troubleshooting

### Mod Not Loading

1. Check Sine is enabled in Zen
2. Verify folder is in correct location: `~/Library/Application Support/zen/mods/zentabs-manager/`
3. Check Browser Console for errors: `Cmd+Shift+J`
4. Try fallback installation: `./install-permanent.sh`

### Features Not Working

1. Open Browser Console: `Cmd+Shift+J`
2. Check for initialization message
3. Verify API is available: `typeof ZenTabsAPI`
4. Enable debug mode: `ZenTabsManager.setPreferences({ debugMode: true })`

### Sync Issues

1. Check permissions: mod needs `bookmarks` permission
2. Verify PlacesUtils is available: `typeof PlacesUtils`
3. Check sync direction in preferences
4. Look for errors in Browser Console

## 🚦 Why This is Better Than userChrome.js

| Feature | userChrome.js | Sine Mod |
|---------|---------------|----------|
| GUI Integration | Manual buttons | Native toolbar button |
| Settings Panel | No | Yes (via engine.json) |
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
- [ ] Integration with Zen workspaces
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
2. Initialize in `sine.sys.mjs`
3. Export methods in `sine.api.mjs`
4. Add UI elements in `UI.mjs`

## 📄 License

MIT License - Feel free to modify and distribute

## 🙏 Credits

Built by Stephane for the Zen Browser community

---

**Need Help?** Open an issue or check the Zen Browser Discord for support.
