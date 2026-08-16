import { describe, expect, it } from 'vitest';
import { exportRequestSchema, savedViewFiltersSchema } from '@racio/contracts';

describe('export request contract', () => {
  it('accepts a valid CSV request', () => {
    const result = exportRequestSchema.safeParse({
      type: 'transactions_csv',
      filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31', includeArchived: 'false' },
      includeNotes: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an XLSX request with splits', () => {
    const result = exportRequestSchema.safeParse({
      type: 'transactions_xlsx',
      filters: { currency: 'TRY' },
      includeNotes: false,
      includeSplits: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts an archive request with advisor opt-in', () => {
    const result = exportRequestSchema.safeParse({
      type: 'account_archive',
      includeNotes: false,
      includeAdvisorConversations: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown types, extra fields, and amount filters without currency', () => {
    expect(exportRequestSchema.safeParse({ type: 'transactions_pdf', filters: {} }).success).toBe(
      false,
    );
    expect(
      exportRequestSchema.safeParse({
        type: 'transactions_csv',
        filters: {},
        includeNotes: false,
        extra: true,
      }).success,
    ).toBe(false);
    expect(
      exportRequestSchema.safeParse({ type: 'transactions_csv', filters: { amountExact: '10' } })
        .success,
    ).toBe(false);
    expect(
      exportRequestSchema.safeParse({
        type: 'transactions_csv',
        filters: { amountExact: '10', currency: 'USD' },
      }).success,
    ).toBe(true);
  });

  it('rejects invalid date ranges and decimal precision', () => {
    expect(
      exportRequestSchema.safeParse({
        type: 'transactions_csv',
        filters: { dateFrom: '2026-02-01', dateTo: '2026-01-01' },
      }).success,
    ).toBe(false);
    expect(
      exportRequestSchema.safeParse({
        type: 'transactions_csv',
        filters: { amountMin: '10.1234567', currency: 'USD' },
      }).success,
    ).toBe(false);
  });

  it('accepts savedViewId references', () => {
    const result = exportRequestSchema.safeParse({
      type: 'transactions_csv',
      filters: { savedViewId: 'view-1' },
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const request = result.data as Extract<typeof result.data, { type: 'transactions_csv' }>;
    expect(request.filters.savedViewId).toBe('view-1');
  });
});

describe('saved view filter contract for export reuse', () => {
  it('round-trips a complete filter document', () => {
    const input = {
      dateFrom: '2026-01-01',
      dateTo: '2026-03-31',
      accountId: 'a1',
      institutionId: 'i1',
      direction: 'debit',
      currency: 'TRY',
      primaryCategoryId: 'c1',
      secondaryCategoryId: 'c2',
      tagId: 't1',
      reviewed: 'true',
      categorised: 'false',
      search: 'market',
      amountMin: '10.50',
      amountMax: '99.999',
      includeArchived: 'true',
    };
    expect(savedViewFiltersSchema.safeParse(input).success).toBe(true);
  });
});
