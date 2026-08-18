import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestLog } from '@entries/Background/requestLog';
import { claimInPageReplayRequest, isInPageReplayRequest, replayRequestInPage } from './misc';

const request = {
  initiator: 'https://provider.example',
  method: 'POST',
  requestBody: '{"cursor":"1"}',
  requestHeaders: [{ name: 'content-type', value: 'application/json' }],
  requestId: 'request-1',
  tabId: 10,
  type: 'xmlhttprequest',
  url: 'https://provider.example/api/transactions?cursor=1',
} as RequestLog;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('replayRequestInPage', () => {
  it('fetches the exact captured URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const executeScript = vi.fn().mockImplementation(async ({ args, func }) => [
      {
        frameId: 0,
        result: await func(args[0]),
      },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript,
      },
    });

    await expect(replayRequestInPage(10, request)).resolves.toEqual({
      ok: true,
      status: 200,
      text: '{}',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      request.url,
      expect.objectContaining({
        body: request.requestBody,
        credentials: 'include',
        method: 'POST',
      }),
    );
    expect(isInPageReplayRequest(10, 'replay-request')).toBe(false);
  });

  it('clears replay state when script injection fails', async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error('injection failed'));
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript,
      },
    });

    await expect(replayRequestInPage(10, request)).resolves.toEqual({
      error: 'Error: injection failed',
      ok: false,
      status: 0,
    });
    expect(isInPageReplayRequest(10, 'replay-request')).toBe(false);
  });

  it('keeps replay state until concurrent replays for the tab finish', async () => {
    const resolvers: Array<(results: unknown[]) => void> = [];
    const executeScript = vi.fn().mockImplementation(
      () =>
        new Promise<unknown[]>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    vi.stubGlobal('chrome', {
      scripting: {
        executeScript,
      },
    });

    const firstReplay = replayRequestInPage(10, request);
    const secondReplay = replayRequestInPage(10, request);
    expect(
      claimInPageReplayRequest({
        method: request.method,
        requestBody: request.requestBody,
        requestId: 'replay-request-1',
        tabId: 10,
        url: request.url,
      }),
    ).toBe(true);
    expect(
      claimInPageReplayRequest({
        method: request.method,
        requestBody: request.requestBody,
        requestId: 'replay-request-2',
        tabId: 10,
        url: request.url,
      }),
    ).toBe(true);
    expect(isInPageReplayRequest(10, 'replay-request-1')).toBe(true);
    expect(isInPageReplayRequest(10, 'replay-request-2')).toBe(true);

    resolvers[0]([{ frameId: 0, result: { ok: true, status: 200, text: '{}' } }]);
    await firstReplay;
    expect(isInPageReplayRequest(10, 'replay-request-1')).toBe(false);
    expect(isInPageReplayRequest(10, 'replay-request-2')).toBe(true);

    resolvers[1]([{ frameId: 0, result: { ok: true, status: 200, text: '{}' } }]);
    await secondReplay;
    expect(isInPageReplayRequest(10, 'replay-request-2')).toBe(false);
  });
});
