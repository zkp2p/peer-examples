import type { CapturePluginPageCapture } from '@utils/types/captureProgram';

export type PageCaptureHook = CapturePluginPageCapture & {
  cancelEvent: string;
  /** Upper bound for the request body, the response body and each storage value. */
  maxBytes: number;
};

export type PageCaptureResult =
  | {
      captured: true;
      requestBody: string | null;
      responseBody: string;
      responseStatus: number;
      session: Record<string, string>;
    }
  | { captured: false; error?: string };

// Serialized into the provider page's MAIN world once it has loaded. It keeps
// its wrapper outermost, above any fetch wrapper that encrypts the page's API
// traffic (pages may replace fetch again, e.g. after an SPA login), so it sees
// the plaintext the page itself sends and receives. It observes one same-origin
// request and never sends or replays one. The requesting Peer page selects no
// URL, script or storage key.
export function observePageRequest({
  cancelEvent,
  maxBytes,
  request: { method, url: target },
  session: sessionFields,
}: PageCaptureHook): Promise<PageCaptureResult> {
  return new Promise((resolve) => {
    let installedFetch: typeof fetch | undefined;
    let previousFetch: typeof fetch | undefined;
    let settled = false;
    let capturing = false;
    const finish = (result: PageCaptureResult) => {
      if (settled) return;
      settled = true;
      clearInterval(interval);
      clearTimeout(timeout);
      window.removeEventListener(cancelEvent, cancel);
      window.removeEventListener('pagehide', cancel);
      if (previousFetch && window.fetch === installedFetch) window.fetch = previousFetch;
      resolve(result);
    };
    const cancel = () => finish({ captured: false });

    function install(): void {
      if (settled || window.fetch === installedFetch) return;
      const upstream = window.fetch;
      previousFetch = upstream;
      installedFetch = async (...args: Parameters<typeof fetch>): Promise<Response> => {
        const [input, init] = args;
        // Snapshot the request before an inner wrapper can rewrite it.
        let url: URL | null = null;
        try {
          url = new URL(
            typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
            location.href,
          );
        } catch {
          /* Not a URL this hook observes; the page's own fetch reports it. */
        }
        const requestMethod = (
          init?.method ?? (input instanceof Request ? input.method : 'GET')
        ).toUpperCase();
        const body = input instanceof Request ? input.body : init?.body;
        // Storage belongs to this document, so only its own origin's request qualifies.
        const observed =
          url?.origin === location.origin && url.href === target && requestMethod === method;
        const response = await upstream.apply(window, args);
        if (observed && !settled && !capturing && response.ok) {
          capturing = true;
          // Observe a clone without holding up the page's own rendering.
          void captureExchange(body, response);
        }
        return response;
      };
      window.fetch = installedFetch;
    }

    async function captureExchange(
      body: BodyInit | null | undefined,
      response: Response,
    ): Promise<void> {
      try {
        if (body != null && (typeof body !== 'string' || body.length > maxBytes)) throw new Error();
        const reader = response.clone().body?.getReader();
        if (!reader) throw new Error();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let raw = '';
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (settled) throw new Error();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw new Error();
            raw += decoder.decode(value, { stream: true });
          }
          raw += decoder.decode();
        } finally {
          void reader.cancel().catch(() => undefined);
        }
        const session: Record<string, string> = {};
        for (const [name, { encoding, storage }] of Object.entries(sessionFields)) {
          const [key, property] = storage.split('.');
          const stored = localStorage.getItem(key);
          if (stored === null || stored.length > maxBytes) throw new Error();
          let value: unknown = stored;
          if (property !== undefined) {
            const entry: unknown = JSON.parse(stored);
            if (typeof entry !== 'object' || entry === null || !Object.hasOwn(entry, property))
              throw new Error();
            value = (entry as Record<string, unknown>)[property];
          }
          if (encoding === 'p256RawPublicKey') {
            const jwk = typeof value === 'string' ? JSON.parse(value) : value;
            const publicKey = await crypto.subtle.importKey(
              'jwk',
              jwk,
              { name: 'ECDH', namedCurve: 'P-256' },
              true,
              [],
            );
            const point = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey));
            session[name] = btoa(String.fromCharCode(...point))
              .replace(/\+/g, '-')
              .replace(/\//g, '_')
              .replace(/=+$/, '');
          } else {
            session[name] = typeof value === 'string' ? value : JSON.stringify(value);
          }
        }
        finish({
          captured: true,
          requestBody: body ?? null,
          responseBody: raw,
          responseStatus: response.status,
          session,
        });
      } catch {
        finish({
          captured: false,
          error: 'Could not read the provider response. Reconnect and try again.',
        });
      }
    }

    const interval = setInterval(install, 250);
    const timeout = setTimeout(
      () => finish({ captured: false, error: 'Capture expired. Start a new capture.' }),
      15 * 60_000,
    );
    window.addEventListener(cancelEvent, cancel, { once: true });
    window.addEventListener('pagehide', cancel, { once: true });
    install();
  });
}

export function cancelPageRequestObserver(cancelEvent: string): void {
  window.dispatchEvent(new Event(cancelEvent));
}
