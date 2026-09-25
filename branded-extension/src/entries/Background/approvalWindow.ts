import {
  ApprovalToBackgroundAction,
  type ApprovalPrompt,
  type ApprovalRequestResponse,
  type ApprovalToBackgroundMessageType,
} from '@utils/types';
import { logger } from '@utils/logger';

const APPROVAL_PAGE = 'approval.html';
const APPROVAL_TIMEOUT_MS = 2 * 60 * 1000;
const APPROVAL_WINDOW_WIDTH = 420;
const APPROVAL_WINDOW_HEIGHT = 620;
// Detail prompts carry security-relevant permission data. Give the content
// pane enough room to be useful while keeping the action footer pinned; long
// values scroll inside the pane. Chrome spends ~90px on its own title bar.
const DETAILED_APPROVAL_WINDOW_HEIGHT = 760;

type PendingApproval = {
  expectedUrl: string;
  prompt: ApprovalPrompt;
  resolve: (approved: boolean) => void;
  tabId?: number;
  timeoutId: ReturnType<typeof setTimeout>;
  windowId?: number;
};

const pendingApprovals = new Map<string, PendingApproval>();

function closeWindow(windowId: number | undefined): void {
  if (windowId === undefined) return;

  void chrome.windows.remove(windowId).catch((error) => {
    logger.warn(`[Background] Failed to close approval window ${windowId}`, error);
  });
}

function settleApproval(requestId: string, approved: boolean, shouldClose: boolean): void {
  const pending = pendingApprovals.get(requestId);
  if (!pending) return;

  pendingApprovals.delete(requestId);
  clearTimeout(pending.timeoutId);
  pending.resolve(approved);

  if (shouldClose) {
    closeWindow(pending.windowId);
  }
}

function matchesApprovalSender(
  requestId: string,
  sender: chrome.runtime.MessageSender,
): PendingApproval | undefined {
  const pending = pendingApprovals.get(requestId);
  if (
    !pending ||
    sender.id !== chrome.runtime.id ||
    sender.url !== pending.expectedUrl ||
    sender.tab?.id === undefined ||
    sender.tab.windowId === undefined
  ) {
    return undefined;
  }

  if (pending.tabId !== undefined && sender.tab.id !== pending.tabId) {
    return undefined;
  }
  if (pending.windowId !== undefined && sender.tab.windowId !== pending.windowId) {
    return undefined;
  }

  pending.tabId ??= sender.tab.id;
  pending.windowId ??= sender.tab.windowId;
  return pending;
}

/**
 * Anchor the approval window to the top right of the active browser window,
 * under the toolbar icon, the way MetaMask positions its notification popup.
 * Falls back to the browser's default placement when the bounds are unknown.
 */
async function resolveTopRightBounds(): Promise<{ left: number; top: number } | undefined> {
  try {
    const { left, top, width } = await chrome.windows.getLastFocused();
    if (left === undefined || top === undefined || width === undefined) return undefined;

    return {
      left: Math.max(left + width - APPROVAL_WINDOW_WIDTH, 0),
      top: Math.max(top, 0),
    };
  } catch (error) {
    logger.warn('[Background] Failed to resolve approval window position', error);
    return undefined;
  }
}

export function requestExtensionApproval(prompt: ApprovalPrompt): Promise<boolean> {
  const requestId = crypto.randomUUID();
  const expectedUrl = chrome.runtime.getURL(`${APPROVAL_PAGE}?request=${requestId}`);

  return new Promise<boolean>((resolve) => {
    const timeoutId = setTimeout(() => {
      settleApproval(requestId, false, true);
    }, APPROVAL_TIMEOUT_MS);

    pendingApprovals.set(requestId, {
      expectedUrl,
      prompt,
      resolve,
      timeoutId,
    });

    void resolveTopRightBounds()
      .then((bounds) =>
        chrome.windows.create({
          ...bounds,
          focused: true,
          height:
            prompt.pluginTrust === 'unverified' ||
            (prompt.details?.length && !prompt.detailsCollapsed)
              ? DETAILED_APPROVAL_WINDOW_HEIGHT
              : APPROVAL_WINDOW_HEIGHT,
          type: 'popup',
          url: expectedUrl,
          width: APPROVAL_WINDOW_WIDTH,
        }),
      )
      .then((approvalWindow) => {
        const pending = pendingApprovals.get(requestId);
        const tabId = approvalWindow.tabs?.[0]?.id;

        // The approval page can register itself before create() resolves, so
        // any mismatch here means this is not the window we are waiting on.
        const matchesPending =
          pending !== undefined &&
          (pending.windowId === undefined || pending.windowId === approvalWindow.id) &&
          (pending.tabId === undefined || pending.tabId === tabId);

        if (!matchesPending || approvalWindow.id === undefined || tabId === undefined) {
          const strayWindowId =
            approvalWindow.id === pending?.windowId ? undefined : approvalWindow.id;
          settleApproval(requestId, false, true);
          closeWindow(strayWindowId);
          return;
        }

        pending.windowId = approvalWindow.id;
        pending.tabId = tabId;
      })
      .catch((error) => {
        logger.error('[Background] Failed to open extension approval window', error);
        settleApproval(requestId, false, false);
      });
  });
}

export function handleApprovalRuntimeMessage(
  message: ApprovalToBackgroundMessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
): boolean {
  const pending = matchesApprovalSender(message.requestId, sender);
  if (!pending) {
    sendResponse();
    return false;
  }

  if (message.action === ApprovalToBackgroundAction.GET_APPROVAL_REQUEST) {
    const response: ApprovalRequestResponse = {
      request: {
        ...pending.prompt,
        requestId: message.requestId,
      },
    };
    sendResponse(response);
    return false;
  }

  const approved =
    message.approved === true &&
    (pending.prompt.pluginTrust !== 'unverified' || message.riskAcknowledged === true);
  settleApproval(message.requestId, approved, true);
  sendResponse();
  return false;
}

export function handleApprovalWindowRemoved(windowId: number): void {
  for (const [requestId, pending] of pendingApprovals) {
    if (pending.windowId === windowId) {
      settleApproval(requestId, false, false);
    }
  }
}

export function handleApprovalTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
): void {
  if (!changeInfo.url) return;

  for (const [requestId, pending] of pendingApprovals) {
    if (pending.tabId === tabId && changeInfo.url !== pending.expectedUrl) {
      settleApproval(requestId, false, true);
    }
  }
}
