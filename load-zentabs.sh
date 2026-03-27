#!/bin/bash

# ZenTabs Manager - Quick Loader
# Creates a bookmarklet to easily load ZenTabs

PROFILE_DIR="$HOME/Library/Application Support/zen/Profiles"
DEFAULT_PROFILE=$(find "$PROFILE_DIR" -maxdepth 1 -type d -name "*.Default*" | head -n 1)

if [ -z "$DEFAULT_PROFILE" ]; then
    echo "❌ Could not find Zen Browser profile"
    exit 1
fi

echo "📝 ZenTabs Manager - Manual Loader"
echo "=================================="
echo ""
echo "Since auto-loading doesn't work yet, use one of these methods:"
echo ""
echo "Method 1: Browser Console (Recommended)"
echo "  1. Open Zen Browser"
echo "  2. Press Cmd+Shift+J (macOS) or Ctrl+Shift+J (Linux)"
echo "  3. Paste this command:"
echo ""
echo '  import("chrome://zentabs/content/engine/zen.sys.mjs")'
echo ""
echo "  4. Press Enter"
echo ""
echo "Method 2: Create a bookmarklet"
echo "  1. Create a new bookmark"
echo "  2. Set the URL to:"
echo ""
echo "  javascript:(async()=>{await import('chrome://zentabs/content/engine/zen.sys.mjs');})()"
echo ""
echo "  3. Click the bookmark when Zen starts"
echo ""
echo "Method 3: Enable userChrome.js support"
echo "  1. Go to about:config in Zen"
echo "  2. Search for: toolkit.legacyUserProfileCustomizations.script"
echo "  3. Set it to: true"
echo "  4. Restart Zen (ZenTabs will auto-load)"
echo ""
echo "Once loaded, verify with:"
echo "  ZenTabsAPI.getVersion()"
echo ""
