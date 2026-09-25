import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBuyerTeeCapture,
  rememberBuyerTeeCapture,
  resolveBuyerTeeCaptureConfig,
  stageBuyerTeeCaptureForMetadata,
} from './buyerTeeFlow';
import type { RequestLog } from './requestLog';

const prepareBuyerTeeCaptureMaterialMock = vi.hoisted(() => vi.fn());
const encryptBuyerTeeSessionMaterialInBackgroundMock = vi.hoisted(() => vi.fn());

vi.mock('./buyerTeeCapture', () => ({
  prepareBuyerTeeCaptureMaterial: (...args: unknown[]) =>
    prepareBuyerTeeCaptureMaterialMock(...args),
}));

vi.mock('./buyerTeeSessionMaterialEncryption', () => ({
  encryptBuyerTeeSessionMaterialInBackground: (...args: unknown[]) =>
    encryptBuyerTeeSessionMaterialInBackgroundMock(...args),
}));

function buildRequestLog(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    initiator: 'https://payments.example',
    method: 'GET',
    requestHeaders: [{ name: 'Cookie', value: 'session=abc' }],
    requestId: 'request-1',
    tabId: 7,
    type: 'xmlhttprequest',
    url: 'https://payments.example/api/history?account=123456',
    ...overrides,
  };
}

describe('buyer TEE capture staging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearBuyerTeeCapture(7);
    prepareBuyerTeeCaptureMaterialMock.mockReturnValue({
      metadata: [{ hidden: false, originalIndex: 1, params: { SENDER_ID: 'sender-1' } }],
      params: [{ SENDER_ID: 'sender-1' }],
      sessionMaterial: { Cookie: 'session=abc' },
    });
    encryptBuyerTeeSessionMaterialInBackgroundMock.mockResolvedValue('encrypted-session-material');
  });

  it('encrypts the captured buyer TEE session material during metadata interception', async () => {
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
    });

    const result = await stageBuyerTeeCaptureForMetadata({
      metadata: [{ hidden: false, originalIndex: 1 }],
      request: buildRequestLog(),
      tabId: 7,
    });

    expect(prepareBuyerTeeCaptureMaterialMock).toHaveBeenCalledWith({
      metadata: [{ hidden: false, originalIndex: 1 }],
      request: expect.objectContaining({
        url: 'https://payments.example/api/history?account=123456',
      }),
    });
    expect(encryptBuyerTeeSessionMaterialInBackgroundMock).toHaveBeenCalledWith({
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
      sessionMaterial: { Cookie: 'session=abc' },
    });
    expect(result).toEqual({
      capture: {
        encryptedSessionMaterial: 'encrypted-session-material',
      },
      errorMessage: null,
      metadata: [{ hidden: false, originalIndex: 1, params: { SENDER_ID: 'sender-1' } }],
    });
  });

  it('stages params already extracted under the offscreen replay policy', async () => {
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
    });
    const replayedRequest = buildRequestLog({ url: 'https://payments.example/api/replay-history' });

    await stageBuyerTeeCaptureForMetadata({
      metadata: [
        {
          hidden: false,
          originalIndex: 1,
          params: { PAYMENT_ID: 'payment-2' },
        },
      ],
      request: replayedRequest,
      tabId: 7,
    });

    expect(prepareBuyerTeeCaptureMaterialMock).toHaveBeenCalledWith({
      metadata: [
        {
          hidden: false,
          originalIndex: 1,
          params: { PAYMENT_ID: 'payment-2' },
        },
      ],
      request: replayedRequest,
    });
  });

  it('stages buyer TEE capture from a replayed metadata request', async () => {
    const replayedRequest = buildRequestLog({
      url: 'https://payments.example/api/replay-history',
    });
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
    });

    await stageBuyerTeeCaptureForMetadata({
      metadata: [{ hidden: false, originalIndex: 1 }],
      request: replayedRequest,
      tabId: 7,
    });

    expect(prepareBuyerTeeCaptureMaterialMock).toHaveBeenCalledWith({
      metadata: [{ hidden: false, originalIndex: 1 }],
      request: replayedRequest,
    });
  });

  it('attaches strict buyer TEE params to the selected metadata row', async () => {
    prepareBuyerTeeCaptureMaterialMock.mockReturnValueOnce({
      metadata: [
        {
          hidden: false,
          originalIndex: 8,
          params: { PROFILE_ID: 'profile-8', TRANSACTION_ID: 'transaction-8' },
        },
      ],
      params: [{ PROFILE_ID: 'profile-8', TRANSACTION_ID: 'transaction-8' }],
      sessionMaterial: { Cookie: 'session=abc' },
    });
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
    });

    const result = await stageBuyerTeeCaptureForMetadata({
      metadata: [{ hidden: false, originalIndex: 8 }],
      request: buildRequestLog(),
      tabId: 7,
    });

    expect(result.capture).toEqual({
      encryptedSessionMaterial: 'encrypted-session-material',
    });
    expect(result.metadata).toEqual([
      {
        hidden: false,
        originalIndex: 8,
        params: { PROFILE_ID: 'profile-8', TRANSACTION_ID: 'transaction-8' },
      },
    ]);
  });

  it('returns plugin-matched verifier params with the encrypted session', async () => {
    prepareBuyerTeeCaptureMaterialMock.mockReturnValueOnce({
      metadata: [],
      params: [],
      sessionMaterial: { Cookie: 'session=abc' },
    });
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
      platform: 'samplepay',
    });

    const result = await stageBuyerTeeCaptureForMetadata({
      metadata: [],
      params: { PAYMENT_ID: 'payment-2' },
      request: buildRequestLog(),
      tabId: 7,
    });

    expect(result.capture).toEqual({
      encryptedSessionMaterial: 'encrypted-session-material',
      matchedParams: { PAYMENT_ID: 'payment-2' },
    });
    expect(result.metadata).toEqual([]);
  });
});

describe('resolveBuyerTeeCaptureConfig', () => {
  it('resolves the canonical Alipay transfer capture route', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_alipay',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        captureMode: 'buyerTee',
        platform: 'alipay',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_alipay',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'alipay',
      },
      error: null,
    });
  });

  it('ignores non-buyer-TEE capture flows', () => {
    expect(resolveBuyerTeeCaptureConfig({ platform: 'samplepay' })).toEqual({
      config: null,
      error: null,
    });
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_sample',
        captureMode: 'sellerCredential',
        platform: 'samplepay',
      }),
    ).toEqual({
      config: null,
      error: null,
    });
  });

  it('resolves buyer TEE capture without a platform allowlist', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_custom',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        captureMode: 'buyerTee',
        platform: 'custom',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_custom',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'custom',
      },
      error: null,
    });
  });

  it('requires buyer TEE capture to receive an attestation service URL from the launch message', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_custom',
        captureMode: 'buyerTee',
        platform: 'custom',
      }),
    ).toEqual({
      config: null,
      error: 'Session capture requires an attestation service URL.',
    });
  });

  it('uses the attestation action type when it differs from the provider template action', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_business_paypal',
        attestationActionType: 'transfer_paypal',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz/',
        captureMode: 'buyerTee',
        platform: 'paypal',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_paypal',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'paypal',
      },
      error: null,
    });
  });

  it('uses an attestation platform override when capture uses a bank provider', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_zelle',
        attestationActionType: 'transfer_zelle_chase',
        attestationPlatform: 'zelle',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz/',
        captureMode: 'buyerTee',
        platform: 'chase',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_zelle_chase',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        platform: 'zelle',
      },
      error: null,
    });
  });

  it('requires buyer TEE routing fields', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_custom',
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        captureMode: 'buyerTee',
      }),
    ).toEqual({
      config: null,
      error: 'Session capture requires a platform.',
    });
    expect(
      resolveBuyerTeeCaptureConfig({
        attestationServiceUrl: 'https://attestation-service.zkp2p.xyz',
        captureMode: 'buyerTee',
        platform: 'custom',
      }),
    ).toEqual({
      config: null,
      error: 'Session capture requires an action type.',
    });
  });
});
