import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type {
  HistoricalAliasApply,
  MerchantAliasCreate,
  MerchantAliasPatch,
  MerchantCreate,
  MerchantPatch,
  ManualTransferLink,
  TransactionMerchantPatch,
  TransactionSplit,
  TransferListQuery,
} from '@racio/contracts';
import {
  evaluateTransferPair,
  merchantAliasMatches,
  normalizeMerchantName,
  validateSplitSet,
  type TransferCandidate,
} from '@racio/domain';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';

const MAX_ALIAS_PREVIEW = 1_000;
const MAX_ALIAS_APPLY = 5_000;
const MAX_TRANSFER_SCAN = 1_000;

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

function dbOf(tx: unknown): RacioDatabase {
  return tx as RacioDatabase;
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function ownedTransaction(db: RacioDatabase, userId: string, transactionId: string) {
  const [row] = await db
    .select({
      id: schema.transactions.id,
      amount: schema.transactions.amount,
      currencyCode: schema.transactions.currencyCode,
      direction: schema.transactions.direction,
      bookingDate: schema.transactions.bookingDate,
      financialAccountId: schema.transactions.financialAccountId,
      status: schema.transactions.status,
      importedDescription: schema.transactions.importedDescription,
      normalizedDescription: schema.transactions.normalizedDescription,
      rawDescription: schema.transactions.rawDescription,
      counterparty: schema.transactions.counterparty,
      bankTransactionId: schema.transactions.bankTransactionId,
      merchantId: schema.transactions.merchantId,
      merchantSource: schema.transactions.merchantSource,
    })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)))
    .limit(1);
  if (!row) notFound('Transaction not found.');
  return row;
}

async function ownedMerchant(db: RacioDatabase, userId: string, merchantId: string) {
  const [row] = await db
    .select()
    .from(schema.merchants)
    .where(and(eq(schema.merchants.id, merchantId), eq(schema.merchants.userId, userId)))
    .limit(1);
  if (!row) notFound('Merchant not found.');
  return row;
}

async function assertOwnedCategoryAndTagIds(
  db: RacioDatabase,
  userId: string,
  splits: TransactionSplit[],
) {
  const categoryIds = [
    ...new Set(
      splits
        .flatMap((split) => [split.primaryCategoryId, ...split.secondaryCategoryIds])
        .filter(Boolean),
    ),
  ] as string[];
  const tagIds = [...new Set(splits.flatMap((split) => split.tagIds))];
  if (categoryIds.length) {
    const rows = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.userId, userId), inArray(schema.categories.id, categoryIds)));
    if (rows.length !== categoryIds.length)
      notFound('One or more split categories were not found.');
  }
  if (tagIds.length) {
    const rows = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.userId, userId), inArray(schema.tags.id, tagIds)));
    if (rows.length !== tagIds.length) notFound('One or more split tags were not found.');
  }
}

async function splitRows(db: RacioDatabase, userId: string, transactionId: string) {
  const rows = await db
    .select()
    .from(schema.transactionSplits)
    .where(
      and(
        eq(schema.transactionSplits.userId, userId),
        eq(schema.transactionSplits.transactionId, transactionId),
        isNull(schema.transactionSplits.archivedAt),
      ),
    )
    .orderBy(asc(schema.transactionSplits.position));
  if (!rows.length) return [];
  const splitIds = rows.map((row) => row.id);
  const [categories, tags] = await Promise.all([
    db
      .select({
        splitId: schema.transactionSplitCategoryAssignments.splitId,
        categoryId: schema.transactionSplitCategoryAssignments.categoryId,
        categoryName: schema.categories.name,
        role: schema.transactionSplitCategoryAssignments.role,
        source: schema.transactionSplitCategoryAssignments.source,
      })
      .from(schema.transactionSplitCategoryAssignments)
      .innerJoin(
        schema.categories,
        eq(schema.transactionSplitCategoryAssignments.categoryId, schema.categories.id),
      )
      .where(
        and(
          eq(schema.transactionSplitCategoryAssignments.userId, userId),
          inArray(schema.transactionSplitCategoryAssignments.splitId, splitIds),
        ),
      ),
    db
      .select({
        splitId: schema.transactionSplitTags.splitId,
        tagId: schema.transactionSplitTags.tagId,
        tagName: schema.tags.name,
        source: schema.transactionSplitTags.source,
      })
      .from(schema.transactionSplitTags)
      .innerJoin(schema.tags, eq(schema.transactionSplitTags.tagId, schema.tags.id))
      .where(
        and(
          eq(schema.transactionSplitTags.userId, userId),
          inArray(schema.transactionSplitTags.splitId, splitIds),
        ),
      ),
  ]);
  return rows.map((row) => ({
    ...row,
    primaryCategory:
      categories.find((item) => item.splitId === row.id && item.role === 'primary') ?? null,
    secondaryCategories: categories.filter(
      (item) => item.splitId === row.id && item.role === 'secondary',
    ),
    tags: tags.filter((item) => item.splitId === row.id),
  }));
}

export async function getTransactionSplits(
  db: RacioDatabase,
  userId: string,
  transactionId: string,
) {
  const transaction = await ownedTransaction(db, userId, transactionId);
  return {
    transactionId,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    splits: await splitRows(db, userId, transactionId),
  };
}

export async function replaceTransactionSplits(
  db: RacioDatabase,
  userId: string,
  transactionId: string,
  splits: TransactionSplit[],
) {
  await assertOwnedCategoryAndTagIds(db, userId, splits);
  return db.transaction(async (tx) => {
    const transaction = await ownedTransaction(dbOf(tx), userId, transactionId);
    if (transaction.status === 'archived') conflict('Archived transactions cannot be split.');
    if (!splits.length) {
      await tx
        .update(schema.transactionSplits)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.transactionSplits.userId, userId),
            eq(schema.transactionSplits.transactionId, transactionId),
            isNull(schema.transactionSplits.archivedAt),
          ),
        );
      return getTransactionSplits(dbOf(tx), userId, transactionId);
    }
    const validationResult = validateSplitSet(
      transaction.amount,
      transaction.currencyCode,
      splits.map((split) => ({
        id: split.id,
        position: split.position,
        amount: split.amount,
        currencyCode: split.currencyCode,
      })),
    );
    if (!validationResult.valid) validation(validationResult.errors.join(', '));
    const current = await tx
      .select({ id: schema.transactionSplits.id })
      .from(schema.transactionSplits)
      .where(
        and(
          eq(schema.transactionSplits.userId, userId),
          eq(schema.transactionSplits.transactionId, transactionId),
          isNull(schema.transactionSplits.archivedAt),
        ),
      );
    const now = new Date();
    if (current.length)
      await tx
        .update(schema.transactionSplits)
        .set({ archivedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.transactionSplits.userId, userId),
            eq(schema.transactionSplits.transactionId, transactionId),
            isNull(schema.transactionSplits.archivedAt),
          ),
        );
    for (const split of splits) {
      // Replacements receive fresh IDs so archived historical versions remain immutable.
      const splitId = randomUUID();
      await tx.insert(schema.transactionSplits).values({
        id: splitId,
        userId,
        transactionId,
        position: split.position,
        amount: split.amount,
        currencyCode: split.currencyCode,
        description: split.description ?? null,
        note: split.note ?? null,
        createdAt: now,
        updatedAt: now,
      });
      if (split.primaryCategoryId)
        await tx.insert(schema.transactionSplitCategoryAssignments).values({
          id: randomUUID(),
          userId,
          splitId,
          categoryId: split.primaryCategoryId,
          role: 'primary',
          source: 'manual',
        });
      for (const categoryId of split.secondaryCategoryIds)
        await tx.insert(schema.transactionSplitCategoryAssignments).values({
          id: randomUUID(),
          userId,
          splitId,
          categoryId,
          role: 'secondary',
          source: 'manual',
        });
      for (const tagId of split.tagIds)
        await tx.insert(schema.transactionSplitTags).values({
          id: randomUUID(),
          userId,
          splitId,
          tagId,
          source: 'manual',
        });
    }
    return getTransactionSplits(dbOf(tx), userId, transactionId);
  });
}

export async function setTransactionMerchant(
  db: RacioDatabase,
  userId: string,
  transactionId: string,
  input: TransactionMerchantPatch,
) {
  await ownedTransaction(db, userId, transactionId);
  if (input.merchantId) {
    const merchant = await ownedMerchant(db, userId, input.merchantId);
    if (merchant.status !== 'active') conflict('Only active merchants can be assigned.');
  }
  const [row] = await db
    .update(schema.transactions)
    .set({
      merchantId: input.merchantId,
      merchantSource: input.merchantId ? 'manual' : null,
      merchantConfidence: input.merchantId ? '1.0000' : null,
      merchantUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)))
    .returning({ id: schema.transactions.id, merchantId: schema.transactions.merchantId });
  return row;
}

export async function listMerchants(db: RacioDatabase, userId: string, includeArchived = false) {
  return db
    .select()
    .from(schema.merchants)
    .where(
      and(
        eq(schema.merchants.userId, userId),
        includeArchived ? sql`true` : ne(schema.merchants.status, 'archived'),
      ),
    )
    .orderBy(asc(schema.merchants.normalizedName))
    .limit(500);
}

export async function createMerchant(db: RacioDatabase, userId: string, input: MerchantCreate) {
  const normalizedName = normalizeMerchantName(input.displayName);
  if (!normalizedName) validation('Merchant name is required.');
  try {
    const [row] = await db
      .insert(schema.merchants)
      .values({
        id: randomUUID(),
        userId,
        displayName: input.displayName.trim(),
        normalizedName,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      conflict('A merchant with this name already exists.');
    throw error;
  }
}

export async function updateMerchant(
  db: RacioDatabase,
  userId: string,
  merchantId: string,
  input: MerchantPatch,
) {
  const current = await ownedMerchant(db, userId, merchantId);
  const displayName = input.displayName ?? current.displayName;
  const normalizedName = normalizeMerchantName(displayName);
  if (!normalizedName) validation('Merchant name is required.');
  const [row] = await db
    .update(schema.merchants)
    .set({
      displayName: displayName.trim(),
      normalizedName,
      notes: input.notes === undefined ? current.notes : input.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.merchants.id, merchantId), eq(schema.merchants.userId, userId)))
    .returning();
  return row;
}

export async function actionMerchant(
  db: RacioDatabase,
  userId: string,
  merchantId: string,
  action: 'archive' | 'restore',
) {
  const merchant = await ownedMerchant(db, userId, merchantId);
  if (merchant.status === 'merged') conflict('Merged merchants must be unmerged first.');
  const archived = action === 'archive';
  const [row] = await db
    .update(schema.merchants)
    .set({
      status: archived ? 'archived' : 'active',
      archivedAt: archived ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.merchants.id, merchantId), eq(schema.merchants.userId, userId)))
    .returning();
  return row;
}

export async function listMerchantAliases(db: RacioDatabase, userId: string, merchantId?: string) {
  return db
    .select()
    .from(schema.merchantAliases)
    .where(
      and(
        eq(schema.merchantAliases.userId, userId),
        merchantId ? eq(schema.merchantAliases.merchantId, merchantId) : sql`true`,
      ),
    )
    .orderBy(asc(schema.merchantAliases.priority), asc(schema.merchantAliases.createdAt))
    .limit(500);
}

export async function createMerchantAlias(
  db: RacioDatabase,
  userId: string,
  merchantId: string,
  input: MerchantAliasCreate,
) {
  const merchant = await ownedMerchant(db, userId, merchantId);
  if (merchant.status !== 'active') conflict('Only active merchants can receive aliases.');
  const normalizedPattern = normalizeMerchantName(input.rawPattern);
  if (!normalizedPattern) validation('Alias pattern is required.');
  const [row] = await db
    .insert(schema.merchantAliases)
    .values({
      id: randomUUID(),
      userId,
      merchantId,
      rawPattern: input.rawPattern.trim(),
      normalizedPattern,
      matchType: input.matchType,
      enabled: input.enabled,
      priority: input.priority,
    })
    .returning();
  return row;
}

export async function updateMerchantAlias(
  db: RacioDatabase,
  userId: string,
  aliasId: string,
  input: MerchantAliasPatch,
) {
  const [current] = await db
    .select()
    .from(schema.merchantAliases)
    .where(and(eq(schema.merchantAliases.id, aliasId), eq(schema.merchantAliases.userId, userId)))
    .limit(1);
  if (!current) notFound('Merchant alias not found.');
  const rawPattern = input.rawPattern ?? current.rawPattern;
  const [row] = await db
    .update(schema.merchantAliases)
    .set({
      rawPattern: rawPattern.trim(),
      normalizedPattern: normalizeMerchantName(rawPattern),
      matchType: input.matchType ?? current.matchType,
      enabled: input.enabled ?? current.enabled,
      priority: input.priority ?? current.priority,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.merchantAliases.id, aliasId), eq(schema.merchantAliases.userId, userId)))
    .returning();
  return row;
}

export async function actionMerchantAlias(
  db: RacioDatabase,
  userId: string,
  aliasId: string,
  action: 'enable' | 'disable' | 'archive' | 'restore',
) {
  const [current] = await db
    .select()
    .from(schema.merchantAliases)
    .where(and(eq(schema.merchantAliases.id, aliasId), eq(schema.merchantAliases.userId, userId)))
    .limit(1);
  if (!current) notFound('Merchant alias not found.');
  const [row] = await db
    .update(schema.merchantAliases)
    .set({
      enabled:
        action === 'enable'
          ? true
          : action === 'disable' || action === 'archive'
            ? false
            : current.enabled,
      archivedAt:
        action === 'archive' ? new Date() : action === 'restore' ? null : current.archivedAt,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.merchantAliases.id, aliasId), eq(schema.merchantAliases.userId, userId)))
    .returning();
  return row;
}

export async function mergeMerchants(
  db: RacioDatabase,
  userId: string,
  sourceMerchantId: string,
  targetMerchantId: string,
) {
  if (sourceMerchantId === targetMerchantId) validation('Source and target merchants must differ.');
  const [source, target] = await Promise.all([
    ownedMerchant(db, userId, sourceMerchantId),
    ownedMerchant(db, userId, targetMerchantId),
  ]);
  if (source.status === 'merged' || target.status !== 'active')
    conflict('Only an active, unmerged merchant can be merged into an active target.');
  return db.transaction(async (tx) => {
    const transactions = await tx
      .select({
        id: schema.transactions.id,
        merchantId: schema.transactions.merchantId,
        merchantSource: schema.transactions.merchantSource,
      })
      .from(schema.transactions)
      .where(
        and(
          eq(schema.transactions.userId, userId),
          eq(schema.transactions.merchantId, sourceMerchantId),
        ),
      );
    const aliases = await tx
      .select({ id: schema.merchantAliases.id, merchantId: schema.merchantAliases.merchantId })
      .from(schema.merchantAliases)
      .where(
        and(
          eq(schema.merchantAliases.userId, userId),
          eq(schema.merchantAliases.merchantId, sourceMerchantId),
        ),
      );
    const targetAliases = await tx
      .select({
        matchType: schema.merchantAliases.matchType,
        normalizedPattern: schema.merchantAliases.normalizedPattern,
      })
      .from(schema.merchantAliases)
      .where(
        and(
          eq(schema.merchantAliases.userId, userId),
          eq(schema.merchantAliases.merchantId, targetMerchantId),
        ),
      );
    const targetAliasKeys = new Set(
      targetAliases.map((item) => `${item.matchType}:${item.normalizedPattern}`),
    );
    const sourceAliasRows = await tx
      .select({
        matchType: schema.merchantAliases.matchType,
        normalizedPattern: schema.merchantAliases.normalizedPattern,
      })
      .from(schema.merchantAliases)
      .where(
        and(
          eq(schema.merchantAliases.userId, userId),
          eq(schema.merchantAliases.merchantId, sourceMerchantId),
        ),
      );
    if (
      sourceAliasRows.some((item) =>
        targetAliasKeys.has(`${item.matchType}:${item.normalizedPattern}`),
      )
    )
      conflict('Merge would create duplicate merchant aliases. Resolve the alias first.');
    const now = new Date();
    await tx
      .update(schema.transactions)
      .set({
        merchantId: targetMerchantId,
        merchantSource: 'system',
        merchantUpdatedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.transactions.userId, userId),
          eq(schema.transactions.merchantId, sourceMerchantId),
        ),
      );
    await tx
      .update(schema.merchantAliases)
      .set({ merchantId: targetMerchantId, updatedAt: now })
      .where(
        and(
          eq(schema.merchantAliases.userId, userId),
          eq(schema.merchantAliases.merchantId, sourceMerchantId),
        ),
      );
    await tx
      .update(schema.merchants)
      .set({ status: 'merged', mergedIntoMerchantId: targetMerchantId, updatedAt: now })
      .where(and(eq(schema.merchants.id, sourceMerchantId), eq(schema.merchants.userId, userId)));
    const [event] = await tx
      .insert(schema.merchantMergeEvents)
      .values({
        id: randomUUID(),
        userId,
        sourceMerchantId,
        targetMerchantId,
        transactionAssignments: transactions.map((item) => ({
          transactionId: item.id,
          previousMerchantId: item.merchantId,
          previousMerchantSource: item.merchantSource,
        })),
        aliasAssignments: aliases,
        sourceStatusBefore: source.status,
        createdAt: now,
      })
      .returning();
    return { event, movedTransactions: transactions.length, movedAliases: aliases.length };
  });
}

export async function unmergeMerchants(
  db: RacioDatabase,
  userId: string,
  sourceMerchantId: string,
) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(schema.merchants)
      .where(and(eq(schema.merchants.id, sourceMerchantId), eq(schema.merchants.userId, userId)))
      .limit(1);
    if (!source) notFound('Merchant not found.');
    if (source.status !== 'merged') conflict('Merchant is not currently merged.');
    const [event] = await tx
      .select()
      .from(schema.merchantMergeEvents)
      .where(
        and(
          eq(schema.merchantMergeEvents.userId, userId),
          eq(schema.merchantMergeEvents.sourceMerchantId, sourceMerchantId),
          isNull(schema.merchantMergeEvents.revertedAt),
        ),
      )
      .orderBy(desc(schema.merchantMergeEvents.createdAt))
      .limit(1);
    if (!event) conflict('Merge snapshot is not available.');
    let partial = false;
    for (const item of safeArray(event.transactionAssignments)) {
      if (!item || typeof item !== 'object') continue;
      const transactionId = (item as { transactionId?: unknown }).transactionId;
      const previousMerchantSource = (item as { previousMerchantSource?: unknown })
        .previousMerchantSource;
      if (typeof transactionId !== 'string') continue;
      const changed = await tx
        .update(schema.transactions)
        .set({
          merchantId: sourceMerchantId,
          merchantSource:
            previousMerchantSource === 'manual' ||
            previousMerchantSource === 'alias' ||
            previousMerchantSource === 'import' ||
            previousMerchantSource === 'system'
              ? previousMerchantSource
              : null,
          merchantUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.transactions.id, transactionId),
            eq(schema.transactions.userId, userId),
            eq(schema.transactions.merchantId, event.targetMerchantId),
          ),
        )
        .returning({ id: schema.transactions.id });
      if (!changed.length) partial = true;
    }
    for (const item of safeArray(event.aliasAssignments)) {
      const aliasId = item && typeof item === 'object' ? (item as { id?: unknown }).id : null;
      if (typeof aliasId !== 'string') continue;
      const changed = await tx
        .update(schema.merchantAliases)
        .set({ merchantId: sourceMerchantId, updatedAt: new Date() })
        .where(
          and(
            eq(schema.merchantAliases.id, aliasId),
            eq(schema.merchantAliases.userId, userId),
            eq(schema.merchantAliases.merchantId, event.targetMerchantId),
          ),
        )
        .returning({ id: schema.merchantAliases.id });
      if (!changed.length) partial = true;
    }
    await tx
      .update(schema.merchants)
      .set({
        status: event.sourceStatusBefore,
        mergedIntoMerchantId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.merchants.id, sourceMerchantId), eq(schema.merchants.userId, userId)));
    await tx
      .update(schema.merchantMergeEvents)
      .set({ revertedAt: new Date(), partialUnmerge: partial })
      .where(eq(schema.merchantMergeEvents.id, event.id));
    return { eventId: event.id, partial };
  });
}

async function aliasAssignments(db: RacioDatabase, userId: string, transactionIds?: string[]) {
  const aliases = await db
    .select({
      id: schema.merchantAliases.id,
      merchantId: schema.merchantAliases.merchantId,
      normalizedPattern: schema.merchantAliases.normalizedPattern,
      matchType: schema.merchantAliases.matchType,
      priority: schema.merchantAliases.priority,
      createdAt: schema.merchantAliases.createdAt,
    })
    .from(schema.merchantAliases)
    .innerJoin(schema.merchants, eq(schema.merchantAliases.merchantId, schema.merchants.id))
    .where(
      and(
        eq(schema.merchantAliases.userId, userId),
        eq(schema.merchantAliases.enabled, true),
        isNull(schema.merchantAliases.archivedAt),
        eq(schema.merchants.status, 'active'),
      ),
    )
    .orderBy(asc(schema.merchantAliases.priority), asc(schema.merchantAliases.createdAt))
    .limit(MAX_ALIAS_APPLY);
  const txConditions = [
    eq(schema.transactions.userId, userId),
    ne(schema.transactions.status, 'archived'),
  ];
  if (transactionIds?.length) txConditions.push(inArray(schema.transactions.id, transactionIds));
  const transactions = await db
    .select({
      id: schema.transactions.id,
      importedDescription: schema.transactions.importedDescription,
      normalizedDescription: schema.transactions.normalizedDescription,
      rawDescription: schema.transactions.rawDescription,
      counterparty: schema.transactions.counterparty,
      merchantId: schema.transactions.merchantId,
      merchantSource: schema.transactions.merchantSource,
    })
    .from(schema.transactions)
    .where(and(...txConditions))
    .orderBy(asc(schema.transactions.bookingDate), asc(schema.transactions.id))
    .limit(transactionIds?.length ? transactionIds.length : MAX_ALIAS_APPLY);
  const matches: { transactionId: string; merchantId: string; aliasId: string }[] = [];
  for (const transaction of transactions) {
    if (transaction.merchantSource === 'manual') continue;
    const match = aliases.find((alias) =>
      merchantAliasMatches(
        transaction.normalizedDescription ||
          transaction.importedDescription ||
          transaction.rawDescription,
        transaction.counterparty,
        alias.normalizedPattern,
        alias.matchType,
      ),
    );
    if (match && transaction.merchantId !== match.merchantId)
      matches.push({
        transactionId: transaction.id,
        merchantId: match.merchantId,
        aliasId: match.id,
      });
  }
  return {
    matches,
    scanned: transactions.length,
    truncated: transactions.length >= MAX_ALIAS_APPLY,
  };
}

export async function applyMerchantAliasesToTransactions(
  db: RacioDatabase,
  userId: string,
  transactionIds: string[],
) {
  if (!transactionIds.length) return { requested: 0, applied: 0 };
  const preview = await aliasAssignments(db, userId, transactionIds);
  let applied = 0;
  for (const match of preview.matches) {
    const result = await db
      .update(schema.transactions)
      .set({
        merchantId: match.merchantId,
        merchantSource: 'alias',
        merchantConfidence: '1.0000',
        merchantUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.transactions.id, match.transactionId),
          eq(schema.transactions.userId, userId),
          or(
            isNull(schema.transactions.merchantSource),
            ne(schema.transactions.merchantSource, 'manual'),
          ),
        ),
      )
      .returning({ id: schema.transactions.id });
    applied += result.length;
  }
  return { requested: preview.matches.length, applied };
}

export async function previewMerchantAliases(db: RacioDatabase, userId: string) {
  const result = await aliasAssignments(db, userId);
  const matches = result.matches.slice(0, MAX_ALIAS_PREVIEW);
  return { ...result, matches, previewHash: await hashAliasPreview(matches) };
}

async function hashAliasPreview(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export async function applyHistoricalMerchantAliases(
  db: RacioDatabase,
  userId: string,
  input: HistoricalAliasApply,
) {
  const preview = await previewMerchantAliases(db, userId);
  if (preview.previewHash !== input.previewHash)
    conflict('The alias preview is stale. Preview it again.');
  if (preview.truncated || preview.matches.length > MAX_ALIAS_APPLY)
    conflict('Historical alias application is limited to 5,000 transactions.');
  let applied = 0;
  await db.transaction(async (tx) => {
    for (const match of preview.matches) {
      const result = await tx
        .update(schema.transactions)
        .set({
          merchantId: match.merchantId,
          merchantSource: 'alias',
          merchantConfidence: '1.0000',
          merchantUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.transactions.id, match.transactionId),
            eq(schema.transactions.userId, userId),
            or(
              isNull(schema.transactions.merchantSource),
              ne(schema.transactions.merchantSource, 'manual'),
            ),
          ),
        )
        .returning({ id: schema.transactions.id });
      applied += result.length;
    }
  });
  return { requested: preview.matches.length, applied };
}

async function transferCandidates(db: RacioDatabase, userId: string, ids?: string[]) {
  const conditions = [
    eq(schema.transactions.userId, userId),
    eq(schema.transactions.status, 'confirmed'),
  ];
  if (ids?.length) conditions.push(inArray(schema.transactions.id, ids));
  const rows = await db
    .select({
      id: schema.transactions.id,
      amount: schema.transactions.amount,
      currencyCode: schema.transactions.currencyCode,
      direction: schema.transactions.direction,
      bookingDate: schema.transactions.bookingDate,
      financialAccountId: schema.transactions.financialAccountId,
      accountName: schema.financialAccounts.displayName,
      bankTransactionId: schema.transactions.bankTransactionId,
      description: schema.transactions.importedDescription,
      rawDescription: schema.transactions.rawDescription,
      status: schema.transactions.status,
    })
    .from(schema.transactions)
    .innerJoin(
      schema.financialAccounts,
      eq(schema.transactions.financialAccountId, schema.financialAccounts.id),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.transactions.bookingDate), asc(schema.transactions.id))
    .limit(ids?.length ? ids.length : MAX_TRANSFER_SCAN);
  const splitRows = rows.length
    ? await db
        .select({ transactionId: schema.transactionSplits.transactionId })
        .from(schema.transactionSplits)
        .where(
          and(
            eq(schema.transactionSplits.userId, userId),
            isNull(schema.transactionSplits.archivedAt),
            inArray(
              schema.transactionSplits.transactionId,
              rows.map((row) => row.id),
            ),
          ),
        )
    : [];
  const splitIds = new Set(splitRows.map((row) => row.transactionId));
  return rows.map((row): TransferCandidate & { id: string } => ({
    id: row.id,
    amount: row.amount,
    currencyCode: row.currencyCode,
    direction: row.direction,
    bookingDate: row.bookingDate,
    financialAccountId: row.financialAccountId,
    accountName: row.accountName,
    bankTransactionId: row.bankTransactionId,
    description: row.description || row.rawDescription,
    hasActiveSplits: splitIds.has(row.id),
    archived: row.status === 'archived',
  }));
}

async function existingTransferPairs(db: RacioDatabase, userId: string, ids: string[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db
    .select({
      outgoing: schema.internalTransferLinks.outgoingTransactionId,
      incoming: schema.internalTransferLinks.incomingTransactionId,
    })
    .from(schema.internalTransferLinks)
    .where(
      and(
        eq(schema.internalTransferLinks.userId, userId),
        or(
          inArray(schema.internalTransferLinks.outgoingTransactionId, ids),
          inArray(schema.internalTransferLinks.incomingTransactionId, ids),
        ),
      ),
    );
  return new Set(rows.map((row) => `${row.outgoing}:${row.incoming}`));
}

export async function suggestInternalTransfers(
  db: RacioDatabase,
  userId: string,
  transactionIds?: string[],
) {
  const candidates = await transferCandidates(db, userId, transactionIds);
  const pairs = await existingTransferPairs(
    db,
    userId,
    candidates.map((item) => item.id),
  );
  const suggestions: {
    outgoingTransactionId: string;
    incomingTransactionId: string;
    score: number;
    reasons: string[];
  }[] = [];
  for (const outgoing of candidates) {
    if (outgoing.direction !== 'debit') continue;
    for (const incoming of candidates) {
      if (incoming.direction !== 'credit') continue;
      const key = `${outgoing.id}:${incoming.id}`;
      if (pairs.has(key)) continue;
      const evaluation = evaluateTransferPair(outgoing, incoming);
      if (evaluation.eligible && evaluation.score !== null)
        suggestions.push({
          outgoingTransactionId: outgoing.id,
          incomingTransactionId: incoming.id,
          score: evaluation.score,
          reasons: evaluation.reasons,
        });
    }
  }
  const limited = suggestions.slice(0, MAX_TRANSFER_SCAN);
  for (const suggestion of limited) {
    await db
      .insert(schema.internalTransferLinks)
      .values({
        id: randomUUID(),
        userId,
        outgoingTransactionId: suggestion.outgoingTransactionId,
        incomingTransactionId: suggestion.incomingTransactionId,
        matchScore: suggestion.score,
        matchReasons: suggestion.reasons,
        source: 'system',
        status: 'suggested',
      })
      .onConflictDoNothing();
  }
  return { scanned: candidates.length, suggested: limited.length };
}

async function getTransferPair(
  db: RacioDatabase,
  userId: string,
  outgoingId: string,
  incomingId: string,
) {
  const candidates = await transferCandidates(db, userId, [outgoingId, incomingId]);
  const outgoing = candidates.find((item) => item.id === outgoingId);
  const incoming = candidates.find((item) => item.id === incomingId);
  if (!outgoing || !incoming) notFound('Transfer transaction not found.');
  const evaluation = evaluateTransferPair(outgoing, incoming);
  if (!evaluation.eligible || evaluation.score === null)
    validation(`Transactions cannot be linked: ${evaluation.reasons.join(', ')}.`);
  return { outgoing, incoming, evaluation };
}

export async function createManualTransferLink(
  db: RacioDatabase,
  userId: string,
  input: ManualTransferLink,
) {
  const pair = await getTransferPair(
    db,
    userId,
    input.outgoingTransactionId,
    input.incomingTransactionId,
  );
  const [row] = await db
    .insert(schema.internalTransferLinks)
    .values({
      id: randomUUID(),
      userId,
      outgoingTransactionId: input.outgoingTransactionId,
      incomingTransactionId: input.incomingTransactionId,
      status: 'confirmed',
      matchScore: pair.evaluation.score,
      matchReasons: [...pair.evaluation.reasons, 'manual_confirmation'],
      source: 'manual',
      confirmedAt: new Date(),
    })
    .returning();
  return row;
}

export async function listInternalTransfers(
  db: RacioDatabase,
  userId: string,
  input: TransferListQuery,
) {
  const outgoing = alias(schema.transactions, 'outgoing_transactions');
  const incoming = alias(schema.transactions, 'incoming_transactions');
  const conditions = [eq(schema.internalTransferLinks.userId, userId)];
  if (input.status) conditions.push(eq(schema.internalTransferLinks.status, input.status));
  if (input.accountId)
    conditions.push(
      or(
        eq(outgoing.financialAccountId, input.accountId),
        eq(incoming.financialAccountId, input.accountId),
      )!,
    );
  if (input.dateFrom)
    conditions.push(
      or(gte(outgoing.bookingDate, input.dateFrom), gte(incoming.bookingDate, input.dateFrom))!,
    );
  if (input.dateTo)
    conditions.push(
      or(lte(outgoing.bookingDate, input.dateTo), lte(incoming.bookingDate, input.dateTo))!,
    );
  if (input.currency)
    conditions.push(
      or(eq(outgoing.currencyCode, input.currency), eq(incoming.currencyCode, input.currency))!,
    );
  const rows = await db
    .select({
      id: schema.internalTransferLinks.id,
      status: schema.internalTransferLinks.status,
      matchScore: schema.internalTransferLinks.matchScore,
      matchReasons: schema.internalTransferLinks.matchReasons,
      source: schema.internalTransferLinks.source,
      createdAt: schema.internalTransferLinks.createdAt,
      outgoingTransactionId: schema.internalTransferLinks.outgoingTransactionId,
      incomingTransactionId: schema.internalTransferLinks.incomingTransactionId,
      outgoingDate: outgoing.bookingDate,
      incomingDate: incoming.bookingDate,
      outgoingAmount: outgoing.amount,
      incomingAmount: incoming.amount,
    })
    .from(schema.internalTransferLinks)
    .innerJoin(
      outgoing,
      and(
        eq(outgoing.id, schema.internalTransferLinks.outgoingTransactionId),
        eq(outgoing.userId, userId),
      ),
    )
    .innerJoin(
      incoming,
      and(
        eq(incoming.id, schema.internalTransferLinks.incomingTransactionId),
        eq(incoming.userId, userId),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(schema.internalTransferLinks.createdAt))
    .limit(input.limit)
    .offset(input.offset);
  return rows;
}

export async function actionInternalTransfer(
  db: RacioDatabase,
  userId: string,
  linkId: string,
  action: 'confirm' | 'reject' | 'unlink',
) {
  const [link] = await db
    .select()
    .from(schema.internalTransferLinks)
    .where(
      and(
        eq(schema.internalTransferLinks.id, linkId),
        eq(schema.internalTransferLinks.userId, userId),
      ),
    )
    .limit(1);
  if (!link) notFound('Transfer link not found.');
  if (action === 'confirm') {
    await getTransferPair(db, userId, link.outgoingTransactionId, link.incomingTransactionId);
    const [row] = await db
      .update(schema.internalTransferLinks)
      .set({
        status: 'confirmed',
        confirmedAt: new Date(),
        rejectedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.internalTransferLinks.id, linkId),
          eq(schema.internalTransferLinks.userId, userId),
        ),
      )
      .returning();
    return row;
  }
  const [row] = await db
    .update(schema.internalTransferLinks)
    .set({
      status: action === 'reject' ? 'rejected' : 'unlinked',
      rejectedAt: action === 'reject' ? new Date() : link.rejectedAt,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.internalTransferLinks.id, linkId),
        eq(schema.internalTransferLinks.userId, userId),
      ),
    )
    .returning();
  return row;
}
