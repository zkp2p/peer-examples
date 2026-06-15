import type { RequestLog } from './requestLog';

const requestLogsByTabId = new Map<number, Map<string, RequestLog>>();

export const deleteCacheByTabId = (tabId: number) => {
  requestLogsByTabId.delete(tabId);
};

export const getCacheByTabId = (tabId: number): Map<string, RequestLog> => {
  let cache = requestLogsByTabId.get(tabId);
  if (!cache) {
    cache = new Map<string, RequestLog>();
    requestLogsByTabId.set(tabId, cache);
  }
  return cache;
};

export const getRequestLogsByTabId = (tabId: number): RequestLog[] =>
  Array.from(getCacheByTabId(tabId).values()).sort(
    (left, right) => (right.timestamp ?? 0) - (left.timestamp ?? 0),
  );

export const clearRequestsLogsCache = () => {
  requestLogsByTabId.clear();
};
