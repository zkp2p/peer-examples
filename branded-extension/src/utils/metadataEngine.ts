import type { RequestLog } from '@entries/Background/requestLog';
import type { MetadataMessageType, ProviderSettings } from '@utils/types';
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
  includeBuyerTeeParams: boolean,
): MetadataMessageType[] {
  const responseInput = payload.bodyJson !== undefined ? payload.bodyJson : payload.bodyStr;
  const metadata = extractTransactions(responseInput, cfg);
  if (!includeBuyerTeeParams) {
    return metadata;
  }

  return attachBuyerTeeParams(metadata, payload, cfg);
}

export function attachBuyerTeeParams(
  metadata: MetadataMessageType[],
  payload: ExtractionPayload,
  cfg: ProviderSettings,
): MetadataMessageType[] {
  const responseBody =
    payload.bodyJson === undefined ? payload.bodyStr : JSON.stringify(payload.bodyJson);
  const publicParams = cfg.paramNames.flatMap((paramName, index) => {
    const name = paramName.trim();
    const selector = cfg.paramSelectors[index];
    return name && selector?.source !== 'requestBody' ? [{ name, selector }] : [];
  });

  return metadata.map((row, fallbackIndex) => {
    const originalIndex = Number.isInteger(row.originalIndex) ? row.originalIndex : fallbackIndex;
    const params = Object.fromEntries(
      publicParams.flatMap(({ name, selector }) => {
        const value = extractValue(selector, payload.request, responseBody, originalIndex).trim();
        return value ? [[name, value]] : [];
      }),
    );
    return { ...row, params };
  });
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
