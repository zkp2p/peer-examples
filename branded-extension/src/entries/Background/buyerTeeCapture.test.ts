import { describe, expect, it } from 'vitest';

import type { MetadataMessageType, ProviderSettings } from '@utils/types';

import type { RequestLog } from './requestLog';
import {
  prepareBuyerTeeCaptureMaterial,
  shouldResolveBuyerTeeParamResponseBody,
} from './buyerTeeCapture';

function buildProviderConfig(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
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
    ...overrides,
  };
}

function buildRequest(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    initiator: 'https://payments.example',
    method: 'GET',
    requestHeaders: [
      { name: 'cookie', value: 'session=abc' },
      { name: 'User-Agent', value: 'Chrome' },
    ],
    requestId: 'request-1',
    responseBody: JSON.stringify({
      stories: [
        { title: { sender: { id: 'sender-1' } } },
        { title: { sender: { id: 'sender-2' } } },
      ],
    }),
    tabId: 7,
    timestamp: 1760000000000,
    type: 'xmlhttprequest',
    url: 'https://payments.example/api/history?account=123456',
    ...overrides,
  };
}

describe('prepareBuyerTeeCaptureMaterial', () => {
  it('builds encrypted-session input from all captured request headers', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig(),
        request: buildRequest(),
      }),
    ).toEqual({
      params: [],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('requires a captured request', () => {
    expect(() =>
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig(),
        request: null,
      }),
    ).toThrow('Session capture unavailable. Re-authenticate and try again.');
  });

  it('captures available request headers without provider-specific header configuration', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig(),
        request: buildRequest({ requestHeaders: [{ name: 'User-Agent', value: 'Chrome' }] }),
      }),
    ).toEqual({
      params: [],
      sessionMaterial: {
        'User-Agent': 'Chrome',
      },
    });
  });

  it('builds verifier params from provider-template param selectors', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            amount: '- $1.00',
            hidden: false,
            originalIndex: 1,
            recipient: 'alice',
          },
        ],
        providerConfig: buildProviderConfig({
          paramNames: ['SENDER_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$.stories[{{INDEX}}].title.sender.id',
            },
          ],
        }),
        request: buildRequest(),
      }),
    ).toEqual({
      metadata: [
        {
          amount: '- $1.00',
          hidden: false,
          originalIndex: 1,
          params: {
            SENDER_ID: 'sender-2',
          },
          recipient: 'alice',
        },
      ],
      params: [
        {
          SENDER_ID: 'sender-2',
        },
      ],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('keeps rows with missing provider-template params for client-side selection', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            amount: '- $1.00',
            hidden: false,
            originalIndex: 0,
          },
          {
            amount: '- $2.00',
            hidden: false,
            originalIndex: 1,
            recipient: 'alice',
          },
        ],
        providerConfig: buildProviderConfig({
          paramNames: ['SENDER_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$.stories[{{INDEX}}].title.sender.id',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify({
            stories: [{ title: {} }, { title: { sender: { id: 'sender-2' } } }],
          }),
        }),
      }),
    ).toEqual({
      metadata: [
        {
          amount: '- $1.00',
          hidden: false,
          originalIndex: 0,
          params: {},
        },
        {
          amount: '- $2.00',
          hidden: false,
          originalIndex: 1,
          params: {
            SENDER_ID: 'sender-2',
          },
          recipient: 'alice',
        },
      ],
      params: [
        {},
        {
          SENDER_ID: 'sender-2',
        },
      ],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('does not synthesize selected row params when the provider template has no public params', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            amount: '100',
            date: '1750270562375',
            hidden: false,
            originalIndex: 0,
            recipient: 'N/A',
          },
        ],
        providerConfig: buildProviderConfig(),
        request: buildRequest(),
      }),
    ).toEqual({
      metadata: [
        {
          amount: '100',
          date: '1750270562375',
          hidden: false,
          originalIndex: 0,
          params: {},
          recipient: 'N/A',
        },
      ],
      params: [{}],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('materializes raw provider-template param keys without adding index for strict schemas', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            hidden: false,
            originalIndex: 1,
          },
        ],
        providerConfig: buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].id',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify([{ id: 'payment-1' }, { id: 'payment-2' }]),
        }),
      }),
    ).toEqual({
      metadata: [
        {
          hidden: false,
          originalIndex: 1,
          params: {
            PAYMENT_ID: 'payment-2',
          },
        },
      ],
      params: [
        {
          PAYMENT_ID: 'payment-2',
        },
      ],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('materializes multiple provider-template params without adding index', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            hidden: false,
            originalIndex: 1,
          },
        ],
        providerConfig: buildProviderConfig({
          paramNames: ['TRANSACTION_ID', 'PROFILE_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].resource.id',
            },
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].ownedByProfile',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify([
            { ownedByProfile: 'profile-1', resource: { id: 'transaction-1' } },
            { ownedByProfile: 'profile-2', resource: { id: 'transaction-2' } },
          ]),
        }),
      }),
    ).toEqual({
      metadata: [
        {
          hidden: false,
          originalIndex: 1,
          params: {
            PROFILE_ID: 'profile-2',
            TRANSACTION_ID: 'transaction-2',
          },
        },
      ],
      params: [
        {
          PROFILE_ID: 'profile-2',
          TRANSACTION_ID: 'transaction-2',
        },
      ],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('uses the resolved metadata response body for provider-template param selectors', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [
          {
            hidden: false,
            originalIndex: 1,
          },
        ],
        paramResponseBodyString: JSON.stringify({
          data: {
            data: {
              activity: {
                transactions: [{ id: 'payment-1' }, { id: 'payment-2' }],
              },
            },
          },
        }),
        providerConfig: buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$.data.data.activity.transactions[{{INDEX}}].id',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify({ unrelated: true }),
        }),
      }),
    ).toEqual({
      metadata: [
        {
          hidden: false,
          originalIndex: 1,
          params: {
            PAYMENT_ID: 'payment-2',
          },
        },
      ],
      params: [
        {
          PAYMENT_ID: 'payment-2',
        },
      ],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('does not copy request-body params into public buyer TEE params', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [{ hidden: false, originalIndex: 0 }],
        providerConfig: buildProviderConfig({
          paramNames: ['REQUEST_BODY'],
          paramSelectors: [
            {
              source: 'requestBody',
              type: 'regex',
              value: '^(.+)$',
            },
          ],
        }),
        request: buildRequest({ method: 'POST', requestBody: 'secret=1' }),
      }),
    ).toEqual({
      metadata: [{ hidden: false, originalIndex: 0, params: {} }],
      params: [{}],
      sessionMaterial: {
        body: 'secret=1',
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('keeps selected rows when configured public buyer TEE params are unavailable', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [{ hidden: false, originalIndex: 0 }],
        providerConfig: buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].id',
            },
          ],
        }),
        request: buildRequest({ responseBody: JSON.stringify([{ missing: true }]) }),
      }),
    ).toEqual({
      metadata: [{ hidden: false, originalIndex: 0, params: {} }],
      params: [{}],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('does not synthesize index zero when public buyer TEE metadata is absent', () => {
    expect(() =>
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].id',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify([{ id: 'payment-1' }]),
        }),
      }),
    ).toThrow('Session metadata unavailable. Re-authenticate and try again.');
  });

  it('uses metadata position when original index is unavailable', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        metadata: [{ hidden: false } as MetadataMessageType],
        providerConfig: buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [
            {
              type: 'jsonPath',
              value: '$[{{INDEX}}].id',
            },
          ],
        }),
        request: buildRequest({
          responseBody: JSON.stringify([{ id: 'payment-1' }]),
        }),
      }),
    ).toEqual({
      metadata: [{ hidden: false, params: { PAYMENT_ID: 'payment-1' } }],
      params: [{ PAYMENT_ID: 'payment-1' }],
      sessionMaterial: {
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('detects when provider-template params need the zkTLS response-body resolver', () => {
    expect(
      shouldResolveBuyerTeeParamResponseBody(
        buildProviderConfig({
          paramNames: ['PAYMENT_ID'],
          paramSelectors: [{ type: 'jsonPath', value: '$[{{INDEX}}].id' }],
        }),
      ),
    ).toBe(true);
    expect(
      shouldResolveBuyerTeeParamResponseBody(
        buildProviderConfig({
          paramNames: ['REQUEST_BODY'],
          paramSelectors: [{ source: 'requestBody', type: 'regex', value: '^(.+)$' }],
        }),
      ),
    ).toBe(false);
    expect(shouldResolveBuyerTeeParamResponseBody(buildProviderConfig())).toBe(false);
  });

  it('adds captured request body to buyer TEE session material', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig(),
        request: buildRequest({ method: 'POST', requestBody: 'secret=1' }),
      }),
    ).toEqual({
      params: [],
      sessionMaterial: {
        body: 'secret=1',
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });

  it('adds captured form data to buyer TEE session material body', () => {
    expect(
      prepareBuyerTeeCaptureMaterial({
        providerConfig: buildProviderConfig(),
        request: buildRequest({
          formData: {
            operationName: ['GetPayAnyoneActivityDetailsQuery'],
            id: ['activity-1'],
          },
          method: 'POST',
        }),
      }),
    ).toEqual({
      params: [],
      sessionMaterial: {
        body: 'operationName=GetPayAnyoneActivityDetailsQuery&id=activity-1',
        cookie: 'session=abc',
        'User-Agent': 'Chrome',
      },
    });
  });
});
