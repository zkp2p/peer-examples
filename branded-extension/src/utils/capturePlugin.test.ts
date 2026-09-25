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
