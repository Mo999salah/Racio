// Import application service: session-bound callers supply the authenticated user id.
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import type { CsvMapping, ParserResultV2 } from '@racio/contracts';
import { parseParserResultV2 } from '@racio/contracts';
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
  const storageKey = createRandomStorageKey();
  await storage.put(storageKey, input.bytes, CSV_MEDIA_TYPE);
  try {
    const [statement] = await db
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
    if (!statement) throw new Error('Database did not return the statement.');
    await db.insert(schema.importJobs).values({
      id: jobId,
      userId,
      statementId,
      jobType: 'statement.parse.csv',
      status: 'queued',
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
  return publicStatement(row);
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
  mapping: CsvMapping,
) {
  const [row] = await db
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
  await db
    .update(schema.importJobs)
    .set({ status: 'queued', errorCode: null, errorMessageSafe: null, updatedAt: new Date() })
    .where(
      and(eq(schema.importJobs.statementId, statementId), eq(schema.importJobs.userId, userId)),
    );
  return publicStatement(row);
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
  const [row] = await db
    .update(schema.rawTransactions)
    .set({
      ...next,
      reviewStatus: warnings.length && input.action !== 'mark-reviewed' ? 'needs_review' : 'valid',
      warnings,
      userCorrections: [
        ...correctionHistory,
        {
          at: new Date().toISOString(),
          userId,
          fields: Object.keys(input).filter((key) => key !== 'action'),
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
    if (statement.processingStatus === 'imported') return { status: 'imported' as const, count: 0 };
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

async function persistParserResult(
  db: RacioDatabase,
  statement: typeof schema.statements.$inferSelect,
  jobId: string,
  parsed: ParserResultV2,
) {
  if (parsed.mapping.status === 'ambiguous' || parsed.mapping.status === 'invalid') {
    await db
      .update(schema.statements)
      .set({
        processingStatus: 'needs_mapping',
        mappingSnapshot: parsed.mapping.columns,
        detectedLanguage: parsed.source.detectedLanguage,
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
  let reconciliation: ReturnType<typeof reconcileStatement> = {
    status: 'unverifiable',
    difference: null,
    expectedClosing: null,
    reason: 'missing_balance',
  };
  let openingBalance: string | null = null;
  let closingBalance: string | null = null;
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
      const opening = decimalToScaledInteger(first.balanceAfter ?? '0') - firstSigned;
      const lastBalance = balances[balances.length - 1]?.balanceAfter ?? '0';
      openingBalance = scaledIntegerToDecimal(opening);
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
  await db.transaction(async (tx) => {
    await tx
      .delete(schema.rawTransactions)
      .where(eq(schema.rawTransactions.statementId, statement.id));
    for (const candidate of parsed.candidates) {
      const currency = candidate.currency ?? account?.currencyCode ?? null;
      const warnings = validateImportCandidate({
        bookingDate: candidate.bookingDate,
        description: candidate.rawDescription,
        amount: candidate.amount,
        currency,
        direction: candidate.direction,
      });
      const reviewStatus = warnings.length ? 'needs_review' : 'valid';
      const rowFingerprint = fingerprint({
        bookingDate: candidate.bookingDate,
        amount: candidate.amount,
        currency,
        direction: candidate.direction,
        description: candidate.rawDescription,
      });
      const isDuplicate =
        seenFingerprints.has(rowFingerprint) || existingFingerprints.has(rowFingerprint);
      seenFingerprints.add(rowFingerprint);
      await tx.insert(schema.rawTransactions).values({
        id: randomUUID(),
        userId: statement.userId,
        statementId: statement.id,
        financialAccountId: statement.financialAccountId,
        sourceRow: candidate.sourceRow,
        rawPayload: candidate.rawPayload,
        rawDescription: candidate.rawDescription,
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
          ? [
              seenFingerprints.has(rowFingerprint)
                ? 'same_statement_fingerprint'
                : 'previous_import_fingerprint',
            ]
          : null,
      });
    }
    await tx
      .update(schema.statements)
      .set({
        processingStatus: parsed.candidates.length ? 'needs_review' : 'failed',
        detectedLanguage: parsed.source.detectedLanguage,
        currencyCode: account?.currencyCode ?? null,
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
