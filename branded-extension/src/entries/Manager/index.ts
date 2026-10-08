import { safeChromeRuntimeSendMessage } from '@utils/extensionMessaging';
import { BRAND_LOGO_URL } from '@utils/brand';
import { BRAND } from '@config/brand';
import type {
  CapturePluginRecord,
  ConnectedSiteRecord,
  ExtensionManagerState,
} from '@utils/extensionState';
import { ManagerToBackgroundAction } from '@utils/types';

import '../../styles/extensionBrand.css';
import '../../styles/buttons.css';
import './manager.css';

type ManagerResponse = {
  error?: string;
  state?: ExtensionManagerState;
  success?: boolean;
};

const appElement = document.getElementById('app');
if (!appElement) throw new Error('Extension settings root is missing.');
const app: HTMLElement = appElement;
app.classList.add('manager-shell');

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

async function send(message: unknown): Promise<ExtensionManagerState> {
  const response = await safeChromeRuntimeSendMessage<ManagerResponse>(message);
  if (!response?.success || !response.state) {
    throw new Error(response?.error ?? `${BRAND.shortName} settings are unavailable.`);
  }
  return response.state;
}

function removeButton(label: string, action: unknown): HTMLButtonElement {
  const button = element('button', 'Remove', 'peer-button peer-button-tertiary remove-button');
  button.type = 'button';
  button.ariaLabel = label;
  button.addEventListener('click', () => {
    button.disabled = true;
    void send(action)
      .then(render)
      .catch(showError)
      .finally(() => {
        button.disabled = false;
      });
  });
  return button;
}

function pluginRow(record: CapturePluginRecord): HTMLElement {
  const row = element('li', undefined, 'manager-row');
  const copy = element('div', undefined, 'item-copy');
  copy.append(
    element('strong', record.plugin.name),
    element('small', record.sourceOrigin, 'item-meta'),
  );
  row.append(
    copy,
    removeButton(`Remove ${record.plugin.name} for ${record.sourceOrigin}`, {
      action: ManagerToBackgroundAction.REMOVE_CAPTURE_PLUGIN,
      data: { id: record.plugin.id, sourceOrigin: record.sourceOrigin },
    }),
  );
  return row;
}

function siteRow(record: ConnectedSiteRecord): HTMLElement {
  const row = element('li', undefined, 'manager-row');
  const copy = element('div', undefined, 'item-copy');
  copy.append(element('strong', record.hostname), element('small', record.origin, 'item-meta'));
  row.append(
    copy,
    removeButton(`Disconnect ${record.hostname}`, {
      action: ManagerToBackgroundAction.REMOVE_CONNECTED_SITE,
      data: { origin: record.origin },
    }),
  );
  return row;
}

function section(title: string, rows: HTMLElement[], empty: string): HTMLElement {
  const section = element('section', undefined, 'manager-section');
  section.append(element('h2', title));
  if (rows.length === 0) {
    section.append(element('p', empty, 'empty-state'));
  } else {
    const list = element('ul', undefined, 'manager-list');
    list.append(...rows);
    section.append(list);
  }
  return section;
}

function render(state: ExtensionManagerState): void {
  document.title = `${BRAND.shortName} settings`;
  const header = element('header', undefined, 'manager-header');
  const brandRow = element('div', undefined, 'manager-brand-row');
  const logo = document.createElement('img');
  logo.className = 'manager-logo';
  logo.src = BRAND_LOGO_URL;
  logo.alt = `${BRAND.shortName} logo`;
  brandRow.append(logo);
  header.append(brandRow, element('h1', 'Settings'));
  app.replaceChildren(
    header,
    section('Plugins', state.plugins.map(pluginRow), 'No plugins.'),
    section('Sites', state.connectedSites.map(siteRow), 'No sites.'),
  );
}

function showError(error: unknown): void {
  const message = element(
    'p',
    error instanceof Error ? error.message : `Unable to load ${BRAND.shortName} settings.`,
    'state-message state-error',
  );
  message.role = 'alert';
  app.replaceChildren(message);
}

function load(): void {
  void send({ action: ManagerToBackgroundAction.GET_MANAGER_STATE }).then(render).catch(showError);
}

chrome.storage.onChanged.addListener((_changes, areaName) => {
  if (areaName === 'local') load();
});
load();
