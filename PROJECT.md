# 🚀 ZenTabs Manager - Sine Mod for Zen Browser

> Advanced tab management with bi-directional bookmark sync, memory optimization, automatic cleanup, and intelligent tab organization.

## 📦 Installation (One Command)

```bash
cd /Users/stephane/ZenTabs
./install-sine-mod.sh
```

**Then restart Zen Browser** and you're done! ✅

## ✨ Quick Start

After installation:

1. **Look for the toolbar button** - "ZenTabs" button in your toolbar
2. **Try keyboard shortcuts**:
   - `Cmd+Shift+L` - List all tabs
   - `Cmd+Shift+B` - Sync to bookmarks
   - `Cmd+Shift+M` - Optimize memory
   - `Cmd+Shift+K` - Cleanup old tabs

3. **Or use the Console API**:
   ```javascript
   // Open Browser Console (Cmd+Shift+J)
   await ZenTabsAPI.listAllTabs();
   await ZenTabsAPI.getStatistics();
   ```

## 📚 Documentation

- **[QUICKSTART.md](QUICKSTART.md)** - Quick start guide with examples
- **[README.md](README.md)** - Complete documentation (below)
- **[WHATS-BUILT.md](WHATS-BUILT.md)** - Architecture and features overview
- **[archive/](archive/)** - Old implementation (userChrome.js approach)

---

## 📂 Project Structure

```
zentabs-manager/           # Sine mod root
├── engine.json            # Mod manifest + preferences
├── engine/
│   ├── sine.api.mjs      # Public API (18 methods)
│   └── sine.sys.mjs      # System initialization
├── content/
│   ├── TabManager.mjs    # Tab operations & metadata
│   ├── SyncManager.mjs   # Bi-directional sync
│   ├── CleanupManager.mjs # Cleanup & memory optimization
│   ├── UI.mjs            # GUI components
│   └── browser.mjs       # Browser integration
├── icons/                # Mod icons (future)
├── install-sine-mod.sh   # One-command installer
├── README.md             # This file
├── QUICKSTART.md         # Quick start guide
├── WHATS-BUILT.md        # Architecture overview
└── archive/              # Old implementations
```

---

# Complete Documentation

[Rest of the README.md content continues as before...]
