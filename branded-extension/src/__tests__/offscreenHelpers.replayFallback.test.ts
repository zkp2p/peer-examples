import { afterEach, describe, expect, it, vi } from 'vitest';
import { OffscreenToBackgroundAction, type ProviderSettings } from '@utils/types';
import { replayFallback } from '@utils/offscreenHelpers';
import type { RequestLog } from '@entries/Background/requestLog';

const baseRequest: RequestLog = {
  initiator: null,
  method: 'GET',
  requestHeaders: [{ name: 'authorization', value: 'test-auth-value' }],
  requestId: 'request-1',
  responseHeaders: [],
  tabId: 12,
  timestamp: 0,
  type: 'xmlhttprequest',
  url: 'https://provider.example/api/context',
};

const providerConfig: ProviderSettings = {
  authLink: 'https://provider.example/login',
  body: '',
  method: 'GET',
  metadata: {
    fallbackMethod: 'GET',
    fallbackUrlRegex: 'context',
    method: 'GET',
    platform: 'provider',
    preprocessRegex: '',
    shouldReplayRequestInPage: true,
    transactionsExtraction: {},
    urlRegex: 'context',
  },
  paramNames: [],
  paramSelectors: [],
  url: 'https://provider.example/api/replay',
};

describe('offscreenHelpers.replayFallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the replay request without a duplicate tabId wrapper', async () => {
    let sentMessage: unknown;
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (message: unknown, callback: (response?: unknown) => void) => {
          sentMessage = message;
          callback({ ok: true, status: 200, text: '{"ok":true}' });
        },
      },
    });

    await expect(replayFallback(baseRequest, providerConfig)).resolves.toEqual({ ok: true });

    expect(sentMessage).toEqual({
      action: OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND,
      data: {
        request: {
          ...baseRequest,
          method: 'GET',
          requestBody: '',
          url: 'https://provider.example/api/replay',
        },
      },
    });
  });

  it('uses the provider body when metadataUrlBody is omitted', async () => {
    let sentMessage: unknown;
    vi.stubGlobal('chrome', {
      runtime: {
        lastError: undefined,
        sendMessage: (message: unknown, callback: (response?: unknown) => void) => {
          sentMessage = message;
          callback({ ok: true, status: 200, text: '{"ok":true}' });
        },
      },
    });

    await replayFallback(baseRequest, {
      ...providerConfig,
      body: '{"cursor":"1"}',
      method: 'POST',
      metadata: {
        ...providerConfig.metadata,
        metadataUrl: 'https://provider.example/api/metadata',
        metadataUrlMethod: 'POST',
      },
    });

    expect(sentMessage).toEqual({
      action: OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND,
      data: {
        request: {
          ...baseRequest,
          method: 'POST',
          requestBody: '{"cursor":"1"}',
          url: 'https://provider.example/api/metadata',
        },
      },
    });
  });

  it('uses fetch replay with request headers, body, and text responses', async () => {
    let requestedUrl = '';
    let requestedOptions: RequestInit | undefined;
    vi.stubGlobal('fetch', async (url: string | URL, options?: RequestInit) => {
      requestedUrl = String(url);
      requestedOptions = options;
      return {
        text: async () => 'statement text',
      };
    });

    await expect(
      replayFallback(
        {
          ...baseRequest,
          method: 'POST',
          requestHeaders: [{ name: 'authorization', value: 'test-auth-value' }, { name: 'x-empty' }],
        },
        {
          ...providerConfig,
          body: '{"cursor":"1"}',
          method: 'POST',
          metadata: {
            ...providerConfig.metadata,
            shouldReplayRequestInPage: false,
          },
        },
        'text',
      ),
    ).resolves.toBe('statement text');

    expect(requestedUrl).toBe('https://provider.example/api/replay?replay_request=1');
    expect(requestedOptions).toEqual({
      body: '{"cursor":"1"}',
      headers: {
        authorization: 'test-auth-value',
      },
      method: 'POST',
    });
  });

  it('rejects metadataUrl replay targets outside the captured request origin', async () => {
    await expect(
      replayFallback(baseRequest, {
        ...providerConfig,
        metadata: {
          ...providerConfig.metadata,
          metadataUrl: 'https://evil.example/api/metadata',
        },
      }),
    ).rejects.toThrow('Unsafe metadataUrl: protocol or host mismatch');
  });
});
