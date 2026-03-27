// ZenTabs Manager - Auto Loader
// Place this file in: chrome/zentabs/loader.sys.mjs

console.log("[ZenTabs] Loader starting...");

// Auto-load ZenTabs Manager when Zen starts
(async function() {
  try {
    const { default: manager } = await import("./zen.sys.mjs");
    console.log("[ZenTabs] Loaded via autoloader");
  } catch (error) {
    console.error("[ZenTabs] Autoload failed:", error);
  }
})();
