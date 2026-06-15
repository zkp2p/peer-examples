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

export async function replayRequest(
  req: RequestLog,
): Promise<{ response: Response; text: string }> {
  const headers = req.requestHeaders.reduce<Record<string, string>>((acc, header) => {
    if (header.name !== undefined && header.value !== undefined) {
      acc[header.name] = header.value;
    }
    return acc;
  }, {});

  const options: RequestInit = {
    method: req.method,
    headers,
    body: req.requestBody,
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

    return { response: resp, text };
  } catch (error) {
    logger.error('Error replaying request:', error);
    return {
      response: new Response(null, {
        status: 500,
        statusText: 'Request failed',
        headers: new Headers(),
      }),
      text: '',
    };
  }
}

export async function replayRequestInPage(
  tabId: number,
  log: RequestLog,
): Promise<ReplayInPageResult> {
  try {
    if (!tabId) {
      return { ok: false, status: 0, error: 'Invalid tab ID' };
    }

    const actualUrl = new URL(log.url);
    actualUrl.searchParams.append('replay_request', '1');

    logger.log('[replayRequestInPage] Replaying request in page', actualUrl.toString());

    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      args: [{ ...log, url: actualUrl.toString() } as ReplayInPageRequest],
      func: function inject(req: ReplayInPageRequest): Promise<ReplayInPageResult> {
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
          redirect: 'follow',
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
  }
}
