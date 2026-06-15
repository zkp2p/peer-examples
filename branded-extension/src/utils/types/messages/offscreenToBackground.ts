import type { RequestLog } from '@entries/Background/requestLog';

export const OffscreenToBackgroundAction = {
  REPLAY_REQUEST_BACKGROUND: 'replay_request_background',
} as const;

export type OffscreenToBackgroundActionType =
  (typeof OffscreenToBackgroundAction)[keyof typeof OffscreenToBackgroundAction];

interface IOffscreenToBackgroundMessages {
  [OffscreenToBackgroundAction.REPLAY_REQUEST_BACKGROUND]: {
    data: { request: RequestLog };
  };
}

export type OffscreenToBackgroundMessageType = {
  [K in keyof IOffscreenToBackgroundMessages]: {
    action: K;
  } & IOffscreenToBackgroundMessages[K];
}[keyof IOffscreenToBackgroundMessages];
