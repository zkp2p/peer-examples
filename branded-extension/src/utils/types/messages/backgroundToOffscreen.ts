import type { RequestLog } from '@entries/Background/requestLog';
import type { SellerCredentialUploadPayload } from '@utils/sarCredentialBundle';
import type { MetadataMessageType, ProviderSettings } from '@utils/types';

export const BackgroundToOffscreenAction = {
  CREATE_SAR_CREDENTIAL_BUNDLE_OFFSCREEN: 'create_sar_credential_bundle_offscreen',
  EXTRACT_METADATA_OFFSCREEN: 'extract_metadata_offscreen',
} as const;

export type BackgroundToOffscreenActionType =
  (typeof BackgroundToOffscreenAction)[keyof typeof BackgroundToOffscreenAction];

export type ExtractMetadataOffscreenResponse =
  | {
      errorMessage?: string;
      metadata: MetadataMessageType[];
      request: RequestLog;
      requestId: string;
      success: true;
    }
  | {
      error: string;
      requestId?: string;
      success: false;
    };

interface IBackgroundToOffscreenMessages {
  [BackgroundToOffscreenAction.CREATE_SAR_CREDENTIAL_BUNDLE_OFFSCREEN]: {
    data: {
      attestationServiceUrl: string;
      payload: SellerCredentialUploadPayload;
      timeoutMs?: number | null;
    };
  };
  [BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN]: {
    data: {
      providerConfig: ProviderSettings;
      requests: RequestLog[];
    };
  };
}

export type BackgroundToOffscreenMessageType = {
  [K in keyof IBackgroundToOffscreenMessages]: {
    action: K;
  } & IBackgroundToOffscreenMessages[K];
}[keyof IBackgroundToOffscreenMessages];
