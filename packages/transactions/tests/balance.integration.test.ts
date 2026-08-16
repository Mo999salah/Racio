import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import { getDashboardSummary, resolveAccountKnownBalance } from '../src/index';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

type SeedOptions = {
  currency?: string;
  closingBalance?: string | null;
  periodEnd?: string | null;
};

async function seedAccount(db: RacioDatabase, userId: string, options: SeedOptions = {}) {
  const now = new Date();
  const currency = options.currency ?? 'USD';
  await db.insert(schema.user).values({
    id: userId,
    name: 'Balance',
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
    displayName: 'Account',
    accountType: 'checking',
    currencyCode: currency,
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
    fileChecksum: 'd'.repeat(64),
    uploadIdempotencyKey: crypto.randomUUID(),
    processingStatus: 'imported',
    currencyCode: currency,
    closingBalance: options.closingBalance ?? null,
    periodEnd: options.periodEnd ?? null,
    confirmedAt: options.closingBalance != null ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  let nextRow = 1;
  const insertTransaction = async (input: {
    amount: string;
    currency?: string;
    direction: 'credit' | 'debit';
    description: string;
    bookingDate?: string;
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
      bookingDate: input.bookingDate ?? isoDate(now),
      amount: input.amount,
      currencyCode: input.currency ?? currency,
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
  return { accountId, insertTransaction };
}

async function cleanupUser(db: RacioDatabase, userId: string) {
  await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
  await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
  await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
  await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
  await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
  await db.delete(schema.user).where(eq(schema.user.id, userId));
}

suite('balance provenance resolver integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
  });

  afterAll(async () => {
    await client.end();
  });

  it('resolves the latest transaction balance_after when present', async () => {
    const userId = `bal-tx-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId);
    await ctx.insertTransaction({
      amount: '10',
      direction: 'credit',
      description: 'A',
      bookingDate: '2026-01-01',
      balanceAfter: '100',
    });
    await ctx.insertTransaction({
      amount: '10',
      direction: 'credit',
      description: 'B',
      bookingDate: '2026-01-02',
      balanceAfter: '200.5',
    });
    const balance = await resolveAccountKnownBalance(db, userId, ctx.accountId);
    expect(balance).toMatchObject({
      amount: '200.5',
      currency: 'USD',
      asOfDate: '2026-01-02',
      source: 'transaction_balance_after',
    });
    await cleanupUser(db, userId);
  });

  it('falls back to the latest confirmed statement closing balance', async () => {
    const userId = `bal-stmt-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId, {
      closingBalance: '5000',
      periodEnd: '2026-07-31',
    });
    const balance = await resolveAccountKnownBalance(db, userId, ctx.accountId);
    expect(balance).toMatchObject({
      amount: '5000',
      currency: 'USD',
      asOfDate: '2026-07-31',
      source: 'statement_closing_balance',
    });
    await cleanupUser(db, userId);
  });

  it('returns unavailable when neither source exists', async () => {
    const userId = `bal-none-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId);
    await ctx.insertTransaction({
      amount: '10',
      direction: 'credit',
      description: 'A',
      balanceAfter: null,
    });
    const balance = await resolveAccountKnownBalance(db, userId, ctx.accountId);
    expect(balance).toBeNull();
    await cleanupUser(db, userId);
  });

  it('rejects a cross-user account', async () => {
    const userId = `bal-own-${crypto.randomUUID()}`;
    const otherId = `bal-other-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId);
    await expect(resolveAccountKnownBalance(db, otherId, ctx.accountId)).rejects.toThrow();
    await cleanupUser(db, userId);
  });

  it('preserves 0/2/3/6 decimal precision', async () => {
    const userId = `bal-prec-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId);
    await ctx.insertTransaction({
      amount: '1',
      direction: 'credit',
      description: '0dp',
      bookingDate: '2026-01-01',
      balanceAfter: '0',
    });
    await ctx.insertTransaction({
      amount: '1',
      direction: 'credit',
      description: '2dp',
      bookingDate: '2026-01-02',
      balanceAfter: '12.34',
    });
    await ctx.insertTransaction({
      amount: '1',
      direction: 'credit',
      description: '3dp',
      bookingDate: '2026-01-03',
      balanceAfter: '12.345',
    });
    await ctx.insertTransaction({
      amount: '1',
      direction: 'credit',
      description: '6dp',
      bookingDate: '2026-01-04',
      balanceAfter: '12.340006',
    });
    const balance = await resolveAccountKnownBalance(db, userId, ctx.accountId);
    expect(balance?.amount).toBe('12.340006');
    await cleanupUser(db, userId);
  });

  it('reports the same balance/provenance in the dashboard', async () => {
    const userId = `bal-dash-${crypto.randomUUID()}`;
    const ctx = await seedAccount(db, userId, { closingBalance: '7500', periodEnd: '2026-06-30' });
    await ctx.insertTransaction({
      amount: '20',
      direction: 'credit',
      description: 'D',
      bookingDate: '2026-05-01',
      balanceAfter: '3000',
    });
    const resolved = await resolveAccountKnownBalance(db, userId, ctx.accountId);
    const summary = await getDashboardSummary(db, userId, {
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
    });
    const account = summary.accounts.find((item) => item.id === ctx.accountId);
    expect(account?.balance).toEqual(resolved);
    await cleanupUser(db, userId);
  });
});
