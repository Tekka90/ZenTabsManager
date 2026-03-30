# ZenTabsManager Installation Guide

## Prerequisites

1. **Zen Browser** installed
2. **Sine mod loader** installed - Get it from [Sine GitHub](https://github.com/CosmoCreeper/Sine)

## Installation Steps

### 1. Enable External Marketplace (CRITICAL)

**This is required for JavaScript mods to load!**

1. Open Zen Browser
2. Go to **Settings** → **Sine**
3. Find **"Enable external marketplace"** option
4. **Enable** it (allows loading JavaScript from non-store sources)
5. Restart Zen Browser

Without this setting, Sine will only load CSS and ignore all JavaScript files!

### 2. Install ZenTabsManager

#### Option A: Via Sine's Built-in Installer (Recommended)

1. Open Zen Settings → **Sine Mods**
2. Click **"Install new mod"**
3. Paste this URL: `https://github.com/Tekka90/ZenTabsManager`
4. Click **Install**
5. Sine will automatically:
   - Download the repo
   - Read `theme.json`
   - Extract files to `sine-mods/zentabs-manager/`
   - Register in `mods.json`
6. Restart Zen Browser

#### Option B: Manual Installation (For Development)

1. Copy the repo folder to:
   ```
   ~/Library/Application Support/zen/Profiles/xxx.Default (release)/chrome/sine-mods/zentabs-manager/
   ```
2. Edit `chrome/sine-mods/mods.json` to add an entry for `zentabs-manager`.
3. Restart Zen Browser.

### 3. Verify Installation

1. Restart Zen Browser completely (Cmd+Q / Ctrl+Q, then reopen)
2. Open Browser Console (Cmd+Shift+J / Ctrl+Shift+J)
3. Look for:
   ```
   [ZenTabs] Loading...
   [ZenTabs] Manager created
   [ZenTabs] Initializing...
   ```

### 4. Test the Mod

In the Browser Console, run:

```javascript
window.ZenTabsManager
ZenTabsAPI.getVersion()
ZenTabsAPI.listAllTabs()
```

## Troubleshooting

### JavaScript Not Loading

**Symptom:** Mod shows in Sine settings but no console logs, no functionality

**Solution:** 
- Check if "External marketplace" is enabled in Sine settings
- This is the most common issue!
- Restart Zen after enabling

### Mod Not Appearing in Sine Settings

**Check:**
1. Sine is installed: Look for `chrome/JS/` and `chrome/sine-mods/` directories
2. ZenTabsManager files are in: `chrome/sine-mods/zentabs-manager/`
3. Registered in: `chrome/sine-mods/mods.json`

### Console Errors

Check the Browser Console (Cmd+Shift+J) for specific error messages:
- `Failed to load background script` - Check file paths in `theme.json`
- `allowUnsafeJS` - External marketplace not enabled
- Module errors - Check `engine/zen.sys.mjs` syntax

## File Structure

After installation, you should see:

```
~/Library/Application Support/zen/Profiles/xxx.Default (release)/
└── chrome/
    └── sine-mods/
        └── zentabs-manager/
            ├── theme.json
            ├── engine/
            │   ├── zen.sys.mjs
            │   └── zen.api.mjs
            ├── content/
            │   ├── TabManager.mjs
            │   ├── SyncManager.mjs
            │   ├── CleanupManager.mjs
            │   └── UI.mjs
            └── icons/
```

## Uninstallation

### Via Sine UI
1. Go to Settings → Sine Mods
2. Find "ZenTabs Manager"
3. Click the trash/remove button

### Manual
```bash
rm -rf ~/Library/Application\ Support/zen/Profiles/*/chrome/sine-mods/zentabs-manager
```

Then edit `chrome/sine-mods/mods.json` to remove the `zentabs-manager` entry.

## Security Note

Enabling "External marketplace" allows Sine to load JavaScript from third-party sources. Only install mods from sources you trust. Review the code in `engine/` before installation if you have security concerns.

## Support

If you encounter issues:
1. Check Browser Console for errors
2. Verify "External marketplace" is enabled
3. Ensure Sine is properly installed
4. Open an issue on GitHub with console logs
