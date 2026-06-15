import { logger } from '@utils/logger';

const getMessageContext = (message: unknown, context?: string): string | undefined => {
  if (context) return context;
  if (message && typeof message === 'object' && 'action' in message) {
    const action = (message as { action?: unknown }).action;
    if (typeof action === 'string') return action;
  }
  return undefined;
};

const formatPrefix = (label: string, message: unknown, context?: string): string => {
  const resolved = getMessageContext(message, context);
  return resolved ? `[${resolved}] ${label}` : label;
};

const isClosedMessagePortError = (message?: string): boolean => {
  return message === 'The message port closed before a response was received.';
};

export const safeChromeRuntimeSendMessage = <TResponse = void>(
  message: unknown,
  context?: string,
): Promise<TResponse | undefined> =>
  new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message as any, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          logger.warn(
            formatPrefix(
              `chrome.runtime.sendMessage failed: ${lastError.message}`,
              message,
              context,
            ),
          );
          resolve(undefined);
          return;
        }
        resolve(response as TResponse);
      });
    } catch (error) {
      logger.warn(formatPrefix('chrome.runtime.sendMessage threw', message, context), error);
      resolve(undefined);
    }
  });

export const safeChromeTabsSendMessage = <TResponse = void>(
  tabId: number,
  message: unknown,
  context?: string,
): Promise<TResponse | undefined> =>
  new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message as any, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          if (isClosedMessagePortError(lastError.message)) {
            resolve(undefined);
            return;
          }
          logger.warn(
            formatPrefix(
              `chrome.tabs.sendMessage failed for tab ${tabId}: ${lastError.message}`,
              message,
              context,
            ),
          );
          resolve(undefined);
          return;
        }
        resolve(response as TResponse);
      });
    } catch (error) {
      logger.warn(formatPrefix('chrome.tabs.sendMessage threw', message, context), error);
      resolve(undefined);
    }
  });
