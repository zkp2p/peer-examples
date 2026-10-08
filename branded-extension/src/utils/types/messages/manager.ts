export const ManagerToBackgroundAction = {
  GET_MANAGER_STATE: 'get_extension_manager_state',
  REMOVE_CAPTURE_PLUGIN: 'remove_capture_plugin',
  REMOVE_CONNECTED_SITE: 'remove_connected_site',
} as const;

interface IManagerToBackgroundMessages {
  [ManagerToBackgroundAction.GET_MANAGER_STATE]: {};
  [ManagerToBackgroundAction.REMOVE_CAPTURE_PLUGIN]: {
    data: { id: string; sourceOrigin: string };
  };
  [ManagerToBackgroundAction.REMOVE_CONNECTED_SITE]: {
    data: { origin: string };
  };
}

export type ManagerToBackgroundMessageType = {
  [K in keyof IManagerToBackgroundMessages]: {
    action: K;
  } & IManagerToBackgroundMessages[K];
}[keyof IManagerToBackgroundMessages];
