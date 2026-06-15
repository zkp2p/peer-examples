import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSarCredentialCapture,
  rememberSarCredentialCapture,
  resolveSarCredentialCaptureConfig,
  stageSarCredentialCaptureForMetadata,
} from './sarCredentialFlow';

const {
  createSarCredentialBundleInOffscreenMock,
  getRequestLogMock,
  prepareSarCredentialCaptureMock,
} = vi.hoisted(() => ({
  createSarCredentialBundleInOffscreenMock: vi.fn(),
  getRequestLogMock: vi.fn(),
  prepareSarCredentialCaptureMock: vi.fn(),
}));

vi.mock('./cache', () => ({
  getCacheByTabId: () => ({
    get: getRequestLogMock,
  }),
}));

vi.mock('./sarCredentialCapture', () => ({
  prepareSarCredentialCapture: prepareSarCredentialCaptureMock,
}));

vi.mock('./sarCredentialOffscreenBundle', () => ({
  createSarCredentialBundleInOffscreen: createSarCredentialBundleInOffscreenMock,
}));

const request = {
  initiator: 'https://account.venmo.com',
  method: 'GET',
  requestHeaders: [{ name: 'Cookie', value: 'venmo_session=abc' }],
  requestId: 'request-1',
  responseBody: JSON.stringify({ stories: [] }),
  tabId: 7,
  timestamp: 1760000000000,
  type: 'xmlhttprequest',
  url: 'https://account.venmo.com/api/stories?feedType=me&externalId=123456',
};

const payload = {
  offchainId: 'seller_user',
  payeeId: '123456',
  platform: 'venmo',
  sessionMaterial: {
    accountId: '123456',
    recipientUsername: 'seller_user',
    requestHeaders: {
      Cookie: 'venmo_session=abc',
    },
    sessionCookie: 'venmo_session=abc',
  },
} as const;

const credentialBundle = {
  bundleSignature: '0xbundle',
  credentialExpiresAt: null,
  credentialType: 'venmo_seller_session',
  credentialValidatedAt: '1760000000000',
  encryptedBlob: 'encrypted-blob',
  encryptedDataKey: 'encrypted-key',
  nonce: 'nonce',
  payeeIdHash: '0xpayeehash',
  platform: 'venmo',
} as const;

describe('SAR credential capture staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSarCredentialCapture(7);
    getRequestLogMock.mockReturnValue(request);
    prepareSarCredentialCaptureMock.mockResolvedValue(payload);
    createSarCredentialBundleInOffscreenMock.mockResolvedValue(credentialBundle);
  });

  it('returns an encrypted credential bundle without exposing captured plaintext', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    rememberSarCredentialCapture(7, {
      attestationServiceUrl: 'https://attestation.test',
      platform: 'venmo',
    });

    const result = await stageSarCredentialCaptureForMetadata({
      ensureOffscreenDocument,
      requestId: 'request-1',
      tabId: 7,
    });

    expect(prepareSarCredentialCaptureMock).toHaveBeenCalledWith({
      platform: 'venmo',
      request,
    });
    expect(createSarCredentialBundleInOffscreenMock).toHaveBeenCalledWith({
      attestationServiceUrl: 'https://attestation.test',
      ensureOffscreenDocument,
      payload,
    });
    expect(result).toEqual({
      capture: {
        credentialBundle,
        offchainId: 'seller_user',
      },
      errorMessage: null,
    });
    expect(result.capture).not.toHaveProperty('request');
    expect(result.capture).not.toHaveProperty('payeeId');
    expect(result.capture).not.toHaveProperty('captureId');
    expect(result.capture).not.toHaveProperty('platform');
  });

  it('surfaces missing captures through the page-target result', async () => {
    rememberSarCredentialCapture(7, {
      attestationServiceUrl: 'https://attestation.test',
      platform: 'venmo',
    });
    getRequestLogMock.mockReturnValueOnce(undefined);

    const result = await stageSarCredentialCaptureForMetadata({
      ensureOffscreenDocument: vi.fn(),
      requestId: 'request-1',
      tabId: 7,
    });

    expect(result.capture).toBeNull();
    expect(result.errorMessage).toBe('Session capture unavailable. Re-authenticate and try again.');
    expect(createSarCredentialBundleInOffscreenMock).not.toHaveBeenCalled();
  });
});

describe('resolveSarCredentialCaptureConfig', () => {
  it('ignores ordinary metadata capture flows', () => {
    expect(
      resolveSarCredentialCaptureConfig({
        attestationServiceUrl: 'https://attestation.test',
        platform: 'venmo',
      }),
    ).toEqual({ config: null, error: null });
  });

  it.each(['venmo', 'cashapp', 'wise'])(
    'resolves seller credential capture without curator URL config or a platform allowlist for %s',
    (platform) => {
      expect(
        resolveSarCredentialCaptureConfig({
          attestationServiceUrl: 'https://attestation.test/',
          captureMode: 'sellerCredential',
          platform,
        }),
      ).toEqual({
        config: {
          attestationServiceUrl: 'https://attestation.test',
          platform,
        },
        error: null,
      });
    },
  );

  it('requires a platform for seller credential capture', () => {
    expect(
      resolveSarCredentialCaptureConfig({
        attestationServiceUrl: 'https://attestation.test',
        captureMode: 'sellerCredential',
      }),
    ).toEqual({
      config: null,
      error: 'Seller credential capture requires a platform.',
    });
  });

  it('defaults seller credential capture to the production attestation service URL', () => {
    expect(
      resolveSarCredentialCaptureConfig({
        captureMode: 'sellerCredential',
        platform: 'venmo',
      }),
    ).toEqual({
      config: {
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'venmo',
      },
      error: null,
    });
  });
});
