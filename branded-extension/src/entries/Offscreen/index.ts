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

async function extractMetadata(
  message: Extract<
    BackgroundToOffscreenMessageType,
    { action: typeof BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN }
  >,
): Promise<ExtractMetadataOffscreenResponse> {
  const { providerConfig, requests, sameOriginReplayOnly } = message.data;
  const context = getContextRequests(requests, providerConfig);
  const contextRequest = context.found || context.fallback;
  if (!contextRequest) {
    return {
      error: 'No matching metadata request captured. Re-authenticate and try again.',
      success: false,
    };
  }

  try {
    const payload = await resolveMetadataPayload(context, providerConfig, {
      sameOriginOnly: sameOriginReplayOnly,
    });
    const metadata = extractTransactionsFromPayload(payload, providerConfig);
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
      case BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN:
        void extractMetadata(message).then(sendResponse);
        return true;
      default:
        return false;
    }
  },
);
