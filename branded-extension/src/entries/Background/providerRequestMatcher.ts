import type { ProviderSettings } from '@utils/types';

import type { RequestLog } from './requestLog';

function requestBodyText(request: RequestLog): string {
  if (request.requestBody !== undefined) {
    return request.requestBody;
  }

  return request.formData ? JSON.stringify(request.formData) : '';
}

function matchesRequestCriteria(
  request: RequestLog,
  method: string,
  urlRegex: string,
  bodyRegex?: string,
): boolean {
  if (!method || !urlRegex) {
    return false;
  }
  if (request.method !== method || !new RegExp(urlRegex).test(request.url)) {
    return false;
  }
  if (!bodyRegex) {
    return true;
  }

  const body = requestBodyText(request);
  return Boolean(body && new RegExp(bodyRegex).test(body));
}

export function isProviderContextRequest(
  request: RequestLog,
  providerConfig: ProviderSettings,
): boolean {
  const { metadata } = providerConfig;

  return (
    matchesRequestCriteria(request, metadata.method, metadata.urlRegex, metadata.bodyRegex) ||
    matchesRequestCriteria(
      request,
      metadata.fallbackMethod,
      metadata.fallbackUrlRegex,
      metadata.fallbackBodyRegex,
    )
  );
}
