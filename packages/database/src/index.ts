import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export const BOOTSTRAP_SCHEMA_VERSION = 'phase-6-splits-merchants-transfers';

export type RacioDatabase = ReturnType<typeof drizzle<typeof schema>>;

export function createDatabase(databaseUrl: string) {
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('Racio requires a PostgreSQL connection URL.');
  }

  const client = postgres(databaseUrl, { max: 5 });
  return { client, db: drizzle(client, { schema }) };
}

export { schema };
