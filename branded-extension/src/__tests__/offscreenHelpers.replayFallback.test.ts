import { afterEach, describe, expect, it, vi } from 'vitest';
import { OffscreenToBackgroundAction, type ProviderSettings } from '@utils/types';
import { buildReplayRequest, replayFallback } from '@utils/offscreenHelpers';
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

function buildMetadataReplayConfig(method: string, url: string): ProviderSettings {
  return {
    ...providerConfig,
    metadata: {
      ...providerConfig.metadata,
      metadataUrl: url,
      metadataUrlMethod: method,
    },
  };
}

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

    expect(requestedUrl).toBe('https://provider.example/api/replay');
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
      replayFallback(
        baseRequest,
        {
          ...providerConfig,
          metadata: {
            ...providerConfig.metadata,
            metadataUrl: 'https://evil.example/api/metadata',
          },
        },
        'json',
        { sameOriginOnly: true },
      ),
    ).rejects.toThrow('Unsafe replay target: origin mismatch');
  });

  it('rejects fallback replay targets outside the captured request origin', async () => {
    await expect(
      replayFallback(
        baseRequest,
        {
          ...providerConfig,
          url: 'https://evil.example/api/replay',
        },
        'json',
        { sameOriginOnly: true },
      ),
    ).rejects.toThrow('Unsafe replay target: origin mismatch');
  });

  it.each(['GET', 'HEAD'])('allows %s replay to another URL on the same origin', (method) => {
    const replay = buildReplayRequest(
      baseRequest,
      buildMetadataReplayConfig(method, 'https://provider.example/api/replay'),
      { sameOriginOnly: true },
    );

    expect(replay).toEqual(
      expect.objectContaining({ method, url: 'https://provider.example/api/replay' }),
    );
  });

  it('allows POST replay to the captured request URL', () => {
    const replay = buildReplayRequest(
      baseRequest,
      buildMetadataReplayConfig('POST', baseRequest.url),
      { sameOriginOnly: true },
    );

    expect(replay).toEqual(
      expect.objectContaining({
        method: 'POST',
        url: baseRequest.url,
      }),
    );
  });

  it.each(['https://provider.example/api/replay', `${baseRequest.url}?action=send`])(
    'rejects POST replay when the target URL differs before sending the request',
    async (url) => {
      const sendMessage = vi.fn();
      vi.stubGlobal('chrome', {
        runtime: {
          lastError: undefined,
          sendMessage,
        },
      });

      await expect(
        replayFallback(baseRequest, buildMetadataReplayConfig('POST', url), 'json', {
          sameOriginOnly: true,
        }),
      ).rejects.toThrow('POST replay URL must match the captured request URL');
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it('preserves trusted managed-template replay across provider subdomains', () => {
    expect(
      buildReplayRequest(baseRequest, {
        ...providerConfig,
        url: 'https://api.provider.example/api/replay',
      }),
    ).toEqual(
      expect.objectContaining({
        requestHeaders: [{ name: 'authorization', value: 'test-auth-value' }],
        url: 'https://api.provider.example/api/replay',
      }),
    );
  });
});
