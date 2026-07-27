# Racio

Racio is a privacy-conscious personal-finance application for importing,
reviewing, classifying, and analysing bank-statement data. The repository now
contains the Phase 5 and Phase 6 authentication, session, preference, ownership,
institution, financial-account, CSV import, transaction-ledger, manual
classification, deterministic-rule, split, merchant, alias, and internal-
transfer foundation.

## Current boundary

The current boundary includes user-owned institutions, one financial account per
institution, CSV-only review-first import through atomic confirmation, a
server-paginated transaction ledger, user-owned categories/tags, editable
metadata, saved views, deterministic classification rules, exact transaction
splits, user-owned merchants and aliases, and explicit internal-transfer links.
It does not include dashboards, budgets, savings goals, alerts, exports, bank
APIs, Excel, PDF, OCR, AI features, exchange rates, or advanced refund logic.

## Local authentication

Copy `.env.example` to `.env`. With no OAuth variables configured, the app
boots and shows a localized "no provider configured" sign-in state. There is
no development user bypass. To exercise a real local sign-in, configure Google
with the callback `http://localhost:3000/api/auth/callback/google`. Apple Sign
In requires an HTTPS-capable public origin and its multiline private key; see
`docs/authentication.md`.

Run `pnpm --filter @racio/database db:migrate` against the local PostgreSQL
database before opening a configured auth flow or `/en/accounts`.

See `docs/accounts.md` and `docs/import-pipeline.md` for the account/import
contracts. `docs/local-development.md` covers the local migration and smoke
flow.

The Phase 5 ledger UI includes server-owned Saved Views and a complete typed
Rule Builder. Saved Views retain validated filters, sort, archived state, and
default selection without browser storage. Rules expose deterministic conditions
and actions, preview details, manual-protection safeguards, historical
confirmation, management actions, and event history. Phase 6 adds focused split,
merchant, alias, and confirmed internal-transfer review flows without adding
dashboards or exports.

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

## Docker

`docker compose up --build` starts PostgreSQL, the web application, the worker,
and the parser on an internal network. PostgreSQL is intentionally not
published to the host by default. The development override strategy is
documented in `docker-compose.yml`.
