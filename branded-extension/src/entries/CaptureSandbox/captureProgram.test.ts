// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import type { CaptureNetworkEvent } from '@utils/types';
import {
  executeCaptureInteraction,
  executeCaptureMatch,
  executeCaptureProgram,
} from './captureProgram';

const event: CaptureNetworkEvent = {
  request: {
    body: null,
    method: 'GET',
    url: 'https://provider.example/activity',
  },
  response: {
    body: JSON.stringify({ payments: [{ amount: '10.00', id: 'payment-1' }] }),
    status: 200,
    url: 'https://provider.example/activity',
  },
};

describe('capture program', () => {
  it('returns a validated passive highlight without turning it into metadata', async () => {
    await expect(
      executeCaptureProgram(
        `function capture() { return { highlight: { pathPrefix: '/history/' } }; }`,
        event,
        {},
      ),
    ).resolves.toEqual({ highlight: { pathPrefix: '/history/' } });
    await expect(
      executeCaptureProgram(
        `function capture() { return { highlight: { pathPrefix: '//evil.example/' } }; }`,
        event,
        {},
      ),
    ).rejects.toThrow('Capture highlight');
  });
  it('allows capture work beyond the former one-second deadline', async () => {
    await expect(
      executeCaptureProgram(
        `function capture() {
            const started = Date.now();
            while (Date.now() - started < 1_250) {}
            return null;
          }`,
        event,
        {},
      ),
    ).resolves.toBeNull();
  }, 15_000);

  it('still interrupts a runaway plugin and allows the next capture', async () => {
    await expect(
      executeCaptureProgram('function capture() { while (true) {} }', event, {}),
    ).rejects.toThrow('maximum allowed time limit');
    await expect(
      executeCaptureProgram('function capture() { return null; }', event, {}),
    ).resolves.toBeNull();
  }, 15_000);

  it('matches only redacted request data before a response is available', async () => {
    const source = `function match({ request, params }) {
      return request.url === params.url && typeof chrome === 'undefined' && typeof fetch === 'undefined' &&
        !Object.hasOwn(request, 'headers') && typeof response === 'undefined';
    }`;
    await expect(
      executeCaptureMatch(source, event.request, { url: event.request.url }),
    ).resolves.toBe(true);
    await expect(
      executeCaptureMatch(source, event.request, { url: 'https://elsewhere.example/' }),
    ).resolves.toBe(false);
  });

  it.each(['', 'function match() { return 1; }', 'function match() { throw Error(); }'])(
    'fails closed for missing, invalid, or failing request matchers',
    async (source) => {
      await expect(
        executeCaptureMatch(source || 'function capture() { return null; }', event.request, {}),
      ).rejects.toThrow();
    },
  );

  it('lets a matcher select a same-origin replay target instead of the request', async () => {
    const source = `function match({ request }) {
      if (request.url.endsWith('?count=20')) return true;
      return { url: new URL(request.url).origin + '/api/history?count=20' };
    }`;
    await expect(executeCaptureMatch(source, event.request, {})).resolves.toEqual({
      body: null,
      method: 'GET',
      url: 'https://provider.example/api/history?count=20',
    });
    await expect(
      executeCaptureMatch(
        source,
        { ...event.request, url: 'https://provider.example/api/history?count=20' },
        {},
      ),
    ).resolves.toBe(true);
  });

  it.each([
    "function match() { return { url: 'https://evil.example/api/history' }; }",
    "function match() { return { url: 'https://provider.example/api', method: 'DELETE' }; }",
    "function match() { return { url: 'https://provider.example/api', body: '{}' }; }",
    "function match() { return { url: 'https://provider.example/api', headers: {} }; }",
    "function match() { return 'https://provider.example/api'; }",
  ])('fails closed for invalid replay targets: %s', async (source) => {
    await expect(executeCaptureMatch(source, event.request, {})).rejects.toThrow();
  });

  it('rejects a replay target on another approved origin before returning it to the host', async () => {
    await expect(
      executeCaptureMatch(
        "function match() { return { url: 'https://collector.example/collect' }; }",
        event.request,
        {},
        ['https://provider.example', 'https://collector.example'],
      ),
    ).rejects.toThrow('Capture replay target must remain on the captured request origin.');
  });

  it('surfaces a bounded single-line plugin error message', async () => {
    const message = 'Provider replied 401 to the payment list request.';
    await expect(
      executeCaptureProgram(
        `function capture() { throw new Error(${JSON.stringify(message)}); }`,
        event,
        {},
      ),
    ).rejects.toThrow(`Capture program failed: ${message}`);
    await expect(
      executeCaptureProgram(
        `function capture() { throw new Error(${JSON.stringify('line one\n  line two ' + 'x'.repeat(400))}); }`,
        event,
        {},
      ),
    ).rejects.toThrow(/^Capture program failed: line one line two x{100,}$/);
    await expect(
      executeCaptureProgram('function capture() { throw undefined; }', event, {}),
    ).rejects.toThrow('Capture program failed');
  });

  it('skips oversized request inputs without executing plugin source', async () => {
    await expect(
      executeCaptureMatch(
        'function match() { throw Error(); }',
        {
          ...event.request,
          body: 'x'.repeat(2 * 1024 * 1024 + 1),
        },
        {},
      ),
    ).resolves.toBe(false);
  });

  it('accepts only scoped, same-origin navigation continuations', async () => {
    const source = `function capture() { return { navigate: { url: 'https://provider.example/detail/one' } }; }`;
    await expect(executeCaptureProgram(source, event, { amount: '10.00' })).resolves.toEqual({
      navigate: { url: 'https://provider.example/detail/one' },
    });
    await expect(executeCaptureProgram(source, event, {})).rejects.toThrow(
      'requires scoped params',
    );
    for (const target of [
      'https://evil.example/',
      'http://provider.example/',
      'https://user:password@provider.example/',
    ]) {
      await expect(
        executeCaptureProgram(
          `function capture() { return { navigate: { url: ${JSON.stringify(target)} } }; }`,
          event,
          { amount: '10.00' },
        ),
      ).rejects.toThrow();
    }
    await expect(
      executeCaptureProgram(
        `function capture() { return { navigate: { url: 'https://provider.example/', body: 'forbidden' } }; }`,
        event,
        { amount: '10.00' },
      ),
    ).rejects.toThrow();
  });
  it('matches a payment and returns only verifier params', async () => {
    const source = `
function capture({ event, params: expected }) {
  const payment = JSON.parse(event.response.body).payments[0];
  if (payment.amount !== expected.amount || expected.attempt !== 2 || expected.pending) return null;
  return {
    PAYMENT_ID: payment.id,
    isolated: typeof chrome === 'undefined' &&
      typeof fetch === 'undefined' &&
      !Object.hasOwn(event.request, 'headers')
  };
}`;

    await expect(
      executeCaptureProgram(source, event, { amount: '10.00', attempt: 2, pending: false }),
    ).resolves.toEqual({ PAYMENT_ID: 'payment-1', isolated: true });
  });

  it('accepts validated metadata rows and rejects malformed arrays', async () => {
    await expect(
      executeCaptureProgram('function capture() { return null; }', event, {}),
    ).resolves.toBeNull();
    await expect(
      executeCaptureProgram(
        `function capture() {
          return [{ hidden: false, originalIndex: 0, paymentId: 'payment-1' }];
        }`,
        event,
        {},
      ),
    ).resolves.toEqual([{ hidden: false, originalIndex: 0, paymentId: 'payment-1' }]);
    await expect(
      executeCaptureProgram('function capture() { return [{}]; }', event, {}),
    ).rejects.toThrow('Capture program output is invalid.');
    await expect(
      executeCaptureProgram(
        `function capture() { return { PAYMENT_ID: 'payment-1' }; }`,
        event,
        {},
      ),
    ).rejects.toThrow('Capture program output is invalid.');
    await expect(
      executeCaptureProgram(
        `function capture() {
          return [{ hidden: false, originalIndex: 0, paymentId: 'payment-1' }];
        }`,
        event,
        { amount: '10.00' },
      ),
    ).rejects.toThrow('Capture program output is invalid.');
  });

  it('returns symbolic fill actions without receiving payment values', async () => {
    const source = `
function interact({ inputs }) {
  if (!inputs.includes('AMOUNT')) return [];
  return [{ type: 'fill', element: { id: 'amount' }, input: 'AMOUNT' }];
}`;
    await expect(
      executeCaptureInteraction({
        inputs: ['AMOUNT'],
        source,
        url: 'https://provider.example/pay?private=value',
      }),
    ).resolves.toEqual([{ element: { id: 'amount' }, input: 'AMOUNT', type: 'fill' }]);
  });

  it('rejects page actions outside the fixed capability vocabulary', async () => {
    await expect(
      executeCaptureInteraction({
        inputs: [],
        source: `function interact() {
          return [{ type: 'navigate', url: 'https://attacker.example/' }];
        }`,
        url: 'https://provider.example/activity',
      }),
    ).rejects.toThrow('Capture navigation must remain on the provider origin.');
  });
});
