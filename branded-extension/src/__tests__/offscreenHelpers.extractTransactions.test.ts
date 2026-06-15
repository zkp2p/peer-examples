import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractTransactions } from '@utils/offscreenHelpers';
import type { ProviderSettings } from '@utils/types';

function buildProviderConfig(
  transactionsExtraction: ProviderSettings['metadata']['transactionsExtraction'],
): ProviderSettings {
  return {
    authLink: 'https://provider.example/login',
    body: '',
    method: 'GET',
    metadata: {
      fallbackMethod: 'GET',
      fallbackUrlRegex: 'context',
      method: 'GET',
      platform: 'provider',
      preprocessRegex: '',
      transactionsExtraction,
      urlRegex: 'transactions',
    },
    paramNames: [],
    paramSelectors: [],
    url: 'https://provider.example/api/transactions',
  };
}

describe('offscreenHelpers.extractTransactions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('extracts JSONPath rows from a list selector', () => {
    const messages = extractTransactions(
      {
        transactions: [
          { amount: '12.34', id: 'payment-1', recipient: 'alice' },
          { amount: '56.78', id: 'payment-2', recipient: 'bob' },
        ],
      },
      buildProviderConfig({
        transactionJsonPathListSelector: '$.transactions',
        transactionJsonPathSelectors: {
          amount: '$.amount',
          paymentId: '$.id',
          recipient: '$.recipient',
        },
      }),
    );

    expect(messages).toEqual([
      {
        amount: '12.34',
        hidden: false,
        originalIndex: 0,
        paymentId: 'payment-1',
        recipient: 'alice',
      },
      {
        amount: '56.78',
        hidden: false,
        originalIndex: 1,
        paymentId: 'payment-2',
        recipient: 'bob',
      },
    ]);
  });

  it('extracts one JSONPath row when the list selector is omitted', () => {
    const messages = extractTransactions(
      { amount: '12.34', id: 'payment-1' },
      buildProviderConfig({
        transactionJsonPathSelectors: {
          amount: '$.amount',
          paymentId: '$.id',
        },
      }),
    );

    expect(messages).toEqual([
      {
        amount: '12.34',
        hidden: false,
        originalIndex: 0,
        paymentId: 'payment-1',
      },
    ]);
  });

  it('marks JSONPath rows hidden when configured fields are missing', () => {
    const messages = extractTransactions(
      { transactions: [{ id: 'payment-1' }] },
      buildProviderConfig({
        transactionJsonPathListSelector: '$.transactions',
        transactionJsonPathSelectors: {
          amount: '$.amount',
          paymentId: '$.id',
        },
      }),
    );

    expect(messages).toEqual([
      {
        amount: undefined,
        hidden: true,
        originalIndex: 0,
        paymentId: 'payment-1',
      },
    ]);
  });

  it('extracts XPath rows from a list selector', () => {
    vi.stubGlobal('XPathResult', {
      ORDERED_NODE_SNAPSHOT_TYPE: 7,
      STRING_TYPE: 2,
    });
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString(): Document {
          const documentNode = {
            evaluate: (
              expression: string,
              contextNode: { rowIndex?: number },
              _resolver: XPathNSResolver | null,
              resultType: number,
            ) => {
              if (resultType === 7) {
                return {
                  snapshotItem: (index: number) => ({ rowIndex: index }),
                  snapshotLength: 2,
                };
              }
              return {
                stringValue: `${contextNode.rowIndex ?? 0}:${expression}`,
              };
            },
          };
          return documentNode as unknown as Document;
        }
      },
    );

    const messages = extractTransactions(
      '<html></html>',
      buildProviderConfig({
        transactionXPathListSelector: '//div[@data-row]',
        transactionXPathSelectors: {
          amount: './/*[@data-amount]/text()',
          paymentId: './/*[@data-id]/text()',
        },
      }),
    );

    expect(messages).toEqual([
      {
        amount: '0:.//*[@data-amount]/text()',
        hidden: false,
        originalIndex: 0,
        paymentId: '0:.//*[@data-id]/text()',
      },
      {
        amount: '1:.//*[@data-amount]/text()',
        hidden: false,
        originalIndex: 1,
        paymentId: '1:.//*[@data-id]/text()',
      },
    ]);
  });

  it('extracts one trimmed XPath row when the list selector is omitted', () => {
    vi.stubGlobal('XPathResult', {
      ORDERED_NODE_SNAPSHOT_TYPE: 7,
      STRING_TYPE: 2,
    });
    vi.stubGlobal(
      'DOMParser',
      class {
        parseFromString(): Document {
          const documentNode = {
            evaluate: (expression: string) => ({
              stringValue: expression === 'amount' ? '  12.34  ' : 'payment-1',
            }),
          };
          return documentNode as unknown as Document;
        }
      },
    );

    const messages = extractTransactions(
      '<html></html>',
      buildProviderConfig({
        transactionXPathSelectors: {
          amount: 'amount',
          paymentId: 'id',
        },
      }),
    );

    expect(messages).toEqual([
      {
        amount: '12.34',
        hidden: false,
        originalIndex: 0,
        paymentId: 'payment-1',
      },
    ]);
  });
});
