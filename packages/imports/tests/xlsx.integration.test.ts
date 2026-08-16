import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import type { PrivateStorage } from '@racio/storage';
import {
  cleanupAbandonedImports,
  confirmImport,
  createCsvImport,
  createXlsxImport,
  getImportReview,
  getOwnedStatement,
  processXlsxInspectionJob,
  processXlsxParseJob,
  selectXlsxSheet,
  updateRawTransaction,
} from '../src/index';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const runParserIntegration = process.env.RACIO_RUN_PARSER_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;
const parserTest = runParserIntegration ? it : it.skip;
const checksum = (value: string) => createHash('sha256').update(value).digest('hex');

class MemoryPrivateStorage implements PrivateStorage {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, content: Uint8Array, contentType: string) {
    this.objects.set(key, content);
    return { key, contentType, size: content.byteLength };
  }

  async putChunks(key: string, chunks: AsyncIterable<Uint8Array>, contentType: string) {
    const parts: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of chunks) {
      parts.push(chunk);
      size += chunk.byteLength;
    }
    const content = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      content.set(part, offset);
      offset += part.byteLength;
    }
    this.objects.set(key, content);
    return { key, contentType, size };
  }

  async get(key: string) {
    const content = this.objects.get(key);
    if (!content) throw new Error('Private object not found.');
    return content;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(prefix: string) {
    return [...this.objects.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => ({ key, modifiedAt: new Date() }));
  }
}

suite('XLSX import ownership and idempotency integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const storage = new MemoryPrivateStorage();
  const userA = `phase7-user-a-${randomUUID()}`;
  const userB = `phase7-user-b-${randomUUID()}`;
  const institutionA = `phase7-institution-${randomUUID()}`;
  const accountA = `phase7-account-${randomUUID()}`;
  let statementId = '';
  let storageKey = '';

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const now = new Date();
    await db.insert(schema.user).values([
      {
        id: userA,
        name: 'Phase 7 A',
        email: `${userA}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: 'Phase 7 B',
        email: `${userB}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.institutions).values({
      id: institutionA,
      userId: userA,
      name: 'Synthetic Phase 7 Bank',
      normalizedName: 'synthetic phase 7 bank',
      countryCode: 'TR',
    });
    await db.insert(schema.financialAccounts).values({
      id: accountA,
      userId: userA,
      institutionId: institutionA,
      displayName: 'Synthetic account',
      accountType: 'checking',
      currencyCode: 'TRY',
      maskedAccountIdentifier: '•••• 7007',
    });
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, userA));
    await db.delete(schema.user).where(eq(schema.user.id, userB));
    await client.end();
  });

  it('derives account ownership and keeps upload idempotent', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    await expect(
      createXlsxImport(db, storage, userB, {
        accountId: accountA,
        filename: 'statement.xlsx',
        size: bytes.byteLength,
        checksum: checksum('cross-user'),
        bytes,
        retainOriginalFile: false,
        reprocess: false,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const idempotencyKey = randomUUID();
    const created = await createXlsxImport(db, storage, userA, {
      accountId: accountA,
      filename: 'statement.xlsx',
      size: bytes.byteLength,
      checksum: checksum(`phase7-${randomUUID()}`),
      bytes,
      retainOriginalFile: false,
      reprocess: false,
      idempotencyKey,
    });
    statementId = created.statement.id;
    const [stored] = await db
      .select({ storageKey: schema.statements.storageKey })
      .from(schema.statements)
      .where(eq(schema.statements.id, statementId));
    storageKey = stored?.storageKey ?? '';
    expect(storageKey).toMatch(/\.xlsx$/u);
    expect(storage.objects.has(storageKey)).toBe(true);

    const retry = await createXlsxImport(db, storage, userA, {
      accountId: accountA,
      filename: 'statement.xlsx',
      size: bytes.byteLength,
      checksum: checksum(`unused-${randomUUID()}`),
      bytes,
      retainOriginalFile: false,
      reprocess: false,
      idempotencyKey,
    });
    expect(retry.statement.id).toBe(statementId);
    const statementCounts = await db
      .select({ value: count() })
      .from(schema.statements)
      .where(eq(schema.statements.id, statementId));
    expect(statementCounts[0]?.value).toBe(1);
  });

  it('isolates inspection, selection, review, and confirmation between users', async () => {
    await db
      .update(schema.statements)
      .set({
        processingStatus: 'needs_sheet_selection',
        workbookInspection: {
          contractVersion: 'racio.workbook-inspection.v1',
          workbookType: 'xlsx',
          sheetCount: 2,
          dateSystem: '1900',
          workbookWarnings: [],
          sheets: [
            {
              id: 'sheet-0',
              name: 'Transactions',
              index: 0,
              hidden: false,
              veryHidden: false,
              estimatedRows: 3,
              estimatedColumns: 4,
              populatedCells: 12,
              mergedRangeCount: 0,
              formulaCellCount: 0,
              sampleRows: [['Date', 'Description', 'Amount', 'Currency']],
              warnings: [],
            },
            {
              id: 'sheet-1',
              name: 'Hidden',
              index: 1,
              hidden: true,
              veryHidden: false,
              estimatedRows: 2,
              estimatedColumns: 2,
              populatedCells: 4,
              mergedRangeCount: 0,
              formulaCellCount: 0,
              sampleRows: [['Private', 'Sample']],
              warnings: ['hidden_sheet'],
            },
          ],
        },
      })
      .where(eq(schema.statements.id, statementId));

    await expect(getOwnedStatement(db, userB, statementId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      selectXlsxSheet(
        db,
        userB,
        statementId,
        { sheetId: 'sheet-0', sheetIndex: 0, sheetName: 'Transactions' },
        false,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const selected = await selectXlsxSheet(
      db,
      userA,
      statementId,
      { sheetId: 'sheet-0', sheetIndex: 0, sheetName: 'Transactions' },
      false,
    );
    const retry = await selectXlsxSheet(
      db,
      userA,
      statementId,
      { sheetId: 'sheet-0', sheetIndex: 0, sheetName: 'Transactions' },
      false,
    );
    expect(retry.jobId).toBe(selected.jobId);
    const parseJobCounts = await db
      .select({ value: count() })
      .from(schema.importJobs)
      .where(eq(schema.importJobs.statementId, statementId));
    expect(parseJobCounts[0]?.value).toBe(2);

    await db
      .update(schema.statements)
      .set({
        processingStatus: 'ready',
        mappingSnapshot: {
          sourceType: 'xlsx',
          selectedSheetId: 'sheet-0',
          selectedSheetName: 'Transactions',
          selectedSheetIndex: 0,
          headerRow: 1,
          firstDataRow: 2,
          lastDataRow: 2,
          bookingDate: 0,
          valueDate: null,
          description: 1,
          amount: 2,
          debit: null,
          credit: null,
          currency: 3,
          balance: null,
          counterparty: null,
          transactionIdentifier: null,
          decimalSeparator: '.',
          thousandsSeparator: null,
          dateFormat: null,
        },
        reconciliationStatus: 'matched',
      })
      .where(eq(schema.statements.id, statementId));
    const rawId = randomUUID();
    await db.insert(schema.rawTransactions).values({
      id: rawId,
      userId: userA,
      statementId,
      financialAccountId: accountA,
      sourceRow: 2,
      rawPayload: {
        values: {
          Date: '2026-07-01',
          Description: 'Synthetic purchase',
          Amount: '-12.340000',
          Currency: 'TRY',
        },
        workbook: {
          sheetName: 'Transactions',
          sheetIndex: 0,
          sourceRow: 2,
          cells: [{ coordinate: 'C2', rawType: 'number', rawValue: '-12.340000' }],
        },
      },
      rawDescription: 'Synthetic purchase',
      rawBookingDate: '2026-07-01',
      rawAmount: '-12.340000',
      rawCurrency: 'TRY',
      bookingDate: '2026-07-01',
      amount: '12.340000',
      currencyCode: 'TRY',
      direction: 'debit',
      confidence: '1',
      warnings: [],
      reviewStatus: 'valid',
      duplicateFingerprint: `phase7-${rawId}`,
      duplicateStatus: 'none',
    });

    await expect(getImportReview(db, userB, statementId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      confirmImport(db, storage, userB, statementId, false, randomUUID()),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const first = await confirmImport(db, storage, userA, statementId, false, randomUUID());
    const second = await confirmImport(db, storage, userA, statementId, false, randomUUID());
    expect(first).toEqual({ status: 'imported', count: 1 });
    expect(second).toEqual(first);
    const transactionCounts = await db
      .select({ value: count() })
      .from(schema.transactions)
      .where(eq(schema.transactions.statementId, statementId));
    expect(transactionCounts[0]?.value).toBe(1);
    expect(storage.objects.has(storageKey)).toBe(false);

    const [transaction] = await db
      .select({ sourceType: schema.transactions.sourceType })
      .from(schema.transactions)
      .where(eq(schema.transactions.statementId, statementId));
    expect(transaction?.sourceType).toBe('xlsx');
  });

  it('keeps CSV and XLSX statements in the shared tables', async () => {
    const csv = await createCsvImport(db, storage, userA, {
      accountId: accountA,
      filename: 'statement.csv',
      size: 20,
      checksum: checksum(`csv-${randomUUID()}`),
      bytes: new TextEncoder().encode('date,amount\n2026-07-01,1'),
      retainOriginalFile: true,
      reprocess: false,
      idempotencyKey: randomUUID(),
    });
    const rows = await db
      .select({ sourceType: schema.statements.sourceType })
      .from(schema.statements)
      .where(eq(schema.statements.userId, userA));
    expect(rows.map((row) => row.sourceType)).toEqual(expect.arrayContaining(['csv', 'xlsx']));
    expect(csv.statement.sourceType).toBe('csv');
    const [storedCsv] = await db
      .select({ storageKey: schema.statements.storageKey })
      .from(schema.statements)
      .where(eq(schema.statements.id, csv.statement.id));
    await db
      .update(schema.statements)
      .set({
        retainOriginalFile: false,
        updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      })
      .where(eq(schema.statements.id, csv.statement.id));
    expect(
      await cleanupAbandonedImports(db, storage, 24, new Date('2026-07-27T00:00:00.000Z')),
    ).toBe(1);
    expect(storage.objects.has(storedCsv?.storageKey ?? '')).toBe(false);
  });

  parserTest(
    'runs a real workbook through inspection, review, confirmation, and aliases',
    async () => {
      const workbook = readFileSync(
        new URL('../../../fixtures/statements/xlsx/english-one-sheet.xlsx', import.meta.url),
      );
      const created = await createXlsxImport(db, storage, userA, {
        accountId: accountA,
        filename: 'english-one-sheet.xlsx',
        size: workbook.byteLength,
        checksum: createHash('sha256').update(workbook).digest('hex'),
        bytes: workbook,
        retainOriginalFile: false,
        reprocess: false,
        idempotencyKey: randomUUID(),
      });
      if (!created.jobId) throw new Error('Expected a queued XLSX inspection job.');
      const parserUrl = process.env.PARSER_URL ?? 'http://127.0.0.1:8001';
      const parseJobId = await processXlsxInspectionJob(
        db,
        storage,
        parserUrl,
        created.jobId,
        30_000,
      );
      expect(parseJobId).toBeTruthy();
      await processXlsxParseJob(db, storage, parserUrl, parseJobId!, 30_000);

      const parsed = await getImportReview(db, userA, created.statement.id);
      expect(parsed.length).toBeGreaterThanOrEqual(4);
      expect(
        parsed.some(
          (row) => (row.rawPayload as { workbook?: { cells?: unknown[] } }).workbook?.cells?.length,
        ),
      ).toBe(true);
      for (const row of parsed) {
        if (row.reviewStatus !== 'valid') {
          await updateRawTransaction(db, userA, created.statement.id, row.id, {
            action: 'exclude',
          });
        }
      }

      const merchantId = `phase7-merchant-${randomUUID()}`;
      await db.insert(schema.merchants).values({
        id: merchantId,
        userId: userA,
        displayName: 'Neighbourhood Market',
        normalizedName: `neighbourhood market ${randomUUID()}`,
      });
      await db.insert(schema.merchantAliases).values({
        id: `phase7-alias-${randomUUID()}`,
        userId: userA,
        merchantId,
        rawPattern: 'Neighbourhood market',
        normalizedPattern: 'neighbourhood market',
        matchType: 'exact_normalized_description',
        priority: 1,
      });

      const result = await confirmImport(
        db,
        storage,
        userA,
        created.statement.id,
        true,
        randomUUID(),
      );
      expect(result.status).toBe('imported');
      expect(result.count).toBeGreaterThanOrEqual(2);
      const imported = await db
        .select({ merchantId: schema.transactions.merchantId })
        .from(schema.transactions)
        .where(eq(schema.transactions.statementId, created.statement.id));
      expect(imported.some((row) => row.merchantId === merchantId)).toBe(true);
      const importedRawRows = await db
        .select({ rawPayload: schema.rawTransactions.rawPayload })
        .from(schema.rawTransactions)
        .where(eq(schema.rawTransactions.statementId, created.statement.id));
      expect(
        importedRawRows.some(
          (row) =>
            (row.rawPayload as { workbook?: { sheetName?: string } }).workbook?.sheetName ===
            'Statement',
        ),
      ).toBe(true);

      const beforeRetry = parsed.length;
      await processXlsxParseJob(db, storage, parserUrl, parseJobId!, 30_000);
      const afterRetry = await getImportReview(db, userA, created.statement.id);
      expect(afterRetry).toHaveLength(beforeRetry);
    },
  );
});
