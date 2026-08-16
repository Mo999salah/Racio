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
  createPdfImport,
  getImportReview,
  getOwnedStatement,
  processPdfInspectionJob,
  processPdfParseJob,
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

suite('PDF import ownership and idempotency integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const storage = new MemoryPrivateStorage();
  const userA = `phase8-user-a-${randomUUID()}`;
  const userB = `phase8-user-b-${randomUUID()}`;
  const institutionA = `phase8-institution-${randomUUID()}`;
  const accountA = `phase8-account-${randomUUID()}`;
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
        name: 'Phase 8 A',
        email: `${userA}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: 'Phase 8 B',
        email: `${userB}@example.test`,
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(schema.institutions).values({
      id: institutionA,
      userId: userA,
      name: 'Synthetic Phase 8 Bank',
      normalizedName: 'synthetic phase 8 bank',
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
    const bytes = new TextEncoder().encode('%PDF-1.4\n%%EOF');
    await expect(
      createPdfImport(db, storage, userB, {
        accountId: accountA,
        filename: 'statement.pdf',
        size: bytes.byteLength,
        checksum: checksum('cross-user'),
        bytes,
        retainOriginalFile: false,
        reprocess: false,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const idempotencyKey = randomUUID();
    const created = await createPdfImport(db, storage, userA, {
      accountId: accountA,
      filename: 'statement.pdf',
      size: bytes.byteLength,
      checksum: checksum(`phase8-${randomUUID()}`),
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
    expect(storageKey).toMatch(/\.pdf$/u);
    expect(storage.objects.has(storageKey)).toBe(true);

    const retry = await createPdfImport(db, storage, userA, {
      accountId: accountA,
      filename: 'statement.pdf',
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

  it('isolates inspection, review, and confirmation between users', async () => {
    await db
      .update(schema.statements)
      .set({
        processingStatus: 'parsing',
        pdfInspection: {
          contractVersion: 'racio.pdf-inspection.v1',
          sourceType: 'pdf',
          pageCount: 1,
          encrypted: false,
          hasUsableText: true,
          likelyImageOnly: false,
          textUsability: 'usable',
          textCharacterCount: 200,
          documentWarnings: [],
          pages: [
            {
              pageNumber: 1,
              width: 595,
              height: 842,
              textCharacterCount: 200,
              wordCount: 30,
              imageCount: 0,
              likelyTable: true,
              sampleLines: ['01/07/2026 Description 12.34 1,234.56'],
              warnings: [],
            },
          ],
        },
      })
      .where(eq(schema.statements.id, statementId));

    await expect(getOwnedStatement(db, userB, statementId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    await db
      .update(schema.statements)
      .set({
        processingStatus: 'ready',
        mappingSnapshot: {
          sourceType: 'pdf',
          pageCount: 1,
          sourcePages: [1],
          headerLabels: ['Date', 'Description', 'Amount', 'Balance'],
          columnBands: [
            { label: 'Date', x0: 50, x1: 120 },
            { label: 'Description', x0: 120, x1: 420 },
            { label: 'Amount', x0: 420, x1: 490 },
            { label: 'Balance', x0: 490, x1: 560 },
          ],
          amountColumnMode: 'signed',
          lineGroupingStrategy: 'single_line',
          hasYear: true,
          decimalSeparator: '.',
          thousandsSeparator: null,
          dateFormat: 'DD/MM/YYYY',
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
      sourceRow: 1,
      rawPayload: {
        values: {
          date: '01/07/2026',
          amount: '12.34',
          balance: '1234.56',
        },
        pdf: {
          sourcePage: 1,
          rawLines: ['01/07/2026 Description 12.34 1,234.56'],
          boundingBox: { x0: 50, top: 100, x1: 560, bottom: 120 },
          parserStrategy: 'layout_bands',
        },
      },
      rawDescription: 'Description',
      rawBookingDate: '01/07/2026',
      rawAmount: '12.34',
      bookingDate: '2026-07-01',
      amount: '12.340000',
      currencyCode: 'TRY',
      direction: 'credit',
      confidence: '1',
      warnings: [],
      reviewStatus: 'valid',
      duplicateFingerprint: `phase8-${rawId}`,
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
    expect(transaction?.sourceType).toBe('pdf');
  });

  it('keeps CSV and PDF statements in the shared tables', async () => {
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
    expect(rows.map((row) => row.sourceType)).toEqual(expect.arrayContaining(['csv', 'pdf']));
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

  parserTest('runs a real PDF through inspection, review, confirmation, and aliases', async () => {
    const pdf = readFileSync(
      new URL('../../../fixtures/statements/pdf/english-statement.pdf', import.meta.url),
    );
    const created = await createPdfImport(db, storage, userA, {
      accountId: accountA,
      filename: 'english-statement.pdf',
      size: pdf.byteLength,
      checksum: createHash('sha256').update(pdf).digest('hex'),
      bytes: pdf,
      retainOriginalFile: false,
      reprocess: false,
      idempotencyKey: randomUUID(),
    });
    if (!created.jobId) throw new Error('Expected a queued PDF inspection job.');
    const parserUrl = process.env.PARSER_URL ?? 'http://127.0.0.1:8001';
    const parseJobId = await processPdfInspectionJob(db, storage, parserUrl, created.jobId, 30_000);
    expect(parseJobId).toBeTruthy();
    await processPdfParseJob(db, storage, parserUrl, parseJobId!, 30_000);

    const parsed = await getImportReview(db, userA, created.statement.id);
    expect(parsed.length).toBeGreaterThanOrEqual(4);
    expect(
      parsed.some(
        (row) => (row.rawPayload as { pdf?: { sourcePage?: number } }).pdf?.sourcePage === 1,
      ),
    ).toBe(true);
    for (const row of parsed) {
      await updateRawTransaction(db, userA, created.statement.id, row.id, {
        action: 'mark-reviewed',
      });
    }

    const merchantId = `phase8-merchant-${randomUUID()}`;
    await db.insert(schema.merchants).values({
      id: merchantId,
      userId: userA,
      displayName: 'Grocery Store',
      normalizedName: `grocery store ${randomUUID()}`,
    });
    await db.insert(schema.merchantAliases).values({
      id: `phase8-alias-${randomUUID()}`,
      userId: userA,
      merchantId,
      rawPattern: 'GROCERY STORE',
      normalizedPattern: 'grocery store',
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

    const beforeRetry = parsed.length;
    await processPdfParseJob(db, storage, parserUrl, parseJobId!, 30_000);
    const afterRetry = await getImportReview(db, userA, created.statement.id);
    expect(afterRetry).toHaveLength(beforeRetry);
  });
});
