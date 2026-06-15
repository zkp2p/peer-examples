import { logger } from '@utils/logger';

let creatingOffscreen: Promise<void> | null = null;

export async function ensureOffscreenDocument() {
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  const offscreenPath = 'offscreen.html';
  const offscreenUrl = chrome.runtime.getURL(offscreenPath);

  try {
    const runtimeWithContexts = chrome.runtime as typeof chrome.runtime & {
      getContexts?: (filter: {
        contextTypes: string[];
        documentUrls: string[];
      }) => Promise<Array<unknown>>;
    };
    const existingContexts = runtimeWithContexts.getContexts
      ? await runtimeWithContexts.getContexts({
          contextTypes: ['OFFSCREEN_DOCUMENT'],
          documentUrls: [offscreenUrl],
        })
      : [];

    if (existingContexts.length > 0) {
      return;
    }
  } catch (error) {
    logger.error('[Background] Error checking offscreen contexts:', error);
  }

  creatingOffscreen = (async () => {
    try {
      await (chrome as any).offscreen.createDocument({
        url: offscreenPath,
        reasons: ['WORKERS'],
        justification: 'Metadata extraction and capture payload processing',
      });
      logger.log('[Background] Offscreen document created');
    } catch (error: any) {
      if (error.message?.includes('An offscreen document already exists')) {
        logger.log('[Background] Offscreen document already exists');
      } else {
        logger.error('[Background] Error creating offscreen document:', error);
        throw error;
      }
    }
  })();

  await creatingOffscreen;
  creatingOffscreen = null;
}
