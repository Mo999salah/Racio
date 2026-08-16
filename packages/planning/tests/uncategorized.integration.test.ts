import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import {
  createCategory,
  getDashboardSummary,
  getUncategorizedExpenseAllocations,
  replaceTransactionSplits,
  resolveAccountKnownBalance,
} from '@racio/transactions';
import {
  createAlertRule,
  createSavingsGoal,
  evaluateUserAlerts,
  getGoalProgress,
  listAlertEvents,
  unreadAlertCount,
} from '../src/index';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

async function seedUser(db: RacioDatabase, userId: string) {
  const now = new Date();
  await db.insert(schema.user).values({
    id: userId,
    name: 'Plan',
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
    fileChecksum: 'e'.repeat(64),
    uploadIdempotencyKey: crypto.randomUUID(),
    processingStatus: 'imported',
    currencyCode: 'USD',
    createdAt: now,
    updatedAt: now,
  });
  let nextRow = 1;
  const insertTransaction = async (input: {
    amount: string;
    currency?: string;
    direction: 'credit' | 'debit';
    description: string;
    balanceAfter?: string | null;
  }): Promise<string> => {
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
      bookingDate: '2026-08-01',
      amount: input.amount,
      currencyCode: input.currency ?? 'USD',
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
  const assignCategory = async (transactionId: string, categoryId: string) => {
    await db.insert(schema.transactionCategoryAssignments).values({
      id: crypto.randomUUID(),
      userId,
      transactionId,
      categoryId,
      role: 'primary',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    });
  };
  return { accountId, insertTransaction, assignCategory };
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
  await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
  await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
}

suite('uncategorized allocation counting', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `unc-alloc-${crypto.randomUUID()}`;
  let foodId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    foodId = (await createCategory(db, userId, { name: 'Food', kind: 'expense' }))!.id;

    // Unsplit uncategorized debit -> 1 allocation.
    await ctx.insertTransaction({ amount: '40', direction: 'debit', description: 'UNCATEGORIZED' });
    // Categorized unsplit debit -> 0 allocations.
    const categorizedId = await ctx.insertTransaction({
      amount: '25',
      direction: 'debit',
      description: 'CATEGORIZED',
    });
    await ctx.assignCategory(categorizedId, foodId);
    // Partially categorized split -> only the uncategorized split allocation counts.
    const partialId = await ctx.insertTransaction({
      amount: '100',
      direction: 'debit',
      description: 'PARTIAL',
    });
    await replaceTransactionSplits(db, userId, partialId, [
      {
        position: 0,
        amount: '70',
        currencyCode: 'USD',
        primaryCategoryId: foodId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
      {
        position: 1,
        amount: '30',
        currencyCode: 'USD',
        primaryCategoryId: null,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);
    // Fully categorized split -> 0 allocations.
    const fullId = await ctx.insertTransaction({
      amount: '80',
      direction: 'debit',
      description: 'FULL',
    });
    await replaceTransactionSplits(db, userId, fullId, [
      {
        position: 0,
        amount: '40',
        currencyCode: 'USD',
        primaryCategoryId: foodId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
      {
        position: 1,
        amount: '40',
        currencyCode: 'USD',
        primaryCategoryId: foodId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('counts unsplit uncategorized plus uncategorized split allocations', async () => {
    const allocations = await getUncategorizedExpenseAllocations(db, userId);
    const usd = allocations.find((row) => row.currency === 'USD');
    expect(usd).toMatchObject({ count: 2, amount: '70' });
  });
});

suite('uncategorized split archive and transfer semantics', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `unc-semantics-${crypto.randomUUID()}`;
  let foodId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    foodId = (await createCategory(db, userId, { name: 'Food', kind: 'expense' }))!.id;

    // Archived split versions ignored: replace an uncategorized split with a categorized one.
    const replacedId = await ctx.insertTransaction({
      amount: '100',
      direction: 'debit',
      description: 'REPLACED',
    });
    await replaceTransactionSplits(db, userId, replacedId, [
      {
        position: 0,
        amount: '70',
        currencyCode: 'USD',
        primaryCategoryId: foodId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
      {
        position: 1,
        amount: '30',
        currencyCode: 'USD',
        primaryCategoryId: null,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);
    await replaceTransactionSplits(db, userId, replacedId, [
      {
        position: 0,
        amount: '100',
        currencyCode: 'USD',
        primaryCategoryId: foodId,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);

    // Confirmed transfer with an uncategorized split does not count.
    const confirmedOutId = await ctx.insertTransaction({
      amount: '500',
      direction: 'debit',
      description: 'TRANSFER OUT',
    });
    const confirmedInId = await ctx.insertTransaction({
      amount: '500',
      direction: 'credit',
      description: 'TRANSFER IN',
    });
    await replaceTransactionSplits(db, userId, confirmedOutId, [
      {
        position: 0,
        amount: '500',
        currencyCode: 'USD',
        primaryCategoryId: null,
        secondaryCategoryIds: [],
        tagIds: [],
      },
    ]);
    await db.insert(schema.internalTransferLinks).values({
      id: crypto.randomUUID(),
      userId,
      outgoingTransactionId: confirmedOutId,
      incomingTransactionId: confirmedInId,
      status: 'confirmed',
      source: 'manual',
    });

    // Suggested transfer stays ordinary and still counts.
    const suggestedOutId = await ctx.insertTransaction({
      amount: '80',
      direction: 'debit',
      description: 'SUGGESTED OUT',
    });
    const suggestedInId = await ctx.insertTransaction({
      amount: '80',
      direction: 'credit',
      description: 'SUGGESTED IN',
    });
    await db.insert(schema.internalTransferLinks).values({
      id: crypto.randomUUID(),
      userId,
      outgoingTransactionId: suggestedOutId,
      incomingTransactionId: suggestedInId,
      status: 'suggested',
      source: 'system',
    });
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('ignores archived split versions and confirmed transfers, keeps suggested', async () => {
    const allocations = await getUncategorizedExpenseAllocations(db, userId);
    const usd = allocations.find((row) => row.currency === 'USD');
    // Only the suggested transfer's uncategorized debit (80) remains.
    expect(usd).toMatchObject({ count: 1, amount: '80' });
  });
});

suite('uncategorized alerts, multi-currency, and goal/dashboard agreement', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `unc-alert-${crypto.randomUUID()}`;

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedUser(db, userId);
    await ctx.insertTransaction({ amount: '40', direction: 'debit', description: 'USD UNCAT' });
    await ctx.insertTransaction({
      amount: '10',
      direction: 'credit',
      description: 'DEPOSIT',
      balanceAfter: '5000',
    });

    // Second EUR account for multi-currency separation.
    const now = new Date();
    const [institution] = await db
      .select({ id: schema.institutions.id })
      .from(schema.institutions)
      .where(eq(schema.institutions.userId, userId))
      .limit(1);
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
      displayName: 'Euro',
      accountType: 'savings',
      currencyCode: 'EUR',
      createdAt: now,
      updatedAt: now,
    });
    const eurStatementId = crypto.randomUUID();
    await db.insert(schema.statements).values({
      id: eurStatementId,
      userId,
      financialAccountId: eurAccountId,
      sourceType: 'csv',
      originalFilename: 'euro.csv',
      fileSize: 5,
      fileChecksum: 'f'.repeat(64),
      uploadIdempotencyKey: crypto.randomUUID(),
      processingStatus: 'imported',
      currencyCode: 'EUR',
      createdAt: now,
      updatedAt: now,
    });
    const eurRawId = crypto.randomUUID();
    await db.insert(schema.rawTransactions).values({
      id: eurRawId,
      userId,
      statementId: eurStatementId,
      financialAccountId: eurAccountId,
      sourceRow: 1,
      rawPayload: {},
      rawDescription: 'EUR UNCAT',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.transactions).values({
      id: crypto.randomUUID(),
      userId,
      financialAccountId: eurAccountId,
      statementId: eurStatementId,
      sourceRawTransactionId: eurRawId,
      bookingDate: '2026-08-01',
      amount: '50',
      currencyCode: 'EUR',
      direction: 'debit',
      rawDescription: 'EUR UNCAT',
      importedDescription: 'EUR UNCAT',
      normalizedDescription: 'eur uncat',
      reviewed: true,
      createdAt: now,
      updatedAt: now,
    });

    await createAlertRule(db, userId, {
      type: 'uncategorized_transactions',
      config: { type: 'uncategorized_transactions', threshold: 1 },
      enabled: true,
    });

    await createSavingsGoal(db, userId, {
      name: 'Balance goal',
      currency: 'USD',
      targetAmount: '10000',
      trackingMode: 'account_balance',
      accountId: ctx.accountId,
      enabled: true,
    });
  });

  afterAll(async () => {
    await cleanupUser(db, userId);
    await client.end();
  });

  it('keeps currencies separate in the reporting query', async () => {
    const allocations = await getUncategorizedExpenseAllocations(db, userId);
    const usd = allocations.find((row) => row.currency === 'USD');
    const eur = allocations.find((row) => row.currency === 'EUR');
    expect(usd).toMatchObject({ count: 1, amount: '40' });
    expect(eur).toMatchObject({ count: 1, amount: '50' });
    expect(allocations).toHaveLength(2);
  });

  it('creates the uncategorized event once and dedupes on rerun', async () => {
    const first = await evaluateUserAlerts(db, userId, 'UTC');
    expect(first.eventsCreated).toBe(1);
    const second = await evaluateUserAlerts(db, userId, 'UTC');
    expect(second.eventsCreated).toBe(0);
    const { items } = await listAlertEvents(db, userId, { state: 'all', limit: 50, offset: 0 });
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe('uncategorized_transactions');
    expect(await unreadAlertCount(db, userId)).toBe(1);
  });

  it('goal and dashboard resolve the same balance/provenance', async () => {
    const goals = await (async () => {
      const [goal] = await db
        .select({ id: schema.savingsGoals.id })
        .from(schema.savingsGoals)
        .where(eq(schema.savingsGoals.userId, userId))
        .limit(1);
      return getGoalProgress(db, userId, goal!.id, 'UTC');
    })();
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });
    const usdAccount = summary.accounts.find((account) => account.currency === 'USD');
    expect(goals.currentAmount).toBe('5000');
    expect(usdAccount?.balance?.amount).toBe('5000');
    expect(usdAccount?.balance?.source).toBe('transaction_balance_after');

    const resolved = await resolveAccountKnownBalance(db, userId, usdAccount!.id);
    expect(usdAccount?.balance).toEqual(resolved);
  });
});
