# Racio

Racio is a privacy-conscious personal-finance application for importing,
reviewing, classifying, and analysing bank-statement data. The repository now
contains the Phase 10 authentication, session, preference, ownership,
institution, financial-account, CSV/XLSX/PDF import, transaction-ledger, manual
classification, deterministic-rule, split, merchant, alias, internal-transfer,
overview, budget, savings-goal, deterministic-alert foundation, the
optional Phase 11 AI advisor, the Phase 12 user-controlled export
boundary, and the Phase 13 security, operations, and release-hardening
layer (CSP/security headers, health/readiness, hardened containers,
backup/restore, export orphan reconciliation, Playwright browser suites, and
the release documentation set).

## Current boundary

The current boundary includes user-owned institutions, one financial account per
institution, CSV/XLSX/PDF review-first import through atomic confirmation, a
server-paginated transaction ledger, user-owned categories/tags, editable
metadata, saved views, deterministic classification rules, exact transaction
splits, user-owned merchants and aliases, explicit internal-transfer links, a
read-only overview of position, period cash flow, and spending, currency-specific
budgets and savings goals, deterministic in-app alerts, an optional
grounded AI advisor (disabled by default; read-only questions plus
preview-and-confirm mutation proposals), and private user-controlled exports
(CSV, XLSX, and a versioned JSON archive with retention and cleanup). It does
not include bank APIs, legacy Excel, OCR, scanned/image-only PDFs, mandatory AI,
exchange rates, or advanced refund logic.

## Local authentication

Copy `.env.example` to `.env`. With no OAuth variables configured, the app
boots and shows a localized "no provider configured" sign-in state. There is
no development user bypass. To exercise a real local sign-in, configure Google
with the callback `http://localhost:3000/api/auth/callback/google`. Apple Sign
In requires an HTTPS-capable public origin and its multiline private key; see
`docs/authentication.md`.

Run `pnpm --filter @racio/database db:migrate` against the local PostgreSQL
database before opening a configured auth flow or `/en/accounts`.

A clean install needs an empty database: migrations `0000` through `0013`
apply the complete Phase 2–12 schema (Better Auth tables, user preferences,
institutions and financial accounts, CSV/XLSX/PDF statements, import jobs, raw
and confirmed transactions, categories, tags, rules, saved views, splits,
merchants, aliases, internal transfers, budgets, savings goals, alert
rules/events, advisor threads/messages/proposals, and user-owned exports)
without manual
intervention. Every
composite owner foreign key in the chain references a matching
`(id, user_id)` unique constraint that the same chain creates before it, so
the untouched chain applies from zero to the current schema. Run
`drizzle-kit check` after migrating to confirm the database matches
`packages/database/src/schema.ts`.

See `docs/accounts.md`, `docs/import-pipeline.md`, `docs/xlsx-import.md`,
`docs/pdf-import.md`, `docs/budgets-goals-alerts.md`,
`docs/ai-advisor.md`, and `docs/export.md` for the account/import, planning,
advisor, and export contracts. `docs/local-development.md`
covers the local migration and smoke flow.

The Phase 5 ledger UI includes server-owned Saved Views and a complete typed
Rule Builder. Saved Views retain validated filters, sort, archived state, and
default selection without browser storage. Rules expose deterministic conditions
and actions, preview details, manual-protection safeguards, historical
confirmation, management actions, and event history. Phase 6 adds focused split,
merchant, alias, and confirmed internal-transfer review flows without adding
dashboards or exports. Phase 10 adds `/[locale]/budgets`, `/[locale]/goals`, and
`/[locale]/alerts` with deterministic in-app alert evaluation via the
`planning.evaluate.alerts` worker job. Phase 11 adds `/[locale]/advisor`: an
optional, grounded financial advisor that works with `AI_ENABLED=false`
(everything above keeps working, and the advisor UI reports the disabled
state). When enabled, it answers questions about spending, categories,
merchants, accounts, budgets, goals, alerts, reconciliation, and recent
transactions using deterministic server-approved tools; monetary figures in
answers are rendered from validated structured facts, and the only mutation
flow is a budget proposal with server validation, preview, and explicit
confirmation. Phase 12 adds `/[locale]/export`: private user-controlled CSV,
XLSX, and archive exports with exact decimal strings, explicit currency,
split/transfer semantics preserved, CSV formula-injection defense,
versioned archive JSON, synchronous generation for small exports, the
`export.generate`/`export.cleanup` worker jobs for large exports and
retention, and 24-hour file expiry.

## Prerequisites

- Node.js 24.x
- pnpm 10.x
- Docker Desktop for the container workflow
- uv for the Python parser service

Copy `.env.example` to `.env` for local configuration. For the JavaScript
workspace, run `pnpm install`, then use `pnpm dev` or the quality-gate commands.
For the parser, run `uv sync --dev` from `apps/parser` and then
`uv run uvicorn racio_parser.main:app --reload --port 8001`.

## Documentation first

Read `SPEC.md`, `ARCHITECTURE.md`, `DESIGN.md`, and `SECURITY.md` before making
changes. The documents are the contract for scope, boundaries, visual language,
and data handling.

Production documentation: `docs/deployment.md` (topology, environment,
containers, migrations), `docs/operations.md` (runbook, jobs, backup/restore,
cleanup, retention), `docs/disaster-recovery.md`, `docs/release-checklist.md`,
`docs/security-audit.md` (threat model and findings), `.env.production.example`,
`scripts/backup/backup.sh` / `restore.sh`, `CHANGELOG.md`, and
`THIRD_PARTY_NOTICES.md`.

## Docker

`docker compose up --build` starts PostgreSQL, the web application, the worker,
and the parser on an internal network. PostgreSQL is intentionally not
published to the host by default. The development override strategy is
documented in `docker-compose.yml`.

Production example: `docker compose -f docker-compose.prod.yml --env-file
.env.production up -d` (one-shot migrations, non-root hardened containers,
internal-only parser network; see `docs/deployment.md`).
