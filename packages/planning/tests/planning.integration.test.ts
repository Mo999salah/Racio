import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import { createCategory, replaceTransactionSplits } from '@racio/transactions';
import {
  createBudget,
  createSavingsGoal,
  evaluateUserAlerts,
  getBudgetStatus,
  getGoalProgress,
  listAlertEvents,
  unreadAlertCount,
} from '../src/index';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function dateInCurrentMonth(day: number) {
  const now = new Date();
  return isoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day)));
}

type TxInput = {
  amount: string;
  currency: string;
  direction: 'credit' | 'debit';
  description: string;
  bookingDate?: string;
  balanceAfter?: string | null;
};

async function seedUser(db: RacioDatabase, userId: string) {
  const now = new Date();
  await db.insert(schema.user).values({
    id: userId,
    name: 'Planner',
    email: `${userId}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  const institutionId = crypto.randomUUID();
  await db.insert(schema.institutions).values({
    id: institutionId,
    userId,
    name: 'Bank',
    normalizedName: `bank-${userId}`,
    countryCode: 'US',
    createdAt: now,
    updatedAt: now,
  });
  const accountId = crypto.randomUUID();
  await db.insert(schema.financialAccounts).values({
    id: accountId,
    userId,
    institutionId,
    displayName: 'Checking',
    accountType: 'checking',
    currencyCode: 'USD',
    createdAt: now,
    updatedAt: now,
  });
  const statementId = crypto.randomUUID();
  await db.insert(schema.statements).values({
    id: statementId,
    userId,
    financialAccountId: accountId,
    sourceType: 'csv',
    originalFilename: 'ledger.csv',
    fileSize: 5,
    fileChecksum: 'c'.repeat(64),
    uploadIdempotencyKey: crypto.randomUUID(),
    processingStatus: 'imported',
    createdAt: now,
    updatedAt: now,
  });
  let nextRow = 1;
  const insertTransaction = async (input: TxInput): Promise<string> => {
    const sourceRow = nextRow;
    nextRow += 1;
    const rawId = crypto.randomUUID();
    await db.insert(schema.rawTransactions).values({
      id: rawId,
      userId,
      statementId,
      financialAccountId: accountId,
      sourceRow,
      rawPayload: {},
      rawDescription: input.description,
      createdAt: now,
      updatedAt: now,
    });
    const transactionId = crypto.randomUUID();
    await db.insert(schema.transactions).values({
      id: transactionId,
      userId,
      financialAccountId: accountId,
      statementId,
      sourceRawTransactionId: rawId,
      bookingDate: input.bookingDate ?? dateInCurrentMonth(5),
      amount: input.amount,
      currencyCode: input.currency,
      direction: input.direction,
      balanceAfter: input.balanceAfter ?? null,
      rawDescription: input.description,
      importedDescription: input.description,
      normalizedDescription: input.description.toLowerCase(),
      reviewed: true,
      createdAt: now,
      updatedAt: now,
    });
    return transactionId;
  };
  return { accountId, statementId, insertTransaction };
}

async function cleanupUser(db: RacioDatabase, userId: string) {
  await db.delete(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));
  await db.delete(schema.alertRules).where(eq(schema.alertRules.userId, userId));
  await db.delete(schema.budgets).where(eq(schema.budgets.userId, userId));
  await db.delete(schema.savingsGoals).where(eq(schema.savingsGoals.userId, userId));
  await db
    .delete(schema.transactionSplitCategoryAssignments)
    .where(eq(schema.transactionSplitCategoryAssignments.userId, userId));
  await db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.userId, userId));
  await db
    .delete(schema.transactionCategoryAssignments)
    .where(eq(schema.transactionCategoryAssignments.userId, userId));
  await db
    .delete(schema.internalTransferLinks)
    .where(eq(schema.internalTransferLinks.userId, userId));
  await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
  await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
  await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
  await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
  await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
  await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
  await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
}

suite('planning budgets integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `plan-budget-${crypto.randomUUID()}`;
  let accountId = '';
  let groceriesId = '';
  let budgetId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    accountId = ctx.accountId;
    groceriesId = (await createCategory(db, userId, { name: 'Groceries', kind: 'expense' }))!.id;

    await ctx.insertTransaction({
      amount: '1000',
      currency: 'USD',
      direction: 'credit',
      description: 'SALARY',
    });
    await ctx.insertTransaction({
      amount: '200',
      currency: 'USD',
      direction: 'debit',
      description: 'GROCERY',
    });
    await ctx.insertTransaction({
      amount: '50',
      currency: 'USD',
      direction: 'debit',
      description: 'COFFEE',
    });

    const outId = await ctx.insertTransaction({
      amount: '500',
      currency: 'USD',
      direction: 'debit',
      description: 'TRANSFER OUT',
    });
    const inId = await ctx.insertTransaction({
      amount: '500',
      currency: 'USD',
      direction: 'credit',
      description: 'TRANSFER IN',
    });
    await db.insert(schema.internalTransferLinks).values({
      id: crypto.randomUUID(),
      userId,
      outgoingTransactionId: outId,
      incomingTransactionId: inId,
      status: 'confirmed',
      source: 'manual',
    });

    budgetId = (
      await createBudget(db, userId, {
        name: 'Monthly all',
        currency: 'USD',
        amount: '1000',
        period: 'monthly',
        categoryId: null,
        accountId: null,
        rolloverEnabled: false,
        enabled: true,
      })
    ).id;
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('computes spent excluding confirmed transfers', async () => {
    const status = await getBudgetStatus(db, userId, budgetId, 'UTC');
    expect(status.spent).toBe('250');
    expect(status.limit).toBe('1000');
    expect(status.remaining).toBe('750');
    expect(status.percentageUsed).toBe('25');
    expect(status.status).toBe('healthy');
    expect(status.daysRemaining).toBeGreaterThan(0);
  });

  it('computes split-aware category spending', async () => {
    const splitTxId = await (async () => {
      const now = new Date();
      const rawId = crypto.randomUUID();
      await db.insert(schema.rawTransactions).values({
        id: rawId,
        userId,
        statementId: (
          await db
            .select({ id: schema.statements.id })
            .from(schema.statements)
            .where(eq(schema.statements.userId, userId))
            .limit(1)
        )[0]!.id,
        financialAccountId: accountId,
        sourceRow: 99,
        rawPayload: {},
        rawDescription: 'MIXED',
        createdAt: now,
        updatedAt: now,
      });
      const txId = crypto.randomUUID();
      await db.insert(schema.transactions).values({
        id: txId,
        userId,
        financialAccountId: accountId,
        statementId: (
          await db
            .select({ id: schema.statements.id })
            .from(schema.statements)
            .where(eq(schema.statements.userId, userId))
            .limit(1)
        )[0]!.id,
        sourceRawTransactionId: rawId,
        bookingDate: dateInCurrentMonth(6),
        amount: '150',
        currencyCode: 'USD',
        direction: 'debit',
        rawDescription: 'MIXED',
        importedDescription: 'MIXED',
        normalizedDescription: 'mixed',
        reviewed: true,
        createdAt: now,
        updatedAt: now,
      });
      return txId;
    })();

    await replaceTransactionSplits(db, userId, splitTxId, [
      {
        position: 0,
        amount: '90',
        currencyCode: 'USD',
        primaryCategoryId: groceriesId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
      {
        position: 1,
        amount: '60',
        currencyCode: 'USD',
        primaryCategoryId: null,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);

    const categoryBudget = await createBudget(db, userId, {
      name: 'Groceries only',
      currency: 'USD',
      amount: '1000',
      period: 'monthly',
      categoryId: groceriesId,
      accountId: null,
      rolloverEnabled: false,
      enabled: true,
    });
    const status = await getBudgetStatus(db, userId, categoryBudget.id, 'UTC');
    expect(status.spent).toBe('90');
  });
});

suite('planning goals integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `plan-goal-${crypto.randomUUID()}`;
  let accountId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    accountId = ctx.accountId;
    await ctx.insertTransaction({
      amount: '300',
      currency: 'USD',
      direction: 'credit',
      description: 'DEPOSIT',
      bookingDate: dateInCurrentMonth(1),
      balanceAfter: '18000',
    });
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('tracks manual progress exactly and allows exceeding the target', async () => {
    const goal = await createSavingsGoal(db, userId, {
      name: 'Vacation',
      currency: 'USD',
      targetAmount: '1000',
      trackingMode: 'manual',
      manualSavedAmount: '1250',
      enabled: true,
    });
    const progress = await getGoalProgress(db, userId, goal.id, 'UTC');
    expect(progress.currentAmount).toBe('1250');
    expect(progress.remaining).toBe('-250');
    expect(progress.percentageComplete).toBe('125');
    expect(progress.balanceAvailable).toBe(true);
  });

  it('tracks account-balance progress from latest balanceAfter', async () => {
    const goal = await createSavingsGoal(db, userId, {
      name: 'Car',
      currency: 'USD',
      targetAmount: '50000',
      trackingMode: 'account_balance',
      accountId,
      enabled: true,
    });
    const progress = await getGoalProgress(db, userId, goal.id, 'UTC');
    expect(progress.currentAmount).toBe('18000');
    expect(progress.percentageComplete).toBe('36');
    expect(progress.balanceAsOf).toBe(dateInCurrentMonth(1));
  });

  it('reports an unavailable balance honestly', async () => {
    const now = new Date();
    const eurInstitutionId = crypto.randomUUID();
    await db.insert(schema.institutions).values({
      id: eurInstitutionId,
      userId,
      name: 'Euro Bank',
      normalizedName: `euro-bank-${userId}`,
      countryCode: 'DE',
      createdAt: now,
      updatedAt: now,
    });
    const eurAccountId = crypto.randomUUID();
    await db.insert(schema.financialAccounts).values({
      id: eurAccountId,
      userId,
      institutionId: eurInstitutionId,
      displayName: 'Empty account',
      accountType: 'savings',
      currencyCode: 'EUR',
      createdAt: now,
      updatedAt: now,
    });
    const goal = await createSavingsGoal(db, userId, {
      name: 'Euro goal',
      currency: 'EUR',
      targetAmount: '1000',
      trackingMode: 'account_balance',
      accountId: eurAccountId,
      enabled: true,
    });
    const progress = await getGoalProgress(db, userId, goal.id, 'UTC');
    expect(progress.balanceAvailable).toBe(false);
    expect(progress.currentAmount).toBeNull();
  });
});

suite('planning alerts integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `plan-alert-${crypto.randomUUID()}`;

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    await ctx.insertTransaction({
      amount: '950',
      currency: 'USD',
      direction: 'debit',
      description: 'BIG SPEND',
    });
    await createBudget(db, userId, {
      name: 'Tight budget',
      currency: 'USD',
      amount: '1000',
      period: 'monthly',
      categoryId: null,
      accountId: null,
      rolloverEnabled: false,
      enabled: true,
      warningThreshold: 80,
    });
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('creates each budget threshold event once and dedupes on rerun', async () => {
    const first = await evaluateUserAlerts(db, userId, 'UTC');
    expect(first.eventsCreated).toBe(1);
    const second = await evaluateUserAlerts(db, userId, 'UTC');
    expect(second.eventsCreated).toBe(0);

    const { items } = await listAlertEvents(db, userId, { state: 'all', limit: 50, offset: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('budget_approaching');
    expect(await unreadAlertCount(db, userId)).toBe(1);
  });

  it('rejects a cross-user budget read as not found', async () => {
    await expect(getBudgetStatus(db, 'someone-else', 'missing', 'UTC')).rejects.toThrow();
  });
});
