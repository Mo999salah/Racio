import { createHash, randomUUID } from 'node:crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type {
  CategoryCreate,
  CategoryPatch,
  ClassificationRuleCreate,
  ClassificationRulePatch,
  SavedViewCreate,
  SavedViewPatch,
  TagCreate,
  TagPatch,
  TransactionListQuery,
} from '@racio/contracts';
import {
  ruleConditionsSchema,
  ruleActionsSchema,
  savedViewFiltersSchema,
  savedViewSortSchema,
} from '@racio/contracts';
import {
  mergeRuleActions,
  matchClassificationRule,
  validateRuleDocument,
  type ClassifiableTransaction,
  type RuleDocument,
} from '@racio/domain';
import { schema, type RacioDatabase } from '@racio/database';
import { AuthBoundaryError } from '@racio/auth';

type QueryDb = Pick<RacioDatabase, 'select' | 'insert' | 'update' | 'delete'>;

const MAX_RULE_PREVIEW = 1_000;
const MAX_HISTORICAL_RUN = 500;

const DEFAULT_CATEGORIES = [
  ['housing', 'expense', { en: 'Housing', ar: 'السكن', tr: 'Konut' }],
  ['groceries', 'expense', { en: 'Groceries', ar: 'البقالة', tr: 'Market' }],
  ['dining', 'expense', { en: 'Dining', ar: 'المطاعم', tr: 'Yemek' }],
  ['transport', 'expense', { en: 'Transport', ar: 'النقل', tr: 'Ulaşım' }],
  ['shopping', 'expense', { en: 'Shopping', ar: 'التسوق', tr: 'Alışveriş' }],
  [
    'bills_utilities',
    'expense',
    { en: 'Bills and utilities', ar: 'الفواتير والمرافق', tr: 'Faturalar ve faturalar' },
  ],
  ['health', 'expense', { en: 'Health', ar: 'الصحة', tr: 'Sağlık' }],
  ['education', 'expense', { en: 'Education', ar: 'التعليم', tr: 'Eğitim' }],
  ['entertainment', 'expense', { en: 'Entertainment', ar: 'الترفيه', tr: 'Eğlence' }],
  ['travel', 'expense', { en: 'Travel', ar: 'السفر', tr: 'Seyahat' }],
  ['fees', 'expense', { en: 'Fees', ar: 'الرسوم', tr: 'Ücretler' }],
  ['cash_withdrawal', 'expense', { en: 'Cash withdrawal', ar: 'السحب النقدي', tr: 'Nakit çekim' }],
  ['other_expense', 'expense', { en: 'Other expense', ar: 'مصروفات أخرى', tr: 'Diğer gider' }],
  ['salary', 'income', { en: 'Salary', ar: 'الراتب', tr: 'Maaş' }],
  ['business_income', 'income', { en: 'Business income', ar: 'دخل الأعمال', tr: 'İş geliri' }],
  ['refund', 'income', { en: 'Refund', ar: 'استرداد', tr: 'İade' }],
  ['interest', 'income', { en: 'Interest', ar: 'الفائدة', tr: 'Faiz' }],
  ['other_income', 'income', { en: 'Other income', ar: 'دخل آخر', tr: 'Diğer gelir' }],
] as const;

function normalizeLabel(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function conflict(message: string): never {
  throw new AuthBoundaryError('CONFLICT', message);
}

function validation(message: string): never {
  throw new AuthBoundaryError('VALIDATION', message);
}

function safeJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function assertOwnedFilterReferences(
  db: RacioDatabase,
  userId: string,
  input: TransactionListQuery,
) {
  if (input.accountId) {
    const [row] = await db
      .select({ id: schema.financialAccounts.id })
      .from(schema.financialAccounts)
      .where(
        and(
          eq(schema.financialAccounts.id, input.accountId),
          eq(schema.financialAccounts.userId, userId),
        ),
      )
      .limit(1);
    if (!row) notFound('Financial account not found.');
  }
  if (input.institutionId) {
    const [row] = await db
      .select({ id: schema.institutions.id })
      .from(schema.institutions)
      .where(
        and(
          eq(schema.institutions.id, input.institutionId),
          eq(schema.institutions.userId, userId),
        ),
      )
      .limit(1);
    if (!row) notFound('Institution not found.');
  }
  for (const [id, table, message] of [
    [input.primaryCategoryId, schema.categories, 'Category not found.'],
    [input.secondaryCategoryId, schema.categories, 'Category not found.'],
    [input.tagId, schema.tags, 'Tag not found.'],
  ] as const) {
    if (!id) continue;
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, id), eq(table.userId, userId)))
      .limit(1);
    if (!row) notFound(message);
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`);
}

async function classificationRows(db: RacioDatabase, userId: string, transactionIds: string[]) {
  if (!transactionIds.length) return { categories: [], tags: [] };
  const [categories, tags] = await Promise.all([
    db
      .select({
        transactionId: schema.transactionCategoryAssignments.transactionId,
        categoryId: schema.transactionCategoryAssignments.categoryId,
        categoryName: schema.categories.name,
        role: schema.transactionCategoryAssignments.role,
        source: schema.transactionCategoryAssignments.source,
        ruleId: schema.transactionCategoryAssignments.ruleId,
      })
      .from(schema.transactionCategoryAssignments)
      .innerJoin(
        schema.categories,
        eq(schema.transactionCategoryAssignments.categoryId, schema.categories.id),
      )
      .where(
        and(
          eq(schema.transactionCategoryAssignments.userId, userId),
          inArray(schema.transactionCategoryAssignments.transactionId, transactionIds),
        ),
      ),
    db
      .select({
        transactionId: schema.transactionTags.transactionId,
        tagId: schema.transactionTags.tagId,
        tagName: schema.tags.name,
        source: schema.transactionTags.source,
        ruleId: schema.transactionTags.ruleId,
      })
      .from(schema.transactionTags)
      .innerJoin(schema.tags, eq(schema.transactionTags.tagId, schema.tags.id))
      .where(
        and(
          eq(schema.transactionTags.userId, userId),
          inArray(schema.transactionTags.transactionId, transactionIds),
        ),
      ),
  ]);
  return { categories, tags };
}

function attachClassification<T extends { id: string }>(
  rows: T[],
  related: Awaited<ReturnType<typeof classificationRows>>,
) {
  return rows.map((row) => {
    const categories = related.categories.filter((item) => item.transactionId === row.id);
    const tags = related.tags.filter((item) => item.transactionId === row.id);
    const primary = categories.find((item) => item.role === 'primary') ?? null;
    return {
      ...row,
      primaryCategory: primary
        ? {
            id: primary.categoryId,
            name: primary.categoryName,
            source: primary.source,
            ruleId: primary.ruleId,
          }
        : null,
      secondaryCategories: categories
        .filter((item) => item.role === 'secondary')
        .map((item) => ({
          id: item.categoryId,
          name: item.categoryName,
          source: item.source,
          ruleId: item.ruleId,
        })),
      tags: tags.map((item) => ({
        id: item.tagId,
        name: item.tagName,
        source: item.source,
        ruleId: item.ruleId,
      })),
    };
  });
}

export async function listTransactions(
  db: RacioDatabase,
  userId: string,
  input: TransactionListQuery,
) {
  await assertOwnedFilterReferences(db, userId, input);
  const conditions: SQL[] = [eq(schema.transactions.userId, userId)];
  if (input.includeArchived !== 'true')
    conditions.push(eq(schema.transactions.status, 'confirmed'));
  if (input.dateFrom) conditions.push(gte(schema.transactions.bookingDate, input.dateFrom));
  if (input.dateTo) conditions.push(lte(schema.transactions.bookingDate, input.dateTo));
  if (input.accountId) conditions.push(eq(schema.transactions.financialAccountId, input.accountId));
  if (input.institutionId)
    conditions.push(eq(schema.financialAccounts.institutionId, input.institutionId));
  if (input.direction) conditions.push(eq(schema.transactions.direction, input.direction));
  if (input.currency) conditions.push(eq(schema.transactions.currencyCode, input.currency));
  if (input.statementId) conditions.push(eq(schema.transactions.statementId, input.statementId));
  if (input.reviewed) conditions.push(eq(schema.transactions.reviewed, input.reviewed === 'true'));
  if (input.amountExact) conditions.push(eq(schema.transactions.amount, input.amountExact));
  if (input.amountMin) conditions.push(gte(schema.transactions.amount, input.amountMin));
  if (input.amountMax) conditions.push(lte(schema.transactions.amount, input.amountMax));
  if (input.primaryCategoryId || input.categorised) {
    const categoryConditions = [
      eq(schema.transactionCategoryAssignments.userId, userId),
      eq(schema.transactionCategoryAssignments.transactionId, schema.transactions.id),
      eq(schema.transactionCategoryAssignments.role, 'primary'),
    ];
    if (input.primaryCategoryId)
      categoryConditions.push(
        eq(schema.transactionCategoryAssignments.categoryId, input.primaryCategoryId),
      );
    if (input.categorised === 'false')
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM transaction_category_assignments tca WHERE tca.user_id = ${userId} AND tca.transaction_id = ${schema.transactions.id} AND tca.role = 'primary')`,
      );
    else
      conditions.push(
        exists(
          db
            .select({ id: schema.transactionCategoryAssignments.id })
            .from(schema.transactionCategoryAssignments)
            .where(and(...categoryConditions)),
        ),
      );
  } else if (input.categorised === 'false') {
    conditions.push(
      sql`NOT EXISTS (SELECT 1 FROM transaction_category_assignments tca WHERE tca.user_id = ${userId} AND tca.transaction_id = ${schema.transactions.id} AND tca.role = 'primary')`,
    );
  }
  if (input.secondaryCategoryId) {
    conditions.push(
      exists(
        db
          .select({ id: schema.transactionCategoryAssignments.id })
          .from(schema.transactionCategoryAssignments)
          .where(
            and(
              eq(schema.transactionCategoryAssignments.userId, userId),
              eq(schema.transactionCategoryAssignments.transactionId, schema.transactions.id),
              eq(schema.transactionCategoryAssignments.categoryId, input.secondaryCategoryId),
              eq(schema.transactionCategoryAssignments.role, 'secondary'),
            ),
          ),
      ),
    );
  }
  if (input.tagId) {
    conditions.push(
      exists(
        db
          .select({ id: schema.transactionTags.id })
          .from(schema.transactionTags)
          .where(
            and(
              eq(schema.transactionTags.userId, userId),
              eq(schema.transactionTags.transactionId, schema.transactions.id),
              eq(schema.transactionTags.tagId, input.tagId),
            ),
          ),
      ),
    );
  }
  if (input.search) {
    const pattern = `%${escapeLike(input.search)}%`;
    const categorySearch = db
      .select({ id: schema.transactionCategoryAssignments.id })
      .from(schema.transactionCategoryAssignments)
      .innerJoin(
        schema.categories,
        eq(schema.transactionCategoryAssignments.categoryId, schema.categories.id),
      )
      .where(
        and(
          eq(schema.transactionCategoryAssignments.userId, userId),
          eq(schema.transactionCategoryAssignments.transactionId, schema.transactions.id),
          ilike(schema.categories.name, pattern),
        ),
      );
    const tagSearch = db
      .select({ id: schema.transactionTags.id })
      .from(schema.transactionTags)
      .innerJoin(schema.tags, eq(schema.transactionTags.tagId, schema.tags.id))
      .where(
        and(
          eq(schema.transactionTags.userId, userId),
          eq(schema.transactionTags.transactionId, schema.transactions.id),
          ilike(schema.tags.name, pattern),
        ),
      );
    conditions.push(
      or(
        ilike(schema.transactions.rawDescription, pattern),
        ilike(schema.transactions.importedDescription, pattern),
        ilike(schema.transactions.userDescription, pattern),
        ilike(schema.transactions.counterparty, pattern),
        ilike(schema.transactions.userCounterparty, pattern),
        ilike(schema.transactions.userNote, pattern),
        ilike(schema.transactions.bankTransactionId, pattern),
        exists(categorySearch),
        exists(tagSearch),
      )!,
    );
  }
  const where = and(...conditions);
  const [countRows, rows] = await Promise.all([
    db
      .select({ total: count() })
      .from(schema.transactions)
      .innerJoin(
        schema.financialAccounts,
        eq(schema.transactions.financialAccountId, schema.financialAccounts.id),
      )
      .where(where),
    db
      .select({
        id: schema.transactions.id,
        bookingDate: schema.transactions.bookingDate,
        valueDate: schema.transactions.valueDate,
        amount: schema.transactions.amount,
        currencyCode: schema.transactions.currencyCode,
        direction: schema.transactions.direction,
        balanceAfter: schema.transactions.balanceAfter,
        rawDescription: schema.transactions.rawDescription,
        importedDescription: schema.transactions.importedDescription,
        normalizedDescription: schema.transactions.normalizedDescription,
        userDescription: schema.transactions.userDescription,
        counterparty: schema.transactions.counterparty,
        userCounterparty: schema.transactions.userCounterparty,
        userNote: schema.transactions.userNote,
        reviewed: schema.transactions.reviewed,
        reviewedAt: schema.transactions.reviewedAt,
        sourceType: schema.transactions.sourceType,
        status: schema.transactions.status,
        financialAccountId: schema.transactions.financialAccountId,
        accountName: schema.financialAccounts.displayName,
        institutionId: schema.financialAccounts.institutionId,
        institutionName: schema.institutions.name,
        merchantId: schema.transactions.merchantId,
        merchantName: schema.merchants.displayName,
        statementId: schema.transactions.statementId,
        sourceRawTransactionId: schema.transactions.sourceRawTransactionId,
        duplicateFingerprint: schema.transactions.duplicateFingerprint,
        updatedAt: schema.transactions.updatedAt,
      })
      .from(schema.transactions)
      .innerJoin(
        schema.financialAccounts,
        eq(schema.transactions.financialAccountId, schema.financialAccounts.id),
      )
      .innerJoin(
        schema.institutions,
        eq(schema.financialAccounts.institutionId, schema.institutions.id),
      )
      .leftJoin(schema.merchants, eq(schema.transactions.merchantId, schema.merchants.id))
      .where(where)
      .orderBy(
        input.sort === 'bookingDateAsc'
          ? asc(schema.transactions.bookingDate)
          : input.sort === 'amountAsc'
            ? asc(schema.transactions.amount)
            : input.sort === 'amountDesc'
              ? desc(schema.transactions.amount)
              : input.sort === 'descriptionAsc'
                ? asc(schema.transactions.importedDescription)
                : input.sort === 'descriptionDesc'
                  ? desc(schema.transactions.importedDescription)
                  : desc(schema.transactions.bookingDate),
        input.sort === 'bookingDateAsc'
          ? asc(schema.transactions.id)
          : input.sort === 'amountAsc'
            ? asc(schema.transactions.id)
            : input.sort === 'amountDesc'
              ? desc(schema.transactions.id)
              : input.sort === 'descriptionAsc'
                ? asc(schema.transactions.id)
                : input.sort === 'descriptionDesc'
                  ? desc(schema.transactions.id)
                  : desc(schema.transactions.id),
      )
      .limit(input.limit)
      .offset(input.offset),
  ]);
  const related = await classificationRows(
    db,
    userId,
    rows.map((row) => row.id),
  );
  const total = Number(countRows[0]?.total ?? 0);
  return {
    items: attachClassification(rows, related),
    page: {
      limit: input.limit,
      offset: input.offset,
      total,
      hasMore: input.offset + rows.length < total,
    },
  };
}

export async function getTransaction(db: RacioDatabase, userId: string, transactionId: string) {
  const [row] = await db
    .select({
      id: schema.transactions.id,
      bookingDate: schema.transactions.bookingDate,
      valueDate: schema.transactions.valueDate,
      amount: schema.transactions.amount,
      currencyCode: schema.transactions.currencyCode,
      direction: schema.transactions.direction,
      balanceAfter: schema.transactions.balanceAfter,
      rawDescription: schema.transactions.rawDescription,
      importedDescription: schema.transactions.importedDescription,
      normalizedDescription: schema.transactions.normalizedDescription,
      userDescription: schema.transactions.userDescription,
      counterparty: schema.transactions.counterparty,
      userCounterparty: schema.transactions.userCounterparty,
      userNote: schema.transactions.userNote,
      reviewed: schema.transactions.reviewed,
      reviewedAt: schema.transactions.reviewedAt,
      sourceType: schema.transactions.sourceType,
      status: schema.transactions.status,
      financialAccountId: schema.transactions.financialAccountId,
      accountName: schema.financialAccounts.displayName,
      institutionId: schema.financialAccounts.institutionId,
      institutionName: schema.institutions.name,
      merchantId: schema.transactions.merchantId,
      merchantName: schema.merchants.displayName,
      statementId: schema.transactions.statementId,
      sourceRawTransactionId: schema.transactions.sourceRawTransactionId,
      duplicateFingerprint: schema.transactions.duplicateFingerprint,
      updatedAt: schema.transactions.updatedAt,
    })
    .from(schema.transactions)
    .innerJoin(
      schema.financialAccounts,
      eq(schema.transactions.financialAccountId, schema.financialAccounts.id),
    )
    .innerJoin(
      schema.institutions,
      eq(schema.financialAccounts.institutionId, schema.institutions.id),
    )
    .leftJoin(schema.merchants, eq(schema.transactions.merchantId, schema.merchants.id))
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)))
    .limit(1);
  if (!row) notFound('Transaction not found.');
  const related = await classificationRows(db, userId, [row.id]);
  const [eventRows] = await Promise.all([
    db
      .select({
        id: schema.classificationEvents.id,
        ruleId: schema.classificationEvents.ruleId,
        reason: schema.classificationEvents.reason,
        matchedConditions: schema.classificationEvents.matchedConditions,
        appliedAt: schema.classificationEvents.appliedAt,
        revertedAt: schema.classificationEvents.revertedAt,
      })
      .from(schema.classificationEvents)
      .where(
        and(
          eq(schema.classificationEvents.userId, userId),
          eq(schema.classificationEvents.transactionId, row.id),
        ),
      )
      .orderBy(desc(schema.classificationEvents.appliedAt)),
  ]);
  return { ...attachClassification([row], related)[0], classificationEvents: eventRows };
}

async function ownedTransaction(db: QueryDb, userId: string, transactionId: string) {
  const [row] = await db
    .select({
      id: schema.transactions.id,
      ruleSuppressionIds: schema.transactions.ruleSuppressionIds,
    })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)))
    .limit(1);
  if (!row) notFound('Transaction not found.');
  return row;
}

export async function updateTransactionMetadata(
  db: RacioDatabase,
  userId: string,
  transactionId: string,
  input: {
    userDescription?: string | null;
    userCounterparty?: string | null;
    userNote?: string | null;
    reviewed?: boolean;
  },
) {
  await ownedTransaction(db, userId, transactionId);
  const now = new Date();
  const [row] = await db
    .update(schema.transactions)
    .set({
      ...(input.userDescription === undefined ? {} : { userDescription: input.userDescription }),
      ...(input.userCounterparty === undefined ? {} : { userCounterparty: input.userCounterparty }),
      ...(input.userNote === undefined ? {} : { userNote: input.userNote }),
      ...(input.reviewed === undefined
        ? {}
        : {
            reviewed: input.reviewed,
            reviewedAt: input.reviewed ? now : null,
            reviewedByUserId: input.reviewed ? userId : null,
          }),
      updatedAt: now,
    })
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)))
    .returning({ id: schema.transactions.id });
  if (!row) notFound('Transaction not found.');
  return getTransaction(db, userId, transactionId);
}

async function ownedActiveCategories(db: RacioDatabase, userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  const rows = await db
    .select({ id: schema.categories.id, status: schema.categories.status })
    .from(schema.categories)
    .where(and(eq(schema.categories.userId, userId), inArray(schema.categories.id, uniqueIds)));
  if (rows.length !== uniqueIds.length || rows.some((row) => row.status !== 'active'))
    conflict('One or more categories are unavailable.');
}

async function ownedActiveTags(db: RacioDatabase, userId: string, ids: string[]) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return;
  const rows = await db
    .select({ id: schema.tags.id, archivedAt: schema.tags.archivedAt })
    .from(schema.tags)
    .where(and(eq(schema.tags.userId, userId), inArray(schema.tags.id, uniqueIds)));
  if (rows.length !== uniqueIds.length || rows.some((row) => row.archivedAt !== null))
    conflict('One or more tags are unavailable.');
}

async function applyClassificationPatch(
  db: QueryDb,
  userId: string,
  transactionId: string,
  input: { primaryCategoryId?: string | null; secondaryCategoryIds?: string[]; tagIds?: string[] },
) {
  const current = await ownedTransaction(db, userId, transactionId);
  const currentPrimary = await db
    .select({
      categoryId: schema.transactionCategoryAssignments.categoryId,
      ruleId: schema.transactionCategoryAssignments.ruleId,
    })
    .from(schema.transactionCategoryAssignments)
    .where(
      and(
        eq(schema.transactionCategoryAssignments.userId, userId),
        eq(schema.transactionCategoryAssignments.transactionId, transactionId),
        eq(schema.transactionCategoryAssignments.role, 'primary'),
      ),
    )
    .limit(1);
  const suppressionIds = safeJsonArray(current.ruleSuppressionIds).filter(
    (value): value is string => typeof value === 'string',
  );
  const oldPrimary = currentPrimary[0];
  if (input.primaryCategoryId !== undefined) {
    if (
      oldPrimary?.ruleId &&
      oldPrimary.categoryId !== input.primaryCategoryId &&
      !suppressionIds.includes(oldPrimary.ruleId)
    )
      suppressionIds.push(oldPrimary.ruleId);
    await db
      .delete(schema.transactionCategoryAssignments)
      .where(
        and(
          eq(schema.transactionCategoryAssignments.userId, userId),
          eq(schema.transactionCategoryAssignments.transactionId, transactionId),
          eq(schema.transactionCategoryAssignments.role, 'primary'),
        ),
      );
    if (input.primaryCategoryId) {
      await db.insert(schema.transactionCategoryAssignments).values({
        id: randomUUID(),
        userId,
        transactionId,
        categoryId: input.primaryCategoryId,
        role: 'primary',
        source: 'manual',
        ruleId: null,
      });
    }
  }
  if (input.secondaryCategoryIds !== undefined) {
    await db
      .delete(schema.transactionCategoryAssignments)
      .where(
        and(
          eq(schema.transactionCategoryAssignments.userId, userId),
          eq(schema.transactionCategoryAssignments.transactionId, transactionId),
          eq(schema.transactionCategoryAssignments.role, 'secondary'),
        ),
      );
    for (const categoryId of [...new Set(input.secondaryCategoryIds)]) {
      await db.insert(schema.transactionCategoryAssignments).values({
        id: randomUUID(),
        userId,
        transactionId,
        categoryId,
        role: 'secondary',
        source: 'manual',
        ruleId: null,
      });
    }
  }
  if (input.tagIds !== undefined) {
    await db
      .delete(schema.transactionTags)
      .where(
        and(
          eq(schema.transactionTags.userId, userId),
          eq(schema.transactionTags.transactionId, transactionId),
        ),
      );
    for (const tagId of [...new Set(input.tagIds)]) {
      await db.insert(schema.transactionTags).values({
        id: randomUUID(),
        userId,
        transactionId,
        tagId,
        source: 'manual',
        ruleId: null,
      });
    }
  }
  await db
    .update(schema.transactions)
    .set({ ruleSuppressionIds: suppressionIds, updatedAt: new Date() })
    .where(and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)));
}

export async function updateTransactionClassification(
  db: RacioDatabase,
  userId: string,
  transactionId: string,
  input: { primaryCategoryId?: string | null; secondaryCategoryIds?: string[]; tagIds?: string[] },
) {
  await ownedTransaction(db, userId, transactionId);
  const categoryIds = [input.primaryCategoryId, ...(input.secondaryCategoryIds ?? [])].filter(
    (value): value is string => Boolean(value),
  );
  await ownedActiveCategories(db, userId, categoryIds);
  await ownedActiveTags(db, userId, input.tagIds ?? []);
  await db.transaction(async (tx) => applyClassificationPatch(tx, userId, transactionId, input));
  return getTransaction(db, userId, transactionId);
}

export async function bulkUpdateTransactions(
  db: RacioDatabase,
  userId: string,
  input: { transactionIds: string[]; action: string; categoryId?: string; tagId?: string },
) {
  const ids = [...new Set(input.transactionIds)];
  if (ids.length > 100) validation('Bulk selection is limited to 100 transactions.');
  const owned = await db
    .select({ id: schema.transactions.id })
    .from(schema.transactions)
    .where(and(eq(schema.transactions.userId, userId), inArray(schema.transactions.id, ids)));
  if (owned.length !== ids.length) notFound('One or more transactions were not found.');
  if (input.categoryId) await ownedActiveCategories(db, userId, [input.categoryId]);
  if (input.tagId) await ownedActiveTags(db, userId, [input.tagId]);
  let updated = 0;
  let skipped = 0;
  await db.transaction(async (tx) => {
    for (const id of ids) {
      const before = await getTransaction(tx as unknown as RacioDatabase, userId, id);
      if (input.action === 'set-primary-category')
        await applyClassificationPatch(tx, userId, id, { primaryCategoryId: input.categoryId });
      else if (input.action === 'add-secondary-category')
        await applyClassificationPatch(tx, userId, id, {
          secondaryCategoryIds: [
            ...(before.secondaryCategories ?? []).map((item) => item.id),
            input.categoryId!,
          ],
        });
      else if (input.action === 'remove-secondary-category')
        await applyClassificationPatch(tx, userId, id, {
          secondaryCategoryIds: (before.secondaryCategories ?? [])
            .filter((item) => item.id !== input.categoryId)
            .map((item) => item.id),
        });
      else if (input.action === 'add-tag')
        await applyClassificationPatch(tx, userId, id, {
          tagIds: [...(before.tags ?? []).map((item) => item.id), input.tagId!],
        });
      else if (input.action === 'remove-tag')
        await applyClassificationPatch(tx, userId, id, {
          tagIds: (before.tags ?? [])
            .filter((item) => item.id !== input.tagId)
            .map((item) => item.id),
        });
      else if (input.action === 'mark-reviewed' || input.action === 'mark-unreviewed') {
        await tx
          .update(schema.transactions)
          .set({
            reviewed: input.action === 'mark-reviewed',
            reviewedAt: input.action === 'mark-reviewed' ? new Date() : null,
            reviewedByUserId: input.action === 'mark-reviewed' ? userId : null,
            updatedAt: new Date(),
          })
          .where(and(eq(schema.transactions.id, id), eq(schema.transactions.userId, userId)));
      } else {
        skipped += 1;
        continue;
      }
      updated += 1;
    }
  });
  return { requested: input.transactionIds.length, updated, skipped, failed: 0 };
}

export async function listCategories(db: RacioDatabase, userId: string, includeArchived: boolean) {
  const rows = await db
    .select()
    .from(schema.categories)
    .where(
      and(
        eq(schema.categories.userId, userId),
        includeArchived ? sql`true` : eq(schema.categories.status, 'active'),
      ),
    )
    .orderBy(asc(schema.categories.name));
  const usage = await db
    .select({ categoryId: schema.transactionCategoryAssignments.categoryId, count: count() })
    .from(schema.transactionCategoryAssignments)
    .where(eq(schema.transactionCategoryAssignments.userId, userId))
    .groupBy(schema.transactionCategoryAssignments.categoryId);
  const usageMap = new Map(usage.map((row) => [row.categoryId, Number(row.count)]));
  return rows.map((row) => ({ ...row, usageCount: usageMap.get(row.id) ?? 0 }));
}

async function getCategory(db: QueryDb, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.categories)
    .where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)))
    .limit(1);
  if (!row) notFound('Category not found.');
  return row;
}

async function validateCategoryParent(
  db: QueryDb,
  userId: string,
  categoryId: string | null | undefined,
) {
  if (!categoryId) return;
  const parent = await getCategory(db, userId, categoryId);
  if (parent.parentId) conflict('Categories can have only one parent level.');
  if (parent.status === 'archived') conflict('Archived categories cannot be new parents.');
}

export async function seedDefaultCategories(db: RacioDatabase, userId: string, locale: string) {
  const names = DEFAULT_CATEGORIES.map(([templateKey, kind, labels]) => ({
    templateKey,
    kind,
    name: labels[locale as 'en' | 'ar' | 'tr'] ?? labels.en,
  }));
  await db.transaction(async (tx) => {
    for (const category of names) {
      await tx
        .insert(schema.categories)
        .values({
          id: randomUUID(),
          userId,
          name: category.name,
          normalizedName: normalizeLabel(category.name),
          templateKey: category.templateKey,
          parentId: null,
          kind: category.kind,
          iconKey: null,
          colourKey: null,
          status: 'active',
          archivedAt: null,
        })
        .onConflictDoNothing();
    }
  });
  return listCategories(db, userId, false);
}

export async function createCategory(db: RacioDatabase, userId: string, input: CategoryCreate) {
  await validateCategoryParent(db, userId, input.parentId);
  try {
    const [row] = await db
      .insert(schema.categories)
      .values({
        id: randomUUID(),
        userId,
        name: input.name.trim(),
        normalizedName: normalizeLabel(input.name),
        templateKey: null,
        parentId: input.parentId ?? null,
        kind: input.kind,
        iconKey: input.iconKey ?? null,
        colourKey: input.colourKey ?? null,
        status: 'active',
        archivedAt: null,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) conflict('A category with this name already exists here.');
    throw error;
  }
}

export async function updateCategory(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: CategoryPatch,
) {
  const current = await getCategory(db, userId, id);
  if (input.parentId !== undefined) {
    if (input.parentId === id) conflict('A category cannot be its own parent.');
    await validateCategoryParent(db, userId, input.parentId);
  }
  const values = {
    ...(input.name === undefined
      ? {}
      : { name: input.name.trim(), normalizedName: normalizeLabel(input.name) }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
    ...(input.iconKey === undefined ? {} : { iconKey: input.iconKey }),
    ...(input.colourKey === undefined ? {} : { colourKey: input.colourKey }),
    updatedAt: new Date(),
  };
  try {
    const [row] = await db
      .update(schema.categories)
      .set(values)
      .where(and(eq(schema.categories.id, current.id), eq(schema.categories.userId, userId)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) conflict('A category with this name already exists here.');
    throw error;
  }
}

async function disableRulesReferencingCategory(
  db: RacioDatabase,
  userId: string,
  categoryId: string,
) {
  const rules = await db
    .select({ id: schema.classificationRules.id, actions: schema.classificationRules.actions })
    .from(schema.classificationRules)
    .where(eq(schema.classificationRules.userId, userId));
  for (const rule of rules) {
    const actions = safeJsonArray((rule.actions as { items?: unknown[] } | null)?.items);
    if (
      actions.some(
        (action) =>
          typeof action === 'object' &&
          action !== null &&
          'categoryId' in action &&
          action.categoryId === categoryId,
      )
    ) {
      await db
        .update(schema.classificationRules)
        .set({ enabled: false, updatedAt: new Date() })
        .where(
          and(
            eq(schema.classificationRules.id, rule.id),
            eq(schema.classificationRules.userId, userId),
          ),
        );
    }
  }
}

export async function archiveCategory(db: RacioDatabase, userId: string, id: string) {
  await getCategory(db, userId, id);
  const [row] = await db
    .update(schema.categories)
    .set({ status: 'archived', archivedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)))
    .returning();
  await disableRulesReferencingCategory(db, userId, id);
  return row;
}

export async function restoreCategory(db: RacioDatabase, userId: string, id: string) {
  await getCategory(db, userId, id);
  return (
    await db
      .update(schema.categories)
      .set({ status: 'active', archivedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.categories.id, id), eq(schema.categories.userId, userId)))
      .returning()
  )[0];
}

export async function listTags(db: RacioDatabase, userId: string, includeArchived: boolean) {
  const rows = await db
    .select()
    .from(schema.tags)
    .where(
      and(
        eq(schema.tags.userId, userId),
        includeArchived ? sql`true` : sql`${schema.tags.archivedAt} IS NULL`,
      ),
    )
    .orderBy(asc(schema.tags.name));
  const usage = await db
    .select({ tagId: schema.transactionTags.tagId, count: count() })
    .from(schema.transactionTags)
    .where(eq(schema.transactionTags.userId, userId))
    .groupBy(schema.transactionTags.tagId);
  const usageMap = new Map(usage.map((row) => [row.tagId, Number(row.count)]));
  return rows.map((row) => ({ ...row, usageCount: usageMap.get(row.id) ?? 0 }));
}

async function getTag(db: QueryDb, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.tags)
    .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
    .limit(1);
  if (!row) notFound('Tag not found.');
  return row;
}

export async function createTag(db: RacioDatabase, userId: string, input: TagCreate) {
  try {
    const [row] = await db
      .insert(schema.tags)
      .values({
        id: randomUUID(),
        userId,
        name: input.name.trim(),
        normalizedName: normalizeLabel(input.name),
        archivedAt: null,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) conflict('A tag with this name already exists.');
    throw error;
  }
}

export async function updateTag(db: RacioDatabase, userId: string, id: string, input: TagPatch) {
  await getTag(db, userId, id);
  try {
    const [row] = await db
      .update(schema.tags)
      .set({
        ...(input.name === undefined
          ? {}
          : { name: input.name.trim(), normalizedName: normalizeLabel(input.name) }),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) conflict('A tag with this name already exists.');
    throw error;
  }
}

export async function archiveTag(db: RacioDatabase, userId: string, id: string) {
  await getTag(db, userId, id);
  return (
    await db
      .update(schema.tags)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
      .returning()
  )[0];
}

export async function restoreTag(db: RacioDatabase, userId: string, id: string) {
  await getTag(db, userId, id);
  return (
    await db
      .update(schema.tags)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(schema.tags.id, id), eq(schema.tags.userId, userId)))
      .returning()
  )[0];
}

function asRuleDocument(rule: {
  conditions: unknown;
  actions: unknown;
  matchMode: 'all' | 'any';
}): RuleDocument {
  const conditions = ruleConditionsSchema.parse(rule.conditions);
  const actions = ruleActionsSchema.parse(rule.actions);
  return { conditions, actions, matchMode: rule.matchMode } as RuleDocument;
}

async function validateRuleReferences(
  db: RacioDatabase,
  userId: string,
  input: ClassificationRuleCreate | ClassificationRulePatch,
) {
  if (!input.conditions && !input.actions) return;
  const conditions = input.conditions ?? { version: 1 as const, items: [] };
  const actions = input.actions ?? { version: 1 as const, items: [] };
  const document = { conditions, actions, matchMode: input.matchMode ?? 'all' } as RuleDocument;
  const errors = validateRuleDocument(document);
  if (errors.length) validation(errors.join(','));
  if (actions.items.filter((action) => action.type === 'primary_category').length > 1)
    validation('Only one primary category action is allowed.');
  const categoryIds = actions.items
    .filter((action) => 'categoryId' in action)
    .map((action) => action.categoryId);
  const tagIds = actions.items.filter((action) => 'tagId' in action).map((action) => action.tagId);
  await ownedActiveCategories(db, userId, categoryIds);
  await ownedActiveTags(db, userId, tagIds);
  for (const condition of conditions.items) {
    if (condition.field === 'account') {
      const [row] = await db
        .select({ id: schema.financialAccounts.id })
        .from(schema.financialAccounts)
        .where(
          and(
            eq(schema.financialAccounts.id, condition.value),
            eq(schema.financialAccounts.userId, userId),
          ),
        )
        .limit(1);
      if (!row) notFound('Rule account not found.');
    }
    if (condition.field === 'institution') {
      const [row] = await db
        .select({ id: schema.institutions.id })
        .from(schema.institutions)
        .where(
          and(eq(schema.institutions.id, condition.value), eq(schema.institutions.userId, userId)),
        )
        .limit(1);
      if (!row) notFound('Rule institution not found.');
    }
    if (condition.field === 'existing_tag') await ownedActiveTags(db, userId, [condition.value]);
    if (condition.field === 'currency' && !/^[A-Z]{3}$/u.test(condition.value))
      validation('Invalid rule currency.');
  }
}

export async function listRules(db: RacioDatabase, userId: string, includeArchived: boolean) {
  return db
    .select()
    .from(schema.classificationRules)
    .where(
      and(
        eq(schema.classificationRules.userId, userId),
        includeArchived ? sql`true` : sql`${schema.classificationRules.archivedAt} IS NULL`,
      ),
    )
    .orderBy(
      asc(schema.classificationRules.priority),
      asc(schema.classificationRules.createdAt),
      asc(schema.classificationRules.id),
    );
}

async function getRule(db: QueryDb, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.classificationRules)
    .where(
      and(eq(schema.classificationRules.id, id), eq(schema.classificationRules.userId, userId)),
    )
    .limit(1);
  if (!row) notFound('Classification rule not found.');
  return row;
}

export async function createRule(
  db: RacioDatabase,
  userId: string,
  input: ClassificationRuleCreate,
) {
  await validateRuleReferences(db, userId, input);
  const [row] = await db
    .insert(schema.classificationRules)
    .values({
      id: randomUUID(),
      userId,
      name: input.name.trim(),
      enabled: input.enabled,
      priority: input.priority,
      conditionsVersion: 1,
      conditions: input.conditions,
      actionsVersion: 1,
      actions: input.actions,
      matchMode: input.matchMode,
      applyScope: input.applyScope,
      archivedAt: null,
    })
    .returning();
  return row;
}

export async function updateRule(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: ClassificationRulePatch,
) {
  const current = await getRule(db, userId, id);
  await validateRuleReferences(db, userId, input);
  const [row] = await db
    .update(schema.classificationRules)
    .set({
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
      ...(input.priority === undefined ? {} : { priority: input.priority }),
      ...(input.conditions === undefined
        ? {}
        : { conditions: input.conditions, conditionsVersion: current.conditionsVersion + 1 }),
      ...(input.actions === undefined
        ? {}
        : { actions: input.actions, actionsVersion: current.actionsVersion + 1 }),
      ...(input.matchMode === undefined ? {} : { matchMode: input.matchMode }),
      ...(input.applyScope === undefined ? {} : { applyScope: input.applyScope }),
      updatedAt: new Date(),
    })
    .where(
      and(eq(schema.classificationRules.id, id), eq(schema.classificationRules.userId, userId)),
    )
    .returning();
  return row;
}

export async function ruleAction(
  db: RacioDatabase,
  userId: string,
  id: string,
  action: 'enable' | 'disable' | 'archive' | 'restore',
) {
  await getRule(db, userId, id);
  return (
    await db
      .update(schema.classificationRules)
      .set({
        ...(action === 'enable' ? { enabled: true, archivedAt: null } : {}),
        ...(action === 'disable' ? { enabled: false } : {}),
        ...(action === 'archive' ? { enabled: false, archivedAt: new Date() } : {}),
        ...(action === 'restore' ? { enabled: false, archivedAt: null } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.classificationRules.id, id), eq(schema.classificationRules.userId, userId)),
      )
      .returning()
  )[0];
}

type PreviewItem = {
  id: string;
  bookingDate: string;
  amount: string;
  currencyCode: string;
  description: string;
  primaryCategory: unknown;
  reviewed: boolean;
  accountName: string;
  institutionName: string;
};

type ClassifiableRow = {
  id: string;
  financialAccountId: string;
  institutionId: string;
  bookingDate: string;
  amount: string;
  currencyCode: string;
  direction: 'credit' | 'debit' | 'unknown';
  rawDescription: string;
  importedDescription: string;
  userDescription: string | null;
  counterparty: string | null;
  userCounterparty: string | null;
  userNote: string | null;
  primaryCategory: {
    id: string;
    source: 'manual' | 'rule' | 'import' | 'system';
    ruleId: string | null;
  } | null;
  tags: { id: string }[];
  sourceType: string;
  reviewed: boolean;
  accountName: string;
  institutionName: string;
};

function classifiable(row: ClassifiableRow): ClassifiableTransaction {
  return {
    id: row.id,
    financialAccountId: row.financialAccountId,
    institutionId: row.institutionId,
    bookingDate: row.bookingDate,
    amount: row.amount,
    currencyCode: row.currencyCode,
    direction: row.direction,
    rawDescription: row.rawDescription,
    importedDescription: row.importedDescription,
    userDescription: row.userDescription,
    counterparty: row.counterparty,
    userCounterparty: row.userCounterparty,
    userNote: row.userNote,
    primaryCategoryId: row.primaryCategory?.id ?? null,
    tagIds: row.tags.map((tag) => tag.id),
    sourceType: row.sourceType,
    reviewed: row.reviewed,
  };
}

async function previewRuleInternal(db: RacioDatabase, userId: string, ruleId: string) {
  const rule = await getRule(db, userId, ruleId);
  const input: TransactionListQuery = {
    limit: MAX_RULE_PREVIEW,
    offset: 0,
    includeArchived: 'false',
    sort: 'bookingDateDesc',
  };
  const ledger = await listTransactions(db, userId, input);
  const matches: PreviewItem[] = [];
  const skipped: PreviewItem[] = [];
  const conflicts: PreviewItem[] = [];
  const activeSplitIds = ledger.items.length
    ? new Set(
        (
          await db
            .select({ transactionId: schema.transactionSplits.transactionId })
            .from(schema.transactionSplits)
            .where(
              and(
                eq(schema.transactionSplits.userId, userId),
                isNull(schema.transactionSplits.archivedAt),
                inArray(
                  schema.transactionSplits.transactionId,
                  ledger.items.map((item) => item.id),
                ),
              ),
            )
        ).map((item) => item.transactionId),
      )
    : new Set<string>();
  const document = asRuleDocument(rule);
  for (const item of ledger.items) {
    const result = matchClassificationRule(classifiable(item as ClassifiableRow), document);
    if (!result.matches) continue;
    const preview: PreviewItem = {
      id: item.id,
      bookingDate: item.bookingDate,
      amount: item.amount,
      currencyCode: item.currencyCode,
      description: item.userDescription ?? item.importedDescription,
      primaryCategory: item.primaryCategory,
      reviewed: item.reviewed,
      accountName: item.accountName,
      institutionName: item.institutionName,
    };
    if (activeSplitIds.has(item.id)) {
      skipped.push(preview);
      continue;
    }
    matches.push(preview);
    const actions = mergeRuleActions(document.actions.items);
    if (actions.primaryCategoryId && item.primaryCategory?.source === 'manual')
      conflicts.push(preview);
    if (actions.primaryCategoryId && item.primaryCategory?.source === 'rule') skipped.push(preview);
  }
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        ruleId,
        updatedAt: rule.updatedAt.toISOString(),
        ids: matches.map((item) => item.id),
      }),
    )
    .digest('hex');
  const actions = mergeRuleActions(document.actions.items);
  const dates = matches.map((item) => item.bookingDate).sort();
  const accounts = [
    ...new Set(matches.map((item) => `${item.accountName} · ${item.institutionName}`)),
  ];
  return {
    rule,
    matches,
    conflicts,
    skipped,
    previewHash: hash,
    truncated: ledger.page.hasMore,
    dateRange: { from: dates[0] ?? null, to: dates.at(-1) ?? null },
    accounts,
    actions,
    manualProtectedCount: conflicts.length,
  };
}

export async function previewRule(db: RacioDatabase, userId: string, ruleId: string) {
  const preview = await previewRuleInternal(db, userId, ruleId);
  return {
    rule: { id: preview.rule.id, name: preview.rule.name, priority: preview.rule.priority },
    count: preview.matches.length,
    sample: preview.matches.slice(0, 20),
    conflicts: preview.conflicts.slice(0, 20),
    skipped: preview.skipped.slice(0, 20),
    dateRange: preview.dateRange,
    accounts: preview.accounts,
    actions: preview.actions,
    manualProtectedCount: preview.manualProtectedCount,
    historicalLimit: MAX_HISTORICAL_RUN,
    applyScope: preview.rule.applyScope,
    previewHash: preview.previewHash,
    truncated: preview.truncated,
  };
}

async function applyRuleToTransaction(
  db: RacioDatabase,
  userId: string,
  rule: Awaited<ReturnType<typeof getRule>>,
  transactionId: string,
  allowSuppressed: boolean,
) {
  return db.transaction(async (tx) => {
    const already = await tx
      .select({ id: schema.classificationEvents.id })
      .from(schema.classificationEvents)
      .where(
        and(
          eq(schema.classificationEvents.userId, userId),
          eq(schema.classificationEvents.ruleId, rule.id),
          eq(schema.classificationEvents.transactionId, transactionId),
        ),
      )
      .limit(1);
    if (already.length) return { applied: false, reason: 'already_applied' };
    const current = (await getTransaction(
      tx as unknown as RacioDatabase,
      userId,
      transactionId,
    )) as ClassifiableRow;
    const hasActiveSplits = await tx
      .select({ id: schema.transactionSplits.id })
      .from(schema.transactionSplits)
      .where(
        and(
          eq(schema.transactionSplits.userId, userId),
          eq(schema.transactionSplits.transactionId, transactionId),
          isNull(schema.transactionSplits.archivedAt),
        ),
      )
      .limit(1);
    if (hasActiveSplits.length) return { applied: false, reason: 'split_transaction' };
    const suppressed =
      !allowSuppressed &&
      safeJsonArray(
        (await ownedTransaction(tx, userId, transactionId)).ruleSuppressionIds,
      ).includes(rule.id);
    const match = matchClassificationRule(classifiable(current), asRuleDocument(rule));
    if (!match.matches) return { applied: false, reason: match.reason };
    const actions = mergeRuleActions(asRuleDocument(rule).actions.items);
    const previous = current.primaryCategory;
    let resultingPrimary = previous?.id ?? null;
    let primaryChanged = false;
    if (
      actions.primaryCategoryId &&
      !suppressed &&
      previous?.source !== 'manual' &&
      previous?.source !== 'rule'
    ) {
      await tx
        .delete(schema.transactionCategoryAssignments)
        .where(
          and(
            eq(schema.transactionCategoryAssignments.userId, userId),
            eq(schema.transactionCategoryAssignments.transactionId, transactionId),
            eq(schema.transactionCategoryAssignments.role, 'primary'),
          ),
        );
      await tx.insert(schema.transactionCategoryAssignments).values({
        id: randomUUID(),
        userId,
        transactionId,
        categoryId: actions.primaryCategoryId,
        role: 'primary',
        source: 'rule',
        ruleId: rule.id,
      });
      resultingPrimary = actions.primaryCategoryId;
      primaryChanged = true;
    }
    const secondaryAdded: string[] = [];
    for (const categoryId of actions.secondaryCategoryIds) {
      const existing = await tx
        .select({ id: schema.transactionCategoryAssignments.id })
        .from(schema.transactionCategoryAssignments)
        .where(
          and(
            eq(schema.transactionCategoryAssignments.userId, userId),
            eq(schema.transactionCategoryAssignments.transactionId, transactionId),
            eq(schema.transactionCategoryAssignments.categoryId, categoryId),
            eq(schema.transactionCategoryAssignments.role, 'secondary'),
          ),
        )
        .limit(1);
      if (!existing.length) {
        await tx.insert(schema.transactionCategoryAssignments).values({
          id: randomUUID(),
          userId,
          transactionId,
          categoryId,
          role: 'secondary',
          source: 'rule',
          ruleId: rule.id,
        });
        secondaryAdded.push(categoryId);
      }
    }
    const tagsAdded: string[] = [];
    for (const tagId of actions.tagIds) {
      const existing = await tx
        .select({ id: schema.transactionTags.id })
        .from(schema.transactionTags)
        .where(
          and(
            eq(schema.transactionTags.userId, userId),
            eq(schema.transactionTags.transactionId, transactionId),
            eq(schema.transactionTags.tagId, tagId),
          ),
        )
        .limit(1);
      if (!existing.length) {
        await tx.insert(schema.transactionTags).values({
          id: randomUUID(),
          userId,
          transactionId,
          tagId,
          source: 'rule',
          ruleId: rule.id,
        });
        tagsAdded.push(tagId);
      }
    }
    if (actions.markReviewed && !current.reviewed)
      await tx
        .update(schema.transactions)
        .set({
          reviewed: true,
          reviewedAt: new Date(),
          reviewedByUserId: userId,
          updatedAt: new Date(),
        })
        .where(
          and(eq(schema.transactions.id, transactionId), eq(schema.transactions.userId, userId)),
        );
    const reviewedChanged = actions.markReviewed && !current.reviewed;
    if (!primaryChanged && !secondaryAdded.length && !tagsAdded.length && !reviewedChanged)
      return { applied: false, reason: 'no_change' };
    await tx.insert(schema.classificationEvents).values({
      id: randomUUID(),
      userId,
      ruleId: rule.id,
      transactionId,
      ruleVersion: rule.actionsVersion,
      previousPrimaryCategoryId: previous?.id ?? null,
      previousPrimarySource: previous?.source ?? null,
      resultingPrimaryCategoryId: resultingPrimary,
      secondaryCategoriesAdded: secondaryAdded,
      tagsAdded,
      matchedConditions: match.matchedConditions,
      reviewedChanged,
      previousReviewed: reviewedChanged ? current.reviewed : null,
      reason: match.reason,
    });
    await tx
      .update(schema.classificationRules)
      .set({ lastAppliedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.classificationRules.id, rule.id),
          eq(schema.classificationRules.userId, userId),
        ),
      );
    return { applied: true, reason: match.reason };
  });
}

export async function applyFutureRulesToTransactions(
  db: RacioDatabase,
  userId: string,
  transactionIds: string[],
) {
  if (!transactionIds.length) return { attempted: 0, applied: 0 };
  const rules = await db
    .select()
    .from(schema.classificationRules)
    .where(
      and(
        eq(schema.classificationRules.userId, userId),
        eq(schema.classificationRules.enabled, true),
        sql`${schema.classificationRules.archivedAt} IS NULL`,
      ),
    )
    .orderBy(
      asc(schema.classificationRules.priority),
      asc(schema.classificationRules.createdAt),
      asc(schema.classificationRules.id),
    );
  let applied = 0;
  for (const transactionId of transactionIds) {
    for (const rule of rules) {
      const result = await applyRuleToTransaction(db, userId, rule, transactionId, false);
      if (result.applied) applied += 1;
    }
  }
  return { attempted: transactionIds.length, applied };
}

export async function applyHistoricalRule(
  db: RacioDatabase,
  userId: string,
  ruleId: string,
  previewHash: string,
) {
  const preview = await previewRuleInternal(db, userId, ruleId);
  if (preview.rule.applyScope !== 'historical_and_future')
    conflict('This rule is configured for future imports only.');
  if (preview.previewHash !== previewHash) conflict('The rule preview is stale. Preview it again.');
  if (preview.matches.length > MAX_HISTORICAL_RUN || preview.truncated)
    conflict('Historical application is limited to 500 transactions.');
  let applied = 0;
  for (const item of preview.matches) {
    const result = await applyRuleToTransaction(db, userId, preview.rule, item.id, true);
    if (result.applied) applied += 1;
  }
  return { requested: preview.matches.length, applied, skipped: preview.matches.length - applied };
}

export async function listRuleEvents(db: RacioDatabase, userId: string, ruleId: string) {
  await getRule(db, userId, ruleId);
  return db
    .select()
    .from(schema.classificationEvents)
    .where(
      and(
        eq(schema.classificationEvents.userId, userId),
        eq(schema.classificationEvents.ruleId, ruleId),
      ),
    )
    .orderBy(desc(schema.classificationEvents.appliedAt))
    .limit(500);
}

export async function revertRuleEvent(db: RacioDatabase, userId: string, eventId: string) {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(schema.classificationEvents)
      .where(
        and(
          eq(schema.classificationEvents.id, eventId),
          eq(schema.classificationEvents.userId, userId),
        ),
      )
      .limit(1);
    if (!event) notFound('Classification event not found.');
    if (event.revertedAt) conflict('This rule application was already reverted.');
    const current = await getTransaction(
      tx as unknown as RacioDatabase,
      userId,
      event.transactionId,
    );
    let partial = false;
    const currentPrimary = current.primaryCategory;
    if (
      currentPrimary?.source === 'rule' &&
      currentPrimary.ruleId === event.ruleId &&
      currentPrimary.id === event.resultingPrimaryCategoryId
    ) {
      await tx
        .delete(schema.transactionCategoryAssignments)
        .where(
          and(
            eq(schema.transactionCategoryAssignments.userId, userId),
            eq(schema.transactionCategoryAssignments.transactionId, event.transactionId),
            eq(schema.transactionCategoryAssignments.role, 'primary'),
          ),
        );
      if (event.previousPrimaryCategoryId)
        await tx.insert(schema.transactionCategoryAssignments).values({
          id: randomUUID(),
          userId,
          transactionId: event.transactionId,
          categoryId: event.previousPrimaryCategoryId,
          role: 'primary',
          source: event.previousPrimarySource ?? 'system',
          ruleId: null,
        });
    } else if (event.resultingPrimaryCategoryId) partial = true;
    for (const categoryId of safeJsonArray(event.secondaryCategoriesAdded).filter(
      (value): value is string => typeof value === 'string',
    )) {
      const [assignment] = await tx
        .select({ id: schema.transactionCategoryAssignments.id })
        .from(schema.transactionCategoryAssignments)
        .where(
          and(
            eq(schema.transactionCategoryAssignments.userId, userId),
            eq(schema.transactionCategoryAssignments.transactionId, event.transactionId),
            eq(schema.transactionCategoryAssignments.categoryId, categoryId),
            eq(schema.transactionCategoryAssignments.role, 'secondary'),
            eq(schema.transactionCategoryAssignments.ruleId, event.ruleId),
          ),
        )
        .limit(1);
      if (assignment)
        await tx
          .delete(schema.transactionCategoryAssignments)
          .where(eq(schema.transactionCategoryAssignments.id, assignment.id));
      else partial = true;
    }
    for (const tagId of safeJsonArray(event.tagsAdded).filter(
      (value): value is string => typeof value === 'string',
    )) {
      const [tag] = await tx
        .select({ id: schema.transactionTags.id })
        .from(schema.transactionTags)
        .where(
          and(
            eq(schema.transactionTags.userId, userId),
            eq(schema.transactionTags.transactionId, event.transactionId),
            eq(schema.transactionTags.tagId, tagId),
            eq(schema.transactionTags.ruleId, event.ruleId),
          ),
        )
        .limit(1);
      if (tag) await tx.delete(schema.transactionTags).where(eq(schema.transactionTags.id, tag.id));
      else partial = true;
    }
    if (event.reviewedChanged && event.previousReviewed === false)
      await tx
        .update(schema.transactions)
        .set({ reviewed: false, reviewedAt: null, reviewedByUserId: null, updatedAt: new Date() })
        .where(
          and(
            eq(schema.transactions.id, event.transactionId),
            eq(schema.transactions.userId, userId),
            eq(schema.transactions.reviewed, true),
          ),
        );
    const [updated] = await tx
      .update(schema.classificationEvents)
      .set({ revertedAt: new Date() })
      .where(
        and(
          eq(schema.classificationEvents.id, event.id),
          eq(schema.classificationEvents.userId, userId),
        ),
      )
      .returning({ id: schema.classificationEvents.id });
    return { eventId: updated?.id ?? event.id, partial };
  });
}

export async function listSavedViews(db: RacioDatabase, userId: string) {
  return db
    .select()
    .from(schema.savedViews)
    .where(eq(schema.savedViews.userId, userId))
    .orderBy(desc(schema.savedViews.updatedAt));
}

async function validateSavedViewReferences(
  db: RacioDatabase,
  userId: string,
  input: SavedViewCreate | SavedViewPatch,
) {
  if (input.filters) {
    const filters = savedViewFiltersSchema.parse(input.filters);
    await assertOwnedFilterReferences(db, userId, {
      ...filters,
      limit: 1,
      offset: 0,
      includeArchived: filters.includeArchived ?? 'false',
      sort: 'bookingDateDesc',
    });
  }
  if (input.sort) savedViewSortSchema.parse(input.sort);
}

export async function createSavedView(db: RacioDatabase, userId: string, input: SavedViewCreate) {
  await validateSavedViewReferences(db, userId, input);
  return db.transaction(async (tx) => {
    if (input.isDefault)
      await tx
        .update(schema.savedViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.savedViews.userId, userId));
    const [row] = await tx
      .insert(schema.savedViews)
      .values({
        id: randomUUID(),
        userId,
        name: input.name.trim(),
        version: 1,
        filters: input.filters,
        sort: input.sort,
        columnPreferences: input.columnPreferences ?? null,
        isDefault: input.isDefault,
      })
      .returning();
    return row;
  });
}

async function getSavedView(db: QueryDb, userId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.id, id), eq(schema.savedViews.userId, userId)))
    .limit(1);
  if (!row) notFound('Saved view not found.');
  return row;
}

export async function updateSavedView(
  db: RacioDatabase,
  userId: string,
  id: string,
  input: SavedViewPatch,
) {
  await getSavedView(db, userId, id);
  await validateSavedViewReferences(db, userId, input);
  return db.transaction(async (tx) => {
    if (input.isDefault)
      await tx
        .update(schema.savedViews)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(schema.savedViews.userId, userId));
    const [row] = await tx
      .update(schema.savedViews)
      .set({
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(input.filters === undefined ? {} : { filters: input.filters }),
        ...(input.sort === undefined ? {} : { sort: input.sort }),
        ...(input.columnPreferences === undefined
          ? {}
          : { columnPreferences: input.columnPreferences }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        version: 1,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.savedViews.id, id), eq(schema.savedViews.userId, userId)))
      .returning();
    return row;
  });
}

export async function deleteSavedView(db: RacioDatabase, userId: string, id: string) {
  await getSavedView(db, userId, id);
  await db
    .delete(schema.savedViews)
    .where(and(eq(schema.savedViews.id, id), eq(schema.savedViews.userId, userId)));
  return { deleted: true };
}

export * from './phase6';
