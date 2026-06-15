import { BRAND } from '@config/brand';
import './popup.css';

// Mirrored in src/entries/Content/index.ts — a read-only popup status probe,
// not part of the typed message channels.
const GET_CONNECTION_STATUS_ACTION = 'peer_get_connection_status';

interface ConnectionStatusResponse {
  hostname?: string;
  status?: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const openTab = (url: string) => {
  void chrome.tabs.create({ url });
};

const queryConnectedHosts = async (): Promise<string[]> => {
  let tabs: chrome.tabs.Tab[] = [];
  try {
    tabs = await chrome.tabs.query({ url: BRAND.appOrigins });
  } catch {
    return [];
  }

  const responses = await Promise.all(
    tabs.flatMap((tab) => {
      if (tab.id === undefined) return [];
      return [
        chrome.tabs
          .sendMessage<{ action: string }, ConnectionStatusResponse>(tab.id, {
            action: GET_CONNECTION_STATUS_ACTION,
          })
          .catch(() => undefined),
      ];
    }),
  );

  const hosts = responses.flatMap((response) =>
    response?.status === 'connected' && response.hostname ? [response.hostname] : [],
  );
  return [...new Set(hosts)].sort();
};

const buildOriginsList = (hosts: string[]): HTMLElement => {
  const list = el('div', 'popup-origins');
  if (hosts.length === 0) {
    list.appendChild(el('div', 'origins-empty', 'No connected sites'));
    return list;
  }

  hosts.forEach((host) => {
    const row = el('div', 'origin-row');
    row.appendChild(el('span', 'origin-dot'));
    row.appendChild(el('span', 'origin-host mono', host));
    list.appendChild(row);
  });
  return list;
};

const render = (hosts: string[]) => {
  const root = document.getElementById('root');
  if (!root) return;

  const { version } = chrome.runtime.getManifest();
  const connected = hosts.length > 0;

  const card = el('div', 'popup-card');

  const header = el('div', 'popup-header');
  const mark = el('img', 'popup-mark');
  mark.src = chrome.runtime.getURL('icon-48.png');
  mark.alt = '';
  mark.width = 28;
  mark.height = 28;
  header.appendChild(mark);
  header.appendChild(el('div', 'popup-title', BRAND.name));

  const chip = el('span', `status-chip${connected ? ' status-chip--on' : ''}`);
  chip.appendChild(el('span', 'status-dot'));
  chip.appendChild(
    el('span', undefined, connected ? `Connected · ${hosts.length}` : 'Not connected'),
  );
  header.appendChild(chip);

  const openButton = el('button', 'popup-link', `Open ${BRAND.shortName}`);
  openButton.type = 'button';
  openButton.addEventListener('click', () => openTab(BRAND.webUrl));

  const footer = el('div', 'popup-footer');
  footer.appendChild(el('span', undefined, 'Privacy-preserving payment verification'));
  footer.appendChild(el('span', 'mono', `v${version}`));

  card.appendChild(header);
  card.appendChild(el('div', 'popup-section-label', 'Connected sites'));
  card.appendChild(buildOriginsList(hosts));
  card.appendChild(openButton);
  card.appendChild(footer);

  root.replaceChildren(card);
};

const init = async () => {
  render(await queryConnectedHosts());
};

void init();
