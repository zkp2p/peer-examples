import { BRAND } from '@config/brand';

type ApprovalPopupOptions = {
  approveLabel: string;
  description: string;
  details?: unknown;
  detailsLabel?: string;
  hostname: string;
  origin: string;
  permissions?: string[];
  rejectLabel: string;
  title: string;
  warning?: string;
};

// This approval surface renders as a self-contained dark glass card so it stays
// legible on top of any host page. Only the accent is brand-driven; restyle the
// neutral chrome below if your brand needs a light treatment.
const POPUP_ID = 'peer-approval-popup';
const POPUP_BG = '#000000';
const SURFACE_BG = '#181818';
const SURFACE_SUBTLE = '#101010';
const POPUP_BORDER = '#383838';
const TEXT_PRIMARY = '#ffffff';
const TEXT_SECONDARY = '#9a9a9a';
const TEXT_MUTED = '#777777';
const ACCENT = BRAND.theme.brand;
const TEXT_ON_ACCENT = BRAND.theme.brandContrast;
const ACCENT_GRADIENT = `linear-gradient(270deg, ${BRAND.theme.brand} 0%, ${BRAND.theme.accent} 100%)`;
const ACCENT_GRADIENT_HOVER = `linear-gradient(90deg, ${BRAND.theme.brand} 0%, ${BRAND.theme.accent} 100%)`;

let activePopupCleanup: ((approved: boolean) => void) | null = null;

function getMountNode(): HTMLElement {
  return document.body || document.documentElement;
}

function removeExistingPopup(): void {
  if (activePopupCleanup) {
    activePopupCleanup(false);
    activePopupCleanup = null;
    return;
  }

  document.getElementById(POPUP_ID)?.remove();
}

function appendShadowStyles(shadowRoot: ShadowRoot): void {
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial !important;
      position: fixed !important;
      left: auto !important;
      top: auto !important;
      right: 24px !important;
      bottom: 24px !important;
      width: min(520px, calc(100vw - 32px)) !important;
      min-width: 0 !important;
      max-width: calc(100vw - 32px) !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      display: block !important;
      overflow: visible !important;
      transform: none !important;
      z-index: 2147483647 !important;
      color-scheme: dark !important;
      contain: layout style paint !important;
      isolation: isolate !important;
      pointer-events: auto !important;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    button {
      appearance: none;
      font-family: inherit;
    }

    @keyframes peer-approval-slidein {
      from { transform: translateX(110%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    @media (max-width: 440px) {
      :host {
        right: 16px !important;
        bottom: 16px !important;
        width: calc(100vw - 32px) !important;
      }
    }
  `;
  shadowRoot.appendChild(style);
}

function applyHostIsolationStyles(host: HTMLElement): void {
  const styles: Array<[string, string]> = [
    ['all', 'initial'],
    ['position', 'fixed'],
    ['left', 'auto'],
    ['top', 'auto'],
    ['right', '24px'],
    ['bottom', '24px'],
    ['width', 'min(520px, calc(100vw - 32px))'],
    ['min-width', '0'],
    ['max-width', 'calc(100vw - 32px)'],
    ['height', 'auto'],
    ['min-height', '0'],
    ['max-height', 'none'],
    ['margin', '0'],
    ['padding', '0'],
    ['border', '0'],
    ['background', 'transparent'],
    ['display', 'block'],
    ['overflow', 'visible'],
    ['transform', 'none'],
    ['z-index', '2147483647'],
    ['color-scheme', 'dark'],
    ['contain', 'layout style paint'],
    ['isolation', 'isolate'],
    ['pointer-events', 'auto'],
  ];

  styles.forEach(([property, value]) => {
    host.style.setProperty(property, value, 'important');
  });
}

function createPopupHost(): { host: HTMLElement; shadowRoot: ShadowRoot } {
  const host = document.createElement('div');
  host.id = POPUP_ID;
  applyHostIsolationStyles(host);
  const shadowRoot = host.attachShadow({ mode: 'open' });
  appendShadowStyles(shadowRoot);
  return { host, shadowRoot };
}

function createButton(label: string, variant: 'primary' | 'secondary'): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.style.cssText = `
    flex: 1;
    min-height: 44px;
    padding: 11px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 160ms ease, border-color 160ms ease, transform 160ms ease;
  `;

  if (variant === 'primary') {
    button.style.background = ACCENT_GRADIENT;
    button.style.border = '1px solid transparent';
    button.style.color = TEXT_ON_ACCENT;
    button.onmouseenter = () => {
      button.style.background = ACCENT_GRADIENT_HOVER;
      button.style.transform = 'translateY(-1px)';
    };
    button.onmouseleave = () => {
      button.style.background = ACCENT_GRADIENT;
      button.style.transform = 'translateY(0)';
    };
  } else {
    button.style.background = SURFACE_SUBTLE;
    button.style.border = `1px solid ${POPUP_BORDER}`;
    button.style.color = TEXT_PRIMARY;
    button.onmouseenter = () => {
      button.style.background = SURFACE_BG;
      button.style.borderColor = TEXT_MUTED;
      button.style.transform = 'translateY(-1px)';
    };
    button.onmouseleave = () => {
      button.style.background = SURFACE_SUBTLE;
      button.style.borderColor = POPUP_BORDER;
      button.style.transform = 'translateY(0)';
    };
  }

  return button;
}

export function requestContentApproval({
  approveLabel,
  description,
  details,
  detailsLabel,
  hostname,
  origin,
  permissions,
  rejectLabel,
  title,
  warning,
}: ApprovalPopupOptions): Promise<boolean> {
  removeExistingPopup();

  return new Promise<boolean>((resolve) => {
    const { host, shadowRoot } = createPopupHost();
    const container = document.createElement('div');
    container.style.cssText = `
      width: 100%;
      overflow: hidden;
      background: ${POPUP_BG};
      border: 1px solid ${POPUP_BORDER};
      border-radius: 12px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.46), 0 8px 28px rgba(0, 0, 0, 0.36);
      color: ${TEXT_PRIMARY};
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      z-index: 2147483647;
      animation: peer-approval-slidein 220ms cubic-bezier(0.22, 1, 0.36, 1);
      backdrop-filter: blur(12px);
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 18px 20px;
      border-bottom: 1px solid ${POPUP_BORDER};
      background: ${SURFACE_SUBTLE};
    `;

    const logo = document.createElement('img');
    logo.src = chrome.runtime.getURL('icon-48.png');
    logo.style.cssText = 'width: 34px; height: 34px; object-fit: contain;';

    const titleEl = document.createElement('h3');
    titleEl.textContent = title;
    titleEl.style.cssText = `
      margin: 0;
      color: ${TEXT_PRIMARY};
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0;
      text-transform: uppercase;
    `;

    header.appendChild(logo);
    header.appendChild(titleEl);

    const content = document.createElement('div');
    content.style.cssText =
      'min-width: 0; max-width: 100%; padding: 18px 20px 20px; max-height: min(620px, calc(100vh - 160px)); overflow-y: auto;';

    const siteInfo = document.createElement('div');
    siteInfo.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 16px;';

    const siteIcon = document.createElement('div');
    siteIcon.style.cssText = `
      width: 44px;
      height: 44px;
      flex: 0 0 auto;
      border: 1px solid ${POPUP_BORDER};
      border-radius: 10px;
      background: ${SURFACE_BG};
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${TEXT_SECONDARY};
      font-size: 18px;
      font-weight: 700;
      overflow: hidden;
    `;

    const favicon = document.createElement('img');
    favicon.src = `${origin}/favicon.ico`;
    favicon.alt = '';
    favicon.style.cssText = 'width: 26px; height: 26px; border-radius: 4px;';
    favicon.onerror = () => {
      siteIcon.textContent = hostname.slice(0, 1).toUpperCase();
    };
    siteIcon.appendChild(favicon);

    const siteText = document.createElement('div');
    siteText.style.cssText = 'min-width: 0;';

    const hostEl = document.createElement('div');
    hostEl.textContent = hostname;
    hostEl.style.cssText = `
      color: ${TEXT_PRIMARY};
      font-size: 14px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    const originEl = document.createElement('div');
    originEl.textContent = origin;
    originEl.style.cssText = `
      margin-top: 3px;
      color: ${TEXT_MUTED};
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    siteText.appendChild(hostEl);
    siteText.appendChild(originEl);
    siteInfo.appendChild(siteIcon);
    siteInfo.appendChild(siteText);

    const descriptionEl = document.createElement('p');
    descriptionEl.textContent = description;
    descriptionEl.style.cssText = `
      margin: 0 0 12px;
      color: ${TEXT_SECONDARY};
      font-size: 13px;
      line-height: 1.45;
    `;

    const permissionBox = document.createElement('div');
    if (permissions?.length) {
      permissionBox.style.cssText = `
        margin: 0 0 16px;
        padding: 14px 16px;
        background: ${SURFACE_BG};
        border: 1px solid ${POPUP_BORDER};
        border-radius: 10px;
      `;

      const list = document.createElement('ul');
      list.style.cssText = `
        margin: 0;
        padding-left: 18px;
        color: ${TEXT_SECONDARY};
        font-size: 13px;
        line-height: 1.45;
      `;
      permissions.forEach((permission) => {
        const item = document.createElement('li');
        item.textContent = permission;
        item.style.marginBottom = '6px';
        list.appendChild(item);
      });
      permissionBox.appendChild(list);
    }

    const detailsBox = document.createElement('div');
    if (details !== undefined) {
      detailsBox.style.cssText = `
        width: 100%;
        min-width: 0;
        max-width: 100%;
        margin: 0 0 16px;
        border: 1px solid ${POPUP_BORDER};
        border-radius: 10px;
        background: ${SURFACE_SUBTLE};
        overflow: hidden;
      `;

      const detailsHeader = document.createElement('div');
      detailsHeader.textContent = detailsLabel ?? 'Data to share';
      detailsHeader.style.cssText = `
        padding: 10px 12px;
        border-bottom: 1px solid ${POPUP_BORDER};
        color: ${TEXT_PRIMARY};
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      `;

      const pre = document.createElement('pre');
      pre.textContent = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
      pre.style.cssText = `
        display: block;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        margin: 0;
        max-height: 260px;
        overflow: auto;
        padding: 12px;
        color: ${TEXT_SECONDARY};
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 11px;
        line-height: 1.45;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        word-break: break-word;
      `;

      detailsBox.appendChild(detailsHeader);
      detailsBox.appendChild(pre);
    }

    const warningEl = document.createElement('p');
    warningEl.textContent = warning ?? '';
    warningEl.style.cssText = `
      display: ${warning ? 'block' : 'none'};
      margin: 0 0 16px;
      color: ${ACCENT};
      font-size: 12px;
      line-height: 1.4;
    `;

    const buttonGroup = document.createElement('div');
    buttonGroup.style.cssText = 'display: flex; gap: 10px;';

    const rejectButton = createButton(rejectLabel, 'secondary');
    const approveButton = createButton(approveLabel, 'primary');

    const finish = (approved: boolean): void => {
      host.remove();
      if (activePopupCleanup === finish) {
        activePopupCleanup = null;
      }
      resolve(approved);
    };

    rejectButton.onclick = () => finish(false);
    approveButton.onclick = () => finish(true);
    activePopupCleanup = finish;

    buttonGroup.appendChild(rejectButton);
    buttonGroup.appendChild(approveButton);

    content.appendChild(siteInfo);
    content.appendChild(descriptionEl);
    if (permissions?.length) {
      content.appendChild(permissionBox);
    }
    if (details !== undefined) {
      content.appendChild(detailsBox);
    }
    content.appendChild(warningEl);
    content.appendChild(buttonGroup);

    container.appendChild(header);
    container.appendChild(content);
    shadowRoot.appendChild(container);
    getMountNode().appendChild(host);
  });
}
