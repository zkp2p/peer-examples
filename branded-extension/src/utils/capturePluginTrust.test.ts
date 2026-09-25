import type { PeerCapturePlugin } from '@utils/types/captureProgram';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertCapturePlugin, capturePluginDigest } from './capturePlugin';
import { isApprovedCapturePlugin } from './capturePluginTrust';

const plugin: PeerCapturePlugin = {
  id: 'provider/transfer_provider',
  name: 'Provider transfers',
  authLink: 'https://provider.example/activity',
  origins: ['https://provider.example'],
  shouldSkipCloseTab: false,
  source: 'function capture() { return null; }',
};

describe('Curator capture plugin trust', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function approveOriginal(): Promise<void> {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          plugins: [{ id: plugin.id, sha256: await capturePluginDigest(plugin) }],
        }),
      ),
    );
  }

  it('fetches only the fixed Curator registry without client credentials or redirects', async () => {
    await approveOriginal();
    expect(await isApprovedCapturePlugin(plugin)).toBe(true);
    expect(fetch).toHaveBeenCalledWith('https://api.zkp2p.xyz/providers/capture-plugins.json', {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: expect.any(AbortSignal),
    });
  });

  it.each<Partial<PeerCapturePlugin>>([
    { id: 'provider/other' },
    { name: 'Peer-approved plugin' },
    { source: 'function capture() { return []; }' },
    { authLink: 'https://provider.example/other' },
    { origins: ['https://provider.example', 'https://other.example'] },
    { shouldSkipCloseTab: true },
    { focusOnOpen: false },
    { focusOnOpen: true },
  ])('does not approve changed plugin fields: %j', async (changed) => {
    await approveOriginal();
    expect(await isApprovedCapturePlugin({ ...plugin, ...changed })).toBe(false);
  });

  it('hashes the validated representation independently of JSON property order', async () => {
    await approveOriginal();
    const reordered = Object.fromEntries(Object.entries(plugin).reverse());
    expect(await isApprovedCapturePlugin(assertCapturePlugin(reordered, plugin.id))).toBe(true);
  });

  it.each([
    null,
    [],
    {},
    { plugins: {} },
    { plugins: [null, 'bad', {}] },
    { plugins: [{ id: plugin.id, sha256: 'wrong' }] },
  ])('treats malformed or unmatched registries as unverified: %j', async (registry) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(registry)));
    expect(await isApprovedCapturePlugin(plugin)).toBe(false);
  });

  it('requires both the plugin ID and full digest in the same registry entry', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          plugins: [
            { id: 'provider/other', sha256: await capturePluginDigest(plugin) },
            { id: plugin.id, sha256: '0'.repeat(64) },
          ],
        }),
      ),
    );
    expect(await isApprovedCapturePlugin(plugin)).toBe(false);
  });

  it.each([new Response('not json'), new Response('{}', { status: 503 })])(
    'treats failed registry responses as unverified',
    async (response) => {
      vi.mocked(fetch).mockResolvedValue(response);
      expect(await isApprovedCapturePlugin(plugin)).toBe(false);
    },
  );

  it('aborts a stalled lookup and falls back to the warning', async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const result = isApprovedCapturePlugin(plugin);
    // Hashing uses native WebCrypto before starting the bounded network lookup.
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await result).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
