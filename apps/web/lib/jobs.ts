import { PgBoss } from 'pg-boss';
import { readAppEnv } from '@racio/config';

const env = readAppEnv();
const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: env.PG_BOSS_SCHEMA });
let started: Promise<unknown> | undefined;

export async function enqueueCsvParse(jobId: string) {
  started ??= boss.start();
  await started;
  return boss.send('statement.parse.csv', { jobId }, { singletonKey: jobId, retryLimit: 3 });
}
