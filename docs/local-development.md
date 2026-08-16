# Local development

1. Copy `.env.example` to `.env` and start PostgreSQL, either directly or with
   `docker compose up postgres`.
2. Install workspace dependencies with `pnpm install`.
3. Apply the current migrations with
   `pnpm --filter @racio/database db:migrate`. The migration chain `0000`
   through `0013` applies cleanly to a completely empty PostgreSQL database;
   every composite owner foreign key references a matching `(id, user_id)`
   unique constraint that earlier statements in the chain create. Do not
   pre-create tables, partial schemas, or a `drizzle` migration schema, because
   the chain owns the full Phase 2–11 schema.
4. Start the web app with `pnpm --filter @racio/web dev`.
5. Configure a real Google or Apple provider for sign-in, then open the
   localized accounts route, for example `/en/accounts` or `/ar/accounts`.

The Phase 3 smoke flow is to create an institution, create its account with a
masked identifier, edit the account, archive it, show archived accounts, and
restore it. No development user bypass is provided. If PostgreSQL or Docker is
unavailable, unit tests, typechecks, migration generation, and the build can
still run, but database integration and authenticated browser verification are
not complete until the services are available.

## Database

Use PostgreSQL 16. The development Compose file raises `max_connections` to
200 because the Next.js dev server keeps one copy of shared singletons per
route bundle; the production build shares a single module graph and uses
bounded pools (see `docs/operations.md`).

## Browser end-to-end tests

Phase 13 adds Playwright suites in `apps/web`:

- `pnpm --filter @racio/web test:e2e` — critical flows (auth, accounts,
  imports, ledger, planning, exports, cross-user isolation, responsive/RTL/
  dark mode) against a dev server with the worker and a real PostgreSQL
  database. The parser service must be running on port 8001:
  `uv run uvicorn racio_parser.main:app --port 8001` from `apps/parser`.
- `pnpm --filter @racio/web test:e2e:prod` — production-mode verification
  (security headers, CSP nonces, readiness, test-fixture inertness); requires
  a production build first.

The test harness uses a guarded test-only session fixture
(`POST /api/test/session`), which requires `RACIO_E2E=1` and returns 404 in
production. It is not an authentication bypass outside the test harness.
