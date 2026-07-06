import type {
  SellerCredentialBundle,
  SellerPlatform,
  UploadSellerCredentialParams,
} from '@zkp2p/sdk';

export type SellerCredentialPlatform = Extract<SellerPlatform, 'cashapp' | 'venmo'>;

export type SellerCredentialUploadPayload = {
  [P in SellerCredentialPlatform]: Extract<UploadSellerCredentialParams, { platform: P }> & {
    callerAddress?: string;
  };
}[SellerCredentialPlatform];

export type SarCredentialBundleOffscreenResponse =
  | {
      bundle: SellerCredentialBundle;
      success: true;
    }
  | {
      error: string;
      success: false;
    };
