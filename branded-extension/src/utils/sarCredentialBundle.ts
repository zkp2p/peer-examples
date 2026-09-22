import type { SellerCredentialBundle, UploadSellerCredentialParams } from '@zkp2p/sdk';

export type SellerCredentialUploadPayload = Extract<
  UploadSellerCredentialParams,
  { platform: 'cashapp' }
> & {
  callerAddress?: string;
};

export type SarCredentialBundleOffscreenResponse =
  | {
      bundle: SellerCredentialBundle;
      success: true;
    }
  | {
      error: string;
      success: false;
    };
