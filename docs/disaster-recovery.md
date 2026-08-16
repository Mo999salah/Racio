# Racio disaster recovery runbook

Each scenario follows the same shape: symptom → diagnosis → recovery action →
expected data impact. Use `docs/operations.md` for steady-state operations
and `docs/deployment.md` for topology details.

## Database loss (volume destroyed, database unreachable)

- Symptom: `/api/health/ready` returns 503 with `checks.database:
unavailable`; the app errors on every data request.
- Diagnosis: check `docker compose ps` for the postgres container and
  `pg_stat_activity`; verify the volume exists
  (`docker volume ls`).
- Recovery:
  1. Stop `web` and `worker` so no writes race the restore.
  2. Create a fresh database with the same name/owner.
  3. Restore the latest backup:
     `DATABASE_URL=<target> ./scripts/backup/restore.sh <backup-file>`.
  4. Restore the matching private-storage copy (the DB dump alone is not a
     full backup).
  5. Start `web` and `worker`; verify readiness and representative data.
- Expected data impact: all data since the last consistent
  (DB + storage) backup is lost.

## Private storage loss

- Symptom: imports fail after upload with storage errors; export downloads
  return `EXPORT_STORAGE_ERROR`; uploaded files cannot be re-read by the
  worker.
- Diagnosis: check the storage volume and `LOCAL_STORAGE_PATH` permissions;
  verify the volume exists and is mounted.
- Recovery: restore the storage copy that matches the database backup point;
  then restart `web` and `worker`. Exports and uploads newer than the storage
  backup are gone; database rows referencing missing objects surface stable
  errors rather than crashes.
- Expected data impact: files newer than the storage backup are lost; the
  ledger data in PostgreSQL is intact.

## Failed migration

- Symptom: the one-shot `migrate` service exits non-zero; `web`/`worker` do
  not start.
- Diagnosis: `docker compose logs migrate`; determine which migration failed
  and why.
- Recovery:
  1. Stop the deployment.
  2. Do not edit released migration files and never use `drizzle-kit push`.
  3. Fix forward with a corrective migration, or restore the pre-upgrade
     backup (see database loss) and re-apply the deployment.
- Expected data impact: none if restored from backup; DDL applied before the
  failure point is not automatically rolled back.

## Corrupt export/import worker

- Symptom: exports stay `preparing` until `export.cleanup` marks them
  `failed` (`EXPORT_FAILED`); imports stay in a processing state then fail
  with stable error codes.
- Diagnosis: inspect `pgboss.job` rows (`state`, `output`) and the import/
  export rows' `error_code`.
- Recovery: restart the worker (jobs are idempotent). For a stuck export,
  delete the export row and re-create it. For an import, upload again (a new
  idempotency key); the original private file may be deleted by cleanup.
- Expected data impact: no ledger mutation; failed export/import requests
  must be retried by the user.

## Parser unavailable

- Symptom: new uploads fail or stall; existing data is unaffected.
- Diagnosis: parser health endpoint
  (`GET http://<parser>:8001/health`) is down or the container restarts.
- Recovery: restart the parser container; it is stateless. Imports that were
  in flight will retry and then fail with the documented parser error code;
  users re-upload.
- Expected data impact: no data loss; in-flight parses must be retried.

## AI provider unavailable

- Symptom: advisor answers fail with stable codes (`AI_PROVIDER_UNAVAILABLE`,
  `AI_TIMEOUT`, ...); everything else keeps working.
- Diagnosis: check `AI_ENABLED`/`AI_BASE_URL` and the provider's status.
- Recovery: none required — the advisor is optional. Either wait for the
  provider, or set `AI_ENABLED=false` and restart the web service to show
  the disabled state.
- Expected data impact: none; no mutations, no partial proposals.

## Worker unavailable

- Symptom: imports/exports/alert evaluation stop progressing; the web app
  still serves; `GET http://<worker>:3101/health` is down.
- Diagnosis: `docker compose logs worker`.
- Recovery: restart the worker. All job types are idempotent (pg-boss
  singleton keys); the alert sweep re-fans out every 15 minutes.
- Expected data impact: no data loss; work resumes when the worker returns.

## Web unavailable

- Symptom: the site does not respond; `/api/health/live` fails.
- Diagnosis: `docker compose ps web`, `docker compose logs web`; verify the
  reverse proxy and `WEB_PORT`.
- Recovery: restart the web container. If the root cause is a failed
  migration or database loss, follow those runbooks first.
- Expected data impact: none; requests are lost while the web process is
  down (no queueing at the edge).
