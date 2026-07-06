import {
  createEncryptedBuyerTeeSessionMaterial,
  type BuyerTeeSessionMaterialEncryptionInput,
} from '@zkp2p/sdk';

type BuyerTeeAttestationRuntime = NonNullable<
  BuyerTeeSessionMaterialEncryptionInput['attestationRuntime']
>;
type BackgroundBuyerTeeSessionMaterialEncryptionInput = Omit<
  BuyerTeeSessionMaterialEncryptionInput,
  'attestationRuntime'
>;

function createBackgroundAttestationRuntime(): BuyerTeeAttestationRuntime {
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

export async function encryptBuyerTeeSessionMaterialInBackground({
  actionType,
  attestationServiceUrl,
  platform,
  sessionMaterial,
  timeoutMs,
}: BackgroundBuyerTeeSessionMaterialEncryptionInput): Promise<string> {
  return await createEncryptedBuyerTeeSessionMaterial({
    actionType,
    attestationRuntime: createBackgroundAttestationRuntime(),
    attestationServiceUrl,
    platform,
    sessionMaterial,
    ...(timeoutMs == null ? {} : { timeoutMs }),
  });
}
