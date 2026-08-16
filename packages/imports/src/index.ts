// Import application service: session-bound callers supply the authenticated user id.
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, lt, ne } from 'drizzle-orm';
import type {
  CsvMapping,
  ParserResultV2,
  PdfMapping,
  PdfParserResult,
  XlsxMapping,
  XlsxParserResult,
} from '@racio/contracts';
import {
  parseParserResultV2,
  parsePdfInspection,
  parsePdfParserResult,
  parseWorkbookInspection,
  parseXlsxParserResult,
} from '@racio/contracts';
import {
  MINIMUM_MONEY_UNIT,
  decimalToScaledInteger,
  normalizeTransactionDescription,
  reconcileStatement,
  scaledIntegerToDecimal,
  validateImportCandidate,
} from '@racio/domain';
import { schema, type RacioDatabase } from '@racio/database';
import type { PrivateStorage } from '@racio/storage';
import { createRandomStorageKey } from '@racio/storage';
import { AuthBoundaryError } from '@racio/auth';
import {
  applyFutureRulesToTransactions,
  applyMerchantAliasesToTransactions,
  suggestInternalTransfers,
} from '@racio/transactions';

const CSV_MEDIA_TYPE = 'text/csv';
const XLSX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PDF_MEDIA_TYPE = 'application/pdf';

type ImportMapping = CsvMapping | XlsxMapping | PdfMapping;
type SelectedSheetMetadata = {
  sourceType: 'xlsx';
  selectedSheetId: string;
  selectedSheetName: string;
  selectedSheetIndex: number;
  workbookDateSystem: '1900' | '1904';
};

function ownedStatementWhere(userId: string, statementId: string) {
  return and(eq(schema.statements.id, statementId), eq(schema.statements.userId, userId));
}

function fingerprint(input: {
  bookingDate: string | null;
  amount: string | null;
  currency: string | null;
  direction: string;
  description: string;
}) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        bookingDate: input.bookingDate,
        amount: input.amount,
        currency: input.currency,
        direction: input.direction,
        description: normalizeTransactionDescription(input.description),
      }),
    )
    .digest('hex');
}

function publicStatement<T extends { userId: string; storageKey?: string | null }>(row: T) {
  const { userId, storageKey, uploadIdempotencyKey, confirmationIdempotencyKey, ...safe } =
    row as T & {
      uploadIdempotencyKey?: string | null;
      confirmationIdempotencyKey?: string | null;
    };
  void userId;
  void storageKey;
  void uploadIdempotencyKey;
  void confirmationIdempotencyKey;
  return safe;
}

export async function createCsvImport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  input: {
    accountId: string;
    filename: string;
    size: number;
    checksum: string;
    bytes: Uint8Array;
    retainOriginalFile: boolean;
    reprocess: boolean;
    idempotencyKey: string;
  },
) {
  const [account] = await db
    .select({ id: schema.financialAccounts.id })
    .from(schema.financialAccounts)
    .where(
      and(
        eq(schema.financialAccounts.id, input.accountId),
        eq(schema.financialAccounts.userId, userId),
      ),
    )
    .limit(1);
  if (!account) throw new AuthBoundaryError('NOT_FOUND', 'Financial account not found.');

  const [idempotent] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.uploadIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (idempotent) return { duplicate: false, statement: publicStatement(idempotent), jobId: null };

  const [existing] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.financialAccountId, input.accountId),
        eq(schema.statements.fileChecksum, input.checksum),
      ),
    )
    .orderBy(desc(schema.statements.createdAt))
    .limit(1);
  if (existing && !input.reprocess) {
    throw new AuthBoundaryError('CONFLICT', 'This file was already uploaded for this account.');
  }

  const statementId = randomUUID();
  const jobId = randomUUID();
  const storageKey = createRandomStorageKey('statements', 'csv');
  await storage.put(storageKey, input.bytes, CSV_MEDIA_TYPE);
  try {
    const statement = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.statements)
        .values({
          id: statementId,
          userId,
          financialAccountId: input.accountId,
          sourceType: 'csv',
          originalFilename: input.filename,
          fileSize: input.size,
          fileChecksum: input.checksum,
          storageKey,
          retainOriginalFile: input.retainOriginalFile,
          duplicateState: existing
            ? existing.processingStatus === 'imported'
              ? 'previously_imported'
              : 'previously_uploaded'
            : 'safe_to_continue',
          uploadIdempotencyKey: input.idempotencyKey,
          processingStatus: 'uploaded',
        })
        .returning();
      if (!created) throw new Error('Database did not return the statement.');
      await tx.insert(schema.importJobs).values({
        id: jobId,
        userId,
        statementId,
        jobType: 'statement.parse.csv',
        status: 'queued',
      });
      return created;
    });
    return { duplicate: Boolean(existing), statement: publicStatement(statement), jobId };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function createXlsxImport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  input: {
    accountId: string;
    filename: string;
    size: number;
    checksum: string;
    bytes: Uint8Array;
    retainOriginalFile: boolean;
    reprocess: boolean;
    idempotencyKey: string;
  },
) {
  const [account] = await db
    .select({ id: schema.financialAccounts.id })
    .from(schema.financialAccounts)
    .where(
      and(
        eq(schema.financialAccounts.id, input.accountId),
        eq(schema.financialAccounts.userId, userId),
      ),
    )
    .limit(1);
  if (!account) throw new AuthBoundaryError('NOT_FOUND', 'Financial account not found.');

  const [idempotent] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.uploadIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (idempotent) return { duplicate: false, statement: publicStatement(idempotent), jobId: null };

  const [existing] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.financialAccountId, input.accountId),
        eq(schema.statements.fileChecksum, input.checksum),
      ),
    )
    .orderBy(desc(schema.statements.createdAt))
    .limit(1);
  if (existing && !input.reprocess)
    throw new AuthBoundaryError('CONFLICT', 'This file was already uploaded for this account.');

  const statementId = randomUUID();
  const jobId = randomUUID();
  const storageKey = createRandomStorageKey('statements', 'xlsx');
  await storage.put(storageKey, input.bytes, XLSX_MEDIA_TYPE);
  try {
    const statement = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.statements)
        .values({
          id: statementId,
          userId,
          financialAccountId: input.accountId,
          sourceType: 'xlsx',
          originalFilename: input.filename,
          fileSize: input.size,
          fileChecksum: input.checksum,
          storageKey,
          retainOriginalFile: input.retainOriginalFile,
          duplicateState: existing
            ? existing.processingStatus === 'imported'
              ? 'previously_imported'
              : 'previously_uploaded'
            : 'safe_to_continue',
          uploadIdempotencyKey: input.idempotencyKey,
          processingStatus: 'uploaded',
        })
        .returning();
      if (!created) throw new Error('Database did not return the statement.');
      await tx.insert(schema.importJobs).values({
        id: jobId,
        userId,
        statementId,
        jobType: 'statement.inspect.xlsx',
        status: 'queued',
      });
      return created;
    });
    return { duplicate: Boolean(existing), statement: publicStatement(statement), jobId };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function createPdfImport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  input: {
    accountId: string;
    filename: string;
    size: number;
    checksum: string;
    bytes: Uint8Array;
    retainOriginalFile: boolean;
    reprocess: boolean;
    idempotencyKey: string;
  },
) {
  const [account] = await db
    .select({ id: schema.financialAccounts.id })
    .from(schema.financialAccounts)
    .where(
      and(
        eq(schema.financialAccounts.id, input.accountId),
        eq(schema.financialAccounts.userId, userId),
      ),
    )
    .limit(1);
  if (!account) throw new AuthBoundaryError('NOT_FOUND', 'Financial account not found.');

  const [idempotent] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.uploadIdempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (idempotent) return { duplicate: false, statement: publicStatement(idempotent), jobId: null };

  const [existing] = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.financialAccountId, input.accountId),
        eq(schema.statements.fileChecksum, input.checksum),
      ),
    )
    .orderBy(desc(schema.statements.createdAt))
    .limit(1);
  if (existing && !input.reprocess)
    throw new AuthBoundaryError('CONFLICT', 'This file was already uploaded for this account.');

  const statementId = randomUUID();
  const jobId = randomUUID();
  const storageKey = createRandomStorageKey('statements', 'pdf');
  await storage.put(storageKey, input.bytes, PDF_MEDIA_TYPE);
  try {
    const statement = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(schema.statements)
        .values({
          id: statementId,
          userId,
          financialAccountId: input.accountId,
          sourceType: 'pdf',
          originalFilename: input.filename,
          fileSize: input.size,
          fileChecksum: input.checksum,
          storageKey,
          retainOriginalFile: input.retainOriginalFile,
          duplicateState: existing
            ? existing.processingStatus === 'imported'
              ? 'previously_imported'
              : 'previously_uploaded'
            : 'safe_to_continue',
          uploadIdempotencyKey: input.idempotencyKey,
          processingStatus: 'uploaded',
        })
        .returning();
      if (!created) throw new Error('Database did not return the statement.');
      await tx.insert(schema.importJobs).values({
        id: jobId,
        userId,
        statementId,
        jobType: 'statement.inspect.pdf',
        status: 'queued',
      });
      return created;
    });
    return { duplicate: Boolean(existing), statement: publicStatement(statement), jobId };
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function getOwnedStatement(db: RacioDatabase, userId: string, statementId: string) {
  const [row] = await db
    .select()
    .from(schema.statements)
    .where(ownedStatementWhere(userId, statementId))
    .limit(1);
  if (!row) throw new AuthBoundaryError('NOT_FOUND', 'Import not found.');
  const [job] = await db
    .select({ errorCode: schema.importJobs.errorCode })
    .from(schema.importJobs)
    .where(
      and(eq(schema.importJobs.statementId, statementId), eq(schema.importJobs.userId, userId)),
    )
    .orderBy(desc(schema.importJobs.createdAt))
    .limit(1);
  return { ...publicStatement(row), lastErrorCode: job?.errorCode ?? null };
}

export async function listOwnedImports(db: RacioDatabase, userId: string, accountId: string) {
  const rows = await db
    .select()
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.userId, userId),
        eq(schema.statements.financialAccountId, accountId),
      ),
    )
    .orderBy(desc(schema.statements.createdAt));
  return rows.map(publicStatement);
}

export async function saveImportMapping(
  db: RacioDatabase,
  userId: string,
  statementId: string,
  mapping: ImportMapping,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(schema.statements)
      .where(ownedStatementWhere(userId, statementId))
      .limit(1);
    if (!current) throw new AuthBoundaryError('NOT_FOUND', 'Import not found.');
    const sameMapping = JSON.stringify(current.mappingSnapshot) === JSON.stringify(mapping);
    if (
      sameMapping &&
      ['parsing', 'needs_review', 'ready', 'imported'].includes(current.processingStatus)
    ) {
      const [latest] = await tx
        .select({ id: schema.importJobs.id, status: schema.importJobs.status })
        .from(schema.importJobs)
        .where(
          and(
            eq(schema.importJobs.statementId, statementId),
            eq(schema.importJobs.userId, userId),
            eq(
              schema.importJobs.jobType,
              current.sourceType === 'xlsx'
                ? 'statement.parse.xlsx'
                : current.sourceType === 'pdf'
                  ? 'statement.parse.pdf'
                  : 'statement.parse.csv',
            ),
          ),
        )
        .orderBy(desc(schema.importJobs.createdAt))
        .limit(1);
      return {
        statement: publicStatement(current),
        jobId: latest?.status === 'queued' ? latest.id : null,
      };
    }
    if (current.sourceType === 'xlsx') {
      if (!('sourceType' in mapping) || mapping.sourceType !== 'xlsx')
        throw new AuthBoundaryError('VALIDATION', 'XLSX mapping metadata is required.');
      const selected = current.sourceMetadata as SelectedSheetMetadata | null;
      if (
        !selected ||
        selected.selectedSheetId !== mapping.selectedSheetId ||
        selected.selectedSheetIndex !== mapping.selectedSheetIndex ||
        selected.selectedSheetName !== mapping.selectedSheetName
      )
        throw new AuthBoundaryError('CONFLICT', 'The selected worksheet changed.');
    } else if (current.sourceType === 'pdf') {
      if (!('sourceType' in mapping) || mapping.sourceType !== 'pdf')
        throw new AuthBoundaryError('VALIDATION', 'PDF mapping metadata is required.');
    } else if ('sourceType' in mapping) {
      throw new AuthBoundaryError('VALIDATION', 'CSV mapping metadata is required.');
    }
    const [row] = await tx
      .update(schema.statements)
      .set({ mappingSnapshot: mapping, processingStatus: 'parsing', updatedAt: new Date() })
      .where(
        and(
          ownedStatementWhere(userId, statementId),
          inArray(schema.statements.processingStatus, ['needs_mapping', 'failed']),
        ),
      )
      .returning();
    if (!row) throw new AuthBoundaryError('CONFLICT', 'This import is not waiting for a mapping.');
    const jobId = randomUUID();
    await tx.insert(schema.importJobs).values({
      id: jobId,
      userId,
      statementId,
      jobType:
        current.sourceType === 'xlsx'
          ? 'statement.parse.xlsx'
          : current.sourceType === 'pdf'
            ? 'statement.parse.pdf'
            : 'statement.parse.csv',
      status: 'queued',
    });
    return { statement: publicStatement(row), jobId };
  });
}

export async function selectXlsxSheet(
  db: RacioDatabase,
  userId: string,
  statementId: string,
  input: { sheetId: string; sheetIndex: number; sheetName: string },
  allowHidden: boolean,
) {
  return db.transaction(async (tx) => {
    const [statement] = await tx
      .select()
      .from(schema.statements)
      .where(ownedStatementWhere(userId, statementId))
      .limit(1);
    if (!statement || statement.sourceType !== 'xlsx')
      throw new AuthBoundaryError('NOT_FOUND', 'Workbook import not found.');
    const inspection = parseWorkbookInspection(statement.workbookInspection);
    const sheet = inspection.sheets.find(
      (candidate) =>
        candidate.id === input.sheetId &&
        candidate.index === input.sheetIndex &&
        candidate.name === input.sheetName,
    );
    if (!sheet || !sheet.populatedCells || sheet.veryHidden)
      throw new AuthBoundaryError('VALIDATION', 'The selected worksheet is unavailable.');
    if (sheet.hidden && !allowHidden)
      throw new AuthBoundaryError('VALIDATION', 'Hidden worksheets require advanced mode.');

    const currentSelection = statement.sourceMetadata as SelectedSheetMetadata | null;
    const sameSelection =
      currentSelection?.selectedSheetId === sheet.id &&
      currentSelection.selectedSheetIndex === sheet.index &&
      currentSelection.selectedSheetName === sheet.name;
    if (
      sameSelection &&
      ['parsing', 'needs_mapping', 'needs_review', 'ready', 'imported'].includes(
        statement.processingStatus,
      )
    ) {
      const [latest] = await tx
        .select({ id: schema.importJobs.id, status: schema.importJobs.status })
        .from(schema.importJobs)
        .where(
          and(
            eq(schema.importJobs.statementId, statementId),
            eq(schema.importJobs.userId, userId),
            eq(schema.importJobs.jobType, 'statement.parse.xlsx'),
          ),
        )
        .orderBy(desc(schema.importJobs.createdAt))
        .limit(1);
      return {
        statement: publicStatement(statement),
        jobId: latest?.status === 'queued' ? latest.id : null,
      };
    }
    if (statement.processingStatus !== 'needs_sheet_selection')
      throw new AuthBoundaryError('CONFLICT', 'This workbook is not waiting for a sheet.');

    const selected: SelectedSheetMetadata = {
      sourceType: 'xlsx',
      selectedSheetId: sheet.id,
      selectedSheetName: sheet.name,
      selectedSheetIndex: sheet.index,
      workbookDateSystem: inspection.dateSystem,
    };
    const [updated] = await tx
      .update(schema.statements)
      .set({ sourceMetadata: selected, processingStatus: 'parsing', updatedAt: new Date() })
      .where(
        and(
          ownedStatementWhere(userId, statementId),
          eq(schema.statements.processingStatus, 'needs_sheet_selection'),
        ),
      )
      .returning();
    if (!updated) throw new AuthBoundaryError('CONFLICT', 'The worksheet choice is stale.');
    const jobId = randomUUID();
    await tx.insert(schema.importJobs).values({
      id: jobId,
      userId,
      statementId,
      jobType: 'statement.parse.xlsx',
      status: 'queued',
    });
    return { statement: publicStatement(updated), jobId };
  });
}

export async function getImportReview(db: RacioDatabase, userId: string, statementId: string) {
  await getOwnedStatement(db, userId, statementId);
  return db
    .select()
    .from(schema.rawTransactions)
    .where(
      and(
        eq(schema.rawTransactions.userId, userId),
        eq(schema.rawTransactions.statementId, statementId),
      ),
    )
    .orderBy(asc(schema.rawTransactions.sourceRow));
}

export async function updateRawTransaction(
  db: RacioDatabase,
  userId: string,
  statementId: string,
  rawId: string,
  input: {
    action: 'save' | 'exclude' | 'restore' | 'mark-reviewed';
    bookingDate?: string | null;
    valueDate?: string | null;
    description?: string | null;
    amount?: string | null;
    currency?: string | null;
    direction?: 'credit' | 'debit' | 'unknown';
    balanceAfter?: string | null;
    counterparty?: string | null;
    bankTransactionId?: string | null;
  },
) {
  const [current] = await db
    .select()
    .from(schema.rawTransactions)
    .where(
      and(
        eq(schema.rawTransactions.id, rawId),
        eq(schema.rawTransactions.userId, userId),
        eq(schema.rawTransactions.statementId, statementId),
      ),
    )
    .limit(1);
  if (!current) throw new AuthBoundaryError('NOT_FOUND', 'Imported row not found.');
  if (input.action === 'exclude' || input.action === 'restore') {
    const [row] = await db
      .update(schema.rawTransactions)
      .set({
        reviewStatus: input.action === 'exclude' ? 'excluded' : 'needs_review',
        updatedAt: new Date(),
      })
      .where(eq(schema.rawTransactions.id, rawId))
      .returning();
    const remaining = await db
      .select({ reviewStatus: schema.rawTransactions.reviewStatus })
      .from(schema.rawTransactions)
      .where(eq(schema.rawTransactions.statementId, statementId));
    const ready =
      remaining.length > 0 &&
      remaining.every((item) => item.reviewStatus === 'valid' || item.reviewStatus === 'excluded');
    await db
      .update(schema.statements)
      .set({ processingStatus: ready ? 'ready' : 'needs_review', updatedAt: new Date() })
      .where(eq(schema.statements.id, statementId));
    return row;
  }
  const next = {
    bookingDate: input.bookingDate === undefined ? current.bookingDate : input.bookingDate,
    valueDate: input.valueDate === undefined ? current.valueDate : input.valueDate,
    rawDescription:
      input.description === undefined ? current.rawDescription : (input.description ?? ''),
    amount: input.amount === undefined ? current.amount : input.amount,
    currencyCode: input.currency === undefined ? current.currencyCode : input.currency,
    direction: input.direction === undefined ? current.direction : input.direction,
    balanceAfter: input.balanceAfter === undefined ? current.balanceAfter : input.balanceAfter,
    counterparty: input.counterparty === undefined ? current.counterparty : input.counterparty,
    bankTransactionId:
      input.bankTransactionId === undefined ? current.bankTransactionId : input.bankTransactionId,
  };
  const warnings = validateImportCandidate({
    bookingDate: next.bookingDate,
    description: next.rawDescription,
    amount: next.amount,
    currency: next.currencyCode,
    direction: next.direction,
  });
  const correctionHistory = Array.isArray(current.userCorrections) ? current.userCorrections : [];
  const correctionFields = Object.entries(input)
    .filter(([key, value]) => key !== 'action' && value !== undefined)
    .map(([key, value]) => {
      const previous =
        key === 'description'
          ? current.rawDescription
          : key === 'currency'
            ? current.currencyCode
            : key in current
              ? current[key as keyof typeof current]
              : null;
      return { field: key, previous, corrected: value };
    });
  const [row] = await db
    .update(schema.rawTransactions)
    .set({
      ...next,
      reviewStatus: warnings.length ? 'needs_review' : 'valid',
      warnings,
      userCorrections: [
        ...correctionHistory,
        {
          at: new Date().toISOString(),
          userId,
          fields: correctionFields,
        },
      ],
      duplicateFingerprint: fingerprint({
        bookingDate: next.bookingDate,
        amount: next.amount,
        currency: next.currencyCode,
        direction: next.direction,
        description: next.rawDescription,
      }),
      updatedAt: new Date(),
    })
    .where(eq(schema.rawTransactions.id, rawId))
    .returning();
  const remaining = await db
    .select({ reviewStatus: schema.rawTransactions.reviewStatus })
    .from(schema.rawTransactions)
    .where(eq(schema.rawTransactions.statementId, statementId));
  const ready =
    remaining.length > 0 &&
    remaining.every((item) => item.reviewStatus === 'valid' || item.reviewStatus === 'excluded');
  await db
    .update(schema.statements)
    .set({ processingStatus: ready ? 'ready' : 'needs_review', updatedAt: new Date() })
    .where(eq(schema.statements.id, statementId));
  return row;
}

export async function confirmImport(
  db: RacioDatabase,
  storage: PrivateStorage,
  userId: string,
  statementId: string,
  confirmMismatch: boolean,
  idempotencyKey: string,
) {
  let storageKey: string | null = null;
  let shouldDelete = false;
  const transactionIds: string[] = [];
  const result = await db.transaction(async (tx) => {
    const [statement] = await tx
      .select()
      .from(schema.statements)
      .where(ownedStatementWhere(userId, statementId))
      .limit(1);
    if (!statement) throw new AuthBoundaryError('NOT_FOUND', 'Import not found.');
    if (statement.processingStatus === 'imported') {
      const existing = await tx
        .select({ id: schema.transactions.id })
        .from(schema.transactions)
        .where(
          and(
            eq(schema.transactions.userId, userId),
            eq(schema.transactions.statementId, statementId),
          ),
        );
      return { status: 'imported' as const, count: existing.length };
    }
    if (statement.sourceType === 'xlsx') {
      const selected = statement.sourceMetadata as SelectedSheetMetadata | null;
      const mapping = statement.mappingSnapshot as XlsxMapping | null;
      if (
        !selected ||
        !mapping ||
        mapping.sourceType !== 'xlsx' ||
        selected.selectedSheetId !== mapping.selectedSheetId ||
        selected.selectedSheetIndex !== mapping.selectedSheetIndex ||
        selected.selectedSheetName !== mapping.selectedSheetName
      )
        throw new AuthBoundaryError('CONFLICT', 'Workbook source metadata is incomplete.');
    }
    if (statement.reconciliationStatus === 'mismatch' && !confirmMismatch)
      throw new AuthBoundaryError('CONFLICT', 'Reconciliation requires explicit confirmation.');
    const rows = await tx
      .select()
      .from(schema.rawTransactions)
      .where(
        and(
          eq(schema.rawTransactions.userId, userId),
          eq(schema.rawTransactions.statementId, statementId),
        ),
      )
      .orderBy(asc(schema.rawTransactions.sourceRow));
    const blocked = rows.some((row) =>
      ['needs_review', 'invalid', 'duplicate_candidate'].includes(row.reviewStatus),
    );
    if (blocked)
      throw new AuthBoundaryError('CONFLICT', 'Review all included rows before confirming.');
    const included = rows.filter((row) => row.reviewStatus === 'valid');
    for (const row of included) {
      const transactionId = randomUUID();
      await tx.insert(schema.transactions).values({
        id: transactionId,
        userId,
        financialAccountId: row.financialAccountId,
        statementId: row.statementId,
        sourceRawTransactionId: row.id,
        bookingDate: row.bookingDate!,
        valueDate: row.valueDate,
        amount: row.amount!,
        currencyCode: row.currencyCode!,
        direction: row.direction === 'unknown' ? 'debit' : row.direction,
        balanceAfter: row.balanceAfter,
        rawDescription: row.rawDescription,
        importedDescription: row.rawDescription,
        normalizedDescription: normalizeTransactionDescription(row.rawDescription),
        counterparty: row.counterparty,
        bankTransactionId: row.bankTransactionId,
        sourceType: statement.sourceType,
        duplicateFingerprint: row.duplicateFingerprint,
      });
      transactionIds.push(transactionId);
    }
    const [updated] = await tx
      .update(schema.statements)
      .set({
        processingStatus: 'imported',
        confirmationIdempotencyKey: idempotencyKey,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          ownedStatementWhere(userId, statementId),
          eq(schema.statements.processingStatus, 'ready'),
        ),
      )
      .returning();
    if (!updated)
      throw new AuthBoundaryError('CONFLICT', 'Import changed while it was being confirmed.');
    storageKey = updated.storageKey;
    shouldDelete = !updated.retainOriginalFile;
    return { status: 'imported' as const, count: included.length };
  });
  if (shouldDelete && storageKey) await storage.delete(storageKey).catch(() => undefined);
  if (transactionIds.length) {
    await applyFutureRulesToTransactions(db, userId, transactionIds).catch(() => undefined);
    await applyMerchantAliasesToTransactions(db, userId, transactionIds).catch(() => undefined);
    await suggestInternalTransfers(db, userId, transactionIds).catch(() => undefined);
  }
  return result;
}

async function parserFailureCode(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  return typeof payload?.detail === 'string' &&
    (/^XLSX_[A-Z0-9_]+$/u.test(payload.detail) || /^PDF_[A-Z0-9_]+$/u.test(payload.detail))
    ? payload.detail
    : fallback;
}

async function markImportJobFailed(
  db: RacioDatabase,
  statementId: string,
  jobId: string,
  errorCode: string,
  message: string,
) {
  await db
    .update(schema.importJobs)
    .set({
      status: 'failed',
      errorCode,
      errorMessageSafe: message,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'failed', updatedAt: new Date() })
    .where(eq(schema.statements.id, statementId));
}

export async function processXlsxInspectionJob(
  db: RacioDatabase,
  storage: PrivateStorage,
  parserUrl: string,
  jobId: string,
  timeoutMs: number,
) {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  if (!job || job.jobType !== 'statement.inspect.xlsx') return null;
  if (job.status === 'running') return null;
  if (job.status === 'completed') {
    const [existing] = await db
      .select({ id: schema.importJobs.id })
      .from(schema.importJobs)
      .where(
        and(
          eq(schema.importJobs.statementId, job.statementId),
          eq(schema.importJobs.jobType, 'statement.parse.xlsx'),
          eq(schema.importJobs.status, 'queued'),
        ),
      )
      .orderBy(desc(schema.importJobs.createdAt))
      .limit(1);
    return existing?.id ?? null;
  }
  const [statement] = await db
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.id, job.statementId), eq(schema.statements.userId, job.userId)))
    .limit(1);
  if (!statement || statement.sourceType !== 'xlsx' || statement.processingStatus === 'imported')
    return null;
  await db
    .update(schema.importJobs)
    .set({
      status: 'running',
      attempt: job.attempt + 1,
      startedAt: new Date(),
      errorCode: null,
      errorMessageSafe: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'inspecting', updatedAt: new Date() })
    .where(eq(schema.statements.id, statement.id));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!statement.storageKey) throw new Error('storage_key_missing');
    const bytes = await storage.get(statement.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MEDIA_TYPE }),
      statement.originalFilename,
    );
    const response = await fetch(`${parserUrl.replace(/\/$/u, '')}/inspect/xlsx`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parserFailureCode(response, 'XLSX_INSPECTION_FAILED'));
    const inspection = parseWorkbookInspection(await response.json());
    const selectable = inspection.sheets.filter(
      (sheet) => !sheet.veryHidden && sheet.populatedCells > 0,
    );
    const usable = inspection.sheets.filter(
      (sheet) => !sheet.hidden && !sheet.veryHidden && sheet.populatedCells > 0,
    );
    if (!selectable.length) throw new Error('XLSX_NO_USABLE_SHEET');
    return await db.transaction(async (tx) => {
      let parseJobId: string | null = null;
      let sourceMetadata: SelectedSheetMetadata | null = null;
      let status: 'parsing' | 'needs_sheet_selection' = 'needs_sheet_selection';
      if (usable.length === 1 && usable[0]) {
        const sheet = usable[0];
        sourceMetadata = {
          sourceType: 'xlsx',
          selectedSheetId: sheet.id,
          selectedSheetName: sheet.name,
          selectedSheetIndex: sheet.index,
          workbookDateSystem: inspection.dateSystem,
        };
        status = 'parsing';
        parseJobId = randomUUID();
        await tx.insert(schema.importJobs).values({
          id: parseJobId,
          userId: statement.userId,
          statementId: statement.id,
          jobType: 'statement.parse.xlsx',
          status: 'queued',
        });
      }
      await tx
        .update(schema.statements)
        .set({
          workbookInspection: inspection,
          sourceMetadata,
          processingStatus: status,
          updatedAt: new Date(),
        })
        .where(eq(schema.statements.id, statement.id));
      await tx
        .update(schema.importJobs)
        .set({
          status: 'completed',
          parserVersion: inspection.contractVersion,
          warningCount: inspection.workbookWarnings.length,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.importJobs.id, jobId));
      return parseJobId;
    });
  } catch (error) {
    const code =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'XLSX_PARSER_TIMEOUT'
        : error instanceof Error && /^XLSX_[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : 'XLSX_INSPECTION_FAILED';
    await markImportJobFailed(
      db,
      statement.id,
      jobId,
      code,
      'The workbook could not be inspected.',
    );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function processPdfInspectionJob(
  db: RacioDatabase,
  storage: PrivateStorage,
  parserUrl: string,
  jobId: string,
  timeoutMs: number,
) {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  if (!job || job.jobType !== 'statement.inspect.pdf') return null;
  if (job.status === 'running') return null;
  if (job.status === 'completed') {
    const [existing] = await db
      .select({ id: schema.importJobs.id })
      .from(schema.importJobs)
      .where(
        and(
          eq(schema.importJobs.statementId, job.statementId),
          eq(schema.importJobs.jobType, 'statement.parse.pdf'),
          eq(schema.importJobs.status, 'queued'),
        ),
      )
      .orderBy(desc(schema.importJobs.createdAt))
      .limit(1);
    return existing?.id ?? null;
  }
  const [statement] = await db
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.id, job.statementId), eq(schema.statements.userId, job.userId)))
    .limit(1);
  if (!statement || statement.sourceType !== 'pdf' || statement.processingStatus === 'imported')
    return null;
  await db
    .update(schema.importJobs)
    .set({
      status: 'running',
      attempt: job.attempt + 1,
      startedAt: new Date(),
      errorCode: null,
      errorMessageSafe: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'inspecting', updatedAt: new Date() })
    .where(eq(schema.statements.id, statement.id));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!statement.storageKey) throw new Error('storage_key_missing');
    const bytes = await storage.get(statement.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: PDF_MEDIA_TYPE }),
      statement.originalFilename,
    );
    const response = await fetch(`${parserUrl.replace(/\/$/u, '')}/inspect/pdf`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parserFailureCode(response, 'PDF_INSPECTION_FAILED'));
    const inspection = parsePdfInspection(await response.json());
    if (!inspection.hasUsableText)
      throw new Error(inspection.likelyImageOnly ? 'PDF_NO_USABLE_TEXT' : 'PDF_NO_USABLE_TEXT');
    return await db.transaction(async (tx) => {
      const parseJobId = randomUUID();
      await tx.insert(schema.importJobs).values({
        id: parseJobId,
        userId: statement.userId,
        statementId: statement.id,
        jobType: 'statement.parse.pdf',
        status: 'queued',
      });
      await tx
        .update(schema.statements)
        .set({
          pdfInspection: inspection,
          processingStatus: 'parsing',
          updatedAt: new Date(),
        })
        .where(eq(schema.statements.id, statement.id));
      await tx
        .update(schema.importJobs)
        .set({
          status: 'completed',
          parserVersion: inspection.contractVersion,
          warningCount: inspection.documentWarnings.length,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.importJobs.id, jobId));
      return parseJobId;
    });
  } catch (error) {
    const code =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF_PARSER_TIMEOUT'
        : error instanceof Error && /^PDF_[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : 'PDF_INSPECTION_FAILED';
    await markImportJobFailed(db, statement.id, jobId, code, 'The PDF could not be inspected.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function processPdfParseJob(
  db: RacioDatabase,
  storage: PrivateStorage,
  parserUrl: string,
  jobId: string,
  timeoutMs: number,
) {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  if (!job || job.jobType !== 'statement.parse.pdf') return;
  if (job.status === 'running' || job.status === 'completed') return;
  const [statement] = await db
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.id, job.statementId), eq(schema.statements.userId, job.userId)))
    .limit(1);
  if (!statement || statement.sourceType !== 'pdf' || statement.processingStatus === 'imported')
    return;
  await db
    .update(schema.importJobs)
    .set({
      status: 'running',
      attempt: job.attempt + 1,
      startedAt: new Date(),
      errorCode: null,
      errorMessageSafe: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'parsing', updatedAt: new Date() })
    .where(eq(schema.statements.id, statement.id));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!statement.storageKey) throw new Error('storage_key_missing');
    const bytes = await storage.get(statement.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: PDF_MEDIA_TYPE }),
      statement.originalFilename,
    );
    if (
      statement.mappingSnapshot &&
      typeof statement.mappingSnapshot === 'object' &&
      'sourceType' in statement.mappingSnapshot
    )
      form.append('mapping', JSON.stringify(statement.mappingSnapshot));
    const response = await fetch(`${parserUrl.replace(/\/$/u, '')}/parse/pdf`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parserFailureCode(response, 'PDF_PARSE_FAILED'));
    const parsed = parsePdfParserResult(await response.json());
    await persistParserResult(db, statement, jobId, parsed);
  } catch (error) {
    const code =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'PDF_PARSER_TIMEOUT'
        : error instanceof Error && /^PDF_[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : 'PDF_PARSE_FAILED';
    await markImportJobFailed(db, statement.id, jobId, code, 'The PDF could not be parsed.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function processCsvParseJob(
  db: RacioDatabase,
  storage: PrivateStorage,
  parserUrl: string,
  jobId: string,
  timeoutMs: number,
) {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  if (!job) return;
  if (job.status === 'running' || job.status === 'completed') return;
  const [statement] = await db
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.id, job.statementId), eq(schema.statements.userId, job.userId)))
    .limit(1);
  if (!statement || statement.processingStatus === 'imported') return;
  await db
    .update(schema.importJobs)
    .set({
      status: 'running',
      attempt: job.attempt + 1,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'parsing', updatedAt: new Date() })
    .where(eq(schema.statements.id, statement.id));
  try {
    if (!statement.storageKey) throw new Error('storage_key_missing');
    const bytes = await storage.get(statement.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: CSV_MEDIA_TYPE }),
      statement.originalFilename,
    );
    if (statement.mappingSnapshot)
      form.append('mapping', JSON.stringify(statement.mappingSnapshot));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`${parserUrl.replace(/\/$/u, '')}/parse/csv`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!response.ok) throw new Error('parser_rejected');
    const parsed = parseParserResultV2(await response.json());
    await persistParserResult(db, statement, jobId, parsed);
  } catch (error) {
    await db
      .update(schema.importJobs)
      .set({
        status: 'failed',
        errorCode: 'CSV_PARSE_FAILED',
        errorMessageSafe: 'The CSV could not be parsed.',
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.importJobs.id, jobId));
    await db
      .update(schema.statements)
      .set({ processingStatus: 'failed', updatedAt: new Date() })
      .where(eq(schema.statements.id, statement.id));
    throw error;
  }
}

export async function processXlsxParseJob(
  db: RacioDatabase,
  storage: PrivateStorage,
  parserUrl: string,
  jobId: string,
  timeoutMs: number,
) {
  const [job] = await db
    .select()
    .from(schema.importJobs)
    .where(eq(schema.importJobs.id, jobId))
    .limit(1);
  if (!job || job.jobType !== 'statement.parse.xlsx') return;
  if (job.status === 'running' || job.status === 'completed') return;
  const [statement] = await db
    .select()
    .from(schema.statements)
    .where(and(eq(schema.statements.id, job.statementId), eq(schema.statements.userId, job.userId)))
    .limit(1);
  if (!statement || statement.sourceType !== 'xlsx' || statement.processingStatus === 'imported')
    return;
  const selected = statement.sourceMetadata as SelectedSheetMetadata | null;
  if (!selected) {
    await markImportJobFailed(
      db,
      statement.id,
      jobId,
      'XLSX_STALE_SHEET_SELECTION',
      'The selected worksheet is unavailable.',
    );
    return;
  }
  await db
    .update(schema.importJobs)
    .set({
      status: 'running',
      attempt: job.attempt + 1,
      startedAt: new Date(),
      errorCode: null,
      errorMessageSafe: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.importJobs.id, jobId));
  await db
    .update(schema.statements)
    .set({ processingStatus: 'parsing', updatedAt: new Date() })
    .where(eq(schema.statements.id, statement.id));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!statement.storageKey) throw new Error('storage_key_missing');
    const bytes = await storage.get(statement.storageKey);
    const form = new FormData();
    form.append(
      'file',
      new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MEDIA_TYPE }),
      statement.originalFilename,
    );
    form.append('sheet_index', String(selected.selectedSheetIndex));
    if (
      statement.mappingSnapshot &&
      typeof statement.mappingSnapshot === 'object' &&
      'sourceType' in statement.mappingSnapshot
    )
      form.append('mapping', JSON.stringify(statement.mappingSnapshot));
    const response = await fetch(`${parserUrl.replace(/\/$/u, '')}/parse/xlsx`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(await parserFailureCode(response, 'XLSX_PARSE_FAILED'));
    const parsed = parseXlsxParserResult(await response.json());
    await persistParserResult(db, statement, jobId, parsed);
  } catch (error) {
    const code =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'XLSX_PARSER_TIMEOUT'
        : error instanceof Error && /^XLSX_[A-Z0-9_]+$/u.test(error.message)
          ? error.message
          : 'XLSX_PARSE_FAILED';
    await markImportJobFailed(db, statement.id, jobId, code, 'The workbook could not be parsed.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function cleanupAbandonedImports(
  db: RacioDatabase,
  storage: PrivateStorage,
  retentionHours: number,
  now = new Date(),
) {
  const cutoff = new Date(now.getTime() - retentionHours * 60 * 60 * 1_000);
  const abandoned = await db
    .select({
      id: schema.statements.id,
      storageKey: schema.statements.storageKey,
    })
    .from(schema.statements)
    .where(
      and(
        eq(schema.statements.retainOriginalFile, false),
        ne(schema.statements.processingStatus, 'imported'),
        isNotNull(schema.statements.storageKey),
        lt(schema.statements.updatedAt, cutoff),
      ),
    );
  let cleaned = 0;
  for (const statement of abandoned) {
    if (!statement.storageKey) continue;
    const [claimed] = await db
      .update(schema.statements)
      .set({
        processingStatus: 'failed',
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.statements.id, statement.id),
          ne(schema.statements.processingStatus, 'imported'),
          eq(schema.statements.retainOriginalFile, false),
          eq(schema.statements.storageKey, statement.storageKey),
          lt(schema.statements.updatedAt, cutoff),
        ),
      )
      .returning({ id: schema.statements.id });
    if (!claimed) continue;
    try {
      await storage.delete(statement.storageKey);
    } catch {
      continue;
    }
    const [updated] = await db
      .update(schema.statements)
      .set({ storageKey: null })
      .where(
        and(
          eq(schema.statements.id, statement.id),
          eq(schema.statements.storageKey, statement.storageKey),
        ),
      )
      .returning({ id: schema.statements.id });
    if (updated) cleaned += 1;
  }
  return cleaned;
}

async function persistParserResult(
  db: RacioDatabase,
  statement: typeof schema.statements.$inferSelect,
  jobId: string,
  parsed: ParserResultV2 | XlsxParserResult | PdfParserResult,
) {
  const xlsx =
    'sourceType' in parsed.source && parsed.source.sourceType === 'xlsx'
      ? (parsed as XlsxParserResult)
      : null;
  const pdf =
    'sourceType' in parsed.source && parsed.source.sourceType === 'pdf'
      ? (parsed as PdfParserResult)
      : null;
  if (parsed.mapping.status === 'ambiguous' || parsed.mapping.status === 'invalid') {
    await db
      .update(schema.statements)
      .set({
        processingStatus: 'needs_mapping',
        mappingSnapshot: parsed.mapping.columns,
        detectedLanguage: parsed.source.detectedLanguage,
        sourceMetadata: xlsx
          ? {
              sourceType: 'xlsx',
              selectedSheetId: xlsx.mapping.columns.selectedSheetId,
              selectedSheetName: xlsx.source.sheetName,
              selectedSheetIndex: xlsx.source.sheetIndex,
              workbookDateSystem: xlsx.source.workbookDateSystem,
            }
          : statement.sourceMetadata,
        updatedAt: new Date(),
      })
      .where(eq(schema.statements.id, statement.id));
    await db
      .update(schema.importJobs)
      .set({
        status: 'completed',
        parserVersion: parsed.contractVersion,
        candidateCount: 0,
        warningCount: parsed.warnings.length,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.importJobs.id, jobId));
    return;
  }
  const [account] = await db
    .select({ currencyCode: schema.financialAccounts.currencyCode })
    .from(schema.financialAccounts)
    .where(eq(schema.financialAccounts.id, statement.financialAccountId))
    .limit(1);
  const balances = parsed.candidates.filter((candidate) => candidate.balanceAfter !== null);
  const bookingDates = parsed.candidates
    .map((candidate) => candidate.bookingDate)
    .filter((value): value is string => value !== null)
    .sort();
  let reconciliation: ReturnType<typeof reconcileStatement> = {
    status: 'unverifiable',
    difference: null,
    expectedClosing: null,
    reason: 'missing_balance',
  };
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;
  const pdfMetadata = pdf?.metadata;
  if (
    (pdfMetadata?.openingBalance !== null && pdfMetadata?.openingBalance !== undefined) ||
    (pdfMetadata?.closingBalance !== null && pdfMetadata?.closingBalance !== undefined)
  ) {
    openingBalance = pdfMetadata?.openingBalance ?? null;
    closingBalance = pdfMetadata?.closingBalance ?? null;
  }
  if (
    balances.length &&
    parsed.candidates.every(
      (candidate) => candidate.amount !== null && candidate.direction !== 'unknown',
    )
  ) {
    try {
      let credits = 0n;
      let debits = 0n;
      for (const candidate of parsed.candidates) {
        const amount = decimalToScaledInteger(candidate.amount ?? '0');
        if (candidate.direction === 'credit') credits += amount;
        if (candidate.direction === 'debit') debits += amount;
      }
      const first = balances[0];
      if (!first) throw new Error('missing_first_balance');
      const firstSigned =
        decimalToScaledInteger(first.amount ?? '0') * (first.direction === 'debit' ? -1n : 1n);
      const derivedOpening = decimalToScaledInteger(first.balanceAfter ?? '0') - firstSigned;
      const lastBalance = balances[balances.length - 1]?.balanceAfter ?? '0';
      if (openingBalance === null) openingBalance = scaledIntegerToDecimal(derivedOpening);
      if (closingBalance === null)
        closingBalance = scaledIntegerToDecimal(decimalToScaledInteger(lastBalance));
      reconciliation = reconcileStatement({
        openingBalance,
        closingBalance,
        credits: scaledIntegerToDecimal(credits),
        debits: scaledIntegerToDecimal(debits),
        tolerance: MINIMUM_MONEY_UNIT,
      });
    } catch {
      reconciliation = {
        status: 'unverifiable',
        difference: null,
        expectedClosing: null,
        reason: 'invalid_balance_values',
      };
    }
  }
  const [previousFinal, previousRaw] = await Promise.all([
    db
      .select({ duplicateFingerprint: schema.transactions.duplicateFingerprint })
      .from(schema.transactions)
      .where(eq(schema.transactions.userId, statement.userId)),
    db
      .select({ duplicateFingerprint: schema.rawTransactions.duplicateFingerprint })
      .from(schema.rawTransactions)
      .where(
        and(
          eq(schema.rawTransactions.userId, statement.userId),
          ne(schema.rawTransactions.statementId, statement.id),
        ),
      ),
  ]);
  const existingFingerprints = new Set(
    [...previousFinal, ...previousRaw]
      .map((row) => row.duplicateFingerprint)
      .filter((value): value is string => Boolean(value)),
  );
  const seenFingerprints = new Set<string>();
  let allRowsValid = parsed.candidates.length > 0;
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.rawTransactions)
      .where(eq(schema.rawTransactions.statementId, statement.id));
    for (const candidate of parsed.candidates) {
      const currency = candidate.currency ?? account?.currencyCode ?? null;
      const rawDescription =
        'description' in candidate && (candidate as { description: string | null }).description
          ? (candidate as { description: string | null }).description
          : candidate.rawDescription;
      const descriptionForStorage = rawDescription ?? '';
      const warnings = [
        ...new Set([
          ...candidate.warnings,
          ...validateImportCandidate({
            bookingDate: candidate.bookingDate,
            description: descriptionForStorage,
            amount: candidate.amount,
            currency,
            direction: candidate.direction,
          }),
        ]),
      ];
      const reviewStatus = warnings.length ? 'needs_review' : 'valid';
      const rowFingerprint = fingerprint({
        bookingDate: candidate.bookingDate,
        amount: candidate.amount,
        currency,
        direction: candidate.direction,
        description: descriptionForStorage,
      });
      const duplicateInStatement = seenFingerprints.has(rowFingerprint);
      const duplicateInHistory = existingFingerprints.has(rowFingerprint);
      const isDuplicate = duplicateInStatement || duplicateInHistory;
      seenFingerprints.add(rowFingerprint);
      if (warnings.length || isDuplicate) allRowsValid = false;
      await tx.insert(schema.rawTransactions).values({
        id: randomUUID(),
        userId: statement.userId,
        statementId: statement.id,
        financialAccountId: statement.financialAccountId,
        sourceRow: candidate.sourceRow,
        rawPayload:
          'rawCells' in candidate && xlsx
            ? {
                values: candidate.rawPayload,
                workbook: {
                  sheetName: xlsx.source.sheetName,
                  sheetIndex: xlsx.source.sheetIndex,
                  sourceRow: candidate.sourceRow,
                  cells: candidate.rawCells,
                },
              }
            : 'rawLines' in candidate && pdf
              ? {
                  values: candidate.rawPayload,
                  pdf: {
                    sourcePage: (candidate as { sourcePage: number }).sourcePage,
                    rawLines: (candidate as { rawLines: string[] }).rawLines,
                    boundingBox: (candidate as { boundingBox: unknown }).boundingBox,
                    parserStrategy: (candidate as { parserStrategy: string | null }).parserStrategy,
                  },
                }
              : candidate.rawPayload,
        rawDescription: descriptionForStorage,
        rawBookingDate: candidate.rawBookingDate,
        rawValueDate: candidate.rawValueDate,
        rawAmount: candidate.rawAmount,
        rawCurrency: candidate.rawCurrency,
        rawBalance: candidate.rawBalance,
        bookingDate: candidate.bookingDate,
        valueDate: candidate.valueDate,
        amount: candidate.amount,
        currencyCode: currency,
        direction: candidate.direction,
        balanceAfter: candidate.balanceAfter,
        counterparty: candidate.counterparty,
        bankTransactionId: candidate.bankTransactionId,
        confidence: String(candidate.confidence),
        fieldConfidence: candidate.fieldConfidence,
        warnings,
        reviewStatus: isDuplicate ? 'duplicate_candidate' : reviewStatus,
        duplicateFingerprint: rowFingerprint,
        duplicateStatus: isDuplicate ? 'probable' : 'none',
        duplicateMatchReasons: isDuplicate
          ? [duplicateInStatement ? 'same_statement_fingerprint' : 'previous_import_fingerprint']
          : null,
      });
    }
    const periodStart = pdfMetadata?.periodStart ?? bookingDates[0] ?? null;
    const periodEnd = pdfMetadata?.periodEnd ?? bookingDates[bookingDates.length - 1] ?? null;
    await tx
      .update(schema.statements)
      .set({
        processingStatus: parsed.candidates.length
          ? allRowsValid
            ? 'ready'
            : 'needs_review'
          : 'failed',
        mappingSnapshot: parsed.mapping.columns,
        detectedLanguage: parsed.source.detectedLanguage,
        sourceMetadata: xlsx
          ? {
              sourceType: 'xlsx',
              selectedSheetId: xlsx.mapping.columns.selectedSheetId,
              selectedSheetName: xlsx.source.sheetName,
              selectedSheetIndex: xlsx.source.sheetIndex,
              workbookDateSystem: xlsx.source.workbookDateSystem,
              headerRow: xlsx.source.headerRow,
              firstDataRow: xlsx.source.firstDataRow,
              lastDataRow: xlsx.source.lastDataRow,
              formulaCellCount: xlsx.source.formulaCellCount,
              mergedRangeCount: xlsx.source.mergedRangeCount,
            }
          : statement.sourceMetadata,
        currencyCode: pdfMetadata?.currency ?? account?.currencyCode ?? null,
        periodStart,
        periodEnd,
        openingBalance,
        closingBalance,
        reconciliationStatus: reconciliation.status,
        reconciliationExpectedClosing: reconciliation.expectedClosing,
        reconciliationDifference: reconciliation.difference,
        reconciliationReason: reconciliation.reason,
        reconciliationStatedClosing: balances.length
          ? (balances[balances.length - 1]?.balanceAfter ?? null)
          : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.statements.id, statement.id));
    await tx
      .update(schema.importJobs)
      .set({
        status: 'completed',
        parserVersion: parsed.contractVersion,
        rowCount: parsed.candidates.length,
        candidateCount: parsed.candidates.length,
        warningCount: parsed.warnings.length,
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.importJobs.id, jobId));
  });
}
