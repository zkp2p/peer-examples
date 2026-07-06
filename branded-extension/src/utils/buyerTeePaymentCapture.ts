import type { BuyerTeeSessionMaterialEncryptionInput } from '@zkp2p/sdk';

export type BuyerTeeSessionMaterial = BuyerTeeSessionMaterialEncryptionInput['sessionMaterial'];

export type BuyerTeePaymentParams = Record<string, string | number | boolean>;

export type BuyerTeePaymentCapture = {
  encryptedSessionMaterial: string;
};
