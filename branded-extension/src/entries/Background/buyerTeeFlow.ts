import { logger } from '@utils/logger';
import type { BuyerTeePaymentCapture, BuyerTeePaymentParams } from '@utils/buyerTeePaymentCapture';
import type { MetadataCaptureMode } from '@utils/metadataCaptureMode';
import type { MetadataMessageType } from '@utils/types';
import { resolveTrustedAttestationServiceUrl } from '@utils/trustedAttestationService';

import type { RequestLog } from './requestLog';
import { prepareBuyerTeeCaptureMaterial } from './buyerTeeCapture';
import { encryptBuyerTeeSessionMaterialInBackground } from './buyerTeeSessionMaterialEncryption';

type BuyerTeeCaptureConfig = {
  actionType: string;
  attestationServiceUrl: string;
  platform: string;
};

type StageBuyerTeeCaptureResult = {
  capture: BuyerTeePaymentCapture | null;
  errorMessage: string | null;
  metadata?: MetadataMessageType[];
};

const buyerTeeCaptureConfigs = new Map<number, BuyerTeeCaptureConfig>();

export function resolveBuyerTeeCaptureConfig({
  actionType,
  attestationActionType,
  attestationPlatform,
  attestationServiceUrl,
  captureMode,
  platform,
}: {
  actionType?: string;
  attestationActionType?: string | null;
  attestationPlatform?: string | null;
  attestationServiceUrl?: string | null;
  captureMode?: MetadataCaptureMode;
  platform?: string;
}): {
  config: BuyerTeeCaptureConfig | null;
  error: string | null;
} {
  if (captureMode !== 'buyerTee') {
    return { config: null, error: null };
  }

  if (!platform) {
    return {
      config: null,
      error: 'Session capture requires a platform.',
    };
  }

  const resolvedActionType = attestationActionType?.trim() || actionType?.trim();
  const resolvedPlatform = attestationPlatform?.trim() || platform;

  if (!resolvedActionType) {
    return {
      config: null,
      error: 'Session capture requires an action type.',
    };
  }

  let normalizedAttestationServiceUrl: string | null;
  try {
    normalizedAttestationServiceUrl = resolveTrustedAttestationServiceUrl(attestationServiceUrl);
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : 'Attestation service URL is invalid.',
    };
  }
  if (!normalizedAttestationServiceUrl) {
    return {
      config: null,
      error: 'Session capture requires an attestation service URL.',
    };
  }

  return {
    config: {
      actionType: resolvedActionType,
      attestationServiceUrl: normalizedAttestationServiceUrl,
      platform: resolvedPlatform,
    },
    error: null,
  };
}

export function rememberBuyerTeeCapture(tabId: number, config: BuyerTeeCaptureConfig | null): void {
  if (config) {
    buyerTeeCaptureConfigs.set(tabId, config);
  }
}

export function clearBuyerTeeCapture(tabId: number | null | undefined): void {
  if (typeof tabId === 'number') {
    buyerTeeCaptureConfigs.delete(tabId);
  }
}

export async function stageBuyerTeeCaptureForMetadata({
  metadata,
  params,
  request,
  tabId,
}: {
  metadata?: MetadataMessageType[];
  params?: BuyerTeePaymentParams;
  request: RequestLog;
  tabId: number | null | undefined;
}): Promise<StageBuyerTeeCaptureResult> {
  if (typeof tabId !== 'number') {
    return { capture: null, errorMessage: null };
  }

  const captureConfig = buyerTeeCaptureConfigs.get(tabId);
  if (!captureConfig) {
    return { capture: null, errorMessage: null };
  }

  try {
    const captureMaterial = prepareBuyerTeeCaptureMaterial({
      metadata,
      request,
    });
    const encryptedSessionMaterial = await encryptBuyerTeeSessionMaterialInBackground({
      actionType: captureConfig.actionType,
      attestationServiceUrl: captureConfig.attestationServiceUrl,
      platform: captureConfig.platform,
      sessionMaterial: captureMaterial.sessionMaterial,
    });

    return {
      capture: {
        encryptedSessionMaterial,
        ...(params ? { matchedParams: params } : {}),
      },
      errorMessage: null,
      metadata: captureMaterial.metadata,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Session capture failed.';
    logger.error('[Background] Session capture failed:', errorMessage);
    return {
      capture: null,
      errorMessage,
    };
  }
}
