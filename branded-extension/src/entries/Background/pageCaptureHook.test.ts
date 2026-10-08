import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cancelPageRequestObserver, observePageRequest } from './pageCaptureHook';

const url = 'https://bank.example/api/receipt';
const browserKey = {
  kty: 'EC',
  crv: 'P-256',
  x: 'aJc-zt7f8_PKcqVFOu4GUuKG4KzO41Vt_680fDtPz-Q',
  y: 'gK9EqT2P0ZT2itSlgb4w8K7SHtU2O1liJzupWD_NJWA',
  ext: true,
  key_ops: [],
};
// browserKey's raw uncompressed point, unpadded base64url.
const browserId =
  'BGiXPs7e3_PzynKlRTruBlLihuCszuNVbf-vNHw7T8_kgK9EqT2P0ZT2itSlgb4w8K7SHtU2O1liJzupWD_NJWA';
const hook = {
  cancelEvent: 'cancel-1',
  maxBytes: 1024,
  request: { method: 'POST' as const, url },
  session: {
    gatewayState: { storage: 'gateway' },
    browserId: { encoding: 'p256RawPublicKey' as const, storage: 'browserId.publicKey' },
  },
};
const body = JSON.stringify({ clientId: 'client-123', id: 'receipt-123' });
const receipt = JSON.stringify({ result: { id: 'receipt-123', amount: 100, currency: 980 } });
let storage: Record<string, string>;
let originalFetch: ReturnType<typeof vi.fn>;

describe('in-page request observer', () => {
  beforeEach(() => {
    storage = {
      gateway: 'private-gateway-state',
      browserId: JSON.stringify({ publicKey: browserKey, privateKey: { ...browserKey, d: 'x' } }),
      other: 'x',
    };
    originalFetch = vi.fn(async () => new Response(receipt));
    vi.stubGlobal('window', Object.assign(new EventTarget(), { fetch: originalFetch }));
    vi.stubGlobal('location', {
      origin: 'https://bank.example',
      href: 'https://bank.example/client/client-123',
    });
    vi.stubGlobal('localStorage', { getItem: (name: string) => storage[name] ?? null });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns the plaintext exchange and only the declared session fields', async () => {
    const pending = observePageRequest(hook);
    const response = await window.fetch('/api/receipt', { method: 'post', body });
    expect(await response.text()).toBe(receipt);
    expect(await pending).toEqual({
      captured: true,
      requestBody: body,
      responseBody: receipt,
      responseStatus: 200,
      session: { gatewayState: 'private-gateway-state', browserId },
    });
    expect(window.fetch).toBe(originalFetch);
    expect(originalFetch).toHaveBeenCalledExactlyOnceWith('/api/receipt', {
      method: 'post',
      body,
    });
  });

  it('encodes a stored P-256 public key as its raw point', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    storage.browserId = JSON.stringify({
      publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey),
    });
    const pending = observePageRequest(hook);
    await window.fetch(url, { method: 'POST', body });
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    expect(await pending).toMatchObject({
      session: { browserId: Buffer.from(raw).toString('base64url') },
    });
  });

  it('seals a JSON property verbatim without an encoding', async () => {
    const pending = observePageRequest({
      ...hook,
      session: { publicKey: { storage: 'browserId.publicKey' } },
    });
    await window.fetch(url, { method: 'POST', body });
    expect(await pending).toMatchObject({ session: { publicKey: JSON.stringify(browserKey) } });
  });

  it('stays above a fetch wrapper the page installs later, as after an SPA login', async () => {
    vi.useFakeTimers();
    const pending = observePageRequest(hook);
    // The page's encrypting gateway wraps whatever fetch it finds and rewrites the request.
    const pageFetch = window.fetch;
    const gatewayFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init) init.body = 'ciphertext';
      return pageFetch('https://gateway.example/ext/event', init);
    });
    window.fetch = gatewayFetch;
    await vi.advanceTimersByTimeAsync(250);
    expect(window.fetch).not.toBe(gatewayFetch);
    await window.fetch(url, { method: 'POST', body });
    expect(await pending).toMatchObject({
      captured: true,
      requestBody: body,
      responseBody: receipt,
    });
    expect(window.fetch).toBe(gatewayFetch);
  });

  it('keeps waiting through other requests and failed responses', async () => {
    const pending = observePageRequest(hook);
    await window.fetch(url, { body });
    await window.fetch(`${url}/other`, { method: 'POST', body });
    await window.fetch(`${url}?page=2`, { method: 'POST', body });
    await window.fetch('https://other.example/api/receipt', { method: 'POST', body });
    originalFetch.mockResolvedValueOnce(new Response('denied', { status: 403 }));
    await window.fetch(url, { method: 'POST', body });
    await window.fetch(url, { method: 'POST', body });
    expect(await pending).toMatchObject({ captured: true, responseStatus: 200 });
  });

  it('ignores its request when another origin owns the page and its storage', async () => {
    const api = 'https://api.bank.example/api/receipt';
    const pending = observePageRequest({ ...hook, request: { method: 'POST', url: api } });
    await window.fetch(api, { method: 'POST', body });
    cancelPageRequestObserver('cancel-1');
    expect(await pending).toEqual({ captured: false });
    expect(window.fetch).toBe(originalFetch);
  });

  it.each([
    ['a missing storage entry', () => delete storage.gateway],
    ['a missing storage property', () => (storage.browserId = '{"privateKey":{}}')],
    ['a storage entry that is not JSON', () => (storage.browserId = 'not json')],
    [
      'a public key off the P-256 curve',
      () => (storage.browserId = JSON.stringify({ publicKey: { ...browserKey, y: browserKey.x } })),
    ],
    ['an oversized storage entry', () => (storage.gateway = 'x'.repeat(1025))],
    [
      'an oversized response',
      () => originalFetch.mockResolvedValue(new Response('x'.repeat(1025))),
    ],
    [
      'a response that is not UTF-8',
      () => originalFetch.mockResolvedValue(new Response(new Uint8Array([0xff]))),
    ],
  ])('fails closed on %s', async (_, arrange) => {
    arrange();
    const pending = observePageRequest(hook);
    await window.fetch(url, { method: 'POST', body });
    expect(await pending).toEqual({ captured: false, error: expect.any(String) });
    expect(window.fetch).toBe(originalFetch);
  });

  it.each([
    ['a non-text body', url, { method: 'POST', body: new URLSearchParams({ a: 'b' }) }],
    ['an oversized body', url, { method: 'POST', body: 'x'.repeat(1025) }],
    ['a Request body it cannot read', new Request(url, { method: 'POST', body }), undefined],
  ])('fails closed on %s', async (_, input, init) => {
    const pending = observePageRequest(hook);
    await window.fetch(input, init);
    expect(await pending).toEqual({ captured: false, error: expect.any(String) });
  });

  it('expires without retaining a page hook', async () => {
    vi.useFakeTimers();
    const pending = observePageRequest(hook);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(await pending).toEqual({ captured: false, error: expect.stringContaining('expired') });
    expect(window.fetch).toBe(originalFetch);
  });

  it('does not replace a newer page fetch wrapper during cleanup', async () => {
    const pending = observePageRequest(hook);
    const newerFetch = vi.fn();
    window.fetch = newerFetch;
    window.dispatchEvent(new Event('pagehide'));
    expect(await pending).toEqual({ captured: false });
    expect(window.fetch).toBe(newerFetch);
  });
});
