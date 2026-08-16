import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { GoalProgressUpdate, SavingsGoalCreate, SavingsGoalPatch } from '@racio/contracts';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';
import { resolveAccountKnownBalance } from '@racio/transactions';
import { percentOf, subtractMoney, normalizeDecimal } from './money';
import { daysRemaining, todayForTimeZone } from './period';

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

type GoalRow = typeof schema.savingsGoals.$inferSelect;

function publicGoal(row: GoalRow | undefined) {
  if (!row) throw new Error('Savings goal insert did not return a row.');
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    targetAmount: normalizeDecimal(row.targetAmount),
    targetDate: row.targetDate,
    trackingMode: row.trackingMode,
    accountId: row.accountId,
    manualSavedAmount:
      row.manualSavedAmount == null ? null : normalizeDecimal(row.manualSavedAmount),
    enabled: row.enabled,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function ownedGoal(db: RacioDatabase, userId: string, id: string): Promise<GoalRow> {
  const [row] = await db
    .select()
    .from(schema.savingsGoals)
    .where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)))
    .limit(1);
  if (!row) notFound('Savings goal not found.');
  return row;
}

async function validateAccountForGoal(
  db: RacioDatabase,
  userId: string,
  accountId: string,
  currency: string,
) {
  const [account] = await db
    .select({
      id: schema.financialAccounts.id,
      status: schema.financialAccounts.status,
      currencyCode: schema.financialAccounts.currencyCode,
    })
    .from(schema.financialAccounts)
    .where(
      and(eq(schema.financialAccounts.id, accountId), eq(schema.financialAccounts.userId, userId)),
    )
    .limit(1);
  if (!account) notFound('Financial account not found.');
  if (account.status !== 'active') conflict('Only active accounts can be linked to a goal.');
  if (account.currencyCode !== currency)
    validation('The goal currency must match the account currency.');
}

export async function createSavingsGoal(
  db: RacioDatabase,
  userId: string,
  input: SavingsGoalCreate,
) {
  if (input.trackingMode === 'account_balance' && input.accountId)
    await validateAccountForGoal(db, userId, input.accountId, input.currency);
  const [row] = await db
    .insert(schema.savingsGoals)
    .values({
      id: randomUUID(),
      userId,
      name: input.name.trim(),
      currency: input.currency,
      targetAmount: input.targetAmount,
      targetDate: input.targetDate ?? null,
      trackingMode: input.trackingMode,
      accountId: input.trackingMode === 'account_balance' ? input.accountId! : null,
      manualSavedAmount: input.trackingMode === 'manual' ? (input.manualSavedAmount ?? '0') : null,
      enabled: input.enabled,
      archivedAt: null,
    })
    .returning();
  return publicGoal(row);
}

export async function updateSavingsGoal(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: SavingsGoalPatch,
) {
  const current = await ownedGoal(db, userId, id);
  const nextCurrency = input.currency ?? current.currency;
  const nextTrackingMode = input.trackingMode ?? current.trackingMode;
  const nextAccountId =
    nextTrackingMode === 'account_balance' ? (input.accountId ?? current.accountId) : null;
  if (nextTrackingMode === 'account_balance' && nextAccountId)
    await validateAccountForGoal(db, userId, nextAccountId, nextCurrency);

  const [row] = await db
    .update(schema.savingsGoals)
    .set({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.currency === undefined ? {} : { currency: input.currency }),
      ...(input.targetAmount === undefined ? {} : { targetAmount: input.targetAmount }),
      ...(input.targetDate === undefined ? {} : { targetDate: input.targetDate ?? null }),
      ...(input.trackingMode === undefined ? {} : { trackingMode: input.trackingMode }),
      accountId: nextTrackingMode === 'account_balance' ? nextAccountId : null,
      manualSavedAmount:
        nextTrackingMode === 'manual'
          ? (input.manualSavedAmount ?? current.manualSavedAmount ?? '0')
          : null,
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)))
    .returning();
  if (!row) notFound('Savings goal not found.');
  return publicGoal(row);
}

export async function actionSavingsGoal(
  db: RacioDatabase,
  userId: string,
  id: string,
  action: 'archive' | 'restore',
) {
  await ownedGoal(db, userId, id);
  const [row] = await db
    .update(schema.savingsGoals)
    .set({
      ...(action === 'archive' ? { archivedAt: new Date(), enabled: false } : {}),
      ...(action === 'restore' ? { archivedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)))
    .returning();
  if (!row) notFound('Savings goal not found.');
  return publicGoal(row);
}

export async function updateSavingsGoalProgress(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: GoalProgressUpdate,
) {
  const current = await ownedGoal(db, userId, id);
  if (current.trackingMode !== 'manual')
    conflict('Only manually tracked goals accept a saved amount.');
  const [row] = await db
    .update(schema.savingsGoals)
    .set({ manualSavedAmount: input.manualSavedAmount, updatedAt: new Date() })
    .where(and(eq(schema.savingsGoals.id, id), eq(schema.savingsGoals.userId, userId)))
    .returning();
  if (!row) notFound('Savings goal not found.');
  return publicGoal(row);
}

export async function listSavingsGoals(
  db: RacioDatabase,
  userId: string,
  includeArchived: boolean,
) {
  const rows = await db
    .select()
    .from(schema.savingsGoals)
    .where(
      and(
        eq(schema.savingsGoals.userId, userId),
        includeArchived ? undefined : isNull(schema.savingsGoals.archivedAt),
      ),
    )
    .orderBy(asc(schema.savingsGoals.createdAt), asc(schema.savingsGoals.id));
  return rows.map(publicGoal);
}

export type GoalProgress = {
  goal: ReturnType<typeof publicGoal>;
  currentAmount: string | null;
  remaining: string | null;
  percentageComplete: string | null;
  daysRemaining: number | null;
  balanceAvailable: boolean;
  balanceAsOf: string | null;
  source: 'manual' | 'account_balance';
};

export async function getGoalProgress(
  db: RacioDatabase,
  userId: string,
  id: string,
  timeZone: string,
): Promise<GoalProgress> {
  const goal = await ownedGoal(db, userId, id);
  const today = todayForTimeZone(timeZone);

  if (goal.trackingMode === 'manual') {
    const currentAmount = normalizeDecimal(goal.manualSavedAmount ?? '0');
    return {
      goal: publicGoal(goal),
      currentAmount,
      remaining: subtractMoney(goal.targetAmount, currentAmount),
      percentageComplete: percentOf(currentAmount, goal.targetAmount),
      daysRemaining: goal.targetDate ? daysRemaining(today, goal.targetDate) : null,
      balanceAvailable: true,
      balanceAsOf: null,
      source: 'manual',
    };
  }

  // account_balance: shared deterministic balance provenance (transaction
  // balance_after, then statement closing balance, then unavailable).
  const balance = await resolveAccountKnownBalance(db, userId, goal.accountId!);

  if (!balance) {
    return {
      goal: publicGoal(goal),
      currentAmount: null,
      remaining: null,
      percentageComplete: null,
      daysRemaining: goal.targetDate ? daysRemaining(today, goal.targetDate) : null,
      balanceAvailable: false,
      balanceAsOf: null,
      source: 'account_balance',
    };
  }

  const currentAmount = balance.amount;
  return {
    goal: publicGoal(goal),
    currentAmount,
    remaining: subtractMoney(goal.targetAmount, currentAmount),
    percentageComplete: percentOf(currentAmount, goal.targetAmount),
    daysRemaining: goal.targetDate ? daysRemaining(today, goal.targetDate) : null,
    balanceAvailable: true,
    balanceAsOf: balance.asOfDate,
    source: 'account_balance',
  };
}

export async function listGoalsWithProgress(
  db: RacioDatabase,
  userId: string,
  timeZone: string,
  includeArchived: boolean,
): Promise<GoalProgress[]> {
  const rows = await listSavingsGoals(db, userId, includeArchived);
  const progress: GoalProgress[] = [];
  for (const row of rows) {
    progress.push(await getGoalProgress(db, userId, row.id, timeZone));
  }
  return progress;
}

export async function assertOwnedGoalIds(
  db: RacioDatabase,
  userId: string,
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const rows = await db
    .select({ id: schema.savingsGoals.id })
    .from(schema.savingsGoals)
    .where(and(eq(schema.savingsGoals.userId, userId), inArray(schema.savingsGoals.id, unique)));
  if (rows.length !== unique.length) notFound('One or more savings goals were not found.');
}
