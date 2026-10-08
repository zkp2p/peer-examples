import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getExtensionManagerState,
  getInstalledCapturePlugin,
  isConnectedSite,
  rememberCapturePlugin,
  rememberConnectedSite,
  removeCapturePlugin,
  removeConnectedSite,
  restrictExtensionStorageAccess,
} from './extensionState';

const localState: Record<string, unknown> = {};
const setAccessLevel = vi.fn(async () => undefined);
const plugin = {
  authLink: 'https://provider.example/activity',
  id: 'provider/transfer_provider',
  name: 'Provider transfers',
  origins: ['https://provider.example'],
  shouldSkipCloseTab: false,
  source: 'function capture() { return null; }',
};

describe('extension settings storage', () => {
  beforeEach(() => {
    Object.keys(localState).forEach((key) => delete localState[key]);
    setAccessLevel.mockClear();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(localState, value)),
          setAccessLevel,
        },
      },
    });
  });

  it('persists third-party connections until disconnected', async () => {
    await rememberConnectedSite('https://app.acme-verify.example');
    await rememberConnectedSite('https://partner.example/path');

    await expect(isConnectedSite('https://partner.example/other')).resolves.toBe(true);
    expect((await getExtensionManagerState()).connectedSites).toEqual([
      { hostname: 'partner.example', origin: 'https://partner.example' },
    ]);
    await removeConnectedSite('https://partner.example');
    await expect(isConnectedSite('https://partner.example')).resolves.toBe(false);
  });

  it('persists only approved plugin JSON and derives its digest', async () => {
    await rememberCapturePlugin(plugin, 'https://partner.example/path');

    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toEqual(
      plugin,
    );
    expect(await getExtensionManagerState()).toEqual({
      connectedSites: [],
      plugins: [
        expect.objectContaining({
          plugin,
          sourceOrigin: 'https://partner.example',
          digest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ],
    });

    await expect(
      getInstalledCapturePlugin(
        { ...plugin, source: 'function capture() { return []; }' },
        'https://partner.example',
      ),
    ).resolves.toBeNull();
    await removeCapturePlugin(plugin.id, 'https://partner.example');
    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toBeNull();
  });

  it('preserves concurrent site approvals', async () => {
    await Promise.all([
      rememberConnectedSite('https://first.example'),
      rememberConnectedSite('https://second.example'),
    ]);

    await expect(isConnectedSite('https://first.example')).resolves.toBe(true);
    await expect(isConnectedSite('https://second.example')).resolves.toBe(true);
  });

  it('does not restore a disconnected site when another site is approved', async () => {
    await rememberConnectedSite('https://first.example');

    await Promise.all([
      removeConnectedSite('https://first.example'),
      rememberConnectedSite('https://second.example'),
    ]);

    await expect(isConnectedSite('https://first.example')).resolves.toBe(false);
    await expect(isConnectedSite('https://second.example')).resolves.toBe(true);
  });

  it('rejects corrupt stored plugin state', async () => {
    localState['peer.capturePlugins.v4'] = [{ plugin: null }];
    await expect(getExtensionManagerState()).rejects.toThrow('Saved capture plugin');
  });

  it('does not trust plugins saved under the retired schema', async () => {
    localState['peer.capturePlugins.v3'] = [
      {
        plugin: {
          authLink: plugin.authLink,
          id: plugin.id,
          name: plugin.name,
          origins: plugin.origins,
          shouldSkipCloseTab: plugin.shouldSkipCloseTab,
          source: plugin.source,
        },
        sourceOrigin: 'https://partner.example',
      },
    ];

    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toBeNull();
    await expect(getExtensionManagerState()).resolves.toEqual({ connectedSites: [], plugins: [] });
  });

  it('restricts storage to extension contexts', async () => {
    await restrictExtensionStorageAccess();
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('scopes installs, updates and removal to exact origins, including subdomains and ports', async () => {
    const origins = [
      'https://peer.xyz',
      'https://app.peer.xyz',
      'http://localhost:3000',
      'http://localhost:3001',
    ];
    await Promise.all(origins.map((origin) => rememberCapturePlugin(plugin, origin)));
    expect((await getExtensionManagerState()).plugins).toHaveLength(4);
    const updated = { ...plugin, source: 'function capture() { return []; }' };
    await rememberCapturePlugin(updated, origins[0]);
    await expect(getInstalledCapturePlugin(plugin, origins[0])).resolves.toBeNull();
    await expect(getInstalledCapturePlugin(updated, origins[0])).resolves.toEqual(updated);
    await removeCapturePlugin(plugin.id, origins[0]);
    await expect(getInstalledCapturePlugin(updated, origins[0])).resolves.toBeNull();
    for (const origin of origins.slice(1)) {
      await expect(getInstalledCapturePlugin(plugin, origin)).resolves.toEqual(plugin);
    }
    await expect(getInstalledCapturePlugin(plugin, 'https://other.example')).resolves.toBeNull();
  });
});
