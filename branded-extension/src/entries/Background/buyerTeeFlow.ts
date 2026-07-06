import { logger } from '@utils/logger';
import type { BuyerTeePaymentCapture } from '@utils/buyerTeePaymentCapture';
import { resolveParamExtractionResponseBodyString } from '@utils/metadataEngine';
import type { MetadataCaptureMode } from '@utils/metadataCaptureMode';
import type { MetadataMessageType, ProviderSettings } from '@utils/types';

import type { RequestLog } from './requestLog';
import {
  prepareBuyerTeeCaptureMaterial,
  shouldResolveBuyerTeeParamResponseBody,
} from './buyerTeeCapture';
import { encryptBuyerTeeSessionMaterialInBackground } from './buyerTeeSessionMaterialEncryption';

type BuyerTeeCaptureConfig = {
  actionType: string;
  attestationServiceUrl: string;
  platform: string;
  providerConfig: ProviderSettings;
};

type ResolvedBuyerTeeCaptureConfig = Omit<BuyerTeeCaptureConfig, 'providerConfig'>;

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
  config: ResolvedBuyerTeeCaptureConfig | null;
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

  const normalizedAttestationServiceUrl =
    attestationServiceUrl?.trim().replace(/\/+$/u, '') || null;
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
  request,
  tabId,
}: {
  metadata?: MetadataMessageType[];
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
    const paramResponseBodyString = shouldResolveBuyerTeeParamResponseBody(
      captureConfig.providerConfig,
    )
      ? await resolveParamExtractionResponseBodyString({
          dataRequest: request,
          providerConfig: captureConfig.providerConfig,
        })
      : undefined;
    const captureMaterial = prepareBuyerTeeCaptureMaterial({
      metadata,
      ...(paramResponseBodyString !== undefined ? { paramResponseBodyString } : {}),
      providerConfig: captureConfig.providerConfig,
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
