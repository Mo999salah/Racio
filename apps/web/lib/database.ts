import { createDatabase, type RacioDatabase } from '@racio/database';

let cachedDb: RacioDatabase | undefined;

/**
 * Lazily initialized database. The `db` accessor is only evaluated when a
 * request handler actually runs, so importing this module never requires
 * environment values or a live connection at build time.
 */
export const database: { db: RacioDatabase } = {
  get db() {
    cachedDb ??= createDatabase(
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    ).db;
    return cachedDb;
  },
};
