import type { UserInputConfig } from '@utils/types';

export const DEFAULT_WAIT_FOR_XPATH_MS = 8000;
export const DEFAULT_POLL_INTERVAL_MS = 250;

export function resolveUserInputTiming(userInput: UserInputConfig): {
  waitForXpathMs: number;
  pollIntervalMs: number;
} {
  const waitForXpathMs =
    typeof userInput.waitForXpathMs === 'number'
      ? Math.max(0, userInput.waitForXpathMs)
      : DEFAULT_WAIT_FOR_XPATH_MS;
  const pollIntervalMs =
    typeof userInput.pollIntervalMs === 'number'
      ? Math.max(0, userInput.pollIntervalMs)
      : DEFAULT_POLL_INTERVAL_MS;
  return { waitForXpathMs, pollIntervalMs };
}

export function evaluateXPathAll(xpath: string, root: Document | Element): Element[] {
  try {
    const snapshot = document.evaluate(
      xpath,
      root,
      null,
      XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
      null,
    );
    const out: Element[] = [];
    for (let i = 0; i < snapshot.snapshotLength; i += 1) {
      const item = snapshot.snapshotItem(i) as Element | null;
      if (item) out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

export function isVisible(el: Element): boolean {
  const rect = (el as HTMLElement).getBoundingClientRect();
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none' || (el as HTMLElement).hidden) {
    return false;
  }
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.bottom < 0 || rect.right < 0) return false;
  if (rect.top > (window.innerHeight || document.documentElement.clientHeight)) return false;
  if (rect.left > (window.innerWidth || document.documentElement.clientWidth)) return false;
  return true;
}

export function getVisibleXpathMatches(
  xpath: string,
  root: Document | Element = document,
): Element[] {
  const trimmed = (xpath || '').trim();
  if (!trimmed) return [];
  return evaluateXPathAll(trimmed, root).filter(isVisible);
}
