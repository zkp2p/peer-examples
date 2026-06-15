import {
  createEncryptedBuyerTeeSessionMaterial,
  type BuyerTeeSessionMaterialEncryptionInput,
} from '@zkp2p/sdk';
import type {
  BuyerTeeSessionMaterialEncryptionPayload,
  BuyerTeeSessionMaterialEncryptionResponse,
} from '@utils/buyerTeePaymentCapture';

type BuyerTeeAttestationRuntime = NonNullable<
  BuyerTeeSessionMaterialEncryptionInput['attestationRuntime']
>;

function createBuyerTeeAttestationRuntime(): BuyerTeeAttestationRuntime {
  const attestationRuntime: BuyerTeeAttestationRuntime = {};

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

export async function encryptPreparedBuyerTeeSessionMaterial({
  payload,
}: {
  payload: BuyerTeeSessionMaterialEncryptionPayload;
}): Promise<
  Extract<BuyerTeeSessionMaterialEncryptionResponse, { success: true }>['encryptedSessionMaterial']
> {
  return await createEncryptedBuyerTeeSessionMaterial({
    actionType: payload.actionType,
    attestationRuntime: createBuyerTeeAttestationRuntime(),
    attestationServiceUrl: payload.attestationServiceUrl,
    platform: payload.platform,
    sessionMaterial: payload.sessionMaterial,
    ...(payload.timeoutMs == null ? {} : { timeoutMs: payload.timeoutMs }),
  });
}
