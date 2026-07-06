import { JSONPath } from 'jsonpath-plus';
import type { RequestLog } from '@entries/Background/requestLog';
import {
  OffscreenToBackgroundAction,
  type MetadataMessageType,
  type ParamSelector,
  type ProviderSettings,
} from '@utils/types';
import { logger } from '@utils/logger';
import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import {
  interpolateIndex,
  evaluateRegexSelector,
  evaluateXPathSelector,
} from '@utils/selectorUtils';

type MetadataFields = Record<string, unknown>;
type JsonPathInput = string | number | boolean | object | unknown[] | null;
type ReplayResponseType = 'json' | 'text';
type ReplayTarget = {
  body: string | undefined;
  method: string;
  url: string;
};

export function findMatchingRequest(
  requests: RequestLog[],
  method: string,
  urlRegex: string,
  bodyRegex?: string,
): RequestLog | undefined {
  const regex = new RegExp(urlRegex);
  const bodyMatcher = bodyRegex ? new RegExp(bodyRegex) : null;
  return requests.find((r) => {
    if (r.method !== method || !regex.test(r.url)) return false;
    if (!bodyMatcher) return true;
    const body = r.requestBody ?? (r.formData ? JSON.stringify(r.formData) : '');
    return !!body && bodyMatcher.test(body);
  });
}

function tryParseJson(str: string): unknown | undefined {
  try {
    return JSON.parse(str);
  } catch {
    return undefined;
  }
}

export function parseJsonSafely(str: string): unknown | undefined {
  const parsed = tryParseJson(str);
  if (typeof parsed === 'string') {
    return tryParseJson(parsed) ?? parsed;
  }
  if (parsed !== undefined) {
    return parsed;
  }
  if (!str.includes('\\"')) {
    return undefined;
  }
  return tryParseJson(str.replace(/\\"/g, '"'));
}

export function parseRequestBody(request: RequestLog, preprocessRegex?: string): unknown {
  try {
    if (preprocessRegex) {
      const pre = new RegExp(preprocessRegex);
      const match = (request.responseBody as string | undefined)?.match(pre);
      if (match && match[1]) {
        logger.log('[Offscreen] Parsed response body:', parseJsonSafely(match[1]));
        return parseJsonSafely(match[1]);
      }
      // If preprocessing regex is provided but doesn't match, return undefined
      return undefined;
    }
    return JSON.parse(request.responseBody as string);
  } catch {
    return undefined;
  }
}

function resolveReplayTarget(
  fallbackRequest: RequestLog,
  providerConfig: ProviderSettings,
): ReplayTarget {
  const metadataUrl = providerConfig.metadata.metadataUrl;
  const target: ReplayTarget = metadataUrl
    ? {
        body: providerConfig.metadata.metadataUrlBody ?? providerConfig.body,
        method: providerConfig.metadata.metadataUrlMethod || providerConfig.method,
        url: metadataUrl,
      }
    : {
        body: providerConfig.body,
        method: providerConfig.method,
        url: providerConfig.url,
      };

  if (!metadataUrl) {
    return target;
  }

  try {
    const replayUrl = new URL(target.url);
    const contextUrl = new URL(fallbackRequest.url);
    if (replayUrl.protocol !== 'https:' || replayUrl.host !== contextUrl.host) {
      throw new Error(
        `Unsafe metadataUrl: protocol or host mismatch (target=${replayUrl.href}, contextHost=${contextUrl.host})`,
      );
    }
  } catch (error) {
    throw new Error(`Invalid metadataUrl: ${String(error)}`);
  }

  return target;
}

export function buildReplayRequest(
  fallbackRequest: RequestLog,
  providerConfig: ProviderSettings,
): RequestLog {
  const target = resolveReplayTarget(fallbackRequest, providerConfig);

  return {
    ...fallbackRequest,
    method: target.method,
    requestBody: target.body,
    url: target.url,
  };
}

export async function replayFallback(
  fallbackRequest: RequestLog,
  providerConfig: ProviderSettings,
  responseType: ReplayResponseType = 'json',
): Promise<unknown> {
  const replayRequest = buildReplayRequest(fallbackRequest, providerConfig);

  if (providerConfig.metadata.shouldReplayRequestInPage) {
    const response = await safeChromeRuntimeSendMessage<{
      ok: boolean;
      status: number;
      text?: string;
      error?: string;
    }>({
      action: OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND,
      data: {
        request: replayRequest,
      },
    });

    if (!response || !response.ok) {
      throw new Error(response?.error || 'Failed to replay request');
    }
    // Respect desired response type: XPath/HTML flows need raw text
    if (responseType === 'text') {
      return response.text ?? '';
    }
    return JSON.parse(response.text || '{}');
  }

  const options: RequestInit = {
    method: replayRequest.method,
    headers: headersToMap(replayRequest.requestHeaders),
  };

  if (
    replayRequest.method !== 'GET' &&
    replayRequest.method !== 'HEAD' &&
    replayRequest.requestBody
  ) {
    options.body = replayRequest.requestBody;
  }

  const actualUrl = new URL(replayRequest.url);
  actualUrl.searchParams.append('replay_request', '1');

  const resp = await fetch(actualUrl.toString(), options);
  return responseType === 'text' ? await resp.text() : await resp.json();
}

function hasMissingFields(fields: MetadataFields, treatEmptyStringAsMissing: boolean): boolean {
  return Object.values(fields).some(
    (value) => value === undefined || value === null || (treatEmptyStringAsMissing && value === ''),
  );
}

function toMetadataMessage(
  fields: MetadataFields,
  originalIndex: number,
  treatEmptyStringAsMissing: boolean,
): MetadataMessageType {
  return {
    ...fields,
    hidden: hasMissingFields(fields, treatEmptyStringAsMissing),
    originalIndex,
  } as MetadataMessageType;
}

function extractXPathFields(
  selectors: Record<string, string>,
  doc: Document,
  originalIndex: number,
  options?: { scopeNode?: Node | null; trimValues?: boolean },
): MetadataFields {
  const fields: MetadataFields = {};
  Object.entries(selectors).forEach(([fieldName, xPath]) => {
    const value = evaluateXPathSelector(xPath, doc, originalIndex, options?.scopeNode);
    fields[fieldName] = options?.trimValues
      ? (value || '').trim() || undefined
      : value || undefined;
  });
  return fields;
}

function queryJsonPath(path: string, json: unknown): unknown[] {
  const result = JSONPath({ path, json: json as JsonPathInput }) as unknown;
  return Array.isArray(result) ? result : [result];
}

function extractJsonPathFields(
  selectors: Record<string, string>,
  json: unknown,
  originalIndex: number,
): MetadataFields {
  const fields: MetadataFields = {};
  Object.entries(selectors).forEach(([fieldName, jsonPath]) => {
    const pathWithIndex = interpolateIndex(jsonPath, originalIndex);
    fields[fieldName] = queryJsonPath(pathWithIndex, json)[0];
  });
  return fields;
}

export function extractTransactions(
  responseBody: unknown,
  providerConfig: ProviderSettings,
): MetadataMessageType[] {
  const extraction = providerConfig.metadata.transactionsExtraction;

  if (extraction.transactionXPathListSelector || extraction.transactionXPathSelectors) {
    try {
      const bodyString =
        typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
      const parser = new DOMParser();
      const doc = parser.parseFromString(bodyString, 'text/html');

      const selectors = extraction.transactionXPathSelectors || {};

      if (extraction.transactionXPathListSelector) {
        const listSnapshot = doc.evaluate(
          extraction.transactionXPathListSelector,
          doc,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );

        const count = listSnapshot.snapshotLength;
        if (!count) return [];

        const results: MetadataMessageType[] = [];
        for (let i = 0; i < count; i++) {
          const node = listSnapshot.snapshotItem(i) as Node | null;
          if (!node) continue;
          const fields = extractXPathFields(selectors, doc, i, { scopeNode: node });
          results.push(toMetadataMessage(fields, i, true));
        }
        return results;
      } else {
        const fields = extractXPathFields(selectors, doc, 0, { trimValues: true });
        return [toMetadataMessage(fields, 0, true)];
      }
    } catch (error) {
      logger.error('[extractTransactions][XPath] Failed to parse/evaluate HTML:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  if (extraction.transactionJsonPathListSelector || extraction.transactionJsonPathSelectors) {
    try {
      const jsonBody = typeof responseBody === 'string' ? JSON.parse(responseBody) : responseBody;
      const selectors = extraction.transactionJsonPathSelectors || {};
      if (extraction.transactionJsonPathListSelector) {
        const list = queryJsonPath(extraction.transactionJsonPathListSelector, jsonBody);

        if (!list || list.length === 0 || !list[0]) {
          return [];
        }

        if (!Array.isArray(list[0])) {
          return [];
        }

        return list[0].map((transfer: unknown, originalIndex: number) => {
          const fields = extractJsonPathFields(selectors, transfer, originalIndex);
          return toMetadataMessage(fields, originalIndex, false);
        });
      } else {
        const fields = extractJsonPathFields(selectors, jsonBody, 0);
        return [toMetadataMessage(fields, 0, false)];
      }
    } catch (error) {
      logger.error('[extractTransactions][JSONPath] Failed to parse/evaluate JSON:', error);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  return [];
}

function headersToMap(headers: chrome.webRequest.HttpHeader[]): Record<string, string> {
  return headers.reduce((acc: { [key: string]: string }, h) => {
    if (h.name && h.value) acc[h.name] = h.value;
    return acc;
  }, {});
}

export function extractValue(
  selector: ParamSelector,
  dataRequest: RequestLog,
  responseBodyString: string,
  originalIndex: number,
): string {
  const source = selector.source || 'responseBody';
  let sourceData: string = '';

  switch (source) {
    case 'responseBody':
      sourceData = responseBodyString;
      break;
    case 'requestBody':
      sourceData = dataRequest.requestBody || '';
      break;
    case 'requestHeaders':
      // Convert headers array to JSON string for extraction
      const requestHeadersMap = headersToMap(dataRequest.requestHeaders);
      sourceData = JSON.stringify(requestHeadersMap);
      break;
    case 'responseHeaders':
      // Convert headers array to JSON string for extraction
      const responseHeadersMap = headersToMap(dataRequest.responseHeaders || []);
      sourceData = JSON.stringify(responseHeadersMap);
      break;
    case 'url':
      sourceData = dataRequest.url;
      break;
  }

  switch (selector.type) {
    case 'jsonPath':
      try {
        const jsonPath = interpolateIndex(selector.value, originalIndex);
        const jsonData = source === 'url' ? { url: sourceData } : JSON.parse(sourceData);
        const result = queryJsonPath(jsonPath, jsonData)[0];
        return result !== undefined ? String(result) : '';
      } catch (error) {
        logger.error(`[Offscreen] Error parsing JSON for ${source}:`, error);
        return '';
      }
    case 'regex':
      return evaluateRegexSelector(selector.value, sourceData, originalIndex);
    case 'xPath':
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(sourceData, 'text/html');
        return evaluateXPathSelector(selector.value, doc, originalIndex);
      } catch (error) {
        logger.error('[Offscreen] Error evaluating XPath selector:', error);
        return '';
      }
  }
}
