import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, schema, type RacioDatabase } from '@racio/database';
import type { PrivateStorage } from '@racio/storage';
import { confirmImport, createCsvImport, processCsvParseJob } from '../src/index';

const runIntegration = process.env.RACIO_RUN_DB_INTEGRATION === '1';
const runParserIntegration = process.env.RACIO_RUN_PARSER_INTEGRATION === '1';
const suite = runIntegration ? describe : describe.skip;
const parserTest = runParserIntegration ? it : it.skip;

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

suite('CSV import happy-path integration', () => {
  let db: RacioDatabase;
  let client: ReturnType<typeof createDatabase>['client'];
  const storage = new MemoryPrivateStorage();
  const user = `phase13-csv-user-${randomUUID()}`;
  const institution = `phase13-csv-institution-${randomUUID()}`;
  const account = `phase13-csv-account-${randomUUID()}`;

  beforeAll(async () => {
    ({ db, client } = createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ));
    const now = new Date();
    await db.insert(schema.user).values({
      id: user,
      name: 'Phase 13 CSV',
      email: `${user}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.institutions).values({
      id: institution,
      userId: user,
      name: 'Phase 13 Bank',
      normalizedName: 'phase 13 bank',
      countryCode: 'US',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(schema.financialAccounts).values({
      id: account,
      userId: user,
      institutionId: institution,
      displayName: 'Checking',
      accountType: 'checking',
      currencyCode: 'USD',
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    if (!runIntegration) return;
    await client.end();
  });

  parserTest('a clean CSV parse reaches ready and confirms without any row action', async () => {
    const csvBuffer = readFileSync(
      new URL('../../../fixtures/statements/csv/debit-credit.csv', import.meta.url),
    );
    // Exact-size copy: a pooled Node buffer's `.buffer` would include padding.
    const csv = new Uint8Array(csvBuffer);
    const created = await createCsvImport(db, storage, user, {
      accountId: account,
      filename: 'debit-credit.csv',
      size: csv.byteLength,
      checksum: createHash('sha256').update(csv).digest('hex'),
      bytes: csv,
      retainOriginalFile: false,
      reprocess: false,
      idempotencyKey: randomUUID(),
    });
    if (!created.jobId) throw new Error('Expected a queued CSV parse job.');
    const parserUrl = process.env.PARSER_URL ?? 'http://127.0.0.1:8001';

    await processCsvParseJob(db, storage, parserUrl, created.jobId, 30_000);

    const [statement] = await db
      .select()
      .from(schema.statements)
      .where(eq(schema.statements.id, created.statement.id));
    expect(statement).toBeDefined();
    // Regression: a parse whose rows are all valid and non-duplicate must
    // produce `ready` (not `needs_review`), otherwise the confirmation guard
    // rejects the happy path with CONFLICT.
    expect(statement!.processingStatus).toBe('ready');

    const result = await confirmImport(
      db,
      storage,
      user,
      created.statement.id,
      false,
      randomUUID(),
    );
    expect(result.status).toBe('imported');
    expect(result.count).toBe(2);

    const imported = await db
      .select({ id: schema.transactions.id })
      .from(schema.transactions)
      .where(eq(schema.transactions.statementId, created.statement.id));
    expect(imported).toHaveLength(2);
  });
});
