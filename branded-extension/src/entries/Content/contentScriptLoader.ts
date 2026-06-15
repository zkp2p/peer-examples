type LoaderGlobal = typeof globalThis & {
  __peerContentScriptVersion?: string;
};

// Load the ESM content script from a classic content-script context.
(() => {
  const runtimeVersion = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return 'unknown';
    }
  })();
  const globalState = globalThis as LoaderGlobal;

  if (globalState.__peerContentScriptVersion === runtimeVersion) {
    return;
  }

  globalState.__peerContentScriptVersion = runtimeVersion;
  const url = chrome.runtime.getURL('contentScript.bundle.js');

  import(/* @vite-ignore */ url).catch((error) => {
    console.error('[ContentScriptLoader] Failed to load content script', error);
  });
})();
