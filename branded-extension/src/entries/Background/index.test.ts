import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { injectSpinner } from './authTabOverlay';

type MetadataHandler = (request: {
  initiator: string | null;
  method: string;
  requestHeaders: chrome.webRequest.HttpHeader[];
  requestId: string;
  tabId: number;
  type: chrome.webRequest.ResourceType;
  url: string;
}) => Promise<void> | void;

type RuntimeMessageListener = (
  message: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

const mocks = vi.hoisted(() => ({
  approval: vi.fn(),
  executeScript: vi.fn(),
  metadataHandler: null as MetadataHandler | null,
  openPluginSession: vi.fn(),
  runtimeSendMessage: vi.fn(),
  stageBuyerCapture: vi.fn(),
  stageSarCapture: vi.fn(),
  tabsCreate: vi.fn(),
  tabsSendMessage: vi.fn(),
}));

vi.mock('@utils/extensionMessaging', () => ({
  safeChromeRuntimeSendMessage: mocks.runtimeSendMessage,
  safeChromeTabsSendMessage: mocks.tabsSendMessage,
}));
vi.mock('@utils/extensionState', () => ({
  getExtensionManagerState: vi.fn(async () => ({ connectedSites: [], plugins: [] })),
  isConnectedSite: vi.fn(async () => false),
  rememberConnectedSite: vi.fn(),
  removeCapturePlugin: vi.fn(),
  removeConnectedSite: vi.fn(),
  restrictExtensionStorageAccess: vi.fn(async () => undefined),
}));
vi.mock('@utils/misc', () => ({ replayRequestInPage: vi.fn() }));
vi.mock('./approvalWindow', () => ({
  handleApprovalRuntimeMessage: vi.fn(() => false),
  handleApprovalTabUpdated: vi.fn(),
  handleApprovalWindowRemoved: vi.fn(),
  requestExtensionApproval: mocks.approval,
}));
vi.mock('./authTabOverlay', () => ({
  injectSpinner: vi.fn(),
  showAuthSuccessAndWait: vi.fn(),
  removeAuthOverlay: vi.fn(),
}));
vi.mock('./buyerTeeFlow', () => ({
  clearBuyerTeeCapture: vi.fn(),
  rememberBuyerTeeCapture: vi.fn(),
  resolveBuyerTeeCaptureConfig: vi.fn(() => ({ config: null, error: null })),
  stageBuyerTeeCaptureForMetadata: mocks.stageBuyerCapture,
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
    mocks.metadataHandler = handler;
  }),
  setShouldReplayRequestInPage: vi.fn(),
}));
vi.mock('./offscreenDocument', () => ({ ensureOffscreenDocument: vi.fn() }));
vi.mock('./pluginCaptureSession', () => ({
  cancelPluginCaptureSessions: vi.fn(),
  handlePluginTabRemoved: vi.fn(() => false),
  handlePluginTabUpdated: vi.fn(() => false),
  openPluginCaptureSession: mocks.openPluginSession,
}));
vi.mock('./providerRequestMatcher', () => ({ isProviderContextRequest: vi.fn(() => true) }));
vi.mock('./sarCredentialFlow', () => ({
  clearSarCredentialCapture: vi.fn(),
  rememberSarCredentialCapture: vi.fn(),
  resolveSarCredentialCaptureConfig: vi.fn(() => ({ config: null, error: null })),
  stageSarCredentialCaptureForMetadata: mocks.stageSarCapture,
}));

const sourceSender = {
  documentId: 'source-document',
  frameId: 0,
  tab: { id: 11, url: 'https://app.acme-verify.example/' },
  url: 'https://app.acme-verify.example/',
} as chrome.runtime.MessageSender & { documentId: string };

function providerConfig() {
  return {
    authLink: 'https://provider.example/login',
    body: '',
    method: 'GET',
    metadata: {
      fallbackMethod: '',
      fallbackUrlRegex: '',
      method: 'GET',
      platform: 'venmo',
      preprocessRegex: '',
      transactionsExtraction: {},
      urlRegex: 'transactions',
    },
    paramNames: [],
    paramSelectors: [],
    url: 'https://provider.example/api/transactions',
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

describe('Background capture routing', () => {
  let runtimeMessageListener: RuntimeMessageListener;
  let tabRemovedListener: (tabId: number) => void;

  async function openCapture(data: Record<string, unknown> = {}): Promise<void> {
    const sendResponse = vi.fn();
    runtimeMessageListener(
      {
        action: 'open_new_tab_background',
        data: {
          actionType: 'transfer_venmo',
          captureAttemptId: 'attempt-1',
          platform: 'venmo',
          ...data,
        },
      },
      sourceSender,
      sendResponse,
    );
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ success: true }));
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.approval.mockResolvedValue(true);
    mocks.executeScript.mockResolvedValue([{ result: { requested: true } }]);
    mocks.metadataHandler = null;
    mocks.runtimeSendMessage.mockResolvedValue(undefined);
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: null,
      errorMessage: null,
      metadata: undefined,
    });
    mocks.stageSarCapture.mockResolvedValue({ capture: null, errorMessage: null });
    mocks.tabsCreate.mockResolvedValue({ id: 22 });
    mocks.tabsSendMessage.mockResolvedValue(undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: vi.fn(async () => providerConfig()), ok: true })),
    );
    vi.stubGlobal('chrome', {
      scripting: { executeScript: mocks.executeScript },
      action: {},
      runtime: {
        getURL: vi.fn((path: string) => `chrome-extension://extension-id/${path}`),
        id: 'extension-id',
        onInstalled: { addListener: vi.fn() },
        onMessage: {
          addListener: vi.fn((listener: RuntimeMessageListener) => {
            runtimeMessageListener = listener;
          }),
        },
      },
      tabs: {
        create: mocks.tabsCreate,
        get: vi.fn(async () => ({ id: 22, active: false, windowId: 1 })),
        update: vi.fn(async () => undefined),
        onRemoved: {
          addListener: vi.fn((listener: (tabId: number) => void) => {
            tabRemovedListener = listener;
          }),
        },
        onUpdated: { addListener: vi.fn() },
        query: vi.fn(async () => []),
        remove: vi.fn(),
      },
      webRequest: {
        onBeforeRequest: { addListener: vi.fn() },
        onResponseStarted: { addListener: vi.fn() },
        onSendHeaders: { addListener: vi.fn() },
      },
      windows: { onRemoved: { addListener: vi.fn() } },
    });

    await import('./index');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps existing providers on the remote Curator path and opens them in the foreground', async () => {
    mocks.runtimeSendMessage.mockResolvedValue({
      metadata: [{ hidden: false, originalIndex: 0, paymentId: 'payment-1' }],
      request: {},
      requestId: 'request-1',
      success: true,
    });
    await openCapture();

    expect(fetch).toHaveBeenCalledWith('https://api.zkp2p.xyz/providers/venmo/transfer_venmo.json');
    expect(mocks.tabsCreate).toHaveBeenCalledWith({
      active: true,
      url: 'about:blank',
      windowId: 1,
    });
    expect(chrome.tabs.update).toHaveBeenCalledWith(22, { url: 'https://provider.example/login' });
    expect(mocks.openPluginSession).not.toHaveBeenCalled();
    expect(mocks.approval).not.toHaveBeenCalled();

    await mocks.metadataHandler?.({
      initiator: 'https://provider.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://provider.example/transactions',
    });

    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'extract_metadata_offscreen',
        data: expect.objectContaining({ providerConfig: providerConfig() }),
      }),
    );
    expect(
      mocks.runtimeSendMessage.mock.calls.every(
        ([message]) => message.action === 'extract_metadata_offscreen',
      ),
    ).toBe(true);
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        action: 'send_metadata_messages_response',
        data: expect.objectContaining({ requestId: 'request-1' }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('routes an explicit page plugin without fetching provider JSON', async () => {
    const capturePlugin = {
      authLink: 'https://provider.example/',
      id: 'venmo/transfer_venmo',
      name: 'Venmo',
      origins: ['https://provider.example'],
      shouldSkipCloseTab: false,
      source: 'function capture() { return null; }',
    };
    await openCapture({ capturePlugin });

    expect(mocks.openPluginSession).toHaveBeenCalledWith(
      expect.objectContaining({ capturePlugin }),
      expect.objectContaining({ origin: 'https://app.acme-verify.example' }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('notifies the exact source document when a provider tab closes', async () => {
    await openCapture();
    tabRemovedListener(22);

    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({
          captureAttemptId: 'attempt-1',
          errorMessage: 'Provider authentication was cancelled.',
        }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('does not deliver staged metadata after the provider tab closes', async () => {
    const pendingSarCapture = deferred<{ capture: null; errorMessage: null }>();
    mocks.runtimeSendMessage.mockResolvedValue({
      metadata: [],
      request: {},
      requestId: 'request-1',
      success: true,
    });
    mocks.stageSarCapture.mockReturnValue(pendingSarCapture.promise);
    await openCapture();

    const extraction = Promise.resolve(
      mocks.metadataHandler?.({
        initiator: 'https://provider.example',
        method: 'GET',
        requestHeaders: [],
        requestId: 'request-1',
        tabId: 22,
        type: 'xmlhttprequest',
        url: 'https://provider.example/transactions',
      }),
    );
    await vi.waitFor(() => expect(mocks.stageSarCapture).toHaveBeenCalled());
    tabRemovedListener(22);
    pendingSarCapture.resolve({ capture: null, errorMessage: null });
    await extraction;

    const sourceResponses = mocks.tabsSendMessage.mock.calls.filter(
      ([tabId, message]) =>
        tabId === 11 &&
        (message as { action?: string }).action === 'send_metadata_messages_response',
    );
    expect(sourceResponses).toHaveLength(1);
    expect(sourceResponses[0]?.[1]).toEqual(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'Provider authentication was cancelled.' }),
      }),
    );
  });

  it('does not show success when seller credential creation fails', async () => {
    mocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      metadata: [],
      request: {},
      requestId: 'request-1',
    });
    mocks.stageSarCapture.mockResolvedValue({ capture: null, errorMessage: 'Capture failed.' });
    await openCapture();
    await captureMetadata();
    expect(injectSpinner).not.toHaveBeenCalled();
  });

  async function captureMetadata(): Promise<void> {
    await mocks.metadataHandler?.({
      initiator: 'https://provider.example',
      method: 'GET',
      requestHeaders: [],
      requestId: 'request-1',
      tabId: 22,
      type: 'xmlhttprequest',
      url: 'https://provider.example/transactions',
    });
  }

  it('rejects invalid provider identifiers before fetching', async () => {
    const sendResponse = vi.fn();
    runtimeMessageListener(
      {
        action: 'open_new_tab_background',
        data: { actionType: 'transfer_venmo', platform: '../venmo' },
      },
      sourceSender,
      sendResponse,
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Invalid provider platform.',
        success: false,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed when Chrome cannot bind the request to a document', async () => {
    const sendResponse = vi.fn();
    runtimeMessageListener(
      {
        action: 'open_new_tab_background',
        data: { actionType: 'transfer_venmo', platform: 'venmo' },
      },
      {
        frameId: 0,
        tab: { id: 11, url: 'https://app.acme-verify.example/' },
        url: 'https://app.acme-verify.example/',
      } as chrome.runtime.MessageSender,
      sendResponse,
    );

    await vi.waitFor(() =>
      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unable to bind metadata capture to the requesting document.',
        success: false,
      }),
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
