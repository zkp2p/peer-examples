import type {
  CapturePageActionResponse,
  CapturePageElement,
  ResolvedCapturePageAction,
} from '@utils/types';

const FILL_INPUT_TYPES = new Set(['email', 'search', 'tel', 'text', 'url']);
const ELEMENT_WAIT_MS = 8_000;

function isVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return (
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.opacity !== '0' &&
    rect.width > 0 &&
    rect.height > 0
  );
}

function matchingElements(element: CapturePageElement): Element[] {
  if ('id' in element) {
    const candidate = document.getElementById(element.id);
    return candidate && isVisible(candidate) ? [candidate] : [];
  }
  const expectedUrl = new URL(element.href, window.location.origin).href;
  return Array.from(document.querySelectorAll('a[href]')).filter(
    (candidate) =>
      candidate instanceof HTMLAnchorElement &&
      isVisible(candidate) &&
      new URL(candidate.href, window.location.href).href === expectedUrl,
  );
}

function waitForElement(element: CapturePageElement): Promise<Element | null> {
  const current = matchingElements(element)[0];
  if (current) return Promise.resolve(current);
  return new Promise((resolve) => {
    const finish = (value: Element | null) => {
      window.clearTimeout(timeoutId);
      observer.disconnect();
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      const match = matchingElements(element)[0];
      if (match) finish(match);
    });
    const timeoutId = window.setTimeout(() => finish(null), ELEMENT_WAIT_MS);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

function assertClickable(element: Element): HTMLElement {
  if (!(element instanceof HTMLElement) || element.closest('form')) {
    throw new Error('Provider page click target is not allowed.');
  }
  if (element instanceof HTMLAnchorElement) {
    const href = element.getAttribute('href')?.trim() ?? '';
    const isInert = href === 'javascript:void(0)' || href === 'javascript:void(0);';
    const target = isInert ? null : new URL(element.href, window.location.href);
    if (
      element.hasAttribute('download') ||
      (element.target && element.target !== '_self') ||
      (target && (target.protocol !== 'https:' || target.origin !== window.location.origin))
    ) {
      throw new Error('Provider page link is not allowed.');
    }
    return element;
  }
  if (element.getAttribute('role') !== 'tab') {
    throw new Error('Provider page click target must be a same-origin link or tab.');
  }
  return element;
}

function assertFillable(element: Element): HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) {
    if (element.disabled || element.readOnly || element.value.length > 0) {
      throw new Error('Provider page field must be enabled, writable, and empty.');
    }
    return element;
  }
  if (
    !(element instanceof HTMLInputElement) ||
    !FILL_INPUT_TYPES.has(element.type) ||
    element.disabled ||
    element.readOnly ||
    element.value.length > 0
  ) {
    throw new Error('Provider page field must be an enabled, writable, empty text field.');
  }
  return element;
}

function fillField(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Provider page field cannot be filled.');
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function executeCapturePageAction(
  action: ResolvedCapturePageAction,
  expectedUrl: string,
): Promise<CapturePageActionResponse> {
  try {
    const currentUrl = () => `${window.location.origin}${window.location.pathname}`;
    if (currentUrl() !== expectedUrl) {
      throw new Error('Provider page changed before the action ran.');
    }
    if (action.type === 'navigate') {
      throw new Error('Provider page navigation must be handled by the extension host.');
    }
    const target = await waitForElement(action.element);
    if (!target) {
      return {
        error: 'Provider page element was not found.',
        reason: 'not_found',
        success: false,
      };
    }
    if (currentUrl() !== expectedUrl) {
      throw new Error('Provider page changed before the action ran.');
    }
    if (action.type === 'click') {
      assertClickable(target).click();
    } else {
      fillField(assertFillable(target), action.value);
    }
    return { success: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Provider page action failed.',
      reason: 'rejected',
      success: false,
    };
  }
}
