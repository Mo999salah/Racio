import { PgBoss } from 'pg-boss';
import { processCsvParseJob } from '@racio/imports';
import { readAppEnv } from '@racio/config';
import { createDatabase } from '@racio/database';
import { createLocalPrivateStorage } from '@racio/storage';

export type WorkerBoss = {
  start(): Promise<unknown>;
  stop(options?: { close?: boolean }): Promise<unknown>;
};

export function createWorker(boss: WorkerBoss) {
  let started = false;

  return {
    async start() {
      await boss.start();
      started = true;
      console.info(JSON.stringify({ event: 'worker_started', jobs: ['statement.parse.csv'] }));
    },
    async shutdown() {
      if (!started) return;
      await boss.stop({ close: true });
      started = false;
      console.info(JSON.stringify({ event: 'worker_stopped' }));
    },
  };
}

export async function main() {
  const env = readAppEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to start the worker.');

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
  });
  const database = createDatabase(env.DATABASE_URL);
  const storage = createLocalPrivateStorage({ rootDirectory: env.LOCAL_STORAGE_PATH });
  const worker = createWorker(boss);
  await worker.start();
  await boss.work<{ jobId: string }>(
    'statement.parse.csv',
    { localConcurrency: 2 },
    async (jobs) => {
      for (const job of jobs) {
        await processCsvParseJob(
          database.db,
          storage,
          env.PARSER_URL,
          job.data.jobId,
          env.PARSER_TIMEOUT_MS,
        );
      }
    },
  );

  const shutdown = async (signal: string) => {
    console.info(JSON.stringify({ event: 'worker_shutdown_requested', signal }));
    await worker.shutdown();
    await database.client.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (import.meta.url === `file://${process.argv[1]}`) void main();
