import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, schema } from '@racio/database';
import { createLocalPrivateStorage } from '@racio/storage';
import {
  createExportRequest,
  downloadExport,
  generateExportFile,
  reconcileOrphanExports,
  type ExportLimits,
} from '@racio/export';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5433/racio';

const limits: ExportLimits = {
  syncMaxRows: -1,
  maxRows: 250_000,
  maxFileBytes: 50 * 1024 * 1024,
  maxArchiveRecords: 100_000,
  retentionHours: 24,
  maxConcurrentPerUser: 3,
};

suite('export.generate pg-boss end-to-end', () => {
  let db: ReturnType<typeof createDatabase>['db'];
  let client: ReturnType<typeof createDatabase>['client'];
  let storage: ReturnType<typeof createLocalPrivateStorage>;
  let storageRoot: string;
  let boss: PgBoss;
  let userId: string;

  beforeAll(async () => {
    ({ db, client } = createDatabase(databaseUrl));
    storageRoot = await mkdtemp(join(tmpdir(), 'racio-export-boss-'));
    storage = createLocalPrivateStorage({ rootDirectory: storageRoot });
    boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
    await boss.start();
    await boss.createQueue('export.generate');
    const now = new Date();
    userId = `e2e-export-user-${randomUUID()}`;
    await db.insert(schema.user).values({
      id: userId,
      name: 'E2E',
      email: `${userId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await boss.work<{ exportId: string }>(
      'export.generate',
      { localConcurrency: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await generateExportFile(db, storage, job.data.exportId, limits, new Date());
        }
      },
    );
  });

  afterAll(async () => {
    if (!runIntegration) return;
    await boss.stop({ close: true });
    await client.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('creates, enqueues, finalizes, and downloads through pg-boss', async () => {
    const { record, requiresJob } = await createExportRequest(
      db,
      userId,
      { type: 'transactions_csv', filters: { includeArchived: 'false' }, includeNotes: false },
      limits,
      storage,
      new Date(),
      async (exportId) => {
        await boss.send('export.generate', { exportId }, { singletonKey: exportId, retryLimit: 3 });
      },
    );
    expect(requiresJob).toBe(true);
    expect(record.status).toBe('preparing');

    let ready = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const rows = await db.select().from(schema.exports);
      const row = rows.find((candidate) => candidate.id === record.id);
      if (row?.status === 'ready') {
        ready = true;
        expect(row.sizeBytes).toBeGreaterThan(0);
        expect(row.checksum).toMatch(/^[a-f0-9]{64}$/u);
        expect(row.expiresAt).not.toBeNull();
        const file = await downloadExport(db, storage, userId, record.id, new Date());
        expect(file.bytes.byteLength).toBe(row.sizeBytes);
        expect(file.contentType).toBe('text/csv; charset=utf-8');
        expect(file.fileName).toMatch(/^racio-transactions-\d{4}-\d{2}-\d{2}\.csv$/u);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    expect(ready).toBe(true);
  });

  it('removes unreferenced export artifacts after the grace period and keeps live ones', async () => {
    const referencedKey = `exports/${randomUUID()}.csv`;
    const liveArtifact = new TextEncoder().encode('live,row\r\n');
    await storage.put(referencedKey, liveArtifact, 'text/csv');
    await db.insert(schema.exports).values({
      id: randomUUID(),
      userId,
      type: 'transactions_csv',
      status: 'ready',
      requestJson: {
        type: 'transactions_csv',
        filters: { includeArchived: 'false' },
        includeNotes: false,
      },
      storageKey: referencedKey,
      sizeBytes: liveArtifact.byteLength,
      checksum: 'a'.repeat(64),
      rowCount: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    });

    const orphanKey = `exports/${randomUUID()}.csv`;
    await storage.put(orphanKey, new TextEncoder().encode('orphan'), 'text/csv');

    const freshOrphanKey = `exports/${randomUUID()}.csv`;
    await storage.put(freshOrphanKey, new TextEncoder().encode('fresh'), 'text/csv');

    const oldOrphanKey = `exports/${randomUUID()}.csv`;
    await storage.put(oldOrphanKey, new TextEncoder().encode('old'), 'text/csv');

    // Grace period 0: everything unreferenced (including "fresh") is removed.
    const result = await reconcileOrphanExports(storage, db, new Date(), 0);
    expect(result.removed).toBe(3);
    await expect(storage.get(orphanKey)).rejects.toBeTruthy();
    await expect(storage.get(freshOrphanKey)).rejects.toBeTruthy();
    await expect(storage.get(oldOrphanKey)).rejects.toBeTruthy();
    // Live artifacts are never removed.
    expect(new TextDecoder().decode(await storage.get(referencedKey))).toBe('live,row\r\n');
  });
});
