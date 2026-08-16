import { and, asc, count, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import {
  buildTransactionFilterConditions,
  assertOwnedFilterReferences,
  type TransactionFilterFields,
} from '@racio/transactions';
import { schema, type RacioDatabase } from '@racio/database';

export type InternalTransferStatus = 'none' | 'suggested' | 'confirmed' | 'rejected' | 'unlinked';

export type TransactionExportRow = {
  id: string;
  bookingDate: string;
  valueDate: string | null;
  description: string;
  importedDescription: string;
  amountExact: string;
  currency: string;
  direction: 'credit' | 'debit' | 'unknown';
  account: string;
  institution: string;
  merchant: string;
  primaryCategory: string;
  secondaryCategories: string[];
  tags: string[];
  reviewed: boolean;
  sourceType: 'csv' | 'xlsx' | 'pdf';
  bankTransactionId: string | null;
  internalTransferStatus: InternalTransferStatus;
  hasSplits: boolean;
  splitCount: number;
  note: string | null;
};

export type SplitExportRow = {
  transactionId: string;
  position: number;
  amountExact: string;
  currency: string;
  description: string;
  note: string | null;
  primaryCategory: string;
  secondaryCategories: string[];
  tags: string[];
};

export type TransactionExportCursor = {
  bookingDate: string;
  createdAt: Date;
  id: string;
};

const PAGE_SIZE = 500;

export async function countOwnedTransactions(
  db: RacioDatabase,
  userId: string,
  filters: TransactionFilterFields,
): Promise<number> {
  const conditions = buildTransactionFilterConditions(db, userId, filters);
  const [row] = await db
    .select({ total: count() })
    .from(schema.transactions)
    .innerJoin(
      schema.financialAccounts,
      eq(schema.transactions.financialAccountId, schema.financialAccounts.id),
    )
    .where(and(...conditions));
  return Number(row?.total ?? 0);
}

export async function assertOwnedExportFilters(
  db: RacioDatabase,
  userId: string,
  filters: TransactionFilterFields,
): Promise<void> {
  await assertOwnedFilterReferences(db, userId, {
    ...filters,
    limit: 1,
    offset: 0,
    sort: 'bookingDateDesc',
  });
}

export async function fetchTransactionExportPage(
  db: RacioDatabase,
  userId: string,
  filters: TransactionFilterFields,
  cursor: TransactionExportCursor | null,
  limit = PAGE_SIZE,
): Promise<{ rows: TransactionExportRow[]; nextCursor: TransactionExportCursor | null }> {
  const conditions = buildTransactionFilterConditions(db, userId, filters);
  if (cursor) {
    conditions.push(
      or(
        gt(schema.transactions.bookingDate, cursor.bookingDate),
        and(
          eq(schema.transactions.bookingDate, cursor.bookingDate),
          gt(schema.transactions.createdAt, cursor.createdAt),
        ),
        and(
          eq(schema.transactions.bookingDate, cursor.bookingDate),
          eq(schema.transactions.createdAt, cursor.createdAt),
          gt(schema.transactions.id, cursor.id),
        ),
      )!,
    );
  }
  const page = await db
    .select({
      id: schema.transactions.id,
      bookingDate: schema.transactions.bookingDate,
      valueDate: schema.transactions.valueDate,
      importedDescription: schema.transactions.importedDescription,
      rawDescription: schema.transactions.rawDescription,
      userDescription: schema.transactions.userDescription,
      userNote: schema.transactions.userNote,
      amount: schema.transactions.amount,
      currencyCode: schema.transactions.currencyCode,
      direction: schema.transactions.direction,
      reviewed: schema.transactions.reviewed,
      sourceType: schema.transactions.sourceType,
      bankTransactionId: schema.transactions.bankTransactionId,
      createdAt: schema.transactions.createdAt,
      accountName: schema.financialAccounts.displayName,
      institutionName: schema.institutions.name,
      merchantName: schema.merchants.displayName,
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
    .where(and(...conditions))
    .orderBy(
      asc(schema.transactions.bookingDate),
      asc(schema.transactions.createdAt),
      asc(schema.transactions.id),
    )
    .limit(limit + 1);
  const hasMore = page.length > limit;
  const pageRows = page.slice(0, limit);
  const nextCursor: TransactionExportCursor | null = hasMore
    ? {
        bookingDate: pageRows.at(-1)!.bookingDate,
        createdAt: pageRows.at(-1)!.createdAt,
        id: pageRows.at(-1)!.id,
      }
    : null;

  const ids = pageRows.map((row) => row.id);
  const [classifications, transferLinks, splitCounts] = await Promise.all([
    fetchClassifications(db, userId, ids),
    fetchTransferStatuses(db, userId, ids),
    fetchSplitCounts(db, userId, ids),
  ]);
  const rows: TransactionExportRow[] = pageRows.map((row) => ({
    id: row.id,
    bookingDate: row.bookingDate,
    valueDate: row.valueDate,
    description: row.userDescription ?? row.importedDescription ?? row.rawDescription,
    importedDescription: row.importedDescription,
    amountExact: row.amount,
    currency: row.currencyCode,
    direction: row.direction,
    account: row.accountName,
    institution: row.institutionName,
    merchant: row.merchantName ?? '',
    primaryCategory: classifications.get(row.id)?.primary ?? '',
    secondaryCategories: classifications.get(row.id)?.secondary ?? [],
    tags: classifications.get(row.id)?.tags ?? [],
    reviewed: row.reviewed,
    sourceType: row.sourceType,
    bankTransactionId: row.bankTransactionId,
    internalTransferStatus: transferLinks.get(row.id) ?? 'none',
    hasSplits: (splitCounts.get(row.id) ?? 0) > 0,
    splitCount: splitCounts.get(row.id) ?? 0,
    note: row.userNote,
  }));
  return { rows, nextCursor };
}

async function fetchClassifications(
  db: RacioDatabase,
  userId: string,
  transactionIds: string[],
): Promise<Map<string, { primary: string; secondary: string[]; tags: string[] }>> {
  const result = new Map<string, { primary: string; secondary: string[]; tags: string[] }>();
  if (!transactionIds.length) return result;
  const [categories, tags] = await Promise.all([
    db
      .select({
        transactionId: schema.transactionCategoryAssignments.transactionId,
        categoryName: schema.categories.name,
        role: schema.transactionCategoryAssignments.role,
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
        tagName: schema.tags.name,
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
  for (const row of categories) {
    const entry = result.get(row.transactionId) ?? { primary: '', secondary: [], tags: [] };
    if (row.role === 'primary') entry.primary = row.categoryName;
    else entry.secondary.push(row.categoryName);
    result.set(row.transactionId, entry);
  }
  for (const row of tags) {
    const entry = result.get(row.transactionId) ?? { primary: '', secondary: [], tags: [] };
    entry.tags.push(row.tagName);
    result.set(row.transactionId, entry);
  }
  return result;
}

async function fetchTransferStatuses(
  db: RacioDatabase,
  userId: string,
  transactionIds: string[],
): Promise<Map<string, InternalTransferStatus>> {
  const result = new Map<string, InternalTransferStatus>();
  if (!transactionIds.length) return result;
  const links = await db
    .select({
      outgoingTransactionId: schema.internalTransferLinks.outgoingTransactionId,
      incomingTransactionId: schema.internalTransferLinks.incomingTransactionId,
      status: schema.internalTransferLinks.status,
    })
    .from(schema.internalTransferLinks)
    .where(
      and(
        eq(schema.internalTransferLinks.userId, userId),
        or(
          inArray(schema.internalTransferLinks.outgoingTransactionId, transactionIds),
          inArray(schema.internalTransferLinks.incomingTransactionId, transactionIds),
        ),
      ),
    );
  const ORDER: InternalTransferStatus[] = ['confirmed', 'suggested', 'rejected', 'unlinked'];
  for (const link of links) {
    for (const transactionId of [link.outgoingTransactionId, link.incomingTransactionId]) {
      if (!transactionIds.includes(transactionId)) continue;
      const current = result.get(transactionId);
      if (!current || ORDER.indexOf(link.status) < ORDER.indexOf(current)) {
        result.set(transactionId, link.status);
      }
    }
  }
  return result;
}

async function fetchSplitCounts(
  db: RacioDatabase,
  userId: string,
  transactionIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (!transactionIds.length) return result;
  const rows = await db
    .select({
      transactionId: schema.transactionSplits.transactionId,
      count: count(),
    })
    .from(schema.transactionSplits)
    .where(
      and(
        eq(schema.transactionSplits.userId, userId),
        isNull(schema.transactionSplits.archivedAt),
        inArray(schema.transactionSplits.transactionId, transactionIds),
      ),
    )
    .groupBy(schema.transactionSplits.transactionId);
  for (const row of rows) result.set(row.transactionId, Number(row.count));
  return result;
}

export async function fetchArchiveTransactions(
  db: RacioDatabase,
  userId: string,
  limit = 250_000,
): Promise<TransactionExportRow[]> {
  const rows: TransactionExportRow[] = [];
  let cursor: TransactionExportCursor | null = null;
  const filters: TransactionFilterFields = { includeArchived: 'true' };
  do {
    const page = await fetchTransactionExportPage(db, userId, filters, cursor, 500);
    rows.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor && rows.length <= limit);
  return rows.slice(0, limit);
}

export async function fetchActiveSplits(
  db: RacioDatabase,
  userId: string,
  transactionIds?: string[],
): Promise<SplitExportRow[]> {
  const splitConditions: SQL[] = [
    eq(schema.transactionSplits.userId, userId),
    isNull(schema.transactionSplits.archivedAt),
  ];
  if (transactionIds !== undefined) {
    if (!transactionIds.length) return [];
    splitConditions.push(inArray(schema.transactionSplits.transactionId, transactionIds));
  }
  const splits = await db
    .select({
      id: schema.transactionSplits.id,
      transactionId: schema.transactionSplits.transactionId,
      position: schema.transactionSplits.position,
      amount: schema.transactionSplits.amount,
      currencyCode: schema.transactionSplits.currencyCode,
      description: schema.transactionSplits.description,
      note: schema.transactionSplits.note,
    })
    .from(schema.transactionSplits)
    .where(and(...splitConditions))
    .orderBy(asc(schema.transactionSplits.transactionId), asc(schema.transactionSplits.position));
  if (!splits.length) return [];
  const splitIds = splits.map((split) => split.id);
  const [categories, tags] = await Promise.all([
    db
      .select({
        splitId: schema.transactionSplitCategoryAssignments.splitId,
        categoryName: schema.categories.name,
        role: schema.transactionSplitCategoryAssignments.role,
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
        tagName: schema.tags.name,
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
  const categoryMap = new Map<string, { primary: string; secondary: string[] }>();
  for (const row of categories) {
    const entry = categoryMap.get(row.splitId) ?? { primary: '', secondary: [] };
    if (row.role === 'primary') entry.primary = row.categoryName;
    else entry.secondary.push(row.categoryName);
    categoryMap.set(row.splitId, entry);
  }
  const tagMap = new Map<string, string[]>();
  for (const row of tags) {
    tagMap.set(row.splitId, [...(tagMap.get(row.splitId) ?? []), row.tagName]);
  }
  return splits.map((split) => ({
    transactionId: split.transactionId,
    position: split.position,
    amountExact: split.amount,
    currency: split.currencyCode,
    description: split.description ?? '',
    note: split.note,
    primaryCategory: categoryMap.get(split.id)?.primary ?? '',
    secondaryCategories: categoryMap.get(split.id)?.secondary ?? [],
    tags: tagMap.get(split.id) ?? [],
  }));
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export type ArchiveAccount = {
  id: string;
  displayName: string;
  accountType: string;
  currency: string;
  status: string;
  maskedAccountIdentifier: string | null;
  maskedIban: string | null;
  institutionId: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveInstitution = {
  id: string;
  name: string;
  countryCode: string;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveCategory = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  status: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveTag = {
  id: string;
  name: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveMerchant = {
  id: string;
  displayName: string;
  status: string;
  mergedIntoMerchantId: string | null;
  aliases: Array<{ id: string; rawPattern: string; matchType: string; enabled: boolean }>;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveTransferLink = {
  id: string;
  outgoingTransactionId: string;
  incomingTransactionId: string;
  status: string;
  source: string;
  matchScore: number | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveBudget = {
  id: string;
  name: string;
  currency: string;
  amount: string;
  periodType: string;
  categoryId: string | null;
  accountId: string | null;
  customStartDate: string | null;
  customEndDate: string | null;
  warningThreshold: number | null;
  rolloverEnabled: boolean;
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveGoal = {
  id: string;
  name: string;
  currency: string;
  targetAmount: string;
  targetDate: string | null;
  trackingMode: string;
  accountId: string | null;
  manualSavedAmount: string | null;
  enabled: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveAlertRule = {
  id: string;
  type: string;
  enabled: boolean;
  config: unknown;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ArchiveAlertEvent = {
  id: string;
  type: string;
  ruleId: string | null;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  triggeredAt: string;
  readAt: string | null;
  dismissedAt: string | null;
};

export type ArchivePreferences = {
  locale: string;
  timeZone: string;
  interfaceMode: string;
  appearance: string;
  baseCurrency: string | null;
};

export type ArchiveAdvisorThread = {
  id: string;
  title: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>;
};

export async function fetchArchiveInstitutions(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveInstitution[]> {
  const rows = await db
    .select({
      id: schema.institutions.id,
      name: schema.institutions.name,
      countryCode: schema.institutions.countryCode,
      createdAt: schema.institutions.createdAt,
      updatedAt: schema.institutions.updatedAt,
    })
    .from(schema.institutions)
    .where(eq(schema.institutions.userId, userId))
    .orderBy(asc(schema.institutions.createdAt), asc(schema.institutions.id));
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveAccounts(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveAccount[]> {
  const rows = await db
    .select({
      id: schema.financialAccounts.id,
      displayName: schema.financialAccounts.displayName,
      accountType: schema.financialAccounts.accountType,
      currency: schema.financialAccounts.currencyCode,
      status: schema.financialAccounts.status,
      maskedAccountIdentifier: schema.financialAccounts.maskedAccountIdentifier,
      maskedIban: schema.financialAccounts.maskedIban,
      institutionId: schema.financialAccounts.institutionId,
      archivedAt: schema.financialAccounts.archivedAt,
      createdAt: schema.financialAccounts.createdAt,
      updatedAt: schema.financialAccounts.updatedAt,
    })
    .from(schema.financialAccounts)
    .where(eq(schema.financialAccounts.userId, userId))
    .orderBy(asc(schema.financialAccounts.createdAt), asc(schema.financialAccounts.id));
  return rows.map((row) => ({
    ...row,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveCategories(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveCategory[]> {
  const rows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      kind: schema.categories.kind,
      parentId: schema.categories.parentId,
      status: schema.categories.status,
      archivedAt: schema.categories.archivedAt,
      createdAt: schema.categories.createdAt,
      updatedAt: schema.categories.updatedAt,
    })
    .from(schema.categories)
    .where(eq(schema.categories.userId, userId))
    .orderBy(asc(schema.categories.name), asc(schema.categories.id));
  return rows.map((row) => ({
    ...row,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveTags(db: RacioDatabase, userId: string): Promise<ArchiveTag[]> {
  const rows = await db
    .select()
    .from(schema.tags)
    .where(eq(schema.tags.userId, userId))
    .orderBy(asc(schema.tags.name), asc(schema.tags.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveMerchants(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveMerchant[]> {
  const merchants = await db
    .select()
    .from(schema.merchants)
    .where(eq(schema.merchants.userId, userId))
    .orderBy(asc(schema.merchants.createdAt), asc(schema.merchants.id));
  const aliases = await db
    .select()
    .from(schema.merchantAliases)
    .where(eq(schema.merchantAliases.userId, userId))
    .orderBy(asc(schema.merchantAliases.createdAt), asc(schema.merchantAliases.id));
  const aliasMap = new Map<string, ArchiveMerchant['aliases']>();
  for (const alias of aliases) {
    aliasMap.set(alias.merchantId, [
      ...(aliasMap.get(alias.merchantId) ?? []),
      {
        id: alias.id,
        rawPattern: alias.rawPattern,
        matchType: alias.matchType,
        enabled: alias.enabled,
      },
    ]);
  }
  return merchants.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    status: row.status,
    mergedIntoMerchantId: row.mergedIntoMerchantId,
    aliases: aliasMap.get(row.id) ?? [],
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveTransferLinks(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveTransferLink[]> {
  const rows = await db
    .select()
    .from(schema.internalTransferLinks)
    .where(eq(schema.internalTransferLinks.userId, userId))
    .orderBy(asc(schema.internalTransferLinks.createdAt), asc(schema.internalTransferLinks.id));
  return rows.map((row) => ({
    id: row.id,
    outgoingTransactionId: row.outgoingTransactionId,
    incomingTransactionId: row.incomingTransactionId,
    status: row.status,
    source: row.source,
    matchScore: row.matchScore,
    confirmedAt: isoOrNull(row.confirmedAt),
    rejectedAt: isoOrNull(row.rejectedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveBudgets(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveBudget[]> {
  const rows = await db
    .select()
    .from(schema.budgets)
    .where(eq(schema.budgets.userId, userId))
    .orderBy(asc(schema.budgets.createdAt), asc(schema.budgets.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency,
    amount: row.amount,
    periodType: row.periodType,
    categoryId: row.categoryId,
    accountId: row.accountId,
    customStartDate: row.customStartDate,
    customEndDate: row.customEndDate,
    warningThreshold: row.warningThreshold,
    rolloverEnabled: row.rolloverEnabled,
    enabled: row.enabled,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveGoals(db: RacioDatabase, userId: string): Promise<ArchiveGoal[]> {
  const rows = await db
    .select()
    .from(schema.savingsGoals)
    .where(eq(schema.savingsGoals.userId, userId))
    .orderBy(asc(schema.savingsGoals.createdAt), asc(schema.savingsGoals.id));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    currency: row.currency,
    targetAmount: row.targetAmount,
    targetDate: row.targetDate,
    trackingMode: row.trackingMode,
    accountId: row.accountId,
    manualSavedAmount: row.manualSavedAmount,
    enabled: row.enabled,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveAlertRules(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveAlertRule[]> {
  const rows = await db
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.userId, userId))
    .orderBy(asc(schema.alertRules.createdAt), asc(schema.alertRules.id));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    enabled: row.enabled,
    config: row.config,
    archivedAt: isoOrNull(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function fetchArchiveAlertEvents(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveAlertEvent[]> {
  const rows = await db
    .select()
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.userId, userId))
    .orderBy(asc(schema.alertEvents.triggeredAt), asc(schema.alertEvents.id));
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    ruleId: row.ruleId,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    triggeredAt: row.triggeredAt.toISOString(),
    readAt: isoOrNull(row.readAt),
    dismissedAt: isoOrNull(row.dismissedAt),
  }));
}

export async function fetchArchivePreferences(
  db: RacioDatabase,
  userId: string,
): Promise<ArchivePreferences | null> {
  const [row] = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1);
  if (!row) return null;
  return {
    locale: row.locale,
    timeZone: row.timeZone,
    interfaceMode: row.interfaceMode,
    appearance: row.appearance,
    baseCurrency: row.baseCurrency,
  };
}

export async function fetchArchiveAdvisorConversations(
  db: RacioDatabase,
  userId: string,
): Promise<ArchiveAdvisorThread[]> {
  const threads = await db
    .select()
    .from(schema.advisorThreads)
    .where(eq(schema.advisorThreads.userId, userId))
    .orderBy(asc(schema.advisorThreads.createdAt), asc(schema.advisorThreads.id));
  if (!threads.length) return [];
  const messages = await db
    .select()
    .from(schema.advisorMessages)
    .where(eq(schema.advisorMessages.userId, userId))
    .orderBy(asc(schema.advisorMessages.createdAt), asc(schema.advisorMessages.id));
  const messageMap = new Map<string, ArchiveAdvisorThread['messages']>();
  for (const message of messages) {
    messageMap.set(message.threadId, [
      ...(messageMap.get(message.threadId) ?? []),
      {
        id: message.id,
        role: message.role,
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      },
    ]);
  }
  return threads.map((thread) => ({
    id: thread.id,
    title: thread.title,
    archivedAt: isoOrNull(thread.archivedAt),
    createdAt: thread.createdAt.toISOString(),
    updatedAt: thread.updatedAt.toISOString(),
    messages: messageMap.get(thread.id) ?? [],
  }));
}
