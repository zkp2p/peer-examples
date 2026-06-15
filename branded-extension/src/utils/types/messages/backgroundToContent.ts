import type { MetadataMessagePayload } from './contentToPage';
import type { UserInputConfig } from '..';

export const BackgroundToContentAction = {
  SEND_METADATA_MESSAGES_RESPONSE: 'send_metadata_messages_response',
  START_METADATA_CLICK_GUIDE: 'start_metadata_click_guide',
  STOP_METADATA_CLICK_GUIDE: 'stop_metadata_click_guide',
} as const;

export type BackgroundToContentActionType =
  (typeof BackgroundToContentAction)[keyof typeof BackgroundToContentAction];

interface IBackgroundToContentMessages {
  [BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE]: {
    data: MetadataMessagePayload;
  };
  [BackgroundToContentAction.START_METADATA_CLICK_GUIDE]: {
    data: {
      userInput: UserInputConfig;
    };
  };
  [BackgroundToContentAction.STOP_METADATA_CLICK_GUIDE]: {
    data?: {};
  };
}

export type BackgroundToContentMessageType = {
  [K in keyof IBackgroundToContentMessages]: {
    action: K;
  } & IBackgroundToContentMessages[K];
}[keyof IBackgroundToContentMessages];
