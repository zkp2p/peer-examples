import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerMock,
}));

function installChromeMock({
  contexts,
  createDocument = vi.fn().mockResolvedValue(undefined),
}: {
  contexts: unknown[];
  createDocument?: ReturnType<typeof vi.fn>;
}) {
  const getURL = vi.fn((path: string) => `chrome-extension://extension-id/${path}`);
  const getContexts = vi.fn().mockResolvedValue(contexts);

  (globalThis as { chrome: unknown; browser?: unknown }).chrome = {
    runtime: {
      getURL,
      getContexts,
    },
    offscreen: {
      createDocument,
    },
  };
  delete (globalThis as { browser?: unknown }).browser;

  return { createDocument, getContexts, getURL };
}

describe('ensureOffscreenDocument', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses chrome.runtime.getContexts instead of the removed browser polyfill', async () => {
    const chromeMock = installChromeMock({ contexts: [{ contextId: 'existing' }] });
    const { ensureOffscreenDocument } = await import('./offscreenDocument');

    await ensureOffscreenDocument();

    expect(chromeMock.getURL).toHaveBeenCalledWith('offscreen.html');
    expect(chromeMock.getContexts).toHaveBeenCalledWith({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: ['chrome-extension://extension-id/offscreen.html'],
    });
    expect(chromeMock.createDocument).not.toHaveBeenCalled();
  });

  it('creates the offscreen document when no current context exists', async () => {
    const chromeMock = installChromeMock({ contexts: [] });
    const { ensureOffscreenDocument } = await import('./offscreenDocument');

    await ensureOffscreenDocument();

    expect(chromeMock.createDocument).toHaveBeenCalledWith({
      url: 'offscreen.html',
      reasons: ['WORKERS'],
      justification: 'Metadata extraction and capture payload processing',
    });
  });
});
