import type { SellerCredentialUploadPayload } from '@utils/sarCredentialBundle';

import type { RequestLog } from './requestLog';

type CashAppActivityResponse = {
  activity_rows?: CashAppActivityRow[];
};

type CashAppActivityRow = {
  activity_item_global_id?: {
    primary_activity_token?: {
      token?: string;
    };
  };
  payment_history_inputs_row?: {
    payment?: {
      render_data?: string | null;
    };
    recipient?: CashAppCustomer;
    sender?: CashAppCustomer;
  };
};

type CashAppCustomer = {
  cashtag?: string | null;
  id?: string;
};

function headersToRecord(headers?: RequestLog['requestHeaders']): Record<string, string> {
  return (headers ?? []).reduce<Record<string, string>>((acc, header) => {
    if (typeof header.name === 'string' && typeof header.value === 'string') {
      acc[header.name] = header.value;
    }
    return acc;
  }, {});
}

function getHeaderValue(headers: Record<string, string>, headerName: string): string | null {
  const matchedKey = Object.keys(headers).find(
    (key) => key.toLowerCase() === headerName.toLowerCase(),
  );
  const value = matchedKey ? headers[matchedKey] : null;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeCashAppCashtag(value: string): string {
  const normalized = value.trim().replace(/^\$/u, '');
  if (!normalized) {
    throw new Error('Cash App cashtag must not be empty.');
  }
  return normalized;
}

function getAccountIdFromVenmoUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const externalId = parsed.searchParams.get('externalId')?.trim();
    return externalId && /^[0-9]+$/.test(externalId) ? externalId : null;
  } catch {
    return null;
  }
}

function parseJson<T>(value: string | undefined, errorMessage: string): T {
  if (!value) {
    throw new Error(errorMessage);
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(errorMessage);
  }
}

function findVenmoUsernameForAccountId(
  responseBody: string | undefined,
  accountId: string,
): string | null {
  if (!responseBody) {
    return null;
  }

  try {
    const parsed = JSON.parse(responseBody) as { stories?: unknown[] };
    const stories = Array.isArray(parsed.stories) ? parsed.stories : [];

    for (const story of stories) {
      if (!story || typeof story !== 'object') {
        continue;
      }

      const title = (story as { title?: unknown }).title;
      if (!title || typeof title !== 'object') {
        continue;
      }

      const actors = [
        (title as { sender?: unknown }).sender,
        (title as { receiver?: unknown }).receiver,
      ];

      for (const actor of actors) {
        if (!actor || typeof actor !== 'object') {
          continue;
        }

        const id = (actor as { id?: unknown }).id;
        const username = (actor as { username?: unknown }).username;
        if (String(id) === accountId && typeof username === 'string' && username.trim()) {
          return username.trim();
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}

function getRequestBodyString(request: RequestLog): string | null {
  const requestBody = normalizeOptionalString(request.requestBody);
  if (requestBody) {
    return requestBody;
  }

  if (!request.formData) {
    return null;
  }

  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(request.formData)) {
    if (!Array.isArray(values)) {
      continue;
    }
    for (const value of values) {
      params.append(key, value);
    }
  }

  return params.toString() || null;
}

function parseRenderCustomerToken(renderData?: string | null): string | null {
  if (!renderData) {
    return null;
  }

  try {
    const parsed = JSON.parse(renderData) as { callerCustomerToken?: string };
    return normalizeOptionalString(parsed.callerCustomerToken);
  } catch {
    return null;
  }
}

function extractCashAppIdentity(payload: CashAppActivityResponse): {
  cashtag: string;
  customerId: string;
} {
  const customerIds = new Set<string>();
  const cashtags = new Set<string>();

  for (const row of payload.activity_rows ?? []) {
    const token = normalizeOptionalString(
      row.activity_item_global_id?.primary_activity_token?.token,
    );
    if (token) {
      customerIds.add(token);
    }

    const renderToken = parseRenderCustomerToken(
      row.payment_history_inputs_row?.payment?.render_data,
    );
    if (renderToken) {
      customerIds.add(renderToken);
    }
  }

  if (customerIds.size !== 1) {
    throw new Error('Cash App session did not expose a stable customer id.');
  }

  const [customerId] = Array.from(customerIds);
  if (!customerId) {
    throw new Error('Cash App session did not expose a stable customer id.');
  }

  for (const row of payload.activity_rows ?? []) {
    const sender = row.payment_history_inputs_row?.sender;
    if (sender?.id?.trim() === customerId && sender.cashtag) {
      cashtags.add(normalizeCashAppCashtag(sender.cashtag));
    }

    const recipient = row.payment_history_inputs_row?.recipient;
    if (
      recipient?.cashtag &&
      (recipient.id?.trim() === customerId || recipient.id?.trim() === 'C_SELF')
    ) {
      cashtags.add(normalizeCashAppCashtag(recipient.cashtag));
    }
  }

  if (cashtags.size !== 1) {
    throw new Error('Cash App session did not expose a stable cashtag.');
  }

  const [cashtag] = Array.from(cashtags);
  if (!cashtag) {
    throw new Error('Cash App session did not expose a stable cashtag.');
  }

  return { cashtag, customerId };
}

function buildVenmoSessionMaterial({
  request,
}: {
  request: RequestLog;
}): SellerCredentialUploadPayload {
  const requestHeaders = headersToRecord(request.requestHeaders);
  const sessionCookie = getHeaderValue(requestHeaders, 'cookie');
  if (!sessionCookie) {
    throw new Error('No Venmo session cookie was captured. Re-authenticate and try again.');
  }

  const accountId = getAccountIdFromVenmoUrl(request.url);
  if (!accountId) {
    throw new Error('Could not extract the Venmo account ID from the captured request.');
  }

  const normalizedRecipientUsername = findVenmoUsernameForAccountId(
    request.responseBody,
    accountId,
  );
  if (!normalizedRecipientUsername) {
    throw new Error('Could not extract the Venmo username from the captured response.');
  }

  return {
    offchainId: normalizedRecipientUsername,
    payeeId: accountId,
    platform: 'venmo',
    sessionMaterial: {
      accountId,
      recipientUsername: normalizedRecipientUsername,
      requestHeaders,
      sessionCookie,
    },
  };
}

function buildCashAppSessionMaterial({
  request,
}: {
  request: RequestLog;
}): SellerCredentialUploadPayload {
  const requestHeaders = headersToRecord(request.requestHeaders);
  const sessionCookie = getHeaderValue(requestHeaders, 'cookie');
  if (!sessionCookie) {
    throw new Error('No Cash App session cookie was captured. Re-authenticate and try again.');
  }

  const requestPayload = getRequestBodyString(request);
  if (!requestPayload) {
    throw new Error('Cash App session did not include an activity request payload.');
  }

  const response = parseJson<CashAppActivityResponse>(
    request.responseBody,
    'Could not parse the Cash App activity response.',
  );
  const identity = extractCashAppIdentity(response);

  return {
    offchainId: identity.cashtag,
    payeeId: identity.cashtag,
    platform: 'cashapp',
    sessionMaterial: {
      customerId: identity.customerId,
      recipientCashtag: identity.cashtag,
      requestHeaders,
      requestPayload,
      sessionCookie,
    },
  };
}

function buildSellerCredentialUploadPayload({
  platform,
  request,
}: {
  platform: string;
  request: RequestLog;
}): SellerCredentialUploadPayload {
  switch (platform) {
    case 'cashapp':
      return buildCashAppSessionMaterial({ request });
    case 'venmo':
      return buildVenmoSessionMaterial({ request });
    default:
      throw new Error(`Seller credential capture is not supported for ${platform}.`);
  }
}

export async function prepareSarCredentialCapture({
  platform,
  request,
}: {
  platform: string;
  request: RequestLog | null | undefined;
}): Promise<SellerCredentialUploadPayload> {
  if (!request) {
    throw new Error('Session capture unavailable. Re-authenticate and try again.');
  }

  return buildSellerCredentialUploadPayload({ platform, request });
}
