import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import type {
  SarCredentialBundleOffscreenResponse,
  SellerCredentialUploadPayload,
} from '@utils/sarCredentialBundle';
import { BackgroundToOffscreenAction } from '@utils/types/messages';
import type { SellerCredentialBundle } from '@zkp2p/sdk';

type EnsureOffscreenDocument = () => Promise<void>;

export async function createSarCredentialBundleInOffscreen({
  attestationServiceUrl,
  ensureOffscreenDocument,
  payload,
  timeoutMs,
}: {
  attestationServiceUrl: string;
  ensureOffscreenDocument: EnsureOffscreenDocument;
  payload: SellerCredentialUploadPayload;
  timeoutMs?: number | null;
}): Promise<SellerCredentialBundle> {
  await ensureOffscreenDocument();

  const response = await safeChromeRuntimeSendMessage<SarCredentialBundleOffscreenResponse>({
    action: BackgroundToOffscreenAction.CREATE_SAR_CREDENTIAL_BUNDLE_OFFSCREEN,
    data: {
      attestationServiceUrl,
      payload,
      timeoutMs,
    },
  });

  if (!response) {
    throw new Error('Seller credential bundle worker did not respond.');
  }

  if (!response.success) {
    throw new Error(response.error || 'SAR credential bundle creation failed.');
  }

  return response.bundle;
}
