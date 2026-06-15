import manifest from '../manifest.json';

const MANIFEST_VERSION =
  typeof manifest?.version === 'string' && manifest.version.trim() !== ''
    ? manifest.version
    : undefined;
let cachedVersion: string | null = null;

// Get version from the extension manifest
export function getManifestVersion(): string {
  if (cachedVersion) {
    return cachedVersion;
  }

  try {
    // In Chrome extensions, we can access the manifest through the runtime API
    if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
      cachedVersion = chrome.runtime.getManifest().version;
      return cachedVersion;
    }
    if (typeof (globalThis as any)?.browser !== 'undefined') {
      const runtime = (globalThis as any).browser?.runtime;
      if (runtime?.getManifest) {
        const version = runtime.getManifest().version;
        if (typeof version === 'string' && version.trim() !== '') {
          cachedVersion = version;
          return cachedVersion;
        }
      }
    }
  } catch {
    // Fall through to default below.
  }

  // Fallback version if manifest is not available (e.g., during development)
  if (MANIFEST_VERSION) {
    cachedVersion = MANIFEST_VERSION;
    return cachedVersion;
  }

  if (import.meta.env.DEV) {
    cachedVersion = 'dev';
    return cachedVersion;
  }

  cachedVersion = 'unknown';
  return cachedVersion;
}
