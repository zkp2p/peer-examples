export {
  ApprovalToBackgroundAction,
  PageToContentAction,
  ContentToPageAction,
  BackgroundToContentAction,
  ContentToBackgroundAction,
  OffscreenToBackgroundAction,
  BackgroundToOffscreenAction,
  ManagerToBackgroundAction,
} from './messages';

export type {
  ApprovalPrompt,
  ApprovalRequest,
  ApprovalRequestResponse,
  ApprovalToBackgroundMessageType,
  PageToContentActionType,
  PageToContentMessageType,
  OpenNewTabPagePayload,
  ContentToPageActionType,
  ContentToPageMessageType,
  BackgroundToContentActionType,
  BackgroundToContentMessageType,
  ExecuteCapturePageActionResponse,
  ContentToBackgroundActionType,
  ContentToBackgroundMessageType,
  OffscreenToBackgroundActionType,
  OffscreenToBackgroundMessageType,
  BackgroundToOffscreenActionType,
  ExecuteCaptureInteractionOffscreenResponse,
  ExecuteCaptureProgramOffscreenResponse,
  ExtractMetadataOffscreenResponse,
  WarmCaptureSandboxOffscreenResponse,
  BackgroundToOffscreenMessageType,
  MetadataMessageType,
  ManagerToBackgroundMessageType,
} from './messages';

export type {
  CaptureNetworkEvent,
  CaptureParams,
  CapturePageAction,
  CapturePageActionResponse,
  CapturePageElement,
  CaptureMatchResult,
  CaptureProgramResult,
  CaptureReplayTarget,
  ResolvedCapturePageAction,
} from './captureProgram';

export type ParamSelectorType = 'jsonPath' | 'regex' | 'xPath';
export type ParamSourceType = 'responseBody' | 'requestBody' | 'url';

export interface ParamSelector {
  type: ParamSelectorType;
  value: string;
  source?: ParamSourceType;
}

export interface UserInputConfig {
  promptText?: string;
  transactionXpath: string;
  waitForXpathMs?: number;
  pollIntervalMs?: number;
}

export interface ProviderSettings {
  authLink: string;
  url: string;
  method: string;
  body: string;
  metadata: {
    shouldReplayRequestInPage?: boolean;
    shouldSkipCloseTab?: boolean;
    platform: string;
    urlRegex: string;
    /**
     * Optional request body regex filter used with urlRegex to narrow matches
     * when multiple requests share the same endpoint.
     */
    bodyRegex?: string;
    method: string;
    fallbackUrlRegex: string;
    /**
     * Optional request body regex for fallbackUrlRegex.
     */
    fallbackBodyRegex?: string;
    fallbackMethod: string;
    preprocessRegex: string;
    // Drives the metadata click guide only.
    userInput?: UserInputConfig;
    metadataUrl?: string;
    metadataUrlMethod?: string; // Optional, defaults to method if not specified
    metadataUrlBody?: string; // Optional, for POST/PUT requests
    transactionsExtraction: {
      transactionJsonPathListSelector?: string;
      transactionJsonPathSelectors?: {
        [key: string]: string;
      };
      // Optional HTML XPath-based extraction. Mirrors JSONPath semantics.
      transactionXPathListSelector?: string;
      transactionXPathSelectors?: {
        [key: string]: string;
      };
    };
  };
  paramNames: string[];
  paramSelectors: ParamSelector[];
}
