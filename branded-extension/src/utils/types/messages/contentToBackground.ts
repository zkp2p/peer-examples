import type { OpenNewTabPagePayload } from './pageToContent';

export const ContentToBackgroundAction = {
  CAPTURE_LOGIN_REQUIRED: 'capture_login_required',
  CHECK_CONNECTION_BACKGROUND: 'check_connection_background',
  OPEN_NEW_TAB_BACKGROUND: 'open_new_tab_background',
  REQUEST_APPROVAL_BACKGROUND: 'request_approval_background',
} as const;

export type ContentToBackgroundActionType =
  (typeof ContentToBackgroundAction)[keyof typeof ContentToBackgroundAction];

interface IContentToBackgroundMessages {
  [ContentToBackgroundAction.CAPTURE_LOGIN_REQUIRED]: {};
  [ContentToBackgroundAction.CHECK_CONNECTION_BACKGROUND]: {};
  [ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND]: {
    data: OpenNewTabPagePayload;
  };
  [ContentToBackgroundAction.REQUEST_APPROVAL_BACKGROUND]: {
    data: {
      kind: 'connection';
    };
  };
}

export type ContentToBackgroundMessageType = {
  [K in keyof IContentToBackgroundMessages]: {
    action: K;
  } & IContentToBackgroundMessages[K];
}[keyof IContentToBackgroundMessages];
