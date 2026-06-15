import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRequestsLogsCache, getCacheByTabId } from './cache';
import { clearInterceptPatterns, onSendHeaders, setInterceptPatterns } from './handlers';

const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));

function requestDetails(
  overrides: Partial<chrome.webRequest.WebRequestHeadersDetails> = {},
): chrome.webRequest.WebRequestHeadersDetails {
  return {
    documentId: 'document-1',
    documentLifecycle: 'active',
    frameId: 0,
    frameType: 'outermost_frame',
    initiator: 'https://provider.example',
    method: 'GET',
    parentFrameId: -1,
    requestHeaders: [{ name: 'authorization', value: 'test-auth-value' }],
    requestId: 'request-1',
    tabId: 10,
    timeStamp: 0,
    type: 'xmlhttprequest',
    url: 'https://provider.example/api/transactions',
    ...overrides,
  } as chrome.webRequest.WebRequestHeadersDetails;
}

describe('Background handlers tab-scoped interception', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
      },
    });
  });

  afterEach(() => {
    clearInterceptPatterns(10);
    clearInterceptPatterns(11);
    clearRequestsLogsCache();
    vi.unstubAllGlobals();
  });

  it('captures matching requests for the configured tab', async () => {
    setInterceptPatterns(['transactions'], 10);

    onSendHeaders(requestDetails());
    await nextTick();

    expect(getCacheByTabId(10).get('request-1')?.url).toBe(
      'https://provider.example/api/transactions',
    );
  });

  it('does not fall back to patterns configured for another tab', async () => {
    setInterceptPatterns(['transactions'], 10);

    onSendHeaders(requestDetails({ requestId: 'request-2', tabId: 11 }));
    await nextTick();

    expect(getCacheByTabId(11).get('request-2')).toBeUndefined();
  });

  it('stops capturing after clearing tab patterns', async () => {
    setInterceptPatterns(['transactions'], 10);
    clearInterceptPatterns(10);

    onSendHeaders(requestDetails({ requestId: 'request-3' }));
    await nextTick();

    expect(getCacheByTabId(10).get('request-3')).toBeUndefined();
  });
});
