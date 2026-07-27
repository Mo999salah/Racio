import { describe, expect, it } from 'vitest';
import {
  financialAccounts,
  importJobs,
  institutions,
  rawTransactions,
  statements,
  transactions,
  categories,
  tags,
  classificationRules,
  transactionCategoryAssignments,
  transactionTags,
  classificationEvents,
  savedViews,
} from '../src/schema';

describe('account schema boundary', () => {
  it('exports the Phase 3 tables for migrations and services', () => {
    expect(institutions).toBeDefined();
    expect(financialAccounts).toBeDefined();
  });

  it('exports the Phase 4 statement and transaction tables', () => {
    expect(statements).toBeDefined();
    expect(importJobs).toBeDefined();
    expect(rawTransactions).toBeDefined();
    expect(transactions).toBeDefined();
  });

  it('exports the Phase 5 ledger classification tables', () => {
    expect(
      [
        categories,
        tags,
        classificationRules,
        transactionCategoryAssignments,
        transactionTags,
        classificationEvents,
        savedViews,
      ].every(Boolean),
    ).toBe(true);
  });
});
