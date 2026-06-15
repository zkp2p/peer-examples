import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBuyerTeeCapture,
  rememberBuyerTeeCapture,
  resolveBuyerTeeCaptureConfig,
  stageBuyerTeeCaptureForMetadata,
} from './buyerTeeFlow';
import type { ProviderSettings } from '@utils/types';

const getRequestLogMock = vi.hoisted(() => vi.fn());
const prepareBuyerTeeCaptureMaterialMock = vi.hoisted(() => vi.fn());
const encryptBuyerTeeSessionMaterialInOffscreenMock = vi.hoisted(() => vi.fn());
const resolveParamExtractionResponseBodyStringMock = vi.hoisted(() => vi.fn());
const shouldResolveBuyerTeeParamResponseBodyMock = vi.hoisted(() => vi.fn());

vi.mock('./cache', () => ({
  getCacheByTabId: () => ({
    get: getRequestLogMock,
  }),
}));

vi.mock('./buyerTeeCapture', () => ({
  prepareBuyerTeeCaptureMaterial: (...args: unknown[]) =>
    prepareBuyerTeeCaptureMaterialMock(...args),
  shouldResolveBuyerTeeParamResponseBody: (...args: unknown[]) =>
    shouldResolveBuyerTeeParamResponseBodyMock(...args),
}));

vi.mock('./buyerTeeOffscreenEncryption', () => ({
  encryptBuyerTeeSessionMaterialInOffscreen: (...args: unknown[]) =>
    encryptBuyerTeeSessionMaterialInOffscreenMock(...args),
}));

vi.mock('@utils/metadataEngine', () => ({
  resolveParamExtractionResponseBodyString: (...args: unknown[]) =>
    resolveParamExtractionResponseBodyStringMock(...args),
}));

function buildProviderConfig(): ProviderSettings {
  return {
    authLink: 'https://payments.example/login',
    body: '',
    method: 'GET',
    metadata: {
      fallbackMethod: '',
      fallbackUrlRegex: '',
      method: 'GET',
      platform: 'samplepay',
      preprocessRegex: '',
      transactionsExtraction: {},
      urlRegex: 'https://payments.example/api/history',
    },
    paramNames: [],
    paramSelectors: [],
    url: 'https://payments.example/api/history',
  };
}

describe('buyer TEE capture staging', () => {
  const ensureOffscreenDocument = vi.fn();
  const providerConfig = buildProviderConfig();

  beforeEach(() => {
    vi.clearAllMocks();
    clearBuyerTeeCapture(7);
    getRequestLogMock.mockReturnValue({
      requestHeaders: [{ name: 'Cookie', value: 'session=abc' }],
      requestId: 'request-1',
      tabId: 7,
      url: 'https://payments.example/api/history?account=123456',
    });
    prepareBuyerTeeCaptureMaterialMock.mockReturnValue({
      metadata: [{ hidden: false, originalIndex: 1, params: { SENDER_ID: 'sender-1' } }],
      params: [{ SENDER_ID: 'sender-1' }],
      sessionMaterial: { Cookie: 'session=abc' },
    });
    resolveParamExtractionResponseBodyStringMock.mockResolvedValue('metadata-body');
    shouldResolveBuyerTeeParamResponseBodyMock.mockReturnValue(false);
    encryptBuyerTeeSessionMaterialInOffscreenMock.mockResolvedValue('encrypted-session-material');
    ensureOffscreenDocument.mockResolvedValue(undefined);
  });

  it('encrypts the captured buyer TEE session material during metadata interception', async () => {
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation.test',
      platform: 'samplepay',
      providerConfig,
    });

    const result = await stageBuyerTeeCaptureForMetadata({
      ensureOffscreenDocument,
      metadata: [{ hidden: false, originalIndex: 1 }],
      requestId: 'request-1',
      tabId: 7,
    });

    expect(getRequestLogMock).toHaveBeenCalledWith('request-1');
    expect(prepareBuyerTeeCaptureMaterialMock).toHaveBeenCalledWith({
      metadata: [{ hidden: false, originalIndex: 1 }],
      providerConfig,
      request: expect.objectContaining({
        url: 'https://payments.example/api/history?account=123456',
      }),
    });
    expect(encryptBuyerTeeSessionMaterialInOffscreenMock).toHaveBeenCalledWith({
      ensureOffscreenDocument,
      payload: {
        actionType: 'transfer_sample',
        attestationServiceUrl: 'https://attestation.test',
        platform: 'samplepay',
        sessionMaterial: { Cookie: 'session=abc' },
      },
    });
    expect(result).toEqual({
      capture: {
        encryptedSessionMaterial: 'encrypted-session-material',
      },
      errorMessage: null,
      metadata: [{ hidden: false, originalIndex: 1, params: { SENDER_ID: 'sender-1' } }],
    });
  });

  it('uses the zkTLS param response-body resolver before building buyer TEE params', async () => {
    const metadataUrlProviderConfig: ProviderSettings = {
      ...providerConfig,
      metadata: {
        ...providerConfig.metadata,
        metadataUrl: 'https://payments.example/api/replay-history',
        metadataUrlMethod: 'GET',
      },
      paramNames: ['PAYMENT_ID'],
      paramSelectors: [{ type: 'jsonPath', value: '$[{{INDEX}}].id' }],
    };
    shouldResolveBuyerTeeParamResponseBodyMock.mockReturnValue(true);
    rememberBuyerTeeCapture(7, {
      actionType: 'transfer_sample',
      attestationServiceUrl: 'https://attestation.test',
      platform: 'samplepay',
      providerConfig: metadataUrlProviderConfig,
    });

    await stageBuyerTeeCaptureForMetadata({
      ensureOffscreenDocument,
      metadata: [{ hidden: false, originalIndex: 1 }],
      requestId: 'request-1',
      tabId: 7,
    });

    expect(resolveParamExtractionResponseBodyStringMock).toHaveBeenCalledWith({
      dataRequest: expect.objectContaining({
        requestId: 'request-1',
        url: 'https://payments.example/api/history?account=123456',
      }),
      providerConfig: metadataUrlProviderConfig,
    });
    expect(prepareBuyerTeeCaptureMaterialMock).toHaveBeenCalledWith({
      metadata: [{ hidden: false, originalIndex: 1 }],
      paramResponseBodyString: 'metadata-body',
      providerConfig: metadataUrlProviderConfig,
      request: expect.objectContaining({
        url: 'https://payments.example/api/history?account=123456',
      }),
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
      attestationServiceUrl: 'https://attestation.test',
      platform: 'samplepay',
      providerConfig,
    });

    const result = await stageBuyerTeeCaptureForMetadata({
      ensureOffscreenDocument,
      metadata: [{ hidden: false, originalIndex: 8 }],
      requestId: 'request-1',
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
});

describe('resolveBuyerTeeCaptureConfig', () => {
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
        attestationServiceUrl: 'https://attestation.test',
        captureMode: 'buyerTee',
        platform: 'custom',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_custom',
        attestationServiceUrl: 'https://attestation.test',
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
        attestationServiceUrl: 'https://attestation.test/',
        captureMode: 'buyerTee',
        platform: 'paypal',
      }),
    ).toEqual({
      config: {
        actionType: 'transfer_paypal',
        attestationServiceUrl: 'https://attestation.test',
        platform: 'paypal',
      },
      error: null,
    });
  });

  it('requires buyer TEE routing fields', () => {
    expect(
      resolveBuyerTeeCaptureConfig({
        actionType: 'transfer_custom',
        attestationServiceUrl: 'https://attestation.test',
        captureMode: 'buyerTee',
      }),
    ).toEqual({
      config: null,
      error: 'Session capture requires a platform.',
    });
    expect(
      resolveBuyerTeeCaptureConfig({
        attestationServiceUrl: 'https://attestation.test',
        captureMode: 'buyerTee',
        platform: 'custom',
      }),
    ).toEqual({
      config: null,
      error: 'Session capture requires an action type.',
    });
  });
});
