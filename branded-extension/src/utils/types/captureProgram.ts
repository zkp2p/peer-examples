import type { BuyerTeePaymentParams } from '../buyerTeePaymentCapture';
import type { MetadataMessageType } from './messages/contentToPage';
import type { CaptureNavigation } from '../captureNavigation';
import type { CaptureQuery } from '../captureQuery';
import type { CaptureHighlight } from '../captureHighlight';

export const MAX_CAPTURE_SOURCE_BYTES = 64 * 1024;
export const MAX_NETWORK_BODY_BYTES = 2 * 1024 * 1024;

export type CaptureParams = Record<string, string | number | boolean>;

export type PeerCapturePlugin = {
  authLink: string;
  /** Defaults to foreground capture; false waits until interaction is needed. */
  focusOnOpen?: boolean;
  id: string;
  name: string;
  origins: string[];
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
