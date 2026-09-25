import {
  BackgroundToContentAction,
  type BackgroundToContentMessageType,
  ContentToBackgroundAction,
  ContentToPageAction,
  type ContentToPageMessageType,
  PageToContentAction,
  type PageToContentMessageType,
} from '@utils/types/messages';
import { getManifestVersion } from '@utils/getManifestVersion';
import { BRAND } from '@config/brand';
import { logger } from '@utils/logger';
import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import {
  isConnectedToHost,
  requiresConnectionApproval,
  type PeerConnectionStatus,
} from './connectionApproval';
import { executeCapturePageAction } from './capturePageActions';
import { watchCaptureLogin } from './captureLogin';

const injectPeerAPI = () => {
  if (document.documentElement.getAttribute('data-peer-injected') === 'true') {
    return;
  }

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('injectScript.bundle.js');
  script.onload = function () {
    script.remove();
  };
  (document.head || document.documentElement).appendChild(script);

  document.documentElement.setAttribute('data-peer-injected', 'true');
};

const postToPage = (message: ContentToPageMessageType) => {
  try {
    window.postMessage(message, '*');
  } catch (error) {
    logger.error('[Content] window.postMessage failed', error);
  }
};

let connectionStatus: PeerConnectionStatus = 'pending';
let connectionApprovalPromise: Promise<boolean> | null = null;

const connectionStatusPromise = safeChromeRuntimeSendMessage<{ connected?: boolean }>({
  action: ContentToBackgroundAction.CHECK_CONNECTION_BACKGROUND,
}).then((response) => {
  connectionStatus = response?.connected === true ? 'connected' : 'disconnected';
});

function isConnectedToPage(): boolean {
  return isConnectedToHost(connectionStatus, window.location.hostname);
}

async function requestPageConnectionApproval(): Promise<boolean> {
  await connectionStatusPromise;
  if (!requiresConnectionApproval(connectionStatus, window.location.hostname)) {
    return true;
  }
  if (connectionApprovalPromise) return connectionApprovalPromise;

  connectionStatus = 'pending';
  connectionApprovalPromise = (async () => {
    const response = await safeChromeRuntimeSendMessage<{ approved?: boolean }>({
      action: ContentToBackgroundAction.REQUEST_APPROVAL_BACKGROUND,
      data: { kind: 'connection' },
    });
    const approved = response?.approved === true;
    connectionStatus = approved ? 'connected' : 'disconnected';
    return approved;
  })().finally(() => {
    connectionApprovalPromise = null;
  });

  return connectionApprovalPromise;
}

function postMetadataError(
  platform: string,
  errorMessage: string,
  requestId = '',
  captureAttemptId?: string,
): void {
  postToPage({
    type: ContentToPageAction.METADATA_MESSAGES_RESPONSE,
    status: 'loaded',
    requestId,
    platform,
    metadata: [],
    expiresAt: Date.now(),
    ...(captureAttemptId ? { captureAttemptId } : {}),
    errorMessage,
  });
}

type OpenNewTabBackgroundResponse = {
  error?: string;
  success?: boolean;
};

function buildPageMetadataMessage(
  data: BackgroundToContentMessageType & {
    action: typeof BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE;
  },
): ContentToPageMessageType {
  return {
    type: ContentToPageAction.METADATA_MESSAGES_RESPONSE,
    status: 'loaded',
    ...data.data,
  };
}

async function handlePageMessage(event: MessageEvent<PageToContentMessageType>): Promise<void> {
  if (event.source !== window || event.origin !== window.location.origin) return;

  switch (event.data.type) {
    case PageToContentAction.REQUEST_PEER_CONNECTION: {
      const approved = await requestPageConnectionApproval();
      postToPage({
        type: ContentToPageAction.CONNECTION_APPROVAL_RESPONSE,
        approved,
        origin: window.location.origin,
      });
      break;
    }
    case PageToContentAction.CHECK_CONNECTION_STATUS: {
      await connectionStatusPromise;
      postToPage({
        type: ContentToPageAction.CONNECTION_STATUS_RESPONSE,
        origin: window.location.origin,
        status: isConnectedToPage() ? 'connected' : connectionStatus,
      });
      break;
    }
    case PageToContentAction.FETCH_EXTENSION_VERSION: {
      postToPage({
        type: ContentToPageAction.EXTENSION_VERSION_RESPONSE,
        status: 'loaded',
        version: getManifestVersion(),
      });
      break;
    }
    case PageToContentAction.OPEN_NEW_TAB: {
      if (
        event.data.capturePlugin === undefined &&
        !isConnectedToPage() &&
        !(await requestPageConnectionApproval())
      ) {
        postMetadataError(
          event.data.platform,
          `${BRAND.shortName} connection required.`,
          '',
          event.data.captureAttemptId,
        );
        break;
      }

      const response = await safeChromeRuntimeSendMessage<OpenNewTabBackgroundResponse>({
        action: ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND,
        data: event.data,
      });
      if (!response?.success) {
        postMetadataError(
          event.data.platform,
          response?.error ?? 'Unable to open provider authentication tab.',
          '',
          event.data.captureAttemptId,
        );
      }
      break;
    }
    default:
      break;
  }
}

window.addEventListener('message', (event: MessageEvent<PageToContentMessageType>) => {
  void handlePageMessage(event).catch((error) => {
    logger.error('[Content] Failed to handle page message', error);
  });
});

chrome.runtime.onMessage.addListener(
  (message: BackgroundToContentMessageType, _sender, sendResponse) => {
    if (message.action === BackgroundToContentAction.WATCH_CAPTURE_LOGIN) {
      watchCaptureLogin(message.data.enabled);
      return false;
    }
    if (message.action === BackgroundToContentAction.CONNECTION_REVOKED) {
      if (message.data.origin === window.location.origin) connectionStatus = 'disconnected';
      return false;
    }
    if (message.action === BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE) {
      postToPage(buildPageMetadataMessage(message));
      return false;
    }
    if (message.action === BackgroundToContentAction.EXECUTE_CAPTURE_PAGE_ACTION) {
      void executeCapturePageAction(message.data.action, message.data.expectedUrl).then(
        sendResponse,
      );
      return true;
    }
    return false;
  },
);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectPeerAPI);
} else {
  injectPeerAPI();
}
