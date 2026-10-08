import { logger } from '@utils/logger';
import { BRAND } from '@config/brand';

const peerLogoUrl = chrome.runtime.getURL('icon-128.png');

function opacify(percent: number, hex: string): string {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, percent)) / 100})`;
}

const spinnerOverlayTokens = {
  brandName: BRAND.shortName,
  overlayBg: opacify(50, '#000000'),
  overlayText: '#ffffff',
  cardBg: '#101010',
  cardRadius: '16px',
  cardShadow: '0 20px 60px rgba(0, 0, 0, 0.35)',
  spinnerTrack: opacify(35, '#ffffff'),
  spinnerAccent: BRAND.theme.brand,
  titleColor: '#ffffff',
  titleSize: '18px',
  titleWeight: '600',
  bodyColor: '#ffffff',
  bodySize: '14px',
  poweredByColor: '#a7a7a7',
  closeColor: opacify(60, '#ffffff'),
} as const;

const successSpinnerTokens = {
  successColor: '#28c76f',
} as const;

const isMissingTabError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message)
          : '';

  return message.toLowerCase().includes('no tab with id');
};

export async function injectSpinner(tabId: number) {
  return new Promise<void>((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        logger.warn(`[injectSpinner] Tab ${tabId} does not exist. Skipping injection.`);
        return resolve();
      }
      if (!tab.active) return resolve();

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: (tokens: typeof spinnerOverlayTokens, logoUrl: string) => {
            const existingOverlay = document.getElementById('zkp2p-redirect-overlay');
            if (existingOverlay) return;

            const overlay = document.createElement('div');
            overlay.id = 'zkp2p-redirect-overlay';
            overlay.style.setProperty('all', 'initial');
            const systemFont =
              "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol'";
            overlay.style.setProperty('font-family', systemFont, 'important');
            overlay.style.setProperty('color', tokens.overlayText, 'important');
            overlay.style.position = 'fixed';
            overlay.style.top = '0';
            overlay.style.left = '0';
            overlay.style.width = '100%';
            overlay.style.height = '100%';
            overlay.style.backgroundColor = tokens.overlayBg;
            overlay.style.display = 'flex';
            overlay.style.alignItems = 'center';
            overlay.style.justifyContent = 'center';
            overlay.style.zIndex = '999999';
            overlay.style.boxSizing = 'border-box';

            const modalCard = document.createElement('div');
            modalCard.style.backgroundColor = tokens.cardBg;
            modalCard.style.borderRadius = tokens.cardRadius;
            modalCard.style.boxShadow = tokens.cardShadow;
            modalCard.style.display = 'flex';
            modalCard.style.flexDirection = 'column';
            modalCard.style.alignItems = 'center';
            modalCard.style.width = '400px';
            modalCard.style.height = '380px';
            modalCard.style.boxSizing = 'border-box';
            modalCard.style.padding = '28px 32px';
            modalCard.style.position = 'relative';
            modalCard.style.setProperty('font-family', systemFont, 'important');

            const spinnerWrapper = document.createElement('div');
            spinnerWrapper.style.position = 'relative';
            spinnerWrapper.style.width = '128px';
            spinnerWrapper.style.height = '128px';
            spinnerWrapper.style.marginTop = '32px';
            spinnerWrapper.style.marginBottom = '32px';

            const spinnerRing = document.createElement('div');
            spinnerRing.id = 'zkp2p-spinner';
            spinnerRing.style.position = 'absolute';
            spinnerRing.style.top = '0';
            spinnerRing.style.left = '0';
            spinnerRing.style.width = '100%';
            spinnerRing.style.height = '100%';
            spinnerRing.style.border = `6px solid ${tokens.spinnerTrack}`;
            spinnerRing.style.borderTopColor = tokens.spinnerAccent;
            spinnerRing.style.borderRadius = '50%';
            spinnerRing.style.animation = 'zkp2p-spin 1s linear infinite';

            const pLogo = document.createElement('img');
            pLogo.src = logoUrl;
            pLogo.style.position = 'absolute';
            pLogo.style.top = '50%';
            pLogo.style.left = '50%';
            pLogo.style.transform = 'translate(-50%, -50%)';
            pLogo.style.width = '64px';
            pLogo.style.height = '64px';

            spinnerWrapper.appendChild(spinnerRing);
            spinnerWrapper.appendChild(pLogo);

            const title = document.createElement('h3');
            title.id = 'zkp2p-title';
            title.innerText = 'Authenticating...';
            title.style.margin = '12px 0 0';
            title.style.fontWeight = tokens.titleWeight;
            title.style.fontSize = tokens.titleSize;
            title.style.color = tokens.titleColor;
            title.style.textTransform = 'uppercase';
            title.style.setProperty('font-family', systemFont, 'important');

            const redirectMsg = document.createElement('p');
            redirectMsg.id = 'zkp2p-redirect-msg';
            redirectMsg.style.minHeight = '22px';
            redirectMsg.style.fontSize = tokens.bodySize;
            redirectMsg.style.color = tokens.bodyColor;
            redirectMsg.style.textAlign = 'center';
            redirectMsg.style.margin = '12px 0 0';
            redirectMsg.style.setProperty('font-family', systemFont, 'important');

            const poweredBy = document.createElement('p');
            poweredBy.id = 'zkp2p-poweredby';
            poweredBy.innerText = `Powered by ${tokens.brandName}`;
            poweredBy.style.fontSize = tokens.bodySize;
            poweredBy.style.color = tokens.poweredByColor;
            poweredBy.style.marginTop = 'auto';
            poweredBy.style.marginBottom = '12px';
            poweredBy.style.setProperty('font-family', systemFont, 'important');

            const closeBtn = document.createElement('button');
            closeBtn.innerText = 'x';
            closeBtn.style.position = 'absolute';
            closeBtn.style.top = '12px';
            closeBtn.style.right = '16px';
            closeBtn.style.background = 'none';
            closeBtn.style.border = 'none';
            closeBtn.style.fontSize = '24px';
            closeBtn.style.color = tokens.closeColor;
            closeBtn.style.cursor = 'pointer';
            closeBtn.style.setProperty('font-family', systemFont, 'important');
            closeBtn.onclick = () => overlay.remove();

            const styleEl = document.createElement('style');
            styleEl.innerHTML = `
              @keyframes zkp2p-spin {
                to { transform: rotate(360deg); }
              }
            `;

            modalCard.appendChild(title);
            modalCard.appendChild(spinnerWrapper);
            modalCard.appendChild(redirectMsg);
            modalCard.appendChild(poweredBy);

            overlay.appendChild(styleEl);
            overlay.appendChild(modalCard);
            overlay.appendChild(closeBtn);

            document.body.appendChild(overlay);
          },
          args: [spinnerOverlayTokens, peerLogoUrl],
        },
        () => {
          if (chrome.runtime.lastError) {
            logger.warn(
              `[injectSpinner] Failed to inject into tab ${tabId}: ${chrome.runtime.lastError.message}`,
            );
          }
          resolve();
        },
      );
    });
  });
}

async function updateSpinnerToGreenAndStatic(tabId: number) {
  return new Promise<void>((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        logger.warn(
          `[updateSpinnerToGreenAndStatic] Tab ${tabId} does not exist. Skipping update.`,
        );
        return resolve();
      }

      chrome.scripting.executeScript(
        {
          target: { tabId },
          func: (tokens: typeof successSpinnerTokens) => {
            const spinner = document.getElementById('zkp2p-spinner');
            if (spinner) {
              spinner.style.animation = 'none';
              spinner.style.border = `6px solid ${tokens.successColor}`;
              spinner.style.borderTopColor = tokens.successColor;
            }
            const title = document.getElementById('zkp2p-title');
            if (title) {
              title.innerText = 'Successfully Authenticated';
            }
          },
          args: [successSpinnerTokens],
        },
        () => {
          if (chrome.runtime.lastError) {
            logger.warn(
              `[updateSpinnerToGreenAndStatic] Failed to update spinner in tab ${tabId}: ${chrome.runtime.lastError.message}`,
            );
          }
          resolve();
        },
      );
    });
  });
}

export async function showAuthSuccessAndWait(tabId: number, countdownSeconds = 2): Promise<void> {
  await updateSpinnerToGreenAndStatic(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: async (seconds: number) => {
        const redirectMsg = document.getElementById('zkp2p-redirect-msg');
        for (let remaining = seconds; remaining > 0; remaining -= 1) {
          if (redirectMsg) redirectMsg.textContent = `Redirecting in ${remaining}...`;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        document.getElementById('zkp2p-redirect-overlay')?.remove();
      },
      args: [countdownSeconds],
    });
  } catch (error) {
    if (isMissingTabError(error)) {
      logger.warn(`[Background] Auth tab ${tabId} closed before the success overlay finished`);
      return;
    }
    logger.warn('[Background] Failed to show auth success overlay:', error);
  } finally {
    await removeAuthOverlay(tabId);
  }
}

export async function removeAuthOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.getElementById('zkp2p-redirect-overlay')?.remove(),
    });
  } catch (error) {
    if (isMissingTabError(error)) return;
    logger.warn('[Background] Failed to remove auth overlay:', error);
  }
}
