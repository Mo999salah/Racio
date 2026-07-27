import { describe, expect, it } from 'vitest';
import { matchClassificationRule, mergeRuleActions, validateRuleDocument } from '../src/index';

const transaction = {
  id: 'tx',
  financialAccountId: 'account',
  institutionId: 'institution',
  bookingDate: '2026-01-15',
  amount: '12.345',
  currencyCode: 'KWD',
  direction: 'debit' as const,
  rawDescription: 'Market',
  importedDescription: 'Market',
  userDescription: null,
  counterparty: null,
  userCounterparty: null,
  userNote: null,
  primaryCategoryId: null,
  tagIds: [],
  sourceType: 'csv',
  reviewed: false,
};

describe('classification domain', () => {
  it('requires a currency condition for amount rules and matches decimal strings exactly', () => {
    const document = {
      conditions: {
        version: 1 as const,
        items: [
          { field: 'amount' as const, operator: 'minimum' as const, value: '12.345' },
          { field: 'currency' as const, operator: 'equals' as const, value: 'KWD' },
        ],
      },
      actions: {
        version: 1 as const,
        items: [{ type: 'primary_category' as const, categoryId: 'cat' }],
      },
      matchMode: 'all' as const,
    };
    expect(validateRuleDocument(document)).toEqual([]);
    expect(matchClassificationRule(transaction, document).matches).toBe(true);
  });

  it('merges actions deterministically and preserves the first primary action', () => {
    expect(
      mergeRuleActions([
        { type: 'primary_category', categoryId: 'first' },
        { type: 'primary_category', categoryId: 'second' },
        { type: 'add_tag', tagId: 'tag' },
      ]),
    ).toMatchObject({ primaryCategoryId: 'first', tagIds: ['tag'] });
  });
});
