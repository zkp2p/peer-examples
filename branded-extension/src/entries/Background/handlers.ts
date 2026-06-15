import { getCacheByTabId } from './cache';
import mutex from './mutex';
import type { RequestLog } from './requestLog';
import { replayRequest, replayRequestInPage } from '@utils/misc';
import { logger } from '@utils/logger';

const interceptRegexesByTabId = new Map<number, string[]>();
const shouldReplayRequestInPageByTabId = new Map<number, boolean>();
let metadataRequestCapturedHandler: ((request: RequestLog) => void | Promise<void>) | null = null;

export function setMetadataRequestCapturedHandler(
  handler: ((request: RequestLog) => void | Promise<void>) | null,
): void {
  metadataRequestCapturedHandler = handler;
}

export function setInterceptPatterns(patterns: string[], tabId: number): void {
  interceptRegexesByTabId.set(tabId, patterns);
}

export function clearInterceptPatterns(tabId: number): void {
  interceptRegexesByTabId.delete(tabId);
}

export function setShouldReplayRequestInPage(shouldReplayRequest: boolean, tabId: number) {
  shouldReplayRequestInPageByTabId.set(tabId, shouldReplayRequest);
}

export function clearShouldReplayRequestInPage(tabId: number) {
  shouldReplayRequestInPageByTabId.delete(tabId);
}

function shouldIntercept(url: string, tabId: number): boolean {
  if (tabId < 0) return false;
  const patterns = interceptRegexesByTabId.get(tabId);
  return patterns?.some((pattern) => new RegExp(pattern).test(url)) ?? false;
}

function shouldReplayInPage(tabId: number): boolean {
  return shouldReplayRequestInPageByTabId.get(tabId) ?? false;
}

function isRelevantRequestType(type: chrome.webRequest.ResourceType): boolean {
  return type === 'xmlhttprequest' || type === 'main_frame';
}

function isReplayRequest(url: string): boolean {
  return url.includes('replay_request=1');
}

function isExtensionInitiated(initiator?: string): boolean {
  return Boolean(initiator && initiator.includes(chrome.runtime.id));
}

function decodeRequestBody(raw: chrome.webRequest.UploadData[] | undefined): string | undefined {
  const bytes = raw?.[0]?.bytes;
  if (!bytes) return undefined;
  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch (error) {
    logger.error('[Background] Failed to decode request body:', error);
    return undefined;
  }
}

export const onSendHeaders = (details: chrome.webRequest.WebRequestHeadersDetails) => {
  void mutex.runExclusive(async () => {
    const { method, tabId, requestId, type, initiator, url } = details;

    if (!isRelevantRequestType(type) || isExtensionInitiated(initiator) || isReplayRequest(url)) {
      return;
    }
    if (!shouldIntercept(url, tabId) || method === 'OPTIONS' || method === 'HEAD') {
      return;
    }

    const cache = getCacheByTabId(tabId);
    const existing = cache.get(requestId);
    cache.set(requestId, {
      ...existing,
      method,
      type,
      url,
      initiator: initiator || null,
      requestHeaders: details.requestHeaders || [],
      tabId,
      requestId,
    } as RequestLog);
  });
};

export const onBeforeRequest = (details: chrome.webRequest.WebRequestBodyDetails) => {
  void mutex.runExclusive(async () => {
    const { method, requestBody, tabId, requestId, type, initiator, url } = details;
    if (!isRelevantRequestType(type) || isExtensionInitiated(initiator) || isReplayRequest(url)) {
      return;
    }
    if (!shouldIntercept(url, tabId) || method === 'OPTIONS' || method === 'HEAD') {
      return;
    }

    const cache = getCacheByTabId(tabId);
    const existing = cache.get(requestId);
    if (requestBody?.raw) {
      const decoded = decodeRequestBody(requestBody.raw);
      if (decoded !== undefined) {
        cache.set(requestId, {
          ...existing,
          requestBody: decoded,
        } as RequestLog);
      }
      return;
    }

    if (requestBody?.formData) {
      cache.set(requestId, {
        ...existing,
        formData: requestBody.formData,
      } as RequestLog);
    }
  });
};

export const onResponseStarted = (details: chrome.webRequest.WebResponseHeadersDetails) => {
  void mutex.runExclusive(async () => {
    const { method, responseHeaders, tabId, requestId, statusCode, type, initiator, url } = details;
    if (!isRelevantRequestType(type) || isExtensionInitiated(initiator) || isReplayRequest(url)) {
      return;
    }
    if (!shouldIntercept(url, tabId) || method === 'OPTIONS' || method === 'HEAD') {
      return;
    }
    if (statusCode < 200 || statusCode >= 300) {
      return;
    }

    const cache = getCacheByTabId(tabId);
    const existing = cache.get(requestId);
    const requestLog: RequestLog = {
      requestHeaders: [],
      ...existing,
      method,
      type,
      url,
      initiator: initiator || null,
      tabId,
      requestId,
      responseHeaders,
      timestamp: Date.now(),
    };

    const response = shouldReplayInPage(tabId)
      ? await replayRequestInPage(tabId, requestLog)
      : await replayRequest(requestLog);
    const requestWithBody: RequestLog = {
      ...requestLog,
      responseBody: response.text,
    };

    cache.set(requestId, requestWithBody);
    await metadataRequestCapturedHandler?.(requestWithBody);
  });
};
