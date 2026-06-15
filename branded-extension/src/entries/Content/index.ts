import { BRAND } from '@config/brand';
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
import { logger } from '@utils/logger';
import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import {
  isConnectedToHost,
  requiresConnectionApproval,
  type PeerConnectionStatus,
} from './connectionApproval';
import { requestContentApproval } from './approvalPopup';

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

let connectionStatus: PeerConnectionStatus = 'disconnected';

function isConnectedToPage(): boolean {
  return isConnectedToHost(connectionStatus, window.location.hostname);
}

async function requestPageConnectionApproval(): Promise<boolean> {
  const hostname = window.location.hostname;
  if (!requiresConnectionApproval(connectionStatus, hostname)) {
    connectionStatus = 'connected';
    return true;
  }

  connectionStatus = 'pending';
  const approved = await requestContentApproval({
    approveLabel: 'Connect',
    description: `This site wants to connect to ${BRAND.name} and request payment verification.`,
    hostname,
    origin: window.location.origin,
    permissions: [
      'Open payment platform tabs to capture a confirmation',
      'Request payment verification',
      'Receive verification results',
    ],
    rejectLabel: 'Reject',
    title: 'Connection Request',
  });
  connectionStatus = approved ? 'connected' : 'disconnected';
  return approved;
}

function postMetadataError(platform: string, errorMessage: string, requestId = ''): void {
  postToPage({
    type: ContentToPageAction.METADATA_MESSAGES_RESPONSE,
    status: 'loaded',
    requestId,
    platform,
    metadata: [],
    expiresAt: Date.now(),
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
  const { requiresMetadataApproval: _requiresMetadataApproval, ...payload } = data.data;
  return {
    type: ContentToPageAction.METADATA_MESSAGES_RESPONSE,
    status: 'loaded',
    ...payload,
  };
}

async function confirmMetadataShare(message: ContentToPageMessageType): Promise<boolean> {
  if (message.type !== ContentToPageAction.METADATA_MESSAGES_RESPONSE) {
    return true;
  }

  return requestContentApproval({
    approveLabel: 'Approve',
    description:
      'The page requested custom data to be returned. Review the following response before sharing with the page.',
    details: message.metadata,
    detailsLabel: 'Response',
    hostname: window.location.hostname,
    origin: window.location.origin,
    rejectLabel: 'Reject',
    title: 'Review Response',
    warning: 'Reject if this data is unexpected or the page should not receive it.',
  });
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
      if (!isConnectedToPage()) {
        postMetadataError(event.data.platform, `${BRAND.name} connection required.`);
        break;
      }

      const response = await safeChromeRuntimeSendMessage<OpenNewTabBackgroundResponse>({
        action: ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND,
        data: event.data,
      });
      if (!response?.success) {
        postMetadataError(
          event.data.platform,
          response?.error ?? 'Unable to open the verification tab.',
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

// Popup-only status probe (mirrored in src/entries/Popup/index.ts). Read-only:
// reports the in-memory connection status so the toolbar popup can list which
// sites are connected. Not part of the typed page<->content message channels.
const GET_CONNECTION_STATUS_ACTION = 'peer_get_connection_status';

chrome.runtime.onMessage.addListener(
  (message: { action?: string }, _sender, sendResponse: (response: unknown) => void) => {
    if (message?.action !== GET_CONNECTION_STATUS_ACTION) {
      return;
    }

    sendResponse({
      hostname: window.location.hostname,
      status: isConnectedToPage() ? 'connected' : connectionStatus,
    });
  },
);

chrome.runtime.onMessage.addListener((message: BackgroundToContentMessageType) => {
  if (message.action !== BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE) {
    return;
  }

  void (async () => {
    const pageMessage = buildPageMetadataMessage(message);
    if (message.data.requiresMetadataApproval && !(await confirmMetadataShare(pageMessage))) {
      postMetadataError(
        message.data.platform,
        'Sharing the verification result was rejected.',
        message.data.requestId,
      );
      return;
    }

    postToPage(pageMessage);
  })().catch((error) => {
    logger.error('[Content] Failed to review verification response', error);
    postMetadataError(
      message.data.platform,
      'Reviewing the verification result failed.',
      message.data.requestId,
    );
  });
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', injectPeerAPI);
} else {
  injectPeerAPI();
}
