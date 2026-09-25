import type { PeerCapturePlugin } from '@utils/types/captureProgram';
import { Mutex } from 'async-mutex';

import { assertCapturePlugin, capturePluginDigest } from './capturePlugin';
import { isAutoApprovedConnectionHost } from './trustedPeerDomains';

const CONNECTED_SITES_KEY = 'peer.connectedSites.v1';
const CAPTURE_PLUGINS_KEY = 'peer.capturePlugins.v4';
const MAX_SAVED_CAPTURE_PLUGINS = 50;
const pluginStorageMutex = new Mutex();
const connectionStorageMutex = new Mutex();

export type ConnectedSiteRecord = {
  hostname: string;
  origin: string;
};

type StoredCapturePlugin = {
  plugin: PeerCapturePlugin;
  sourceOrigin: string;
};

export type CapturePluginRecord = StoredCapturePlugin & {
  digest: string;
};

export type ExtensionManagerState = {
  connectedSites: ConnectedSiteRecord[];
  plugins: CapturePluginRecord[];
};

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function assertConnectedSite(value: unknown): ConnectedSiteRecord {
  const record = assertRecord(value, 'Saved connected site');
  if (typeof record.origin !== 'string') {
    throw new Error('Saved connected site is invalid.');
  }
  const url = new URL(record.origin);
  if (url.origin !== record.origin) {
    throw new Error('Saved connected site is invalid.');
  }
  return { hostname: url.hostname, origin: url.origin };
}

function assertStoredCapturePlugin(value: unknown): StoredCapturePlugin {
  const record = assertRecord(value, 'Saved capture plugin');
  if (typeof record.sourceOrigin !== 'string') {
    throw new Error('Saved capture plugin is invalid.');
  }
  const pluginValue = assertRecord(record.plugin, 'Saved capture plugin');
  if (typeof pluginValue.id !== 'string') {
    throw new Error('Saved capture plugin is invalid.');
  }
  return {
    plugin: assertCapturePlugin(pluginValue, pluginValue.id),
    sourceOrigin: new URL(record.sourceOrigin).origin,
  };
}

async function getStoredCapturePlugins(): Promise<StoredCapturePlugin[]> {
  const stored = await chrome.storage.local.get(CAPTURE_PLUGINS_KEY);
  const values = stored[CAPTURE_PLUGINS_KEY];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error('Saved capture plugins are invalid.');
  return values.map(assertStoredCapturePlugin);
}

export async function getConnectedSites(): Promise<ConnectedSiteRecord[]> {
  const stored = await chrome.storage.local.get(CONNECTED_SITES_KEY);
  const values = stored[CONNECTED_SITES_KEY];
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new Error('Saved connected sites are invalid.');
  return values
    .map(assertConnectedSite)
    .filter((site) => !isAutoApprovedConnectionHost(site.hostname));
}

export async function rememberConnectedSite(origin: string): Promise<void> {
  const url = new URL(origin);
  if (isAutoApprovedConnectionHost(url.hostname)) return;
  return connectionStorageMutex.runExclusive(async () => {
    const sites = await getConnectedSites();
    await chrome.storage.local.set({
      [CONNECTED_SITES_KEY]: [
        { origin: url.origin },
        ...sites
          .filter((site) => site.origin !== url.origin)
          .map((site) => ({ origin: site.origin })),
      ],
    });
  });
}

export async function isConnectedSite(origin: string): Promise<boolean> {
  const normalizedOrigin = new URL(origin).origin;
  return (await getConnectedSites()).some((site) => site.origin === normalizedOrigin);
}

export async function removeConnectedSite(origin: string): Promise<void> {
  const normalizedOrigin = new URL(origin).origin;
  return connectionStorageMutex.runExclusive(async () => {
    const sites = await getConnectedSites();
    if (!sites.some((site) => site.origin === normalizedOrigin)) {
      throw new Error('Connected site is not saved.');
    }
    await chrome.storage.local.set({
      [CONNECTED_SITES_KEY]: sites
        .filter((site) => site.origin !== normalizedOrigin)
        .map((site) => ({ origin: site.origin })),
    });
  });
}

export async function getInstalledCapturePlugin(
  plugin: PeerCapturePlugin,
  sourceOrigin: string,
): Promise<PeerCapturePlugin | null> {
  const origin = new URL(sourceOrigin).origin;
  const installed = (await getStoredCapturePlugins()).find(
    (record) => record.plugin.id === plugin.id && record.sourceOrigin === origin,
  );
  if (!installed) return null;
  return (await capturePluginDigest(installed.plugin)) === (await capturePluginDigest(plugin))
    ? installed.plugin
    : null;
}

export async function rememberCapturePlugin(
  plugin: PeerCapturePlugin,
  sourceOrigin: string,
): Promise<void> {
  return pluginStorageMutex.runExclusive(async () => {
    const origin = new URL(sourceOrigin).origin;
    const plugins = await getStoredCapturePlugins();
    if (
      !plugins.some((record) => record.plugin.id === plugin.id && record.sourceOrigin === origin) &&
      plugins.length >= MAX_SAVED_CAPTURE_PLUGINS
    ) {
      throw new Error('Remove an installed capture plugin before adding another.');
    }
    await chrome.storage.local.set({
      [CAPTURE_PLUGINS_KEY]: [
        { plugin, sourceOrigin: origin },
        ...plugins.filter(
          (record) => record.plugin.id !== plugin.id || record.sourceOrigin !== origin,
        ),
      ],
    });
  });
}

export async function removeCapturePlugin(id: string, sourceOrigin: string): Promise<void> {
  return pluginStorageMutex.runExclusive(async () => {
    const origin = new URL(sourceOrigin).origin;
    const plugins = await getStoredCapturePlugins();
    if (!plugins.some((record) => record.plugin.id === id && record.sourceOrigin === origin)) {
      throw new Error('Capture plugin is not installed.');
    }
    await chrome.storage.local.set({
      [CAPTURE_PLUGINS_KEY]: plugins.filter(
        (record) => record.plugin.id !== id || record.sourceOrigin !== origin,
      ),
    });
  });
}

export async function getCapturePluginRecords(): Promise<CapturePluginRecord[]> {
  return Promise.all(
    (await getStoredCapturePlugins()).map(async (record) => ({
      ...record,
      digest: await capturePluginDigest(record.plugin),
    })),
  );
}

export async function getExtensionManagerState(): Promise<ExtensionManagerState> {
  const [connectedSites, plugins] = await Promise.all([
    getConnectedSites(),
    getCapturePluginRecords(),
  ]);
  return { connectedSites, plugins };
}

export async function restrictExtensionStorageAccess(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}
