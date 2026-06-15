import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import type {
  BuyerTeeSessionMaterialEncryptionPayload,
  BuyerTeeSessionMaterialEncryptionResponse,
} from '@utils/buyerTeePaymentCapture';
import { BackgroundToOffscreenAction } from '@utils/types/messages';

type EnsureOffscreenDocument = () => Promise<void>;

export async function encryptBuyerTeeSessionMaterialInOffscreen({
  ensureOffscreenDocument,
  payload,
}: {
  ensureOffscreenDocument: EnsureOffscreenDocument;
  payload: BuyerTeeSessionMaterialEncryptionPayload;
}): Promise<
  Extract<BuyerTeeSessionMaterialEncryptionResponse, { success: true }>['encryptedSessionMaterial']
> {
  await ensureOffscreenDocument();

  const response = await safeChromeRuntimeSendMessage<BuyerTeeSessionMaterialEncryptionResponse>({
    action: BackgroundToOffscreenAction.ENCRYPT_BUYER_TEE_SESSION_MATERIAL_OFFSCREEN,
    data: {
      payload,
    },
  });

  if (!response) {
    throw new Error('Buyer TEE session encryption did not return a response.');
  }

  if (!response.success) {
    throw new Error(response.error || 'Buyer TEE session encryption failed.');
  }

  return response.encryptedSessionMaterial;
}
