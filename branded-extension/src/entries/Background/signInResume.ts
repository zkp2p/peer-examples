// An emailed sign-in link can finish a provider's OAuth sign-in in a tab the extension did
// not open. Correlate only the OAuth state seen in a capture tab's own
// authorization request, then reload that capture tab once the callback tab has
// moved on from the callback. Never intercept the callback tab or keep its code.
type SignIn = {
  /** The session's declared provider origins: the callback must land on one. */
  origins: readonly string[];
  incognito: boolean;
  resume: () => void;
  authorization: { origin: string; state: string; callback: URL } | null;
  callbackTabId: number | null;
};

const signIns = new Map<number, SignIn>();

export function watchSignIn(
  tabId: number,
  watch: Pick<SignIn, 'incognito' | 'origins' | 'resume'>,
): void {
  signIns.set(tabId, { ...watch, authorization: null, callbackTabId: null });
}

export function stopSignIn(tabId: number): void {
  signIns.delete(tabId);
  for (const signIn of signIns.values()) {
    if (signIn.callbackTabId === tabId) signIn.callbackTabId = null;
  }
}

function single(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length === 1 && values[0] ? values[0] : null;
}

function isCallback(url: URL, callback: URL): boolean {
  return url.origin === callback.origin && url.pathname === callback.pathname;
}

function authorization(url: URL, origins: readonly string[]): SignIn['authorization'] {
  const state = single(url, 'state');
  const redirect = single(url, 'redirect_uri');
  if (!state || !redirect || single(url, 'response_type') !== 'code') return null;
  let callback: URL;
  try {
    callback = new URL(redirect);
  } catch {
    return null;
  }
  if (callback.protocol !== 'https:' || !origins.includes(callback.origin)) return null;
  return { origin: url.origin, state, callback };
}

export function observeSignInNavigation(details: chrome.webRequest.WebRequestBodyDetails): void {
  const { documentLifecycle } = details as { documentLifecycle?: string };
  if (
    details.type !== 'main_frame' ||
    details.frameId !== 0 ||
    details.tabId < 0 ||
    documentLifecycle === 'prerender'
  )
    return;
  const url = new URL(details.url);
  const watched = signIns.get(details.tabId);
  if (watched) {
    if (url.searchParams.has('response_type') || url.searchParams.has('redirect_uri')) {
      // A new sign-in attempt replaces the previous one; a malformed one cancels it.
      watched.authorization = authorization(url, watched.origins);
      watched.callbackTabId = null;
    } else if (
      watched.authorization &&
      url.origin !== watched.authorization.origin &&
      !watched.origins.includes(url.origin)
    ) {
      watched.authorization = null;
      watched.callbackTabId = null;
    }
    return;
  }
  // A reused email tab belongs only to its latest callback and that callback's
  // continuation on the same origin.
  for (const signIn of signIns.values()) {
    const callback = signIn.authorization?.callback;
    if (
      signIn.callbackTabId === details.tabId &&
      (!callback || url.origin !== callback.origin || isCallback(url, callback))
    ) {
      signIn.callbackTabId = null;
    }
  }
  const state = single(url, 'state');
  if (!state || !url.searchParams.has('code')) return;
  const matches = [...signIns.values()].filter(
    (signIn) =>
      signIn.authorization?.state === state && isCallback(url, signIn.authorization.callback),
  );
  // An ambiguous or replayed callback must not resume a different capture.
  if (matches.length === 1 && matches[0].callbackTabId === null) {
    matches[0].callbackTabId = details.tabId;
  }
}

/** Resumes the capture whose sign-in this tab just completed. */
export function handleSignInTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): void {
  if (!changeInfo.url) return;
  for (const signIn of signIns.values()) {
    if (signIn.callbackTabId !== tabId || !signIn.authorization) continue;
    const { callback, state } = signIn.authorization;
    const url = new URL(changeInfo.url);
    if (signIn.incognito !== tab.incognito || url.origin !== callback.origin) {
      signIn.callbackTabId = null;
      return;
    }
    // Providers store the session before moving off the callback. That is often a
    // same-document navigation, so waiting for a main-frame request misses it.
    if (isCallback(url, callback)) {
      if (single(url, 'state') !== state || !url.searchParams.has('code')) {
        signIn.callbackTabId = null;
      }
      return;
    }
    // A failed token exchange also moves on. Consume this attempt, but keep
    // watching for a new sign-in until the capture is cleaned up.
    signIn.authorization = null;
    signIn.callbackTabId = null;
    signIn.resume();
    return;
  }
}
