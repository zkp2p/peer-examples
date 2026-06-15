import {
  apiCreateSellerCredentialBundle,
  type SellerCredentialAttestationRuntime,
  type SellerCredentialBundle,
  type SellerCredentialUploadInput,
} from '@zkp2p/sdk';
import type { SellerCredentialUploadPayload } from '@utils/sarCredentialBundle';

type PayeeBoundSellerCredentialUploadInput = Extract<
  SellerCredentialUploadInput,
  { payeeId: string }
>;

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBaseUrl(value: string | null | undefined, label: string): string {
  const normalized = normalizeOptionalString(value)?.replace(/\/+$/u, '');
  if (!normalized) {
    throw new Error(`${label} is required for seller credential capture.`);
  }
  return normalized;
}

function createSarAttestationRuntime(): SellerCredentialAttestationRuntime {
  const attestationRuntime: SellerCredentialAttestationRuntime = {};

  if (typeof globalThis.fetch === 'function') {
    attestationRuntime.fetch = globalThis.fetch.bind(globalThis);
  }

  if (globalThis.crypto?.subtle) {
    attestationRuntime.subtle = globalThis.crypto.subtle;
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    attestationRuntime.getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  }

  return attestationRuntime;
}

export async function createSarCredentialBundle({
  attestationServiceUrl,
  payload,
  timeoutMs,
}: {
  attestationServiceUrl?: string | null;
  payload: SellerCredentialUploadPayload;
  timeoutMs?: number | null;
}): Promise<SellerCredentialBundle> {
  const normalizedAttestationServiceUrl = normalizeBaseUrl(
    attestationServiceUrl,
    'Attestation service URL',
  );
  const bundlePayload = {
    payeeId: payload.payeeId,
    sessionMaterial: payload.sessionMaterial,
  } as PayeeBoundSellerCredentialUploadInput;
  const response = await apiCreateSellerCredentialBundle(
    bundlePayload,
    normalizedAttestationServiceUrl,
    payload.platform,
    timeoutMs ?? undefined,
    createSarAttestationRuntime(),
  );

  if (!response.success || !response.responseObject) {
    throw new Error(response.message || 'Failed to create seller credential bundle.');
  }

  return response.responseObject;
}
