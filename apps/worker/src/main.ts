import { PgBoss } from 'pg-boss';
import { pathToFileURL } from 'node:url';
import { createServer, type Server } from 'node:http';
import {
  cleanupAbandonedImports,
  processCsvParseJob,
  processPdfInspectionJob,
  processPdfParseJob,
  processXlsxInspectionJob,
  processXlsxParseJob,
} from '@racio/imports';
import { evaluateAlertsForUser, listEvaluationUserIds } from '@racio/planning';
import {
  cleanupExpiredExports,
  exportLimitsFromEnv,
  generateExportFile,
  reconcileOrphanExports,
} from '@racio/export';
import { readAppEnv } from '@racio/config';
import { createDatabase } from '@racio/database';
import { createLocalPrivateStorage } from '@racio/storage';

export type WorkerBoss = {
  start(): Promise<unknown>;
  stop(options?: { close?: boolean }): Promise<unknown>;
};

/**
 * Minimal HTTP liveness endpoint for orchestration probes and the browser
 * test harness. The worker remains job-driven; this listener only reports
 * that the process is alive and its pg-boss connection was established.
 */
export function startHealthListener(port: number, version: string): Server {
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url !== '/health') {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify({ status: 'ok', service: 'worker', version }));
  });
  server.listen(port, '0.0.0.0');
  return server;
}

export function createWorker(boss: WorkerBoss) {
  let started = false;

  return {
    async start() {
      await boss.start();
      started = true;
      console.info(
        JSON.stringify({
          event: 'worker_started',
          jobs: [
            'statement.parse.csv',
            'statement.inspect.xlsx',
            'statement.parse.xlsx',
            'statement.inspect.pdf',
            'statement.parse.pdf',
            'statement.cleanup.orphans',
            'planning.evaluate.alerts',
            'planning.alerts.sweep',
            'export.generate',
            'export.cleanup',
          ],
        }),
      );
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
  const env = readAppEnv(undefined, { requireAuth: false });
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required to start the worker.');

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: env.PG_BOSS_SCHEMA,
    // Worker queue processing pool: bounded by design so job concurrency is
    // limited by `localConcurrency`, never by unbounded connections.
    max: 10,
  });
  const database = createDatabase(env.DATABASE_URL);
  const storage = createLocalPrivateStorage({ rootDirectory: env.LOCAL_STORAGE_PATH });
  const exportLimits = exportLimitsFromEnv(env);
  const worker = createWorker(boss);
  await worker.start();
  for (const queue of [
    'statement.parse.csv',
    'statement.inspect.xlsx',
    'statement.parse.xlsx',
    'statement.inspect.pdf',
    'statement.parse.pdf',
    'statement.cleanup.orphans',
    'planning.evaluate.alerts',
    'planning.alerts.sweep',
    'export.generate',
    'export.cleanup',
  ])
    await boss.createQueue(queue);
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
  await boss.work('statement.cleanup.orphans', { localConcurrency: 1 }, async () => {
    await cleanupAbandonedImports(database.db, storage, env.IMPORT_ORPHAN_RETENTION_HOURS);
  });
  await boss.schedule('statement.cleanup.orphans', '17 * * * *');
  await boss.work<{ jobId: string }>(
    'statement.inspect.xlsx',
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const parseJobId = await processXlsxInspectionJob(
          database.db,
          storage,
          env.PARSER_URL,
          job.data.jobId,
          env.PARSER_TIMEOUT_MS,
        );
        if (parseJobId)
          await boss.send(
            'statement.parse.xlsx',
            { jobId: parseJobId },
            { singletonKey: parseJobId, retryLimit: 3 },
          );
      }
    },
  );
  await boss.work<{ jobId: string }>(
    'statement.parse.xlsx',
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await processXlsxParseJob(
          database.db,
          storage,
          env.PARSER_URL,
          job.data.jobId,
          env.PARSER_TIMEOUT_MS,
        );
      }
    },
  );

  await boss.work<{ jobId: string }>(
    'statement.inspect.pdf',
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const parseJobId = await processPdfInspectionJob(
          database.db,
          storage,
          env.PARSER_URL,
          job.data.jobId,
          env.PARSER_TIMEOUT_MS,
        );
        if (parseJobId)
          await boss.send(
            'statement.parse.pdf',
            { jobId: parseJobId },
            { singletonKey: parseJobId, retryLimit: 3 },
          );
      }
    },
  );
  await boss.work<{ jobId: string }>(
    'statement.parse.pdf',
    { localConcurrency: 1 },
    async (jobs) => {
      for (const job of jobs) {
        await processPdfParseJob(
          database.db,
          storage,
          env.PARSER_URL,
          job.data.jobId,
          env.PARSER_TIMEOUT_MS,
        );
      }
    },
  );

  await boss.work<{ userId: string }>(
    'planning.evaluate.alerts',
    { localConcurrency: 2 },
    async (jobs) => {
      for (const job of jobs) {
        const result = await evaluateAlertsForUser(database.db, job.data.userId);
        console.info(JSON.stringify({ event: 'alerts_evaluated', ...result }));
      }
    },
  );
  await boss.work('planning.alerts.sweep', { localConcurrency: 1 }, async () => {
    const userIds = await listEvaluationUserIds(database.db, 500);
    for (const userId of userIds) {
      await boss.send(
        'planning.evaluate.alerts',
        { userId },
        { singletonKey: userId, retryLimit: 3 },
      );
    }
    console.info(JSON.stringify({ event: 'alerts_sweep_completed', users: userIds.length }));
  });
  await boss.schedule('planning.alerts.sweep', '*/15 * * * *');

  await boss.work<{ exportId: string }>(
    'export.generate',
    { localConcurrency: 2 },
    async (jobs) => {
      for (const job of jobs) {
        const row = await generateExportFile(
          database.db,
          storage,
          job.data.exportId,
          exportLimits,
          new Date(),
        );
        if (row) {
          console.info(
            JSON.stringify({
              event: 'export_generated',
              exportId: row.id,
              type: row.type,
              status: row.status,
              rowCount: row.rowCount,
              sizeBytes: row.sizeBytes,
            }),
          );
        }
      }
    },
  );
  await boss.work('export.cleanup', { localConcurrency: 1 }, async () => {
    const result = await cleanupExpiredExports(database.db, storage, exportLimits);
    const orphan = await reconcileOrphanExports(storage, database.db);
    console.info(
      JSON.stringify({
        event: 'export_cleanup_completed',
        ...result,
        orphansRemoved: orphan.removed,
      }),
    );
  });
  await boss.schedule('export.cleanup', '23 * * * *');

  const healthListener = startHealthListener(
    Number(process.env.WORKER_HEALTH_PORT ?? 3101),
    env.version,
  );

  const shutdown = async (signal: string) => {
    console.info(JSON.stringify({ event: 'worker_shutdown_requested', signal }));
    await worker.shutdown();
    await new Promise<void>((resolve) => healthListener.close(() => resolve()));
    await database.client.end();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGBREAK', () => void shutdown('SIGBREAK'));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) void main();
