import type { BuyerTeePaymentParams } from '../buyerTeePaymentCapture';
import type { MetadataMessageType } from './messages/contentToPage';
import type { CaptureNavigation } from '../captureNavigation';
import type { CaptureQuery } from '../captureQuery';
import type { CaptureHighlight } from '../captureHighlight';

export const MAX_CAPTURE_SOURCE_BYTES = 64 * 1024;
export const MAX_NETWORK_BODY_BYTES = 2 * 1024 * 1024;

export type CaptureParams = Record<string, string | number | boolean>;

/** A Buyer TEE session field read from the provider page's localStorage. */
export type PageCaptureSessionField = {
  /** `p256RawPublicKey`: the P-256 JWK's raw point as unpadded base64url. */
  encoding?: 'p256RawPublicKey';
  /** A localStorage key, or `key.property` for one property of a JSON entry. */
  storage: string;
};

/**
 * Observe `request` inside the provider page instead of on the network. The
 * `session` fields are the sealed Buyer TEE session; capture JS never sees them.
 */
export type CapturePluginPageCapture = {
  request: { method: 'GET' | 'POST'; url: string };
  session: Record<string, PageCaptureSessionField>;
};

export type PeerCapturePlugin = {
  authLink: string;
  /** Defaults to foreground capture; false waits until interaction is needed. */
  focusOnOpen?: boolean;
  id: string;
  name: string;
  origins: string[];
  pageCapture?: CapturePluginPageCapture;
  shouldSkipCloseTab: boolean;
  /** Defines match(), capture(), and optional interact() hooks. */
  source: string;
};

export type PeerInitialAction = {
  enabled?: boolean;
  paymentDetails?: Record<string, string>;
};

export type CaptureNetworkEvent = {
  request: {
    body: string | null;
    method: string;
    url: string;
  };
  response: {
    body: string | null;
    status: number;
    url: string;
  };
};

/**
 * A `match()` result selecting the intercepted request as context for replaying
 * this target instead (legacy `metadataUrl`/fallback parity).
 */
export type CaptureReplayTarget = {
  body: string | null;
  method: 'GET' | 'POST';
  url: string;
};

export type CaptureMatchResult = boolean | CaptureReplayTarget;

export type CaptureProgramResult =
  | BuyerTeePaymentParams
  | MetadataMessageType[]
  | CaptureNavigation
  | CaptureQuery
  | CaptureHighlight
  | null;

export type CapturePageElement = { href: string } | { id: string };

export type CapturePageAction =
  | { element: CapturePageElement; type: 'click' }
  | { element: { id: string }; input: string; type: 'fill' }
  | { type: 'navigate'; url: string };

export type ResolvedCapturePageAction =
  | { element: CapturePageElement; type: 'click' }
  | { element: { id: string }; input: string; type: 'fill'; value: string }
  | { type: 'navigate'; url: string };

export type CapturePageActionResponse =
  | { success: true }
  | { error: string; reason: 'not_found' | 'rejected'; success: false };
