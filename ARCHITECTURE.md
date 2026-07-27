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
the Python parser service for CSV bytes; TypeScript owns file storage, jobs,
contracts, ownership, review, duplicate detection, reconciliation, and final
persistence.

## Repository structure

```text
apps/web       Next.js application and explicit REST route boundary
apps/worker    pg-boss job runner foundation
apps/parser    FastAPI parser boundary and future adapters
packages/database  Drizzle/PostgreSQL connection and migrations
packages/domain    deterministic financial-domain boundary
packages/contracts shared Zod contracts for service boundaries
packages/auth      Better Auth server boundary and ownership helpers
packages/imports   CSV import application service and persistence workflow
packages/transactions  ledger, splits, merchants, transfers, and classification application service
packages/storage   local/S3-compatible storage interface
packages/ai        disabled/provider abstraction boundary
packages/i18n      locale definitions and translations
packages/ui        small accessible UI foundation
packages/config    shared environment and TypeScript configuration
docs               money, imports, AI, data model, and testing contracts
```

## Boundaries and dependency direction

```text
apps/web -> domain, contracts, auth, imports, storage, ai, i18n, ui, config
apps/worker -> imports, domain, contracts, database, config
apps/parser -> contracts-equivalent Python models only
imports -> auth, domain, contracts, database, storage
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
        -> parser service -> typed result -> TypeScript validation
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

The parser prepares `pypdf`, `pdfplumber`, `pandas`, and `openpyxl` for future
adapters. PyMuPDF is excluded by default because its AGPL/commercial licensing
implications need an explicit project decision before adoption. The parser has
no unrestricted internet access and must enforce file, page, row, memory, and
execution-time limits when real parsing begins.

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
