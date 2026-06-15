import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  extractTransactionsFromPayload,
  resolveMetadataPayload,
  resolveParamExtractionResponseBodyString,
} from '@utils/metadataEngine';
import type { RequestLog } from '@entries/Background/requestLog';
import type { ProviderSettings } from '@utils/types';

function buildRequest(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    initiator: 'https://provider.example',
    method: 'GET',
    requestHeaders: [{ name: 'authorization', value: 'test-auth-value' }],
    requestId: 'request-1',
    responseBody: JSON.stringify({
      transactions: [{ amount: '12.34', id: 'payment-1' }],
    }),
    responseHeaders: [],
    tabId: 12,
    timestamp: 0,
    type: 'xmlhttprequest',
    url: 'https://provider.example/api/transactions',
    ...overrides,
  };
}

function buildProviderConfig(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    authLink: 'https://provider.example/login',
    body: '',
    method: 'GET',
    metadata: {
      fallbackMethod: 'GET',
      fallbackUrlRegex: 'fallback',
      method: 'GET',
      platform: 'provider',
      preprocessRegex: '',
      transactionsExtraction: {
        transactionJsonPathListSelector: '$.transactions',
        transactionJsonPathSelectors: {
          amount: '$.amount',
          paymentId: '$.id',
        },
      },
      urlRegex: 'transactions',
    },
    paramNames: [],
    paramSelectors: [],
    url: 'https://provider.example/api/transactions',
    ...overrides,
  };
}

describe('metadataEngine.resolveMetadataPayload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the captured primary response when metadataUrl is not configured', async () => {
    const request = buildRequest();
    const payload = await resolveMetadataPayload({ found: request }, buildProviderConfig());

    expect(payload).toEqual({
      bodyJson: {
        transactions: [{ amount: '12.34', id: 'payment-1' }],
      },
      bodyStr: '{"transactions":[{"amount":"12.34","id":"payment-1"}]}',
      request,
    });
    expect(extractTransactionsFromPayload(payload, buildProviderConfig())).toEqual([
      {
        amount: '12.34',
        hidden: false,
        originalIndex: 0,
        paymentId: 'payment-1',
      },
    ]);
  });

  it('replays metadataUrl from the captured context request', async () => {
    let sentMessage: unknown;
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (message: unknown, callback: (response?: unknown) => void) => {
          sentMessage = message;
          callback({
            ok: true,
            status: 200,
            text: '{"transactions":[{"amount":"99.00","id":"payment-99"}]}',
          });
        },
      },
    });

    const request = buildRequest({ url: 'https://provider.example/api/context' });
    const config = buildProviderConfig({
      metadata: {
        ...buildProviderConfig().metadata,
        metadataUrl: 'https://provider.example/api/metadata',
        shouldReplayRequestInPage: true,
      },
    });
    const payload = await resolveMetadataPayload({ fallback: request }, config);

    expect(sentMessage).toMatchObject({
      data: {
        request: {
          requestId: 'request-1',
          url: 'https://provider.example/api/metadata',
        },
      },
    });
    expect(payload.bodyJson).toEqual({
      transactions: [{ amount: '99.00', id: 'payment-99' }],
    });
    expect(payload.request).toBe(request);
  });

  it('keeps metadataUrl HTML replay as text for XPath extraction', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (_message: unknown, callback: (response?: unknown) => void) => {
          callback({
            ok: true,
            status: 200,
            text: '<html><body>statement</body></html>',
          });
        },
      },
    });

    const request = buildRequest({ url: 'https://provider.example/api/context' });
    const payload = await resolveMetadataPayload(
      { found: request },
      buildProviderConfig({
        metadata: {
          ...buildProviderConfig().metadata,
          metadataUrl: 'https://provider.example/api/statement',
          shouldReplayRequestInPage: true,
          transactionsExtraction: {
            transactionXPathSelectors: {
              paymentId: 'id',
            },
          },
        },
      }),
    );

    expect(payload).toEqual({
      bodyJson: undefined,
      bodyStr: '<html><body>statement</body></html>',
      request,
    });
  });

  it('reuses an existing metadata payload for param extraction response bodies', async () => {
    const request = buildRequest();
    await expect(
      resolveParamExtractionResponseBodyString({
        dataRequest: request,
        metadataPayload: {
          bodyJson: { ok: true },
          bodyStr: '{"ok":true}',
          request,
        },
        providerConfig: buildProviderConfig({
          metadata: {
            ...buildProviderConfig().metadata,
            metadataUrl: 'https://provider.example/api/metadata',
          },
        }),
      }),
    ).resolves.toBe('{"ok":true}');
  });
});
