import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { currencyCodeSchema, type UserPreferences } from '@racio/contracts';
import { AuthBoundaryError } from '@racio/auth';
import { schema, type RacioDatabase } from '@racio/database';
import { decimalToScaledInteger } from '@racio/domain';
import {
  getDashboardSummary,
  getExpenseSpending,
  getUncategorizedExpenseAllocations,
  listTransactions,
  resolveAccountKnownBalance,
} from '@racio/transactions';
import {
  getBudgetStatus as planningGetBudgetStatus,
  getGoalProgress as planningGetGoalProgress,
  listAlertEvents,
  listBudgetsWithStatus,
  listGoalsWithProgress,
  unreadAlertCount,
} from '@racio/planning';
import { compareValues, percentOf, type ChangeStatus } from './money';

/**
 * Approved, typed tool catalog for the advisor. The model cannot call these;
 * the deterministic planner selects them and the service validates arguments
 * with Zod, injects the authenticated user, and re-checks ownership before
 * executing deterministic domain/reporting/planning services. No tool accepts
 * a `userId`, none executes SQL, and every monetary value is a decimal string.
 */

export type ToolLimits = {
  maxTransactionSamples: number;
  maxBreakdownItems: number;
  maxBudgetRows: number;
  maxGoalRows: number;
  maxAlertItems: number;
  maxReconciliationRows: number;
};

export type ToolContext = {
  db: RacioDatabase;
  userId: string;
  preferences: UserPreferences;
  limits: ToolLimits;
};

export type ToolResult = {
  name: string;
  output: unknown;
};

export const dateRangeArgSchema = z
  .object({ from: z.string().date(), to: z.string().date() })
  .strict();

const accountArgSchema = z.string().trim().min(1).max(200).optional();
const currencyArgSchema = currencyCodeSchema.optional();

export const TOOL_ARG_SCHEMAS = {
  get_period_summary: z
    .object({
      dateRange: dateRangeArgSchema,
      currency: currencyArgSchema,
      accountId: accountArgSchema,
    })
    .strict(),
  get_category_breakdown: z
    .object({
      dateRange: dateRangeArgSchema,
      currency: currencyArgSchema,
      accountId: accountArgSchema,
    })
    .strict(),
  get_merchant_breakdown: z
    .object({
      dateRange: dateRangeArgSchema,
      currency: currencyArgSchema,
      accountId: accountArgSchema,
    })
    .strict(),
  get_account_overview: z
    .object({ dateRange: dateRangeArgSchema.optional(), accountId: accountArgSchema })
    .strict(),
  get_budget_status: z.object({ budgetId: z.string().trim().min(1).max(200).optional() }).strict(),
  get_goal_progress: z.object({ goalId: z.string().trim().min(1).max(200).optional() }).strict(),
  get_alert_summary: z.object({ limit: z.number().int().min(1).max(50).default(20) }).strict(),
  get_uncategorized_allocations: z.object({ currency: currencyArgSchema }).strict(),
  get_reconciliation_status: z
    .object({ statementId: z.string().trim().min(1).max(200).optional() })
    .strict(),
  search_transactions: z
    .object({
      dateRange: dateRangeArgSchema.optional(),
      currency: currencyArgSchema,
      accountId: accountArgSchema,
      categoryId: z.string().trim().min(1).max(200).optional(),
      direction: z.enum(['credit', 'debit']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    })
    .strict(),
  compare_periods: z
    .object({
      current: dateRangeArgSchema,
      previous: dateRangeArgSchema,
      currency: currencyArgSchema,
      accountId: accountArgSchema,
    })
    .strict(),
} as const;

export type ToolName = keyof typeof TOOL_ARG_SCHEMAS;
export const TOOL_NAMES = Object.keys(TOOL_ARG_SCHEMAS) as ToolName[];

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

async function assertOwnedAccount(db: RacioDatabase, userId: string, accountId: string) {
  const [row] = await db
    .select({ id: schema.financialAccounts.id })
    .from(schema.financialAccounts)
    .where(
      and(eq(schema.financialAccounts.id, accountId), eq(schema.financialAccounts.userId, userId)),
    )
    .limit(1);
  if (!row) notFound('Financial account not found.');
}

async function assertOwnedCategory(db: RacioDatabase, userId: string, categoryId: string) {
  const [row] = await db
    .select({ id: schema.categories.id })
    .from(schema.categories)
    .where(and(eq(schema.categories.id, categoryId), eq(schema.categories.userId, userId)))
    .limit(1);
  if (!row) notFound('Category not found.');
}

type DashboardArgs = {
  dateRange: { from: string; to: string };
  currency?: string;
  accountId?: string;
};

async function dashboardSummary(db: RacioDatabase, userId: string, args: DashboardArgs) {
  if (args.accountId) await assertOwnedAccount(db, userId, args.accountId);
  return getDashboardSummary(db, userId, {
    dateFrom: args.dateRange.from,
    dateTo: args.dateRange.to,
    accountId: args.accountId ?? undefined,
  });
}

async function getPeriodSummary(ctx: ToolContext, args: DashboardArgs) {
  const summary = await dashboardSummary(ctx.db, ctx.userId, args);
  const values = summary.cashFlow
    .filter((row) => !args.currency || row.currency === args.currency)
    .map((row) => ({
      currency: row.currency,
      income: row.inflow,
      expense: row.outflow,
      net: row.net,
      count: row.count,
      unresolvedCount: row.unresolvedCount,
    }));
  if (args.currency && values.length === 0) {
    values.push({
      currency: args.currency,
      income: '0',
      expense: '0',
      net: '0',
      count: 0,
      unresolvedCount: 0,
    });
  }
  return { dateRange: args.dateRange, hasAccounts: summary.hasAccounts, values };
}

async function getCategoryBreakdown(ctx: ToolContext, args: DashboardArgs) {
  if (args.accountId) await assertOwnedAccount(ctx.db, ctx.userId, args.accountId);
  const { dateRange } = args;
  const from = dateRange.from;
  const to = dateRange.to;

  const currencies =
    args.currency && /^[A-Z]{3}$/.test(args.currency)
      ? [args.currency]
      : await distinctCurrencies(ctx, from, to, args.accountId);

  const values: Array<{
    currency: string;
    total: string;
    items: Array<{
      categoryId: string | null;
      name: string | null;
      amount: string;
      sharePercent: string | null;
    }>;
  }> = [];
  for (const currency of currencies) {
    const spending = await getExpenseSpending(ctx.db, ctx.userId, {
      currency,
      from,
      to,
      accountId: args.accountId ?? undefined,
    });
    const categoryIds = spending.byCategory
      .map((row) => row.categoryId)
      .filter((id): id is string => Boolean(id));
    const names = new Map<string, string>();
    if (categoryIds.length) {
      const rows = await ctx.db
        .select({ id: schema.categories.id, name: schema.categories.name })
        .from(schema.categories)
        .where(
          and(eq(schema.categories.userId, ctx.userId), inArray(schema.categories.id, categoryIds)),
        );
      for (const row of rows) names.set(row.id, row.name);
    }
    const sorted = [...spending.byCategory].sort((left, right) => {
      const diff = decimalToScaledInteger(right.amount) - decimalToScaledInteger(left.amount);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });
    values.push({
      currency,
      total: spending.total,
      items: sorted.slice(0, ctx.limits.maxBreakdownItems).map((row) => ({
        categoryId: row.categoryId,
        name: row.categoryId ? (names.get(row.categoryId) ?? null) : null,
        amount: row.amount,
        sharePercent: percentOf(row.amount, spending.total),
      })),
    });
  }
  return { dateRange, values };
}

async function getMerchantBreakdown(ctx: ToolContext, args: DashboardArgs) {
  const summary = await dashboardSummary(ctx.db, ctx.userId, args);
  const values: Array<{
    currency: string;
    items: Array<{ name: string; amount: string; count: number; sharePercent: string }>;
  }> = [];
  for (const row of summary.merchants) {
    if (args.currency && row.currency !== args.currency) continue;
    let entry = values.find((value) => value.currency === row.currency);
    if (!entry) {
      entry = { currency: row.currency, items: [] };
      values.push(entry);
    }
    if (entry.items.length < ctx.limits.maxBreakdownItems)
      entry.items.push({
        name: row.name,
        amount: row.amount,
        count: row.count,
        sharePercent: row.sharePercent,
      });
  }
  return { dateRange: args.dateRange, values };
}

async function getAccountOverview(
  ctx: ToolContext,
  args: { dateRange?: { from: string; to: string }; accountId?: string },
) {
  if (args.accountId) await assertOwnedAccount(ctx.db, ctx.userId, args.accountId);
  const accountRows = await ctx.db
    .select({
      id: schema.financialAccounts.id,
      name: schema.financialAccounts.displayName,
      currency: schema.financialAccounts.currencyCode,
    })
    .from(schema.financialAccounts)
    .where(
      and(
        eq(schema.financialAccounts.userId, ctx.userId),
        args.accountId ? eq(schema.financialAccounts.id, args.accountId) : undefined,
      ),
    )
    .orderBy(schema.financialAccounts.displayName);

  if (!args.dateRange) {
    // State question (e.g. "what is my balance?"): report balances only. No
    // period is chosen silently for period activity.
    const accounts = [];
    for (const row of accountRows) {
      const balance = await resolveAccountKnownBalance(ctx.db, ctx.userId, row.id);
      accounts.push({
        id: row.id,
        name: row.name,
        currency: row.currency,
        balance: balance?.amount ?? null,
        balanceAsOf: balance?.asOfDate ?? null,
        balanceSource: balance?.source ?? null,
        netActivity: null,
        transactionCount: null,
      });
    }
    return { accounts };
  }

  const summary = await getDashboardSummary(ctx.db, ctx.userId, {
    dateFrom: args.dateRange.from,
    dateTo: args.dateRange.to,
    accountId: args.accountId ?? undefined,
  });
  return {
    accounts: summary.accounts
      .filter((account) => !args.accountId || account.id === args.accountId)
      .map((account) => ({
        id: account.id,
        name: account.name,
        currency: account.currency,
        balance: account.balance?.amount ?? null,
        balanceAsOf: account.balance?.asOfDate ?? null,
        balanceSource: account.balance?.source ?? null,
        netActivity: account.netActivity,
        transactionCount: account.transactionCount,
      })),
  };
}

async function budgetStatusTool(ctx: ToolContext, args: { budgetId?: string }) {
  if (args.budgetId) {
    const status = await planningGetBudgetStatus(
      ctx.db,
      ctx.userId,
      args.budgetId,
      ctx.preferences.timeZone,
    );
    return { budgets: [publicBudgetStatus(status)] };
  }
  const statuses = await listBudgetsWithStatus(ctx.db, ctx.userId, ctx.preferences.timeZone, false);
  return { budgets: statuses.slice(0, ctx.limits.maxBudgetRows).map(publicBudgetStatus) };
}

function publicBudgetStatus(status: {
  budget: {
    id: string;
    name: string;
    currency: string;
    amount: string;
    periodType: string;
    categoryId: string | null;
    accountId: string | null;
  };
  periodStart: string;
  periodEnd: string;
  limit: string;
  spent: string;
  remaining: string;
  percentageUsed: string;
  status: string;
  previousSpent: string | null;
}) {
  return {
    id: status.budget.id,
    name: status.budget.name,
    currency: status.budget.currency,
    periodStart: status.periodStart,
    periodEnd: status.periodEnd,
    limit: status.limit,
    spent: status.spent,
    remaining: status.remaining,
    percentageUsed: status.percentageUsed,
    status: status.status,
    previousSpent: status.previousSpent,
  };
}

async function goalProgressTool(ctx: ToolContext, args: { goalId?: string }) {
  if (args.goalId) {
    const progress = await planningGetGoalProgress(
      ctx.db,
      ctx.userId,
      args.goalId,
      ctx.preferences.timeZone,
    );
    return { goals: [publicGoalProgress(progress)] };
  }
  const progress = await listGoalsWithProgress(ctx.db, ctx.userId, ctx.preferences.timeZone, false);
  return { goals: progress.slice(0, ctx.limits.maxGoalRows).map(publicGoalProgress) };
}

function publicGoalProgress(progress: {
  goal: {
    id: string;
    name: string;
    currency: string;
    targetAmount: string;
    targetDate: string | null;
  };
  currentAmount: string | null;
  remaining: string | null;
  percentageComplete: string | null;
  balanceAvailable: boolean;
  balanceAsOf: string | null;
  daysRemaining: number | null;
}) {
  return {
    id: progress.goal.id,
    name: progress.goal.name,
    currency: progress.goal.currency,
    targetAmount: progress.goal.targetAmount,
    currentAmount: progress.currentAmount,
    remaining: progress.remaining,
    percentageComplete: progress.percentageComplete,
    balanceAvailable: progress.balanceAvailable,
    balanceAsOf: progress.balanceAsOf,
    daysRemaining: progress.daysRemaining,
  };
}

async function getAlertSummary(ctx: ToolContext, args: { limit: number }) {
  const [unread, events] = await Promise.all([
    unreadAlertCount(ctx.db, ctx.userId),
    listAlertEvents(ctx.db, ctx.userId, { limit: args.limit, offset: 0, state: 'all' }),
  ]);
  return {
    unread,
    items: events.items.slice(0, ctx.limits.maxAlertItems).map((event) => ({
      id: event.id,
      type: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      triggeredAt: event.triggeredAt.toISOString(),
    })),
  };
}

async function getUncategorized(ctx: ToolContext, args: { currency?: string }) {
  const allocations = await getUncategorizedExpenseAllocations(ctx.db, ctx.userId);
  return {
    values: allocations
      .filter((row) => !args.currency || row.currency === args.currency)
      .map((row) => ({ currency: row.currency, amount: row.amount, count: row.count })),
  };
}

async function getReconciliation(ctx: ToolContext, args: { statementId?: string }) {
  const conditions = [
    eq(schema.statements.userId, ctx.userId),
    eq(schema.statements.processingStatus, 'imported'),
  ];
  if (args.statementId) conditions.push(eq(schema.statements.id, args.statementId));
  const rows = await ctx.db
    .select({
      id: schema.statements.id,
      financialAccountId: schema.statements.financialAccountId,
      periodStart: schema.statements.periodStart,
      periodEnd: schema.statements.periodEnd,
      currencyCode: schema.statements.currencyCode,
      openingBalance: schema.statements.openingBalance,
      closingBalance: schema.statements.closingBalance,
      expectedClosing: schema.statements.reconciliationExpectedClosing,
      statedClosing: schema.statements.reconciliationStatedClosing,
      difference: schema.statements.reconciliationDifference,
      tolerance: schema.statements.reconciliationTolerance,
      reason: schema.statements.reconciliationReason,
      status: schema.statements.reconciliationStatus,
    })
    .from(schema.statements)
    .where(and(...conditions))
    .orderBy(desc(schema.statements.updatedAt))
    .limit(ctx.limits.maxReconciliationRows);
  return {
    statements: rows.map((row) => ({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      currency: row.currencyCode,
      openingBalance: row.openingBalance,
      closingBalance: row.closingBalance,
      expectedClosing: row.expectedClosing,
      statedClosing: row.statedClosing,
      difference: row.difference,
      tolerance: row.tolerance,
      reason: row.reason,
      status: row.status,
    })),
  };
}

async function getSearchTransactions(
  ctx: ToolContext,
  args: {
    dateRange?: { from: string; to: string };
    currency?: string;
    accountId?: string;
    categoryId?: string;
    direction?: 'credit' | 'debit';
    limit?: number;
  },
) {
  if (args.accountId) await assertOwnedAccount(ctx.db, ctx.userId, args.accountId);
  if (args.categoryId) await assertOwnedCategory(ctx.db, ctx.userId, args.categoryId);
  const limit = Math.min(
    args.limit ?? ctx.limits.maxTransactionSamples,
    ctx.limits.maxTransactionSamples,
  );
  const result = await listTransactions(ctx.db, ctx.userId, {
    limit,
    offset: 0,
    includeArchived: 'false',
    sort: 'bookingDateDesc',
    dateFrom: args.dateRange?.from,
    dateTo: args.dateRange?.to,
    currency: args.currency,
    accountId: args.accountId,
    primaryCategoryId: args.categoryId,
    direction: args.direction,
  });
  return {
    total: result.page.total,
    truncated: result.page.hasMore,
    items: result.items.slice(0, limit).map((item) => ({
      id: item.id,
      bookingDate: item.bookingDate,
      amount: item.amount,
      currency: item.currencyCode,
      direction: item.direction,
      description: item.userDescription ?? item.importedDescription,
      merchantName: item.merchantName ?? null,
      categoryName: item.primaryCategory?.name ?? null,
      reviewed: item.reviewed,
      accountName: item.accountName,
    })),
  };
}

async function getComparePeriods(
  ctx: ToolContext,
  args: {
    current: { from: string; to: string };
    previous: { from: string; to: string };
    currency?: string;
    accountId?: string;
  },
) {
  const currentSummary = await dashboardSummary(ctx.db, ctx.userId, {
    dateRange: args.current,
    currency: args.currency,
    accountId: args.accountId,
  });
  const previousSummary = await dashboardSummary(ctx.db, ctx.userId, {
    dateRange: args.previous,
    currency: args.currency,
    accountId: args.accountId,
  });
  const currencies = [
    ...new Set([
      ...currentSummary.cashFlow.map((row) => row.currency),
      ...previousSummary.cashFlow.map((row) => row.currency),
    ]),
  ].filter((currency) => !args.currency || currency === args.currency);
  if (args.currency && currencies.length === 0) currencies.push(args.currency);

  const deltas: Array<{
    currency: string;
    expenseChange: string;
    expensePercentage: string | null;
    expenseStatus: ChangeStatus;
    incomeChange: string;
    incomePercentage: string | null;
    incomeStatus: ChangeStatus;
  }> = [];
  for (const currency of currencies) {
    const currentExpense =
      currentSummary.cashFlow.find((row) => row.currency === currency)?.outflow ?? '0';
    const previousExpense =
      previousSummary.cashFlow.find((row) => row.currency === currency)?.outflow ?? '0';
    const currentIncome =
      currentSummary.cashFlow.find((row) => row.currency === currency)?.inflow ?? '0';
    const previousIncome =
      previousSummary.cashFlow.find((row) => row.currency === currency)?.inflow ?? '0';
    const expense = compareValues(currentExpense, previousExpense);
    const income = compareValues(currentIncome, previousIncome);
    deltas.push({
      currency,
      expenseChange: expense.change,
      expensePercentage: expense.percentage,
      expenseStatus: expense.status,
      incomeChange: income.change,
      incomePercentage: income.percentage,
      incomeStatus: income.status,
    });
  }
  return {
    current: { dateRange: args.current },
    previous: { dateRange: args.previous },
    deltas,
  };
}

async function distinctCurrencies(
  ctx: ToolContext,
  from: string,
  to: string,
  accountId?: string,
): Promise<string[]> {
  const conditions = [
    eq(schema.transactions.userId, ctx.userId),
    eq(schema.transactions.status, 'confirmed'),
    sql`${schema.transactions.bookingDate} >= ${from}`,
    sql`${schema.transactions.bookingDate} <= ${to}`,
  ];
  if (accountId) conditions.push(eq(schema.transactions.financialAccountId, accountId));
  const rows = await ctx.db
    .select({ currency: schema.transactions.currencyCode })
    .from(schema.transactions)
    .where(and(...conditions))
    .groupBy(schema.transactions.currencyCode);
  const fromAccounts = await ctx.db
    .select({ currency: schema.financialAccounts.currencyCode })
    .from(schema.financialAccounts)
    .where(
      and(
        eq(schema.financialAccounts.userId, ctx.userId),
        accountId ? eq(schema.financialAccounts.id, accountId) : undefined,
      ),
    );
  return [
    ...new Set([...rows.map((row) => row.currency), ...fromAccounts.map((row) => row.currency)]),
  ].sort();
}

type ToolRunner = (ctx: ToolContext, args: unknown) => Promise<unknown>;

const RUNNERS: Record<ToolName, ToolRunner> = {
  get_period_summary: (ctx, args) => getPeriodSummary(ctx, args as DashboardArgs),
  get_category_breakdown: (ctx, args) => getCategoryBreakdown(ctx, args as DashboardArgs),
  get_merchant_breakdown: (ctx, args) => getMerchantBreakdown(ctx, args as DashboardArgs),
  get_account_overview: (ctx, args) =>
    getAccountOverview(
      ctx,
      args as { dateRange?: { from: string; to: string }; accountId?: string },
    ),
  get_budget_status: (ctx, args) => budgetStatusTool(ctx, args as { budgetId?: string }),
  get_goal_progress: (ctx, args) => goalProgressTool(ctx, args as { goalId?: string }),
  get_alert_summary: (ctx, args) => getAlertSummary(ctx, args as { limit: number }),
  get_uncategorized_allocations: (ctx, args) =>
    getUncategorized(ctx, args as { currency?: string }),
  get_reconciliation_status: (ctx, args) =>
    getReconciliation(ctx, args as { statementId?: string }),
  search_transactions: (ctx, args) =>
    getSearchTransactions(ctx, args as Parameters<typeof getSearchTransactions>[1]),
  compare_periods: (ctx, args) =>
    getComparePeriods(ctx, args as Parameters<typeof getComparePeriods>[1]),
};

/**
 * Executes a named tool with Zod-validated arguments. Unknown tools and
 * invalid arguments are rejected; ownership is re-checked by the tool.
 */
export async function executeTool(
  ctx: ToolContext,
  name: string,
  rawArgs: unknown,
): Promise<ToolResult> {
  const schemaFor = (TOOL_ARG_SCHEMAS as Record<string, z.ZodType>)[name];
  if (!schemaFor) throw new AuthBoundaryError('VALIDATION', 'Unknown advisor tool.');
  const parsed = schemaFor.safeParse(rawArgs);
  if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid advisor tool arguments.');
  const runner = (RUNNERS as Record<string, ToolRunner>)[name];
  if (!runner) throw new AuthBoundaryError('VALIDATION', 'Unknown advisor tool.');
  const output = await runner(ctx, parsed.data);
  return { name, output };
}

export function isToolName(value: string): value is ToolName {
  return (TOOL_NAMES as string[]).includes(value);
}
