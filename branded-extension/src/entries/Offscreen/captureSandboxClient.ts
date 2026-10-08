import type {
  CaptureMatchResult,
  CaptureNetworkEvent,
  CapturePageAction,
  CaptureParams,
  CaptureProgramResult,
} from '@utils/types';

const CHANNEL = 'peer-capture-sandbox-v1';
const READY_TIMEOUT_MS = 3_000;
// Allow the five-second QuickJS budget plus message delivery overhead.
const EXECUTION_TIMEOUT_MS = 10_000;

type PendingRequest = {
  reject(error: Error): void;
  resolve(value: unknown): void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type SandboxResponse = {
  channel?: unknown;
  error?: unknown;
  id?: unknown;
  ready?: unknown;
  result?: unknown;
  success?: unknown;
};

const pendingRequests = new Map<string, PendingRequest>();
let readyPromise: Promise<void> | null = null;
let rejectReady: ((error: Error) => void) | null = null;
let resolveReady: (() => void) | null = null;

function iframe(): HTMLIFrameElement {
  const element = document.getElementById('capture-sandbox');
  if (!(element instanceof HTMLIFrameElement)) {
    throw new Error('Capture sandbox iframe is unavailable.');
  }
  return element;
}

function waitUntilReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        readyPromise = null;
        rejectReady = null;
        resolveReady = null;
        reject(new Error('Capture sandbox did not become ready.'));
      }, READY_TIMEOUT_MS);
      rejectReady = (error) => {
        clearTimeout(timeoutId);
        reject(error);
      };
      resolveReady = () => {
        clearTimeout(timeoutId);
        resolve();
      };
    });
  }
  iframe().contentWindow?.postMessage({ channel: CHANNEL, ping: true }, '*');
  return readyPromise;
}

function resetSandbox(error: Error): void {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeoutId);
    pending.reject(error);
  }
  pendingRequests.clear();
  readyPromise = null;
  rejectReady = null;
  resolveReady = null;
  const frame = iframe();
  frame.src = frame.src;
}

window.addEventListener('message', (event: MessageEvent<SandboxResponse>) => {
  const frame = iframe();
  if (event.source !== frame.contentWindow || event.origin !== 'null') return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL) return;

  if (message.ready === true) {
    resolveReady?.();
    rejectReady = null;
    resolveReady = null;
    return;
  }
  if (message.ready === false) {
    rejectReady?.(
      new Error(
        typeof message.error === 'string' ? message.error : 'Capture sandbox failed to initialize.',
      ),
    );
    readyPromise = null;
    rejectReady = null;
    resolveReady = null;
    return;
  }
  if (typeof message.id !== 'string') return;
  const pending = pendingRequests.get(message.id);
  if (!pending) return;
  pendingRequests.delete(message.id);
  clearTimeout(pending.timeoutId);
  if (message.success === true) {
    pending.resolve(message.result);
  } else {
    pending.reject(
      new Error(typeof message.error === 'string' ? message.error : 'Capture sandbox failed.'),
    );
  }
});

iframe().addEventListener('load', () => {
  iframe().contentWindow?.postMessage({ channel: CHANNEL, ping: true }, '*');
});

async function execute(
  operation: 'capture' | 'interact' | 'match',
  input: object,
): Promise<unknown> {
  await waitUntilReady();
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      resetSandbox(new Error('Capture sandbox timed out.'));
    }, EXECUTION_TIMEOUT_MS);
    pendingRequests.set(id, { reject, resolve, timeoutId });
    iframe().contentWindow?.postMessage({ channel: CHANNEL, id, input, operation }, '*');
  });
}

export async function warmCaptureSandbox(): Promise<void> {
  await waitUntilReady();
}

export async function runCaptureProgram(
  source: string,
  event: CaptureNetworkEvent,
  params: CaptureParams,
): Promise<CaptureProgramResult> {
  return (await execute('capture', { event, params, source })) as CaptureProgramResult;
}

export async function runCaptureMatch(
  source: string,
  request: CaptureNetworkEvent['request'],
  params: CaptureParams,
  origins: readonly string[],
): Promise<CaptureMatchResult> {
  // The sandbox validated the result against these origins; the host revalidates.
  return (await execute('match', { origins, request, params, source })) as CaptureMatchResult;
}

export async function runCaptureInteraction({
  inputs,
  source,
  url,
}: {
  inputs: string[];
  source: string;
  url: string;
}): Promise<CapturePageAction[]> {
  return (await execute('interact', { inputs, source, url })) as CapturePageAction[];
}
