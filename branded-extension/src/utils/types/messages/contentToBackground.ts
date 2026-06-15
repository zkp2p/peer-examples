import type { OpenNewTabPagePayload } from './pageToContent';

export const ContentToBackgroundAction = {
  OPEN_NEW_TAB_BACKGROUND: 'open_new_tab_background',
} as const;

export type ContentToBackgroundActionType =
  (typeof ContentToBackgroundAction)[keyof typeof ContentToBackgroundAction];

interface IContentToBackgroundMessages {
  [ContentToBackgroundAction.OPEN_NEW_TAB_BACKGROUND]: {
    data: OpenNewTabPagePayload;
  };
}

export type ContentToBackgroundMessageType = {
  [K in keyof IContentToBackgroundMessages]: {
    action: K;
  } & IContentToBackgroundMessages[K];
}[keyof IContentToBackgroundMessages];
