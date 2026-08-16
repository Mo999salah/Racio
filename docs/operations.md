# Racio operations runbook

This document is the day-to-day operations guide for a Racio deployment.
Deployment specifics live in `docs/deployment.md`; disaster recovery
procedures are in `docs/disaster-recovery.md` (or the "Disaster recovery"
section of this file if that document is absent).

## Services

| Service  | What it runs                                                               |
| -------- | -------------------------------------------------------------------------- |
| web      | Next.js production server (`next start`), port 3000                        |
| worker   | pg-boss job runner (tsx), no inbound traffic, health listener on port 3101 |
| parser   | FastAPI parser boundary, port 8001, internal network only                  |
| postgres | PostgreSQL 16, persistent volume, not published to the host                |

## Start and stop

```bash
# Production compose (documented topology: ONE web instance)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps
docker compose -f docker-compose.prod.yml --env-file .env.production down   # stop, keep volumes
```

The compose project runs migrations once (the one-shot `migrate` service)
before `web` and `worker` start.

## Health

| Probe           | Endpoint / method                                      |
| --------------- | ------------------------------------------------------ |
| Web liveness    | `GET /api/health/live`                                 |
| Web readiness   | `GET /api/health/ready` (PostgreSQL + migration state) |
| Worker liveness | `GET http://<worker>:3101/health`                      |
| Parser liveness | `GET http://<parser>:8001/health`                      |

Readiness never depends on the AI provider or optional OAuth providers. The
readiness check compares the applied migration count with the expected chain
(`0000`–`0013`, currently 14).

## Logs

All services log structured JSON lines to stdout/stderr: `{ "event": ...,
"level": ..., ... }`. Financial contents (descriptions, amounts, notes,
account identifiers, storage keys, prompts) are never logged.

```bash
docker compose -f docker-compose.prod.yml logs -f web worker parser postgres
```

## Upgrade and migrate

1. Back up the database and private storage (below).
2. Pull/build the new images.
3. Run the one-shot migration: `docker compose -f docker-compose.prod.yml up migrate`
   — it applies pending migrations and exits 0 on success.
4. Start the application: `docker compose ... up -d web worker parser`.
5. Verify `/api/health/ready` reports `migrations.applied == migrations.expected`.

Migrations run exactly once (the migrate service); replicas never race to
migrate. Never use `drizzle-kit push` in production.

If a migration fails:

1. Stop the deployment (`docker compose ... stop web worker`).
2. Inspect the migrate logs; the failed migration's DDL is not rolled back
   automatically (PostgreSQL DDL is not reversible).
3. Either fix forward (new migration) or restore the pre-upgrade backup.
4. Never edit a released migration file in place.

## Backup

PostgreSQL (see `scripts/backup/backup.sh`):

```bash
DATABASE_URL=postgresql://... ./scripts/backup/backup.sh /secure/backup/dir
```

Produces a custom-format dump (`racio-backup-<ts>.dump`) suitable for
selective or parallel restore. The password comes from the environment, never
from the script.

Private storage (uploaded statements, generated exports) is a separate volume
(`racio-private-storage`). Back it up with the deployment's storage-layer
backup (snapshot/object copy) at the same point as the database dump using a
quiesced-write sequence:

1. Quiesce writes (briefly stop `web` + `worker`, or accept a bounded
   inconsistency window between DB and storage).
2. Take the PostgreSQL dump.
3. Copy/snapshot the private storage volume.
4. Resume writes.

A PostgreSQL dump alone is NOT a full backup: without the storage copy,
uploaded files and generated exports cannot be restored.

Backups contain sensitive financial data. Store them encrypted (storage-layer
encryption), restrict access, and define a retention policy.

## Restore

1. Create a fresh empty database.
2. `DATABASE_URL=<target> ./scripts/backup/restore.sh <backup-file>`
3. Restore the private storage copy.
4. Verify: schema parity (`\dt` count), row counts, then start the app and
   confirm readiness and representative data (authenticate, open an account,
   open the ledger, view the dashboard, inspect an export row).
5. A restore drill must be performed before every release (see
   `docs/release-checklist.md`).

## Worker recovery

The worker is driven entirely by pg-boss jobs stored in PostgreSQL, so a
worker restart is safe: jobs stay queued, and every job type is idempotent
(singleton keys per statement/export/user). The container restarts
automatically (`restart: unless-stopped`).

| Job                       | Concurrency | Retries | Recovery if worker is down                                       |
| ------------------------- | ----------- | ------- | ---------------------------------------------------------------- |
| statement.parse.csv       | 2           | 3       | jobs wait in pg-boss; restart worker                             |
| statement.inspect.xlsx    | 1           | 3       | as above                                                         |
| statement.parse.xlsx      | 1           | 3       | as above                                                         |
| statement.inspect.pdf     | 1           | 3       | as above                                                         |
| statement.parse.pdf       | 1           | 3       | as above                                                         |
| statement.cleanup.orphans | 1 (hourly)  | —       | re-runs on schedule                                              |
| planning.evaluate.alerts  | 2           | 3       | sweep re-fans out every 15 minutes                               |
| planning.alerts.sweep     | 1 (15 min)  | —       | re-runs on schedule                                              |
| export.generate           | 2           | 3       | row stays `preparing`; stale rows are failed by cleanup after 2h |
| export.cleanup            | 1 (hourly)  | —       | re-runs on schedule                                              |

Failed jobs are visible in the `pgboss.job` table (`state = 'failed'` with
`output`) and in import/export rows as stable error codes. There is no
dead-letter queue; exhausted retries surface as `failed` status in the
application.

Manual recovery for a stuck export: delete the export row and re-create it,
or wait for `export.cleanup` (stale `preparing` rows older than 2 hours
become `failed` with `EXPORT_FAILED`).

## Parser recovery

The parser is stateless; restart it freely. The worker calls it with a strict
timeout (`PARSER_TIMEOUT_MS`, default 30 s) and maps failures to stable error
codes. If the parser is unreachable, import jobs retry and then fail with the
documented error code; already-parsed data is untouched.

## Storage cleanup

- `statement.cleanup.orphans` (hourly): removes abandoned/expired temporary
  statement objects after `IMPORT_ORPHAN_RETENTION_HOURS` (default 24).
- `export.cleanup` (hourly): removes expired export files
  (`EXPORT_RETENTION_HOURS`, default 24) and orphaned unreferenced export
  objects older than a 2-hour grace period (crash-window reconciliation).
- Cleanup jobs only delete objects that are expired or unreferenced; they
  never delete active user data.

## Export cleanup

Exports expire after `EXPORT_RETENTION_HOURS` (default 24). After expiry,
downloads return `EXPORT_EXPIRED` (410) and the hourly cleanup removes the
file while the metadata row remains for audit.

## AI disable procedure

AI is off by default (`AI_ENABLED=false`). To disable a running deployment,
set `AI_ENABLED=false` and restart the web service; the advisor UI reports
the disabled state and no provider is contacted. No AI credentials are
required at startup when AI is disabled.

## OAuth troubleshooting

- **Provider missing from the sign-in page**: the provider requires its full
  server-side configuration (Google: ID + secret; Apple: ID, team, key id,
  private key). Partial configuration hides the provider.
- **Callback failures**: the OAuth callback URL must match
  `BETTER_AUTH_URL` + `/api/auth/callback/<provider>` exactly, and
  `BETTER_AUTH_URL` must be the public HTTPS origin.
- **Production startup rejection**: `BETTER_AUTH_SECRET` must be a fresh
  random value of at least 32 characters that is not a known example value;
  `BETTER_AUTH_URL` must use `https`. See `docs/deployment.md`.

## Database and pools

| Process | Pool               | Purpose                                       |
| ------- | ------------------ | --------------------------------------------- |
| web     | postgres-js, max 5 | application queries                           |
| web     | pg-boss, max 3     | enqueueing jobs only                          |
| worker  | postgres-js, max 5 | application queries                           |
| worker  | pg-boss, max 10    | job execution (bounded by `localConcurrency`) |

A single PostgreSQL instance must allow at least these connections plus a
margin; the development compose raises `max_connections` to 200 because the
Next.js dev server duplicates shared singletons per route bundle.

## Retention defaults

| Data class            | Default retention                                                                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uploaded statements   | deleted after successful confirmation unless retention is chosen; abandoned objects cleaned hourly (`IMPORT_ORPHAN_RETENTION_HOURS`, default 24 h) |
| Generated exports     | 24 h (`EXPORT_RETENTION_HOURS`), cleanup hourly; metadata rows remain                                                                              |
| Advisor conversations | user-controlled (archive/delete); not auto-deleted                                                                                                 |
| Alert history         | retained; read/dismiss states are traceable                                                                                                        |
| Application logs      | deployment-level retention (stdout)                                                                                                                |
| Backups               | deployment-defined; store encrypted with restricted access                                                                                         |
| Ledger data           | never auto-deleted                                                                                                                                 |

## Shutdown behavior

`SIGTERM`/`SIGINT` (and `SIGBREAK` on Windows) stop the worker gracefully:
pg-boss stops taking new jobs, in-flight jobs complete within a bounded
window, the health listener closes, and the database client ends. The web
process follows Next.js standard graceful shutdown; orchestrators should use
the readiness probe before draining.
