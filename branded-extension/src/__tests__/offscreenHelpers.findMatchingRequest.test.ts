import { describe, expect, it } from 'vitest';
import { findMatchingRequest } from '@utils/offscreenHelpers';
import type { RequestLog } from '@entries/Background/requestLog';

const baseRequest: RequestLog = {
  requestId: 'req-1',
  tabId: 1,
  method: 'POST',
  type: 'xmlhttprequest',
  url: 'https://example.com/api/graphql',
  initiator: null,
  requestHeaders: [],
  timestamp: 0,
};

describe('offscreenHelpers.findMatchingRequest', () => {
  it('matches by method and urlRegex when no bodyRegex is provided', () => {
    const reqs: RequestLog[] = [{ ...baseRequest }];
    const match = findMatchingRequest(reqs, 'POST', 'graphql');
    expect(match?.requestId).toBe('req-1');
  });

  it('filters by bodyRegex when provided', () => {
    const reqs: RequestLog[] = [
      { ...baseRequest, requestId: 'req-a', requestBody: '{"operationName":"Foo"}' },
      { ...baseRequest, requestId: 'req-b', requestBody: '{"operationName":"PayAnyoneDetail"}' },
    ];
    const match = findMatchingRequest(reqs, 'POST', 'graphql', 'PayAnyoneDetail');
    expect(match?.requestId).toBe('req-b');
  });

  it('matches against formData when requestBody is missing', () => {
    const reqs: RequestLog[] = [
      {
        ...baseRequest,
        requestId: 'req-form',
        requestBody: undefined,
        formData: { operationName: ['PayAnyoneDetail'] },
      },
    ];
    const match = findMatchingRequest(reqs, 'POST', 'graphql', 'PayAnyoneDetail');
    expect(match?.requestId).toBe('req-form');
  });

  it('does not match when bodyRegex is provided but no body is available', () => {
    const reqs: RequestLog[] = [{ ...baseRequest, requestId: 'req-empty', requestBody: undefined }];
    const match = findMatchingRequest(reqs, 'POST', 'graphql', 'PayAnyoneDetail');
    expect(match).toBeUndefined();
  });
});
