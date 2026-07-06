import { describe, expect, it } from 'vitest';

import { BRAND } from '@config/brand';
import { isAutoApprovedHost, requiresConnectionApproval } from './connectionApproval';

describe('content connection approval', () => {
  it.each(['localhost', '127.0.0.1'])('auto-approves local host %s', (hostname) => {
    expect(isAutoApprovedHost(hostname)).toBe(true);
  });

  it('auto-approves exact host-app origins from the brand config', () => {
    expect(BRAND.appOrigins).toContain('https://app.acme-verify.example/*');
    expect(isAutoApprovedHost('app.acme-verify.example')).toBe(true);
  });

  it('does not auto-approve arbitrary hosts', () => {
    expect(isAutoApprovedHost('evil.example')).toBe(false);
  });

  it('requires explicit approval for arbitrary hosts', () => {
    expect(requiresConnectionApproval('disconnected', 'evil.example')).toBe(true);
  });

  it('keeps third-party requestConnection available after approval', () => {
    expect(requiresConnectionApproval('connected', 'partner.example')).toBe(false);
  });
});
