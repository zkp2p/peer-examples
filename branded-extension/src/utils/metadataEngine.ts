import type { RequestLog } from '@entries/Background/requestLog';
import type { MetadataMessageType, ParamSelector, ProviderSettings } from '@utils/types';
import {
  extractTransactions,
  extractValue,
  buildReplayRequest,
  findMatchingRequest,
  parseJsonSafely,
  parseRequestBody,
  replayFallback,
} from '@utils/offscreenHelpers';

export type ExtractionPayload = {
  request: RequestLog;
  bodyStr: string;
  bodyJson?: unknown;
};

export function getContextRequests(
  requests: RequestLog[] | undefined,
  cfg: ProviderSettings,
): { found?: RequestLog; fallback?: RequestLog } {
  if (!requests) return {};
  const found = findMatchingRequest(
    requests,
    cfg.metadata.method,
    cfg.metadata.urlRegex,
    cfg.metadata.bodyRegex,
  );
  const fallback = !found
    ? findMatchingRequest(
        requests,
        cfg.metadata.fallbackMethod,
        cfg.metadata.fallbackUrlRegex,
        cfg.metadata.fallbackBodyRegex,
      )
    : undefined;
  return { found, fallback };
}

function hasXPathExtraction(cfg: ProviderSettings): boolean {
  const tx = cfg.metadata.transactionsExtraction;
  return !!(tx?.transactionXPathListSelector || tx?.transactionXPathSelectors);
}

export async function resolveMetadataPayload(
  reqs: { found?: RequestLog; fallback?: RequestLog },
  cfg: ProviderSettings,
): Promise<ExtractionPayload> {
  const useMetadataUrl = !!cfg.metadata.metadataUrl;
  const wantsHtml = hasXPathExtraction(cfg);

  if (useMetadataUrl) {
    const context = reqs.found || reqs.fallback;
    if (!context) {
      throw new Error('metadataUrl specified but no matching request found for context');
    }
    return await resolveViaReplay(context, cfg, wantsHtml);
  }

  if (reqs.found) {
    const bodyStr = String(reqs.found.responseBody || '');
    const bodyJson = wantsHtml
      ? undefined
      : parseRequestBody(reqs.found, cfg.metadata.preprocessRegex);
    return { request: reqs.found, bodyStr, bodyJson };
  }

  if (!reqs.fallback) {
    throw new Error('No fallback request available for extraction');
  }
  return await resolveViaReplay(reqs.fallback, cfg, wantsHtml);
}

async function resolveViaReplay(
  request: RequestLog,
  cfg: ProviderSettings,
  wantsHtml: boolean,
): Promise<ExtractionPayload> {
  const resp = await replayFallback(request, cfg, wantsHtml ? 'text' : 'json');
  const { str: bodyStr, json: bodyJson } = normalizeResponse(resp);
  return {
    request: {
      ...buildReplayRequest(request, cfg),
      responseBody: bodyStr,
    },
    bodyStr,
    bodyJson,
  };
}

export function extractTransactionsFromPayload(
  payload: ExtractionPayload,
  cfg: ProviderSettings,
): MetadataMessageType[] {
  const responseInput = payload.bodyJson !== undefined ? payload.bodyJson : payload.bodyStr;
  return extractTransactions(responseInput, cfg);
}

export function normalizeResponse(response: unknown): { str: string; json?: unknown } {
  if (typeof response === 'string') {
    const parsed = parseJsonSafely(response);
    return { str: response, json: parsed };
  }
  try {
    return { str: JSON.stringify(response), json: response };
  } catch {
    return { str: String(response) };
  }
}

export function computeParamValues(
  names: string[],
  selectors: ParamSelector[],
  request: RequestLog,
  bodyStr: string,
  originalIndex: number,
): Record<string, string> {
  const values: Record<string, string> = {};
  names.forEach((name, index) => {
    const selector = selectors[index];
    values[name] = selector ? extractValue(selector, request, bodyStr, originalIndex) : '';
  });
  return values;
}

export async function resolveParamExtractionResponseBodyString({
  dataRequest,
  metadataPayload,
  providerConfig,
}: {
  dataRequest: RequestLog;
  metadataPayload?: ExtractionPayload;
  providerConfig: ProviderSettings;
}): Promise<string> {
  if (providerConfig.metadata.metadataUrl) {
    if (metadataPayload) {
      return metadataPayload.bodyStr;
    }
    const replayedBody = await replayFallback(dataRequest, providerConfig, 'text');
    return String(replayedBody ?? '');
  }

  let body = String(dataRequest.responseBody || '');
  if (providerConfig.metadata.preprocessRegex) {
    const pre = new RegExp(providerConfig.metadata.preprocessRegex);
    const match = body.match(pre);
    if (match?.[1]) {
      body = match[1];
    }
  }
  return body;
}
