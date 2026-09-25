import type { RequestLog } from '@entries/Background/requestLog';
import { logger } from '@utils/logger';

type ReplayInPageResult = {
  error?: string;
  ok: boolean;
  status: number;
  text?: string;
};

type ReplayInPageRequest = {
  formData?: Record<string, string[]> | null;
  method: string;
  requestBody?:
    | string
    | {
        raw?: Array<{
          bytes?: number[];
        }>;
      };
  requestHeaders?: Array<{
    name?: string;
    value?: string;
  }>;
  url: string;
};

type ActiveInPageReplay = {
  request: ReplayInPageRequest;
  requestId?: string;
};

type InPageReplayCandidate = {
  formData?: Record<string, string[]> | null;
  method: string;
  requestBody?: string;
  requestId: string;
  tabId: number;
  url: string;
};

const activeInPageReplaysByTabId = new Map<number, ActiveInPageReplay[]>();

function formDataBody(formData?: Record<string, string[]> | null): string | undefined {
  if (!formData) {
    return undefined;
  }

  const params = new URLSearchParams();
  Object.entries(formData).forEach(([key, values]) => {
    values.forEach((value) => params.append(key, value));
  });
  return params.toString();
}

function requestBody(request: {
  formData?: Record<string, string[]> | null;
  requestBody?: ReplayInPageRequest['requestBody'];
}): string | undefined {
  if (typeof request.requestBody === 'string') {
    return request.requestBody;
  }
  return formDataBody(request.formData);
}

export function claimInPageReplayRequest(candidate: InPageReplayCandidate): boolean {
  const replay = activeInPageReplaysByTabId
    .get(candidate.tabId)
    ?.find(
      (activeReplay) =>
        activeReplay.requestId === undefined &&
        activeReplay.request.method === candidate.method &&
        activeReplay.request.url === candidate.url &&
        requestBody(activeReplay.request) === requestBody(candidate),
    );
  if (!replay) {
    return false;
  }

  replay.requestId = candidate.requestId;
  return true;
}

export function isInPageReplayRequest(tabId: number, requestId: string): boolean {
  return (
    activeInPageReplaysByTabId
      .get(tabId)
      ?.some((activeReplay) => activeReplay.requestId === requestId) ?? false
  );
}

function startReplayRequestInPage(tabId: number, request: ReplayInPageRequest): ActiveInPageReplay {
  const replay = { request };
  const activeReplays = activeInPageReplaysByTabId.get(tabId) ?? [];
  activeReplays.push(replay);
  activeInPageReplaysByTabId.set(tabId, activeReplays);
  return replay;
}

function finishReplayRequestInPage(tabId: number, replay: ActiveInPageReplay): void {
  const activeReplays = activeInPageReplaysByTabId.get(tabId);
  if (!activeReplays) {
    throw new Error(`No active in-page replay exists for tab ${tabId}.`);
  }

  const remainingReplays = activeReplays.filter((activeReplay) => activeReplay !== replay);
  if (remainingReplays.length === 0) {
    activeInPageReplaysByTabId.delete(tabId);
  } else {
    activeInPageReplaysByTabId.set(tabId, remainingReplays);
  }
}

export type ReplayResult = { status: number; text: string };

export type ReplayOriginScope = {
  pageOrigin: string;
  requestOrigin: string;
};

/** Replays a captured request from the extension with the provider's cookies. */
export async function replayRequest(
  req: RequestLog,
  redirect: 'follow' | 'error' = 'follow',
): Promise<ReplayResult> {
  const headers = req.requestHeaders.reduce<Record<string, string>>((acc, header) => {
    if (header.name !== undefined && header.value !== undefined) {
      acc[header.name] = header.value;
    }
    return acc;
  }, {});

  const options: RequestInit = {
    method: req.method,
    credentials: 'include',
    headers,
    body: req.requestBody,
    redirect,
  };

  if (req?.formData) {
    const formData = new URLSearchParams();
    Object.entries(req.formData).forEach(([key, values]) => {
      if (!Array.isArray(values)) return;
      values.forEach((value: string) => formData.append(key, value));
    });
    options.body = formData.toString();
  }

  try {
    const resp = await fetch(req.url, options);
    const contentType = resp?.headers.get('content-type') || resp?.headers.get('Content-Type');

    const text = await (contentType?.includes('image')
      ? resp.blob().then((blob) => blob.text())
      : resp.text());

    return { status: resp.status, text };
  } catch (error) {
    logger.error('Error replaying request:', error);
    if (redirect === 'error') {
      throw new Error('Provider replay failed. Re-authenticate and try again.');
    }
    return { status: 500, text: '' };
  }
}

export async function replayRequestInPage(
  tabId: number,
  log: RequestLog,
  originScope: ReplayOriginScope | null = null,
): Promise<ReplayInPageResult> {
  if (!tabId) {
    return { ok: false, status: 0, error: 'Invalid tab ID' };
  }

  const replay = startReplayRequestInPage(tabId, log);
  try {
    logger.log('[replayRequestInPage] Replaying request in page', log.url);

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      args: [log as ReplayInPageRequest, originScope],
      func: function inject(
        req: ReplayInPageRequest,
        scope: ReplayOriginScope | null,
      ): Promise<ReplayInPageResult> {
        if (
          scope &&
          (location.origin !== scope.pageOrigin || new URL(req.url).origin !== scope.requestOrigin)
        ) {
          return Promise.resolve({
            ok: false,
            status: 0,
            error: 'Provider replay origin changed.',
          });
        }
        const forbidden = [
          'host',
          'cookie',
          'content-length',
          'user-agent',
          'origin',
          'referer',
          'connection',
          'accept-encoding',
          'sec-fetch-site',
          'sec-fetch-mode',
          'sec-fetch-user',
          'sec-fetch-dest',
        ];
        const hdrs = new Headers();
        (req.requestHeaders || []).forEach((h) => {
          if (h && h.name && h.value && !forbidden.includes(h.name.toLowerCase())) {
            hdrs.append(h.name, h.value);
          }
        });

        let body: BodyInit | undefined;
        if (req.formData) {
          const p = new URLSearchParams();
          Object.entries(req.formData).forEach(([k, arr]) => arr.forEach((v) => p.append(k, v)));
          body = p;
        } else if (typeof req.requestBody === 'string') {
          body = req.requestBody;
        } else if (
          req.requestBody &&
          req.requestBody.raw &&
          req.requestBody.raw[0] &&
          req.requestBody.raw[0].bytes
        ) {
          body = Uint8Array.from(req.requestBody.raw[0].bytes).buffer;
        }

        const options: RequestInit = {
          method: req.method,
          headers: hdrs,
          credentials: 'include',
          redirect: scope ? 'error' : 'follow',
        };
        if (req.method !== 'GET' && req.method !== 'HEAD' && typeof body !== 'undefined') {
          options.body = body;
        }

        return fetch(req.url, options)
          .then((r) => r.text().then((t) => ({ ok: true, status: r.status, text: t })))
          .catch((e) => ({ ok: false, status: 0, error: String(e) }));
      },
    });
    const result = results[0]?.result as ReplayInPageResult | undefined;

    logger.log('[replayRequestInPage] Result', result);

    return result ?? { ok: false, status: 0, error: 'script-injection failed' };
  } catch (e: unknown) {
    logger.error('[replayRequestInPage] Error:', e);
    return { ok: false, status: 0, error: String(e) };
  } finally {
    finishReplayRequestInPage(tabId, replay);
  }
}
