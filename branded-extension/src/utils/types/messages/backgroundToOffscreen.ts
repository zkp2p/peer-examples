import type { RequestLog } from '@entries/Background/requestLog';
import type { CaptureMatchResult } from '../captureProgram';
import type { SellerCredentialUploadPayload } from '@utils/sarCredentialBundle';
import type {
  CaptureNetworkEvent,
  CaptureParams,
  CapturePageAction,
  CaptureProgramResult,
  MetadataMessageType,
  ProviderSettings,
} from '@utils/types';

export const BackgroundToOffscreenAction = {
  CREATE_SAR_CREDENTIAL_BUNDLE_OFFSCREEN: 'create_sar_credential_bundle_offscreen',
  EXECUTE_CAPTURE_INTERACTION_OFFSCREEN: 'execute_capture_interaction_offscreen',
  EXECUTE_CAPTURE_PROGRAM_OFFSCREEN: 'execute_capture_program_offscreen',
  MATCH_CAPTURE_REQUEST_OFFSCREEN: 'match_capture_request_offscreen',
  EXTRACT_METADATA_OFFSCREEN: 'extract_metadata_offscreen',
  WARM_CAPTURE_SANDBOX_OFFSCREEN: 'warm_capture_sandbox_offscreen',
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

export type ExecuteCaptureProgramOffscreenResponse =
  | { result: CaptureProgramResult; success: true }
  | { error: string; success: false };

export type MatchCaptureRequestOffscreenResponse =
  | { result: CaptureMatchResult; success: true }
  | { error: string; success: false };

export type ExecuteCaptureInteractionOffscreenResponse =
  | { actions: CapturePageAction[]; success: true }
  | { error: string; success: false };

export type WarmCaptureSandboxOffscreenResponse =
  | { success: true }
  | { error: string; success: false };

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
      includeBuyerTeeParams: boolean;
      providerConfig: ProviderSettings;
      requests: RequestLog[];
    };
  };
  [BackgroundToOffscreenAction.EXECUTE_CAPTURE_PROGRAM_OFFSCREEN]: {
    data: {
      event: CaptureNetworkEvent;
      params: CaptureParams;
      source: string;
    };
  };
  [BackgroundToOffscreenAction.MATCH_CAPTURE_REQUEST_OFFSCREEN]: {
    data: {
      origins: string[];
      request: CaptureNetworkEvent['request'];
      params: CaptureParams;
      source: string;
    };
  };
  [BackgroundToOffscreenAction.EXECUTE_CAPTURE_INTERACTION_OFFSCREEN]: {
    data: {
      inputs: string[];
      source: string;
      url: string;
    };
  };
  [BackgroundToOffscreenAction.WARM_CAPTURE_SANDBOX_OFFSCREEN]: {
    data: Record<string, never>;
  };
}

export type BackgroundToOffscreenMessageType = {
  [K in keyof IBackgroundToOffscreenMessages]: {
    action: K;
  } & IBackgroundToOffscreenMessages[K];
}[keyof IBackgroundToOffscreenMessages];
