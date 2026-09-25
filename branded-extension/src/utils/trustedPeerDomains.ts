import { BRAND } from '@config/brand';

export function isAutoApprovedConnectionHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || BRAND.appOrigins.some((pattern) => {
    try {
      const expected = new URL(pattern.replace('*.', 'wildcard.').replace(/\*$/, '')).hostname.toLowerCase();
      if (expected.startsWith('wildcard.')) {
        const domain = expected.slice('wildcard.'.length);
        return normalized.endsWith(`.${domain}`);
      }
      return normalized === expected;
    } catch { return false; }
  });
}
