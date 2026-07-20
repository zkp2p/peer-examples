import { logger } from '@utils/logger';
import { safeChromeRuntimeSendMessage, safeChromeTabsSendMessage } from '@utils/extensionMessaging';
import { APP_WEB_URL, PROVIDER_TEMPLATE_API_ROOT } from '@utils/constants';
import {
  BackgroundToContentAction,
  BackgroundToOffscreenAction,
  ContentToBackgroundAction,
  OffscreenToBackgroundAction,
  type ContentToBackgroundMessageType,
  type ExtractMetadataOffscreenResponse,
  type OffscreenToBackgroundMessageType,
  type OpenNewTabPagePayload,
  type ProviderSettings,
} from '@utils/types';
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
import {
  injectSpinner,
  startCountdownAndClose,
  updateSpinnerToGreenAndStatic,
} from './authTabOverlay';
import { isProviderContextRequest } from './providerRequestMatcher';
import { installContentScriptsInExistingTabs } from './installBackfill';

type RuntimeMessage = ContentToBackgroundMessageType | OffscreenToBackgroundMessageType;
type SendResponse = (response?: unknown) => void;

type CaptureSession = {
  authTabId: number;
  originalTabId: number;
  platform: string;
  captureAttemptId?: string;
  providerConfig: ProviderSettings;
  isExtracting: boolean;
  hasSentMetadata: boolean;
  requiresMetadataApproval: boolean;
};

const sessionsByAuthTabId = new Map<number, CaptureSession>();

function buildProviderConfigUrl(data: OpenNewTabPagePayload): string {
  return `${PROVIDER_TEMPLATE_API_ROOT}${data.platform}/${data.actionType}.json`;
}

function usesCustomProviderTemplate(data: OpenNewTabPagePayload): boolean {
  return Boolean(data.providerConfig);
}

async function resolveProviderConfig(data: OpenNewTabPagePayload): Promise<ProviderSettings> {
  if (data.providerConfig) {
    return data.providerConfig;
  }

  const configUrl = buildProviderConfigUrl(data);
  logger.log('[Background] Fetching provider template:', configUrl);
  const response = await fetch(configUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch provider template: ${response.status}`);
  }
  return (await response.json()) as ProviderSettings;
}

function buildPatternList(providerConfig: ProviderSettings): string[] {
  const patternList: string[] = [];
  const metadata = providerConfig.metadata;

  if (metadata.urlRegex) {
    patternList.push(metadata.urlRegex);
  }
  if (metadata.fallbackUrlRegex) {
    patternList.push(metadata.fallbackUrlRegex);
  }
  if (metadata.metadataUrl) {
    const metadataUrlPattern = metadata.metadataUrl.replace(/\{\{[^}]+\}\}/g, '\\S+');
    if (!patternList.includes(metadataUrlPattern)) {
      patternList.push(metadataUrlPattern);
    }
  }

  return patternList;
}

function cleanupSession(authTabId: number): void {
  clearInterceptPatterns(authTabId);
  clearShouldReplayRequestInPage(authTabId);
  clearSarCredentialCapture(authTabId);
  clearBuyerTeeCapture(authTabId);
  deleteCacheByTabId(authTabId);
  sessionsByAuthTabId.delete(authTabId);
}

function notifyCaptureCancelled(session: CaptureSession): void {
  void safeChromeTabsSendMessage(session.originalTabId, {
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

async function showAuthSuccessOverlay(session: CaptureSession): Promise<void> {
  await stopMetadataClickGuide(session.authTabId);
  await injectSpinner(session.authTabId);
  setTimeout(() => {
    void (async () => {
      await updateSpinnerToGreenAndStatic(session.authTabId);
      startCountdownAndClose(
        session.authTabId,
        2,
        !!session.providerConfig.metadata.shouldSkipCloseTab,
        () => session.originalTabId,
      );
    })().catch((error) => {
      logger.error('[Background] Failed to show auth success overlay:', error);
    });
  }, 1500);
}

async function sendMetadataToOriginalTab(
  session: CaptureSession,
  result: ExtractMetadataOffscreenResponse,
  fallbackRequestId?: string,
): Promise<boolean> {
  const requestId = result.success ? result.requestId : (result.requestId ?? fallbackRequestId);
  if (!requestId) {
    return false;
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
        requestId,
        tabId: session.authTabId,
      })
    : { capture: null, errorMessage: null };
  const shouldSuppressMetadata = Boolean(
    buyerTeeCaptureResult.errorMessage ||
    sarCredentialFlowResult.capture || sarCredentialFlowResult.errorMessage,
  );

  if (sessionsByAuthTabId.get(session.authTabId) !== session) {
    return false;
  }

  session.hasSentMetadata = true;

  await safeChromeTabsSendMessage(session.originalTabId, {
    action: BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE,
    data: {
      requestId,
      platform: session.providerConfig.metadata.platform,
      metadata: shouldSuppressMetadata
        ? []
        : ((result.success ? (buyerTeeCaptureResult.metadata ?? result.metadata) : []) ?? []),
      expiresAt: Date.now() + 1000 * 60 * 5,
      ...(session.captureAttemptId ? { captureAttemptId: session.captureAttemptId } : {}),
      errorMessage:
        buyerTeeCaptureResult.errorMessage ??
        sarCredentialFlowResult.errorMessage ??
        (result.success ? result.errorMessage : result.error),
      buyerTeeCapture: buyerTeeCaptureResult.capture,
      requiresMetadataApproval: session.requiresMetadataApproval,
      sarCredentialCapture: sarCredentialFlowResult.capture,
    },
  });
  return true;
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

    const didSendMetadata = await sendMetadataToOriginalTab(session, response, request.requestId);
    if (!didSendMetadata) {
      return;
    }
    if (response.success) {
      await showAuthSuccessOverlay(session);
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
  senderTab: chrome.tabs.Tab | undefined,
  sendResponse: SendResponse,
): Promise<void> {
  try {
    const providerConfig = await resolveProviderConfig(data);
    const patterns = buildPatternList(providerConfig);
    if (patterns.length === 0) {
      throw new Error('Provider template does not define metadata intercept patterns.');
    }

    const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const originalTabId = senderTab?.id ?? activeTabs[0]?.id;
    if (!originalTabId) {
      throw new Error('Unable to resolve source tab for metadata capture.');
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

    const authTab = await chrome.tabs.create({ url: providerConfig.authLink, active: true });
    if (!authTab.id) {
      throw new Error('Unable to open provider authentication tab.');
    }

    const session: CaptureSession = {
      authTabId: authTab.id,
      originalTabId,
      platform: data.platform,
      ...(data.captureAttemptId ? { captureAttemptId: data.captureAttemptId } : {}),
      providerConfig,
      isExtracting: false,
      hasSentMetadata: false,
      requiresMetadataApproval: usesCustomProviderTemplate(data),
    };
    sessionsByAuthTabId.set(authTab.id, session);
    setInterceptPatterns(patterns, authTab.id);
    setShouldReplayRequestInPage(!!providerConfig.metadata.shouldReplayRequestInPage, authTab.id);
    rememberSarCredentialCapture(authTab.id, sarCredentialCaptureConfig.config);
    rememberBuyerTeeCapture(
      authTab.id,
      buyerTeeCaptureConfig.config
        ? {
            ...buyerTeeCaptureConfig.config,
            providerConfig,
          }
        : null,
    );
    setTimeout(() => startMetadataClickGuide(session), 500);

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
  const session = sessionsByAuthTabId.get(tabId);
  if (!session) return;

  if (!session.hasSentMetadata) {
    notifyCaptureCancelled(session);
  }
  cleanupSession(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  const session = sessionsByAuthTabId.get(tabId);
  if (!session) {
    return;
  }

  if (changeInfo.status === 'complete' || changeInfo.url) {
    startMetadataClickGuide(session);
  }
});

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: APP_WEB_URL });
});

chrome.runtime.onMessage.addListener(
  (message: RuntimeMessage, sender: chrome.runtime.MessageSender, sendResponse: SendResponse) => {
    switch (message.action) {
      case ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND:
        void handleOpenNewTabBackground(message.data, sender.tab, sendResponse);
        return true;
      case OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND:
        void replayRequestInPage(message.data.request.tabId, message.data.request).then(
          sendResponse,
        );
        return true;
      default:
        return false;
    }
  },
);

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') {
    return;
  }

  installContentScriptsInExistingTabs();
});
