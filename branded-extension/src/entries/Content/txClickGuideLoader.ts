type ClickGuideLoaderGlobal = typeof globalThis & {
  __peerTxClickGuideVersion?: string;
};

(() => {
  const runtimeVersion = (() => {
    try {
      return chrome.runtime.getManifest().version;
    } catch {
      return 'unknown';
    }
  })();
  const globalState = globalThis as ClickGuideLoaderGlobal;

  if (globalState.__peerTxClickGuideVersion === runtimeVersion) {
    return;
  }

  globalState.__peerTxClickGuideVersion = runtimeVersion;
  const url = chrome.runtime.getURL('txClickGuide.bundle.js');

  import(/* @vite-ignore */ url).catch((error) => {
    console.error('[TxClickGuideLoader] Failed to load click guide', error);
  });
})();
