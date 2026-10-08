import {
  ApprovalToBackgroundAction,
  type ApprovalRequest,
  type ApprovalRequestResponse,
  type ApprovalToBackgroundMessageType,
} from '@utils/types';
import { BRAND_LOGO_URL } from '@utils/brand';
import { BRAND } from '@config/brand';

import '../../styles/extensionBrand.css';
import '../../styles/buttons.css';
import './approval.css';

const app = document.getElementById('app');

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sendMessage<TResponse>(
  message: ApprovalToBackgroundMessageType,
): Promise<TResponse | undefined> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: TResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(undefined);
        return;
      }
      resolve(response);
    });
  });
}

function buildRequestView(request: ApprovalRequest): HTMLElement {
  const shell = createElement('div', 'shell');
  const header = createElement('header', 'header');
  const brand = createElement('div', 'brand-lockup');
  const logo = document.createElement('img');
  logo.src = BRAND_LOGO_URL;
  logo.alt = `${BRAND.shortName} logo`;
  brand.append(logo);
  header.append(brand);

  const content = createElement('section', 'content');
  content.setAttribute('aria-labelledby', 'approval-title');
  const title = createElement('h1', undefined, request.title);
  title.id = 'approval-title';
  const requester = createElement('p', 'requester');
  requester.append(
    createElement('span', 'requester-label', 'Requested by'),
    createElement('span', 'requester-value', request.origin),
  );
  content.append(title, requester);
  if (request.pluginTrust === 'unverified') {
    const alert = createElement('section', 'trust-warning');
    alert.role = 'alert';
    alert.append(
      createElement('h2', 'trust-warning-title', 'Unverified plugin'),
      createElement(
        'p',
        undefined,
        `${BRAND.shortName} could not verify this plugin. Malicious plugins can expose sensitive data or perform unwanted actions in your account. Only install code you trust.`,
      ),
    );
    content.append(alert);
  } else if (request.pluginTrust === 'verified') {
    content.append(createElement('p', 'trust-verified', 'Plugin verified by the configured provider registry'));
  }
  if (request.description) {
    content.append(createElement('p', 'description', request.description));
  }

  if (request.permissions?.length) {
    const permissionSection = createElement('section', 'request-section');
    permissionSection.append(createElement('h2', 'section-title', `This will allow ${BRAND.shortName} to:`));
    const permissions = createElement('ul', 'permissions');
    request.permissions.forEach((permission) => {
      permissions.append(createElement('li', undefined, permission));
    });
    permissionSection.append(permissions);
    content.append(permissionSection);
  }

  if (request.details?.length) {
    const detailSection = createElement('details', 'request-details');
    detailSection.open = !request.detailsCollapsed;
    detailSection.append(createElement('summary', 'section-title', 'Details'));
    const details = createElement('div', 'details');
    request.details.forEach(({ label, value }) => {
      const detail = createElement('div', 'detail');
      detail.append(
        createElement('div', 'detail-label', label),
        createElement('div', 'detail-value', value),
      );
      details.append(detail);
    });
    detailSection.append(details);
    content.append(detailSection);
  }

  if (request.warning) {
    content.append(createElement('p', 'warning', request.warning));
  }

  const actions = createElement('footer', 'actions');
  const buttons = createElement('div', 'action-buttons');
  const riskCheckbox = request.pluginTrust === 'unverified' ? createElement('input') : undefined;
  if (riskCheckbox) {
    riskCheckbox.type = 'checkbox';
    const label = createElement('label', 'risk-acknowledgement');
    label.append(riskCheckbox, createElement('span', undefined, 'I understand the risks.'));
    actions.append(label);
  }

  const respond = (approved: boolean, event: MouseEvent): void => {
    if (!event.isTrusted || (approved && riskCheckbox && !riskCheckbox.checked)) return;
    if (riskCheckbox) riskCheckbox.disabled = true;
    actions.querySelectorAll('button').forEach((button) => {
      button.disabled = true;
    });
    void sendMessage({
      action: ApprovalToBackgroundAction.RESPOND_TO_APPROVAL_REQUEST,
      approved,
      riskAcknowledged: riskCheckbox?.checked,
      requestId: request.requestId,
    });
  };

  const addAction = (variant: string, label: string, approved: boolean): HTMLButtonElement => {
    const button = createElement('button', `peer-button peer-button-${variant}`, label);
    button.type = 'button';
    button.addEventListener('click', (event) => respond(approved, event));
    buttons.append(button);
    return button;
  };

  addAction('secondary', request.rejectLabel, false);
  const install = addAction('primary', request.approveLabel, true);
  if (riskCheckbox) {
    install.disabled = true;
    riskCheckbox.addEventListener('change', () => {
      install.disabled = !riskCheckbox.checked;
    });
  }
  actions.append(buttons);
  if (request.pluginTrust) {
    const revoke = createElement('p', 'revoke');
    revoke.append('Revoke access anytime in ');
    const settings = createElement('a', undefined, 'Plugin settings');
    settings.href = chrome.runtime.getURL('manager.html');
    settings.target = '_blank';
    settings.rel = 'noopener noreferrer';
    revoke.append(settings, '.');
    actions.append(revoke);
  }

  shell.append(header, content, actions);
  return shell;
}

async function render(): Promise<void> {
  if (!app) return;

  const requestId = new URLSearchParams(window.location.search).get('request');
  if (!requestId) {
    app.replaceChildren(createElement('p', 'error', 'This approval request is invalid.'));
    return;
  }

  const response = await sendMessage<ApprovalRequestResponse>({
    action: ApprovalToBackgroundAction.GET_APPROVAL_REQUEST,
    requestId,
  });
  if (!response) {
    app.replaceChildren(
      createElement('p', 'error', 'This approval request expired or is no longer available.'),
    );
    return;
  }

  document.title = `${response.request.title} · ${BRAND.shortName}`;
  app.replaceChildren(buildRequestView(response.request));
}

void render();
