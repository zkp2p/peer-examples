import type { RequestLog } from '@entries/Background/requestLog';
import type { MetadataMessageType, ProviderSettings } from '@utils/types';

export const BackgroundToOffscreenAction = {
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
  [BackgroundToOffscreenAction.EXTRACT_METADATA_OFFSCREEN]: {
    data: {
      providerConfig: ProviderSettings;
      sameOriginReplayOnly: boolean;
      requests: RequestLog[];
    };
  };
}

export type BackgroundToOffscreenMessageType = {
  [K in keyof IBackgroundToOffscreenMessages]: {
    action: K;
  } & IBackgroundToOffscreenMessages[K];
}[keyof IBackgroundToOffscreenMessages];
