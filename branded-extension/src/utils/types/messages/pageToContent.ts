import type { MetadataCaptureMode } from '@utils/metadataCaptureMode';
import type { CaptureParams } from '@utils/types/captureProgram';
import type { PeerCapturePlugin, PeerInitialAction } from '@utils/types/captureProgram';

export const PageToContentAction = {
  FETCH_EXTENSION_VERSION: 'fetch_extension_version',
  OPEN_NEW_TAB: 'open_new_tab',
  REQUEST_PEER_CONNECTION: 'request_peer_connection',
  CHECK_CONNECTION_STATUS: 'check_connection_status',
} as const;

export type PageToContentActionType =
  (typeof PageToContentAction)[keyof typeof PageToContentAction];

export type OpenNewTabPagePayload = {
  actionType: string;
  attestationActionType?: string | null;
  attestationPlatform?: string | null;
  attestationServiceUrl?: string | null;
  callerAddress?: string | null;
  captureAttemptId?: string;
  captureMode?: MetadataCaptureMode;
  captureParams?: CaptureParams;
  capturePlugin?: PeerCapturePlugin;
  initialAction?: PeerInitialAction;
  platform: string;
};

interface IPageToContentMessages {
  [PageToContentAction.FETCH_EXTENSION_VERSION]: {};
  [PageToContentAction.OPEN_NEW_TAB]: OpenNewTabPagePayload;
  [PageToContentAction.REQUEST_PEER_CONNECTION]: {};
  [PageToContentAction.CHECK_CONNECTION_STATUS]: {};
}

export type PageToContentMessageType = {
  [K in keyof IPageToContentMessages]: {
    type: K;
  } & IPageToContentMessages[K];
}[keyof IPageToContentMessages];
