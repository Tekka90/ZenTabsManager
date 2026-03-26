# 🎯 Quick Start - ZenTabs Manager (Sine Mod)

Perfect for users who want **full GUI integration** with automatic loading, settings panel, and native Zen Browser integration.

## 🚀 One-Command Installation

```bash
cd /path/to/ZenTabs
./install-sine-mod.sh
```

That's it! Restart Zen Browser and you're done. ✅

## 🎨 What You Get

### Toolbar Button
A **ZenTabs** button appears in your toolbar with dropdown menu:
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
- **`Cmd+Shift+L`**: List all tabs
- **`Cmd+Shift+B`**: Sync to bookmarks
- **`Cmd+Shift+M`**: Optimize memory
- **`Cmd+Shift+K`**: Cleanup old tabs

### Automatic Features (Once Enabled)
- **Auto-sync** every 5 minutes (configurable)
- **Auto-cleanup** of old tabs hourly
- **Memory optimization** checks every 5 minutes
- **Background monitoring** of tab changes

## ⚙️ Quick Configuration

1. Click toolbar button → **Settings**
2. Or edit settings via console:

```javascript
// Enable auto-cleanup (off by default)
ZenTabsManager.setPreferences({
  cleanupEnabled: true,
  cleanupAge: 14  // Close tabs older than 14 days
});

// Adjust memory threshold
ZenTabsManager.setPreferences({
  memoryThreshold: 75  // Optimize when memory > 75%
});

// Change sync direction
ZenTabsManager.setPreferences({
  syncDirection: 'bidirectional',  // or 'tabs-to-bookmarks', 'bookmarks-to-tabs'
  syncInterval: 300  // Every 5 minutes (0 = manual only)
});
```

## 🎮 Quick Commands

Open Browser Console (`Cmd+Shift+J`) and try:

```javascript
// List all tabs with full metadata
await ZenTabsAPI.listAllTabs();

// Show statistics
await ZenTabsAPI.getStatistics();

// Sync tabs to bookmarks
await ZenTabsAPI.syncToBookmarks();

// Sync bookmarks to tabs
await ZenTabsAPI.syncFromBookmarks();

// Bidirectional sync
await ZenTabsAPI.syncBidirectional();

// Clean up tabs older than 7 days (dry run)
await ZenTabsAPI.cleanupOldTabs({ maxAge: 7, dryRun: true });

// Optimize memory now
await ZenTabsAPI.optimizeMemory({ force: true });

// Export to JSON
await ZenTabsAPI.exportToJSON();
```

## 🔍 Verify Installation

1. Restart Zen Browser after running installer
2. Open Browser Console: `Cmd+Shift+J`
3. Look for this message:

```
✅ ZenTabs Manager initialized successfully
```

4. Check API is available:

```javascript
ZenTabsAPI.getVersion()  // Should return "1.0.0"
```

5. Look for the **ZenTabs** button in your toolbar

## 📊 Example Workflow

### Morning: Open Yesterday's Work
```javascript
// Sync bookmarks to tabs (opens all your saved Essential tabs)
await ZenTabsAPI.syncFromBookmarks();
```

### During Day: Work Normally
- Tabs automatically sync to bookmarks every 5 minutes
- Memory optimized when needed
- Everything backed up to bookmarks

### Evening: Clean Up
```javascript
// View what would be cleaned
await ZenTabsAPI.cleanupOldTabs({ dryRun: true });

// Actually clean it up
await ZenTabsAPI.cleanupOldTabs({ maxAge: 3 });

// Export session
await ZenTabsAPI.exportToJSON();
```

## 🆚 Sine Mod vs userChrome.js

| Feature | userChrome.js | **Sine Mod** ✅ |
|---------|---------------|------------------|
| Installation | fx-autoconfig required | One command |
| Loading | Manual setup | Automatic |
| GUI | Basic buttons | Native integration |
| Settings | localStorage | Preferences system |
| Updates | Copy/paste code | Mod updates |
| Distribution | Paste code | Install script |
| Auto-features | No | Yes |

## ⚠️ Troubleshooting

### Mod Not Loading?

1. **Check mods directory exists:**
   ```bash
   ls -la ~/Library/Application\ Support/zen/mods/
   ```

2. **Verify Sine is enabled** in Zen (it should be by default)

3. **Check Browser Console** for errors:
   ```
   Cmd+Shift+J → Look for ZenTabs messages
   ```

4. **Try manual installation:**
   - Copy the entire `ZenTabs` folder to `~/Library/Application Support/zen/mods/zentabs-manager/`
   - Restart Zen Browser

5. **Check archived alternatives:**
   - See `archive/` folder for the old userChrome.js approach if Sine mods aren't working

### Features Not Working?

```javascript
// Check if loaded
typeof ZenTabsAPI  // Should be "object"

// Enable debug mode
ZenTabsManager.setPreferences({ debugMode: true });

// Check preferences
ZenTabsManager.getPreferences();
```

## 📚 Learn More

- Full documentation: [README-SINE-MOD.md](README-SINE-MOD.md)
- Architecture details: See source files in `engine/` and `content/`
- API reference: [engine/sine.api.mjs](engine/sine.api.mjs)

## 🎯 Your Planned Features

This architecture makes it **easy to add** your planned features:

✅ **Already implemented:**
- Tab listing with full metadata
- Bi-directional bookmark sync  
- Memory optimization (unload old tabs)
- Auto-cleanup of old tabs

🚀 **Ready for you to add:**
- Tab archiving system
- Custom sync rules per folder
- Advanced tab grouping
- Session management
- Cloud backup
- Analytics dashboard

The modular architecture (`TabManager`, `SyncManager`, `CleanupManager`) makes adding new features straightforward!

---

**Questions?** Check [README-SINE-MOD.md](README-SINE-MOD.md) or ask in Zen Browser Discord.
