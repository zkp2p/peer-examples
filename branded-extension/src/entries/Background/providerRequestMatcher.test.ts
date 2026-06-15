import { describe, expect, it } from 'vitest';
import type { ProviderSettings } from '@utils/types';

import { isProviderContextRequest } from './providerRequestMatcher';
import type { RequestLog } from './requestLog';

const baseRequest: RequestLog = {
  requestId: 'req-1',
  tabId: 1,
  method: 'POST',
  type: 'xmlhttprequest',
  url: 'https://app.chime.com/api/graphql',
  initiator: null,
  requestHeaders: [],
  timestamp: 0,
};

const chimeLikeProviderConfig: ProviderSettings = {
  authLink: 'https://app.chime.com/',
  url: 'https://app.chime.com/api/graphql',
  method: 'POST',
  body: '{{BODY}}',
  metadata: {
    platform: 'chime',
    urlRegex: 'https://app\\.chime\\.com/api/graphql',
    bodyRegex: '"operationName":"GetPayAnyoneActivityDetailsQuery"',
    method: 'POST',
    fallbackUrlRegex: '',
    fallbackMethod: '',
    preprocessRegex: '',
    transactionsExtraction: {
      transactionJsonPathSelectors: {
        amount: '$.data.amount',
      },
    },
  },
  paramNames: ['BODY'],
  paramSelectors: [],
};

describe('providerRequestMatcher', () => {
  it('ignores same-endpoint requests that do not satisfy bodyRegex', () => {
    expect(
      isProviderContextRequest(
        {
          ...baseRequest,
          requestBody: '{"operationName":"AccountOverviewQuery"}',
        },
        chimeLikeProviderConfig,
      ),
    ).toBe(false);
  });

  it('matches same-endpoint requests that satisfy bodyRegex', () => {
    expect(
      isProviderContextRequest(
        {
          ...baseRequest,
          requestBody: '{"operationName":"GetPayAnyoneActivityDetailsQuery"}',
        },
        chimeLikeProviderConfig,
      ),
    ).toBe(true);
  });

  it('matches formData when requestBody is unavailable', () => {
    const providerConfig: ProviderSettings = {
      ...chimeLikeProviderConfig,
      metadata: {
        ...chimeLikeProviderConfig.metadata,
        bodyRegex: 'GetPayAnyoneActivityDetailsQuery',
      },
    };

    expect(
      isProviderContextRequest(
        {
          ...baseRequest,
          formData: { operationName: ['GetPayAnyoneActivityDetailsQuery'] },
        },
        providerConfig,
      ),
    ).toBe(true);
  });

  it('matches unfiltered primary metadata requests by method and URL', () => {
    const providerConfig: ProviderSettings = {
      ...chimeLikeProviderConfig,
      metadata: {
        ...chimeLikeProviderConfig.metadata,
        bodyRegex: undefined,
      },
    };

    expect(isProviderContextRequest(baseRequest, providerConfig)).toBe(true);
  });

  it('matches fallback metadata requests with fallback body filters', () => {
    const providerConfig: ProviderSettings = {
      ...chimeLikeProviderConfig,
      metadata: {
        ...chimeLikeProviderConfig.metadata,
        bodyRegex: 'NeverMatches',
        fallbackMethod: 'POST',
        fallbackUrlRegex: 'api/graphql',
        fallbackBodyRegex: 'FallbackDetailsQuery',
      },
    };

    expect(
      isProviderContextRequest(
        {
          ...baseRequest,
          requestBody: '{"operationName":"FallbackDetailsQuery"}',
        },
        providerConfig,
      ),
    ).toBe(true);
  });
});
