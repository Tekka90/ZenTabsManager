#!/bin/bash

# ZenTabs Manager - Sine Mod Installer
# Installs ZenTabsManager as a Sine mod

set -e

echo "🚀 ZenTabs Manager - Sine Mod Installer"
echo "========================================"
echo ""

# Detect OS and set base directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    ZEN_DIR="$HOME/Library/Application Support/zen"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    ZEN_DIR="$HOME/.zen"
else
    echo "❌ Unsupported OS: $OSTYPE"
    exit 1
fi

PROFILES_INI="$ZEN_DIR/profiles.ini"

if [ ! -f "$PROFILES_INI" ]; then
    echo "❌ Could not find profiles.ini at: $PROFILES_INI"
    echo "Make sure Zen Browser is installed and has been run at least once."
    exit 1
fi

# Find the active default profile
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
SINE_MODS_DIR="$CHROME_DIR/sine-mods"
MOD_ID="zentabs-manager"
INSTALL_DIR="$SINE_MODS_DIR/$MOD_ID"
MODS_JSON="$SINE_MODS_DIR/mods.json"

echo "📁 Profile: $DEFAULT_PROFILE"
echo "📁 Sine mods directory: $SINE_MODS_DIR"
echo ""

# Check if Sine is installed
if [ ! -d "$SINE_MODS_DIR" ]; then
    echo "❌ Sine mods directory not found!"
    echo ""
    echo "Please install Sine first:"
    echo "  https://github.com/CosmoCreeper/Sine"
    echo ""
    exit 1
fi

if [ ! -f "$MODS_JSON" ]; then
    echo "⚠️  mods.json not found, creating..."
    echo "{}" > "$MODS_JSON"
fi

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

echo "📦 Installing mod files..."

# Copy files to Sine mod directory
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR/engine" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/content" "$INSTALL_DIR/"
cp -r "$SCRIPT_DIR/icons" "$INSTALL_DIR/" 2>/dev/null || true
cp "$SCRIPT_DIR/theme.json" "$INSTALL_DIR/" 2>/dev/null || true

echo "✅ Mod files installed"
echo ""
echo "📝 Registering in mods.json..."

# Register in Sine's mods.json
python3 -c "
import json
import sys

mods_file = '$MODS_JSON'
mod_id = '$MOD_ID'

try:
    with open(mods_file, 'r') as f:
        content = f.read().strip()
        mods = json.loads(content) if content else {}
except:
    mods = {}

# Add our mod
mods[mod_id] = {
    'id': mod_id,
    'name': 'ZenTabs Manager',
    'description': 'Advanced tab management with auto-sync to bookmarks, memory optimization, and intelligent cleanup',
    'version': '1.0.0',
    'homepage': 'https://github.com/Tekka90/ZenTabsManager',
    'updatedAt': '2026-03-27',
    'enabled': True,
    'scripts': {
        'engine/zen.sys.mjs': {}
    },
    'style': {},
    'preferences': ''
}

with open(mods_file, 'w') as f:
    json.dump(mods, f, indent=2)

print('✅ Registered in mods.json')
"

if [ $? -ne 0 ]; then
    echo "❌ Failed to register mod"
    exit 1
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Files installed:"
echo "  - $INSTALL_DIR/"
echo "  - Registered in: $MODS_JSON"
echo ""
echo "🔄 Next steps:"
echo "  1. Restart Zen Browser COMPLETELY (Cmd+Q then reopen)"
echo "  2. Open Browser Console (Cmd+Shift+J)"
echo "  3. Look for: '[ZenTabs] Loading...' and initialization messages"
echo "  4. Go to Zen Settings → Sine Mods to enable/disable the mod"
echo ""
echo "⌨️  Test in the console:"
echo "  window.ZenTabsManager"
echo "  ZenTabsAPI.getVersion()"
echo "  ZenTabsAPI.listAllTabs()"
echo ""
