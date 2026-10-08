import type { MetadataMessagePayload } from './contentToPage';
import type { UserInputConfig } from '..';
import type { CapturePageActionResponse, ResolvedCapturePageAction } from '../captureProgram';
import type { CaptureHighlight } from '../../captureHighlight';

export const BackgroundToContentAction = {
  WATCH_CAPTURE_LOGIN: 'watch_capture_login',
  CONNECTION_REVOKED: 'connection_revoked',
  EXECUTE_CAPTURE_PAGE_ACTION: 'execute_capture_page_action',
  SEND_METADATA_MESSAGES_RESPONSE: 'send_metadata_messages_response',
  START_METADATA_CLICK_GUIDE: 'start_metadata_click_guide',
  START_CAPTURE_HIGHLIGHT: 'start_capture_highlight',
  STOP_METADATA_CLICK_GUIDE: 'stop_metadata_click_guide',
} as const;

export type BackgroundToContentActionType =
  (typeof BackgroundToContentAction)[keyof typeof BackgroundToContentAction];

interface IBackgroundToContentMessages {
  [BackgroundToContentAction.WATCH_CAPTURE_LOGIN]: {
    data: { enabled: boolean };
  };
  [BackgroundToContentAction.CONNECTION_REVOKED]: {
    data: { origin: string };
  };
  [BackgroundToContentAction.EXECUTE_CAPTURE_PAGE_ACTION]: {
    data: {
      action: ResolvedCapturePageAction;
      expectedUrl: string;
    };
  };
  [BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE]: {
    data: MetadataMessagePayload;
  };
  [BackgroundToContentAction.START_METADATA_CLICK_GUIDE]: {
    data: {
      userInput: UserInputConfig;
    };
  };
  [BackgroundToContentAction.START_CAPTURE_HIGHLIGHT]: {
    data: { highlight: CaptureHighlight['highlight']; expectedUrl: string };
  };
  [BackgroundToContentAction.STOP_METADATA_CLICK_GUIDE]: {
    data?: {};
  };
}

export type ExecuteCapturePageActionResponse = CapturePageActionResponse;

export type BackgroundToContentMessageType = {
  [K in keyof IBackgroundToContentMessages]: {
    action: K;
  } & IBackgroundToContentMessages[K];
}[keyof IBackgroundToContentMessages];
