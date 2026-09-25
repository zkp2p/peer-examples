import variant from '@jitl/quickjs-wasmfile-release-sync';
import { loadQuickJs, type SandboxOptions } from '@sebastianwessel/quickjs';
import type { BuyerTeePaymentParams } from '@utils/buyerTeePaymentCapture';
import { captureNavigationUrl } from '@utils/captureNavigation';
import { captureHighlight } from '@utils/captureHighlight';
import { captureQuery } from '@utils/captureQuery';
import { captureReplayTarget } from '@utils/captureReplay';
import { byteLength, isRecord } from '@utils/valueGuards';
import type {
  CaptureMatchResult,
  CaptureNetworkEvent,
  CapturePageAction,
  CaptureParams,
  CaptureProgramResult,
  MetadataMessageType,
} from '@utils/types';
import { MAX_CAPTURE_SOURCE_BYTES, MAX_NETWORK_BODY_BYTES } from '@utils/types/captureProgram';

const MAX_CAPTURE_OUTPUT_BYTES = 256 * 1024;
const MAX_CAPTURE_ERROR_LENGTH = 200;
const MAX_CAPTURE_METADATA_ROWS = 100;
const MAX_PAGE_ACTIONS = 5;
const MAX_PAGE_ID_LENGTH = 256;
const MAX_PAGE_TARGET_LENGTH = 2_048;
const quickJs = loadQuickJs(variant);
const discard = () => undefined;
const silentConsole: NonNullable<SandboxOptions['console']> = {
  assert: discard,
  clear: discard,
  count: discard,
  countReset: discard,
  debug: discard,
  dir: discard,
  dirxml: discard,
  error: discard,
  group: discard,
  groupCollapsed: discard,
  groupEnd: discard,
  info: discard,
  log: discard,
  table: discard,
  time: discard,
  timeEnd: discard,
  timeLog: discard,
  trace: discard,
  warn: discard,
};

export async function warmCaptureProgram(): Promise<void> {
  await quickJs;
}

async function execute(
  source: string,
  expression: string,
  env: Record<string, unknown>,
): Promise<unknown> {
  if (!source.trim() || byteLength(source) > MAX_CAPTURE_SOURCE_BYTES) {
    throw new Error('Capture program source is invalid.');
  }
  const { runSandboxed } = await quickJs;
  const result = await runSandboxed(
    ({ evalCode }) =>
      evalCode(`
globalThis.process = undefined;
globalThis.fetch = undefined;
globalThis.XMLHttpRequest = undefined;
globalThis.WebSocket = undefined;
globalThis.EventSource = undefined;
${source}
const __peerResult = await (${expression});
export default JSON.stringify(__peerResult === undefined ? null : __peerResult);
`),
    {
      allowFetch: false,
      allowFs: false,
      console: silentConsole,
      env,
      executionTimeout: 5_000,
      maxIntervalCount: 0,
      maxStackSize: 512 * 1024,
      maxTimeoutCount: 0,
      memoryLimit: 8 * 1024 * 1024,
    },
  );

  if (!result.ok) {
    // Surface the plugin's own throw (bounded, single line) so provider failures
    // such as "Provider replied 401" reach the requesting page.
    const detail = String(result.error?.message ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_CAPTURE_ERROR_LENGTH);
    throw new Error(detail ? `Capture program failed: ${detail}` : 'Capture program failed.');
  }
  if (typeof result.data !== 'string') {
    throw new Error('Capture program failed.');
  }
  if (byteLength(result.data) > MAX_CAPTURE_OUTPUT_BYTES) {
    throw new Error('Capture program output exceeds the limit.');
  }
  return JSON.parse(result.data) as unknown;
}

function verifierParams(value: unknown): value is BuyerTeePaymentParams {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean',
    )
  );
}

function metadataRows(value: unknown): value is MetadataMessageType[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_CAPTURE_METADATA_ROWS &&
    value.every(
      (row) =>
        isRecord(row) &&
        typeof row.hidden === 'boolean' &&
        Number.isSafeInteger(row.originalIndex) &&
        Number(row.originalIndex) >= 0 &&
        Object.entries(row).every(([key, item]) => {
          if (key === 'params') return verifierParams(item);
          return (
            item === null ||
            typeof item === 'string' ||
            typeof item === 'boolean' ||
            (typeof item === 'number' && Number.isFinite(item))
          );
        }),
    )
  );
}

export async function executeCaptureMatch(
  source: string,
  request: CaptureNetworkEvent['request'],
  params: CaptureParams,
  origins: readonly string[] = [new URL(request.url).origin],
): Promise<CaptureMatchResult> {
  if (request.body !== null && byteLength(request.body) > MAX_NETWORK_BODY_BYTES) return false;
  const output = await execute(
    source,
    `typeof match === 'function' ? match({ request: env.request, params: env.params }) : null`,
    { request, params },
  );
  if (typeof output === 'boolean') return output;
  // A target makes this request the context for replaying the metadata request
  // the page never issues itself (legacy metadataUrl/fallback parity).
  const target = captureReplayTarget(output, origins, request.url);
  if (!target) {
    throw new Error(
      'Capture plugin must define match({ request, params }) returning a boolean or replay target.',
    );
  }
  return target;
}

export async function executeCaptureProgram(
  source: string,
  event: CaptureNetworkEvent,
  params: CaptureParams,
): Promise<CaptureProgramResult> {
  if (
    (event.request.body !== null && byteLength(event.request.body) > MAX_NETWORK_BODY_BYTES) ||
    (event.response.body !== null && byteLength(event.response.body) > MAX_NETWORK_BODY_BYTES)
  ) {
    throw new Error('Capture network body exceeds the limit.');
  }
  const output = await execute(
    source,
    `typeof capture === 'function'
      ? capture({ event: env.event, params: env.params })
      : null`,
    { event, params },
  );
  if (output === null) return output;
  const highlight = captureHighlight(output);
  if (highlight) return { highlight };
  const query = captureQuery(output, new URL(event.request.url).origin);
  if (query) return { query };
  const navigationUrl = captureNavigationUrl(output, new URL(event.request.url).origin);
  if (navigationUrl !== null) {
    if (Object.keys(params).length === 0)
      throw new Error('Capture navigation requires scoped params.');
    return { navigate: { url: navigationUrl } };
  }
  if (Object.keys(params).length === 0 && metadataRows(output)) return output;
  if (Object.keys(params).length > 0 && verifierParams(output)) return output;
  throw new Error('Capture program output is invalid.');
}

function parseElement(value: unknown, pageUrl: URL): { href: string } | { id: string } {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    throw new Error('Page element must contain exactly one of href or id.');
  }
  if (typeof value.id === 'string') {
    if (!value.id.trim() || value.id.length > MAX_PAGE_ID_LENGTH) {
      throw new Error('Page element id is invalid.');
    }
    return { id: value.id };
  }
  if (typeof value.href === 'string') {
    if (
      !value.href.startsWith('/') ||
      value.href.startsWith('//') ||
      value.href.length > MAX_PAGE_TARGET_LENGTH ||
      new URL(value.href, pageUrl).origin !== pageUrl.origin
    ) {
      throw new Error('Page element href is invalid.');
    }
    return { href: value.href };
  }
  throw new Error('Page element must contain exactly one of href or id.');
}

function parsePageActions(
  value: unknown,
  pageUrl: URL,
  inputs: ReadonlySet<string>,
): CapturePageAction[] {
  if (!Array.isArray(value) || value.length > MAX_PAGE_ACTIONS) {
    throw new Error(`Capture interaction is limited to ${MAX_PAGE_ACTIONS} actions.`);
  }
  const actions = value.map((item): CapturePageAction => {
    if (!isRecord(item) || typeof item.type !== 'string') {
      throw new Error('Capture page action is invalid.');
    }
    if (item.type === 'navigate') {
      if (
        Object.keys(item).some((key) => !['type', 'url'].includes(key)) ||
        typeof item.url !== 'string'
      ) {
        throw new Error('Capture navigation is invalid.');
      }
      const url = new URL(item.url, pageUrl);
      if (url.protocol !== 'https:' || url.origin !== pageUrl.origin) {
        throw new Error('Capture navigation must remain on the provider origin.');
      }
      return { type: 'navigate', url: url.href };
    }
    if (item.type === 'click') {
      if (Object.keys(item).some((key) => !['element', 'type'].includes(key))) {
        throw new Error('Capture click is invalid.');
      }
      return { element: parseElement(item.element, pageUrl), type: 'click' };
    }
    if (item.type === 'fill') {
      if (
        Object.keys(item).some((key) => !['element', 'input', 'type'].includes(key)) ||
        typeof item.input !== 'string' ||
        !inputs.has(item.input)
      ) {
        throw new Error('Capture fill must reference a supplied input.');
      }
      const element = parseElement(item.element, pageUrl);
      if (!('id' in element)) throw new Error('Capture fill must target an element id.');
      return { element, input: item.input, type: 'fill' };
    }
    throw new Error('Capture page action type is invalid.');
  });
  if (actions.some(({ type }) => type === 'navigate') && actions.length !== 1) {
    throw new Error('Capture navigation must be the only action.');
  }
  const clickIndexes = actions.flatMap((action, index) => (action.type === 'click' ? [index] : []));
  if (
    clickIndexes.length > 1 ||
    (clickIndexes.length === 1 && clickIndexes[0] !== actions.length - 1)
  ) {
    throw new Error('Capture interaction may click once, as its final action.');
  }
  return actions;
}

export async function executeCaptureInteraction({
  inputs,
  source,
  url,
}: {
  inputs: string[];
  source: string;
  url: string;
}): Promise<CapturePageAction[]> {
  const pageUrl = new URL(url);
  const publicUrl = `${pageUrl.origin}${pageUrl.pathname}`;
  const output = await execute(
    source,
    `typeof interact === 'function'
      ? interact({ inputs: env.inputs, url: env.url })
      : []`,
    { inputs, url: publicUrl },
  );
  return parsePageActions(output, pageUrl, new Set(inputs));
}
