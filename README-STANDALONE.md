# ZenTabs Manager - Simple Installation

Advanced tab management for Zen Browser without Sine dependency.

## Features

- 📊 **Tab Management**: List, filter, and organize tabs
- 🔄 **Bookmark Sync**: Bi-directional sync between tabs and bookmarks
- 🧹 **Auto-Cleanup**: Close old tabs automatically
- 💾 **Memory Optimization**: Unload tabs when memory is low
- 🎨 **Toolbar UI**: Easy access to all features
- ⌨️ **Keyboard Shortcuts**: Quick actions

## Installation

### Quick Install

```bash
cd /path/to/ZenTabsManager
chmod +x install.sh
./install.sh
```

Then restart Zen Browser.

### Manual Install

1. Copy `engine/` and `content/` folders to your Zen profile's `chrome/zentabs/` directory
   - macOS: `~/Library/Application Support/zen/Profiles/xxx.Default/chrome/zentabs/`
   - Linux: `~/.zen/chrome/zentabs/`

2. Restart Zen Browser

3. Open Browser Console (`Cmd+Shift+J` or `Ctrl+Shift+J`)

4. Load manually (if autoload doesn't work):
   ```javascript
   await import('file:///path/to/chrome/zentabs/engine/zen.sys.mjs')
   ```

## Usage

### Browser Console

Once loaded, use the API:

```javascript
// Check if loaded
ZenTabsAPI.getVersion()  // Returns "1.0.0"

// List all tabs
await ZenTabsAPI.listAllTabs()

// Get statistics
await ZenTabsAPI.getStatistics()

// Sync tabs to bookmarks
await ZenTabsAPI.syncToBookmarks()

// Clean up old tabs (dry run)
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: true })

// Optimize memory
await ZenTabsAPI.optimizeMemory({ force: true })

// Export data
await ZenTabsAPI.exportToJSON()
```

### Preferences

```javascript
// View current preferences
ZenTabsAPI.getPreferences()

// Update preferences
await ZenTabsAPI.setPreferences({
  syncEnabled: true,
  syncInterval: 300,  // seconds
  cleanupEnabled: true,
  cleanupAge: 14,  // days
  memoryThreshold: 80  // percent
})
```

##Toolbar Button

If enabled, a ZenTabs button will appear in your toolbar with quick access to:
- List tabs
- Sync operations  
- Cleanup
- Memory optimization
- Statistics
- Settings

## Preferences

All preferences are stored in `localStorage`:

- `enabled`: Master on/off switch (default: `true`)
- `syncEnabled`: Enable bookmark sync (default: `true`)
- `syncDirection`: `"bidirectional"` | `"tabs-to-bookmarks"` | `"bookmarks-to-tabs"`
- `syncInterval`: Auto-sync interval in seconds, 0 = manual only (default: `300`)
- `cleanupEnabled`: Enable auto-cleanup (default: `false`)
- `cleanupAge`: Max age in days before cleanup (default: `7`)
- `cleanupExcludeDomains`: Comma-separated domains to never close (default: `""`)
- `memoryOptimization`: Enable memory optimization (default: `true`)
- `memoryThreshold`: Memory percentage to trigger optimization (default: `80`)
- `keepEssentialTabs`: Never cleanup Essential tabs (default: `true`)
- `keepPinnedTabs`: Never cleanup pinned tabs (default: `true`)
- `showToolbarButton`: Show toolbar button (default: `true`)
- `debugMode`: Enable debug logging (default: `false`)

## Keyboard Shortcuts

(If enabled in UI):
- `Cmd/Ctrl+Shift+L`: List all tabs
- `Cmd/Ctrl+Shift+B`: Sync to bookmarks
- `Cmd/Ctrl+Shift+M`: Optimize memory
- `Cmd/Ctrl+Shift+K`: Cleanup old tabs

## Troubleshooting

### Not loading automatically

Manually load in Browser Console:
```javascript
await import('file:///path/to/chrome/zentabs/engine/zen.sys.mjs')
```

### Check logs

Enable debug mode:
```javascript
await ZenTabsAPI.setPreferences({ debugMode: true })
```

### Reset preferences

```javascript
localStorage.removeItem('zentabs-prefs')
location.reload()
```

## Development

The mod consists of:

- `engine/zen.sys.mjs`: Main system file
- `engine/zen.api.mjs`: Public API
- `content/TabManager.mjs`: Tab management
- `content/SyncManager.mjs`: Bookmark sync
- `content/CleanupManager.mjs`: Cleanup & memory optimization
- `content/UI.mjs`: User interface
- `content/browser.mjs`: Browser compatibility layer

## License

MIT
