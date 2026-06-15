import { BRAND } from '@config/brand';
import type { MetadataMessagePayload } from '@utils/types/messages/contentToPage';
import type { OpenNewTabPagePayload } from '@utils/types/messages/pageToContent';

type PeerLogger = {
  error(message: string, error?: unknown): void;
  debug(message: string, data?: unknown): void;
  enable(): void;
  disable(): void;
  enabled: boolean;
};

type IMetadataMessage = MetadataMessagePayload;
type IMetadataMessageEventData = IMetadataMessage & { type: string };

interface IPeer {
  requestConnection(): Promise<boolean>;
  checkConnectionStatus(): Promise<'connected' | 'disconnected' | 'pending'>;
  getVersion(): Promise<string>;
  authenticate(params: OpenNewTabPagePayload): void;
  onMetadataMessage(callback: (data: IMetadataMessage) => void): () => void;
  logger: PeerLogger;
}

(() => {
  const logger: PeerLogger = {
    enabled: false,
    enable() {
      this.enabled = true;
    },
    disable() {
      this.enabled = false;
    },
    debug(message: string, data?: unknown) {
      if (this.enabled) {
        console.log(`[peer:debug] ${message}`, data || '');
      }
    },
    error(message: string, error?: unknown) {
      if (this.enabled) {
        console.error(`[peer:error] ${message}`, error || '');
      }
    },
  };

  const PageToContentAction = {
    CHECK_CONNECTION_STATUS: 'check_connection_status',
    FETCH_EXTENSION_VERSION: 'fetch_extension_version',
    OPEN_NEW_TAB: 'open_new_tab',
    REQUEST_PEER_CONNECTION: 'request_peer_connection',
  } as const;

  const ContentToPageAction = {
    CONNECTION_APPROVAL_RESPONSE: 'connection_approval_response',
    CONNECTION_STATUS_RESPONSE: 'connection_status_response',
    EXTENSION_VERSION_RESPONSE: 'extension_version_response',
    METADATA_MESSAGES_RESPONSE: 'metadata_messages_response',
  } as const;

  const sendMessage = (message: unknown): void => {
    try {
      window.postMessage(message, '*');
    } catch (error) {
      logger.error('postMessage failed', error);
    }
  };

  const sendMessageWithResponse = <T = unknown>(
    message: unknown,
    responseType: string,
    timeout = 30000,
    matches?: (data: any) => boolean,
  ): Promise<T> => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error(`Timeout waiting for ${responseType}`));
      }, timeout);

      const handler = (event: MessageEvent): void => {
        if (event.source !== window) return;

        if ((event.data as any).type === responseType && (!matches || matches(event.data))) {
          clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve(event.data as T);
        }
      };

      window.addEventListener('message', handler);
      sendMessage(message);
    });
  };

  const metadataListeners: Set<(data: IMetadataMessage) => void> = new Set();

  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;

    const eventData = event.data as IMetadataMessageEventData;
    if (eventData.type !== ContentToPageAction.METADATA_MESSAGES_RESPONSE) {
      return;
    }

    const metadataData: IMetadataMessage = {
      requestId: eventData.requestId,
      metadata: eventData.metadata,
      platform: eventData.platform,
      expiresAt: eventData.expiresAt,
      errorMessage: eventData.errorMessage,
      buyerTeeCapture: eventData.buyerTeeCapture,
      sarCredentialCapture: eventData.sarCredentialCapture,
    };

    metadataListeners.forEach((callback) => {
      try {
        callback(metadataData);
      } catch (error) {
        logger.error('Error in metadata message listener', error);
      }
    });
  });

  const peer: IPeer = {
    logger,

    async requestConnection(): Promise<boolean> {
      const response = await sendMessageWithResponse<{ approved: boolean }>(
        {
          type: PageToContentAction.REQUEST_PEER_CONNECTION,
          origin: window.location.origin,
          hostname: window.location.hostname,
        },
        ContentToPageAction.CONNECTION_APPROVAL_RESPONSE,
      );

      return response.approved;
    },

    async checkConnectionStatus(): Promise<'connected' | 'disconnected' | 'pending'> {
      const response = await sendMessageWithResponse<{
        status: 'connected' | 'disconnected' | 'pending';
      }>(
        {
          type: PageToContentAction.CHECK_CONNECTION_STATUS,
          origin: window.location.origin,
        },
        ContentToPageAction.CONNECTION_STATUS_RESPONSE,
      );

      return response.status;
    },

    async getVersion(): Promise<string> {
      const response = await sendMessageWithResponse<{ version: string }>(
        {
          type: PageToContentAction.FETCH_EXTENSION_VERSION,
        },
        ContentToPageAction.EXTENSION_VERSION_RESPONSE,
      );

      return response.version;
    },

    authenticate(params: OpenNewTabPagePayload): void {
      logger.debug('authenticate called', params);
      sendMessage({
        type: PageToContentAction.OPEN_NEW_TAB,
        ...params,
      });
    },

    onMetadataMessage(callback: (data: IMetadataMessage) => void): () => void {
      logger.debug('onMetadataMessage listener registered');
      metadataListeners.add(callback);

      return () => {
        metadataListeners.delete(callback);
        logger.debug('onMetadataMessage listener unregistered');
      };
    },
  };

  // Coexistence policy: defer-if-present. window.peer is a shared protocol
  // global (like window.ethereum). If another extension already defined it,
  // yield — both implement the same protocol, so the page works either way.
  if (!window.hasOwnProperty('peer')) {
    Object.defineProperty(window, 'peer', {
      value: peer,
      writable: false,
      configurable: false,
    });

    // Vendor marker so host pages can attribute which window.peer implementation
    // served a session (useful as an analytics dimension).
    document.documentElement.setAttribute('data-peer-vendor', BRAND.vendorId);

    window.dispatchEvent(new Event('peer#initialized'));
    logger.debug('peer initialized and ready');
  } else {
    console.debug(
      `[${BRAND.vendorId}] window.peer already provided by another extension; deferring.`,
    );
  }

  document.documentElement.setAttribute('data-peer-injected', 'true');
})();
