import { describe, expect, it } from 'vitest';
import {
  historicalAliasApplySchema,
  manualTransferLinkSchema,
  merchantAliasCreateSchema,
  merchantCreateSchema,
  transactionSplitsReplaceSchema,
  transferListQuerySchema,
} from '../src/index';

describe('Phase 6 management contracts', () => {
  it('accepts merchant and literal alias input', () => {
    expect(merchantCreateSchema.parse({ displayName: 'Café Shop' }).displayName).toBe('Café Shop');
    expect(
      merchantAliasCreateSchema.parse({
        rawPattern: 'POS: Café Shop',
        matchType: 'normalized_description_contains',
      }),
    ).toMatchObject({ enabled: true, priority: 100 });
  });

  it('preserves three- and six-decimal split amounts at the boundary', () => {
    const payload = transactionSplitsReplaceSchema.parse({
      splits: [
        { position: 0, amount: '12.345', currencyCode: 'KWD' },
        { position: 1, amount: '0.123456', currencyCode: 'KWD' },
      ],
    });
    expect(payload.splits.map((split) => split.amount)).toEqual(['12.345', '0.123456']);
    expect(() =>
      transactionSplitsReplaceSchema.parse({
        splits: [{ position: 0, amount: '0.1234567', currencyCode: 'KWD' }],
      }),
    ).toThrow();
  });

  it('requires explicit confirmation for historical alias changes and manual links', () => {
    expect(() => historicalAliasApplySchema.parse({ previewHash: 'a'.repeat(64) })).toThrow();
    expect(
      manualTransferLinkSchema.parse({
        outgoingTransactionId: 'outgoing-1',
        incomingTransactionId: 'incoming-1',
      }),
    ).toEqual({ outgoingTransactionId: 'outgoing-1', incomingTransactionId: 'incoming-1' });
    expect(transferListQuerySchema.parse({ currency: 'KWD' }).limit).toBe(25);
  });
});
