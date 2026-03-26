# Zen Browser & Sine Extension Development Knowledge

This document captures key learnings about Zen Browser and Sine for future development reference.

**Last Updated**: March 25, 2026 - Added comprehensive folder/tree system documentation

## Zen Browser Overview

**Zen Browser** is a Firefox-based browser focused on productivity and a calmer internet experience.

- **Repository**: https://github.com/zen-browser/desktop
- **Documentation**: https://docs.zen-browser.app/
- **Website**: https://zen-browser.app/
- **Base**: Built on Firefox (currently version 149.0)
- **License**: MPL-2.0

### Key Zen Browser Features

1. **Workspaces**: Organize tabs by projects with custom containers
2. **Vertical Tab Bar**: Side panel for improved tab management
3. **Essential Tabs**: Special category of persistent pinned tabs (unique to Zen)
4. **Tab Folders/Trees**: Organize pinned tabs in hierarchical folders (up to 5 levels deep)
5. **Split View**: Open multiple tabs side by side
6. **Glance**: Preview websites on top of your current tab
7. **Compact Mode**: Minimalistic interface for focused browsing
8. **Window Sync**: Opened windows mirror with each other instantly

## Zen Browser Tab System

Zen Browser has **three types of tabs**, which is different from standard Firefox:

### 1. Essential Tabs (`zen-essential` attribute)

- **What they are**: User-designated special pinned tabs
- **How to add**: Right-click tab → "Add to Essential" (context menu)
- **Location in UI**: Separate section at the top of the vertical tab bar
- **Limit**: Default maximum of 12 essential tabs (configurable via `zen.tabs.essentials.max` pref)
- **Behavior**:
  - Cannot be closed with regular close button
  - More permanent than pinned tabs
  - Have both `pinned="true"` AND `zen-essential="true"` attributes
  - Display in `.zen-essentials-container` element
  - Can have custom icons set via `tab.zenStaticIcon`
  - Icon stored in `--zen-essential-tab-icon` CSS property

### 2. Pinned Tabs (standard Firefox)

- **What they are**: Regular Firefox pinned tabs WITHOUT `zen-essential` attribute
- **Location**: `.zen-workspace-pinned-tabs-section`
- **Behavior**: Standard Firefox pinned tab behavior
- **Attributes**: `pinned="true"` but NO `zen-essential` attribute

### 3. Normal Tabs

- **What they are**: Regular browsing tabs
- **Location**: `.zen-workspace-normal-tabs-section`
- **Behavior**: Standard unpinned tabs
- **Attributes**: Neither `pinned` nor `zen-essential`

## Zen Browser Tab Folder/Tree System

Zen Browser allows organizing pinned tabs in **folders and subfolders** for better organization.

### Overview

- **Global API**: `window.gZenFolders` (instance of `nsZenFolders` class)
- **Max nesting depth**: 5 levels (configurable via `zen.folders.max-subfolders`)
- **All tabs in folders are automatically pinned**: `tab.pinned === true`
- **Folders themselves are also pinned**: `folder.pinned === true`

### Folder Element Detection

```javascript
// Check if element is a folder
if (element.isZenFolder) {
  // It's a folder (zen-folder element)
}

// Or check the tag name
if (element.tagName === "zen-folder") {
  // It's a folder
}

// Check if a tab is inside a folder
if (tab.group && tab.group.isZenFolder) {
  // Tab is inside a folder
}
```

### Folder Properties

| Property | Type | Description |
|----------|------|-------------|
| `.isZenFolder` | Boolean | Always `true` for folders |
| `.group` | nsZenFolder\|null | Parent folder (null if top-level) |
| `.level` | Number | Nesting depth (0-based, max 4) |
| `.collapsed` | Boolean | Whether folder is collapsed |
| `.tabs` | Array | All tabs in the folder |
| `.activeTabs` | Array | Tabs visible when collapsed |
| `.activeGroups` | Array | Ancestor folders with active tabs |
| `.allItems` | Array | Direct children (tabs/subfolders) |
| `.allItemsRecursive` | Array | All descendants recursively |
| `.groupContainer` | Element | DOM container for children |
| `.label` | String | Folder name |

### Folder Attributes

```javascript
// Folder HTML attributes
folder.hasAttribute("has-active")  // Folder has active/visible tabs when collapsed
folder.id                           // Unique folder ID (timestamp-based)
```

### Tab Properties (When in Folder)

```javascript
tab.group                  // Parent folder containing this tab (nsZenFolder object)
tab.pinned                 // Always true for tabs in folders
tab.visible                // false if in collapsed folder
tab.hasAttribute("folder-active")  // Tab is active in collapsed parent folder
tab.hasAttribute("zen-empty-tab")  // Placeholder tab (first tab in folder)
```

### Getting Folder Hierarchy

```javascript
// Get a tab's parent folder
const parentFolder = tab.group;

// Get full folder path
function getFolderPath(element) {
  const path = [];
  let current = element;
  
  while (current) {
    if (current.isZenFolder) {
      path.unshift(current.label || 'Unnamed Folder');
    }
    current = current.group;
  }
  
  return path.length > 0 ? path.join(' / ') : null;
}

// Get folder nesting level
const level = folder.level; // 0 = top-level, 1 = subfolder, etc.

// Get all ancestor folders
const ancestors = folder.activeGroups; // Array from innermost to outermost

// Get all children (tabs and subfolders)
const directChildren = folder.allItems;

// Get all descendants recursively
const allDescendants = folder.allItemsRecursive;
```

### Folder Visibility and Collapsing

```javascript
// Check if folder is collapsed
if (folder.collapsed) {
  // Only tabs with 'folder-active' attribute are visible
  const visibleTabs = folder.activeTabs;
} else {
  // All tabs are visible
  const visibleTabs = folder.tabs;
}

// Check if tab is visible
if (tab.visible === false) {
  console.log("Tab is hidden in a collapsed folder");
}
```

### Visual Indentation

```javascript
// Folders use CSS variables for indentation (14px per level)
const indent = tab.style.getPropertyValue('--zen-folder-indent');
// e.g., "28px" for level 2 (14px * 2)
```

### Example: Walking the Folder Tree

```javascript
function displayFolderStructure(element, indent = 0) {
  const prefix = '  '.repeat(indent);
  
  if (element.isZenFolder) {
    console.log(`${prefix}📁 ${element.label} (level: ${element.level}, collapsed: ${element.collapsed})`);
    
    // Iterate through children
    for (const child of element.allItems) {
      displayFolderStructure(child, indent + 1);
    }
  } else if (element.tagName === 'tab') {
    const isActive = element.hasAttribute('folder-active');
    const isVisible = element.visible;
    console.log(`${prefix}📄 ${element.label} (active: ${isActive}, visible: ${isVisible})`);
  }
}

// Get all top-level folders
const allFolders = document.querySelectorAll('zen-folder');
allFolders.forEach(folder => {
  if (folder.level === 0) {
    displayFolderStructure(folder);
  }
});
```

### Folder Session Storage Structure

```javascript
{
  id: "folder-id",
  parentId: "parent-folder-id", // null for top-level folders
  name: "Folder Name",
  collapsed: true/false,
  emptyTabIds: ["tab-id-1"], // Empty placeholder tabs
  level: 0, // Nesting depth
}
```

### WebExtension Limitations with Folders

**WebExtensions CANNOT access folder information** because:
- Folder structure exists in browser chrome
- `browser.tabs.query()` doesn't expose `tab.group` or folder properties
- No API to detect if a tab is in a folder
- No way to get folder hierarchy

**Workarounds**: None - requires chrome access (userChrome.js, Sine, or Browser Console)

## Key Zen Browser Code Patterns

### Tab Manager Location

```
src/zen/tabs/
├── ZenEssentialsPromo.mjs    # Essential tabs promo/onboarding
├── ZenPinnedTabManager.mjs   # Main tab management logic
└── zen-tabs/                 # Tab UI components
```

### Important Zen APIs & Functions

```javascript
// Essential Tabs Management
gZenPinnedTabManager.addToEssentials(tab);
gZenPinnedTabManager.removeEssentials(tab, unpin = true);
gZenPinnedTabManager.canEssentialBeAdded(tab);
gZenPinnedTabManager.maxEssentialTabs; // Default: 12

// Essential Tab Detection
tab.hasAttribute("zen-essential");

// Workspace Management
gZenWorkspaces.getEssentialsSection(container);

// Folder/Tree Management (NEW!)
gZenFolders                        // Folder manager instance
tab.group                          // Get parent folder
tab.group.isZenFolder             // Check if parent is folder
tab.group.label                   // Folder name
tab.group.level                   // Nesting depth (0-4)
tab.group.collapsed               // Is folder collapsed?
tab.group.tabs                    // All tabs in folder
tab.group.activeTabs              // Visible tabs when collapsed
tab.group.allItems                // Direct children
tabEssential Tabs
"zen.tabs.essentials.max"  // Maximum essential tabs (default: 12)

// Pinned Tab Behaviors
"zen.pinned-tab-manager.restore-pinned-tabs-to-pinned-url"
"zen.pinned-tab-manager.close-shortcut-behavior"
"zen.pinned-tab-manager.wheel-close-if-pending"

// Folder/Tree Settings
"zen.folders.max-subfolders"  // Maximum nesting depth (default: 5)
```javascript
// Maximum essential tabs (default: 12)
"zen.tabs.essentials.max"

// Pinned tab behaviors
"zen.pinned-tab-manager.restore-pinned-tabs-to-pinned-url"
"zen.pinned-tab-manager.close-shortcut-behavior"
"zen.pinned-tab-manager.wheel-close-if-pending"
```

## WebExtensions API Limitations with Zen

### Critical Limitations

**Problem**: WebExtensions cannot access Zen's custom features because they exist in the browser chrome (XUL/HTML UI layer):

1. **Cannot access `zen-essential` attribute**
   - It exists in browser chrome, not exposed via WebExtensions API
   - `browser.tabs.query()` only returns standard Firefox properties

2. **Cannot access folder/tree structure**
   - Folder hierarchy (`tab.group`) not exposed to WebExtensions
   - No way to detect if tab is in a folder
   - Cannot get folder names, nesting level, or collapsed state

**Impact**: WebExtensions cannot accurately:
- Differentiate between Essential tabs and regular pinned tabs
- Detect if tabs are organized in folders/subfolders
- Get folder hierarchy information
- Determine if tabs are hidden in collapsed folders

### Workaround for WebExtensions

Since WebExtensions cannot detect `zen-essential`, use approximation:

```javascript
// Approximate essentials as first N pinned tabs
const essentialThreshold = 12; // Match Zen's default
const pinnedTabs = tabs.filter(t => t.pinned);
const tabIndexInPinned = pinnedTabs.findIndex(t => t.id === tab.id);

const isEssential = tab.pinned && tabIndexInPinned < essentialThreshold;
const isPinned = tab.pinned && !isEssential;
```

**Accuracy**: ~80-90% accurate if user follows typical Zen usage patterns

### What WebExtensions CAN Access

```javascript
browser.tabs.query({}).then(tabs => {
  tabs.forEach(tab => {
    // ✅ Available in WebExtensions
    tab.id              // Tab ID
    tab.title           // Page title
    tab.url             // Current URL
    tab.favIconUrl      // Favicon URL
    tab.pinned          // Is pinned (true/false)
    tab.active          // Is currently active
    tab.discarded       // Is unloaded from memory
    // tab.group (folder information)
    // tab.group.label (folder name)
    // tab.group.level (folder nesting)
    // tab.visible (visibility in collapsed folders)
    tab.windowId        // Parent window ID
    tab.index           // Position in tab strip
    
    // ❌ NOT available in WebExtensions
    // tab.getAttribute("zen-essential")
    // tab.zenStaticIcon
    // tab.hasAttribute("zen-workspace-id")
  });
});
```

## Sine: Theme/Mod Manager for Firefox-based Browsers

**Sine** is a completely different technology from WebExtensions.

- **Repository**: https://github.com/CosmoCreeper/Sine
- **Type**: JavaScript mod/theme manager (NOT a browser extension framework)
- **Purpose**: Inject mods and themes into Firefox-based browsers
- **Method**: Uses UserChrome.js-style modifications
- **Installation**: Runs an installer that injects itself into browser settings

### What Sine Is

- A **mod manager** (like a plugin system for the browser itself)
- Injects into the Firefox settings page
- Provides a marketplace for mods and themes
- Uses JavaScript modules (`.sys.mjs` files)
- Has full access to browser internals (chrome, XUL, etc.)

### Sine vs WebExtensions

| Feature | Sine Mod | WebExtension |
|---------|----------|--------------|
| **Access Level** | Full browser chrome access | Sandboxed, limited API |
| **Can read zen-essential** | ✅ Yes, full DOM access | ❌ No, API limitation |
| **Installation** | Via Sine mod manager | Standard extension install |
| **Distribution** | Sine marketplace | AMO or manual XPI |
| **Security** | Runs with full privileges | Sandboxed environment |
| **Browser API** | Direct Firefox/Zen internals | WebExtensions API only |
| **File Type** | `.sys.mjs` modules | `manifest.json` + JS |
| **Update Mechanism** | Through Sine | Through browser updates |
| **Compatibility(or userChrome.js) when:**
- ✅ Need access to browser chrome/internal UI
- ✅ Need to read Zen-specific attributes (zen-essential, zen-workspace-id)
- ✅ Need to access folder/tree structure
- ✅ Need to modify browser UI deeply
- ✅ Need to integrate with Zen's internal APIs
- ✅ Target audience has Sine installed or can use userChrome.js

**Use a WebExtension when:**
- ✅ Want easy distribution and installation
- ✅ Need to work across all Firefox installations
- ✅ Security and sandboxing are important
- ✅ Only need standard browser APIs
- ✅ Can work with approximations/limitations
- ❌ Accept that Essential tabs and folders won't be detectable
- ✅ Need to work across all Firefox installations
- ✅ Security and sandboxing are important
- ✅ Only need standard browser APIs
- ✅ Can work with approximations/limitations

## Sine Mod Structure

Based on Sine repository structure:

```
sine-mod/
├── engine/           # Core mod engine files
├── locales/          # Internationalization
├── scripts/          # Build and automation scripts
├── engine.json       # Mod metadata and configuration
└── sine.sys.mjs      # Main system module
```

### Sine Mod Example

A Sine mod would have full access to Zen's internals:

```javascript
// In a Sine mod, you CAN do this:
const tabs = gBrowser.tabs;
tabs.forEach(tab => {
  // ✅ Direct access to zen-essential attribute
  const isEssential = tab.hasAttribute("zen-essential");
  
  // ✅ Access to folder/tree structure
  if (tab.group && tab.group.isZenFolder) {
    const folderPath = getFolderPath(tab);
    const level = tab.group.level;
    const collapsed = tab.group.collapsed;
  }
  
  // ✅ Access to Zen's internal& Folder Detection

**Option 1: WebExtension**
- Pros: Easy to install, portable, secure
- Cons: ~80-90% accuracy on essential detection, NO folder detection
- Best for: General tab management where approximations are acceptable

**Option 2: userChrome.js Script (RECOMMENDED)**
- Pros: 100% accurate, full Zen integration, simpler than Sine
- Cons: Requires userChrome.js loader (fx-autoconfig)
- Best for: Most users who want full Zen feature access

**Option 3: Sine Mod**
- Pros: 100% accurate, full Zen integration, marketplace distribution
- Cons: Requires Sine installed, more complex architecture
- Best for: Power users, complex mods with UI integration

**Option 4: Browser Console Scripts (SIMPLEST)**
- Pros: No installation, works immediately, 100% accurate
- Cons: Must run manually each time
- Best for: Testing, debugging, one-off queries

**Option 5: Hybrid Approach**
- Create a WebExtension for general users (with limitations documented)
- Provide a userChrome.js script for power users who want full
**Option 1: WebExtension (Current Project)**
- Pros: Easy to install, portable, secure
- Cons: ~80-90% accuracy on essential detection
- Best for: General tab management, most users

**Option 2: Sine Mod (Alternative)**
- Pros: 100% accurate, full Zen integration
- Cons: Requires Sine installed, more complex
- Best for: Power users, deep Zen integration

**Option 3: Hybrid Approach**
- Create both: A WebExtension for general users
- And a Sine mod for power users who want 100% accuracy
- Share common logic between both

## Useful Zen Browser Source Files

Key zen/tabs/zen-folders/
- Folder/tree management system
- Folder creation, nesting, collapsing
- Folder hierarchy logic

src/files for understanding Zen's tab system:

```
src/zen/tabs/ZenPinnedTabManager.mjs
- Main essential/pinned tab logic
- addToEssentials(), removeEssentials()
- Tab movement and drag-drop handling

src/zen/tabs/ZenEssentialsPromo.mjs
- Essential tabs onboarding/promo UI

src/browser/components/zen-workspace/
- Workspace management
- Container tab logic

src/zen/mods/
- Sine mod integration points
```

## Memory Status Tracking

Both WebExtensions and Sine mods can accurately track:

```javascript
// ✅ Works in WebExtensions
tab.discarded === true   // Tab is unloaded from memory
tab.discarded === false  // Tab is loaded in memory

// Browser can unload tabs to save memory
// User can manually unload via Zen's tab context menu
```

## Context Menu Integration (Zen-specific)

In Zen's tab context menu:

```javascript
// Essential Tabs
context_zen-add-essential          // Add to Essential
context_zen-remove-essential       // Remove from Essential
context_zen-reset-pinned-tab       // Reset pinned tab
context_zen-replace-pinned-url-with-current
context_zen-edit-tab-title         // Edit tab title
context_zen-edit-tab-icon          // Edit tab icon

// Folders (context menu on tabs and folders)
context_zen-create-folder          // Create new folder
context_zen-add-to-folder          // Add tab to folder
context_zen-remove-from-folder     // Remove tab from folder
context_zen-rename-folder          // Rename folder
context_zen-delete-folder          // Delete folder
context_zen-collapse-folder        // Collapse/expand folder
```

## Summary

- **Zen Browser** is a Firefox-based browser with unique tab management features
- **Essential Tabs** are a Zen-specific feature (pinned + zen-essential attribute)
- **Tab Folders/Trees** allow organizing pinned tabs in hierarchical structures (up to 5 levels)
- **WebExtensions** cannot access zen-essential or folder structure due to API limitations
- **userChrome.js** provides 100% accurate access to all Zen features (RECOMMENDED)
- **Sine** is a mod manager (not extension framework) with full browser access
- **Browser Console** provides immediate chrome access for testing and one-off queries
- **For 100% accuracy**: Use userChrome.js, Sine mod, or Browser Console scripts
- **For portability**: Use WebExtensions but document Essential tab and folder limitations

## Resources

- Zen Browser: https://github.com/zen-browser/desktop
- Zen Docs: https://docs.zen-browser.app/
- Sine: https://github.com/CosmoCreeper/Sine
- Firefox WebExtensions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions
- Zen Discord: https://discord.gg/zen-browser (for community support)
