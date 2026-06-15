import type { BuyerTeeSessionMaterialEncryptionInput } from '@zkp2p/sdk';

export type BuyerTeeSessionMaterial = BuyerTeeSessionMaterialEncryptionInput['sessionMaterial'];

export type BuyerTeePaymentParams = Record<string, string | number | boolean>;

export type BuyerTeePaymentCapture = {
  encryptedSessionMaterial: string;
};

export type BuyerTeeSessionMaterialEncryptionPayload = Omit<
  BuyerTeeSessionMaterialEncryptionInput,
  'attestationRuntime'
>;

export type BuyerTeeSessionMaterialEncryptionResponse =
  | {
      encryptedSessionMaterial: string;
      success: true;
    }
  | {
      error: string;
      success: false;
    };
