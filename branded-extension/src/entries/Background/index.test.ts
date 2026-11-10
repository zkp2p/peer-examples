import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSpinner, startCountdownAndClose } from './authTabOverlay';
import { clearBuyerTeeCapture } from './buyerTeeFlow';

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
          actionType: 'transfer_cashapp',
          captureAttemptId,
          captureMode: 'buyerTee',
          platform: 'cashapp',
          ...(usePageSuppliedConfig
            ? {
                providerConfig: {
                  authLink: 'https://cashapp.example/login',
                  metadata: {
                    platform: 'cashapp',
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
        create: vi.fn().mockResolvedValue({ id: 22, incognito: false }),
        update: vi.fn().mockResolvedValue({ id: 22 }),
        remove: vi.fn().mockResolvedValue(undefined),
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

  it.each(['cashapp', 'venmo', 'paypal', 'upi', 'wise'])(
    'rejects %s seller capture without opening a tab or staging credentials',
    async (platform) => {
      const sendResponse = vi.fn();
      runtimeMessageListener({
        action: OPEN_NEW_TAB_BACKGROUND,
        data: {
          captureMode: 'sellerCredential',
          platform,
          providerConfig: {
            authLink: 'https://provider.example/login',
            metadata: { platform, urlRegex: 'transactions' },
          },
        },
      }, { tab: { id: 11 } } as chrome.runtime.MessageSender, sendResponse);

      await vi.waitFor(() => {
        expect(sendResponse).toHaveBeenCalledWith({
          success: false,
          error: 'Seller credential capture requires a capture-program runtime; this extension supports JSON templates only.',
        });
      });
      expect(chrome.tabs.create).not.toHaveBeenCalled();
      expect(chrome.tabs.query).not.toHaveBeenCalled();
      expect(extensionMocks.runtimeSendMessage).not.toHaveBeenCalled();
    },
  );

  it('notifies the matching attempt when the provider tab is closed', async () => {
    await openCaptureSession();

    tabRemovedListener(22);

    expect(extensionMocks.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: SEND_METADATA_MESSAGES_RESPONSE,
      data: {
        requestId: '',
        platform: 'cashapp',
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
              authLink: 'https://cashapp.example/login',
              metadata: { platform: 'cashapp', urlRegex: 'transactions' },
            }),
            { status: 200 },
          ),
        ),
      );
    }
    await openCaptureSession('attempt-1', usePageSuppliedConfig);

    await extensionMocks.metadataHandler?.({
      initiator: 'https://cashapp.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://cashapp.example/transactions',
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
    const deferredBuyerCapture = createDeferred<{
      capture: null;
      errorMessage: null;
    }>();
    extensionMocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      requestId: 'request-1',
      metadata: [],
    });
    extensionMocks.stageBuyerCapture.mockReturnValue(deferredBuyerCapture.promise);
    await openCaptureSession();

    const extractionPromise = Promise.resolve(
      extensionMocks.metadataHandler?.({
        initiator: 'https://cashapp.example',
        method: 'GET',
        requestHeaders: [],
        requestId: 'request-1',
        tabId: 22,
        type: 'xmlhttprequest',
        url: 'https://cashapp.example/transactions',
      }),
    );
    await vi.waitFor(() => {
      expect(extensionMocks.stageBuyerCapture).toHaveBeenCalled();
    });

    tabRemovedListener(22);
    deferredBuyerCapture.resolve({ capture: null, errorMessage: null });
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
    if (kind === 'buyer') {
      extensionMocks.stageBuyerCapture.mockResolvedValue({ capture: null, errorMessage: error });
    }
    await openCaptureSession();
    const request: MetadataRequest = {
      initiator: 'https://cashapp.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://cashapp.example/transactions',
    };
    await extensionMocks.metadataHandler?.(request);
    await vi.advanceTimersByTimeAsync(2000);

    expect(extensionMocks.tabsSendMessage).toHaveBeenCalledWith(11, {
      action: SEND_METADATA_MESSAGES_RESPONSE,
      data: expect.objectContaining({ errorMessage: error, captureAttemptId: 'attempt-1' }),
    });
    expect(injectSpinner).not.toHaveBeenCalled();
    expect(startCountdownAndClose).not.toHaveBeenCalled();
    expect(clearBuyerTeeCapture).toHaveBeenCalledWith(22);

    // The failed attempt is terminal; repeated requests and tab closure cannot resend it.
    await extensionMocks.metadataHandler?.(request);
    tabRemovedListener(22);
    const responses = extensionMocks.tabsSendMessage.mock.calls.filter(
      ([, message]) => message.action === SEND_METADATA_MESSAGES_RESPONSE,
    );
    expect(responses).toHaveLength(1);
  });

  it('rejects seller capture before fetching a template', async () => {
    const fetchTemplate = vi.fn();
    vi.stubGlobal('fetch', fetchTemplate);
    const sendResponse = vi.fn();
    runtimeMessageListener({
      action: OPEN_NEW_TAB_BACKGROUND,
      data: { captureMode: 'sellerCredential', platform: 'cashapp' },
    }, { tab: { id: 11 } } as chrome.runtime.MessageSender, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({
      success: false,
      error: 'Seller credential capture requires a capture-program runtime; this extension supports JSON templates only.',
    }));
    expect(fetchTemplate).not.toHaveBeenCalled();
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });

  const completeSignIn = () => {
    const observe = vi.mocked(chrome.webRequest.onBeforeRequest.addListener).mock.calls[0][0];
    const update = vi.mocked(chrome.tabs.onUpdated.addListener).mock.calls[0][0];
    const navigation = (tabId: number, url: string) => observe({
      type: 'main_frame', frameId: 0, tabId, url,
    } as chrome.webRequest.WebRequestBodyDetails);
    navigation(22, 'https://login.example/authorize?response_type=code&state=attempt&redirect_uri=https%3A%2F%2Fcashapp.example%2Fcallback');
    navigation(33, 'https://cashapp.example/callback?state=attempt&code=unused');
    update(33, { url: 'https://cashapp.example/home' }, { incognito: false } as chrome.tabs.Tab);
  };

  it('arms recovery before navigation and resumes the same capture tab after cross-tab sign-in', async () => {
    await openCaptureSession();
    expect(chrome.tabs.create).toHaveBeenCalledWith({ active: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(22, { url: 'https://cashapp.example/login' });
    vi.mocked(chrome.tabs.update).mockClear();
    completeSignIn();
    expect(chrome.tabs.update).toHaveBeenCalledExactlyOnceWith(22, { url: 'https://cashapp.example/login' });
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);
  });

  it('does not resume a cancelled capture', async () => {
    await openCaptureSession();
    tabRemovedListener(22);
    vi.mocked(chrome.tabs.update).mockClear();
    completeSignIn();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });

  it('cleans up a capture when initial navigation fails', async () => {
    vi.mocked(chrome.tabs.update).mockRejectedValueOnce(new Error('Navigation failed.'));
    const sendResponse = vi.fn();
    runtimeMessageListener({
      action: OPEN_NEW_TAB_BACKGROUND,
      data: {
        platform: 'cashapp',
        providerConfig: { authLink: 'https://cashapp.example/login', url: 'https://cashapp.example/transactions', metadata: { platform: 'cashapp', urlRegex: 'transactions' } },
      },
    }, { tab: { id: 11 } } as chrome.runtime.MessageSender, sendResponse);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'Navigation failed.' }));
    expect(chrome.tabs.remove).toHaveBeenCalledWith(22);
    vi.mocked(chrome.tabs.update).mockClear();
    completeSignIn();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
  });
});
