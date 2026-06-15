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
import { encryptPreparedBuyerTeeSessionMaterial } from './buyerTeeSessionMaterialEncryption';
import { createSarCredentialBundle } from './sarCredentialBundle';

async function extractMetadata(
  message: Extract<
    BackgroundToOffscreenMessageType,
    { action: typeof BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN }
  >,
): Promise<ExtractMetadataOffscreenResponse> {
  const { providerConfig, requests } = message.data;
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
    const metadata = extractTransactionsFromPayload(payload, providerConfig);
    return {
      errorMessage:
        metadata.length > 0
          ? undefined
          : 'No transactions could be extracted for this page. Open your transaction history or statement view, then retry.',
      metadata,
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
      case BackgroundToOffscreenAction.ENCRYPT_BUYER_TEE_SESSION_MATERIAL_OFFSCREEN:
        void encryptPreparedBuyerTeeSessionMaterial(message.data)
          .then((encryptedSessionMaterial) =>
            sendResponse({ encryptedSessionMaterial, success: true }),
          )
          .catch((error) => {
            logger.error('[Offscreen] Buyer TEE session encryption failed:', error);
            sendResponse({
              error:
                error instanceof Error ? error.message : 'Buyer TEE session encryption failed.',
              success: false,
            });
          });
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
      default:
        return false;
    }
  },
);
