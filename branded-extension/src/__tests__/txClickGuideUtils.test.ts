import { describe, expect, it } from 'vitest';
import { resolveUserInputTiming } from '@utils/txClickGuideUtils';

describe('txClickGuideUtils.resolveUserInputTiming', () => {
  it('returns defaults when values are missing', () => {
    const timing = resolveUserInputTiming({ transactionXpath: '//div' });
    expect(timing.waitForXpathMs).toBe(8000);
    expect(timing.pollIntervalMs).toBe(250);
  });

  it('uses provided values when present', () => {
    const timing = resolveUserInputTiming({
      transactionXpath: '//div',
      waitForXpathMs: 12000,
      pollIntervalMs: 100,
    });
    expect(timing.waitForXpathMs).toBe(12000);
    expect(timing.pollIntervalMs).toBe(100);
  });

  it('clamps negative wait values to 0', () => {
    const timing = resolveUserInputTiming({
      transactionXpath: '//div',
      waitForXpathMs: -5,
    });
    expect(timing.waitForXpathMs).toBe(0);
  });
});
