import { PgBoss } from 'pg-boss';

let boss: PgBoss | undefined;
let started: Promise<unknown> | undefined;

function getBoss() {
  boss ??= new PgBoss({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql://racio:racio_dev@localhost:5432/racio',
    schema: process.env.PG_BOSS_SCHEMA ?? 'pgboss',
    // The web process only enqueues; a small pool is plenty and keeps the
    // total connection budget bounded (see docs/operations.md § database).
    max: 3,
  });
  return boss;
}

export async function enqueueCsvParse(jobId: string) {
  return enqueueImportJob('statement.parse.csv', jobId);
}

export async function enqueueImportJob(
  jobType:
    | 'statement.parse.csv'
    | 'statement.inspect.xlsx'
    | 'statement.parse.xlsx'
    | 'statement.inspect.pdf'
    | 'statement.parse.pdf',
  jobId: string,
) {
  started ??= getBoss().start();
  await started;
  await getBoss().createQueue(jobType);
  return getBoss().send(jobType, { jobId }, { singletonKey: jobId, retryLimit: 3 });
}

export async function enqueueAlertEvaluation(userId: string) {
  started ??= getBoss().start();
  await started;
  await getBoss().createQueue('planning.evaluate.alerts');
  return getBoss().send(
    'planning.evaluate.alerts',
    { userId },
    { singletonKey: userId, retryLimit: 3 },
  );
}

export async function enqueueExportGenerate(exportId: string) {
  started ??= getBoss().start();
  await started;
  await getBoss().createQueue('export.generate');
  return getBoss().send('export.generate', { exportId }, { singletonKey: exportId, retryLimit: 3 });
}
