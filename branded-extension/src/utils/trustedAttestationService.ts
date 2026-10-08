import { BRAND } from '@config/brand';

export function resolveTrustedAttestationServiceUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  let url: URL;
  try { url = new URL(normalized); } catch { throw new Error('Attestation service URL is invalid.'); }
  if (url.href.replace(/\/+$/u, '') !== BRAND.attestationServiceUrl) {
    throw new Error('Attestation service URL must match the configured endpoint.');
  }
  return url.origin;
}
