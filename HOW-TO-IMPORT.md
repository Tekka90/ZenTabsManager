# 🚀 How to Install ZenTabs Manager

## ✅ Recommended Method: Use the Installer

```bash
cd /path/to/ZenTabs
./install-sine-mod.sh
```

This copies the mod to Zen's mods folder and works reliably.

## Alternative: Import via Zen's UI

1. **Open Zen Browser** → Sine Mods settings
2. **Click Import**
3. **Select `engine.json`** from your ZenTabs folder
4. **Restart Zen**

**Note:** Import expects `engine.json` files, not packages.

## Verify Installation

Open Browser Console (`Cmd+Shift+J`) and look for:
```
✅ ZenTabs Manager initialized successfully
```

Test the API:
```javascript
ZenTabsAPI.getVersion()  // Should return "1.0.0"
```

## Troubleshooting

### "mods is not iterable" Error

This was fixed! The mod now exports:
```javascript
export const mods = [ /* mod definition */ ]
```

If you still see this:
1. Remove any existing zentabs-manager from Zen
2. Run `./install-sine-mod.sh` fresh
3. Restart Zen

### Features Not Working

Check Browser Console for errors and verify:
```javascript
typeof ZenTabsAPI  // Should be "object"
```

---

**Quick Start:** Just run `./install-sine-mod.sh` and restart Zen! 🚀
