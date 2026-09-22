import { afterEach, describe, expect, it, vi } from 'vitest';

import type { RequestLog } from './requestLog';
import { prepareSarCredentialCapture } from './sarCredentialCapture';

function buildCashAppRequest(overrides: Partial<RequestLog> = {}): RequestLog {
  return {
    initiator: 'https://cash.app',
    method: 'POST',
    requestBody: JSON.stringify({
      activity_scope: 'MY_ACTIVITY_WEB_V2',
      activity_token: {
        activity_token_type: 'CUSTOMER_TOKEN',
        token: 'CUSTOMER_1',
      },
      page_size: 15,
      request_context: {},
    }),
    requestHeaders: [
      { name: 'Cookie', value: 'cash_session=abc' },
      { name: 'User-Agent', value: 'Chrome' },
    ],
    requestId: 'request-cashapp',
    responseBody: JSON.stringify({
      activity_rows: [
        {
          activity_item_global_id: {
            primary_activity_token: { token: 'CUSTOMER_1' },
          },
          payment_history_inputs_row: {
            payment: {
              render_data: JSON.stringify({ callerCustomerToken: 'CUSTOMER_1' }),
            },
            recipient: {
              cashtag: '$sellercash',
              id: 'C_SELF',
            },
            sender: {
              cashtag: '$sendercash',
              id: 'CUSTOMER_2',
            },
          },
        },
      ],
    }),
    tabId: 7,
    timestamp: 1760000000000,
    type: 'xmlhttprequest',
    url: 'https://cash.app/cash-app/activity/v1.0/page',
    ...overrides,
  };
}

describe('prepareSarCredentialCapture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds Cash App session material from the captured web request', async () => {
    await expect(
      prepareSarCredentialCapture({
        platform: 'cashapp',
        request: buildCashAppRequest(),
      }),
    ).resolves.toEqual({
      offchainId: 'sellercash',
      payeeId: 'sellercash',
      platform: 'cashapp',
      sessionMaterial: {
        customerId: 'CUSTOMER_1',
        recipientCashtag: 'sellercash',
        requestHeaders: {
          Cookie: 'cash_session=abc',
          'User-Agent': 'Chrome',
        },
        requestPayload:
          '{"activity_scope":"MY_ACTIVITY_WEB_V2","activity_token":{"activity_token_type":"CUSTOMER_TOKEN","token":"CUSTOMER_1"},"page_size":15,"request_context":{}}',
        sessionCookie: 'cash_session=abc',
      },
    });
  });

  it('requires a captured request', async () => {
    await expect(
      prepareSarCredentialCapture({
        platform: 'cashapp',
        request: null,
      }),
    ).rejects.toThrow('Session capture unavailable. Re-authenticate and try again.');
  });

  it.each(['venmo', 'paypal', 'upi', 'wise'])('rejects unsupported %s SAR payloads', async (platform) => {
    await expect(
      prepareSarCredentialCapture({
        platform,
        request: buildCashAppRequest(),
      }),
    ).rejects.toThrow(`Seller credential capture is not supported for ${platform}.`);
  });
});
