import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import { ContentToBackgroundAction } from '@utils/types';

let loginObserver: MutationObserver | null = null;

export function watchCaptureLogin(enabled: boolean): void {
  loginObserver?.disconnect();
  loginObserver = null;
  if (!enabled) return;

  const checkLogin = () => {
    const fields = document.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete~="username"], input[autocomplete~="one-time-code"]',
    );
    const requiresLogin = Array.from(fields).some((field) => {
      const style = getComputedStyle(field);
      const rect = field.getBoundingClientRect();
      return (
        !field.disabled &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        style.opacity !== '0'
      );
    });
    if (!requiresLogin) return;
    watchCaptureLogin(false);
    // Report presence only. Never read a credential field's value.
    void safeChromeRuntimeSendMessage({ action: ContentToBackgroundAction.CAPTURE_LOGIN_REQUIRED });
  };

  loginObserver = new MutationObserver(checkLogin);
  loginObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type', 'autocomplete', 'class', 'style', 'hidden', 'disabled'],
  });
  checkLogin();
}
