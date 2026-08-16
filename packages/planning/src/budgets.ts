import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { BudgetCreate, BudgetPatch } from '@racio/contracts';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';
import { getExpenseSpending, type ExpenseSpending } from '@racio/transactions';
import { addMoney, isNegative, percentOf, percentReached, subtractMoney } from './money';
import {
  currentPeriodBounds,
  daysRemaining,
  isPeriodEnded,
  periodKey,
  todayForTimeZone,
  type PeriodType,
} from './period';

export const DEFAULT_BUDGET_WARNING_THRESHOLD = 80;
const MAX_ROLLOVER_PERIODS = 12;

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

type BudgetRow = typeof schema.budgets.$inferSelect;

function publicBudget(row: BudgetRow | undefined) {
  if (!row) throw new Error('Budget insert did not return a row.');
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    amount: row.amount,
    periodType: row.periodType,
    categoryId: row.categoryId,
    accountId: row.accountId,
    startDate: row.customStartDate,
    endDate: row.customEndDate,
    warningThreshold: row.warningThreshold,
    rolloverEnabled: row.rolloverEnabled,
    enabled: row.enabled,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedBudget(db: RacioDatabase, userId: string, id: string): Promise<BudgetRow> {
  const [row] = await db
    .select()
    .from(schema.budgets)
    .where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)))
    .limit(1);
  if (!row) notFound('Budget not found.');
  return row;
}

async function validateBudgetReferences(
  db: RacioDatabase,
  userId: string,
  input: BudgetCreate | BudgetPatch,
  currency: string | undefined,
) {
  const currencyCode = currency ?? (input as BudgetCreate).currency;
  if (input.accountId) {
    const [account] = await db
      .select({
        id: schema.financialAccounts.id,
        status: schema.financialAccounts.status,
        currencyCode: schema.financialAccounts.currencyCode,
      })
      .from(schema.financialAccounts)
      .where(
        and(
          eq(schema.financialAccounts.id, input.accountId),
          eq(schema.financialAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!account) notFound('Financial account not found.');
    if (account.status !== 'active') conflict('Only active accounts can be used by a budget.');
    if (currencyCode && account.currencyCode !== currencyCode)
      validation('The budget currency must match the account currency.');
  }
  if (input.categoryId) {
    const [category] = await db
      .select({ id: schema.categories.id, status: schema.categories.status })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, input.categoryId), eq(schema.categories.userId, userId)))
      .limit(1);
    if (!category) notFound('Category not found.');
    if (category.status !== 'active') conflict('Only active categories can be used by a budget.');
  }
}

export async function createBudget(db: RacioDatabase, userId: string, input: BudgetCreate) {
  await validateBudgetReferences(db, userId, input, input.currency);
  const [row] = await db
    .insert(schema.budgets)
    .values({
      id: randomUUID(),
      userId,
      name: input.name.trim(),
      currency: input.currency,
      amount: input.amount,
      periodType: input.period,
      categoryId: input.categoryId ?? null,
      accountId: input.accountId ?? null,
      customStartDate: input.period === 'custom' ? input.startDate! : null,
      customEndDate: input.period === 'custom' ? input.endDate! : null,
      warningThreshold: input.warningThreshold ?? null,
      rolloverEnabled: input.rolloverEnabled,
      enabled: input.enabled,
      archivedAt: null,
    })
    .returning();
  return publicBudget(row);
}

export async function updateBudget(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: BudgetPatch,
) {
  const current = await ownedBudget(db, userId, id);
  await validateBudgetReferences(db, userId, input, input.currency ?? current.currency);
  const nextPeriod = input.period ?? current.periodType;
  const nextStartDate =
    nextPeriod === 'custom'
      ? input.startDate === undefined
        ? current.customStartDate
        : input.startDate
      : null;
  const nextEndDate =
    nextPeriod === 'custom'
      ? input.endDate === undefined
        ? current.customEndDate
        : input.endDate
      : null;
  const [row] = await db
    .update(schema.budgets)
    .set({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.amount === undefined ? {} : { amount: input.amount }),
      ...(input.period === undefined ? {} : { periodType: input.period }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId ?? null }),
      ...(input.accountId === undefined ? {} : { accountId: input.accountId ?? null }),
      customStartDate: nextStartDate,
      customEndDate: nextEndDate,
      ...(input.warningThreshold === undefined
        ? {}
        : { warningThreshold: input.warningThreshold ?? null }),
      ...(input.rolloverEnabled === undefined ? {} : { rolloverEnabled: input.rolloverEnabled }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)))
    .returning();
  if (!row) notFound('Budget not found.');
  return publicBudget(row);
}

export async function actionBudget(
  db: RacioDatabase,
  userId: string,
  id: string,
  action: 'archive' | 'restore' | 'enable' | 'disable',
) {
  await ownedBudget(db, userId, id);
  const [row] = await db
    .update(schema.budgets)
    .set({
      ...(action === 'archive' ? { archivedAt: new Date(), enabled: false } : {}),
      ...(action === 'restore' ? { archivedAt: null } : {}),
      ...(action === 'enable' ? { enabled: true } : {}),
      ...(action === 'disable' ? { enabled: false } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.budgets.id, id), eq(schema.budgets.userId, userId)))
    .returning();
  if (!row) notFound('Budget not found.');
  return publicBudget(row);
}

export async function listBudgets(db: RacioDatabase, userId: string, includeArchived: boolean) {
  const rows = await db
    .select()
    .from(schema.budgets)
    .where(
      and(
        eq(schema.budgets.userId, userId),
        includeArchived ? undefined : isNull(schema.budgets.archivedAt),
      ),
    )
    .orderBy(asc(schema.budgets.createdAt), asc(schema.budgets.id));
  return rows.map(publicBudget);
}

function scopeSpent(spending: ExpenseSpending, categoryId: string | null): string {
  if (!categoryId) return spending.total;
  const row = spending.byCategory.find((item) => item.categoryId === categoryId);
  return row?.amount ?? '0';
}

async function spentInBounds(
  db: RacioDatabase,
  userId: string,
  budget: BudgetRow,
  from: string,
  to: string,
): Promise<string> {
  const spending = await getExpenseSpending(db, userId, {
    currency: budget.currency,
    from,
    to,
    accountId: budget.accountId ?? undefined,
  });
  return scopeSpent(spending, budget.categoryId);
}

export type BudgetStatus = {
  budget: ReturnType<typeof publicBudget>;
  periodStart: string;
  periodEnd: string;
  periodKey: string;
  limit: string;
  spent: string;
  remaining: string;
  percentageUsed: string;
  daysRemaining: number;
  status: 'healthy' | 'approaching' | 'exceeded' | 'complete';
  previousSpent: string | null;
  rolloverCarried: string;
};

function statusOf(limit: string, spent: string, threshold: number, periodEnded: boolean) {
  if (periodEnded) return 'complete' as const;
  if (percentReached(spent, limit, 100)) return 'exceeded' as const;
  if (percentReached(spent, limit, threshold)) return 'approaching' as const;
  return 'healthy' as const;
}

export async function getBudgetStatus(
  db: RacioDatabase,
  userId: string,
  id: string,
  timeZone: string,
): Promise<BudgetStatus> {
  const budget = await ownedBudget(db, userId, id);
  const today = todayForTimeZone(timeZone);
  const bounds = currentPeriodBounds(
    budget.periodType as PeriodType,
    today,
    budget.customStartDate,
    budget.customEndDate,
  );

  const spent = await spentInBounds(db, userId, budget, bounds.start, bounds.end);

  let previousSpent: string | null = null;
  let carryover = '0';
  const warningThreshold = budget.warningThreshold ?? DEFAULT_BUDGET_WARNING_THRESHOLD;

  if (budget.rolloverEnabled && budget.periodType !== 'custom') {
    let reference = bounds.previousStart;
    let first = true;
    for (let index = 0; index < MAX_ROLLOVER_PERIODS && reference; index += 1) {
      const prior = currentPeriodBounds(budget.periodType as PeriodType, reference);
      const spentInPrior = await spentInBounds(db, userId, budget, prior.start, prior.end);
      if (first) {
        previousSpent = spentInPrior;
        first = false;
      }
      const unused = subtractMoney(budget.amount, spentInPrior);
      if (!isNegative(unused)) carryover = addMoney(carryover, unused);
      const createdDate = budget.createdAt.toISOString().slice(0, 10);
      if (prior.start <= createdDate) break;
      reference = prior.previousStart;
    }
  } else if (bounds.previousStart && bounds.previousEnd) {
    previousSpent = await spentInBounds(
      db,
      userId,
      budget,
      bounds.previousStart,
      bounds.previousEnd,
    );
  }

  const limit = addMoney(budget.amount, carryover);
  const remaining = subtractMoney(limit, spent);
  const periodEnded = isPeriodEnded(today, bounds.end);

  return {
    budget: publicBudget(budget),
    periodStart: bounds.start,
    periodEnd: bounds.end,
    periodKey: periodKey(budget.periodType as PeriodType, bounds),
    limit,
    spent,
    remaining,
    percentageUsed: percentOf(spent, limit),
    daysRemaining: daysRemaining(today, bounds.end),
    status: statusOf(limit, spent, warningThreshold, periodEnded),
    previousSpent,
    rolloverCarried: carryover,
  };
}

export async function listBudgetsWithStatus(
  db: RacioDatabase,
  userId: string,
  timeZone: string,
  includeArchived: boolean,
): Promise<BudgetStatus[]> {
  const rows = await listBudgets(db, userId, includeArchived);
  const statuses: BudgetStatus[] = [];
  for (const row of rows) {
    statuses.push(await getBudgetStatus(db, userId, row.id, timeZone));
  }
  return statuses;
}

export async function assertOwnedBudgetIds(
  db: RacioDatabase,
  userId: string,
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await db
    .select({ id: schema.budgets.id })
    .from(schema.budgets)
    .where(and(eq(schema.budgets.userId, userId), inArray(schema.budgets.id, unique)));
  if (rows.length !== unique.length) notFound('One or more budgets were not found.');
}
