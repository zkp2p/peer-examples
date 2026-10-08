import {
  cancelPageRequestObserver,
  observePageRequest,
  type PageCaptureResult,
} from './pageCaptureHook';
import { MAX_NETWORK_BODY_BYTES, type CapturePluginPageCapture } from '@utils/types/captureProgram';

type PageCaptureWatch = {
  /** The armed document's hook; null while no document observes the request. */
  cancelEvent: string | null;
  onResult: (result: PageCaptureResult) => Promise<void>;
  pageCapture: CapturePluginPageCapture;
};

const watches = new Map<number, PageCaptureWatch>();

function cancelInPage(tabId: number, cancelEvent: string): void {
  void chrome.scripting
    .executeScript({
      target: { tabId },
      world: 'MAIN',
      func: cancelPageRequestObserver,
      args: [cancelEvent],
    })
    .catch(() => {
      /* A navigated or closed document has already discarded the hook. */
    });
}

async function arm(tabId: number, watch: PageCaptureWatch): Promise<void> {
  if (watch.cancelEvent) return;
  const cancelEvent = `peer-page-capture-${crypto.randomUUID()}`;
  watch.cancelEvent = cancelEvent;
  let result: PageCaptureResult | undefined;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: observePageRequest,
      args: [{ ...watch.pageCapture, cancelEvent, maxBytes: MAX_NETWORK_BODY_BYTES }],
    });
    result = injection?.result;
  } catch {
    // This document cannot host the hook: an error page, or it went away.
  }
  if (watches.get(tabId) !== watch || watch.cancelEvent !== cancelEvent) return;
  watch.cancelEvent = null;
  // Without a result, wait for the next loaded document.
  if (!result) return;
  await watch.onResult(result);
  // The owner ended the capture or kept waiting; a loaded document waits again.
  if (watches.get(tabId) !== watch) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.status === 'complete') void arm(tabId, watch);
}

/**
 * Observe `pageCapture` in each loaded top-level document of the capture tab
 * until stopped. Every result goes to `onResult`; the owner stops the watch.
 */
export function watchPageCapture(
  tabId: number,
  pageCapture: CapturePluginPageCapture,
  onResult: (result: PageCaptureResult) => Promise<void>,
): void {
  watches.set(tabId, { cancelEvent: null, onResult, pageCapture });
}

export function stopPageCapture(tabId: number): void {
  const watch = watches.get(tabId);
  watches.delete(tabId);
  if (watch?.cancelEvent) cancelInPage(tabId, watch.cancelEvent);
}

export function handlePageCaptureTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): void {
  const watch = watches.get(tabId);
  if (!watch) return;
  if (changeInfo.status === 'loading' && watch.cancelEvent) {
    // A reload discards the old document's hook. Invalidate its completion
    // before arming the next loaded document.
    cancelInPage(tabId, watch.cancelEvent);
    watch.cancelEvent = null;
  }
  // Arm only a loaded document, after the page has installed its own wrappers.
  if (tab.status === 'complete' && (changeInfo.status === 'complete' || changeInfo.url)) {
    void arm(tabId, watch);
  }
}
