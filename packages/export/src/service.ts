import { createHash, randomUUID } from 'node:crypto';
import { and, count, desc, eq, isNotNull, lt } from 'drizzle-orm';
import { AuthBoundaryError } from '@racio/auth';
import type { ExportRecord, ExportRequest, ExportTransactionFilters } from '@racio/contracts';
import { savedViewFiltersSchema } from '@racio/contracts';
import { schema, type RacioDatabase } from '@racio/database';
import type { PrivateStorage } from '@racio/storage';
import type { ExportLimits } from './limits';
import {
  assertOwnedExportFilters,
  countOwnedTransactions,
  fetchActiveSplits,
  fetchArchiveAccounts,
  fetchArchiveAdvisorConversations,
  fetchArchiveAlertEvents,
  fetchArchiveAlertRules,
  fetchArchiveBudgets,
  fetchArchiveCategories,
  fetchArchiveGoals,
  fetchArchiveInstitutions,
  fetchArchiveMerchants,
  fetchArchivePreferences,
  fetchArchiveTags,
  fetchArchiveTransactions,
  fetchArchiveTransferLinks,
  fetchTransactionExportPage,
  type TransactionExportCursor,
  type TransactionExportRow,
} from './queries';
import { buildArchiveManifest, buildArchiveZip } from './archive';
import { CSV_UTF8_BOM, encodeCsvRecord, escapeCsvField } from './csv';
import { buildXlsx } from './xlsx';
import {
  buildTransactionsXlsxSheets,
  TRANSACTION_CSV_COLUMNS,
  TRANSACTION_CSV_COLUMNS_WITH_NOTES,
  transactionToCsvFields,
} from './render';

export type ExportType = ExportRequest['type'];
export type ExportRow = typeof schema.exports.$inferSelect;

const STALE_PREPARING_HOURS = 2;
const EXPORT_PAGE_SIZE = 500;

function notFound(message: string): never {
  throw new AuthBoundaryError('NOT_FOUND', message);
}

function exportError(code: `EXPORT_${string}`, message: string): never {
  throw new AuthBoundaryError(code, message);
}

export type ExportFileSpec = {
  extension: 'csv' | 'xlsx' | 'zip';
  contentType: string;
  fileNamePrefix: string;
};

export function exportFileSpec(type: ExportType): ExportFileSpec {
  switch (type) {
    case 'transactions_csv':
      return {
        extension: 'csv',
        contentType: 'text/csv; charset=utf-8',
        fileNamePrefix: 'racio-transactions',
      };
    case 'transactions_xlsx':
      return {
        extension: 'xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        fileNamePrefix: 'racio-transactions',
      };
    case 'account_archive':
      return { extension: 'zip', contentType: 'application/zip', fileNamePrefix: 'racio-archive' };
  }
}

export function exportFileName(type: ExportType, generatedAt: Date): string {
  const spec = exportFileSpec(type);
  const date = generatedAt.toISOString().slice(0, 10);
  return `${spec.fileNamePrefix}-${date}.${spec.extension}`;
}

export function exportStorageKey(exportId: string, type: ExportType): string {
  const spec = exportFileSpec(type);
  return `exports/${exportId}.${spec.extension}`;
}

export function isExportExpired(row: Pick<ExportRow, 'status' | 'expiresAt'>, now: Date): boolean {
  return (
    row.status === 'ready' && row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime()
  );
}

export function toExportRecord(row: ExportRow, now: Date): ExportRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    rowCount: row.rowCount,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    errorCode: row.errorCode,
    fileName: exportFileName(row.type, row.createdAt),
    contentType: exportFileSpec(row.type).contentType,
    expired: isExportExpired(row, now),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
  };
}

async function resolveSavedViewFilters(
  db: RacioDatabase,
  userId: string,
  filters: ExportTransactionFilters,
): Promise<ExportTransactionFilters> {
  if (!filters.savedViewId) return filters;
  const [view] = await db
    .select()
    .from(schema.savedViews)
    .where(and(eq(schema.savedViews.id, filters.savedViewId), eq(schema.savedViews.userId, userId)))
    .limit(1);
  if (!view) notFound('Saved view not found.');
  const viewFilters = savedViewFiltersSchema.parse(view.filters);
  const rest = { ...filters };
  delete rest.savedViewId;
  return {
    ...rest,
    ...viewFilters,
    includeArchived: viewFilters.includeArchived ?? rest.includeArchived,
  };
}

/**
 * Creates a user-owned export request.
 *
 * - Saved views resolve server-side to their current validated filters; the
 *   resolved snapshot is stored, so later view edits cannot silently change
 *   an export's scope.
 * - Filter references are ownership-validated; cross-user references return
 *   not found.
 * - Small transaction exports generate synchronously; large exports and the
 *   archive are handed to the worker through the optional `enqueue` hook.
 */
export async function createExportRequest(
  db: RacioDatabase,
  userId: string,
  input: ExportRequest,
  limits: ExportLimits,
  storage: PrivateStorage,
  now: Date,
  enqueue?: (exportId: string) => Promise<void>,
): Promise<{ record: ExportRecord; requiresJob: boolean }> {
  let request: ExportRequest;
  let rowCount = 0;
  if (input.type === 'account_archive') {
    request = input;
  } else {
    const filters = await resolveSavedViewFilters(db, userId, input.filters);
    await assertOwnedExportFilters(db, userId, filters);
    request = { ...input, filters };
    rowCount = await countOwnedTransactions(db, userId, filters);
    if (rowCount > limits.maxRows)
      exportError('EXPORT_TOO_MANY_ROWS', 'The export exceeds the row limit.');
  }
  const [active] = await db
    .select({ count: count() })
    .from(schema.exports)
    .where(and(eq(schema.exports.userId, userId), eq(schema.exports.status, 'preparing')));
  if (Number(active?.count ?? 0) >= limits.maxConcurrentPerUser) {
    exportError('EXPORT_BUSY', 'Too many exports are already being prepared.');
  }
  const id = randomUUID();
  await db.insert(schema.exports).values({
    id,
    userId,
    type: input.type,
    status: 'preparing',
    requestJson: request,
    rowCount,
    createdAt: now,
    updatedAt: now,
  });

  const synchronous = input.type !== 'account_archive' && rowCount <= limits.syncMaxRows;
  if (synchronous) {
    const row = await generateExportFile(db, storage, id, limits, now);
    if (!row) {
      await db.delete(schema.exports).where(eq(schema.exports.id, id));
      exportError('EXPORT_STORAGE_ERROR', 'The export could not be generated.');
    }
    return { record: toExportRecord(row, now), requiresJob: false };
  }

  if (enqueue) {
    try {
      await enqueue(id);
    } catch {
      await db.delete(schema.exports).where(eq(schema.exports.id, id));
      exportError('EXPORT_STORAGE_ERROR', 'The export job could not be scheduled.');
    }
  }
  const row = await getExportRow(db, userId, id);
  return { record: toExportRecord(row, now), requiresJob: true };
}

export async function getExportRow(
  db: RacioDatabase,
  userId: string,
  exportId: string,
): Promise<ExportRow> {
  const [row] = await db
    .select()
    .from(schema.exports)
    .where(and(eq(schema.exports.id, exportId), eq(schema.exports.userId, userId)))
    .limit(1);
  if (!row) notFound('Export not found.');
  return row;
}

export async function listExports(
  db: RacioDatabase,
  userId: string,
  now: Date,
  limit = 50,
): Promise<ExportRecord[]> {
  const rows = await db
    .select()
    .from(schema.exports)
    .where(eq(schema.exports.userId, userId))
    .orderBy(desc(schema.exports.createdAt), desc(schema.exports.id))
    .limit(limit);
  return rows.map((row) => toExportRecord(row, now));
}

export async function deleteExport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  exportId: string,
): Promise<void> {
  const row = await getExportRow(db, userId, exportId);
  await db.delete(schema.exports).where(eq(schema.exports.id, exportId));
  if (row.storageKey) {
    try {
      await storage.delete(row.storageKey);
    } catch {
      // Best effort: the metadata row is already removed.
    }
  }
}

export async function downloadExport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  exportId: string,
  now: Date,
): Promise<{ bytes: Uint8Array; fileName: string; contentType: string }> {
  const row = await getExportRow(db, userId, exportId);
  if (row.status === 'preparing')
    exportError('EXPORT_NOT_READY', 'The export is still being prepared.');
  if (row.status === 'failed') exportError('EXPORT_FAILED', 'The export failed.');
  if (isExportExpired(row, now)) exportError('EXPORT_EXPIRED', 'The export has expired.');
  if (!row.storageKey) exportError('EXPORT_STORAGE_ERROR', 'The export file is unavailable.');
  let bytes: Uint8Array;
  try {
    bytes = await storage.get(row.storageKey);
  } catch {
    exportError('EXPORT_STORAGE_ERROR', 'The export file is unavailable.');
  }
  return {
    bytes,
    fileName: exportFileName(row.type, row.createdAt),
    contentType: exportFileSpec(row.type).contentType,
  };
}

type GenerationSnapshot = {
  type: ExportRequest['type'];
  request: ExportRequest;
  locale: string;
  timezone: string;
  rows: TransactionExportRow[];
  splits: Awaited<ReturnType<typeof fetchActiveSplits>>;
  resources: Array<{ fileName: string; records: unknown[] }>;
};

async function generateSnapshot(
  tx: RacioDatabase,
  userId: string,
  request: ExportRequest,
  limits: ExportLimits,
): Promise<GenerationSnapshot> {
  const preferences = await fetchArchivePreferences(tx, userId);
  const locale = preferences?.locale ?? 'en';
  const timezone = preferences?.timeZone ?? 'UTC';
  const rows: TransactionExportRow[] = [];
  if (request.type === 'transactions_csv' || request.type === 'transactions_xlsx') {
    let cursor: TransactionExportCursor | null = null;
    do {
      const page = await fetchTransactionExportPage(
        tx,
        userId,
        request.filters,
        cursor,
        EXPORT_PAGE_SIZE,
      );
      rows.push(...page.rows);
      cursor = page.nextCursor;
    } while (cursor && rows.length <= limits.maxRows);
    if (rows.length > limits.maxRows)
      exportError('EXPORT_TOO_MANY_ROWS', 'The export exceeds the row limit.');
  }
  const splits =
    request.type === 'transactions_xlsx' && request.includeSplits
      ? await fetchActiveSplits(
          tx,
          userId,
          rows.map((row) => row.id),
        )
      : [];
  const resources = await buildArchiveResources(tx, userId, request);
  return { type: request.type, request, locale, timezone, rows, splits, resources };
}

async function buildArchiveResources(
  tx: RacioDatabase,
  userId: string,
  request: ExportRequest,
): Promise<Array<{ fileName: string; records: unknown[] }>> {
  const resources: Array<{ fileName: string; records: unknown[] }> = [];
  if (request.type !== 'account_archive') return resources;
  const [
    accounts,
    institutions,
    categories,
    tags,
    merchants,
    transferLinks,
    budgets,
    goals,
    alertRules,
    alertEvents,
    transactionRows,
    splitRows,
  ] = await Promise.all([
    fetchArchiveAccounts(tx, userId),
    fetchArchiveInstitutions(tx, userId),
    fetchArchiveCategories(tx, userId),
    fetchArchiveTags(tx, userId),
    fetchArchiveMerchants(tx, userId),
    fetchArchiveTransferLinks(tx, userId),
    fetchArchiveBudgets(tx, userId),
    fetchArchiveGoals(tx, userId),
    fetchArchiveAlertRules(tx, userId),
    fetchArchiveAlertEvents(tx, userId),
    fetchArchiveTransactions(tx, userId),
    fetchActiveSplits(tx, userId),
  ]);
  resources.push({ fileName: 'accounts.json', records: accounts });
  resources.push({ fileName: 'institutions.json', records: institutions });
  resources.push({ fileName: 'categories.json', records: categories });
  resources.push({ fileName: 'tags.json', records: tags });
  resources.push({ fileName: 'merchants.json', records: merchants });
  resources.push({ fileName: 'transfer-links.json', records: transferLinks });
  resources.push({ fileName: 'budgets.json', records: budgets });
  resources.push({ fileName: 'goals.json', records: goals });
  resources.push({ fileName: 'alerts.json', records: [...alertRules, ...alertEvents] });
  resources.push({
    fileName: 'transactions.json',
    records: transactionRows.map((row) => archiveTransactionRecord(row, request.includeNotes)),
  });
  resources.push({
    fileName: 'splits.json',
    records: splitRows.map((row) => archiveSplitRecord(row, request.includeNotes)),
  });
  const preferences = await fetchArchivePreferences(tx, userId);
  resources.push({ fileName: 'preferences.json', records: preferences ? [preferences] : [] });
  if (request.includeAdvisorConversations) {
    resources.push({
      fileName: 'advisor.json',
      records: await fetchArchiveAdvisorConversations(tx, userId),
    });
  }
  return resources;
}

function archiveTransactionRecord(
  row: TransactionExportRow,
  includeNotes: boolean,
): Record<string, unknown> {
  return {
    id: row.id,
    booking_date: row.bookingDate,
    value_date: row.valueDate,
    description: row.description,
    imported_description: row.importedDescription,
    amount_exact: row.amountExact,
    currency: row.currency,
    direction: row.direction,
    account: row.account,
    institution: row.institution,
    merchant: row.merchant,
    primary_category: row.primaryCategory,
    secondary_categories: row.secondaryCategories,
    tags: row.tags,
    reviewed: row.reviewed,
    source_type: row.sourceType,
    bank_transaction_id: row.bankTransactionId,
    internal_transfer_status: row.internalTransferStatus,
    has_splits: row.hasSplits,
    split_count: row.splitCount,
    ...(includeNotes ? { note: row.note } : {}),
  };
}

function archiveSplitRecord(
  split: Awaited<ReturnType<typeof fetchActiveSplits>>[number],
  includeNotes: boolean,
): Record<string, unknown> {
  return {
    transaction_id: split.transactionId,
    split_position: split.position,
    amount_exact: split.amountExact,
    currency: split.currency,
    description: split.description,
    primary_category: split.primaryCategory,
    secondary_categories: split.secondaryCategories,
    tags: split.tags,
    ...(includeNotes ? { note: split.note } : {}),
  };
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Generates the export artifact and finalizes the row idempotently.
 *
 * - Retry-safe: a ready row is returned unchanged, and each attempt writes a
 *   fresh random storage key that the row references on finalize, so a
 *   worker retry never creates duplicate referenced artifacts and the stored
 *   checksum always matches the stored bytes.
 * - Snapshot consistency: every read runs inside one repeatable-read
 *   transaction, so concurrent writes cannot duplicate or skip rows.
 * - CSV streams page-by-page through `putChunks` to keep memory bounded;
 *   XLSX and the archive are assembled in memory under the file-size limit.
 * - Finalization is a guarded update; the losing attempt removes its own
 *   artifact. A crash between write and finalize may leave one private,
 *   unreferenced object, bounded by the file-size limit.
 */
export async function generateExportFile(
  db: RacioDatabase,
  storage: PrivateStorage,
  exportId: string,
  limits: ExportLimits,
  now: Date,
): Promise<ExportRow | null> {
  const [row] = await db
    .select()
    .from(schema.exports)
    .where(eq(schema.exports.id, exportId))
    .limit(1);
  if (!row) return null;
  if (row.status === 'ready' || row.status === 'failed') return row;

  const request = row.requestJson as ExportRequest;
  const attemptKey = exportStorageKey(randomUUID(), request.type);
  const contentType = exportFileSpec(request.type).contentType;
  try {
    const result = await db.transaction(
      async (tx) => {
        const transactionDb = tx as unknown as RacioDatabase;
        if (request.type === 'transactions_csv') {
          return streamCsvArtifact(
            transactionDb,
            row.userId,
            request as Extract<ExportRequest, { type: 'transactions_csv' }>,
            limits,
            storage,
            attemptKey,
            contentType,
          );
        }
        const snapshot = await generateSnapshot(transactionDb, row.userId, request, limits);
        const bytes = buildFileBytes(snapshot, request.type);
        if (bytes.byteLength > limits.maxFileBytes)
          exportError('EXPORT_TOO_LARGE', 'The generated file exceeds the size limit.');
        await storage.put(attemptKey, bytes, contentType);
        return { storageKey: attemptKey, sizeBytes: bytes.byteLength, checksum: sha256Hex(bytes) };
      },
      { isolationLevel: 'repeatable read' },
    );

    const [finalized] = await db
      .update(schema.exports)
      .set({
        status: 'ready',
        storageKey: result.storageKey,
        sizeBytes: result.sizeBytes,
        checksum: result.checksum,
        completedAt: now,
        expiresAt: new Date(now.getTime() + limits.retentionHours * 60 * 60 * 1_000),
        errorCode: null,
        updatedAt: now,
      })
      .where(and(eq(schema.exports.id, exportId), eq(schema.exports.status, 'preparing')))
      .returning();
    if (finalized) return finalized;

    // Another attempt finalized, or the row was deleted: this attempt's
    // artifact is never referenced, so remove it.
    try {
      await storage.delete(attemptKey);
    } catch {
      // Best effort.
    }
    const [finalRow] = await db
      .select()
      .from(schema.exports)
      .where(eq(schema.exports.id, exportId))
      .limit(1);
    return finalRow ?? null;
  } catch (error) {
    if (error instanceof AuthBoundaryError && error.code === 'EXPORT_TOO_LARGE') {
      await db
        .update(schema.exports)
        .set({ status: 'failed', errorCode: error.code, completedAt: now, updatedAt: now })
        .where(eq(schema.exports.id, exportId));
      try {
        await storage.delete(attemptKey);
      } catch {
        // Best effort.
      }
    }
    throw error;
  }
}

async function streamCsvArtifact(
  tx: RacioDatabase,
  userId: string,
  request: Extract<ExportRequest, { type: 'transactions_csv' }>,
  limits: ExportLimits,
  storage: PrivateStorage,
  attemptKey: string,
  contentType: string,
): Promise<{ storageKey: string; sizeBytes: number; checksum: string }> {
  const headers = request.includeNotes
    ? TRANSACTION_CSV_COLUMNS_WITH_NOTES
    : TRANSACTION_CSV_COLUMNS;
  const hash = createHash('sha256');
  let sizeBytes = 0;
  const track = (chunk: Uint8Array) => {
    hash.update(chunk);
    sizeBytes += chunk.byteLength;
    if (sizeBytes > limits.maxFileBytes)
      exportError('EXPORT_TOO_LARGE', 'The generated file exceeds the size limit.');
  };
  const encoder = new TextEncoder();
  track(CSV_UTF8_BOM);
  const headerChunk = encoder.encode(
    [...headers].map((header) => escapeCsvField(header)).join(',') + '\r\n',
  );
  track(headerChunk);

  await storage.putChunks(
    attemptKey,
    (async function* () {
      yield CSV_UTF8_BOM;
      yield headerChunk;
      let totalRows = 0;
      let cursor: TransactionExportCursor | null = null;
      for (;;) {
        const page = await fetchTransactionExportPage(
          tx,
          userId,
          request.filters,
          cursor,
          EXPORT_PAGE_SIZE,
        );
        for (const item of page.rows) {
          totalRows += 1;
          if (totalRows > limits.maxRows)
            exportError('EXPORT_TOO_MANY_ROWS', 'The export exceeds the row limit.');
          const chunk = encodeCsvRecord(transactionToCsvFields(item, request.includeNotes));
          track(chunk);
          yield chunk;
        }
        cursor = page.nextCursor;
        if (!cursor) break;
      }
    })(),
    contentType,
  );
  return { storageKey: attemptKey, sizeBytes, checksum: hash.digest('hex') };
}

function buildFileBytes(snapshot: GenerationSnapshot, type: ExportRequest['type']): Uint8Array {
  if (type === 'transactions_xlsx') {
    const request = snapshot.request as Extract<ExportRequest, { type: 'transactions_xlsx' }>;
    const sheets = buildTransactionsXlsxSheets({
      rows: snapshot.rows,
      splits: snapshot.splits,
      includeNotes: request.includeNotes,
      includeSplits: request.includeSplits,
      locale: snapshot.locale,
      timezone: snapshot.timezone,
      rowCount: snapshot.rows.length,
      generatedAt: new Date().toISOString(),
    });
    return buildXlsx(sheets);
  }
  if (type === 'account_archive') {
    const manifest = buildArchiveManifest({
      generatedAt: new Date().toISOString(),
      locale: snapshot.locale,
      timezone: snapshot.timezone,
      resources: snapshot.resources,
    });
    return buildArchiveZip({ resources: snapshot.resources, manifest });
  }
  exportError('EXPORT_FORMAT_UNSUPPORTED', 'Unsupported export format.');
}

/**
 * Removes expired export files and marks stale preparing exports as failed.
 *
 * - Expired ready exports lose their storage object; metadata rows remain
 *   for audit with the file unavailable.
 * - Preparing rows older than a fixed bound (worker retries exhausted or job
 *   lost) transition to a structured failed state.
 */
export async function cleanupExpiredExports(
  db: RacioDatabase,
  storage: PrivateStorage,
  limits: ExportLimits,
  now = new Date(),
): Promise<{ expired: number; stale: number }> {
  void limits;
  let expired = 0;
  const expiredRows = await db
    .select({ id: schema.exports.id, storageKey: schema.exports.storageKey })
    .from(schema.exports)
    .where(and(eq(schema.exports.status, 'ready'), lt(schema.exports.expiresAt, now)));
  for (const row of expiredRows) {
    if (!row.storageKey) continue;
    try {
      await storage.delete(row.storageKey);
    } catch {
      continue;
    }
    const [updated] = await db
      .update(schema.exports)
      .set({ storageKey: null, updatedAt: now })
      .where(
        and(
          eq(schema.exports.id, row.id),
          eq(schema.exports.storageKey, row.storageKey),
          eq(schema.exports.status, 'ready'),
        ),
      )
      .returning({ id: schema.exports.id });
    if (updated) expired += 1;
  }

  const staleCutoff = new Date(now.getTime() - STALE_PREPARING_HOURS * 60 * 60 * 1_000);
  const stale = await db
    .update(schema.exports)
    .set({ status: 'failed', errorCode: 'EXPORT_FAILED', completedAt: now, updatedAt: now })
    .where(and(eq(schema.exports.status, 'preparing'), lt(schema.exports.updatedAt, staleCutoff)))
    .returning({ id: schema.exports.id });
  return { expired, stale: stale.length };
}

const ORPHAN_GRACE_HOURS = 2;

/**
 * Reconciles private storage against the live `exports` table and deletes
 * unreferenced artifacts older than a grace period.
 *
 * A worker crash between storage write and row finalization can leave one
 * private object per crash that no export row references (the write uses a
 * fresh random key precisely so retries never create duplicates). This
 * reconciler lists the `exports/` storage prefix, compares keys against every
 * referenced `storageKey`, and removes keys that (a) are not referenced by
 * any export row and (b) were modified before the grace period. Referenced
 * artifacts, including expired ones (handled by `cleanupExpiredExports`), are
 * never touched, so no cleanup job can delete active user data.
 */
export async function reconcileOrphanExports(
  storage: PrivateStorage,
  db: RacioDatabase,
  now = new Date(),
  graceHours = ORPHAN_GRACE_HOURS,
): Promise<{ removed: number; scanned: number }> {
  const objects = await storage.list('exports');
  if (objects.length === 0) return { removed: 0, scanned: 0 };

  const referencedRows = await db
    .select({ storageKey: schema.exports.storageKey })
    .from(schema.exports)
    .where(isNotNull(schema.exports.storageKey));
  const referenced = new Set(referencedRows.map((row) => row.storageKey));

  const cutoff = new Date(now.getTime() - graceHours * 60 * 60 * 1_000);
  let removed = 0;
  for (const object of objects) {
    if (referenced.has(object.key)) continue;
    if (object.modifiedAt > cutoff) continue;
    try {
      await storage.delete(object.key);
      removed += 1;
    } catch {
      // The object may already be gone; nothing to do.
    }
  }
  return { removed, scanned: objects.length };
}
