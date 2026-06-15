import type { BuyerTeePaymentCapture, BuyerTeePaymentParams } from '@utils/buyerTeePaymentCapture';
import type { SarCredentialCapture } from '@utils/types/metadataCapture';

export const ContentToPageAction = {
  CONNECTION_APPROVAL_RESPONSE: 'connection_approval_response',
  CONNECTION_STATUS_RESPONSE: 'connection_status_response',
  EXTENSION_VERSION_RESPONSE: 'extension_version_response',
  METADATA_MESSAGES_RESPONSE: 'metadata_messages_response',
} as const;

export type ContentToPageActionType =
  (typeof ContentToPageAction)[keyof typeof ContentToPageAction];

export type MetadataMessageType = {
  recipient?: string;
  amount?: string;
  date?: string;
  currency?: string;
  paymentId?: string;
  params?: BuyerTeePaymentParams;
  originalIndex: number;
  hidden: boolean;
  [key: string]: unknown;
};

export type MetadataMessagePayload = {
  requestId: string;
  platform: string;
  metadata: MetadataMessageType[];
  expiresAt: number;
  errorMessage?: string;
  buyerTeeCapture?: BuyerTeePaymentCapture | null;
  requiresMetadataApproval?: boolean;
  sarCredentialCapture?: SarCredentialCapture | null;
};

interface IContentToPageMessages {
  [ContentToPageAction.CONNECTION_APPROVAL_RESPONSE]: {
    approved: boolean;
    origin: string;
  };
  [ContentToPageAction.CONNECTION_STATUS_RESPONSE]: {
    origin: string;
    status: 'connected' | 'disconnected' | 'pending';
  };
  [ContentToPageAction.EXTENSION_VERSION_RESPONSE]: {
    status: 'loaded';
    version: string;
  };
  [ContentToPageAction.METADATA_MESSAGES_RESPONSE]: MetadataMessagePayload & {
    status: 'loaded';
  };
}

export type ContentToPageMessageType = {
  [K in keyof IContentToPageMessages]: {
    type: K;
  } & IContentToPageMessages[K];
}[keyof IContentToPageMessages];
