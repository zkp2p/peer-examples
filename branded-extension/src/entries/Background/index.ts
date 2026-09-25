import { logger } from '@utils/logger';
import { safeChromeRuntimeSendMessage, safeChromeTabsSendMessage } from '@utils/extensionMessaging';
import { PROVIDER_TEMPLATE_API_ROOT } from '@utils/constants';
import { BRAND } from '@config/brand';
import {
  getExtensionManagerState,
  isConnectedSite,
  rememberConnectedSite,
  removeCapturePlugin,
  removeConnectedSite,
  restrictExtensionStorageAccess,
} from '@utils/extensionState';
import {
  ApprovalToBackgroundAction,
  BackgroundToContentAction,
  BackgroundToOffscreenAction,
  ContentToBackgroundAction,
  ManagerToBackgroundAction,
  OffscreenToBackgroundAction,
  type ApprovalToBackgroundMessageType,
  type ContentToBackgroundMessageType,
  type ExtractMetadataOffscreenResponse,
  type ManagerToBackgroundMessageType,
  type OffscreenToBackgroundMessageType,
  type OpenNewTabPagePayload,
  type ProviderSettings,
} from '@utils/types';
import type { MetadataMessagePayload } from '@utils/types/messages/contentToPage';
import { replayRequestInPage } from '@utils/misc';

import { deleteCacheByTabId, getRequestLogsByTabId } from './cache';
import {
  clearInterceptPatterns,
  clearShouldReplayRequestInPage,
  onBeforeRequest,
  onResponseStarted,
  onSendHeaders,
  setInterceptPatterns,
  setMetadataRequestCapturedHandler,
  setShouldReplayRequestInPage,
} from './handlers';
import { ensureOffscreenDocument } from './offscreenDocument';
import {
  clearBuyerTeeCapture,
  rememberBuyerTeeCapture,
  resolveBuyerTeeCaptureConfig,
  stageBuyerTeeCaptureForMetadata,
} from './buyerTeeFlow';
import {
  clearSarCredentialCapture,
  rememberSarCredentialCapture,
  resolveSarCredentialCaptureConfig,
  stageSarCredentialCaptureForMetadata,
} from './sarCredentialFlow';
import type { RequestLog } from './requestLog';
import { injectSpinner } from './authTabOverlay';
import {
  createCaptureTab,
  finishCaptureTab,
  focusCaptureTab,
  handleCaptureLoginTabUpdated,
  stopCaptureLoginDetection,
} from './captureTab';
import { isProviderContextRequest } from './providerRequestMatcher';
import { installContentScriptsInExistingTabs } from './installBackfill';
import { assertUsableProviderConfig, buildProviderPatternList } from './providerConfigValidation';
import {
  handleApprovalRuntimeMessage,
  handleApprovalTabUpdated,
  handleApprovalWindowRemoved,
  requestExtensionApproval,
} from './approvalWindow';
import {
  cancelPluginCaptureSessions,
  type CaptureRequestSource,
  handlePluginTabRemoved,
  handlePluginTabUpdated,
  openPluginCaptureSession,
} from './pluginCaptureSession';

type RuntimeMessage =
  | ApprovalToBackgroundMessageType
  | ContentToBackgroundMessageType
  | ManagerToBackgroundMessageType
  | OffscreenToBackgroundMessageType;
type SendResponse = (response?: unknown) => void;

type CaptureSession = {
  authTabId: number;
  originalTabId: number;
  originalDocumentId: string;
  originalFrameId: number;
  sourceOrigin: string;
  platform: string;
  captureAttemptId?: string;
  includeBuyerTeeParams: boolean;
  providerConfig: ProviderSettings;
  isExtracting: boolean;
  hasSentMetadata: boolean;
};

const sessionsByAuthTabId = new Map<number, CaptureSession>();

function buildProviderConfigUrl(data: OpenNewTabPagePayload): string {
  return `${PROVIDER_TEMPLATE_API_ROOT}${encodeURIComponent(data.platform)}/${encodeURIComponent(data.actionType)}.json`;
}

async function resolveProviderConfig(data: OpenNewTabPagePayload): Promise<ProviderSettings> {
  const configUrl = buildProviderConfigUrl(data);
  logger.log('[Background] Fetching provider template:', configUrl);
  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch provider template: ${response.status}`);
  }
  return (await response.json()) as ProviderSettings;
}

function resolveSourcePage(sender: chrome.runtime.MessageSender): CaptureRequestSource {
  const documentId = (sender as chrome.runtime.MessageSender & { documentId?: string }).documentId;
  if (sender.tab?.id === undefined || !documentId || sender.frameId === undefined) {
    throw new Error('Unable to bind metadata capture to the requesting document.');
  }

  const sourceUrl = sender.url ?? sender.tab.url;
  if (!sourceUrl) {
    throw new Error('Unable to resolve source page for metadata capture.');
  }

  const url = new URL(sourceUrl);
  const isAllowedSource =
    url.protocol === 'https:' ||
    (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  if (!isAllowedSource) {
    throw new Error('Metadata capture requests must come from a secure page.');
  }

  return {
    documentId,
    frameId: sender.frameId,
    hostname: url.hostname,
    origin: url.origin,
    tabId: sender.tab.id,
  };
}

function validateProviderIdentifier(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

async function handleConnectionApproval(
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): Promise<void> {
  try {
    const source = resolveSourcePage(sender);
    const approved = await requestExtensionApproval({
      approveLabel: 'Connect',
      description: 'Allow metadata capture.',
      hostname: source.hostname,
      origin: source.origin,
      permissions: ['Open provider tabs', 'Capture and return payment data'],
      rejectLabel: 'Reject',
      title: `Connect to ${BRAND.shortName}?`,
    });
    if (approved) await rememberConnectedSite(source.origin);
    sendResponse({ approved });
  } catch (error) {
    logger.error('[Background] Connection approval failed', error);
    sendResponse({ approved: false });
  }
}

async function handleConnectionStatus(
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): Promise<void> {
  try {
    const source = resolveSourcePage(sender);
    sendResponse({ connected: await isConnectedSite(source.origin) });
  } catch (error) {
    logger.error('[Background] Connection status check failed', error);
    sendResponse({ connected: false });
  }
}

function isManagerSender(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('manager.html');
}

async function notifyConnectionRevoked(origin: string): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined || !tab.url) return;
      try {
        if (new URL(tab.url).origin !== origin) return;
      } catch {
        return;
      }
      await safeChromeTabsSendMessage(tab.id, {
        action: BackgroundToContentAction.CONNECTION_REVOKED,
        data: { origin },
      });
    }),
  );
}

async function handleManagerMessage(
  message: ManagerToBackgroundMessageType,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): Promise<void> {
  if (!isManagerSender(sender)) {
    sendResponse({ error: 'Extension settings request rejected.', success: false });
    return;
  }
  try {
    if (message.action === ManagerToBackgroundAction.REMOVE_CAPTURE_PLUGIN) {
      const origin = new URL(message.data.sourceOrigin).origin;
      await removeCapturePlugin(message.data.id, origin);
      cancelPluginCaptureSessions(
        (session) => session.plugin.id === message.data.id && session.sourceOrigin === origin,
      );
    }
    if (message.action === ManagerToBackgroundAction.REMOVE_CONNECTED_SITE) {
      const origin = new URL(message.data.origin).origin;
      await removeConnectedSite(origin);
      for (const session of sessionsByAuthTabId.values()) {
        if (session.sourceOrigin !== origin) continue;
        notifyCaptureCancelled(session);
        cleanupSession(session.authTabId);
        void chrome.tabs.remove(session.authTabId);
      }
      cancelPluginCaptureSessions((session) => session.sourceOrigin === origin);
      await notifyConnectionRevoked(origin);
    }
    sendResponse({ state: await getExtensionManagerState(), success: true });
  } catch (error) {
    sendResponse({
      error: error instanceof Error ? error.message : 'Extension settings request failed.',
      success: false,
    });
  }
}

function sendMessageToSource(session: CaptureSession, message: unknown): Promise<unknown> {
  return safeChromeTabsSendMessage(session.originalTabId, message, undefined, {
    documentId: session.originalDocumentId,
    frameId: session.originalFrameId,
  });
}

function cleanupSession(authTabId: number): void {
  stopCaptureLoginDetection(authTabId);
  clearInterceptPatterns(authTabId);
  clearShouldReplayRequestInPage(authTabId);
  clearSarCredentialCapture(authTabId);
  clearBuyerTeeCapture(authTabId);
  deleteCacheByTabId(authTabId);
  sessionsByAuthTabId.delete(authTabId);
}

function notifyCaptureCancelled(session: CaptureSession): void {
  void sendMessageToSource(session, {
    action: BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE,
    data: {
      requestId: '',
      platform: session.platform,
      metadata: [],
      expiresAt: Date.now(),
      ...(session.captureAttemptId ? { captureAttemptId: session.captureAttemptId } : {}),
      errorMessage: 'Provider authentication was cancelled.',
    },
  });
}

function startMetadataClickGuide(session: CaptureSession): void {
  const userInput = session.providerConfig.metadata.userInput;
  if (!userInput?.transactionXpath) {
    return;
  }

  void safeChromeTabsSendMessage(session.authTabId, {
    action: BackgroundToContentAction.START_METADATA_CLICK_GUIDE,
    data: {
      userInput,
    },
  });
}

function stopMetadataClickGuide(authTabId: number): Promise<unknown> {
  return safeChromeTabsSendMessage(authTabId, {
    action: BackgroundToContentAction.STOP_METADATA_CLICK_GUIDE,
    data: {},
  });
}

async function sendMetadataToOriginalTab(
  session: CaptureSession,
  result: ExtractMetadataOffscreenResponse,
  fallbackRequestId?: string,
): Promise<{ sent: boolean; shared: boolean }> {
  const requestId = result.success ? result.requestId : (result.requestId ?? fallbackRequestId);
  if (!requestId) {
    return { sent: false, shared: false };
  }

  const buyerTeeCaptureResult = result.success
    ? await stageBuyerTeeCaptureForMetadata({
        metadata: result.metadata,
        request: result.request,
        tabId: session.authTabId,
      })
    : { capture: null, errorMessage: null, metadata: undefined };

  const sarCredentialFlowResult = result.success
    ? await stageSarCredentialCaptureForMetadata({
        ensureOffscreenDocument,
        request: result.request,
        tabId: session.authTabId,
      })
    : { capture: null, errorMessage: null };
  const shouldSuppressMetadata = Boolean(
    buyerTeeCaptureResult.errorMessage ||
    sarCredentialFlowResult.capture ||
    sarCredentialFlowResult.errorMessage,
  );

  if (sessionsByAuthTabId.get(session.authTabId) !== session) {
    return { sent: false, shared: false };
  }

  const errorMessage =
    buyerTeeCaptureResult.errorMessage ??
    sarCredentialFlowResult.errorMessage ??
    (sarCredentialFlowResult.capture
      ? undefined
      : result.success
        ? result.errorMessage
        : result.error);

  const data: MetadataMessagePayload = {
    requestId,
    platform: session.providerConfig.metadata.platform,
    metadata: shouldSuppressMetadata
      ? []
      : ((result.success ? (buyerTeeCaptureResult.metadata ?? result.metadata) : []) ?? []),
    expiresAt: Date.now() + 1000 * 60 * 5,
    ...(session.captureAttemptId ? { captureAttemptId: session.captureAttemptId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(buyerTeeCaptureResult.capture ? { buyerTeeCapture: buyerTeeCaptureResult.capture } : {}),
    ...(sarCredentialFlowResult.capture
      ? { sarCredentialCapture: sarCredentialFlowResult.capture }
      : {}),
  };

  session.hasSentMetadata = true;
  await sendMessageToSource(session, {
    action: BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE,
    data,
  });
  return { sent: true, shared: !errorMessage };
}

async function extractMetadataForSession(
  session: CaptureSession,
  request: RequestLog,
): Promise<void> {
  if (session.isExtracting || session.hasSentMetadata) {
    return;
  }

  session.isExtracting = true;
  try {
    await ensureOffscreenDocument();
    const response = await safeChromeRuntimeSendMessage<ExtractMetadataOffscreenResponse>({
      action: BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN,
      data: {
        includeBuyerTeeParams: session.includeBuyerTeeParams,
        providerConfig: session.providerConfig,
        requests: getRequestLogsByTabId(session.authTabId),
      },
    });

    if (sessionsByAuthTabId.get(session.authTabId) !== session) {
      return;
    }

    if (!response) {
      throw new Error('Metadata extraction worker did not respond. Re-authenticate and try again.');
    }

    const delivery = await sendMetadataToOriginalTab(session, response, request.requestId);
    if (!delivery.sent) {
      return;
    }
    if (response.success && delivery.shared) {
      await stopMetadataClickGuide(session.authTabId);
      await finishCaptureTab(
        session.authTabId,
        session.originalTabId,
        !!session.providerConfig.metadata.shouldSkipCloseTab,
      );
    } else {
      await stopMetadataClickGuide(session.authTabId);
    }
    cleanupSession(session.authTabId);
  } catch (error) {
    if (sessionsByAuthTabId.get(session.authTabId) !== session) {
      return;
    }
    logger.error('[Background] Metadata extraction failed:', error);
    await stopMetadataClickGuide(session.authTabId);
    await sendMetadataToOriginalTab(
      session,
      {
        error: error instanceof Error ? error.message : 'Metadata extraction failed.',
        requestId: request.requestId,
        success: false,
      },
      request.requestId,
    );
    cleanupSession(session.authTabId);
  } finally {
    session.isExtracting = false;
  }
}

setMetadataRequestCapturedHandler(async (request) => {
  const session = sessionsByAuthTabId.get(request.tabId);
  if (!session) {
    return;
  }
  if (!isProviderContextRequest(request, session.providerConfig)) {
    logger.log(
      '[Background] Ignoring captured request that does not match provider metadata filters:',
      {
        method: request.method,
        requestId: request.requestId,
        url: request.url,
      },
    );
    return;
  }
  await extractMetadataForSession(session, request);
});

async function handleOpenNewTabBackground(
  data: OpenNewTabPagePayload,
  sender: chrome.runtime.MessageSender,
  sendResponse: SendResponse,
): Promise<void> {
  try {
    const source = resolveSourcePage(sender);
    validateProviderIdentifier(data.platform, 'provider platform');
    validateProviderIdentifier(data.actionType, 'provider action');
    if (data.attestationPlatform) {
      validateProviderIdentifier(data.attestationPlatform, 'attestation platform');
    }
    if (data.attestationActionType) {
      validateProviderIdentifier(data.attestationActionType, 'attestation action');
    }
    const capturePlugin = data.capturePlugin;
    if (capturePlugin !== undefined) {
      await openPluginCaptureSession({ ...data, capturePlugin }, source);
      sendResponse({ success: true });
      return;
    }

    const sarCredentialCaptureConfig = resolveSarCredentialCaptureConfig({
      attestationServiceUrl: data.attestationServiceUrl,
      callerAddress: data.callerAddress,
      captureMode: data.captureMode === 'sellerCredential' ? data.captureMode : undefined,
      platform: data.platform,
    });
    if (sarCredentialCaptureConfig.error) {
      throw new Error(sarCredentialCaptureConfig.error);
    }

    const buyerTeeCaptureConfig = resolveBuyerTeeCaptureConfig({
      actionType: data.actionType,
      attestationActionType: data.attestationActionType,
      attestationPlatform: data.attestationPlatform,
      attestationServiceUrl: data.attestationServiceUrl,
      captureMode: data.captureMode,
      platform: data.platform,
    });
    if (buyerTeeCaptureConfig.error) {
      throw new Error(buyerTeeCaptureConfig.error);
    }

    const providerConfig = assertUsableProviderConfig(await resolveProviderConfig(data));
    const patterns = buildProviderPatternList(providerConfig);

    const authTabId = await createCaptureTab(source.tabId);

    const session: CaptureSession = {
      authTabId,
      originalTabId: source.tabId,
      originalDocumentId: source.documentId,
      originalFrameId: source.frameId,
      sourceOrigin: source.origin,
      platform: data.platform,
      ...(data.captureAttemptId ? { captureAttemptId: data.captureAttemptId } : {}),
      includeBuyerTeeParams: buyerTeeCaptureConfig.config !== null,
      providerConfig,
      isExtracting: false,
      hasSentMetadata: false,
    };
    sessionsByAuthTabId.set(authTabId, session);
    setInterceptPatterns(patterns, authTabId);
    setShouldReplayRequestInPage(!!providerConfig.metadata.shouldReplayRequestInPage, authTabId);
    rememberSarCredentialCapture(authTabId, sarCredentialCaptureConfig.config);
    rememberBuyerTeeCapture(authTabId, buyerTeeCaptureConfig.config);
    try {
      await chrome.tabs.update(authTabId, { url: providerConfig.authLink });
    } catch (error) {
      cleanupSession(authTabId);
      void chrome.tabs.remove(authTabId);
      throw error;
    }

    sendResponse({ success: true });
  } catch (error) {
    logger.error('[Background] OPEN_NEW_TAB failed:', error);
    sendResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unable to open metadata tab.',
    });
  }
}

chrome.webRequest.onSendHeaders.addListener(onSendHeaders, { urls: ['<all_urls>'] }, [
  'requestHeaders',
  'extraHeaders',
]);

chrome.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ['<all_urls>'] }, [
  'requestBody',
]);

chrome.webRequest.onResponseStarted.addListener(onResponseStarted, { urls: ['<all_urls>'] }, [
  'responseHeaders',
  'extraHeaders',
]);

chrome.tabs.onRemoved.addListener((tabId) => {
  if (handlePluginTabRemoved(tabId)) return;
  const session = sessionsByAuthTabId.get(tabId);
  if (!session) return;

  if (!session.hasSentMetadata) {
    notifyCaptureCancelled(session);
  }
  cleanupSession(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  handleApprovalTabUpdated(tabId, changeInfo);
  handleCaptureLoginTabUpdated(tabId, changeInfo, tab);
  if (handlePluginTabUpdated(tabId, changeInfo, tab)) return;

  const session = sessionsByAuthTabId.get(tabId);
  if (!session) {
    return;
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    startMetadataClickGuide(session);
  }
});

chrome.windows.onRemoved.addListener(handleApprovalWindowRemoved);

void restrictExtensionStorageAccess().catch((error) => {
  logger.warn('[Background] Failed to restrict extension storage access.', error);
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: SendResponse) => {
    switch (message.action) {
      case ContentToBackgroundAction.CAPTURE_LOGIN_REQUIRED:
        if (sender.frameId === 0 && sender.tab?.id !== undefined) {
          void focusCaptureTab(sender.tab.id);
        }
        return false;
      case ContentToBackgroundAction.CHECK_CONNECTION_BACKGROUND:
        void handleConnectionStatus(sender, sendResponse);
        return true;
      case ContentToBackgroundAction.REQUEST_APPROVAL_BACKGROUND:
        void handleConnectionApproval(sender, sendResponse);
        return true;
      case ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND:
        void handleOpenNewTabBackground(message.data, sender, sendResponse);
        return true;
      case ApprovalToBackgroundAction.GET_APPROVAL_REQUEST:
      case ApprovalToBackgroundAction.RESPOND_TO_APPROVAL_REQUEST:
        return handleApprovalRuntimeMessage(message, sender, sendResponse);
      case OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND:
        void replayRequestInPage(message.data.request.tabId, message.data.request).then(
          sendResponse,
        );
        return true;
      case ManagerToBackgroundAction.GET_MANAGER_STATE:
      case ManagerToBackgroundAction.REMOVE_CAPTURE_PLUGIN:
      case ManagerToBackgroundAction.REMOVE_CONNECTED_SITE:
        void handleManagerMessage(message, sender, sendResponse);
        return true;
      default:
        return false;
    }
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void installContentScriptsInExistingTabs();
});
