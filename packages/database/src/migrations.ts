import { readFileSync } from 'node:fs';

/**
 * The number of migrations in the chain `0000` through `0013`. This is a
 * compiled constant because runtime code (readiness probes) cannot resolve
 * the journal file from bundled builds; `migrations.journal.test.ts` asserts
 * that it always matches the on-disk journal.
 */
export const EXPECTED_MIGRATION_COUNT = 14;

export type MigrationJournal = {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
};

/** The migration journal is the source of truth for the expected chain. */
export function readMigrationJournal(): MigrationJournal {
  const journalPath = new URL('../drizzle/meta/_journal.json', import.meta.url);
  return JSON.parse(readFileSync(journalPath, 'utf8')) as MigrationJournal;
}

export function expectedMigrationCount(): number {
  return readMigrationJournal().entries.length;
}

export function expectedMigrationTags(): string[] {
  return readMigrationJournal().entries.map((entry) => entry.tag);
}
