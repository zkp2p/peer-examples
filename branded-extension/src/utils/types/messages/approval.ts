export const ApprovalToBackgroundAction = {
  GET_APPROVAL_REQUEST: 'get_approval_request',
  RESPOND_TO_APPROVAL_REQUEST: 'respond_to_approval_request',
} as const;

export type ApprovalPrompt = {
  approveLabel: string;
  description: string;
  detailsCollapsed?: boolean;
  details?: Array<{
    label: string;
    value: string;
  }>;
  hostname: string;
  origin: string;
  permissions?: string[];
  pluginTrust?: 'verified' | 'unverified';
  rejectLabel: string;
  title: string;
  warning?: string;
};

export type ApprovalRequest = ApprovalPrompt & {
  requestId: string;
};

export type ApprovalToBackgroundMessageType =
  | {
      action: typeof ApprovalToBackgroundAction.GET_APPROVAL_REQUEST;
      requestId: string;
    }
  | {
      action: typeof ApprovalToBackgroundAction.RESPOND_TO_APPROVAL_REQUEST;
      approved: boolean;
      riskAcknowledged?: boolean;
      requestId: string;
    };

export type ApprovalRequestResponse = {
  request: ApprovalRequest;
};
