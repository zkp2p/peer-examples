import {
  BackgroundToContentAction,
  type BackgroundToContentMessageType,
} from '@utils/types/messages';
import type { UserInputConfig } from '@utils/types';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_WAIT_FOR_XPATH_MS,
  getVisibleXpathMatches,
  isVisible,
  resolveUserInputTiming,
} from '@utils/txClickGuideUtils';
import { captureHighlight, type CaptureHighlight } from '@utils/captureHighlight';
import {
  BRAND_IGNITE_YELLOW as ACCENT,
  BRAND_BORDER as BORDER_DARK,
  BRAND_FONT_STACK,
  BRAND_FOREGROUND as FG,
  BRAND_LOGO_PATH,
  BRAND_SHADOW_LG as SHADOW_LG,
  BRAND_SURFACE as DARK_BG,
} from '@utils/brand';

const STYLE_ID = 'zkp2p-click-guide-style';
const OVERLAY_ID = 'zkp2p-click-guide-root';
const HIGHLIGHT_ATTR = 'data-zkp2p-highlight';
const peerLogoUrl = chrome.runtime.getURL(BRAND_LOGO_PATH);

function opacify(percent: number, hex: string): string {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(100, percent)) / 100})`;
}

let teardownFn: (() => void) | null = null;
let mounted = false;
let runtimeListenerInstalled = false;
let pollTimeoutId: number | null = null;
let waitObserver: MutationObserver | null = null;
let waitStopAtMs: number | null = null;

type ClickGuide = {
  getMatches(): Element[];
  promptText?: string;
  waitForXpathMs: number;
  pollIntervalMs: number;
  dismissOnSelect?: boolean;
};

function ensureRuntimeListener() {
  if (runtimeListenerInstalled) return;

  chrome.runtime.onMessage.addListener(
    (message: BackgroundToContentMessageType, _sender, sendResponse) => {
      switch (message.action) {
        case BackgroundToContentAction.START_METADATA_CLICK_GUIDE:
          startClickGuide(message.data.userInput);
          break;
        case BackgroundToContentAction.START_CAPTURE_HIGHLIGHT:
          try {
            startCaptureHighlight(message.data.highlight, message.data.expectedUrl);
            sendResponse({ success: true });
          } catch (error) {
            sendResponse({
              success: false,
              error: error instanceof Error ? error.message : 'Capture highlight failed.',
            });
          }
          break;
        case BackgroundToContentAction.SEND_METADATA_MESSAGES_RESPONSE:
        case BackgroundToContentAction.STOP_METADATA_CLICK_GUIDE:
          try {
            teardownFn?.();
          } catch {
            // Cleanup is best effort when the page is navigating.
          }
          break;
        default:
          break;
      }
    },
  );

  runtimeListenerInstalled = true;
}

function injectHighlightStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    *[${HIGHLIGHT_ATTR}] {
      position: relative;
      outline: 2px solid ${ACCENT};
      outline-offset: 2px;
      box-shadow:
        0 0 0 8px ${opacify(18, ACCENT)},
        0 8px 24px ${opacify(35, '#000000')};
      border-radius: 8px;
    }
    @media (prefers-reduced-motion: no-preference) {
      *[${HIGHLIGHT_ATTR}]::after {
        content: "";
        position: absolute; inset: -6px; border-radius: 12px;
        box-shadow: 0 0 0 0 ${opacify(35, ACCENT)};
        animation: zkp2pPulse 1.4s ease-in-out infinite; pointer-events: none;
      }
      @keyframes zkp2pPulse {
        0% { box-shadow: 0 0 0 0 ${opacify(35, ACCENT)}; }
        70% { box-shadow: 0 0 0 14px ${opacify(0, ACCENT)}; }
        100% { box-shadow: 0 0 0 0 ${opacify(0, ACCENT)}; }
      }
    }
  `;
  document.head.appendChild(style);
}

function removeHighlightStyles() {
  document.getElementById(STYLE_ID)?.remove();
}

function ensureOverlayRoot(): ShadowRoot {
  const existing = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (existing?.shadowRoot) return existing.shadowRoot;

  const host = document.createElement('div');
  host.id = OVERLAY_ID;
  host.style.position = 'fixed';
  host.style.inset = '0';
  host.style.zIndex = '2147483647';
  host.style.pointerEvents = 'none';
  document.documentElement.appendChild(host);
  return host.attachShadow({ mode: 'open' });
}

function createBubble(root: ShadowRoot, text: string) {
  const wrap = document.createElement('div');
  wrap.style.position = 'absolute';
  wrap.style.pointerEvents = 'none';

  const bubble = document.createElement('div');
  bubble.id = 'zkp2p-bubble';
  bubble.textContent = text;
  bubble.style.setProperty('all', 'initial');
  bubble.style.display = 'block';
  bubble.style.background = DARK_BG;
  bubble.style.color = FG;
  bubble.style.fontFamily = BRAND_FONT_STACK;
  bubble.style.fontSize = '14px';
  bubble.style.lineHeight = '18px';
  bubble.style.padding = '10px 12px';
  bubble.style.borderRadius = '8px';
  bubble.style.border = `1px solid ${BORDER_DARK}`;
  bubble.style.boxShadow = SHADOW_LG;
  bubble.style.width = '420px';
  bubble.style.maxWidth = 'calc(100vw - 16px)';
  bubble.style.boxSizing = 'border-box';
  bubble.style.pointerEvents = 'auto';
  bubble.style.whiteSpace = 'normal';
  bubble.style.overflowWrap = 'anywhere';

  const logoRow = document.createElement('div');
  logoRow.style.display = 'flex';
  logoRow.style.alignItems = 'center';
  logoRow.style.gap = '8px';
  logoRow.style.width = '100%';
  logoRow.style.fontFamily = 'inherit';
  logoRow.style.fontSize = 'inherit';
  logoRow.style.lineHeight = 'inherit';

  const logo = document.createElement('img');
  logo.src = peerLogoUrl;
  logo.width = 20;
  logo.height = 20;
  logo.style.display = 'block';
  logo.style.borderRadius = '4px';
  logo.style.filter = 'saturate(0.95)';

  const textSpan = document.createElement('span');
  textSpan.textContent = bubble.textContent || '';
  textSpan.style.fontFamily = 'inherit';
  textSpan.style.fontSize = 'inherit';
  textSpan.style.lineHeight = 'inherit';
  textSpan.style.whiteSpace = 'normal';
  textSpan.style.overflowWrap = 'anywhere';
  textSpan.style.flex = '1 1 auto';
  bubble.textContent = '';
  logoRow.appendChild(logo);
  logoRow.appendChild(textSpan);
  bubble.appendChild(logoRow);

  const triangle = document.createElement('div');
  triangle.style.position = 'absolute';
  triangle.style.width = '0';
  triangle.style.height = '0';
  triangle.style.borderLeft = '8px solid transparent';
  triangle.style.borderRight = '8px solid transparent';
  triangle.style.borderTop = `8px solid ${DARK_BG}`;
  triangle.style.left = '16px';

  wrap.appendChild(bubble);
  wrap.appendChild(triangle);
  root.appendChild(wrap);

  return { wrap, bubble, triangle };
}

function positionBubbleNear(
  el: Element,
  wrap: HTMLDivElement,
  bubble: HTMLDivElement,
  triangle: HTMLDivElement,
) {
  const rect = (el as HTMLElement).getBoundingClientRect();
  const top = Math.max(8, rect.top - 12);
  const left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - bubble.getBoundingClientRect().width - 8),
  );
  wrap.style.top = `${top}px`;
  wrap.style.left = `${left}px`;
  bubble.style.transform = 'translateY(-100%)';
  triangle.style.top = '-8px';
}

function clearHighlights() {
  document
    .querySelectorAll(`[${HIGHLIGHT_ATTR}]`)
    .forEach((el) => el.removeAttribute(HIGHLIGHT_ATTR));
}

function stopWaiting() {
  if (pollTimeoutId !== null) {
    window.clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }
  if (waitObserver) {
    waitObserver.disconnect();
    waitObserver = null;
  }
  waitStopAtMs = null;
}

function startWaitingForMatches(guide: ClickGuide) {
  const { waitForXpathMs, pollIntervalMs } = guide;
  if (waitForXpathMs === 0) return;

  waitStopAtMs = waitForXpathMs > 0 ? Date.now() + waitForXpathMs : null;
  teardownFn = () => {
    stopWaiting();
    teardownFn = null;
  };

  const scheduleCheck = () => {
    if (pollTimeoutId !== null || mounted) return;
    pollTimeoutId = window.setTimeout(() => {
      pollTimeoutId = null;
      if (mounted) return;

      const matches = guide.getMatches();
      if (matches.length > 0) {
        mountClickGuide(guide, matches);
        stopWaiting();
        return;
      }
      if (waitStopAtMs !== null && Date.now() >= waitStopAtMs) {
        stopWaiting();
        return;
      }
      scheduleCheck();
    }, pollIntervalMs);
  };

  const root = document.body || document.documentElement;
  if (root) {
    waitObserver = new MutationObserver(scheduleCheck);
    waitObserver.observe(root, { childList: true, subtree: true });
  }

  scheduleCheck();
}

function mountClickGuide(guide: ClickGuide, matches: Element[]) {
  if (mounted) return;

  mounted = true;
  stopWaiting();
  (window as { __zkp2pActiveOverlay?: string }).__zkp2pActiveOverlay = 'click_guide';
  injectHighlightStyles();

  matches.forEach((n) => n.setAttribute(HIGHLIGHT_ATTR, '1'));

  const root = ensureOverlayRoot();
  const { wrap, bubble, triangle } = createBubble(
    root,
    guide.promptText || 'Click a transaction to extract metadata',
  );
  positionBubbleNear(matches[0], wrap, bubble, triangle);

  const onScroll = () => positionBubbleNear(matches[0], wrap, bubble, triangle);
  const onResize = onScroll;

  const onClick = (ev: Event) => {
    const target = ev.target as Element | null;
    const hit = target?.closest?.(`[${HIGHLIGHT_ATTR}]`);
    if (!hit) return;
    if (guide.dismissOnSelect) teardown();
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') teardown();
  };

  function teardown() {
    mounted = false;
    stopWaiting();
    clearHighlights();
    removeHighlightStyles();
    document.removeEventListener('click', onClick, true);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    document.getElementById(OVERLAY_ID)?.remove();
    (window as { __zkp2pActiveOverlay?: string }).__zkp2pActiveOverlay = undefined;
    teardownFn = null;
  }

  teardownFn = teardown;

  document.addEventListener('click', onClick, true);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);
}

function showClickGuide(guide: ClickGuide) {
  if (mounted) return;
  stopWaiting();

  const matches = guide.getMatches();
  if (matches.length === 0) {
    startWaitingForMatches(guide);
    return;
  }

  mountClickGuide(guide, matches);
}

function startClickGuide(userInput: UserInputConfig) {
  const xpath = (userInput.transactionXpath || '').trim();
  if (!xpath) return;
  showClickGuide({
    ...resolveUserInputTiming(userInput),
    getMatches: () => getVisibleXpathMatches(xpath, document),
    promptText: userInput.promptText,
  });
}

function startCaptureHighlight(value: CaptureHighlight['highlight'], expectedUrl: string): void {
  const highlight = captureHighlight({ highlight: value });
  if (!highlight || `${location.origin}${location.pathname}` !== expectedUrl) {
    throw new Error('Provider page changed before highlighting.');
  }
  teardownFn?.();
  const getMatches = () => {
    if (`${location.origin}${location.pathname}` !== expectedUrl) return [];
    return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .filter((link) => {
        try {
          const url = new URL(link.href, location.href);
          return (
            url.origin === location.origin &&
            !url.username &&
            !url.password &&
            url.pathname.startsWith(highlight.pathPrefix) &&
            !link.closest('form, [inert], [hidden]') &&
            !link.hasAttribute('download') &&
            window.getComputedStyle(link).opacity !== '0' &&
            isVisible(link)
          );
        } catch {
          return false;
        }
      })
      .slice(0, 100);
  };
  showClickGuide({
    getMatches,
    promptText: 'Select your payment',
    waitForXpathMs: DEFAULT_WAIT_FOR_XPATH_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    dismissOnSelect: true,
  });
}

(function initClickGuide() {
  try {
    if (document.contentType && !document.contentType.includes('html')) return;
    ensureRuntimeListener();
  } catch {
    // The guide is optional and must not block metadata capture.
  }
})();
