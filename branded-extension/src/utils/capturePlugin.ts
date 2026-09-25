import { BRAND } from '@config/brand';
import type { PeerCapturePlugin, PeerInitialAction } from '@utils/types/captureProgram';
import { byteLength } from './valueGuards';
import { MAX_CAPTURE_SOURCE_BYTES, type CaptureParams } from '@utils/types/captureProgram';

const MAX_CAPTURE_ORIGINS = 8;
const MAX_CAPTURE_PARAMS = 32;
const MAX_CAPTURE_PARAM_NAME_LENGTH = 128;
const MAX_INPUTS = 10;
const MAX_INPUT_VALUE_BYTES = 16 * 1024;
const MAX_PLUGIN_NAME_LENGTH = 80;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,99}\/[a-z0-9][a-z0-9_-]{0,99}$/u;

function assertPublicHttpsUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a public HTTPS URL.`);
  }

  const hostname = url.hostname.toLowerCase();
  const isIpAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname) || hostname.includes(':');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    isIpAddress ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new Error(`${label} must be a public HTTPS URL on port 443.`);
  }
  return url;
}

export function assertCapturePlugin(value: unknown, expectedId: string): PeerCapturePlugin {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Capture plugin must be a JSON object.');
  }
  const plugin = value as Partial<PeerCapturePlugin>;
  if (
    Object.keys(plugin).some(
      (key) =>
        ![
          'authLink',
          'focusOnOpen',
          'id',
          'name',
          'origins',
          'shouldSkipCloseTab',
          'source',
        ].includes(key),
    ) ||
    typeof plugin.authLink !== 'string' ||
    (plugin.focusOnOpen !== undefined && typeof plugin.focusOnOpen !== 'boolean') ||
    typeof plugin.id !== 'string' ||
    typeof plugin.name !== 'string' ||
    typeof plugin.shouldSkipCloseTab !== 'boolean' ||
    typeof plugin.source !== 'string' ||
    !Array.isArray(plugin.origins)
  ) {
    throw new Error('Capture plugin is invalid.');
  }
  if (!PLUGIN_ID_PATTERN.test(plugin.id) || plugin.id !== expectedId) {
    throw new Error('Capture plugin id does not match the requested provider action.');
  }

  const name = plugin.name.trim();
  if (!name || name.length > MAX_PLUGIN_NAME_LENGTH) {
    throw new Error('Capture plugin name is invalid.');
  }
  if (!plugin.source.trim() || byteLength(plugin.source) > MAX_CAPTURE_SOURCE_BYTES) {
    throw new Error('Capture plugin source is invalid.');
  }
  if (
    plugin.origins.length === 0 ||
    plugin.origins.length > MAX_CAPTURE_ORIGINS ||
    plugin.origins.some((origin) => typeof origin !== 'string')
  ) {
    throw new Error('Capture plugin origins are invalid.');
  }

  const origins = [
    ...new Set(
      plugin.origins.map((origin) => {
        const url = assertPublicHttpsUrl(origin, 'Capture origin');
        if (url.href !== `${url.origin}/`) {
          throw new Error('Capture origins must not include a path, query, or fragment.');
        }
        return url.origin;
      }),
    ),
  ].sort();
  const authLink = assertPublicHttpsUrl(plugin.authLink, 'Capture auth link');
  if (!origins.includes(authLink.origin)) {
    throw new Error('Capture auth link origin must be declared by the plugin.');
  }

  return {
    authLink: authLink.href,
    ...(plugin.focusOnOpen !== undefined ? { focusOnOpen: plugin.focusOnOpen } : {}),
    id: plugin.id,
    name,
    origins,
    shouldSkipCloseTab: plugin.shouldSkipCloseTab,
    source: plugin.source,
  };
}

export function isConfiguredCaptureOrigin(origin: string): boolean {
  const url = new URL(origin);
  return BRAND.hostDomains.some((pattern) => {
    const match = /^https:\/\/(\*\.)?([^/]+)\/\*$/.exec(pattern);
    if (!match) return false;
    const domain = match[2].toLowerCase();
    return url.protocol === 'https:' && (
      match[1] ? url.hostname === domain || url.hostname.endsWith(`.${domain}`) : url.hostname === domain
    );
  });
}

export async function capturePluginDigest(plugin: PeerCapturePlugin): Promise<string> {
  const json = JSON.stringify({
    authLink: plugin.authLink,
    focusOnOpen: plugin.focusOnOpen,
    id: plugin.id,
    name: plugin.name,
    origins: plugin.origins,
    shouldSkipCloseTab: plugin.shouldSkipCloseTab,
    source: plugin.source,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function captureOriginPatterns(plugin: PeerCapturePlugin): string[] {
  return plugin.origins.map((origin) => {
    const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return `^${escaped}(?:/|$)`;
  });
}

export function assertCaptureParams(value: unknown): CaptureParams {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Capture params must be an object.');
  }

  const entries = Object.entries(value);
  if (
    entries.length > MAX_CAPTURE_PARAMS ||
    entries.some(
      ([name, item]) =>
        !name ||
        name.length > MAX_CAPTURE_PARAM_NAME_LENGTH ||
        (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') ||
        (typeof item === 'string' && byteLength(item) > MAX_INPUT_VALUE_BYTES) ||
        (typeof item === 'number' && !Number.isFinite(item)),
    )
  ) {
    throw new Error('Capture params are invalid.');
  }
  return Object.fromEntries(entries) as CaptureParams;
}

export function assertInitialAction(value: unknown): Required<PeerInitialAction> {
  if (value === undefined) {
    return { enabled: false, paymentDetails: {} };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Initial action must be an object.');
  }
  const action = value as PeerInitialAction;
  if (
    Object.keys(action).some((key) => !['enabled', 'paymentDetails'].includes(key)) ||
    (action.enabled !== undefined && typeof action.enabled !== 'boolean') ||
    (action.paymentDetails !== undefined &&
      (typeof action.paymentDetails !== 'object' ||
        action.paymentDetails === null ||
        Array.isArray(action.paymentDetails)))
  ) {
    throw new Error('Initial action is invalid.');
  }

  const entries = Object.entries(action.paymentDetails ?? {});
  if (
    entries.length > MAX_INPUTS ||
    entries.some(
      ([name, value]) =>
        !/^[A-Z][A-Z0-9_]{0,63}$/u.test(name) ||
        typeof value !== 'string' ||
        byteLength(value) > MAX_INPUT_VALUE_BYTES,
    )
  ) {
    throw new Error('Initial action payment details are invalid.');
  }
  return {
    enabled: action.enabled !== false,
    paymentDetails: Object.fromEntries(entries),
  };
}
