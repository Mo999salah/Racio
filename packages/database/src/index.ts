import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { EXPECTED_MIGRATION_COUNT } from './migrations';

export const BOOTSTRAP_SCHEMA_VERSION = 'phase-7-xlsx-import';

export type RacioDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(databaseUrl: string) {
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('Racio requires a PostgreSQL connection URL.');
  }

  const client = postgres(databaseUrl, { max: 5 });
  return { client, db: drizzle(client, { schema }) };
}

/** Trivial connectivity + migration-journal check used by readiness probes. */
export async function checkDatabaseReadiness(
  databaseUrl: string,
): Promise<{ database: boolean; migrations: { applied: number; expected: number } | null }> {
  try {
    const client = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
    try {
      const [countRow] = await client`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
      if (!countRow) return { database: true, migrations: null };
      const applied = countRow.n;
      return { database: true, migrations: { applied, expected: EXPECTED_MIGRATION_COUNT } };
    } finally {
      await client.end();
    }
  } catch {
    return { database: false, migrations: null };
  }
}

export { schema };
export { expectedMigrationCount, expectedMigrationTags, readMigrationJournal } from './migrations';
export {
  inspectPostgresError,
  isPostgresUniqueViolation,
  isPostgresUniqueViolationOn,
  type PostgresErrorInfo,
} from './postgres-errors';
