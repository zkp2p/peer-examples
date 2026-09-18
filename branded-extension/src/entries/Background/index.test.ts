import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSpinner, startCountdownAndClose } from './authTabOverlay';
import { clearSarCredentialCapture } from './sarCredentialFlow';

type MetadataRequest = {
  initiator: string | null;
  method: string;
  requestHeaders: chrome.webRequest.HttpHeader[];
  requestId: string;
  tabId: number;
  type: chrome.webRequest.ResourceType;
  url: string;
};

type MetadataHandler = (request: MetadataRequest) => Promise<void> | void;

const extensionMocks = vi.hoisted(() => ({
  metadataHandler: null as MetadataHandler | null,
  runtimeSendMessage: vi.fn(),
  stageBuyerCapture: vi.fn(),
  stageSarCapture: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

vi.mock('@utils/extensionMessaging', () => ({
  safeChromeRuntimeSendMessage: extensionMocks.runtimeSendMessage,
  safeChromeTabsSendMessage: extensionMocks.tabsSendMessage,
}));
vi.mock('@utils/misc', () => ({ replayRequestInPage: vi.fn() }));
vi.mock('./authTabOverlay', () => ({
  injectSpinner: vi.fn(),
  startCountdownAndClose: vi.fn(),
  updateSpinnerToGreenAndStatic: vi.fn(),
}));
vi.mock('./buyerTeeFlow', () => ({
  clearBuyerTeeCapture: vi.fn(),
  rememberBuyerTeeCapture: vi.fn(),
  resolveBuyerTeeCaptureConfig: vi.fn(() => ({ config: null, error: null })),
  stageBuyerTeeCaptureForMetadata: extensionMocks.stageBuyerCapture,
}));
vi.mock('./cache', () => ({
  deleteCacheByTabId: vi.fn(),
  getRequestLogsByTabId: vi.fn(() => []),
}));
vi.mock('./handlers', () => ({
  clearInterceptPatterns: vi.fn(),
  clearShouldReplayRequestInPage: vi.fn(),
  onBeforeRequest: vi.fn(),
  onResponseStarted: vi.fn(),
  onSendHeaders: vi.fn(),
  setInterceptPatterns: vi.fn(),
  setMetadataRequestCapturedHandler: vi.fn((handler: MetadataHandler) => {
    extensionMocks.metadataHandler = handler;
  }),
  setShouldReplayRequestInPage: vi.fn(),
}));
vi.mock('./offscreenDocument', () => ({ ensureOffscreenDocument: vi.fn() }));
vi.mock('./providerRequestMatcher', () => ({
  isProviderContextRequest: vi.fn(() => true),
}));
vi.mock('./sarCredentialFlow', () => ({
  clearSarCredentialCapture: vi.fn(),
  rememberSarCredentialCapture: vi.fn(),
  resolveSarCredentialCaptureConfig: vi.fn(() => ({ config: null, error: null })),
  stageSarCredentialCaptureForMetadata: extensionMocks.stageSarCapture,
}));

const OPEN_NEW_TAB_BACKGROUND = 'open_new_tab_background';
const SEND_METADATA_MESSAGES_RESPONSE = 'send_metadata_messages_response';
const EXTRACT_METADATA_OFFSCREEN = 'extract_metadata_offscreen';

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

type TabRemovedListener = (tabId: number) => void;

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('Background capture session cancellation', () => {
  let runtimeMessageListener: RuntimeMessageListener;
  let tabRemovedListener: TabRemovedListener;

  const openCaptureSession = async (captureAttemptId = 'attempt-1', usePageSuppliedConfig = true) => {
    const sendResponse = vi.fn();

    runtimeMessageListener(
      {
        action: OPEN_NEW_TAB_BACKGROUND,
        data: {
          actionType: 'transfer_venmo',
          captureAttemptId,
          captureMode: 'sellerCredential',
          platform: 'venmo',
          ...(usePageSuppliedConfig
            ? {
                providerConfig: {
                  authLink: 'https://venmo.example/login',
                  metadata: {
                    platform: 'venmo',
                    urlRegex: 'transactions',
                  },
                },
              }
            : {}),
        },
      },
      { tab: { id: 11 } } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  };

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    extensionMocks.metadataHandler = null;
    extensionMocks.runtimeSendMessage.mockResolvedValue(undefined);
    extensionMocks.stageBuyerCapture.mockResolvedValue({
      capture: null,
      errorMessage: null,
      metadata: undefined,
    });
    extensionMocks.stageSarCapture.mockResolvedValue({
      capture: null,
      errorMessage: null,
    });
    extensionMocks.tabsSendMessage.mockResolvedValue(undefined);

    vi.stubGlobal('chrome', {
      action: {
        onClicked: { addListener: vi.fn() },
      },
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://extension-id/${path}`),
        lastError: undefined,
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            runtimeMessageListener = listener;
          }),
        },
      },
      tabs: {
        create: vi.fn().mockResolvedValue({ id: 22 }),
        onRemoved: {
          addListener: vi.fn((listener: TabRemovedListener) => {
            tabRemovedListener = listener;
          }),
        },
        onUpdated: { addListener: vi.fn() },
        query: vi.fn().mockResolvedValue([]),
      },
      webRequest: {
        onBeforeRequest: { addListener: vi.fn() },
        onResponseStarted: { addListener: vi.fn() },
        onSendHeaders: { addListener: vi.fn() },
      },
    });

    await import('./index');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('notifies the matching attempt when the provider tab is closed', async () => {
    await openCaptureSession();

    tabRemovedListener(22);

    expect(extensionMocks.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: SEND_METADATA_MESSAGES_RESPONSE,
      data: {
        requestId: '',
        platform: 'venmo',
        metadata: [],
        expiresAt: expect.any(Number),
        captureAttemptId: 'attempt-1',
        errorMessage: 'Provider authentication was cancelled.',
      },
    });
  });

  it.each([
    { expected: true, label: 'page-supplied', usePageSuppliedConfig: true },
    { expected: false, label: 'managed template', usePageSuppliedConfig: false },
  ])('constrains replay to the captured origin for $label configs', async ({
    expected,
    usePageSuppliedConfig,
  }) => {
    extensionMocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      requestId: 'request-1',
      metadata: [],
    });
    if (!usePageSuppliedConfig) {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              authLink: 'https://venmo.example/login',
              metadata: { platform: 'venmo', urlRegex: 'transactions' },
            }),
            { status: 200 },
          ),
        ),
      );
    }
    await openCaptureSession('attempt-1', usePageSuppliedConfig);

    await extensionMocks.metadataHandler?.({
      initiator: 'https://venmo.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://venmo.example/transactions',
    });

    const extractCall = extensionMocks.runtimeSendMessage.mock.calls.find(
      ([message]) => (message as { action?: string }).action === EXTRACT_METADATA_OFFSCREEN,
    );
    expect(extractCall?.[0]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ sameOriginReplayOnly: expected }),
      }),
    );
  });

  it('does not post a staged response after the provider tab is closed', async () => {
    const deferredSarCapture = createDeferred<{
      capture: null;
      errorMessage: null;
    }>();
    extensionMocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      requestId: 'request-1',
      metadata: [],
    });
    extensionMocks.stageSarCapture.mockReturnValue(deferredSarCapture.promise);
    await openCaptureSession();

    const extractionPromise = Promise.resolve(
      extensionMocks.metadataHandler?.({
        initiator: 'https://venmo.example',
        method: 'GET',
        requestHeaders: [],
        requestId: 'request-1',
        tabId: 22,
        type: 'xmlhttprequest',
        url: 'https://venmo.example/transactions',
      }),
    );
    await vi.waitFor(() => {
      expect(extensionMocks.stageSarCapture).toHaveBeenCalled();
    });

    tabRemovedListener(22);
    deferredSarCapture.resolve({ capture: null, errorMessage: null });
    await extractionPromise;

    const originalTabResponses = extensionMocks.tabsSendMessage.mock.calls.filter(
      ([tabId, message]) =>
        tabId === 11 && (message as { action?: string }).action === SEND_METADATA_MESSAGES_RESPONSE,
    );
    expect(originalTabResponses).toHaveLength(1);
    expect(originalTabResponses[0]?.[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          captureAttemptId: 'attempt-1',
          errorMessage: 'Provider authentication was cancelled.',
        }),
      }),
    );
  });
  it.each([
    { kind: 'seller', error: 'Seller credential creation failed.' },
    { kind: 'buyer', error: 'Buyer encryption failed.' },
    { kind: 'metadata', error: 'No transactions could be extracted.' },
    { kind: 'worker', error: 'Metadata extraction failed.' },
  ])('reports $kind failure without starting the success countdown', async ({ kind, error }) => {
    extensionMocks.runtimeSendMessage.mockResolvedValue(
      kind === 'worker'
        ? { success: false, requestId: 'request-1', error }
        : {
            success: true,
            requestId: 'request-1',
            metadata: [],
            ...(kind === 'metadata' ? { errorMessage: error } : {}),
          },
    );
    if (kind === 'seller') {
      extensionMocks.stageSarCapture.mockResolvedValue({ capture: null, errorMessage: error });
    }
    if (kind === 'buyer') {
      extensionMocks.stageBuyerCapture.mockResolvedValue({ capture: null, errorMessage: error });
    }
    await openCaptureSession();
    const request: MetadataRequest = {
      initiator: 'https://venmo.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://venmo.example/transactions',
    };
    await extensionMocks.metadataHandler?.(request);
    await vi.advanceTimersByTimeAsync(2000);

    expect(extensionMocks.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: SEND_METADATA_MESSAGES_RESPONSE,
      data: expect.objectContaining({ errorMessage: error, captureAttemptId: 'attempt-1' }),
    });
    expect(injectSpinner).not.toHaveBeenCalled();
    expect(startCountdownAndClose).not.toHaveBeenCalled();
    expect(clearSarCredentialCapture).toHaveBeenCalledWith(22);

    // The failed attempt is terminal; repeated requests and tab closure cannot resend it.
    await extensionMocks.metadataHandler?.(request);
    tabRemovedListener(22);
    const responses = extensionMocks.tabsSendMessage.mock.calls.filter(
      ([, message]) => message.action === SEND_METADATA_MESSAGES_RESPONSE,
    );
    expect(responses).toHaveLength(1);
  });

  it.each([null, 'Buyer encryption failed.'])(
    'ignores metadata-only errors after seller capture while preserving buyer errors (%s)',
    async (buyerError) => {
      const capture = {
        offchainId: 'seller-example',
        credentialBundle: { platform: 'venmo', encryptedBlob: 'test-sealed-bundle' },
      };
      extensionMocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        requestId: 'request-1',
        metadata: [{ ignored: 'metadata must stay suppressed' }],
        errorMessage: 'No transactions could be extracted.',
      });
      extensionMocks.stageSarCapture.mockResolvedValue({ capture, errorMessage: null });
      extensionMocks.stageBuyerCapture.mockResolvedValue({ capture: null, errorMessage: buyerError });
      await openCaptureSession();
      await extensionMocks.metadataHandler?.({
        initiator: 'https://venmo.example',
        method: 'GET',
        requestHeaders: [],
        requestId: 'request-1',
        tabId: 22,
        type: 'xmlhttprequest',
        url: 'https://venmo.example/transactions',
      });
      await vi.advanceTimersByTimeAsync(2000);

      expect(extensionMocks.tabsSendMessage).toHaveBeenCalledWith(11, {
        action: SEND_METADATA_MESSAGES_RESPONSE,
        data: expect.objectContaining({
          errorMessage: buyerError ?? undefined,
          metadata: [],
          sarCredentialCapture: capture,
          requiresMetadataApproval: true,
        }),
      });
      expect(injectSpinner).toHaveBeenCalledTimes(buyerError ? 0 : 1);
      expect(startCountdownAndClose).toHaveBeenCalledTimes(buyerError ? 0 : 1);
      expect(clearSarCredentialCapture).toHaveBeenCalledWith(22);
    },
  );

});
