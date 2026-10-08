import { MAX_NETWORK_BODY_BYTES } from './types/captureProgram';
import type { CaptureReplayTarget } from './types/captureProgram';
import { byteLength, isRecord } from './valueGuards';

/**
 * A `match()` result that treats the intercepted request as a context request
 * and asks the host to replay this target with its session instead. This is
 * the plugin equivalent of a Curator template's `metadataUrl` or fallback
 * request: the page may never issue the canonical metadata request itself.
 * Returns null when the value is not a target object; throws when it is one
 * but invalid. The host revalidates against both the plugin origins and the
 * captured request origin before attaching its credentials.
 */
export function captureReplayTarget(
  value: unknown,
  origins: readonly string[],
  requestUrl: string,
): CaptureReplayTarget | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).some((key) => !['url', 'method', 'body'].includes(key)) ||
    typeof value.url !== 'string' ||
    value.url.length > 2048 ||
    (value.method !== undefined && value.method !== 'GET' && value.method !== 'POST') ||
    (value.body !== undefined && value.body !== null && typeof value.body !== 'string')
  ) {
    throw new Error('Capture replay target is invalid.');
  }
  const method = value.method ?? 'GET';
  const body = typeof value.body === 'string' ? value.body : null;
  if (method === 'GET' && body !== null) {
    throw new Error('Capture replay target GET cannot carry a body.');
  }
  if (body !== null && byteLength(body) > MAX_NETWORK_BODY_BYTES) {
    throw new Error('Capture replay target body exceeds the limit.');
  }
  let url: URL;
  try {
    url = new URL(value.url);
  } catch {
    throw new Error('Capture replay target URL is invalid.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !origins.includes(url.origin)
  ) {
    throw new Error('Capture replay target must remain on a plugin origin.');
  }
  if (url.origin !== new URL(requestUrl).origin) {
    throw new Error('Capture replay target must remain on the captured request origin.');
  }
  return { body, method, url: url.href };
}

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Headers for a replayed target: the context request's session headers, plus
 * `application/json` when the target carries a JSON body the context never
 * declared (for example a GET overview request replaying an activity POST).
 */
export function replayTargetHeaders(
  requestHeaders: readonly chrome.webRequest.HttpHeader[],
  target: CaptureReplayTarget,
): chrome.webRequest.HttpHeader[] {
  if (
    target.body === null ||
    !isJson(target.body) ||
    requestHeaders.some((header) => header.name.toLowerCase() === 'content-type')
  ) {
    return [...requestHeaders];
  }
  return [...requestHeaders, { name: 'content-type', value: 'application/json' }];
}
