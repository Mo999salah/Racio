import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import { createCategory, getDashboardSummary } from '../src/index';
import { createMerchant, replaceTransactionSplits } from '../src/phase6';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function split(position: number, amount: string, primaryCategoryId: string | null) {
  return {
    position,
    amount,
    currencyCode: 'USD',
    primaryCategoryId,
    secondaryCategoryIds: [],
    tagIds: [],
  };
}

type TxInput = {
  amount: string;
  currency: string;
  direction: 'credit' | 'debit';
  description: string;
  reviewed?: boolean;
  merchantId?: string | null;
};

async function seedContext(db: RacioDatabase, userId: string) {
  const now = new Date();
  await db.insert(schema.user).values({
    id: userId,
    name: 'Dashboard',
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
    fileChecksum: 'a'.repeat(64),
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
      bookingDate: daysAgo(3),
      amount: input.amount,
      currencyCode: input.currency,
      direction: input.direction,
      rawDescription: input.description,
      importedDescription: input.description,
      normalizedDescription: input.description.toLowerCase(),
      reviewed: input.reviewed ?? true,
      merchantId: input.merchantId ?? null,
      createdAt: now,
      updatedAt: now,
    });
    return transactionId;
  };
  return { accountId, statementId, insertTransaction };
}

async function seedCategory(db: RacioDatabase, userId: string, name: string) {
  return (await createCategory(db, userId, { name, kind: 'expense', parentId: null }))!;
}

suite('dashboard summary integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `dash-user-${crypto.randomUUID()}`;
  const now = new Date();
  const eurAccountId = crypto.randomUUID();
  const eurInstitutionId = crypto.randomUUID();
  let accountId = '';
  let groceriesId = '';
  let diningId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedContext(db, userId);
    accountId = ctx.accountId;

    await db.insert(schema.institutions).values({
      id: eurInstitutionId,
      userId,
      name: 'Euro Bank',
      normalizedName: `euro-bank-${userId}`,
      countryCode: 'DE',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.financialAccounts).values({
      id: eurAccountId,
      userId,
      institutionId: eurInstitutionId,
      displayName: 'Savings',
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
      fileChecksum: 'b'.repeat(64),
      uploadIdempotencyKey: crypto.randomUUID(),
      processingStatus: 'imported',
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
      rawDescription: 'euro',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.transactions).values({
      id: crypto.randomUUID(),
      userId,
      financialAccountId: eurAccountId,
      statementId: eurStatementId,
      sourceRawTransactionId: eurRawId,
      bookingDate: daysAgo(3),
      amount: '50',
      currencyCode: 'EUR',
      direction: 'credit',
      rawDescription: 'EURO CREDIT',
      importedDescription: 'EURO CREDIT',
      normalizedDescription: 'euro credit',
      reviewed: true,
      createdAt: now,
      updatedAt: now,
    });

    groceriesId = (await seedCategory(db, userId, 'Groceries')).id;
    diningId = (await seedCategory(db, userId, 'Dining')).id;

    await ctx.insertTransaction({
      amount: '1000',
      currency: 'USD',
      direction: 'credit',
      description: 'SALARY',
    });
    await ctx
      .insertTransaction({
        amount: '200',
        currency: 'USD',
        direction: 'debit',
        description: 'GROCERY STORE',
        reviewed: false,
      })
      .then(async (txId) => {
        await db.insert(schema.transactionCategoryAssignments).values({
          id: crypto.randomUUID(),
          userId,
          transactionId: txId,
          categoryId: groceriesId,
          role: 'primary',
          source: 'manual',
          createdAt: now,
          updatedAt: now,
        });
      });
    const merchant = (await createMerchant(db, userId, {
      displayName: 'Riverside Diner',
      notes: null,
    }))!;
    await ctx
      .insertTransaction({
        amount: '300',
        currency: 'USD',
        direction: 'debit',
        description: 'RESTAURANT',
        merchantId: merchant.id,
      })
      .then(async (txId) => {
        await db.insert(schema.transactionCategoryAssignments).values({
          id: crypto.randomUUID(),
          userId,
          transactionId: txId,
          categoryId: diningId,
          role: 'primary',
          source: 'manual',
          createdAt: now,
          updatedAt: now,
        });
      });

    const splitTxId = await ctx.insertTransaction({
      amount: '150',
      currency: 'USD',
      direction: 'debit',
      description: 'MIXED PURCHASE',
    });
    await replaceTransactionSplits(db, userId, splitTxId, [
      split(0, '90', groceriesId),
      split(1, '60', null),
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.transactionSplitCategoryAssignments)
      .where(eq(schema.transactionSplitCategoryAssignments.userId, userId));
    await db
      .delete(schema.transactionCategoryAssignments)
      .where(eq(schema.transactionCategoryAssignments.userId, userId));
    await db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.userId, userId));
    await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
    await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
    await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
    await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
    await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
    await client.end();
  });

  it('computes exact per-currency cash flow without mixing currencies', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const usd = summary.cashFlow.find((row) => row.currency === 'USD');
    const eur = summary.cashFlow.find((row) => row.currency === 'EUR');
    expect(usd).toMatchObject({
      inflow: '1000',
      outflow: '650',
      net: '350',
      count: 4,
      unresolvedCount: 0,
    });
    expect(eur).toMatchObject({ inflow: '50', outflow: '0', net: '50', count: 1 });
    expect(summary.currencies.sort()).toEqual(['EUR', 'USD']);
  });

  it('allocates category analytics by active split and keeps parent uncounted', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const byName = new Map(
      summary.categories.filter((row) => row.currency === 'USD').map((row) => [row.name, row]),
    );
    expect(byName.get('Dining')?.amount).toBe('300');
    expect(byName.get('Groceries')?.amount).toBe('290');
    expect(byName.get(null)?.amount).toBe('60');
    expect(byName.size).toBe(3);
  });

  it('keeps merchant analytics parent-level', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const merchants = summary.merchants.filter((row) => row.currency === 'USD');
    expect(merchants).toHaveLength(1);
    expect(merchants[0]).toMatchObject({ name: 'Riverside Diner', amount: '300' });
  });

  it('reports account position and attention counts', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const usd = summary.accounts.find((account) => account.currency === 'USD');
    expect(usd).toMatchObject({
      name: 'Checking',
      netActivity: '350',
      transactionCount: 4,
      hasData: true,
    });
    expect(summary.attention.unreviewed).toBe(1);
  });
});

suite('dashboard split replacement semantics', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `split-user-${crypto.randomUUID()}`;
  let groceriesId = '';
  let diningId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedContext(db, userId);
    groceriesId = (await seedCategory(db, userId, 'Groceries')).id;
    diningId = (await seedCategory(db, userId, 'Dining')).id;

    const txId = await ctx.insertTransaction({
      amount: '100',
      currency: 'USD',
      direction: 'debit',
      description: 'REPLACED',
    });
    await replaceTransactionSplits(db, userId, txId, [split(0, '100', groceriesId)]);
    await replaceTransactionSplits(db, userId, txId, [split(0, '100', diningId)]);
  });

  afterAll(async () => {
    await db
      .delete(schema.transactionSplitCategoryAssignments)
      .where(eq(schema.transactionSplitCategoryAssignments.userId, userId));
    await db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.userId, userId));
    await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
    await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
    await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
    await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
    await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
    await client.end();
  });

  it('ignores archived split versions and uses only the current active set', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const byName = new Map(summary.categories.map((row) => [row.name, row]));
    expect(byName.get('Dining')?.amount).toBe('100');
    expect(byName.get('Groceries')?.amount).toBeUndefined();
    expect(byName.get(null)?.amount).toBeUndefined();
  });
});

suite('dashboard transfer semantics', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `transfer-user-${crypto.randomUUID()}`;
  let groceriesId = '';
  let diningId = '';
  let eurAccountId = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedContext(db, userId);
    groceriesId = (await seedCategory(db, userId, 'Groceries')).id;
    diningId = (await seedCategory(db, userId, 'Dining')).id;

    const merchant = (await createMerchant(db, userId, {
      displayName: 'Internal Payee',
      notes: null,
    }))!;
    const now = new Date();

    const assign = async (transactionId: string, categoryId: string) => {
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
    const link = async (
      outgoingTransactionId: string,
      incomingTransactionId: string,
      status: 'confirmed' | 'suggested' | 'rejected',
    ) => {
      await db.insert(schema.internalTransferLinks).values({
        id: crypto.randomUUID(),
        userId,
        outgoingTransactionId,
        incomingTransactionId,
        status,
        source: status === 'confirmed' ? 'manual' : 'system',
      });
    };

    // Normal income and expense (must remain unchanged).
    await ctx.insertTransaction({
      amount: '1000',
      currency: 'USD',
      direction: 'credit',
      description: 'SALARY',
    });
    const expenseId = await ctx.insertTransaction({
      amount: '200',
      currency: 'USD',
      direction: 'debit',
      description: 'GROCERIES',
    });
    await assign(expenseId, groceriesId);

    // Confirmed internal transfer (both legs must be excluded).
    const confirmedOutId = await ctx.insertTransaction({
      amount: '500',
      currency: 'USD',
      direction: 'debit',
      description: 'TRANSFER OUT',
      merchantId: merchant.id,
    });
    const confirmedInId = await ctx.insertTransaction({
      amount: '500',
      currency: 'USD',
      direction: 'credit',
      description: 'TRANSFER IN',
    });
    await assign(confirmedOutId, groceriesId);
    await link(confirmedOutId, confirmedInId, 'confirmed');

    // Suggested transfer (ordinary transactions until confirmed).
    const suggestedOutId = await ctx.insertTransaction({
      amount: '80',
      currency: 'USD',
      direction: 'debit',
      description: 'SUGGESTED OUT',
    });
    const suggestedInId = await ctx.insertTransaction({
      amount: '80',
      currency: 'USD',
      direction: 'credit',
      description: 'SUGGESTED IN',
    });
    await assign(suggestedOutId, diningId);
    await link(suggestedOutId, suggestedInId, 'suggested');

    // Rejected transfer (ordinary transactions).
    const rejectedOutId = await ctx.insertTransaction({
      amount: '40',
      currency: 'USD',
      direction: 'debit',
      description: 'REJECTED OUT',
    });
    const rejectedInId = await ctx.insertTransaction({
      amount: '40',
      currency: 'USD',
      direction: 'credit',
      description: 'REJECTED IN',
    });
    await assign(rejectedOutId, diningId);
    await link(rejectedOutId, rejectedInId, 'rejected');

    // EUR account to prove a confirmed transfer in one currency stays isolated.
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
    eurAccountId = crypto.randomUUID();
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
      fileChecksum: 'e'.repeat(64),
      uploadIdempotencyKey: crypto.randomUUID(),
      processingStatus: 'imported',
      createdAt: now,
      updatedAt: now,
    });
    let eurRow = 1;
    const eurTx = async (amount: string, direction: 'credit' | 'debit', description: string) => {
      const rawId = crypto.randomUUID();
      await db.insert(schema.rawTransactions).values({
        id: rawId,
        userId,
        statementId: eurStatementId,
        financialAccountId: eurAccountId,
        sourceRow: eurRow,
        rawPayload: {},
        rawDescription: description,
        createdAt: now,
        updatedAt: now,
      });
      eurRow += 1;
      const transactionId = crypto.randomUUID();
      await db.insert(schema.transactions).values({
        id: transactionId,
        userId,
        financialAccountId: eurAccountId,
        statementId: eurStatementId,
        sourceRawTransactionId: rawId,
        bookingDate: daysAgo(3),
        amount,
        currencyCode: 'EUR',
        direction,
        rawDescription: description,
        importedDescription: description,
        normalizedDescription: description.toLowerCase(),
        reviewed: true,
        createdAt: now,
        updatedAt: now,
      });
      return transactionId;
    };
    await eurTx('111', 'credit', 'EUR SALARY');
    const eurOutId = await eurTx('999', 'debit', 'EUR OUT');
    const eurInId = await eurTx('999', 'credit', 'EUR IN');
    await link(eurOutId, eurInId, 'confirmed');
  });

  afterAll(async () => {
    await db
      .delete(schema.internalTransferLinks)
      .where(eq(schema.internalTransferLinks.userId, userId));
    await db
      .delete(schema.transactionCategoryAssignments)
      .where(eq(schema.transactionCategoryAssignments.userId, userId));
    await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
    await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
    await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
    await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
    await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
    await client.end();
  });

  it('excludes confirmed transfers from income, expense, and net cash flow', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const usd = summary.cashFlow.find((row) => row.currency === 'USD');
    const eur = summary.cashFlow.find((row) => row.currency === 'EUR');

    expect(usd).toMatchObject({
      inflow: '1120',
      outflow: '320',
      net: '800',
      count: 6,
    });
    expect(eur).toMatchObject({ inflow: '111', outflow: '0', net: '111', count: 1 });
  });

  it('keeps category and merchant analytics transfer-excluded', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const byName = new Map(summary.categories.map((row) => [row.name, row]));
    expect(byName.get('Groceries')?.amount).toBe('200');
    expect(byName.get('Dining')?.amount).toBe('120');
    expect(byName.get(null)?.amount).toBeUndefined();
    expect(summary.merchants).toHaveLength(0);
  });

  it('keeps account movement raw while financial cash flow is transfer-aware', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const usd = summary.accounts.find((account) => account.currency === 'USD');
    expect(usd).toMatchObject({ transactionCount: 8, netActivity: '800' });
  });
});

suite('dashboard decimal precision', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `precision-user-${crypto.randomUUID()}`;

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const ctx = await seedContext(db, userId);
    const groceriesId = (await seedCategory(db, userId, 'Groceries')).id;
    const diningId = (await seedCategory(db, userId, 'Dining')).id;

    const txId = await ctx.insertTransaction({
      amount: '12.340006',
      currency: 'USD',
      direction: 'debit',
      description: 'PRECISION',
    });
    await replaceTransactionSplits(db, userId, txId, [
      split(0, '2.34', groceriesId),
      split(1, '3.456', diningId),
      split(2, '6.544006', null),
    ]);
  });

  afterAll(async () => {
    await db
      .delete(schema.transactionSplitCategoryAssignments)
      .where(eq(schema.transactionSplitCategoryAssignments.userId, userId));
    await db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.userId, userId));
    await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
    await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
    await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
    await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
    await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
    await client.end();
  });

  it('preserves 2, 3, and 6 decimal places exactly', async () => {
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: daysAgo(30),
      dateTo: daysAgo(0),
    });
    const byName = new Map(summary.categories.map((row) => [row.name, row]));
    expect(byName.get('Groceries')?.amount).toBe('2.34');
    expect(byName.get('Dining')?.amount).toBe('3.456');
    expect(byName.get(null)?.amount).toBe('6.544006');
    expect(summary.cashFlow[0]).toMatchObject({ outflow: '12.340006', net: '-12.340006' });
  });
});
