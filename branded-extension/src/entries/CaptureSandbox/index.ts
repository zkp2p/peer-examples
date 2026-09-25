import type { CaptureParams } from '@utils/types';

import {
  executeCaptureInteraction,
  executeCaptureMatch,
  executeCaptureProgram,
  warmCaptureProgram,
} from './captureProgram';

const CHANNEL = 'peer-capture-sandbox-v1';

type SandboxRequest = {
  channel: typeof CHANNEL;
  id: string;
  input: Record<string, unknown>;
  operation: 'capture' | 'interact' | 'match';
};

type SandboxPing = { channel: typeof CHANNEL; ping: true };

async function announceReady(): Promise<void> {
  try {
    await warmCaptureProgram();
    window.parent.postMessage({ channel: CHANNEL, ready: true }, '*');
  } catch (error) {
    window.parent.postMessage(
      {
        channel: CHANNEL,
        error: error instanceof Error ? error.message : 'Capture sandbox failed to initialize.',
        ready: false,
      },
      '*',
    );
  }
}

function captureParams(value: unknown): CaptureParams {
  const entries =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? Object.entries(value)
      : null;
  if (
    !entries ||
    entries.some(
      ([, item]) =>
        (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') ||
        (typeof item === 'number' && !Number.isFinite(item)),
    )
  ) {
    throw new Error('Capture params are invalid.');
  }
  return Object.fromEntries(entries) as CaptureParams;
}

function isSandboxRequest(value: unknown): value is SandboxRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<SandboxRequest>).channel === CHANNEL &&
    typeof (value as Partial<SandboxRequest>).id === 'string' &&
    typeof (value as Partial<SandboxRequest>).input === 'object' &&
    ((value as Partial<SandboxRequest>).operation === 'capture' ||
      (value as Partial<SandboxRequest>).operation === 'match' ||
      (value as Partial<SandboxRequest>).operation === 'interact')
  );
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window.parent) return;
  const ping = event.data as Partial<SandboxPing> | null;
  if (ping?.channel === CHANNEL && ping.ping === true) {
    void announceReady();
    return;
  }
  if (!isSandboxRequest(event.data)) return;

  const { id, input, operation } = event.data;
  let task: Promise<unknown>;
  if (operation === 'capture') {
    task = Promise.resolve().then(() =>
      executeCaptureProgram(
        String(input.source ?? ''),
        input.event as never,
        captureParams(input.params),
      ),
    );
  } else if (operation === 'match') {
    task = Promise.resolve().then(() =>
      executeCaptureMatch(
        String(input.source ?? ''),
        input.request as never,
        captureParams(input.params),
        Array.isArray(input.origins)
          ? input.origins.filter((value): value is string => typeof value === 'string')
          : undefined,
      ),
    );
  } else {
    task = executeCaptureInteraction({
      inputs: Array.isArray(input.inputs)
        ? input.inputs.filter((value): value is string => typeof value === 'string')
        : [],
      source: String(input.source ?? ''),
      url: String(input.url ?? ''),
    });
  }

  void task
    .then((result) => {
      window.parent.postMessage({ channel: CHANNEL, id, result, success: true }, '*');
    })
    .catch((error) => {
      window.parent.postMessage(
        {
          channel: CHANNEL,
          error: error instanceof Error ? error.message : 'Capture sandbox failed.',
          id,
          success: false,
        },
        '*',
      );
    });
});

void announceReady();
