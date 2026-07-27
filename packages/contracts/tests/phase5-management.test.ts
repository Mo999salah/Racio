import { describe, expect, it } from 'vitest';
import {
  classificationRuleCreateSchema,
  phase5DecimalSchema,
  savedViewCreateSchema,
  transactionListQuerySchema,
} from '../src/index';

describe('Phase 5 management contracts', () => {
  it('preserves zero, two, three, and six decimal-place strings', () => {
    expect(
      ['0', '12.34', '12.345', '0.123456'].map((value) => phase5DecimalSchema.parse(value)),
    ).toEqual(['0', '12.34', '12.345', '0.123456']);
  });

  it('round-trips a saved view with archived state and supported sort fields', () => {
    const view = savedViewCreateSchema.parse({
      name: 'KWD review queue',
      filters: {
        currency: 'KWD',
        amountMin: '0.123456',
        reviewed: 'false',
        includeArchived: 'true',
      },
      sort: { field: 'amount', direction: 'desc' },
      isDefault: true,
    });
    expect(view.filters.amountMin).toBe('0.123456');
    expect(view.filters.includeArchived).toBe('true');
    expect(transactionListQuerySchema.parse({ sort: 'descriptionAsc' }).sort).toBe(
      'descriptionAsc',
    );
    expect(() =>
      savedViewCreateSchema.parse({ ...view, filters: { ...view.filters, unknown: 'x' } }),
    ).toThrow();
  });

  it('accepts a complete typed rule with decimal-string conditions and actions', () => {
    const rule = classificationRuleCreateSchema.parse({
      name: 'KWD market review',
      enabled: true,
      priority: 20,
      matchMode: 'all',
      applyScope: 'historical_and_future',
      conditions: {
        version: 1,
        items: [
          { field: 'description', operator: 'contains', value: 'Market' },
          { field: 'amount', operator: 'minimum', value: '12.345' },
          { field: 'currency', operator: 'equals', value: 'KWD' },
        ],
      },
      actions: {
        version: 1,
        items: [
          { type: 'primary_category', categoryId: 'category-1' },
          { type: 'add_tag', tagId: 'tag-1' },
          { type: 'mark_reviewed' },
        ],
      },
    });
    expect(rule.conditions.items).toHaveLength(3);
    expect(rule.actions.items).toHaveLength(3);
    expect(() =>
      classificationRuleCreateSchema.parse({
        ...rule,
        conditions: {
          version: 1,
          items: [{ field: 'amount', operator: 'equals', value: '0.123456' }],
        },
      }),
    ).not.toThrow();
  });
});
