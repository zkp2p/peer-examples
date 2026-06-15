export type RequestLog = {
  formData?: Record<string, string[]> | null;
  initiator: string | null;
  method: 'GET' | 'POST' | string;
  requestBody?: string;
  requestHeaders: chrome.webRequest.HttpHeader[];
  requestId: string;
  responseBody?: string;
  responseHeaders?: chrome.webRequest.HttpHeader[];
  tabId: number;
  timestamp?: number;
  type: chrome.webRequest.ResourceType;
  url: string;
};
