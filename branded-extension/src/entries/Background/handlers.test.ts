import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearRequestsLogsCache, getCacheByTabId } from './cache';
import {
  clearInterceptPatterns,
  onBeforeRequest,
  onResponseStarted,
  onSendHeaders,
  setInterceptPatterns,
} from './handlers';
import type { RequestLog } from './requestLog';
import { replayRequestInPage } from '@utils/misc';

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

  it('ignores only the replay request while preserving concurrent provider traffic', async () => {
    type InjectionResult = {
      frameId: number;
      result: { ok: boolean; status: number; text: string };
    };
    let resolveInjection!: (results: InjectionResult[]) => void;
    const executeScript = vi.fn().mockReturnValue(
      new Promise<InjectionResult[]>((resolve) => {
        resolveInjection = resolve;
      }),
    );
    vi.stubGlobal('chrome', {
      runtime: {
        id: 'extension-id',
      },
      scripting: {
        executeScript,
      },
    });
    setInterceptPatterns(['transactions'], 10);
    const replayUrl = 'https://provider.example/api/transactions';
    const replayBody = '{"operationName":"ProviderTransactionsQuery"}';
    const metadataBody = '{"operationName":"ProviderActivityQuery"}';

    const replayPromise = replayRequestInPage(10, {
      initiator: 'https://provider.example',
      method: 'POST',
      requestBody: replayBody,
      requestHeaders: [],
      requestId: 'original-request',
      tabId: 10,
      type: 'xmlhttprequest',
      url: replayUrl,
    } as RequestLog);

    onBeforeRequest({
      ...requestDetails({ requestId: 'metadata-request', method: 'POST', url: replayUrl }),
      requestBody: { raw: [{ bytes: new TextEncoder().encode(metadataBody).buffer }] },
    } as chrome.webRequest.WebRequestBodyDetails);
    onSendHeaders(
      requestDetails({ requestId: 'metadata-request', method: 'POST', url: replayUrl }),
    );
    await nextTick();

    expect(getCacheByTabId(10).get('metadata-request')).toEqual(
      expect.objectContaining({
        requestBody: metadataBody,
        url: replayUrl,
      }),
    );

    onBeforeRequest({
      ...requestDetails({ requestId: 'replay-request', method: 'POST', url: replayUrl }),
      requestBody: { raw: [{ bytes: new TextEncoder().encode(replayBody).buffer }] },
    } as chrome.webRequest.WebRequestBodyDetails);
    onSendHeaders(requestDetails({ requestId: 'replay-request', method: 'POST', url: replayUrl }));
    onResponseStarted({
      ...requestDetails({ requestId: 'replay-request', method: 'POST', url: replayUrl }),
      responseHeaders: [],
      statusCode: 200,
      statusLine: 'HTTP/2 200',
    } as chrome.webRequest.WebResponseHeadersDetails);
    await nextTick();

    expect(getCacheByTabId(10).get('replay-request')).toBeUndefined();

    resolveInjection([
      {
        frameId: 0,
        result: { ok: true, status: 200, text: '{}' },
      },
    ]);
    await replayPromise;

    onSendHeaders(requestDetails({ requestId: 'after-replay' }));
    await nextTick();
    expect(getCacheByTabId(10).get('after-replay')).toBeDefined();
  });
});
