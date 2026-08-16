# Racio architecture

## Shape and rationale

Racio uses a modular monolith for the TypeScript application plus a separate
Python document-parser service. A modular monolith keeps transactions,
classification, reconciliation, budgets, and user isolation in one deployable
application while preserving explicit package boundaries. This is simpler to
self-host than a distributed set of domain services and still leaves clear
seams for future extraction.

The parser is separate because document parsing has a different runtime,
dependency ecosystem, resource profile, and failure surface. It never connects
to PostgreSQL and returns only a neutral typed result to the app. Phase 4 uses
the Python parser service for CSV bytes, Phase 7 adds an XLSX adapter behind
the same boundary, and Phase 8 adds a text-PDF adapter. TypeScript owns file
storage, jobs, contracts, ownership, review, duplicate detection,
reconciliation, and final persistence for all formats.

## Repository structure

```text
apps/web       Next.js application and explicit REST route boundary
apps/worker    pg-boss job runner foundation
apps/parser    FastAPI parser boundary and future adapters
packages/database  Drizzle/PostgreSQL connection and migrations
packages/domain    deterministic financial-domain boundary
packages/contracts shared Zod contracts for service boundaries
packages/auth      Better Auth server boundary and ownership helpers
packages/imports   CSV/XLSX/PDF import application service and persistence workflow
packages/transactions  ledger, splits, merchants, transfers, and classification application service
packages/planning       budgets, savings goals, and deterministic alerts application service
packages/advisor        optional AI advisor application service (planner, tools, proposals, threads)
packages/ai             disabled/provider abstraction boundary for the advisor
packages/export         user-owned CSV/XLSX/archive export generation, jobs, and retention
packages/storage   local/S3-compatible storage interface
packages/i18n      locale definitions and translations
packages/ui        small accessible UI foundation
packages/config    shared environment and TypeScript configuration
docs               money, imports, AI, data model, and testing contracts
```

## Boundaries and dependency direction

```text
apps/web -> domain, contracts, auth, imports, storage, ai, i18n, ui, config, planning, advisor, export
apps/worker -> imports, domain, contracts, database, config, planning, export
apps/parser -> contracts-equivalent Python models only
imports -> auth, domain, contracts, database, storage
planning -> transactions, domain, contracts, database, auth
advisor -> ai, planning, transactions, domain, contracts, database, auth
export -> transactions, domain, contracts, database, auth, storage
domain -> contracts (where needed), no ORM, no AI
database -> config and database driver; never owns UI behaviour
```

Pure financial calculations must not import Drizzle or AI. Application services
may orchestrate packages, but React components must not be the only location of
critical domain rules. REST APIs are explicit and reusable; Server Actions are
reserved for small framework-specific interactions.

## API and contract strategy

JSON REST endpoints are the default application boundary. OpenAPI descriptions
will be added as endpoints become real. Cross-language payloads use versioned,
neutral contracts. Amounts are decimal strings, optional fields remain explicit,
and TypeScript validates parser results with Zod after transport. Python uses
Pydantic models for the equivalent parser shape.

## Data flow for imports

```text
browser -> API validation -> private temporary storage -> pg-boss job
        -> XLSX archive/workbook inspection and optional sheet selection
        -> PDF container/text inspection before text extraction
        -> parser service -> typed neutral candidates -> TypeScript validation
        -> preview/correction -> duplicate detection -> reconciliation
        -> explicit confirmation -> transaction persistence
        -> isolated future-rule classification
        -> bounded merchant-alias and transfer suggestion work -> cleanup
```

No final transaction exists before confirmation. The complete contract is in
`docs/import-pipeline.md`.

Phase 6 keeps the original confirmed transaction as the only banking event. A
split is an analytical allocation whose active amounts exactly sum to the parent
amount; it is never an additional transaction. Merchants and aliases are
user-owned metadata, and merchant normalisation never overwrites imported or
user-entered descriptions. Internal transfers link two existing same-user
transactions and are excluded from income/expense reporting only after explicit
confirmation.

Split replacement is an authenticated database transaction that locks the
parent row, validates ownership, currency, count, positive scale-6 amounts, and
the exact sum, then replaces the active set atomically. Transfer suggestions are
bounded and deterministic. Confirmed transfer links use partial unique indexes
so one transaction cannot belong to two confirmed pairs. Merchant merges record
the affected assignments and aliases in a merge event; unmerge is deliberately
limited and conflict-aware.

## Jobs, database, and storage

pg-boss is the MVP job boundary because PostgreSQL is already required and the
job state can remain close to application data. Redis and BullMQ are not
introduced: they would add another stateful service and operational burden
without a current requirement. PostgreSQL is used locally, in Docker, and in
hosted deployments to keep migrations, decimal semantics, search capabilities,
and production parity consistent. SQLite is not a supported alternate database.

Storage uses an interface with a private local filesystem adapter for the CSV
pipeline and an S3-compatible seam for later deployment work. Storage keys are
random, never public URLs, and callers own authorisation decisions.

## Parser dependencies and licence choice

The parser uses `pypdf` and `pdfplumber` for text-PDF inspection and layout
extraction, plus `pandas` and `openpyxl` for the XLSX adapter. PyMuPDF is
excluded by default because its AGPL/commercial licensing implications need an
explicit project decision before adoption. The parser has no unrestricted
internet access and enforces file, page, dimension, text-size, row, memory, and
execution-time limits before real parsing begins.

## AI and authentication seams

Phase 2 implements Better Auth 1.6.25 with the Drizzle adapter, PostgreSQL
identity/session tables, optional Google and Apple providers, secure cookies,
server-side session checks, session revocation, and account preferences. The
web app mounts Better Auth at `/api/auth/*`; pages and API routes call the
ownership helpers rather than accepting a client `userId`. `packages/ai`
remains disabled and no provider is called from the foundation. Phase 3 adds
user-owned institutions and financial accounts through the authenticated
application service in `packages/auth/src/accounts.ts`. The service takes the
session-derived owner ID internally, while the database composite foreign key
ensures an account cannot point at another user's institution.

Phase 4 adds `statement.parse.csv` to pg-boss. The worker retrieves private file
bytes, sends them to the isolated parser service, validates the returned
`racio.parser.v2` contract, and persists raw candidates only. It never creates
final transactions during parsing. Confirmation is a separate authenticated
transaction in the web application.

Phase 7 adds `statement.inspect.xlsx` and `statement.parse.xlsx`. The inspection
worker validates the OOXML ZIP container before `openpyxl` opens it, persists
only a bounded typed inspection, and either preselects the sole usable visible
sheet or waits for an authenticated sheet choice. The parse worker returns the
same neutral row fields used by CSV plus bounded workbook-cell diagnostics.

Phase 8 adds `statement.inspect.pdf` and `statement.parse.pdf`. The inspection
worker validates the PDF container, encryption, page/dimension/text-size
limits, and unsafe embedded content/actions before `pdfplumber` extracts text.
The parse worker maps the detected layout automatically and returns the same
neutral row fields plus bounded page/band diagnostics.

Phase 9 adds a read-only overview aggregation over the confirmed ledger. The
`packages/transactions` service computes per-currency cash flow, account
position, top categories and merchants, and attention counts using exact
`NUMERIC(20,6)` sums; the authenticated `/api/dashboard` route serves it and
the workspace page renders it as a document-style ledger, never mixing
currencies and never inventing a balance. Category analytics are split-aware
(active splits replace the parent allocation; uncategorized splits fall into an
uncategorized bucket), merchant analytics stay parent-level, and a single
shared "not part of a confirmed internal transfer" predicate excludes confirmed
transfers from income, expense, net cash flow, category, and merchant
analytics. Confirmed transfers remain visible in the ledger and in account-level
raw movement: financial income/expense/net is deliberately distinct from raw
account inflow/outflow.

Phase 10 adds the `packages/planning` boundary for currency-specific budgets,
savings goals, and deterministic in-app alerts. It depends on
`packages/transactions` for the shared expense predicate (debit-only,
confirmed-transfer excluded, split-aware) so the budget UI and the alert
evaluation can never disagree. Budgets are currency-specific with weekly,
monthly, yearly, or custom periods computed in the user's IANA timezone;
savings goals track either a manual saved amount or the deterministic latest
`balance_after` of a linked account; alert events are deduplicated by a
`(user_id, dedupe_key)` unique constraint and evaluated idempotently by the
`planning.evaluate.alerts` pg-boss job with a periodic sweep. The new surfaces
are `/[locale]/budgets`, `/[locale]/goals`, and `/[locale]/alerts`, with a
minimal dashboard planning summary and an unread alert indicator in the shell.

Phase 11 adds the optional AI advisor. `packages/ai` owns the provider
abstraction (`AiProvider.generateStructured`), the versioned system prompts,
and a configurable OpenAI-compatible provider; `packages/advisor` owns the
deterministic planner, the approved typed tool catalog, the advisor service,
mutation proposals, and user-owned threads/messages/proposals persistence. The
advisor is disabled by default and never touches the deterministic core: the
model has no database access, no SQL, no tool-selection authority, and no
mutation authority. Tool arguments are Zod-validated, ownership is re-checked
server-side, monetary facts are decimal strings rendered into answers from
validated fact ids, and proposals follow preview-and-confirm through existing
domain mutation services. The new surface is `/[locale]/advisor`; see
`docs/ai-advisor.md`.

Phase 12 adds `packages/export`: user-owned, deterministic, exact, and private
export generation. `packages/export` reuses the shared ledger predicate
(`buildTransactionFilterConditions`) so an export always represents exactly
the validated ledger filters, resolves saved views server-side to stored
filter snapshots, and emits CSV (UTF-8 BOM, CRLF, RFC-quoting, formula-
injection sanitization), XLSX (static cells only, exact `amount_exact` text
cells plus a marked non-authoritative numeric convenience column), and a
versioned ZIP archive (`formatVersion: "1"`, `racio-export/*.json` resources,
advisor conversations only on explicit opt-in). Small transaction exports
(≤ `EXPORT_SYNC_MAX_ROWS`) generate synchronously; large exports and the
archive go through the `export.generate` pg-boss job with repeatable-read
snapshot consistency, keyset pagination, idempotent guarded finalization, and
`export.cleanup` for 24-hour retention. Generated files live in private
storage under random keys referenced by the user-owned `exports` table and
are downloaded through authenticated `private, no-store` endpoints; no
secrets, sessions, raw import payloads, or uploaded statement files are ever
exported. The new surface is `/[locale]/export`; see `docs/export.md`.

## Migration chain ordering

The Drizzle chain `0000` through `0013` must remain applicable from an empty
PostgreSQL database. Composite owner foreign keys reference `(id, user_id)`
pairs, so each referenced `(id, user_id)` unique constraint is declared in the
same or an earlier migration than the foreign key that uses it. Later migrations
must not re-declare constraints that earlier migrations already created.
`drizzle-kit check` and a no-op `drizzle-kit generate` are part of the
database gate; see `docs/testing-strategy.md`.

## Deployment modes

The same repository supports local process development, Docker Compose for
self-hosting, and a hosted deployment. The web app should remain portable
between Node runtimes and avoid Vercel-only APIs or infrastructure assumptions.

## Future extensibility

The MVP intentionally stores one account per user-owned institution. Future
multi-account support should be introduced by a deliberate migration that
replaces the current uniqueness rule after the account identity model is
specified; it must not weaken the owner composite foreign key.

Future extraction candidates are the parser, job consumers, and optional AI
providers. The monolith remains the source of truth for ownership, financial
calculations, confirmation, reconciliation, and persistence until measured
scale proves otherwise.
