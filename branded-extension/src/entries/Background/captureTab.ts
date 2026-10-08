import { safeChromeTabsSendMessage } from '@utils/extensionMessaging';
import { logger } from '@utils/logger';
import { BackgroundToContentAction } from '@utils/types';

import { injectSpinner, removeAuthOverlay, showAuthSuccessAndWait } from './authTabOverlay';

// Only tabs owned by an in-flight capture may request foreground interaction.
const backgroundCaptureTabs = new Set<number>();

export async function createCaptureTab(
  originalTabId: number,
  focusOnOpen = true,
): Promise<number> {
  const { windowId } = await chrome.tabs.get(originalTabId);
  const tab = await chrome.tabs.create({ active: focusOnOpen, url: 'about:blank', windowId });
  if (tab.id === undefined) throw new Error('Unable to open provider authentication tab.');
  if (!focusOnOpen) backgroundCaptureTabs.add(tab.id);
  return tab.id;
}

export function stopCaptureLoginDetection(tabId: number): void {
  if (!backgroundCaptureTabs.delete(tabId)) return;
  void safeChromeTabsSendMessage(tabId, {
    action: BackgroundToContentAction.WATCH_CAPTURE_LOGIN,
    data: { enabled: false },
  });
}

export async function focusCaptureTab(tabId: number): Promise<void> {
  if (!backgroundCaptureTabs.has(tabId)) return;
  stopCaptureLoginDetection(tabId);
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch (error) {
    logger.warn('[Background] Could not focus the capture tab:', error);
  }
}

export function handleCaptureLoginTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): void {
  if (!backgroundCaptureTabs.has(tabId) || !tab.url) return;
  if (changeInfo.status !== 'complete') return;
  const url = new URL(tab.url);
  // Match route segments, never query strings (e.g. a return-to-login URL).
  if (/(?:^|\/)(?:log-?in|sign-?in)(?:\/|$)/i.test(url.pathname)) {
    void focusCaptureTab(tabId);
  } else {
    void safeChromeTabsSendMessage(tabId, {
      action: BackgroundToContentAction.WATCH_CAPTURE_LOGIN,
      data: { enabled: true },
    });
  }
}

export async function finishCaptureTab(
  authTabId: number,
  originalTabId: number,
  preserveTab: boolean,
): Promise<void> {
  stopCaptureLoginDetection(authTabId);
  try {
    if ((await chrome.tabs.get(authTabId)).active) {
      await injectSpinner(authTabId);
      await showAuthSuccessAndWait(authTabId);
      // The user may have switched away during the countdown. Do not steal focus.
      if ((await chrome.tabs.get(authTabId)).active) {
        await chrome.tabs.update(originalTabId, { active: true });
      }
    } else {
      await removeAuthOverlay(authTabId);
    }
  } catch (error) {
    logger.warn('[Background] Could not finish the capture tab:', error);
  }
  // A closed source tab must not prevent disposal of the provider tab.
  if (!preserveTab) {
    try {
      await chrome.tabs.remove(authTabId);
    } catch (error) {
      logger.warn('[Background] Could not close the capture tab:', error);
    }
  }
}
