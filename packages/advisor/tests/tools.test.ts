import { describe, expect, it } from 'vitest';
import { TOOL_ARG_SCHEMAS, TOOL_NAMES, executeTool, isToolName } from '../src/tools';
import { AuthBoundaryError } from '@racio/auth';

const ctx = {
  db: null as never,
  userId: 'user-1',
  preferences: {
    locale: 'en',
    timeZone: 'UTC',
    interfaceMode: 'easy',
    appearance: 'system',
    baseCurrency: null,
  },
  limits: {
    maxTransactionSamples: 20,
    maxBreakdownItems: 8,
    maxBudgetRows: 8,
    maxGoalRows: 8,
    maxAlertItems: 20,
    maxReconciliationRows: 10,
  },
};

describe('tool registry', () => {
  it('exposes only the approved tool names', () => {
    expect(TOOL_NAMES.sort()).toEqual([
      'compare_periods',
      'get_account_overview',
      'get_alert_summary',
      'get_budget_status',
      'get_category_breakdown',
      'get_goal_progress',
      'get_merchant_breakdown',
      'get_period_summary',
      'get_reconciliation_status',
      'get_uncategorized_allocations',
      'search_transactions',
    ]);
  });

  it('rejects unknown tools before any execution', async () => {
    await expect(executeTool(ctx, 'sql_executor', {})).rejects.toBeInstanceOf(AuthBoundaryError);
    await expect(executeTool(ctx, 'run_code', {})).rejects.toBeInstanceOf(AuthBoundaryError);
    await expect(executeTool(ctx, 'DROP TABLE transactions', {})).rejects.toBeInstanceOf(
      AuthBoundaryError,
    );
  });

  it('validates tool arguments with Zod', async () => {
    await expect(
      executeTool(ctx, 'get_period_summary', {
        dateRange: { from: 'not-a-date', to: '2026-01-31' },
      }),
    ).rejects.toBeInstanceOf(AuthBoundaryError);
  });

  it('rejects arguments with a userId', async () => {
    const schema = TOOL_ARG_SCHEMAS.get_period_summary;
    const parsed = schema.safeParse({
      dateRange: { from: '2026-01-01', to: '2026-01-31' },
      userId: 'other-user',
    });
    // .strict() rejects unknown keys; even if present the tool would ignore it.
    expect(parsed.success).toBe(false);
  });

  it('accepts a full period summary argument set', () => {
    expect(
      TOOL_ARG_SCHEMAS.get_period_summary.safeParse({
        dateRange: { from: '2026-01-01', to: '2026-01-31' },
        currency: 'TRY',
        accountId: 'acc-1',
      }).success,
    ).toBe(true);
  });

  it('bounds search limits', () => {
    expect(
      TOOL_ARG_SCHEMAS.search_transactions.safeParse({
        dateRange: { from: '2026-01-01', to: '2026-01-31' },
        limit: 500,
      }).success,
    ).toBe(false);
    expect(
      TOOL_ARG_SCHEMAS.search_transactions.safeParse({
        dateRange: { from: '2026-01-01', to: '2026-01-31' },
        limit: 20,
      }).success,
    ).toBe(true);
  });

  it('provides an isToolName guard', () => {
    expect(isToolName('get_budget_status')).toBe(true);
    expect(isToolName('get_budget_status; DROP TABLE')).toBe(false);
    expect(isToolName('')).toBe(false);
  });
});
