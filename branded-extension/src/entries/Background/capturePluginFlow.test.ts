import { BRAND } from '@config/brand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { capturePluginDigest } from '@utils/capturePlugin';
import { getInstalledCapturePlugin } from '@utils/extensionState';

import { installCapturePlugin } from './capturePluginFlow';

const localState: Record<string, unknown> = {};
const plugin = {
  authLink: 'https://provider.example/activity',
  id: 'provider/transfer_provider',
  name: 'Provider transfers',
  origins: ['https://provider.example'],
  shouldSkipCloseTab: false,
  source: 'function capture() { return null; }',
};

describe('capture plugin installation', () => {
  beforeEach(() => {
    BRAND.hostDomains.push('https://provider.example/*');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ plugins: [] }))),
    );
    Object.keys(localState).forEach((key) => delete localState[key]);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: localState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(localState, value)),
        },
      },
    });
  });

  afterEach(() => {
    BRAND.hostDomains.pop();
    vi.unstubAllGlobals();
  });

  it('warns once and persists the exact approved plugin', async () => {
    const requestApproval = vi.fn(async () => true);
    const input = {
      actionType: 'transfer_provider',
      platform: 'provider',
      requestApproval,
      sourceHostname: 'partner.example',
      sourceOrigin: 'https://partner.example',
      value: plugin,
    };

    await expect(installCapturePlugin(input)).resolves.toEqual(plugin);
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.arrayContaining([
          expect.objectContaining({ label: 'After capture', value: 'Close tab' }),
        ]),
        description: 'Adds Provider transfers so this site can verify payments you make there.',
        permissions: [
          'Open provider.example',
          'Read your payment activity there',
          'Share matched activity with this site',
        ],
        title: 'Install Provider transfers?',
        pluginTrust: 'unverified',
        warning: 'Only for this site. Changes need your approval.',
      }),
    );
    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toEqual(
      plugin,
    );

    requestApproval.mockClear();
    await installCapturePlugin(input);
    expect(requestApproval).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('keeps per-site approval for an exact Curator-approved plugin', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ plugins: [{ id: plugin.id, sha256: await capturePluginDigest(plugin) }] }),
      ),
    );
    const requestApproval = vi.fn(async () => true);
    await installCapturePlugin({
      actionType: 'transfer_provider',
      platform: 'provider',
      requestApproval,
      sourceHostname: 'peer.xyz',
      sourceOrigin: 'https://peer.xyz',
      value: plugin,
    });
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ pluginTrust: 'verified' }),
    );
  });

  it('requires risk acknowledgement when Curator cannot be reached', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    const requestApproval = vi.fn(async () => false);
    await expect(
      installCapturePlugin({
        actionType: 'transfer_provider',
        platform: 'provider',
        requestApproval,
        sourceHostname: 'peer.xyz',
        sourceOrigin: 'https://peer.xyz',
        value: plugin,
      }),
    ).rejects.toThrow('installation was rejected');
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({ pluginTrust: 'unverified' }),
    );
  });

  it('rejects without persisting the plugin', async () => {
    await expect(
      installCapturePlugin({
        actionType: 'transfer_provider',
        platform: 'provider',
        requestApproval: vi.fn(async () => false),
        sourceHostname: 'partner.example',
        sourceOrigin: 'https://partner.example',
        value: plugin,
      }),
    ).rejects.toThrow('installation was rejected');
    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toBeNull();
  });

  it("does not reuse another site's approval for identical source", async () => {
    const requestApproval = vi.fn(async () => true);
    const input = {
      actionType: 'transfer_provider',
      platform: 'provider',
      requestApproval,
      sourceHostname: 'peer.xyz',
      sourceOrigin: 'https://peer.xyz',
      value: plugin,
    };
    await installCapturePlugin(input);
    requestApproval.mockResolvedValue(false);
    await expect(
      installCapturePlugin({ ...input, sourceOrigin: 'https://app.peer.xyz' }),
    ).rejects.toThrow('installation was rejected');
    expect(requestApproval).toHaveBeenCalledTimes(2);
    await expect(getInstalledCapturePlugin(plugin, 'https://app.peer.xyz')).resolves.toBeNull();
  });

  it.each([
    'https://peer.xyz',
    'https://app.peer.xyz',
    'https://developer.peer.xyz',
    'https://zkp2p.xyz',
    'https://app.zkp2p.xyz',
  ])('requires approval for new and changed plugins from %s', async (sourceOrigin) => {
    const requestApproval = vi.fn(async () => true);
    const input = {
      actionType: 'transfer_provider',
      platform: 'provider',
      requestApproval,
      sourceHostname: new URL(sourceOrigin).hostname,
      sourceOrigin,
      value: plugin,
    };
    await expect(installCapturePlugin(input)).resolves.toEqual(plugin);
    await expect(getInstalledCapturePlugin(plugin, sourceOrigin)).resolves.toEqual(plugin);

    const updated = { ...plugin, source: 'function capture() { return []; }' };
    await expect(installCapturePlugin({ ...input, value: updated })).resolves.toEqual(updated);
    await expect(getInstalledCapturePlugin(updated, sourceOrigin)).resolves.toEqual(updated);
    expect(requestApproval).toHaveBeenCalledTimes(2);
  });

  it.each([
    'https://partner.example',
    'https://peer.xyz.evil.example',
    'https://zkp2p.xyz.evil.example',
    'https://notpeer.xyz',
    'https://notzkp2p.xyz',
    'https://peer.xyz@evil.example',
    'http://app.peer.xyz',
    'http://zkp2p.xyz',
    'http://localhost:3000',
    'https://localhost',
  ])('requires approval for %s even with a trusted display hostname', async (sourceOrigin) => {
    const requestApproval = vi.fn(async () => false);
    await expect(
      installCapturePlugin({
        actionType: 'transfer_provider',
        platform: 'provider',
        requestApproval,
        sourceHostname: 'app.peer.xyz',
        sourceOrigin,
        value: plugin,
      }),
    ).rejects.toThrow('installation was rejected');
    expect(requestApproval).toHaveBeenCalledOnce();
    await expect(getInstalledCapturePlugin(plugin, 'https://partner.example')).resolves.toBeNull();
  });

  it('rejects a provider outside the configured host permissions', async () => {
    const requestApproval = vi.fn(async () => true);
    await expect(installCapturePlugin({
      actionType: 'transfer_provider', platform: 'provider', requestApproval,
      sourceHostname: 'partner.example', sourceOrigin: 'https://partner.example',
      value: { ...plugin, authLink: 'https://unsupported.example/activity', origins: ['https://unsupported.example'] },
    })).rejects.toThrow('brand.config.json hostDomains');
    expect(requestApproval).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('validates plugins before requesting approval', async () => {
    const requestApproval = vi.fn(async () => true);
    await expect(
      installCapturePlugin({
        actionType: 'transfer_provider',
        platform: 'provider',
        requestApproval,
        sourceHostname: 'app.peer.xyz',
        sourceOrigin: 'https://app.peer.xyz',
        value: { ...plugin, authLink: 'https://evil.example' },
      }),
    ).rejects.toThrow();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a page-supplied trust flag before querying Curator', async () => {
    const requestApproval = vi.fn(async () => true);
    await expect(
      installCapturePlugin({
        actionType: 'transfer_provider',
        platform: 'provider',
        requestApproval,
        sourceHostname: 'peer.xyz',
        sourceOrigin: 'https://peer.xyz',
        value: { ...plugin, pluginTrust: 'verified' },
      }),
    ).rejects.toThrow('Capture plugin is invalid');
    expect(fetch).not.toHaveBeenCalled();
    expect(requestApproval).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });
});
