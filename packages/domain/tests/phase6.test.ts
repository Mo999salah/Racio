import { describe, expect, it } from 'vitest';
import { merchantAliasMatches, normalizeMerchantName } from '../src/merchants';
import { validateSplitSet } from '../src/splits';
import {
  evaluateTransferPair,
  excludesFromIncomeExpense,
  type TransferCandidate,
} from '../src/transfers';

describe('Phase 6 domain rules', () => {
  it('validates exact split totals without a two-decimal assumption', () => {
    expect(
      validateSplitSet('12.345000', 'KWD', [
        { position: 0, amount: '1.234', currencyCode: 'KWD' },
        { position: 1, amount: '11.111', currencyCode: 'KWD' },
      ]),
    ).toMatchObject({ valid: true, total: '12.345', remaining: '0' });
    expect(
      validateSplitSet('0.123456', 'USD', [
        { position: 0, amount: '0.123455', currencyCode: 'USD' },
      ]),
    ).toMatchObject({ valid: false, errors: ['split_total_below_parent'], total: '0.123455' });
  });

  it('normalizes merchant text while preserving literal alias semantics', () => {
    expect(normalizeMerchantName('  Café\u200b | SHOP_01  ')).toBe('café shop 01');
    expect(
      merchantAliasMatches(
        'POS: Café Shop 01 / KWD',
        null,
        'café shop 01',
        'normalized_description_contains',
      ),
    ).toBe(true);
    expect(merchantAliasMatches('Other', 'Acme Bank', 'acme bank', 'exact_counterparty')).toBe(
      true,
    );
    expect(merchantAliasMatches('Other', 'Acme Bank', 'acme.*', 'counterparty_contains')).toBe(
      false,
    );
  });

  it('requires exact money, opposite direction, separate accounts, and a bounded date', () => {
    const base: TransferCandidate = {
      amount: '0.123456',
      currencyCode: 'KWD',
      direction: 'debit',
      bookingDate: '2026-07-01',
      financialAccountId: 'checking',
      accountName: 'Checking',
      bankTransactionId: 'bank-1',
      description: 'Transfer to savings',
      hasActiveSplits: false,
      archived: false,
    };
    const incoming: TransferCandidate = {
      ...base,
      direction: 'credit',
      financialAccountId: 'savings',
      accountName: 'Savings',
      bookingDate: '2026-07-03',
      description: 'Transfer from checking',
    };
    expect(evaluateTransferPair(base, incoming)).toMatchObject({ eligible: true, score: 105 });
    expect(evaluateTransferPair(base, { ...incoming, amount: '0.123455' }).eligible).toBe(false);
    expect(evaluateTransferPair(base, { ...incoming, bookingDate: '2026-07-05' }).eligible).toBe(
      false,
    );
    expect(excludesFromIncomeExpense('suggested')).toBe(false);
    expect(excludesFromIncomeExpense('confirmed')).toBe(true);
  });
});
