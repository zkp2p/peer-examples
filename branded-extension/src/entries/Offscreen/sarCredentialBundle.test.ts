import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSarCredentialBundle } from './sarCredentialBundle';

const { apiCreateSellerCredentialBundleMock } = vi.hoisted(() => ({
  apiCreateSellerCredentialBundleMock: vi.fn(),
}));

vi.mock('@zkp2p/sdk', () => ({
  apiCreateSellerCredentialBundle: apiCreateSellerCredentialBundleMock,
}));

const bundle = {
  bundleSignature: '0xbundle',
  credentialExpiresAt: null,
  credentialType: 'venmo_seller_session',
  credentialValidatedAt: '1760000000000',
  encryptedBlob: 'encrypted-blob',
  encryptedDataKey: 'encrypted-key',
  nonce: 'nonce',
  payeeIdHash: '0xpayeehash',
  platform: 'venmo',
};

const sdkPayload = {
  payeeId: '123456',
  sessionMaterial: {
    accountId: '123456',
    recipientUsername: 'seller_user',
    requestHeaders: {
      Cookie: 'venmo_session=abc',
    },
    sessionCookie: 'venmo_session=abc',
  },
} as const;

const payload = {
  ...sdkPayload,
  offchainId: 'seller_user',
  platform: 'venmo',
} as const;

describe('createSarCredentialBundle', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates an encrypted seller credential bundle through the SDK', async () => {
    apiCreateSellerCredentialBundleMock.mockResolvedValueOnce({
      message: 'created',
      responseObject: bundle,
      statusCode: 200,
      success: true,
    });

    await expect(
      createSarCredentialBundle({
        attestationServiceUrl: 'https://attestation.test/',
        payload,
      }),
    ).resolves.toEqual(bundle);

    expect(apiCreateSellerCredentialBundleMock).toHaveBeenCalledWith(
      sdkPayload,
      'https://attestation.test',
      'venmo',
      undefined,
      expect.any(Object),
    );
  });

  it('requires stateless attestation config from the launch message', async () => {
    await expect(
      createSarCredentialBundle({
        attestationServiceUrl: '',
        payload,
      }),
    ).rejects.toThrow('Attestation service URL is required for seller credential capture.');
  });
});
