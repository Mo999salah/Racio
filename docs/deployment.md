# Racio deployment guide

This document describes the supported MVP deployment topology and the exact
steps to run Racio in production. Follow `docs/release-checklist.md` before
every release.

## Supported topology

- **One web instance.** The advisor rate limiter and the Better Auth rate
  limiter are in-process. The MVP deployment is exactly one web process; do
  not run multiple web replicas against the same database without first
  replacing those limiters with a shared implementation.
- One worker instance (pg-boss; a second worker is harmless but not required).
- One parser instance.
- One PostgreSQL 16 instance.
- A reverse proxy terminates HTTPS in front of the web service.

## Prerequisites

- Docker with Compose v2 (production runs are container-based).
- PostgreSQL 16 (the compose example provides it).
- A private, persistent storage volume for uploaded statements and exports.
- An HTTPS origin (domain + TLS certificate) for `BETTER_AUTH_URL`.
- `openssl rand -base64 48` (or equivalent) to generate secrets.

## Environment

Create `.env.production` from `.env.production.example`. Every variable is
labelled required/optional/secret/deployment-specific in that file. Never
commit the file.

Required in production:

| Variable             | Notes                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| `NODE_ENV`           | `production`                                                             |
| `DATABASE_URL`       | PostgreSQL URL; the app refuses non-PostgreSQL URLs                      |
| `BETTER_AUTH_URL`    | public HTTPS origin; production config rejects non-https values          |
| `BETTER_AUTH_SECRET` | fresh random value ≥ 32 chars; known example/default values are rejected |
| `POSTGRES_PASSWORD`  | compose-only: the database password                                      |

Optional:

- OAuth: `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, or the Apple group
  (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`).
  A provider is enabled only when its complete configuration exists.
- AI: `AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`,
  and the `AI_*` limits. AI is disabled by default; no credentials are
  required when disabled.
- Limits: `MAX_*` upload/parser limits, `EXPORT_*` limits,
  `IMPORT_ORPHAN_RETENTION_HOURS`, `PARSER_TIMEOUT_MS`, `RACIO_VERSION`.

## HTTPS / reverse proxy

Terminate TLS at the reverse proxy (Caddy, nginx, Traefik, a load balancer)
and forward to the web container on port 3000. The web service sends
`Strict-Transport-Security` itself; keep `X-Forwarded-Proto` set so the
same-origin check accepts `https` origins. The application sets
`Content-Security-Policy` (with per-request nonces), `X-Content-Type-Options:
nosniff`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`,
and cross-origin policy headers on its responses; the proxy must not
overwrite them.

## PostgreSQL

- Use PostgreSQL 16 (the compose example pins `postgres:16-alpine`).
- Keep the database on a persistent volume; never expose it to the public
  internet.
- TLS: connect over a private network; for remote databases enable SSL and
  use an `sslmode=require` URL.
- Least privilege: the application user needs CRUD on the `public` schema and
  on the `pgboss` schema (pg-boss creates its own schema at startup).
  `drizzle-kit migrate` additionally needs `CREATE` on `public` and on the
  `drizzle` schema. If you split roles, grant the migration role `CREATE` and
  the runtime role DML-only; schema ownership should stay with the migration
  role. The compose example uses one role for simplicity; document the split
  if you adopt it.
- Connection budget: see `docs/operations.md` (web 5 + 3, worker 5 + 10).

## Private storage

Uploaded statements and generated exports live on a private volume mounted at
`LOCAL_STORAGE_PATH` (default `/var/lib/racio/uploads`). It must:

- not be web-served (there are no public URLs),
- be backed up together with the database (see `docs/operations.md`),
- be monitored for capacity (upload and export size limits apply per object).

## Containers

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
```

Container characteristics:

- web: multi-stage production build (`next start`), non-root user, no dev
  dependencies, `RACIO_VERSION` baked in, health checks on liveness and
  readiness.
- worker: non-root, pinned lockfile, bounded pg-boss pool and per-queue
  concurrency, graceful shutdown, health listener on 3101.
- parser: non-root, read-only root filesystem, bounded memory (512 MB), pids
  (128), tmpfs `/tmp`, no published ports, no outbound network (the compose
  network is `internal: true`), strict per-format limits.
- migrate: one-shot `drizzle-kit migrate` runner that must complete before
  web/worker start (`service_completed_successfully`).

The compose example publishes only the web port (`WEB_PORT`, default 3000).

## Migration sequence

```text
backup -> migrate (one-shot job) -> verify -> start web/worker
```

Never run `drizzle-kit push` in production. Never let every replica run
migrations (the compose example runs them exactly once). If a migration
fails, stop the deployment, inspect, fix forward or restore the backup; do
not edit released migration files.

## Health probes

| Service | Probe                                                                          |
| ------- | ------------------------------------------------------------------------------ |
| web     | `GET /api/health/ready` (200 when PostgreSQL reachable and migrations applied) |
| worker  | `GET http://localhost:3101/health`                                             |
| parser  | `GET http://localhost:8001/health`                                             |

Readiness must never depend on the AI provider or optional OAuth providers.

## Scaling constraints

- Exactly one web instance (in-process rate limiters). Documented limitation
  for the MVP; multi-instance requires shared limiters.
- Parser and worker can be scaled horizontally; pg-boss already distributes
  jobs across workers, and the parser is stateless. Keep at least one worker
  and one parser.
- PostgreSQL is a single primary; scale storage/CPU per the deployment
  platform's managed service.

## Optional AI

Set `AI_ENABLED=true`, `AI_PROVIDER=openai-compatible`, `AI_MODEL`,
`AI_API_KEY`, and `AI_BASE_URL` (an OpenAI-compatible endpoint). Startup
validates the configuration and requires the API key only when AI is enabled.
The advisor remains bounded by the `AI_*` limits; see `docs/ai-advisor.md`.

## Optional OAuth

Google: set `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` and register the
callback `https://<origin>/api/auth/callback/google`. Apple: set the Apple
group variables and register the callback
`https://<origin>/api/auth/callback/apple`; Apple requires a public HTTPS
origin. A provider is hidden when its configuration is incomplete. With no
provider configured the app boots and shows the localized no-provider state.

## Backup

`DATABASE_URL=... ./scripts/backup/backup.sh <dir>` (custom-format pg_dump).
Back up private storage at the same point (see `docs/operations.md`).
Encrypt backups at rest and define retention. Test restore before release.

## Known limitations

See `docs/release-notes.md` and `CHANGELOG.md` (known-limitations section):
OCR, currency conversion, multi-instance AI rate limiting, archive-as-restore,
supported PDF scope, and browser notes.
