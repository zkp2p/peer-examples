import {
  BackgroundToOffscreenAction,
  type BackgroundToOffscreenMessageType,
  type ExtractMetadataOffscreenResponse,
} from '@utils/types/messages';
import {
  extractTransactionsFromPayload,
  getContextRequests,
  resolveMetadataPayload,
} from '@utils/metadataEngine';
import { logger } from '@utils/logger';
import {
  runCaptureInteraction,
  runCaptureMatch,
  runCaptureProgram,
  warmCaptureSandbox,
} from './captureSandboxClient';
import { createSarCredentialBundle } from './sarCredentialBundle';

async function extractMetadata(
  message: Extract<
    BackgroundToOffscreenMessageType,
    { action: typeof BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN }
  >,
): Promise<ExtractMetadataOffscreenResponse> {
  const { includeBuyerTeeParams, providerConfig, requests } = message.data;
  const context = getContextRequests(requests, providerConfig);
  const contextRequest = context.found || context.fallback;
  if (!contextRequest) {
    return {
      error: 'No matching metadata request captured. Re-authenticate and try again.',
      success: false,
    };
  }

  try {
    const payload = await resolveMetadataPayload(context, providerConfig);
    const metadata = extractTransactionsFromPayload(payload, providerConfig, includeBuyerTeeParams);
    return {
      errorMessage:
        metadata.length > 0
          ? undefined
          : 'No transactions could be extracted for this page. Open your transaction history or statement view, then retry.',
      metadata,
      request: payload.request,
      requestId: payload.request.requestId,
      success: true,
    };
  } catch (error) {
    logger.error('[Offscreen] Metadata extraction failed:', error);
    return {
      error: error instanceof Error ? error.message : 'Metadata extraction failed.',
      requestId: contextRequest.requestId,
      success: false,
    };
  }
}

chrome.runtime.onMessage.addListener(
  (
    message: BackgroundToOffscreenMessageType,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    switch (message.action) {
      case BackgroundToOffscreenAction.MATCH_CAPTURE_REQUEST_OFFSCREEN:
        void runCaptureMatch(
          message.data.source,
          message.data.request,
          message.data.params,
          message.data.origins,
        )
          .then((result) => sendResponse({ result, success: true }))
          .catch((error) =>
            sendResponse({
              error: error instanceof Error ? error.message : 'Capture request matching failed.',
              success: false,
            }),
          );
        return true;
      case BackgroundToOffscreenAction.EXECUTE_CAPTURE_PROGRAM_OFFSCREEN:
        void runCaptureProgram(message.data.source, message.data.event, message.data.params)
          .then((result) => sendResponse({ result, success: true }))
          .catch((error) => {
            logger.error('[Offscreen] Capture program failed:', error);
            sendResponse({
              error: error instanceof Error ? error.message : 'Capture program failed.',
              success: false,
            });
          });
        return true;
      case BackgroundToOffscreenAction.EXECUTE_CAPTURE_INTERACTION_OFFSCREEN:
        void runCaptureInteraction(message.data)
          .then((actions) => sendResponse({ actions, success: true }))
          .catch((error) => {
            logger.error('[Offscreen] Capture interaction failed:', error);
            sendResponse({
              error: error instanceof Error ? error.message : 'Capture interaction failed.',
              success: false,
            });
          });
        return true;
      case BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN:
        void extractMetadata(message).then(sendResponse);
        return true;
      case BackgroundToOffscreenAction.CREATE_SAR_CREDENTIAL_BUNDLE_OFFSCREEN:
        void createSarCredentialBundle(message.data)
          .then((bundle) => sendResponse({ bundle, success: true }))
          .catch((error) => {
            logger.error('[Offscreen] SAR credential bundle creation failed:', error);
            sendResponse({
              error:
                error instanceof Error ? error.message : 'SAR credential bundle creation failed.',
              success: false,
            });
          });
        return true;
      case BackgroundToOffscreenAction.WARM_CAPTURE_SANDBOX_OFFSCREEN:
        void warmCaptureSandbox()
          .then(() => sendResponse({ success: true }))
          .catch((error) => {
            logger.error('[Offscreen] Capture sandbox failed to initialize:', error);
            sendResponse({
              error:
                error instanceof Error ? error.message : 'Capture sandbox failed to initialize.',
              success: false,
            });
          });
        return true;
      default:
        return false;
    }
  },
);
