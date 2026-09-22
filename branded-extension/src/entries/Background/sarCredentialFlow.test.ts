import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearSarCredentialCapture,
  rememberSarCredentialCapture,
  resolveSarCredentialCaptureConfig,
  stageSarCredentialCaptureForMetadata,
} from './sarCredentialFlow';
import type { RequestLog } from './requestLog';

const { createSarCredentialBundleInOffscreenMock, prepareSarCredentialCaptureMock } = vi.hoisted(
  () => ({
    createSarCredentialBundleInOffscreenMock: vi.fn(),
    prepareSarCredentialCaptureMock: vi.fn(),
  }),
);

vi.mock('./sarCredentialCapture', () => ({
  prepareSarCredentialCapture: prepareSarCredentialCaptureMock,
}));

vi.mock('./sarCredentialOffscreenBundle', () => ({
  createSarCredentialBundleInOffscreen: createSarCredentialBundleInOffscreenMock,
}));

const request: RequestLog = {
  initiator: 'https://cash.app',
  method: 'POST',
  requestHeaders: [{ name: 'Cookie', value: 'cashapp_session=abc' }],
  requestId: 'request-1',
  requestBody: '{}',
  responseBody: JSON.stringify({ activity_rows: [] }),
  tabId: 7,
  timestamp: 1760000000000,
  type: 'xmlhttprequest',
  url: 'https://cash.app/cash-app/activity/v1.0/page',
};

const payload = {
  offchainId: 'seller_user',
  payeeId: '123456',
  platform: 'cashapp',
  sessionMaterial: {
    customerId: '123456',
    requestPayload: '{}',
    recipientCashtag: 'seller_user',
    requestHeaders: {
      Cookie: 'cashapp_session=abc',
    },
    sessionCookie: 'cashapp_session=abc',
  },
} as const;

const credentialBundle = {
  bundleSignature: '0xbundle',
  credentialExpiresAt: null,
  credentialType: 'cashapp_seller_session',
  credentialValidatedAt: '1760000000000',
  encryptedBlob: 'encrypted-blob',
  encryptedDataKey: 'encrypted-key',
  nonce: 'nonce',
  payeeIdHash: '0xpayeehash',
  platform: 'cashapp',
} as const;

describe('SAR credential capture staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSarCredentialCapture(7);
    prepareSarCredentialCaptureMock.mockResolvedValue(payload);
    createSarCredentialBundleInOffscreenMock.mockResolvedValue(credentialBundle);
  });

  it('returns an encrypted credential bundle without exposing captured plaintext', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    rememberSarCredentialCapture(7, {
      attestationServiceUrl: 'https://attestation.test',
      platform: 'cashapp',
    });

    const result = await stageSarCredentialCaptureForMetadata({
      ensureOffscreenDocument,
      request,
      tabId: 7,
    });

    expect(prepareSarCredentialCaptureMock).toHaveBeenCalledWith({
      platform: 'cashapp',
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

  it('stages from the exact request returned by metadata extraction', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    rememberSarCredentialCapture(7, {
      attestationServiceUrl: 'https://attestation.test',
      platform: 'cashapp',
    });

    const result = await stageSarCredentialCaptureForMetadata({
      ensureOffscreenDocument,
      request,
      tabId: 7,
    });

    expect(prepareSarCredentialCaptureMock).toHaveBeenCalledWith({
      platform: 'cashapp',
      request,
    });
    expect(result).toEqual({
      capture: {
        credentialBundle,
        offchainId: 'seller_user',
      },
      errorMessage: null,
    });
  });

  it('forwards caller address into the encrypted credential bundle request', async () => {
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    rememberSarCredentialCapture(7, {
      attestationServiceUrl: 'https://attestation.test',
      callerAddress: '0x1111111111111111111111111111111111111111',
      platform: 'cashapp',
    });

    await stageSarCredentialCaptureForMetadata({
      ensureOffscreenDocument,
      request,
      tabId: 7,
    });

    expect(createSarCredentialBundleInOffscreenMock).toHaveBeenCalledWith({
      attestationServiceUrl: 'https://attestation.test',
      ensureOffscreenDocument,
      payload: {
        ...payload,
        callerAddress: '0x1111111111111111111111111111111111111111',
      },
    });
  });
});

describe('resolveSarCredentialCaptureConfig', () => {
  it.each(['venmo', 'paypal', 'upi', 'wise'])('ignores ordinary metadata capture for %s', (platform) => {
    expect(
      resolveSarCredentialCaptureConfig({
        attestationServiceUrl: 'https://attestation.test',
        platform,
      }),
    ).toEqual({ config: null, error: null });
  });

  it.each(['cashapp'])(
    'resolves supported seller credential capture for %s',
    (platform) => {
      expect(
        resolveSarCredentialCaptureConfig({
          attestationServiceUrl: 'https://attestation.test/',
          callerAddress: ' 0x1111111111111111111111111111111111111111 ',
          captureMode: 'sellerCredential',
          platform,
        }),
      ).toEqual({
        config: {
          attestationServiceUrl: 'https://attestation.test',
          callerAddress: '0x1111111111111111111111111111111111111111',
          platform,
        },
        error: null,
      });
    },
  );

  it.each(['venmo', 'paypal', 'upi', 'wise'])(
    'rejects unsupported %s seller capture',
    (platform) => {
      expect(resolveSarCredentialCaptureConfig({ platform, captureMode: 'sellerCredential' }))
        .toEqual({ config: null, error: `Seller credential capture is not supported for ${platform}.` });
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
        platform: 'cashapp',
      }),
    ).toEqual({
      config: {
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'cashapp',
      },
      error: null,
    });
  });
});
