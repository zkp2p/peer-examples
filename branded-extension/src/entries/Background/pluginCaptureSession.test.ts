import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequestLog } from './requestLog';
import type { ExecuteCapturePageActionResponse } from '@utils/types';

const mocks = vi.hoisted(() => ({
  executeScript: vi.fn(async () => [{ frameId: 0, result: { success: true } }]),
  clearBuyerCapture: vi.fn(),
  clearCache: vi.fn(),
  clearInterceptPatterns: vi.fn(),
  clearSarCapture: vi.fn(),
  ensureOffscreenDocument: vi.fn(async () => undefined),
  injectSpinner: vi.fn(async () => undefined),
  installPlugin: vi.fn(),
  rememberBuyerCapture: vi.fn(),
  rememberSarCapture: vi.fn(),
  removeAuthOverlay: vi.fn(async () => undefined),
  requestApproval: vi.fn(async () => true),
  resolveBuyerCapture: vi.fn(() => ({ config: null, error: null })),
  resolveSarCapture: vi.fn(() => ({ config: null, error: null })),
  runtimeSendMessage: vi.fn(),
  matchRequest: vi.fn(),
  replayRequest: vi.fn(),
  replayRequestInPage: vi.fn(),
  setRequestCaptureHandler: vi.fn(),
  setMainFrameNavigationHandler: vi.fn(),
  setInterceptPatterns: vi.fn(),
  showAuthSuccessAndWait: vi.fn(async () => undefined),
  stageBuyerCapture: vi.fn(
    async (): Promise<{
      capture: null | {
        encryptedSessionMaterial: string;
        matchedParams?: Record<string, string | number | boolean>;
      };
      errorMessage: string | null;
      metadata?: Array<Record<string, unknown>>;
    }> => ({
      capture: null,
      errorMessage: null,
    }),
  ),
  stageSarCapture: vi.fn(async () => ({ capture: null, errorMessage: null })),
  tabsCreate: vi.fn(async () => ({ id: 22 })),
  tabsGet: vi.fn(),
  tabsRemove: vi.fn(async () => undefined),
  tabsSendMessage: vi.fn(
    async (_tabId: number, _message: { action: string }): Promise<unknown> => ({ success: true }),
  ),
  tabsUpdate: vi.fn(async () => undefined),
}));

vi.mock('@utils/extensionMessaging', () => ({
  safeChromeRuntimeSendMessage: (message: { action: string }) =>
    message.action === 'match_capture_request_offscreen'
      ? mocks.matchRequest(message)
      : mocks.runtimeSendMessage(message),
  safeChromeTabsSendMessage: mocks.tabsSendMessage,
}));
vi.mock('@utils/misc', () => ({
  replayRequest: mocks.replayRequest,
  replayRequestInPage: mocks.replayRequestInPage,
}));
vi.mock('./approvalWindow', () => ({ requestExtensionApproval: mocks.requestApproval }));
vi.mock('./authTabOverlay', () => ({
  injectSpinner: mocks.injectSpinner,
  removeAuthOverlay: mocks.removeAuthOverlay,
  showAuthSuccessAndWait: mocks.showAuthSuccessAndWait,
}));
vi.mock('./buyerTeeFlow', () => ({
  clearBuyerTeeCapture: mocks.clearBuyerCapture,
  rememberBuyerTeeCapture: mocks.rememberBuyerCapture,
  resolveBuyerTeeCaptureConfig: mocks.resolveBuyerCapture,
  stageBuyerTeeCaptureForMetadata: mocks.stageBuyerCapture,
}));
vi.mock('./cache', () => ({ deleteCacheByTabId: mocks.clearCache }));
vi.mock('./capturePluginFlow', () => ({ installCapturePlugin: mocks.installPlugin }));
vi.mock('./handlers', () => ({
  clearInterceptPatterns: mocks.clearInterceptPatterns,
  setInterceptPatterns: mocks.setInterceptPatterns,
  setMainFrameNavigationHandler: mocks.setMainFrameNavigationHandler,
  setRequestCaptureHandler: mocks.setRequestCaptureHandler,
}));
vi.mock('./offscreenDocument', () => ({
  ensureOffscreenDocument: mocks.ensureOffscreenDocument,
}));
vi.mock('./sarCredentialFlow', () => ({
  clearSarCredentialCapture: mocks.clearSarCapture,
  rememberSarCredentialCapture: mocks.rememberSarCapture,
  resolveSarCredentialCaptureConfig: mocks.resolveSarCapture,
  stageSarCredentialCaptureForMetadata: mocks.stageSarCapture,
}));

const plugin = {
  authLink: 'https://provider.example/activity',
  id: 'provider/transfer_provider',
  name: 'Provider transfers',
  origins: ['https://provider.example'],
  shouldSkipCloseTab: false,
  source: 'function capture() { return null; }',
};

const source = {
  documentId: 'source-document',
  frameId: 0,
  hostname: 'partner.example',
  origin: 'https://partner.example',
  tabId: 11,
};

const request = {
  initiator: 'https://provider.example',
  method: 'POST',
  requestBody: '{"amount":"10.00"}',
  requestHeaders: [{ name: 'Authorization', value: 'secret' }],
  requestId: 'request-1',
  responseBody: '{"paymentId":"payment-1"}',
  responseHeaders: [{ name: 'Set-Cookie', value: 'secret' }],
  responseStatus: 201,
  tabId: 22,
  type: 'xmlhttprequest' as const,
  url: 'https://provider.example/api/activity',
};

async function loadSession() {
  return import('./pluginCaptureSession');
}

function handlePluginCapturedRequest(value: RequestLog): void {
  const handler = mocks.setRequestCaptureHandler.mock.calls.at(-1)?.[1];
  expect(handler).toBeTypeOf('function');
  handler(value);
}

function handlePluginMainFrameNavigation(url: string): void {
  const handler = mocks.setMainFrameNavigationHandler.mock.calls.at(-1)?.[1];
  expect(handler).toBeTypeOf('function');
  handler(url);
}

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

describe('plugin capture sessions', () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.ensureOffscreenDocument.mockResolvedValue(undefined);
    mocks.installPlugin.mockResolvedValue(plugin);
    mocks.resolveBuyerCapture.mockReturnValue({ config: null, error: null });
    mocks.resolveSarCapture.mockReturnValue({ config: null, error: null });
    mocks.runtimeSendMessage.mockResolvedValue({ success: true });
    mocks.matchRequest.mockResolvedValue({ success: true, result: true });
    mocks.replayRequest.mockResolvedValue({ status: 201, text: request.responseBody });
    mocks.stageBuyerCapture.mockResolvedValue({ capture: null, errorMessage: null });
    mocks.stageSarCapture.mockResolvedValue({ capture: null, errorMessage: null });
    mocks.tabsSendMessage.mockResolvedValue({ success: true });
    mocks.tabsGet.mockResolvedValue({ id: 22, active: true, url: plugin.authLink, windowId: 1 });
    vi.stubGlobal('chrome', {
      scripting: { executeScript: mocks.executeScript },
      runtime: {},
      tabs: {
        get: mocks.tabsGet,
        create: mocks.tabsCreate,
        remove: mocks.tabsRemove,
        update: mocks.tabsUpdate,
      },
    });
  });

  it('shows one passive guide, keeps capture alive, then clears it before detail completion', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        platform: 'provider',
        capturePlugin: { ...plugin, shouldSkipCloseTab: true },
        initialAction: { enabled: true },
      },
      source,
    );
    const highlight = { pathPrefix: '/history/' };
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: { highlight } });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      22,
      {
        action: 'start_capture_highlight',
        data: { highlight, expectedUrl: plugin.authLink },
      },
      undefined,
      { frameId: 0 },
    );
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.clearInterceptPatterns).not.toHaveBeenCalled();
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
    handlePluginCapturedRequest(request);
    await flush();
    expect(
      mocks.tabsSendMessage.mock.calls.filter(
        ([, message]) => message.action === 'start_capture_highlight',
      ),
    ).toHaveLength(1);

    mocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      result: [{ originalIndex: 0, hidden: false }],
    });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(22, {
      action: 'stop_metadata_click_guide',
      data: {},
    });
    expect(mocks.stageBuyerCapture).toHaveBeenCalledOnce();
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledOnce();
  });

  it.each(['navigation', 'spa-navigation', 'cancellation', 'revocation', 'error'])(
    'clears the highlight on %s',
    async (change) => {
      const {
        openPluginCaptureSession,
        handlePluginTabRemoved,
        handlePluginTabUpdated,
        cancelPluginCaptureSessions,
      } = await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          platform: 'provider',
          capturePlugin: plugin,
          initialAction: { enabled: true },
        },
        source,
      );
      mocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        result: { highlight: { pathPrefix: '/history/' } },
      });
      handlePluginCapturedRequest(request);
      await flush();
      if (change === 'navigation')
        handlePluginMainFrameNavigation('https://provider.example/other');
      if (change === 'spa-navigation')
        handlePluginTabUpdated(22, { url: 'https://provider.example/other' }, {
          id: 22,
        } as chrome.tabs.Tab);
      if (change === 'cancellation') handlePluginTabRemoved(22);
      if (change === 'revocation') cancelPluginCaptureSessions(() => true);
      if (change === 'error') {
        mocks.runtimeSendMessage.mockResolvedValue({
          success: false,
          error: 'Provider capture failed.',
        });
        handlePluginCapturedRequest(request);
      }
      await flush();
      expect(mocks.tabsSendMessage).toHaveBeenCalledWith(22, {
        action: 'stop_metadata_click_guide',
        data: {},
      });
    },
  );

  it.each([false, true])(
    'rejects disabled or invalid highlighting before sending it, enabled=%s',
    async (enabled) => {
      const { openPluginCaptureSession } = await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          platform: 'provider',
          capturePlugin: plugin,
          initialAction: { enabled },
        },
        source,
      );
      mocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        result: { highlight: { pathPrefix: enabled ? '//evil.example/' : '/history/' } },
      });
      handlePluginCapturedRequest(request);
      await flush();
      expect(
        mocks.tabsSendMessage.mock.calls.some(
          ([, message]) => message.action === 'start_capture_highlight',
        ),
      ).toBe(false);
      expect(mocks.clearInterceptPatterns).toHaveBeenCalledOnce();
      expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          data: expect.objectContaining({
            errorMessage: expect.stringContaining('Capture highlight'),
          }),
        }),
        undefined,
        expect.any(Object),
      );
    },
  );

  it.each(['navigation', 'capture', 'cancellation'])(
    'does not show a pending highlight after %s',
    async (change) => {
      const { openPluginCaptureSession, handlePluginTabRemoved } = await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          platform: 'provider',
          capturePlugin: plugin,
          initialAction: { enabled: true },
        },
        source,
      );
      let resolveTab!: (tab: chrome.tabs.Tab) => void;
      mocks.tabsGet.mockImplementationOnce(
        () =>
          new Promise<chrome.tabs.Tab>((resolve) => {
            resolveTab = resolve;
          }),
      );
      mocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        result: { highlight: { pathPrefix: '/history/' } },
      });
      handlePluginCapturedRequest(request);
      await flush();
      if (change === 'navigation')
        handlePluginMainFrameNavigation('https://provider.example/other');
      if (change === 'cancellation') handlePluginTabRemoved(22);
      if (change === 'capture') {
        mocks.runtimeSendMessage.mockResolvedValue({
          success: true,
          result: [{ originalIndex: 0, hidden: false }],
        });
        handlePluginCapturedRequest({ ...request, requestId: 'detail' });
        await flush();
      }
      resolveTab({ id: 22, active: true, url: plugin.authLink } as chrome.tabs.Tab);
      await flush();
      expect(
        mocks.tabsSendMessage.mock.calls.some(
          ([, message]) => message.action === 'start_capture_highlight',
        ),
      ).toBe(false);
    },
  );

  it('rejects unrelated requests before replay and keeps the capture session alive', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({ success: true, result: false });
    // Even a large response must never reach replay or the capture-body limit when unmatched.
    handlePluginCapturedRequest({
      ...request,
      url: 'https://provider.example/api/settings',
      responseBody: 'x'.repeat(2 * 1024 * 1024 + 1),
    });
    await flush();
    expect(mocks.replayRequest).not.toHaveBeenCalled();
    expect(mocks.runtimeSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'execute_capture_program_offscreen',
      }),
    );
    expect(mocks.clearInterceptPatterns).not.toHaveBeenCalled();
    expect(mocks.injectSpinner).not.toHaveBeenCalled();

    mocks.matchRequest.mockResolvedValue({ success: true, result: true });
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: null });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.replayRequest).toHaveBeenCalledExactlyOnceWith(request, 'error');
    expect(mocks.matchRequest).toHaveBeenLastCalledWith({
      action: 'match_capture_request_offscreen',
      data: {
        origins: plugin.origins,
        source: plugin.source,
        params: {},
        request: {
          url: request.url,
          method: request.method,
          body: request.requestBody,
        },
      },
    });
  });

  it('captures a page response once after its own navigation has finished', async () => {
    const { openPluginCaptureSession, handlePluginTabUpdated } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: null });
    const pageRequest = { ...request, type: 'main_frame' as const, url: plugin.authLink };
    mocks.tabsGet.mockResolvedValue({ id: 22, status: 'complete', url: 'about:blank' });
    handlePluginCapturedRequest(pageRequest);
    await flush();
    expect(mocks.matchRequest).not.toHaveBeenCalled();
    handlePluginTabUpdated(22, { status: 'loading', url: plugin.authLink }, {
      id: 22,
      status: 'loading',
      url: plugin.authLink,
    } as chrome.tabs.Tab);
    const loadedTab = {
      id: 22,
      status: 'complete',
      url: `${plugin.authLink}#history`,
    } as chrome.tabs.Tab;
    handlePluginTabUpdated(22, { status: 'complete' }, loadedTab);
    handlePluginTabUpdated(22, { status: 'complete' }, loadedTab);
    await flush();
    expect(mocks.replayRequest).toHaveBeenCalledExactlyOnceWith(pageRequest, 'error');
  });

  it('captures a queued page response if its load event already finished', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: null });
    mocks.tabsGet.mockResolvedValue({ id: 22, status: 'complete', url: plugin.authLink });
    const pageRequest = { ...request, type: 'main_frame' as const, url: plugin.authLink };
    handlePluginCapturedRequest(pageRequest);
    await flush();
    expect(mocks.replayRequest).toHaveBeenCalledExactlyOnceWith(pageRequest, 'error');
  });

  it.each(['cancel', 'navigate'])('discards a pending page response after %s', async (change) => {
    const { openPluginCaptureSession, handlePluginTabRemoved, handlePluginTabUpdated } =
      await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    handlePluginCapturedRequest({ ...request, type: 'main_frame', url: plugin.authLink });
    if (change === 'cancel') handlePluginTabRemoved(22);
    else handlePluginMainFrameNavigation('https://provider.example/other');
    handlePluginTabUpdated(22, { status: 'complete' }, {
      id: 22,
      status: 'complete',
      url: plugin.authLink,
    } as chrome.tabs.Tab);
    await flush();
    expect(mocks.matchRequest).not.toHaveBeenCalled();
    expect(mocks.replayRequest).not.toHaveBeenCalled();
  });

  it.each(['cancel', 'navigate'])(
    'does not replay after %s while matching is pending',
    async (change) => {
      const { openPluginCaptureSession, handlePluginTabRemoved, handlePluginTabUpdated } =
        await loadSession();
      await openPluginCaptureSession(
        { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
        source,
      );
      let resolve!: (result: { success: true; result: true }) => void;
      mocks.matchRequest.mockReturnValue(
        new Promise((done) => {
          resolve = done;
        }),
      );
      handlePluginCapturedRequest(request);
      await flush();
      if (change === 'cancel') handlePluginTabRemoved(22);
      else handlePluginMainFrameNavigation('https://provider.example/other');
      resolve({ success: true, result: true });
      await flush();
      expect(mocks.replayRequest).not.toHaveBeenCalled();
      expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    },
  );

  it('fails closed before replay when request matching fails', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({ success: false, error: 'Matcher failed.' });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.replayRequest).not.toHaveBeenCalled();
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledWith(22);
  });

  it.each([true, false, undefined])(
    'honors focusOnOpen=%s while registering interception before navigation',
    async (focusOnOpen) => {
      const { openPluginCaptureSession } = await loadSession();
      mocks.installPlugin.mockResolvedValue({ ...plugin, focusOnOpen });
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          capturePlugin: { ...plugin, focusOnOpen },
          platform: 'provider',
        },
        source,
      );
      expect(mocks.tabsCreate).toHaveBeenCalledWith({
        active: focusOnOpen !== false,
        url: 'about:blank',
        windowId: 1,
      });
      expect(mocks.setInterceptPatterns.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.tabsUpdate.mock.invocationCallOrder[0],
      );
      expect(mocks.tabsUpdate).toHaveBeenCalledWith(22, { url: plugin.authLink });
    },
  );

  it('installs the requested provider plugin before opening its auth page', async () => {
    const { openPluginCaptureSession } = await loadSession();
    let resolveInstall!: (value: typeof plugin) => void;
    mocks.installPlugin.mockImplementation(
      () => new Promise((resolve) => (resolveInstall = resolve)),
    );

    const opening = openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        attestationActionType: 'transfer_attestation',
        attestationPlatform: 'attestation',
        capturePlugin: plugin,
        platform: 'provider',
      },
      source,
    );

    await flush();

    expect(mocks.installPlugin).toHaveBeenCalledWith(
      expect.objectContaining({ actionType: 'transfer_provider', platform: 'provider' }),
    );
    expect(mocks.tabsCreate).not.toHaveBeenCalled();

    resolveInstall(plugin);
    await opening;

    expect(mocks.tabsCreate).toHaveBeenCalledWith({
      active: true,
      url: 'about:blank',
      windowId: 1,
    });
    expect(mocks.setInterceptPatterns).toHaveBeenCalledWith(
      ['^https://provider\\.example(?:/|$)'],
      22,
    );
    expect(mocks.tabsUpdate).toHaveBeenCalledWith(22, { url: plugin.authLink });
    expect(mocks.ensureOffscreenDocument).toHaveBeenCalledTimes(1);
  });

  it('replays a matcher-selected target with the context request session', async () => {
    // Legacy metadataUrl/fallback parity: the page never issues the canonical
    // request, so match() names it and the host replays it with this session.
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    const target = {
      body: '{"page":1}',
      method: 'POST',
      url: 'https://provider.example/api/history?count=20',
    };
    mocks.matchRequest.mockResolvedValue({ success: true, result: target });
    mocks.replayRequestInPage.mockResolvedValue({ ok: true, status: 200, text: '[]' });
    mocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      result: [{ paymentId: 'payment-1', originalIndex: 0, hidden: false }],
    });
    handlePluginCapturedRequest({ ...request, method: 'GET', requestBody: undefined });
    await flush();
    // Like shouldReplayRequestInPage, the target is fetched from the provider tab.
    expect(mocks.replayRequest).not.toHaveBeenCalled();
    expect(mocks.replayRequestInPage).toHaveBeenCalledExactlyOnceWith(
      22,
      expect.objectContaining({
        method: 'POST',
        requestBody: '{"page":1}',
        // The GET context never declared a body type; the host adds one for JSON.
        requestHeaders: [
          ...request.requestHeaders,
          { name: 'content-type', value: 'application/json' },
        ],
        url: target.url,
      }),
      { pageOrigin: 'https://provider.example', requestOrigin: 'https://provider.example' },
    );
    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'execute_capture_program_offscreen',
        data: expect.objectContaining({
          event: expect.objectContaining({
            request: { body: '{"page":1}', method: 'POST', url: target.url },
            response: expect.objectContaining({ body: '[]', status: 200 }),
          }),
        }),
      }),
    );
    expect(mocks.stageBuyerCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({ method: 'POST', url: target.url }),
      }),
    );
  });

  it('replays one in-flight target for concurrent context matches', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    const target = {
      body: null,
      method: 'GET',
      url: 'https://provider.example/api/history?count=20',
    };
    mocks.matchRequest.mockResolvedValue({ success: true, result: target });
    let finish!: (value: { ok: boolean; status: number; text: string }) => void;
    mocks.replayRequestInPage.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mocks.runtimeSendMessage.mockResolvedValue({
      success: true,
      result: [{ paymentId: 'payment-1', originalIndex: 0, hidden: false }],
    });
    handlePluginCapturedRequest({ ...request, url: 'https://provider.example/api/feed?pocket=1' });
    handlePluginCapturedRequest({ ...request, url: 'https://provider.example/api/feed?pocket=2' });
    await flush();
    expect(mocks.replayRequestInPage).toHaveBeenCalledTimes(1);
    finish({ ok: true, status: 200, text: '[]' });
    await flush();
    expect(mocks.stageBuyerCapture).toHaveBeenCalledOnce();
  });

  it('does not replay a target while the provider tab shows a foreign document', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: 'https://provider.example/api/history?count=20' },
    });
    mocks.tabsGet.mockResolvedValue({ id: 22, url: 'https://login.example/sso', windowId: 1 });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.replayRequestInPage).not.toHaveBeenCalled();
    expect(mocks.tabsSendMessage).not.toHaveBeenCalled();
    expect(mocks.clearInterceptPatterns).not.toHaveBeenCalled();
  });

  it('fails closed when the in-page replay cannot run', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: 'https://provider.example/api/history?count=20' },
    });
    mocks.replayRequestInPage.mockResolvedValue({
      ok: false,
      status: 0,
      error: 'script-injection failed',
    });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: 'Provider replay failed: script-injection failed',
        }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('reports and cleans up a blocked direct replay instead of passing an empty response to capture', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    const errorMessage = 'Provider replay failed. Re-authenticate and try again.';
    mocks.replayRequest.mockRejectedValue(new Error(errorMessage));
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.runtimeSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'execute_capture_program_offscreen' }),
    );
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      source.tabId,
      expect.objectContaining({ data: expect.objectContaining({ errorMessage, metadata: [] }) }),
      undefined,
      { documentId: source.documentId, frameId: source.frameId },
    );
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledWith(22);
  });

  it('fails closed when a replayed target returns a non-2xx status', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: 'https://provider.example/api/history?count=20' },
    });
    mocks.replayRequestInPage.mockResolvedValue({ ok: true, status: 401, text: '' });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.runtimeSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'execute_capture_program_offscreen' }),
    );
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: 'Provider replied 401 to the replayed request.',
        }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('fails closed when a replay target leaves the plugin origins', async () => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: 'https://evil.example/api/history' },
    });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.replayRequest).not.toHaveBeenCalled();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: expect.stringContaining('replay target') }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('rejects credential forwarding to another declared origin at the host boundary', async () => {
    const multiOriginPlugin = {
      ...plugin,
      origins: [...plugin.origins, 'https://collector.example'],
    };
    mocks.installPlugin.mockResolvedValue(multiOriginPlugin);
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: multiOriginPlugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: 'https://collector.example/collect' },
    });
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.replayRequest).not.toHaveBeenCalled();
    expect(mocks.replayRequestInPage).not.toHaveBeenCalled();
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      source.tabId,
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: 'Capture replay target must remain on the captured request origin.',
        }),
      }),
      undefined,
      { documentId: source.documentId, frameId: source.frameId },
    );
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledWith(22);
  });

  it('retains API-origin replay when the provider uses a separate web origin', async () => {
    const apiOrigin = 'https://api.provider.example';
    const multiOriginPlugin = { ...plugin, origins: [...plugin.origins, apiOrigin] };
    mocks.installPlugin.mockResolvedValue(multiOriginPlugin);
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: multiOriginPlugin },
      source,
    );
    mocks.matchRequest.mockResolvedValue({
      success: true,
      result: { body: null, method: 'GET', url: `${apiOrigin}/history` },
    });
    mocks.replayRequestInPage.mockResolvedValue({ ok: true, status: 200, text: '[]' });
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: null });
    handlePluginCapturedRequest({ ...request, url: `${apiOrigin}/context` });
    await flush();
    expect(mocks.replayRequestInPage).toHaveBeenCalledExactlyOnceWith(
      22,
      expect.objectContaining({
        url: `${apiOrigin}/history`,
        requestHeaders: request.requestHeaders,
      }),
      { pageOrigin: 'https://provider.example', requestOrigin: apiOrigin },
    );
    expect(mocks.tabsSendMessage).not.toHaveBeenCalled();
  });

  it.each([true, false])('runs a query once only with page actions enabled=%s', async (enabled) => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        platform: 'provider',
        capturePlugin: plugin,
        initialAction: { enabled },
      },
      source,
    );
    const query = {
      url: 'https://provider.example/graphql',
      headers: {},
      body: {
        query: 'query History { history { id } }',
        operationName: 'History',
        variables: {},
      },
    };
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: { query } });
    handlePluginCapturedRequest(request);
    await flush();
    handlePluginCapturedRequest(request);
    await flush();
    expect(mocks.executeScript).toHaveBeenCalledTimes(enabled ? 1 : 0);
    if (enabled) {
      expect(mocks.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 22 },
          world: 'ISOLATED',
          args: [query, 'https://provider.example/api/activity'],
        }),
      );
      expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
      expect(mocks.tabsRemove).not.toHaveBeenCalled();
    }
  });

  it('continues in the background and stages only the final detail request', async () => {
    const { openPluginCaptureSession } = await loadSession();
    const url = 'https://provider.example/detail/selected';
    mocks.tabsGet.mockResolvedValue({ id: 22, active: false, windowId: 1 });
    mocks.runtimeSendMessage.mockImplementation(async (message: { action: string }) =>
      message.action === 'execute_capture_program_offscreen'
        ? { success: true, result: { navigate: { url } } }
        : { success: true },
    );
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        platform: 'provider',
        capturePlugin: plugin,
        captureParams: { AMOUNT: '10.00' },
        initialAction: { enabled: true },
      },
      source,
    );
    handlePluginCapturedRequest(request);
    await vi.waitFor(() => expect(mocks.tabsUpdate).toHaveBeenCalledWith(22, { url }));
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
    expect(mocks.tabsUpdate).not.toHaveBeenCalledWith(22, { active: true });
    handlePluginCapturedRequest({ ...request, requestId: 'duplicate-feed' });
    await flush();
    expect(mocks.tabsUpdate).toHaveBeenCalledTimes(2);

    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: { BODY: 'detail-body' } });
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: {
        encryptedSessionMaterial: 'encrypted-detail',
        matchedParams: { BODY: 'detail-body' },
      },
      errorMessage: null,
      metadata: [],
    });
    const detail = { ...request, requestId: 'detail', requestBody: 'detail-body' };
    handlePluginCapturedRequest(detail);
    await vi.waitFor(() => expect(mocks.tabsRemove).toHaveBeenCalledWith(22));
    expect(mocks.stageBuyerCapture).toHaveBeenCalledExactlyOnceWith({
      metadata: [],
      params: { BODY: 'detail-body' },
      request: detail,
      tabId: 22,
    });
  });

  it.each([
    { url: 'https://evil.example/', enabled: true, scoped: true },
    { url: 'https://provider.example/detail', enabled: false, scoped: true },
    { url: 'https://provider.example/detail', enabled: true, scoped: false },
  ])('rejects unauthorized continuation %#', async ({ url, enabled, scoped }) => {
    const { openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        platform: 'provider',
        capturePlugin: plugin,
        captureParams: scoped ? { AMOUNT: '10.00' } : {},
        initialAction: { enabled },
      },
      source,
    );
    mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: { navigate: { url } } });
    handlePluginCapturedRequest(request);
    await vi.waitFor(() => expect(mocks.clearInterceptPatterns).toHaveBeenCalled());
    expect(mocks.tabsUpdate).not.toHaveBeenCalledWith(22, { url });
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: expect.any(String) }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('ignores a pending capture after the provider document changes', async () => {
    const { openPluginCaptureSession, handlePluginTabUpdated } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    let complete!: (value: unknown) => void;
    mocks.runtimeSendMessage.mockImplementation((message: { action: string }) =>
      message.action === 'execute_capture_program_offscreen'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ success: true }),
    );
    handlePluginCapturedRequest(request);
    await flush();
    handlePluginMainFrameNavigation('https://provider.example/other');
    complete({ success: true, result: { BODY: 'stale-body' } });
    await flush();
    expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
  });

  it('keeps a pending capture when the tab reloads without a new document', async () => {
    // Late iframe loads (PayPal recaptcha, BofA widgets) and history.replaceState
    // toggle tabs.onUpdated loading status while the target replay is in flight.
    const { openPluginCaptureSession, handlePluginTabUpdated } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', platform: 'provider', capturePlugin: plugin },
      source,
    );
    let complete!: (value: unknown) => void;
    mocks.runtimeSendMessage.mockImplementation((message: { action: string }) =>
      message.action === 'execute_capture_program_offscreen'
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({ success: true }),
    );
    handlePluginCapturedRequest(request);
    await flush();
    handlePluginTabUpdated(22, { status: 'loading' }, { id: 22 } as chrome.tabs.Tab);
    handlePluginTabUpdated(22, { status: 'loading', url: `${plugin.authLink}#tab` }, {
      id: 22,
    } as chrome.tabs.Tab);
    handlePluginTabUpdated(22, { status: 'complete' }, {
      id: 22,
      status: 'complete',
      url: plugin.authLink,
    } as chrome.tabs.Tab);
    complete({
      success: true,
      result: [{ paymentId: 'payment-1', originalIndex: 0, hidden: false }],
    });
    await flush();
    expect(mocks.stageBuyerCapture).toHaveBeenCalledOnce();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: [{ paymentId: 'payment-1', originalIndex: 0, hidden: false }],
        }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it('warms the capture runtime before the provider page loads', async () => {
    const { openPluginCaptureSession } = await loadSession();
    let resolveWarmup!: () => void;
    mocks.ensureOffscreenDocument.mockImplementation(
      () => new Promise<undefined>((resolve) => (resolveWarmup = () => resolve(undefined))),
    );

    const opening = openPluginCaptureSession(
      { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
      source,
    );
    await flush();

    expect(mocks.ensureOffscreenDocument).toHaveBeenCalledTimes(1);
    expect(mocks.tabsCreate).not.toHaveBeenCalled();

    resolveWarmup();
    await opening;

    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith({
      action: 'warm_capture_sandbox_offscreen',
      data: {},
    });
    expect(mocks.tabsUpdate).toHaveBeenCalledWith(22, { url: plugin.authLink });
  });

  it('does not open the provider tab when capture runtime warmup fails', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.ensureOffscreenDocument.mockRejectedValue(new Error('QuickJS runtime failed to load.'));

    await expect(
      openPluginCaptureSession(
        { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
        source,
      ),
    ).rejects.toThrow('QuickJS runtime failed to load.');

    expect(mocks.tabsCreate).not.toHaveBeenCalled();
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
    expect(mocks.installPlugin).not.toHaveBeenCalled();
  });

  it('does not open an auth tab when plugin installation is rejected', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.installPlugin.mockRejectedValue(new Error('Capture plugin installation was rejected.'));

    await expect(
      openPluginCaptureSession(
        { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
        source,
      ),
    ).rejects.toThrow('installation was rejected');

    expect(mocks.tabsCreate).not.toHaveBeenCalled();
  });

  it('passes capture params to QuickJS and returns proof-ready verifier params', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: {
        encryptedSessionMaterial: 'encrypted-session',
        matchedParams: { PAYMENT_ID: 'payment-1' },
      },
      errorMessage: null,
      metadata: [],
    });
    mocks.runtimeSendMessage.mockResolvedValue({
      result: { PAYMENT_ID: 'payment-1' },
      success: true,
    });
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        captureParams: { amount: '10.00', attempt: 2, pending: false },
        capturePlugin: plugin,
        initialAction: { paymentDetails: { AMOUNT: '20.00' } },
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    await flush();

    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith({
      action: 'execute_capture_program_offscreen',
      data: {
        event: {
          request: {
            body: '{"amount":"10.00"}',
            method: 'POST',
            url: request.url,
          },
          response: {
            body: '{"paymentId":"payment-1"}',
            status: 201,
            url: request.url,
          },
        },
        params: { amount: '10.00', attempt: 2, pending: false },
        source: plugin.source,
      },
    });
    expect(mocks.stageBuyerCapture).toHaveBeenCalledWith({
      metadata: [],
      params: { PAYMENT_ID: 'payment-1' },
      request,
      tabId: 22,
    });
    expect(mocks.injectSpinner).toHaveBeenCalledWith(22);
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        action: 'send_metadata_messages_response',
        data: expect.objectContaining({
          buyerTeeCapture: {
            encryptedSessionMaterial: 'encrypted-session',
            matchedParams: { PAYMENT_ID: 'payment-1' },
          },
          metadata: [],
          requestId: 'request-1',
        }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
    expect(mocks.requestApproval).not.toHaveBeenCalled();
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledWith(22);
    await vi.waitFor(() => expect(mocks.tabsRemove).toHaveBeenCalledWith(22));
    expect(mocks.showAuthSuccessAndWait).toHaveBeenCalledWith(22);
    expect(mocks.runtimeSendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.injectSpinner.mock.invocationCallOrder[0],
    );
    expect(mocks.injectSpinner.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.showAuthSuccessAndWait.mock.invocationCallOrder[0],
    );
    expect(mocks.tabsUpdate).toHaveBeenCalledWith(11, { active: true });
    expect(mocks.tabsRemove).toHaveBeenCalledWith(22);
  });

  it('returns metadata when capture params are omitted', async () => {
    const { openPluginCaptureSession } = await loadSession();
    const metadata = [
      {
        amount: '10.00',
        hidden: false,
        originalIndex: 0,
        params: { SENDER_ID: 'sender-1' },
        recipient: '@recipient',
      },
    ];
    // No captureMode: both staging helpers return no capture, as in the real resolvers.
    mocks.runtimeSendMessage.mockResolvedValue({ result: metadata, success: true });
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        capturePlugin: plugin,
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    await flush();

    expect(mocks.runtimeSendMessage).toHaveBeenCalledWith({
      action: 'execute_capture_program_offscreen',
      data: {
        event: {
          request: {
            body: '{"amount":"10.00"}',
            method: 'POST',
            url: request.url,
          },
          response: {
            body: '{"paymentId":"payment-1"}',
            status: 201,
            url: request.url,
          },
        },
        params: {},
        source: plugin.source,
      },
    });
    expect(mocks.stageBuyerCapture).toHaveBeenCalledWith({
      metadata,
      params: undefined,
      request,
      tabId: 22,
    });
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({ metadata }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
    await vi.waitFor(() => expect(mocks.tabsRemove).toHaveBeenCalledWith(22));
    expect(mocks.showAuthSuccessAndWait).toHaveBeenCalledWith(22);
    expect(mocks.tabsUpdate).toHaveBeenCalledWith(11, { active: true });
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      {
        action: 'send_metadata_messages_response',
        data: {
          expiresAt: expect.any(Number),
          metadata,
          platform: 'provider',
          requestId: 'request-1',
        },
      },
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
  });

  it.each(['buyerTee', 'sellerCredential'] as const)(
    'requires staging for explicit %s capture',
    async (captureMode) => {
      const { openPluginCaptureSession } = await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          platform: 'provider',
          capturePlugin: plugin,
          captureMode,
        },
        source,
      );
      mocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        result: [{ hidden: false, originalIndex: 0 }],
      });
      handlePluginCapturedRequest(request);
      await flush();
      expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          data: expect.objectContaining({
            metadata: [],
            errorMessage: 'The capture plugin could not stage this result.',
          }),
        }),
        undefined,
        { documentId: 'source-document', frameId: 0 },
      );
      expect(mocks.tabsRemove).not.toHaveBeenCalled();
    },
  );

  it('completes background capture without switching focus or showing a countdown', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.tabsGet.mockResolvedValue({ id: 22, active: false, windowId: 1 });
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: { encryptedSessionMaterial: 'encrypted-session' },
      errorMessage: null,
      metadata: [],
    });
    mocks.runtimeSendMessage.mockResolvedValue({ result: [], success: true });
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
      source,
    );
    handlePluginCapturedRequest(request);
    await vi.waitFor(() => expect(mocks.tabsRemove).toHaveBeenCalledWith(22));
    expect(mocks.showAuthSuccessAndWait).not.toHaveBeenCalled();
    expect(mocks.tabsUpdate.mock.calls).toEqual([[22, { url: plugin.authLink }]]);
  });

  it('does not report success or close the provider when staging returns an error', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: null,
      errorMessage: 'Session material was rejected.',
      metadata: [],
    });
    mocks.runtimeSendMessage.mockResolvedValue({ result: [], success: true });
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
      source,
    );
    handlePluginCapturedRequest(request);
    await vi.waitFor(() => expect(mocks.removeAuthOverlay).toHaveBeenCalledWith(22));
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'Session material was rejected.' }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
    expect(mocks.showAuthSuccessAndWait).not.toHaveBeenCalled();
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
  });

  it('returns to the original tab without closing the provider tab when configured', async () => {
    const { openPluginCaptureSession } = await loadSession();
    const preservingPlugin = { ...plugin, shouldSkipCloseTab: true };
    mocks.installPlugin.mockResolvedValue(preservingPlugin);
    mocks.stageBuyerCapture.mockResolvedValue({
      capture: {
        encryptedSessionMaterial: 'encrypted-session',
        matchedParams: { PAYMENT_ID: 'payment-1' },
      },
      errorMessage: null,
      metadata: [],
    });
    mocks.runtimeSendMessage.mockResolvedValue({
      result: { PAYMENT_ID: 'payment-1' },
      success: true,
    });
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        captureParams: { amount: '10.00' },
        capturePlugin: preservingPlugin,
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    await flush();

    await vi.waitFor(() => expect(mocks.tabsUpdate).toHaveBeenCalledWith(11, { active: true }));
    expect(mocks.showAuthSuccessAndWait).toHaveBeenCalledWith(22);
    expect(mocks.tabsRemove).not.toHaveBeenCalled();
  });

  it('removes the progress overlay when capture preparation fails', async () => {
    const { openPluginCaptureSession } = await loadSession();
    mocks.runtimeSendMessage.mockResolvedValue({
      result: { PAYMENT_ID: 'payment-1' },
      success: true,
    });
    mocks.stageBuyerCapture.mockRejectedValue(new Error('TEE preparation failed.'));
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        capturePlugin: plugin,
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    await flush();

    expect(mocks.injectSpinner).toHaveBeenCalledWith(22);
    expect(mocks.removeAuthOverlay).toHaveBeenCalledWith(22);
    expect(mocks.showAuthSuccessAndWait).not.toHaveBeenCalled();
  });

  it('keeps one progress overlay while concurrent QuickJS searches are pending', async () => {
    vi.useFakeTimers();
    const { openPluginCaptureSession } = await loadSession();
    const searchResolvers: Array<(value: { result: null; success: true }) => void> = [];
    mocks.runtimeSendMessage.mockImplementation((message: { action: string }) => {
      if (message.action === 'warm_capture_sandbox_offscreen') {
        return Promise.resolve({ success: true });
      }
      return new Promise((resolve) => searchResolvers.push(resolve));
    });
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        capturePlugin: plugin,
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    handlePluginCapturedRequest({ ...request, requestId: 'request-2' });
    await flush();

    expect(mocks.injectSpinner).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(mocks.injectSpinner).toHaveBeenCalledTimes(1);
    expect(searchResolvers).toHaveLength(2);
    searchResolvers[0]({ result: null, success: true });
    await flush();
    expect(mocks.removeAuthOverlay).not.toHaveBeenCalled();

    searchResolvers[1]({ result: null, success: true });
    await flush();
    expect(mocks.removeAuthOverlay).toHaveBeenCalledTimes(1);
    expect(mocks.showAuthSuccessAndWait).not.toHaveBeenCalled();
  });

  it('does not flash the progress overlay for a fast null match', async () => {
    vi.useFakeTimers();
    const { openPluginCaptureSession } = await loadSession();
    mocks.runtimeSendMessage.mockResolvedValue({ result: null, success: true });
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        capturePlugin: plugin,
        platform: 'provider',
      },
      source,
    );

    handlePluginCapturedRequest(request);
    await flush();
    await vi.advanceTimersByTimeAsync(150);

    expect(mocks.injectSpinner).not.toHaveBeenCalled();
    expect(mocks.removeAuthOverlay).not.toHaveBeenCalled();
  });

  it.each(['https://app.peer.xyz', 'https://partner.example', 'http://localhost:3000'])(
    'executes page actions without a second approval for %s and keeps values in the host',
    async (origin) => {
      const { handlePluginTabUpdated, openPluginCaptureSession } = await loadSession();
      mocks.runtimeSendMessage.mockResolvedValue({
        actions: [
          { element: { id: 'amount' }, input: 'AMOUNT', type: 'fill' },
          { element: { id: 'continue' }, type: 'click' },
        ],
        success: true,
      });
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          capturePlugin: plugin,
          initialAction: { paymentDetails: { AMOUNT: '10.00' } },
          platform: 'provider',
        },
        { ...source, origin, hostname: new URL(origin).hostname },
      );

      expect(
        handlePluginTabUpdated(22, { status: 'complete' }, {
          url: 'https://provider.example/pay',
        } as chrome.tabs.Tab),
      ).toBe(true);
      await flush();

      expect(mocks.runtimeSendMessage).toHaveBeenCalledWith({
        action: 'execute_capture_interaction_offscreen',
        data: {
          inputs: ['AMOUNT'],
          source: plugin.source,
          url: 'https://provider.example/pay',
        },
      });
      expect(mocks.requestApproval).not.toHaveBeenCalled();
      expect(mocks.tabsSendMessage).toHaveBeenCalledWith(22, {
        action: 'execute_capture_page_action',
        data: {
          action: {
            element: { id: 'amount' },
            input: 'AMOUNT',
            type: 'fill',
            value: '10.00',
          },
          expectedUrl: 'https://provider.example/pay',
        },
      });
    },
  );

  it.each([
    { success: false, reason: 'not_found', error: 'Provider page element was not found.' },
    { success: false, reason: 'rejected', error: 'Provider page click target is not allowed.' },
    undefined,
  ] satisfies Array<ExecuteCapturePageActionResponse | undefined>)(
    'reports a failed page action and releases the capture session: %j',
    async (result) => {
      vi.useFakeTimers();
      const { handlePluginTabRemoved, handlePluginTabUpdated, openPluginCaptureSession } =
        await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          captureAttemptId: 'attempt-1',
          capturePlugin: plugin,
          initialAction: { enabled: true, paymentDetails: {} },
          platform: 'provider',
        },
        source,
      );

      // A metadata search may already have shown the spinner when a click fails.
      let finishSearch!: (result: { success: true; result: null }) => void;
      mocks.runtimeSendMessage.mockImplementation(async (message: { action: string }) => {
        if (message.action === 'execute_capture_program_offscreen') {
          return new Promise((resolve) => {
            finishSearch = resolve;
          });
        }
        return { success: true, actions: [{ type: 'click', element: { id: 'history' } }] };
      });
      handlePluginCapturedRequest(request);
      await flush();
      await vi.advanceTimersByTimeAsync(150);
      expect(mocks.injectSpinner).toHaveBeenCalledOnce();

      mocks.tabsSendMessage.mockResolvedValueOnce(result);
      handlePluginTabUpdated(22, { status: 'complete' }, {
        url: plugin.authLink,
      } as chrome.tabs.Tab);
      await flush();

      expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
        11,
        {
          action: 'send_metadata_messages_response',
          data: {
            captureAttemptId: 'attempt-1',
            errorMessage: result?.error ?? 'Provider page action did not run.',
            expiresAt: expect.any(Number),
            metadata: [],
            platform: 'provider',
            requestId: '',
          },
        },
        undefined,
        { documentId: source.documentId, frameId: source.frameId },
      );
      expect(mocks.clearInterceptPatterns).toHaveBeenCalledExactlyOnceWith(22);
      expect(mocks.clearCache).toHaveBeenCalledExactlyOnceWith(22);
      expect(mocks.clearBuyerCapture).toHaveBeenCalledExactlyOnceWith(22);
      expect(mocks.clearSarCapture).toHaveBeenCalledExactlyOnceWith(22);
      expect(mocks.removeAuthOverlay).toHaveBeenCalledExactlyOnceWith(22);
      expect(mocks.tabsRemove).not.toHaveBeenCalled();
      expect(mocks.showAuthSuccessAndWait).not.toHaveBeenCalled();
      expect(handlePluginTabRemoved(22)).toBe(false);

      finishSearch({ success: true, result: null });
      await flush();
      expect(mocks.stageBuyerCapture).not.toHaveBeenCalled();
      expect(mocks.tabsSendMessage).toHaveBeenCalledTimes(2); // action, then one terminal error
    },
  );

  it.each(['navigation', 'sandbox'])('reports a failed %s action setup', async (failure) => {
    const { handlePluginTabRemoved, handlePluginTabUpdated, openPluginCaptureSession } =
      await loadSession();
    await openPluginCaptureSession(
      {
        actionType: 'transfer_provider',
        capturePlugin: plugin,
        initialAction: { enabled: true, paymentDetails: {} },
        platform: 'provider',
      },
      source,
    );
    const error = `Provider ${failure} failed.`;
    mocks.runtimeSendMessage.mockResolvedValue(
      failure === 'sandbox'
        ? { success: false, error }
        : {
            success: true,
            actions: [{ type: 'navigate', url: 'https://provider.example/history' }],
          },
    );
    if (failure === 'navigation') mocks.tabsUpdate.mockRejectedValueOnce(new Error(error));

    handlePluginTabUpdated(22, { status: 'complete' }, { url: plugin.authLink } as chrome.tabs.Tab);
    await flush();
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({ data: expect.objectContaining({ errorMessage: error }) }),
      undefined,
      { documentId: source.documentId, frameId: source.frameId },
    );
    expect(mocks.clearInterceptPatterns).toHaveBeenCalledExactlyOnceWith(22);
    expect(handlePluginTabRemoved(22)).toBe(false);
  });

  it.each(['navigation', 'cancellation', 'capture'])(
    'ignores a late page-action error after %s takes ownership',
    async (owner) => {
      const { handlePluginTabRemoved, handlePluginTabUpdated, openPluginCaptureSession } =
        await loadSession();
      await openPluginCaptureSession(
        {
          actionType: 'transfer_provider',
          capturePlugin: plugin,
          initialAction: { enabled: true, paymentDetails: {} },
          platform: 'provider',
        },
        source,
      );
      mocks.runtimeSendMessage.mockResolvedValue({
        success: true,
        actions: [{ type: 'click', element: { id: 'history' } }],
      });
      let finishAction!: (value: ExecuteCapturePageActionResponse) => void;
      mocks.tabsSendMessage.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishAction = resolve;
          }),
      );
      handlePluginTabUpdated(22, { status: 'complete' }, {
        url: plugin.authLink,
      } as chrome.tabs.Tab);
      await flush();

      if (owner === 'navigation') handlePluginMainFrameNavigation('https://provider.example/next');
      if (owner === 'cancellation') handlePluginTabRemoved(22);
      let finishStaging: (() => void) | undefined;
      if (owner === 'capture') {
        mocks.runtimeSendMessage.mockResolvedValue({ success: true, result: [{ paymentId: '1' }] });
        mocks.stageBuyerCapture.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishStaging = () => resolve({ capture: null, errorMessage: null });
            }),
        );
        handlePluginCapturedRequest(request);
        await flush();
        expect(mocks.stageBuyerCapture).toHaveBeenCalledOnce();
      }
      mocks.tabsSendMessage.mockClear();
      finishAction({ success: false, reason: 'not_found', error: 'Late failure' });
      await flush();
      expect(mocks.tabsSendMessage).not.toHaveBeenCalled();
      if (owner !== 'cancellation') expect(mocks.clearInterceptPatterns).not.toHaveBeenCalled();
      finishStaging?.();
      await flush();
      if (owner === 'capture') {
        expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
          11,
          expect.objectContaining({
            data: expect.objectContaining({ metadata: [{ paymentId: '1' }] }),
          }),
          undefined,
          { documentId: source.documentId, frameId: source.frameId },
        );
      }
    },
  );

  it('cancels and clears a session when its auth tab closes', async () => {
    const { handlePluginTabRemoved, openPluginCaptureSession } = await loadSession();
    await openPluginCaptureSession(
      { actionType: 'transfer_provider', capturePlugin: plugin, platform: 'provider' },
      source,
    );

    expect(handlePluginTabRemoved(22)).toBe(true);
    expect(mocks.tabsSendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'Provider authentication was cancelled.' }),
      }),
      undefined,
      { documentId: 'source-document', frameId: 0 },
    );
    expect(mocks.clearCache).toHaveBeenCalledWith(22);
    expect(handlePluginTabRemoved(22)).toBe(false);
  });
});
