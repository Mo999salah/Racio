import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import { createLocalPrivateStorage, type PrivateStorage } from '@racio/storage';
import { DEFAULT_EXPORT_LIMITS, type ExportLimits } from '../src/limits';
import {
  cleanupExpiredExports,
  createExportRequest,
  deleteExport,
  downloadExport,
  generateExportFile,
  listExports,
} from '../src/service';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5433/racio';

let database: RacioDatabase;
let storage: PrivateStorage;
let storageRoot: string;
let userIds: string[] = [];
const sourceRowCounters = new Map<string, number>();

const smallLimits: ExportLimits = {
  ...DEFAULT_EXPORT_LIMITS,
  syncMaxRows: 5,
  maxConcurrentPerUser: 2,
};

async function createUser(db: RacioDatabase, slug: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(schema.user).values({
    id,
    name: 'Export',
    email: `${slug}-${id.slice(0, 8)}@example.test`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userPreferences).values({
    userId: id,
    locale: 'en',
    timeZone: 'Europe/Istanbul',
    interfaceMode: 'easy',
    appearance: 'system',
  });
  return id;
}

async function createAccount(
  db: RacioDatabase,
  userId: string,
  name: string,
  currency = 'TRY',
): Promise<{ institutionId: string; accountId: string; statementId: string }> {
  const now = new Date();
  const institutionId = crypto.randomUUID();
  await db.insert(schema.institutions).values({
    id: institutionId,
    userId,
    name,
    normalizedName: name.toLowerCase(),
    countryCode: 'TR',
    createdAt: now,
    updatedAt: now,
  });
  const accountId = crypto.randomUUID();
  await db.insert(schema.financialAccounts).values({
    id: accountId,
    userId,
    institutionId,
    displayName: `${name} Checking`,
    accountType: 'checking',
    currencyCode: currency,
    maskedAccountIdentifier: '••••1234',
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
    fileChecksum: 'b'.repeat(64),
    uploadIdempotencyKey: crypto.randomUUID(),
    processingStatus: 'imported',
    createdAt: now,
    updatedAt: now,
  });
  return { institutionId, accountId, statementId };
}

async function createTransaction(
  db: RacioDatabase,
  userId: string,
  input: {
    accountId: string;
    statementId: string;
    bookingDate: string;
    amount: string;
    currency?: string;
    direction: 'credit' | 'debit';
    description: string;
    reviewed?: boolean;
    note?: string;
    createdAt?: Date;
  },
): Promise<string> {
  const now = input.createdAt ?? new Date();
  const rawId = crypto.randomUUID();
  const sourceRow = (sourceRowCounters.get(input.statementId) ?? 0) + 1;
  sourceRowCounters.set(input.statementId, sourceRow);
  await db.insert(schema.rawTransactions).values({
    id: rawId,
    userId,
    statementId: input.statementId,
    financialAccountId: input.accountId,
    sourceRow,
    rawPayload: {},
    rawDescription: input.description,
    bookingDate: input.bookingDate,
    amount: input.amount,
    currencyCode: input.currency ?? 'TRY',
    direction: input.direction,
    reviewStatus: 'valid',
    duplicateStatus: 'none',
    createdAt: now,
    updatedAt: now,
  });
  const id = crypto.randomUUID();
  await db.insert(schema.transactions).values({
    id,
    userId,
    financialAccountId: input.accountId,
    statementId: input.statementId,
    sourceRawTransactionId: rawId,
    bookingDate: input.bookingDate,
    amount: input.amount,
    currencyCode: input.currency ?? 'TRY',
    direction: input.direction,
    rawDescription: input.description,
    importedDescription: input.description,
    normalizedDescription: input.description.toLowerCase(),
    userNote: input.note ?? null,
    reviewed: input.reviewed ?? false,
    sourceType: 'csv',
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedLedger(db: RacioDatabase, userId: string) {
  const { accountId, statementId, institutionId } = await createAccount(db, userId, 'Bank A');
  const now = new Date();
  const tx1 = await createTransaction(db, userId, {
    accountId,
    statementId,
    bookingDate: '2026-01-05',
    amount: '1234.567890',
    direction: 'debit',
    description: 'Market',
    reviewed: true,
    note: 'private note',
    createdAt: new Date(now.getTime() + 1),
  });
  const tx2 = await createTransaction(db, userId, {
    accountId,
    statementId,
    bookingDate: '2026-01-10',
    amount: '5000',
    direction: 'credit',
    description: 'Salary',
    createdAt: new Date(now.getTime() + 2),
  });
  const tx3 = await createTransaction(db, userId, {
    accountId,
    statementId,
    bookingDate: '2026-02-01',
    amount: '99.99',
    direction: 'debit',
    description: 'Bills',
    createdAt: new Date(now.getTime() + 3),
  });

  const groceriesId = crypto.randomUUID();
  await db.insert(schema.categories).values({
    id: groceriesId,
    userId,
    name: 'Groceries',
    normalizedName: 'groceries',
    kind: 'expense',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.transactionCategoryAssignments).values({
    id: crypto.randomUUID(),
    userId,
    transactionId: tx1,
    categoryId: groceriesId,
    role: 'primary',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  });
  const tagId = crypto.randomUUID();
  await db.insert(schema.tags).values({
    id: tagId,
    userId,
    name: 'weekly',
    normalizedName: 'weekly',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.transactionTags).values({
    id: crypto.randomUUID(),
    userId,
    transactionId: tx1,
    tagId,
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  });

  // Split on tx1: one active allocation, one archived version.
  const activeSplitId = crypto.randomUUID();
  await db.insert(schema.transactionSplits).values({
    id: activeSplitId,
    userId,
    transactionId: tx1,
    position: 0,
    amount: '600',
    currencyCode: 'TRY',
    description: 'Part A',
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  const archivedSplitId = crypto.randomUUID();
  await db.insert(schema.transactionSplits).values({
    id: archivedSplitId,
    userId,
    transactionId: tx1,
    position: 1,
    amount: '634.567890',
    currencyCode: 'TRY',
    description: 'Old version',
    archivedAt: new Date(now.getTime() + 10),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.transactionSplitCategoryAssignments).values({
    id: crypto.randomUUID(),
    userId,
    splitId: activeSplitId,
    categoryId: groceriesId,
    role: 'primary',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
  });

  // Confirmed internal transfer: tx2 (credit) linked to a debit in another account.
  const { accountId: accountB, statementId: statementB } = await createAccount(
    db,
    userId,
    'Bank B',
    'TRY',
  );
  const tx4 = await createTransaction(db, userId, {
    accountId: accountB,
    statementId: statementB,
    bookingDate: '2026-01-10',
    amount: '5000',
    direction: 'debit',
    description: 'Transfer out',
    createdAt: new Date(now.getTime() + 4),
  });
  await db.insert(schema.internalTransferLinks).values({
    id: crypto.randomUUID(),
    userId,
    outgoingTransactionId: tx4,
    incomingTransactionId: tx2,
    status: 'confirmed',
    source: 'system',
    matchScore: 100,
    matchReasons: ['exact_amount'],
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // USD transaction to test currency filtering.
  const { accountId: accountC, statementId: statementC } = await createAccount(
    db,
    userId,
    'Bank C',
    'USD',
  );
  await createTransaction(db, userId, {
    accountId: accountC,
    statementId: statementC,
    bookingDate: '2026-01-12',
    amount: '250.50',
    currency: 'USD',
    direction: 'debit',
    description: 'Online',
    createdAt: new Date(now.getTime() + 5),
  });

  // Saved view with a date filter.
  const viewId = crypto.randomUUID();
  await db.insert(schema.savedViews).values({
    id: viewId,
    userId,
    name: 'January',
    version: 1,
    filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31' },
    sort: { field: 'bookingDate', direction: 'asc' },
    columnPreferences: [],
    isDefault: false,
    createdAt: now,
    updatedAt: now,
  });

  // Budgets, goals, alerts, advisor conversation.
  await db.insert(schema.budgets).values({
    id: crypto.randomUUID(),
    userId,
    name: 'Monthly',
    currency: 'TRY',
    amount: '10000',
    periodType: 'monthly',
    warningThreshold: 80,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.savingsGoals).values({
    id: crypto.randomUUID(),
    userId,
    name: 'Trip',
    currency: 'TRY',
    targetAmount: '50000',
    trackingMode: 'manual',
    manualSavedAmount: '10000',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.alertRules).values({
    id: crypto.randomUUID(),
    userId,
    type: 'uncategorized_transactions',
    enabled: true,
    config: { threshold: 5 },
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.alertEvents).values({
    id: crypto.randomUUID(),
    userId,
    type: 'budget_exceeded',
    entityType: 'budget',
    entityId: 'budget-1',
    dedupeKey: 'budget:b1:2026-01:exceeded',
    metadata: { threshold: 80 },
    triggeredAt: now,
  });
  const threadId = crypto.randomUUID();
  await db.insert(schema.advisorThreads).values({
    id: threadId,
    userId,
    title: 'Question',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.advisorMessages).values({
    id: crypto.randomUUID(),
    userId,
    threadId,
    role: 'user',
    content: 'How much did I spend?',
    createdAt: now,
  });
  await db.insert(schema.advisorMessages).values({
    id: crypto.randomUUID(),
    userId,
    threadId,
    role: 'assistant',
    content: 'You spent 1334.557890 TRY.',
    createdAt: new Date(now.getTime() + 1),
  });

  return { tx1, tx2, tx3, tx4, groceriesId, tagId, viewId, accountId, accountB, statementId };
}

beforeAll(async () => {
  if (!runIntegration) return;
  const client = createDatabase(databaseUrl);
  database = client.db;
  storageRoot = await mkdtemp(join(tmpdir(), 'racio-export-int-'));
  storage = createLocalPrivateStorage({ rootDirectory: storageRoot });
});

afterAll(async () => {
  if (!runIntegration) return;
  await database.delete(schema.exports).where(eq(schema.exports.userId, 'dummy'));
  await rm(storageRoot, { recursive: true, force: true });
});

suite('export integration (real PostgreSQL)', () => {
  it('exports all owned transactions as CSV with exact values and stable ordering', async () => {
    const userId = await createUser(database, 'user-a@example.test');
    userIds.push(userId);
    const { tx1, tx2, tx4 } = await seedLedger(database, userId);
    void tx4;
    const { record, requiresJob } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    // 5 transactions are within the sync threshold, so the request completes inline.
    expect(requiresJob).toBe(false);
    expect(record.status).toBe('ready');
    expect(record.rowCount).toBe(5);

    const file = await downloadExport(
      database,
      storage,
      userId,
      record.id,
      new Date('2026-08-16T10:00:00Z'),
    );
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes);
    expect(text.startsWith('\uFEFF')).toBe(true);
    expect(text).toContain(
      'booking_date,value_date,description,imported_description,amount_exact,currency',
    );
    expect(text).toContain('2026-01-05,,Market,Market,1234.567890,TRY,debit');
    expect(text).toContain('2026-01-10,,Salary,Salary,5000.000000,TRY,credit');
    const lines = text.trim().split('\r\n').slice(1);
    expect(lines.map((line) => line.split(',')[0])).toEqual([
      '2026-01-05',
      '2026-01-10',
      '2026-01-10',
      '2026-01-12',
      '2026-02-01',
    ]);
    const salaryLine = lines.find((line) => line.includes('Salary'))!;
    expect(salaryLine).toContain('confirmed');
    const marketLine = lines.find((line) => line.startsWith('2026-01-05,'))!;
    expect(marketLine.split(',')[17]).toBe('true');
    expect(marketLine.split(',')[18]).toBe('1');
    expect(text).not.toContain('private note');
    expect(text).not.toContain('password');
    expect(text).not.toContain('storage_key');
  });

  it('includes notes only when explicitly opted in', async () => {
    const userId = await createUser(database, 'user-notes@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: true },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const file = await downloadExport(
      database,
      storage,
      userId,
      record.id,
      new Date('2026-08-16T10:00:00Z'),
    );
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain('private note');
    expect(text.split('\r\n')[0]!.split(',').at(-1)).toBe('note');
  });

  it('supports date, account, category, currency, and saved-view filters', async () => {
    const userId = await createUser(database, 'user-filter@example.test');
    userIds.push(userId);
    const { tx1, tx2, tx3, tx4, groceriesId, viewId, accountId } = await seedLedger(
      database,
      userId,
    );
    void tx1;
    void tx2;
    void tx3;
    void tx4;

    const byDate = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_csv',
        filters: { dateFrom: '2026-01-01', dateTo: '2026-01-31', includeArchived: 'false' },
        includeNotes: false,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(byDate.record.rowCount).toBe(4);

    const byAccount = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_csv',
        filters: { accountId, includeArchived: 'false' },
        includeNotes: false,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(byAccount.record.rowCount).toBe(3);

    const byCategory = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_csv',
        filters: { primaryCategoryId: groceriesId, includeArchived: 'false' },
        includeNotes: false,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(byCategory.record.rowCount).toBe(1);
    const byCategoryFile = await downloadExport(
      database,
      storage,
      userId,
      byCategory.record.id,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(new TextDecoder().decode(byCategoryFile.bytes)).toContain('Groceries');

    const byCurrency = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_csv',
        filters: { currency: 'USD', includeArchived: 'false' },
        includeNotes: false,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(byCurrency.record.rowCount).toBe(1);

    const byView = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_csv',
        filters: { savedViewId: viewId, includeArchived: 'false' },
        includeNotes: false,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(byView.record.rowCount).toBe(4);
  });

  it('exports XLSX with transactions, splits sheet, and no formulas', async () => {
    const userId = await createUser(database, 'user-xlsx@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const { record } = await createExportRequest(
      database,
      userId,
      {
        type: 'transactions_xlsx',
        filters: { includeArchived: 'false' },
        includeNotes: false,
        includeSplits: true,
      },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const file = await downloadExport(
      database,
      storage,
      userId,
      record.id,
      new Date('2026-08-16T10:00:00Z'),
    );
    const files = unzipSync(file.bytes);
    expect(files['xl/workbook.xml']).toBeTruthy();
    const workbook = new TextDecoder().decode(files['xl/workbook.xml']!);
    expect(workbook).toContain('name="Transactions"');
    expect(workbook).toContain('name="Splits"');
    expect(workbook).toContain('name="Metadata"');
    const sheet = new TextDecoder().decode(files['xl/worksheets/sheet1.xml']!);
    expect(sheet).toContain('1234.567890');
    expect(sheet).not.toContain('<f>');
    const splitsSheet = new TextDecoder().decode(files['xl/worksheets/sheet2.xml']!);
    expect(splitsSheet).toContain('600');
    expect(splitsSheet).not.toContain('Old version');
  });

  it('runs asynchronously above the sync threshold and finalizes through the worker', async () => {
    const userId = await createUser(database, 'user-async@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1 };
    const { record, requiresJob } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(requiresJob).toBe(true);
    expect(record.status).toBe('preparing');

    const row = await generateExportFile(
      database,
      storage,
      record.id,
      lowSync,
      new Date('2026-08-16T10:01:00Z'),
    );
    expect(row?.status).toBe('ready');
    expect(row?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    expect(row?.sizeBytes).toBeGreaterThan(0);
    expect(row?.expiresAt).not.toBeNull();

    const file = await downloadExport(
      database,
      storage,
      userId,
      record.id,
      new Date('2026-08-16T10:01:00Z'),
    );
    expect(file.bytes.byteLength).toBe(row?.sizeBytes);
    const text = new TextDecoder().decode(file.bytes);
    expect(text.split('\r\n').length).toBe(7); // header + 5 rows + trailing line ending
  });

  it('is idempotent on worker retry and produces a single artifact', async () => {
    const userId = await createUser(database, 'user-retry@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const first = await generateExportFile(
      database,
      storage,
      record.id,
      lowSync,
      new Date('2026-08-16T10:01:00Z'),
    );
    const second = await generateExportFile(
      database,
      storage,
      record.id,
      lowSync,
      new Date('2026-08-16T10:02:00Z'),
    );
    expect(second?.status).toBe('ready');
    expect(second?.storageKey).toBe(first?.storageKey);
    expect(second?.checksum).toBe(first?.checksum);
    const files = await readdir(join(storageRoot, 'exports'));
    expect(files.filter((name) => name.startsWith(record.id)).length).toBe(0); // random attempt keys
    expect(files.length).toBeGreaterThanOrEqual(1);
    const artifacts = files.filter((name) => name.endsWith('.csv'));
    const referenced = artifacts.filter((name) => name.includes(first!.storageKey!.split('/')[1]!));
    expect(referenced.length).toBe(1);
  });

  it('recovers after a worker failure and rejects stale preparing exports via cleanup', async () => {
    const userId = await createUser(database, 'user-fail@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const brokenStorage: PrivateStorage = {
      put: async () => {
        throw new Error('disk full');
      },
      putChunks: async () => {
        throw new Error('disk full');
      },
      get: async () => {
        throw new Error('gone');
      },
      delete: async () => undefined,
      list: async () => [],
    };
    await expect(
      generateExportFile(
        database,
        brokenStorage,
        record.id,
        lowSync,
        new Date('2026-08-16T10:01:00Z'),
      ),
    ).rejects.toThrow('disk full');
    const rowAfterFailure = await generateExportFile(
      database,
      storage,
      record.id,
      lowSync,
      new Date('2026-08-16T10:02:00Z'),
    );
    expect(rowAfterFailure?.status).toBe('ready');
  });

  it('enforces concurrent export limits and row limits', async () => {
    const userId = await createUser(database, 'user-busy@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1, maxConcurrentPerUser: 1 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(record.status).toBe('preparing');
    await expect(
      createExportRequest(
        database,
        userId,
        { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
        lowSync,
        storage,
        new Date('2026-08-16T10:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'EXPORT_BUSY' });
    const tinyLimits: ExportLimits = { ...smallLimits, maxRows: 2 };
    await expect(
      createExportRequest(
        database,
        userId,
        { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
        tinyLimits,
        storage,
        new Date('2026-08-16T10:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'EXPORT_TOO_MANY_ROWS' });
  });

  it('expires exports, blocks expired downloads, and cleans up files', async () => {
    const userId = await createUser(database, 'user-expire@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const zeroRetention: ExportLimits = { ...smallLimits, retentionHours: 0 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      zeroRetention,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const past = new Date('2026-08-16T11:00:00Z');
    const cleanup = await cleanupExpiredExports(database, storage, zeroRetention, past);
    expect(cleanup.expired).toBeGreaterThanOrEqual(1);
    await expect(downloadExport(database, storage, userId, record.id, past)).rejects.toMatchObject({
      code: 'EXPORT_EXPIRED',
    });
  });

  it('marks stale preparing exports as failed', async () => {
    const userId = await createUser(database, 'user-stale@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const late = new Date('2026-08-16T14:00:00Z');
    const result = await cleanupExpiredExports(database, storage, lowSync, late);
    expect(result.stale).toBeGreaterThanOrEqual(1);
    await expect(downloadExport(database, storage, userId, record.id, late)).rejects.toMatchObject({
      code: 'EXPORT_FAILED',
    });
  });

  it('supports deletion, including deletion while the worker runs', async () => {
    const userId = await createUser(database, 'user-delete@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const lowSync: ExportLimits = { ...smallLimits, syncMaxRows: 1 };
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const completed = await generateExportFile(
      database,
      storage,
      record.id,
      lowSync,
      new Date('2026-08-16T10:01:00Z'),
    );
    expect(completed?.storageKey).toBeTruthy();
    await deleteExport(database, storage, userId, record.id);
    await expect(
      downloadExport(database, storage, userId, record.id, new Date('2026-08-16T10:02:00Z')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Delete while still preparing; a later worker finalize must not resurrect it.
    const { record: second } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      lowSync,
      storage,
      new Date('2026-08-16T10:03:00Z'),
    );
    await deleteExport(database, storage, userId, second.id);
    const row = await generateExportFile(
      database,
      storage,
      second.id,
      lowSync,
      new Date('2026-08-16T10:04:00Z'),
    );
    expect(row).toBeNull();
    const leftovers = await readdir(join(storageRoot, 'exports'));
    expect(leftovers.filter((name) => name.startsWith(second.id)).length).toBe(0);
  });

  it('builds a user-only archive without advisor data by default and with it on opt-in', async () => {
    const userId = await createUser(database, 'user-archive@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const { record, requiresJob } = await createExportRequest(
      database,
      userId,
      { type: 'account_archive', includeNotes: false, includeAdvisorConversations: false },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    expect(requiresJob).toBe(true);
    const row = await generateExportFile(
      database,
      storage,
      record.id,
      smallLimits,
      new Date('2026-08-16T10:01:00Z'),
    );
    expect(row?.status).toBe('ready');
    const file = await downloadExport(
      database,
      storage,
      userId,
      record.id,
      new Date('2026-08-16T10:01:00Z'),
    );
    const files = unzipSync(file.bytes);
    const manifest = JSON.parse(new TextDecoder().decode(files['racio-export/manifest.json']!));
    expect(manifest.formatVersion).toBe('1');
    expect(manifest.application).toBe('Racio');
    expect(manifest.includedResources).toContain('transactions');
    expect(manifest.includedResources).toContain('transfer-links');
    expect(manifest.includedResources).toContain('budgets');
    expect(manifest.includedResources).toContain('goals');
    expect(manifest.includedResources).toContain('alerts');
    expect(manifest.includedResources).toContain('preferences');
    expect(files['racio-export/advisor.json']).toBeUndefined();
    const transactions = JSON.parse(
      new TextDecoder().decode(files['racio-export/transactions.json']!),
    );
    expect(transactions.records.length).toBe(5);
    const amounts = transactions.records.map((row: { amount_exact: string }) => row.amount_exact);
    expect(amounts).toContain('1234.567890');
    const transfers = JSON.parse(
      new TextDecoder().decode(files['racio-export/transfer-links.json']!),
    );
    expect(transfers.records.some((row: { status: string }) => row.status === 'confirmed')).toBe(
      true,
    );
    const alerts = JSON.parse(new TextDecoder().decode(files['racio-export/alerts.json']!));
    expect(alerts.records.length).toBe(2); // one rule + one event
    const event = alerts.records.find((row: { type?: string }) => row.type === 'budget_exceeded');
    expect(event.type).toBe('budget_exceeded');
    expect(event.entityType).toBe('budget');
    expect(event.metadata).toEqual({ threshold: 80 });
    expect(event.triggeredAt).toBeTruthy();
    const allText = Object.values(files)
      .map((value) => new TextDecoder().decode(value))
      .join('\n');
    expect(allText.toLowerCase()).not.toContain('password');
    expect(allText.toLowerCase()).not.toContain('session_token');
    expect(allText.toLowerCase()).not.toContain('storage_key');
    expect(allText).not.toContain('How much did I spend?');

    // Opt-in archive includes only user-visible conversation content.
    const opted = await createExportRequest(
      database,
      userId,
      { type: 'account_archive', includeNotes: false, includeAdvisorConversations: true },
      smallLimits,
      storage,
      new Date('2026-08-16T10:02:00Z'),
    );
    const optedRow = await generateExportFile(
      database,
      storage,
      opted.record.id,
      smallLimits,
      new Date('2026-08-16T10:03:00Z'),
    );
    const optedFile = await downloadExport(
      database,
      storage,
      userId,
      opted.record.id,
      new Date('2026-08-16T10:03:00Z'),
    );
    const optedZip = unzipSync(optedFile.bytes);
    const advisor = JSON.parse(new TextDecoder().decode(optedZip['racio-export/advisor.json']!));
    expect(advisor.records[0].messages.map((m: { content: string }) => m.content)).toEqual([
      'How much did I spend?',
      'You spent 1334.557890 TRY.',
    ]);
  });

  it('isolates ownership across two users', async () => {
    const userA = await createUser(database, 'owner-a@example.test');
    const userB = await createUser(database, 'owner-b@example.test');
    userIds.push(userA, userB);
    const { accountId, viewId } = await seedLedger(database, userA);
    await seedLedger(database, userB);

    await expect(
      createExportRequest(
        database,
        userB,
        {
          type: 'transactions_csv',
          filters: { accountId, includeArchived: 'false' },
          includeNotes: false,
        },
        smallLimits,
        storage,
        new Date('2026-08-16T10:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      createExportRequest(
        database,
        userB,
        {
          type: 'transactions_csv',
          filters: { savedViewId: viewId, includeArchived: 'false' },
          includeNotes: false,
        },
        smallLimits,
        storage,
        new Date('2026-08-16T10:00:00Z'),
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const aExport = await createExportRequest(
      database,
      userA,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    await expect(
      downloadExport(database, storage, userB, aExport.record.id, new Date('2026-08-16T10:01:00Z')),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(deleteExport(database, storage, userB, aExport.record.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const bList = await listExports(database, userB, new Date('2026-08-16T10:01:00Z'));
    expect(bList.some((item) => item.id === aExport.record.id)).toBe(false);
  });

  it('maps storage failures to a stable error on download', async () => {
    const userId = await createUser(database, 'user-storage@example.test');
    userIds.push(userId);
    await seedLedger(database, userId);
    const { record } = await createExportRequest(
      database,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      smallLimits,
      storage,
      new Date('2026-08-16T10:00:00Z'),
    );
    const brokenStorage: PrivateStorage = {
      put: async () => {
        throw new Error('unused');
      },
      putChunks: async () => {
        throw new Error('unused');
      },
      get: async () => {
        throw new Error('object gone');
      },
      delete: async () => undefined,
      list: async () => [],
    };
    await expect(
      downloadExport(database, brokenStorage, userId, record.id, new Date('2026-08-16T10:01:00Z')),
    ).rejects.toMatchObject({ code: 'EXPORT_STORAGE_ERROR' });
  });
});
