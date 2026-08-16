import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import { createCategory, createTag } from '../src/index';
import {
  createMerchant,
  createMerchantAlias,
  replaceTransactionSplits,
  suggestInternalTransfers,
  actionInternalTransfer,
} from '../src/phase6';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;

suite('Phase 5/6 unique-violation integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const userId = `eh-user-${crypto.randomUUID()}`;
  const now = new Date();
  const ids: string[] = [];

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    await db.insert(schema.user).values({
      id: userId,
      name: 'Integration',
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await db.delete(schema.transactionSplits).where(eq(schema.transactionSplits.userId, userId));
    await db.delete(schema.transactions).where(eq(schema.transactions.userId, userId));
    await db.delete(schema.rawTransactions).where(eq(schema.rawTransactions.userId, userId));
    await db.delete(schema.statements).where(eq(schema.statements.userId, userId));
    await db.delete(schema.financialAccounts).where(eq(schema.financialAccounts.userId, userId));
    await db.delete(schema.institutions).where(eq(schema.institutions.userId, userId));
    await db.delete(schema.categories).where(eq(schema.categories.userId, userId));
    await db.delete(schema.tags).where(eq(schema.tags.userId, userId));
    await db.delete(schema.merchantAliases).where(eq(schema.merchantAliases.userId, userId));
    await db.delete(schema.merchants).where(eq(schema.merchants.userId, userId));
    await db
      .delete(schema.internalTransferLinks)
      .where(eq(schema.internalTransferLinks.userId, userId));
    await client.end();
  });

  it('maps duplicate category and tag names to CONFLICT through the real Drizzle wrapper', async () => {
    await createCategory(db, userId, { name: 'Food', kind: 'expense', parentId: null });
    await expect(
      createCategory(db, userId, { name: 'FOOD', kind: 'expense', parentId: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    await createTag(db, userId, { name: 'Weekly' });
    await expect(createTag(db, userId, { name: 'WEEKLY' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('maps duplicate merchant names and alias patterns to CONFLICT', async () => {
    await createMerchant(db, userId, { displayName: 'Coffee', notes: null });
    await expect(
      createMerchant(db, userId, { displayName: 'COFFEE', notes: null }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const merchant = (
      await db.select().from(schema.merchants).where(eq(schema.merchants.userId, userId)).limit(1)
    )[0]!;
    await createMerchantAlias(db, userId, merchant.id, {
      rawPattern: 'Cafe',
      matchType: 'exact_normalized_description',
      enabled: true,
      priority: 100,
    });
    await expect(
      createMerchantAlias(db, userId, merchant.id, {
        rawPattern: 'CAFE',
        matchType: 'exact_normalized_description',
        enabled: true,
        priority: 100,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('allows atomic split replacement at the same positions (partial position unique)', async () => {
    const institution = (
      await db
        .insert(schema.institutions)
        .values({
          id: crypto.randomUUID(),
          userId,
          name: 'B',
          normalizedName: 'b',
          countryCode: 'US',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    ids.push(institution.id);
    const account = (
      await db
        .insert(schema.financialAccounts)
        .values({
          id: crypto.randomUUID(),
          userId,
          institutionId: institution.id,
          displayName: 'A',
          accountType: 'checking',
          currencyCode: 'USD',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    ids.push(account.id);
    const statement = (
      await db
        .insert(schema.statements)
        .values({
          id: crypto.randomUUID(),
          userId,
          financialAccountId: account.id,
          sourceType: 'csv',
          originalFilename: 'a.csv',
          fileSize: 5,
          fileChecksum: 'a'.repeat(64),
          uploadIdempotencyKey: crypto.randomUUID(),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    ids.push(statement.id);
    const raw = (
      await db
        .insert(schema.rawTransactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          statementId: statement.id,
          financialAccountId: account.id,
          sourceRow: 1,
          rawPayload: {},
          rawDescription: 'x',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    ids.push(raw.id);
    const tx = (
      await db
        .insert(schema.transactions)
        .values({
          id: crypto.randomUUID(),
          userId,
          financialAccountId: account.id,
          statementId: statement.id,
          sourceRawTransactionId: raw.id,
          bookingDate: '2024-01-01',
          amount: '100.000000',
          currencyCode: 'USD',
          direction: 'debit',
          rawDescription: 'x',
          importedDescription: 'x',
          normalizedDescription: 'x',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!;
    ids.push(tx.id);

    const split = (position: number, amount: string) => ({
      position,
      amount,
      currencyCode: 'USD',
      primaryCategoryId: null,
      secondaryCategoryIds: [],
      tagIds: [],
    });

    await replaceTransactionSplits(db, userId, tx.id, [split(0, '100.000000')]);
    const replaced = await replaceTransactionSplits(db, userId, tx.id, [
      split(0, '60.000000'),
      split(1, '40.000000'),
    ]);
    expect(replaced.splits).toHaveLength(2);
  });
});
