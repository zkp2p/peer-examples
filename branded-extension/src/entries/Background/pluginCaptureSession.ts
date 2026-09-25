import type { PeerCapturePlugin, PeerInitialAction } from '@utils/types/captureProgram';
import type { BuyerTeePaymentParams } from '@utils/buyerTeePaymentCapture';
import { captureNavigationUrl } from '@utils/captureNavigation';
import { captureHighlight } from '@utils/captureHighlight';
import { captureQuery } from '@utils/captureQuery';
import { captureReplayTarget, replayTargetHeaders } from '@utils/captureReplay';
import { executeCaptureQuery } from './captureQuery';
import {
  assertCaptureParams,
  assertInitialAction,
  captureOriginPatterns,
} from '@utils/capturePlugin';
import { safeChromeRuntimeSendMessage, safeChromeTabsSendMessage } from '@utils/extensionMessaging';
import { logger } from '@utils/logger';
import {
  replayRequest,
  replayRequestInPage,
  type ReplayOriginScope,
  type ReplayResult,
} from '@utils/misc';
import {
  BackgroundToContentAction,
  BackgroundToOffscreenAction,
  type CaptureNetworkEvent,
  type CaptureParams,
  type CaptureReplayTarget,
  type ExecuteCaptureInteractionOffscreenResponse,
  type ExecuteCapturePageActionResponse,
  type ExecuteCaptureProgramOffscreenResponse,
  type MetadataMessageType,
  type OpenNewTabPagePayload,
  type ResolvedCapturePageAction,
  type WarmCaptureSandboxOffscreenResponse,
} from '@utils/types';
import type { MetadataMessagePayload } from '@utils/types/messages/contentToPage';
import type { MatchCaptureRequestOffscreenResponse } from '@utils/types/messages/backgroundToOffscreen';

import { requestExtensionApproval } from './approvalWindow';
import { injectSpinner, removeAuthOverlay } from './authTabOverlay';
import {
  createCaptureTab,
  finishCaptureTab,
  focusCaptureTab,
  stopCaptureLoginDetection,
} from './captureTab';
import {
  clearBuyerTeeCapture,
  rememberBuyerTeeCapture,
  resolveBuyerTeeCaptureConfig,
  stageBuyerTeeCaptureForMetadata,
} from './buyerTeeFlow';
import { deleteCacheByTabId } from './cache';
import { installCapturePlugin } from './capturePluginFlow';
import {
  clearInterceptPatterns,
  setInterceptPatterns,
  setMainFrameNavigationHandler,
  setRequestCaptureHandler,
} from './handlers';
import { ensureOffscreenDocument } from './offscreenDocument';
import type { RequestLog } from './requestLog';
import {
  clearSarCredentialCapture,
  rememberSarCredentialCapture,
  resolveSarCredentialCaptureConfig,
  stageSarCredentialCaptureForMetadata,
} from './sarCredentialFlow';

export type CaptureRequestSource = {
  documentId: string;
  frameId: number;
  hostname: string;
  origin: string;
  tabId: number;
};

type PluginCaptureSession = {
  authOrigin: string;
  authTabId: number;
  captureAttemptId?: string;
  captureMode?: OpenNewTabPagePayload['captureMode'];
  captureParams: CaptureParams;
  captureSearchOverlayPromise: Promise<void> | null;
  captureSearchOverlayTimer: ReturnType<typeof setTimeout> | null;
  captureSearchCount: number;
  documentGeneration: number;
  pendingPageRequest?: RequestLog;
  navigationTargets: Set<string>;
  queryTargets: Set<string>;
  replayInFlight: Set<string>;
  hasSentMetadata: boolean;
  highlight: { pathPrefix: string; expectedUrl: string } | null;
  initialAction: Required<PeerInitialAction>;
  interactionActionCount: number;
  interactionKeys: Set<string>;
  interactionRunning: boolean;
  isExtracting: boolean;
  originalDocumentId: string;
  originalFrameId: number;
  originalTabId: number;
  platform: string;
  plugin: PeerCapturePlugin;
  sourceOrigin: string;
};

const MAX_INTERACTION_ACTIONS_PER_SESSION = 15;
const CAPTURE_SEARCH_OVERLAY_DELAY_MS = 150;
const sessions = new Map<number, PluginCaptureSession>();

async function ensureCaptureSandboxReady(): Promise<void> {
  await ensureOffscreenDocument();
  const response = await safeChromeRuntimeSendMessage<WarmCaptureSandboxOffscreenResponse>({
    action: BackgroundToOffscreenAction.WARM_CAPTURE_SANDBOX_OFFSCREEN,
    data: {},
  });
  if (!response) throw new Error('Capture sandbox did not respond.');
  if (!response.success) throw new Error(response.error);
}

function clearCaptureSearchOverlayTimer(session: PluginCaptureSession): void {
  if (session.captureSearchOverlayTimer === null) return;
  clearTimeout(session.captureSearchOverlayTimer);
  session.captureSearchOverlayTimer = null;
}

function scheduleCaptureSearchOverlay(session: PluginCaptureSession): void {
  if (
    session.highlight ||
    session.captureSearchOverlayPromise ||
    session.captureSearchOverlayTimer !== null
  )
    return;
  session.captureSearchOverlayTimer = setTimeout(() => {
    session.captureSearchOverlayTimer = null;
    if (
      sessions.get(session.authTabId) !== session ||
      session.captureSearchCount === 0 ||
      session.highlight ||
      session.hasSentMetadata
    ) {
      return;
    }
    session.captureSearchOverlayPromise = injectSpinner(session.authTabId);
  }, CAPTURE_SEARCH_OVERLAY_DELAY_MS);
}

async function ensureCaptureSearchOverlay(session: PluginCaptureSession): Promise<void> {
  clearCaptureSearchOverlayTimer(session);
  session.captureSearchOverlayPromise ??= injectSpinner(session.authTabId);
  await session.captureSearchOverlayPromise;
}

async function hideCaptureSearchOverlay(session: PluginCaptureSession): Promise<void> {
  clearCaptureSearchOverlayTimer(session);
  if (!session.captureSearchOverlayPromise) return;
  await session.captureSearchOverlayPromise;
  session.captureSearchOverlayPromise = null;
  await removeAuthOverlay(session.authTabId);
}

function requestBody(request: RequestLog): string | null {
  if (request.requestBody !== undefined) return request.requestBody;
  if (!request.formData) return null;
  const body = new URLSearchParams();
  Object.entries(request.formData).forEach(([name, values]) => {
    values.forEach((value) => body.append(name, value));
  });
  return body.toString();
}

function toNetworkEvent(request: RequestLog): CaptureNetworkEvent {
  return {
    request: {
      body: requestBody(request),
      method: request.method,
      url: request.url,
    },
    response: {
      body: request.responseBody ?? null,
      status: request.responseStatus ?? 200,
      url: request.url,
    },
  };
}

function sendToSource(session: PluginCaptureSession, message: unknown): Promise<unknown> {
  return safeChromeTabsSendMessage(session.originalTabId, message, undefined, {
    documentId: session.originalDocumentId,
    frameId: session.originalFrameId,
  });
}

function cleanup(session: PluginCaptureSession): void {
  void stopCaptureHighlight(session);
  stopCaptureLoginDetection(session.authTabId);
  clearCaptureSearchOverlayTimer(session);
  clearInterceptPatterns(session.authTabId);
  clearSarCredentialCapture(session.authTabId);
  clearBuyerTeeCapture(session.authTabId);
  deleteCacheByTabId(session.authTabId);
  sessions.delete(session.authTabId);
}

function stopCaptureHighlight(session: PluginCaptureSession): Promise<unknown> {
  if (!session.highlight) return Promise.resolve();
  session.highlight = null;
  return safeChromeTabsSendMessage(session.authTabId, {
    action: BackgroundToContentAction.STOP_METADATA_CLICK_GUIDE,
    data: {},
  });
}

function notifyCaptureError(session: PluginCaptureSession, errorMessage: string): void {
  void sendToSource(session, {
    action: BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE,
    data: {
      errorMessage,
      expiresAt: Date.now(),
      metadata: [],
      platform: session.platform,
      requestId: '',
      ...(session.captureAttemptId ? { captureAttemptId: session.captureAttemptId } : {}),
    },
  });
}

async function deliver(
  session: PluginCaptureSession,
  request: RequestLog,
  metadata: MetadataMessageType[],
  params: BuyerTeePaymentParams | undefined,
  captureError?: string,
): Promise<boolean> {
  const buyerTeeResult = captureError
    ? { capture: null, errorMessage: null, metadata: undefined }
    : await stageBuyerTeeCaptureForMetadata({
        metadata,
        params,
        request,
        tabId: session.authTabId,
      });
  const sarResult = captureError
    ? { capture: null, errorMessage: null }
    : await stageSarCredentialCaptureForMetadata({
        ensureOffscreenDocument,
        request,
        tabId: session.authTabId,
      });
  if (sessions.get(session.authTabId) !== session) return false;

  const errorMessage =
    captureError ??
    buyerTeeResult.errorMessage ??
    sarResult.errorMessage ??
    (session.captureMode && !buyerTeeResult.capture && !sarResult.capture
      ? 'The capture plugin could not stage this result.'
      : undefined);
  const suppressMetadata = Boolean(errorMessage || sarResult.capture);
  const data: MetadataMessagePayload = {
    expiresAt: Date.now() + 5 * 60 * 1_000,
    metadata: suppressMetadata ? [] : (buyerTeeResult.metadata ?? metadata),
    platform: session.platform,
    requestId: request.requestId,
    ...(session.captureAttemptId ? { captureAttemptId: session.captureAttemptId } : {}),
    ...(errorMessage ? { errorMessage } : {}),
    ...(buyerTeeResult.capture ? { buyerTeeCapture: buyerTeeResult.capture } : {}),
    ...(sarResult.capture ? { sarCredentialCapture: sarResult.capture } : {}),
  };
  session.hasSentMetadata = true;
  await sendToSource(session, {
    action: BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE,
    data,
  });
  return errorMessage === undefined;
}

/** A new top-level document is coming: drop pending results from the old one. */
function invalidateDocument(session: PluginCaptureSession): number {
  void stopCaptureHighlight(session);
  session.pendingPageRequest = undefined;
  return ++session.documentGeneration;
}

// Targets replay inside the provider tab, like Curator templates that set
// shouldReplayRequestInPage: the provider sees its own origin and referer.
async function replayTargetInPage(
  tabId: number,
  request: RequestLog,
  originScope: ReplayOriginScope,
): Promise<ReplayResult> {
  const replay = await replayRequestInPage(tabId, request, originScope);
  if (!replay.ok && replay.error) throw new Error(`Provider replay failed: ${replay.error}`);
  return { status: replay.status, text: replay.text ?? '' };
}

/** The provider tab's document origin, or null when it is not a declared plugin origin. */
async function pluginTabOrigin(session: PluginCaptureSession): Promise<string | null> {
  const tab = await chrome.tabs.get(session.authTabId);
  const origin = tab.url ? new URL(tab.url).origin : null;
  return origin !== null && session.plugin.origins.includes(origin) ? origin : null;
}

function replayTargetKey(target: CaptureReplayTarget): string {
  return `${target.method} ${target.url}\n${target.body ?? ''}`;
}

async function runCapture(session: PluginCaptureSession, request: RequestLog): Promise<void> {
  if (session.hasSentMetadata || session.isExtracting) return;
  let documentGeneration = session.documentGeneration;
  let claimed = false;
  let searchStarted = false;
  let replayKey: string | null = null;
  const stale = () =>
    sessions.get(session.authTabId) !== session ||
    session.hasSentMetadata ||
    session.isExtracting ||
    session.documentGeneration !== documentGeneration;
  try {
    await ensureCaptureSandboxReady();
    const match = await safeChromeRuntimeSendMessage<MatchCaptureRequestOffscreenResponse>({
      action: BackgroundToOffscreenAction.MATCH_CAPTURE_REQUEST_OFFSCREEN,
      data: {
        origins: session.plugin.origins,
        request: toNetworkEvent(request).request,
        params: session.captureParams,
        source: session.plugin.source,
      },
    });
    if (!match) throw new Error('Capture sandbox did not respond.');
    if (!match.success) throw new Error(match.error);
    if (match.result === false) return;
    if (stale()) return;
    // Legacy metadataUrl/fallback parity: a target makes the matched request the
    // context only. Replay the target with this request's session headers and
    // stage that request, exactly as the Curator engine does.
    const replayTarget =
      match.result === true
        ? null
        : captureReplayTarget(match.result, session.plugin.origins, request.url);
    if (match.result !== true && !replayTarget) {
      throw new Error('Capture replay target is invalid.');
    }
    let replayOriginScope: ReplayOriginScope | null = null;
    if (replayTarget) {
      const requestOrigin = new URL(request.url).origin;
      // In-page replay runs in the tab's current document, which must be a plugin
      // origin: a third-party login page must not issue the provider request.
      const pageOrigin = await pluginTabOrigin(session);
      if (pageOrigin === null || stale()) return;
      replayOriginScope = { pageOrigin, requestOrigin };
      // Every pocket feed or poll names the same target; replay it once at a time.
      const key = replayTargetKey(replayTarget);
      if (session.replayInFlight.has(key)) return;
      session.replayInFlight.add(key);
      replayKey = key;
      request = {
        ...request,
        formData: undefined,
        method: replayTarget.method,
        requestBody: replayTarget.body ?? undefined,
        requestHeaders: replayTargetHeaders(request.requestHeaders, replayTarget),
        url: replayTarget.url,
      };
    }

    session.captureSearchCount += 1;
    searchStarted = true;
    scheduleCaptureSearchOverlay(session);
    const replay = replayOriginScope
      ? await replayTargetInPage(session.authTabId, request, replayOriginScope)
      : await replayRequest(request, 'error');
    if (stale()) return;
    if (replayTarget && (replay.status < 200 || replay.status >= 300)) {
      // The host chose to fetch this URL, so a failure is the host's to report.
      throw new Error(`Provider replied ${replay.status} to the replayed request.`);
    }
    request = { ...request, responseBody: replay.text, responseStatus: replay.status };

    const response = await safeChromeRuntimeSendMessage<ExecuteCaptureProgramOffscreenResponse>({
      action: BackgroundToOffscreenAction.EXECUTE_CAPTURE_PROGRAM_OFFSCREEN,
      data: {
        event: toNetworkEvent(request),
        params: session.captureParams,
        source: session.plugin.source,
      },
    });
    if (!response) throw new Error('Capture sandbox did not respond.');
    if (!response.success) throw new Error(response.error);
    if (response.result === null) return;
    if (
      sessions.get(session.authTabId) !== session ||
      session.isExtracting ||
      session.documentGeneration !== documentGeneration
    )
      return;
    const highlight = captureHighlight(response.result);
    if (highlight) {
      if (!session.initialAction.enabled)
        throw new Error('Capture highlighting requires enabled page actions.');
      const tab = await chrome.tabs.get(session.authTabId);
      if (stale()) return;
      const pageUrl = tab.url ? new URL(tab.url) : null;
      if (!pageUrl || pageUrl.origin !== session.authOrigin)
        throw new Error('Capture highlight source is invalid.');
      const expectedUrl = `${pageUrl.origin}${pageUrl.pathname}`;
      if (
        session.highlight?.pathPrefix === highlight.pathPrefix &&
        session.highlight.expectedUrl === expectedUrl
      )
        return;
      if (session.interactionActionCount >= MAX_INTERACTION_ACTIONS_PER_SESSION)
        throw new Error('Capture interaction reached its session action limit.');
      session.interactionActionCount += 1;
      session.highlight = { ...highlight, expectedUrl };
      await hideCaptureSearchOverlay(session);
      if (stale()) return;
      await focusCaptureTab(session.authTabId);
      if (stale()) return;
      const result = await safeChromeTabsSendMessage<ExecuteCapturePageActionResponse>(
        session.authTabId,
        {
          action: BackgroundToContentAction.START_CAPTURE_HIGHLIGHT,
          data: { highlight, expectedUrl },
        },
        undefined,
        { frameId: 0 },
      );
      if (!result?.success) throw new Error(result?.error ?? 'Capture highlight did not run.');
      return;
    }
    const query = captureQuery(response.result, session.authOrigin);
    if (query) {
      if (!session.initialAction.enabled)
        throw new Error('Capture queries require enabled page actions.');
      const key = JSON.stringify(query);
      if (session.queryTargets.has(key)) return;
      if (session.interactionActionCount >= MAX_INTERACTION_ACTIONS_PER_SESSION) {
        throw new Error('Capture interaction reached its session action limit.');
      }
      const pageUrl = new URL(request.url);
      if (pageUrl.origin !== session.authOrigin)
        throw new Error('Capture query source is invalid.');
      session.queryTargets.add(key);
      session.interactionActionCount += 1;
      const results = await chrome.scripting.executeScript({
        target: { tabId: session.authTabId },
        world: 'ISOLATED',
        func: executeCaptureQuery,
        args: [query, `${pageUrl.origin}${pageUrl.pathname}`],
      });
      if (!results[0]?.result?.success) {
        throw new Error(results[0]?.result?.error ?? 'Capture query did not run.');
      }
      return;
    }
    const navigationUrl = captureNavigationUrl(response.result, session.authOrigin);
    if (navigationUrl !== null) {
      if (!session.initialAction.enabled || Object.keys(session.captureParams).length === 0) {
        throw new Error('Capture navigation requires enabled page actions and scoped params.');
      }
      if (session.navigationTargets.has(navigationUrl)) return;
      if (session.interactionActionCount >= MAX_INTERACTION_ACTIONS_PER_SESSION) {
        throw new Error('Capture interaction reached its session action limit.');
      }
      session.navigationTargets.add(navigationUrl);
      session.interactionActionCount += 1;
      documentGeneration = invalidateDocument(session);
      await chrome.tabs.update(session.authTabId, { url: navigationUrl });
      return;
    }
    session.isExtracting = true;
    claimed = true;
    await stopCaptureHighlight(session);
    await ensureCaptureSearchOverlay(session);

    const metadata = Array.isArray(response.result) ? response.result : [];
    const params = Array.isArray(response.result)
      ? undefined
      : (response.result as BuyerTeePaymentParams);
    const delivered = await deliver(session, request, metadata, params);
    cleanup(session);
    if (delivered) {
      await finishCaptureTab(
        session.authTabId,
        session.originalTabId,
        session.plugin.shouldSkipCloseTab,
      );
    } else {
      await hideCaptureSearchOverlay(session);
    }
  } catch (error) {
    if (sessions.get(session.authTabId) !== session) return;
    if (!claimed && session.documentGeneration !== documentGeneration) return;
    if (session.isExtracting && !claimed) return;
    session.isExtracting = true;
    claimed = true;
    const message = error instanceof Error ? error.message : 'Capture failed.';
    logger.error('[Background] Capture plugin failed:', message);
    try {
      await deliver(session, request, [], undefined, message);
    } finally {
      cleanup(session);
      await hideCaptureSearchOverlay(session);
    }
  } finally {
    if (replayKey !== null) session.replayInFlight.delete(replayKey);
    if (searchStarted) {
      session.captureSearchCount -= 1;
      if (
        session.captureSearchCount === 0 &&
        sessions.get(session.authTabId) === session &&
        !session.isExtracting
      ) {
        await hideCaptureSearchOverlay(session);
      }
    }
    if (claimed) session.isExtracting = false;
  }
}

function captureLoadedPage(session: PluginCaptureSession, tab: chrome.tabs.Tab): void {
  if (sessions.get(session.authTabId) !== session || tab.status !== 'complete') return;
  const request = session.pendingPageRequest;
  if (!request) return;
  // Any newer main-frame request already cleared the pending page, so a loaded
  // document on the page's origin is that page even after history.replaceState.
  const tabOrigin = tab.url ? new URL(tab.url).origin : null;
  if (tabOrigin !== new URL(request.url).origin) return;
  session.pendingPageRequest = undefined;
  void runCapture(session, request);
}

async function executeInteraction(session: PluginCaptureSession, tabUrl: string): Promise<void> {
  if (!session.initialAction.enabled || session.interactionRunning || session.hasSentMetadata)
    return;
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    return;
  }
  if (url.origin !== session.authOrigin) return;
  let documentGeneration = session.documentGeneration;
  const interactionKey = `${documentGeneration}:${url.origin}${url.pathname}`;
  if (session.interactionKeys.has(interactionKey)) return;
  session.interactionKeys.add(interactionKey);
  session.interactionRunning = true;
  try {
    await ensureCaptureSandboxReady();
    const response = await safeChromeRuntimeSendMessage<ExecuteCaptureInteractionOffscreenResponse>(
      {
        action: BackgroundToOffscreenAction.EXECUTE_CAPTURE_INTERACTION_OFFSCREEN,
        data: {
          inputs: Object.keys(session.initialAction.paymentDetails),
          source: session.plugin.source,
          url: url.href,
        },
      },
    );
    if (!response) throw new Error('Capture sandbox did not respond.');
    if (!response.success) throw new Error(response.error);
    if (response.actions.length === 0) return;
    if (
      session.interactionActionCount + response.actions.length >
      MAX_INTERACTION_ACTIONS_PER_SESSION
    ) {
      throw new Error('Capture interaction reached its session action limit.');
    }

    const actions: ResolvedCapturePageAction[] = response.actions.map((action) => {
      if (action.type !== 'fill') return action;
      const value = session.initialAction.paymentDetails[action.input];
      if (value === undefined) throw new Error(`Capture input ${action.input} is unavailable.`);
      return { ...action, value };
    });
    if (
      sessions.get(session.authTabId) !== session ||
      session.documentGeneration !== documentGeneration
    ) {
      return;
    }
    await focusCaptureTab(session.authTabId);
    session.interactionActionCount += actions.length;

    for (const action of actions) {
      if (session.documentGeneration !== documentGeneration) {
        throw new Error('Provider page changed before the action ran.');
      }
      if (action.type === 'navigate') {
        documentGeneration = invalidateDocument(session);
        await chrome.tabs.update(session.authTabId, { url: action.url });
        continue;
      }
      const result = await safeChromeTabsSendMessage<ExecuteCapturePageActionResponse>(
        session.authTabId,
        {
          action: BackgroundToContentAction.EXECUTE_CAPTURE_PAGE_ACTION,
          data: { action, expectedUrl: `${url.origin}${url.pathname}` },
        },
      );
      if (!result?.success) {
        throw new Error(result?.error ?? 'Provider page action did not run.');
      }
    }
  } catch (error) {
    if (
      sessions.get(session.authTabId) !== session ||
      session.documentGeneration !== documentGeneration ||
      session.isExtracting ||
      session.hasSentMetadata
    ) {
      return;
    }
    const message = error instanceof Error ? error.message : 'Provider page action failed.';
    logger.warn('[Background] Capture interaction did not run:', message);
    session.hasSentMetadata = true;
    cleanup(session);
    notifyCaptureError(session, message);
    await hideCaptureSearchOverlay(session);
  } finally {
    session.interactionRunning = false;
  }
}

export async function openPluginCaptureSession(
  data: OpenNewTabPagePayload & { capturePlugin: PeerCapturePlugin },
  source: CaptureRequestSource,
): Promise<void> {
  const initialAction = assertInitialAction(data.initialAction);
  const captureParams = assertCaptureParams(data.captureParams);
  const sarConfig = resolveSarCredentialCaptureConfig({
    attestationServiceUrl: data.attestationServiceUrl,
    callerAddress: data.callerAddress,
    captureMode: data.captureMode === 'sellerCredential' ? data.captureMode : undefined,
    platform: data.platform,
  });
  if (sarConfig.error) throw new Error(sarConfig.error);
  const buyerTeeConfig = resolveBuyerTeeCaptureConfig({
    actionType: data.actionType,
    attestationActionType: data.attestationActionType,
    attestationPlatform: data.attestationPlatform,
    attestationServiceUrl: data.attestationServiceUrl,
    captureMode: data.captureMode,
    platform: data.platform,
  });
  if (buyerTeeConfig.error) throw new Error(buyerTeeConfig.error);
  await ensureCaptureSandboxReady();
  const plugin = await installCapturePlugin({
    actionType: data.actionType,
    platform: data.platform,
    requestApproval: requestExtensionApproval,
    sourceHostname: source.hostname,
    sourceOrigin: source.origin,
    value: data.capturePlugin,
  });

  const authTabId = await createCaptureTab(source.tabId, plugin.focusOnOpen);
  const session: PluginCaptureSession = {
    authOrigin: new URL(plugin.authLink).origin,
    authTabId,
    ...(data.captureAttemptId ? { captureAttemptId: data.captureAttemptId } : {}),
    captureMode: data.captureMode,
    captureParams,
    captureSearchOverlayPromise: null,
    captureSearchOverlayTimer: null,
    captureSearchCount: 0,
    documentGeneration: 0,
    navigationTargets: new Set(),
    queryTargets: new Set(),
    replayInFlight: new Set(),
    hasSentMetadata: false,
    highlight: null,
    initialAction,
    interactionActionCount: 0,
    interactionKeys: new Set(),
    interactionRunning: false,
    isExtracting: false,
    originalDocumentId: source.documentId,
    originalFrameId: source.frameId,
    originalTabId: source.tabId,
    platform: data.platform,
    plugin,
    sourceOrigin: source.origin,
  };
  sessions.set(authTabId, session);
  setInterceptPatterns(captureOriginPatterns(plugin), authTabId);
  setMainFrameNavigationHandler(authTabId, () => {
    // A main-frame request is the only signal that a new document is coming.
    // Late subframe loads and history.replaceState also toggle the tab's
    // loading status, and must not invalidate an in-flight capture.
    invalidateDocument(session);
  });
  setRequestCaptureHandler(authTabId, (request) => {
    if (request.type !== 'main_frame') {
      void runCapture(session, request);
      return;
    }
    // Main-frame response headers arrive before the navigation's loading event.
    // Wait for the loaded document so that event cannot invalidate its own capture.
    session.pendingPageRequest = request;
    void chrome.tabs
      .get(authTabId)
      .then((tab) => captureLoadedPage(session, tab))
      .catch(() => {});
  });
  rememberSarCredentialCapture(authTabId, sarConfig.config);
  rememberBuyerTeeCapture(authTabId, buyerTeeConfig.config);
  try {
    await chrome.tabs.update(authTabId, { url: plugin.authLink });
  } catch (error) {
    cleanup(session);
    void chrome.tabs.remove(authTabId);
    throw error;
  }
}

export function handlePluginTabRemoved(tabId: number): boolean {
  const session = sessions.get(tabId);
  if (!session) return false;
  if (!session.hasSentMetadata)
    notifyCaptureError(session, 'Provider authentication was cancelled.');
  cleanup(session);
  return true;
}

export function handlePluginTabUpdated(
  tabId: number,
  changeInfo: chrome.tabs.TabChangeInfo,
  tab: chrome.tabs.Tab,
): boolean {
  const session = sessions.get(tabId);
  if (!session) return false;
  if (session.highlight && changeInfo.url) {
    const url = new URL(changeInfo.url);
    if (`${url.origin}${url.pathname}` !== session.highlight.expectedUrl)
      void stopCaptureHighlight(session);
  }
  if (changeInfo.status === 'complete') captureLoadedPage(session, tab);
  if ((changeInfo.status === 'complete' || changeInfo.url) && tab.url) {
    void executeInteraction(session, tab.url);
  }
  return true;
}

export function cancelPluginCaptureSessions(
  predicate: (session: Pick<PluginCaptureSession, 'plugin' | 'sourceOrigin'>) => boolean,
): void {
  for (const session of sessions.values()) {
    if (!predicate(session)) continue;
    notifyCaptureError(session, 'Provider authentication was cancelled.');
    cleanup(session);
    void chrome.tabs.remove(session.authTabId);
  }
}
