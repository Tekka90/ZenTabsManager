#!/bin/bash

# ZenTabs Manager - Installer (Autoconfig Version)
# Installs ZenTabs Manager to Zen Browser using Firefox autoconfig

set -e

echo "🚀 ZenTabs Manager Installer (Autoconfig)"
echo "========================================="
echo ""

# Detect OS and set base directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    ZEN_DIR="$HOME/Library/Application Support/zen"
    
    # Try to find Zen app (could be "Zen.app" or "Zen Browser.app")
    if [ -d "/Applications/Zen.app" ]; then
        ZEN_APP="/Applications/Zen.app"
    elif [ -d "/Applications/Zen Browser.app" ]; then
        ZEN_APP="/Applications/Zen Browser.app"
    else
        echo "❌ Zen Browser not found in /Applications/"
        echo "   Looking for: Zen.app or Zen Browser.app"
        exit 1
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    ZEN_DIR="$HOME/.zen"
    ZEN_APP="/usr/lib/zen-browser"
    
    if [ ! -d "$ZEN_APP" ]; then
        echo "❌ Zen Browser not found at: $ZEN_APP"
        exit 1
    fi
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

echo "📱 Found Zen at: $ZEN_APP"

PROFILES_INI="$ZEN_DIR/profiles.ini"

if [ ! -f "$PROFILES_INI" ]; then
    echo "❌ Could not find profiles.ini at: $PROFILES_INI"
    echo "Make sure Zen Browser is installed and has been run at least once."
    exit 1
fi

# Find the active default profile from profiles.ini
# Look for [Install*] section with Default= entry
PROFILE_PATH=$(grep -A 2 "^\[Install" "$PROFILES_INI" | grep "^Default=" | head -n 1 | cut -d '=' -f 2)

if [ -z "$PROFILE_PATH" ]; then
    echo "⚠️  Could not auto-detect active profile."
    echo ""
    echo "Available profiles:"
    grep "^Path=" "$PROFILES_INI" | cut -d '=' -f 2
    echo ""
    read -p "Enter profile path (e.g., Profiles/xxx.Default): " PROFILE_PATH
fi

DEFAULT_PROFILE="$ZEN_DIR/$PROFILE_PATH"

if [ ! -d "$DEFAULT_PROFILE" ]; then
    echo "❌ Profile directory not found: $DEFAULT_PROFILE"
    exit 1
fi

CHROME_DIR="$DEFAULT_PROFILE/chrome"
INSTALL_DIR="$CHROME_DIR/zentabs"

echo "📁 Profile: $DEFAULT_PROFILE"
echo "📁 Install directory: $INSTALL_DIR"
echo ""

# Create chrome directory if needed
mkdir -p "$CHROME_DIR"

# Check if already installed
if [ -d "$INSTALL_DIR" ]; then
    echo "⚠️  ZenTabs Manager already installed"
    read -p "Overwrite? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Cancelled"
        exit 0
    fi
    rm -rf "$INSTALL_DIR"
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "📦 Installing mod files to profile..."

# Copy files to profile chrome directory
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/engine" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/content" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/icons" "$INSTALL_DIR/" 2>/dev/null || true

echo "✅ Mod files installed to profile"
echo ""
echo "📦 Installing autoconfig files (requires sudo)..."

# Install autoconfig files to Zen application directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    AUTOCONFIG_PREF="$ZEN_APP/Contents/Resources/defaults/pref"
    AUTOCONFIG_ROOT="$ZEN_APP/Contents/Resources"
else
    AUTOCONFIG_PREF="$ZEN_APP/defaults/pref"
    AUTOCONFIG_ROOT="$ZEN_APP"
fi

# Create pref directory if needed
sudo mkdir -p "$AUTOCONFIG_PREF"

# Copy autoconfig files
sudo cp "$SCRIPT_DIR/autoconfig.js" "$AUTOCONFIG_PREF/"
sudo cp "$SCRIPT_DIR/zentabs-autoconfig.cfg" "$AUTOCONFIG_ROOT/"

echo "✅ Autoconfig files installed"
echo ""

# No need for zen-themes.json with autoconfig approach
# Remove it if it exists to avoid confusion
ZEN_THEMES_JSON="$DEFAULT_PROFILE/zen-themes.json"

if [ -f "$ZEN_THEMES_JSON" ]; then
    # Remove old zen-themes.json entry (not needed with autoconfig)
    python3 -c "
import json
zen_themes_file = '$ZEN_THEMES_JSON'
try:
    with open(zen_themes_file, 'r') as f:
        content = f.read().strip()
        mods = json.loads(content) if content else {}
    if 'zentabs-manager' in mods:
        del mods['zentabs-manager']
        with open(zen_themes_file, 'w') as f: 
            json.dump(mods, f, indent=2)
        print('Removed old zen-themes.json entry')
except: 
    pass
"
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Files installed:"
echo "  - Profile: $INSTALL_DIR/"
echo "  - Autoconfig: $AUTOCONFIG_PREF/autoconfig.js"
echo "  - Config: $AUTOCONFIG_ROOT/zentabs-autoconfig.cfg"
echo ""
echo "🔄 Next steps:"
echo "  1. Restart Zen Browser COMPLETELY (Cmd+Q then reopen)"
echo "  2. Open Browser Console (Cmd+Shift+J)"
echo "  3. Look for: '[ZenTabs]: Autoconfig initialized' and '[ZenTabs]: Successfully loaded'"
echo ""
echo "⌨️  Test in the console:"
echo "  window.ZenTabsManager"
echo "  ZenTabsAPI.getVersion()"
echo "  ZenTabsAPI.listAllTabs()"
echo ""
echo "⚠️  Note: Autoconfig files will be overwritten when Zen Browser updates."
echo "   You'll need to re-run this installer after major updates."
echo ""
