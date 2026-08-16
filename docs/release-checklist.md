# Racio release checklist

Run every item before declaring a release. Do not skip failing checks; a
failed check blocks the release until it is fixed or explicitly mitigated and
documented.

## Secrets and TLS

- [ ] `BETTER_AUTH_SECRET` is a fresh random value ≥ 32 characters and is not
      a known example/default value (production startup rejects defaults).
- [ ] `BETTER_AUTH_URL` is the public HTTPS origin; the reverse proxy
      terminates TLS and sets `X-Forwarded-Proto`.
- [ ] No secrets are committed to the repository or baked into images
      (check `docker history` on release images).
- [ ] `NODE_ENV=production` everywhere in production; no debug mode.

## OAuth

- [ ] Configured providers have registered callbacks
      (`https://<origin>/api/auth/callback/google|apple`) matching
      `BETTER_AUTH_URL`.
- [ ] Unused providers are fully unset (partial configuration hides the
      provider).
- [ ] Sign-in, sign-out, session listing, and session revocation verified on
      the production build.

## Database

- [ ] Fresh-database clean install: migrations `0000`–`0013` apply from an
      empty database; `drizzle-kit check` passes; `db:generate` is a no-op.
- [ ] Upgrade path verified from the previous release point (e.g.
      `0012 → 0013`).
- [ ] No `drizzle-kit push` anywhere in production procedures.
- [ ] Connection budget documented and verified (`docs/operations.md`).

## Backup and restore

- [ ] `scripts/backup/backup.sh` produces a custom-format dump without
      embedded passwords.
- [ ] An actual restore drill was executed on disposable infrastructure:
      fresh database → restore → schema parity → row counts → app starts →
      representative data visible (authenticate, open account, ledger,
      dashboard, one budget, one export row).
- [ ] Private storage backup is included in the drill (DB dump alone is not a
      full backup).
- [ ] Backup storage is encrypted with restricted access and defined
      retention.

## Security posture

- [ ] Production pages serve the CSP with per-request nonces, `nosniff`,
      `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`, and
      HSTS; no CSP violations on the sign-in page (automated in
      `test:e2e:prod`).
- [ ] The test-only session fixture (`/api/test/session`) returns 404 in
      production.
- [ ] Health/readiness verified: `live` and `ready` (readiness includes
      PostgreSQL and migration state, not AI/OAuth).
- [ ] AI is disabled (`AI_ENABLED=false`) unless intentionally enabled; AI
      credentials optional and only required when enabled.
- [ ] Export expiry enabled (default 24 h) and cleanup verified.
- [ ] Parser limits (upload size, pages, rows, memory, timeouts) are set
      explicitly in the deployment environment.
- [ ] Dependency audit (`pnpm audit`, pip-audit) has no reachable
      high/critical findings; accepted findings are classified in
      `docs/security-audit.md`.

## Operations

- [ ] Worker health endpoint reachable; worker restart-safe (pg-boss
      idempotent jobs).
- [ ] Storage cleanup jobs (`statement.cleanup.orphans`, `export.cleanup`)
      verified; export orphan reconciliation enabled.
- [ ] Runbooks reviewed: `docs/operations.md`, `docs/disaster-recovery.md`.

## Tests

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` (with real PostgreSQL
      integration enabled), `pnpm build`, `pnpm format:check`,
      `pnpm validate:docs` all pass.
- [ ] Parser: `ruff check`, `ruff format --check`, `mypy`, `pytest` pass.
- [ ] Playwright critical suite passes on Chromium (and Firefox where
      available), including cross-user isolation, imports (CSV/XLSX/PDF,
      scanned-PDF rejection), ledger, budgets, exports, RTL, mobile, and dark
      mode.
- [ ] Production-mode Playwright suite (`test:e2e:prod`) passes.
- [ ] Real PostgreSQL integration suites pass (`RACIO_RUN_DB_INTEGRATION=1`,
      `RACIO_RUN_PARSER_INTEGRATION=1`).
- [ ] Production container images build and start; web answers, readiness
      reports 200, worker connects, parser responds.
