import { describe, expect, it } from 'vitest';

import { getInstallInjectionPlans } from './installBackfill';

describe('installBackfill', () => {
  it('keeps payment hosts and app origins on separate content loaders', () => {
    expect(
      getInstallInjectionPlans({
        appOrigins: ['https://app.example/*'],
        hostDomains: ['https://*.payments.example/*'],
      }),
    ).toEqual([
      {
        files: ['txClickGuideLoader.bundle.js'],
        url: ['https://*.payments.example/*'],
      },
      {
        files: ['contentScriptLoader.bundle.js'],
        url: ['https://app.example/*'],
      },
    ]);
  });
});
