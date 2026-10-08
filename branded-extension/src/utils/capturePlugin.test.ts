import { describe, expect, it } from 'vitest';

import {
  assertCaptureParams,
  assertCapturePlugin,
  assertInitialAction,
  captureOriginPatterns,
  capturePluginDigest,
} from './capturePlugin';

const plugin = {
  authLink: 'https://provider.example/activity',
  id: 'provider/action',
  name: 'Provider action',
  origins: ['https://provider.example', 'https://api.provider.example'],
  shouldSkipCloseTab: false,
  source: 'function capture() { return null; }',
};

describe('capture plugin validation', () => {
  it.each([true, false])('preserves an explicit focusOnOpen choice (%s)', (focusOnOpen) => {
    expect(assertCapturePlugin({ ...plugin, focusOnOpen }, plugin.id).focusOnOpen).toBe(
      focusOnOpen,
    );
  });

  it.each(['true', null, 1])('rejects an invalid focusOnOpen choice (%s)', (focusOnOpen) => {
    expect(() => assertCapturePlugin({ ...plugin, focusOnOpen }, plugin.id)).toThrow(
      'Capture plugin is invalid',
    );
  });

  it('includes the focus choice in the approved plugin digest', async () => {
    expect(await capturePluginDigest({ ...plugin, focusOnOpen: true })).not.toBe(
      await capturePluginDigest({ ...plugin, focusOnOpen: false }),
    );
  });

  const pageCapture = {
    request: { method: 'POST' as const, url: 'https://provider.example/api/receipt' },
    session: {
      gatewayState: { storage: 'gateway' },
      browserId: { encoding: 'p256RawPublicKey' as const, storage: 'browserId.publicKey' },
    },
  };
  const withField = (field: unknown) => ({ ...pageCapture, session: { field } });

  it('accepts an in-page request on a declared origin', () => {
    expect(assertCapturePlugin({ ...plugin, pageCapture }, plugin.id).pageCapture).toEqual(
      pageCapture,
    );
  });

  it.each([
    null,
    { session: pageCapture.session },
    { request: pageCapture.request },
    { ...pageCapture, extra: true },
    { ...pageCapture, request: { ...pageCapture.request, method: 'PUT' } },
    { ...pageCapture, request: { ...pageCapture.request, headers: {} } },
    { ...pageCapture, request: { ...pageCapture.request, url: 'https://other.example/api' } },
    { ...pageCapture, request: { ...pageCapture.request, url: 'http://provider.example/api' } },
    { ...pageCapture, request: { ...pageCapture.request, url: `${pageCapture.request.url}#x` } },
    { ...pageCapture, session: {} },
    { ...pageCapture, session: [] },
    { ...pageCapture, session: { '1field': { storage: 'gateway' } } },
    { ...pageCapture, session: { 'bad field': { storage: 'gateway' } } },
    withField('gateway'),
    withField({}),
    withField({ storage: '' }),
    withField({ storage: 'browserId.publicKey.x' }),
    withField({ storage: 'browserId.' }),
    withField({ storage: 1 }),
    withField({ storage: 'browserId', encoding: 'jwk' }),
    withField({ storage: 'browserId', extra: true }),
    {
      ...pageCapture,
      session: Object.fromEntries(
        Array.from({ length: 9 }, (_, index) => [`field${index}`, { storage: 'gateway' }]),
      ),
    },
  ])('rejects an invalid page capture %j', (value) => {
    expect(() => assertCapturePlugin({ ...plugin, pageCapture: value }, plugin.id)).toThrow();
  });

  it('binds the page capture request and session fields into the approved digest', async () => {
    const digest = await capturePluginDigest({ ...plugin, pageCapture });
    expect(digest).not.toBe(await capturePluginDigest(plugin));
    expect(digest).not.toBe(
      await capturePluginDigest({
        ...plugin,
        pageCapture: { ...pageCapture, session: { gatewayState: { storage: 'gateway' } } },
      }),
    );
  });

  it('accepts the plugin JSON and builds origin filters', () => {
    expect(assertCapturePlugin(plugin, plugin.id)).toEqual({
      ...plugin,
      origins: ['https://api.provider.example', 'https://provider.example'],
    });
    expect(captureOriginPatterns(plugin)).toEqual([
      '^https://provider\\.example(?:/|$)',
      '^https://api\\.provider\\.example(?:/|$)',
    ]);
  });

  it('rejects mismatched, local, path-scoped, and undeclared origins', () => {
    expect(() => assertCapturePlugin(plugin, 'provider/other')).toThrow('does not match');
    expect(() =>
      assertCapturePlugin({ ...plugin, authLink: 'http://localhost:3000' }, plugin.id),
    ).toThrow('public HTTPS');
    expect(() =>
      assertCapturePlugin({ ...plugin, origins: ['https://provider.example/api'] }, plugin.id),
    ).toThrow('must not include a path');
    expect(() =>
      assertCapturePlugin({ ...plugin, origins: ['https://api.provider.example'] }, plugin.id),
    ).toThrow('must be declared');
    const missingTabDisposition = Object.fromEntries(
      Object.entries(plugin).filter(([key]) => key !== 'shouldSkipCloseTab'),
    );
    expect(() => assertCapturePlugin(missingTabDisposition, plugin.id)).toThrow(
      'Capture plugin is invalid',
    );
    expect(() =>
      assertCapturePlugin({ ...plugin, shouldSkipCloseTab: 'false' }, plugin.id),
    ).toThrow('Capture plugin is invalid');
    expect(() => assertCapturePlugin({ ...plugin, version: 1 }, plugin.id)).toThrow(
      'Capture plugin is invalid',
    );
  });

  it('keeps values out of the default action and validates symbolic inputs', () => {
    expect(assertInitialAction(undefined)).toEqual({ enabled: false, paymentDetails: {} });
    expect(assertInitialAction({ paymentDetails: { AMOUNT: '10.00' } })).toEqual({
      enabled: true,
      paymentDetails: { AMOUNT: '10.00' },
    });
    expect(() => assertInitialAction({ paymentDetails: { amount: '10.00' } })).toThrow(
      'payment details are invalid',
    );
  });

  it('accepts flat generic capture params independently from page-action inputs', () => {
    expect(assertCaptureParams(undefined)).toEqual({});
    expect(assertCaptureParams({ amount: '10.00', attempt: 2, pending: false })).toEqual({
      amount: '10.00',
      attempt: 2,
      pending: false,
    });
    expect(() => assertCaptureParams({ nested: { id: 'payment-1' } })).toThrow(
      'Capture params are invalid',
    );
    expect(() => assertCaptureParams({ amount: Number.POSITIVE_INFINITY })).toThrow(
      'Capture params are invalid',
    );
  });
});
