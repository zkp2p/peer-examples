import type { CaptureQuery } from '@utils/captureQuery';

// Runs in the isolated world of the extension-owned provider tab. The browser
// supplies cookies; neither capture JS nor the requesting site receives them.
export async function executeCaptureQuery(
  query: CaptureQuery['query'],
  expectedUrl: string,
): Promise<{ success: boolean; error?: string }> {
  if (
    `${location.origin}${location.pathname}` !== expectedUrl ||
    new URL(query.url).origin !== location.origin
  ) {
    throw new Error('Provider page changed before the query ran.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(query.url, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: { ...query.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(query.body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Provider history query failed.');
    return { success: true };
  } catch {
    return { success: false, error: 'Could not load provider history. Reconnect to try again.' };
  } finally {
    clearTimeout(timeout);
  }
}
