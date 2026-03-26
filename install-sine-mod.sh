#!/bin/bash

# ZenTabs Manager - Sine Mod Installer
# Installs the mod to Zen Browser's mods directory

set -e

echo "🚀 ZenTabs Manager - Sine Mod Installer"
echo "========================================"
echo ""

# Detect OS and set mod directory
if [[ "$OSTYPE" == "darwin"* ]]; then
    MODS_DIR="$HOME/Library/Application Support/zen/mods"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    MODS_DIR="$HOME/.zen/mods"
else
    echo "❌ Unsupported OS: $OSTYPE"
    echo "Please manually copy this folder to your Zen mods directory"
    exit 1
fi

echo "📁 Zen mods directory: $MODS_DIR"
echo ""

# Create mods directory if it doesn't exist
if [ ! -d "$MODS_DIR" ]; then
    echo "📁 Creating mods directory..."
    mkdir -p "$MODS_DIR"
fi

# Check if zentabs-manager already exists
if [ -d "$MODS_DIR/zentabs-manager" ]; then
    echo "⚠️  ZenTabs Manager already installed"
    read -p "Do you want to overwrite it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Installation cancelled"
        exit 0
    fi
    rm -rf "$MODS_DIR/zentabs-manager"
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "📦 Installing ZenTabs Manager..."

# Copy the entire directory
cp -r "$SCRIPT_DIR" "$MODS_DIR/zentabs-manager"

# Remove unnecessary files from the installation
cd "$MODS_DIR/zentabs-manager"
rm -f install-sine-mod.sh
rm -f install-permanent.sh
rm -rf .git
rm -f .gitignore

echo ""
echo "✅ Installation complete!"
echo ""
echo "📋 Next steps:"
echo "  1. Restart Zen Browser"
echo "  2. Open Browser Console (Cmd+Shift+J)"
echo "  3. Look for: '✅ ZenTabs Manager initialized successfully'"
echo "  4. Click the ZenTabs button in your toolbar"
echo ""
echo "⌨️  Keyboard shortcuts:"
echo "  • Cmd+Shift+L - List all tabs"
echo "  • Cmd+Shift+B - Sync to bookmarks"
echo "  • Cmd+Shift+M - Optimize memory"
echo "  • Cmd+Shift+K - Cleanup old tabs"
echo ""
echo "📖 Full documentation: README-SINE-MOD.md"
echo ""
