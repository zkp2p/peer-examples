import { logger } from '@utils/logger';
import type { SellerCredentialUploadPayload } from '@utils/sarCredentialBundle';
import { DEFAULT_ATTESTATION_SERVICE_URL } from '@utils/constants';
import type { SarCredentialCapture } from '@utils/types/metadataCapture';

import { getCacheByTabId } from './cache';
import type { RequestLog } from './requestLog';
import { prepareSarCredentialCapture } from './sarCredentialCapture';
import { createSarCredentialBundleInOffscreen } from './sarCredentialOffscreenBundle';

type EnsureOffscreenDocument = () => Promise<void>;

type ResolveSarCredentialCaptureConfigParams = {
  attestationServiceUrl?: string | null;
  captureMode?: 'sellerCredential';
  platform?: string;
};

type SarCredentialCaptureConfig = {
  attestationServiceUrl: string;
  platform: string;
};

type SarCredentialStageResult = {
  capture: SarCredentialCapture | null;
  errorMessage: string | null;
};

const sarCredentialCaptureConfigs = new Map<number, SarCredentialCaptureConfig>();

function normalizeRequiredUrl(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\/+$/u, '');
  return normalized || null;
}

async function toSarCredentialCapture({
  attestationServiceUrl,
  ensureOffscreenDocument,
  payload,
}: {
  attestationServiceUrl: string;
  ensureOffscreenDocument: EnsureOffscreenDocument;
  payload: SellerCredentialUploadPayload;
}): Promise<SarCredentialCapture> {
  const credentialBundle = await createSarCredentialBundleInOffscreen({
    attestationServiceUrl,
    ensureOffscreenDocument,
    payload,
  });

  return {
    credentialBundle,
    offchainId: payload.offchainId,
  };
}

export function resolveSarCredentialCaptureConfig({
  attestationServiceUrl,
  captureMode,
  platform,
}: ResolveSarCredentialCaptureConfigParams): {
  config: SarCredentialCaptureConfig | null;
  error: string | null;
} {
  if (captureMode !== 'sellerCredential') {
    return { config: null, error: null };
  }

  if (!platform?.trim()) {
    return {
      config: null,
      error: 'Seller credential capture requires a platform.',
    };
  }

  const normalizedAttestationServiceUrl =
    normalizeRequiredUrl(attestationServiceUrl) ?? DEFAULT_ATTESTATION_SERVICE_URL;

  return {
    config: {
      attestationServiceUrl: normalizedAttestationServiceUrl,
      platform,
    },
    error: null,
  };
}

export function rememberSarCredentialCapture(
  tabId: number,
  config: SarCredentialCaptureConfig | null,
): void {
  if (config) {
    sarCredentialCaptureConfigs.set(tabId, config);
  }
}

export function clearSarCredentialCapture(tabId: number | null | undefined): void {
  if (typeof tabId === 'number') {
    sarCredentialCaptureConfigs.delete(tabId);
  }
}

export async function stageSarCredentialCaptureForMetadata({
  ensureOffscreenDocument,
  requestId,
  tabId,
}: {
  ensureOffscreenDocument: EnsureOffscreenDocument;
  requestId?: string;
  tabId: number | null | undefined;
}): Promise<SarCredentialStageResult> {
  if (typeof tabId !== 'number') {
    return { capture: null, errorMessage: null };
  }

  const captureConfig = sarCredentialCaptureConfigs.get(tabId);
  if (!captureConfig) {
    return { capture: null, errorMessage: null };
  }

  if (!requestId) {
    return {
      capture: null,
      errorMessage: 'Session capture unavailable. Re-authenticate and try again.',
    };
  }

  const request = getCacheByTabId(tabId).get(requestId) as RequestLog | undefined;
  if (!request) {
    return {
      capture: null,
      errorMessage: 'Session capture unavailable. Re-authenticate and try again.',
    };
  }

  try {
    const payload = await prepareSarCredentialCapture({
      platform: captureConfig.platform,
      request,
    });
    const capture = await toSarCredentialCapture({
      attestationServiceUrl: captureConfig.attestationServiceUrl,
      ensureOffscreenDocument,
      payload,
    });
    return { capture, errorMessage: null };
  } catch (error) {
    logger.error('[Background] Seller credential capture failed:', error);
    return {
      capture: null,
      errorMessage: error instanceof Error ? error.message : 'Seller credential capture failed.',
    };
  }
}
