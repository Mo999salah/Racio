# Testing strategy

Testing is proportional to risk. A small styling change does not require a
full integration suite; a change to money, ownership, parsing, or persistence
does.

## Level 1: routine change

Run targeted unit tests, typecheck for affected packages, and lint for affected
files or packages. Add a focused browser check only when the change affects a
browser workflow.

## Level 2: major phase gate

Run broader checks after the repository foundation, authentication and user
isolation, each complete file-import pipeline, core financial calculations,
dashboard, AI action execution, security hardening, and release-candidate
milestones. The gate may include full lint, full typecheck, relevant unit and
integration tests, essential end-to-end tests, and parser tests when Python is
affected.

## Level 3: release candidate

Run the complete verification suite: JavaScript lint, typecheck, unit and
integration tests, essential end-to-end flows, Python ruff, mypy, pytest,
Docker health checks, document validation, and a security review of changed
boundaries.

## Phase 1 targeted contracts

The foundation protects web boot, locale selection, Arabic RTL, mode preference,
parser health, TypeScript and Python parser contracts, database bootstrap, worker
startup/shutdown where practical, and Compose health configuration. It does not
include a large end-to-end suite.

## Phase 2 targeted contracts

The authentication gate covers provider availability, no-provider boot,
production secret validation, protected-page redirects, OAuth callback failure
state, sign-out, session revocation, safe internal redirects, preference schema
validation, default creation, two-user ownership isolation, and Arabic RTL.
The browser smoke path is: public sign-in -> configured provider callback ->
protected workspace -> settings persistence -> sessions -> sign-out. A real
OAuth provider is required for the callback portion; unit tests use the auth
boundary and test doubles instead of fake production credentials.

## Phase 3 targeted contracts

The institutions/accounts gate covers deterministic institution-name
normalization, masked identifier rejection, Zod payloads, PostgreSQL migration
generation, the per-user institution-name and account-per-institution unique
rules, the composite owner foreign key, protected list/create/read/update
routes, not-found behavior for another user's IDs, and archive/restore state.
The essential browser path is: authenticated account page -> add institution ->
add account -> edit account -> archive -> show archived -> restore, repeated in
Arabic, English, and Turkish with easy and advanced modes. A live two-user
database integration test must run against PostgreSQL before release; when no
database is available locally, the migration and unit/contract checks remain
valid evidence but do not replace that integration test.

## Phase 4 targeted contracts

The CSV gate covers private upload validation, checksum and idempotency,
encoding/delimiter/quote detection, deterministic column mapping, decimal/date
parsing, direction derivation, raw-versus-corrected values, row validation,
duplicate fingerprints, reconciliation, pg-boss retry idempotency, ownership,
atomic confirmation, retention cleanup, and Arabic/English/Turkish review flows.
The parser contract is `racio.parser.v2`; it transports decimal strings and
never connects to PostgreSQL. PostgreSQL integration is required for ownership,
atomicity, retry, and uniqueness claims. Browser verification must cover valid
upload, ambiguous mapping, correction, exclusion, duplicate warning, matched
confirmation, mismatch acknowledgement, revisit, and cross-user URL denial.

## Phase 5 targeted contracts

The ledger gate covers server-side pagination and filters, immutable imported
financial fields, editable metadata, category/tag ownership and archive state,
bounded bulk classification, deterministic rule matching and ordering,
manual-override protection, shared preview/execution semantics, idempotent
future and historical application, conflict-aware revert, default-category
seeding, saved-view validation, and Arabic/English/Turkish ledger flows.
PostgreSQL integration is required for composite ownership, partial uniqueness,
concurrent seeding, rule idempotency, and cross-user isolation. Browser checks
must cover ledger loading, filters, detail editing, categories, tags, notes,
bulk actions, rule preview/application, and saved views.

The focused management contract tests cover Saved View archived-state and sort
round trips, unknown-field rejection, complete multi-condition/multi-action rule
documents, all/any matching, and decimal values with 0, 2, 3, and 6 fractional
places. Browser verification should additionally click every Saved View action,
open a default view, exercise an invalid-reference warning, create a rule from a
transaction, edit conditions/actions, preview, confirm a bounded historical run,
toggle/archive/restore a rule, and revert one history event.

## Phase 6 targeted contracts

Split tests cover exact scale-6 allocation, zero/two/three/six decimal places,
under/over allocation, invalid precision, positive amounts, currency matching,
count bounds, reordering, removal, atomic replacement, unchanged parent facts,
and no double counting. Merchant tests cover explainable normalisation, literal
alias matching, precedence, manual protection, archive state, idempotency,
merge, and conflict-aware unmerge. Transfer tests cover eligibility, date
window, same-account/direction/currency rejection, deterministic reasons,
rejection suppression, idempotency, unlinking, and confirmed-only reporting
exclusion. PostgreSQL integration remains required for composite ownership,
atomic split replacement, merge preservation, and transfer uniqueness. Focused
browser checks cover split editing, merchant assignment/alias preview and
merge, transfer confirmation/rejection/unlinking, Arabic RTL, and cross-user
not-found behavior.

## Phase 7 targeted contracts

The XLSX gate covers archive traversal, duplicate entries, encryption hints,
compression expansion, macros, ActiveX, embeddings, external links,
connections, XML entities, shared strings, worksheet/row/column/cell/formula/
merged-range/text limits, malformed content, timeouts, and stable safe errors.
Fixtures cover English, Arabic, Turkish, debit/credit, multi-sheet,
hidden/veryHidden, merged title rows, repeated headers, footers, 1900/1904
dates, cached/uncached formulas, decimal precision, floating-display artifacts,
and unsupported `.xls`/`.xlsm`.

PostgreSQL integration must prove two-user ownership isolation, private metadata,
idempotent inspection/selection/parsing/confirmation, CSV/XLSX/PDF coexistence,
atomic final persistence, raw-versus-corrected immutability, duplicate and
reconciliation reuse, and Phase 5/6 post-confirmation jobs. Browser checks cover
valid upload, automatic and explicit sheet selection, hidden-sheet advanced
selection, mapping, row review, formula warnings, confirmation, revisit,
localized failures, keyboard use, Arabic RTL, mobile layouts, and cross-user URL
denial. Mock-only persistence tests do not satisfy this gate.

## Phase 8 targeted contracts

The PDF gate covers the `%PDF-` header, container structure, encryption
indicators, page/dimension/text-size/candidate limits, embedded files, unsafe
actions, password-protected content, malformed documents, timeouts, and stable
safe errors. Fixtures cover English, Arabic, Turkish, debit/credit, period and
yearless dates, direction markers, opening/closing balance reconciliation,
repeated structural headers, description bands, amount-column modes, decimal
conventions, and image-only PDFs.

PostgreSQL integration must prove two-user ownership isolation, private
metadata, idempotent inspect/parse/confirm, CSV/XLSX/PDF coexistence, atomic
final persistence, reconciliation reuse, and merchant-alias assignment after
confirmation. A real parser integration test drives an actual text PDF through
inspection, parsing, review, confirmation, and post-import alias matching
against PostgreSQL. Browser checks cover PDF upload, security notice,
inspection diagnostics, review, confirmation, localized failures, keyboard use,
Arabic RTL, and cross-user URL denial. Mock-only persistence tests do not
satisfy this gate.

## Migration chain contract

The Drizzle chain `0000` through `0013` must apply from a completely empty
PostgreSQL database to the current schema without manual intervention. Each
composite owner foreign key must reference a `(id, user_id)` unique constraint
that an earlier statement in the chain creates; the chain must never rely on
constraints added only by a later migration. Verify with a fresh database and
`drizzle-kit check` (and a `drizzle-kit generate` no-op) before release and
whenever a migration is edited. Existing development databases that were built
outside the chain are not part of the clean-install path and should be rebuilt
from migrations.

## Phase 10 targeted contracts

The planning gate covers budget period boundaries (weekly Monday start, calendar
month/year, custom range, timezone-derived today), exact split-aware and
transfer-excluded spending, account and category scopes, multi-currency
rejection, threshold status (approaching/exceeded/complete/healthy), rollover
(positive-unused, bounded), zero-spend and over-budget amounts, and 0/2/3/6
decimal precision. Goal tests cover manual exactness, account-balance
provenance, missing balance, currency mismatch rejection, target exceeded,
target date, and archive/restore. Alert tests cover one-shot budget 80%/100%
events, dedupe on repeated and concurrent evaluation, reconciliation-mismatch
dedupe, uncategorized threshold, goal milestone one-shot behaviour, read and
dismiss state, disabled rules, and cross-user access.

PostgreSQL integration is required for two-user ownership isolation, budget
category/account ownership, goal account ownership, exact split-aware spending,
confirmed transfer exclusion, goal balance provenance, alert dedupe uniqueness,
and concurrent evaluation. The chain now runs `0000` through `0011`; verify a
clean install from zero and an upgrade from the Phase 9 schema. Focused browser
checks cover create monthly budget, budget reflecting imported spending,
split-aware category budget, exceeded state, manual and account-balance goals,
balance-unavailable state, alert read/dismiss, Arabic RTL, mobile, dark mode,
and cross-user denial. The essential full flow is: budget -> imported spending
-> threshold alert -> read/dismiss, plus a goal from creation to progress
update.

## Phase 11 targeted contracts

The AI-advisor gate covers optionality (app boots and works with
`AI_ENABLED=false`, no provider called, startup without credentials when
disabled), the provider boundary (disabled runtime, valid structured output,
malformed JSON, timeout, provider error, rate limit, context limit, bounded
retries), the deterministic planner (en/ar/tr date phrases resolved in the
user timezone, topic mapping, currency/account detection, comparison intent,
proposal intent, unsupported questions), the approved tool catalog (unknown
tools and malformed arguments rejected, bounded top-N results, per-currency
decimal strings, transaction samples bounded and notes excluded), prompt
injection containment (malicious transaction descriptions, merchant names,
and questions stay inert data and never reach system instructions; no SQL, no
privilege escalation, no bypassed confirmation), answer validation (unknown
fact ids/placeholders rejected with one bounded repair retry; exact amounts
rendered server-side from fact ids), and multi-currency separation (never
combined, never converted).

Proposal tests cover typed union validation, ownership of every referenced
entity, currency and decimal precision rules, deterministic preview
(create-budget preview reports the shared-predicate current-period spending),
explicit confirmation required, stale proposals rejected and marked expired,
tampered stored payloads rejected as unsafe, idempotent duplicate
confirmation, and cross-user proposals returning not found. Conversation
tests cover user ownership, bounded message contents, archive/restore/delete,
hard-delete message removal, blocked appends to archived threads, no
tool-result or chain-of-thought storage, cross-user thread denial, and the
independence of proposals from conversation deletion (pending proposals keep
their expiry, completed results stay valid and idempotent).

Clarification tests cover temporally ambiguous questions (no financial tool
executed, no provider call before clarification, deterministic timezone-
resolved options in English/Arabic/Turkish), explicit phrases ("this month",
"last 30 days") resolving normally, validated context ranges resolving
ambiguity, invalid client-supplied date ranges rejected by the query
contract, and resubmitting a chosen option producing the exact explicit
scope. A scope with no data answers deterministically without a provider
call.

PostgreSQL integration is required for two-user ownership isolation across
accounts, categories, budgets, goals, transactions, threads, and proposals,
for the full proposal lifecycle, for the conversation lifecycle, and for the
advisor tool results over real ledger state. The chain now runs `0000`
through `0012`; verify a clean install
from zero and an upgrade from the Phase 10 schema, `drizzle-kit check`, and a
no-op `db:generate`. Provider tests use deterministic mocks and doubles; no
real paid API call is required in CI. Focused browser checks cover the
disabled state, a period-summary question, multi-currency answers, category
drill-downs, budget and goal questions, reconciliation explanation, proposal
preview/confirm/cancel, provider-error state, clarification option selection,
conversation archive/restore/delete with confirmation, Arabic RTL, mobile, and
dark mode.

## Phase 12 targeted contracts

The export gate covers CSV exactness and safety (UTF-8 BOM, CRLF, RFC quoting,
stable English headers, Arabic/Turkish content, exact decimal strings, explicit
currency columns, formula-injection prefixes `=`, `+`, `-`, `@`, `\t`, `\r`
escaped in the exported representation only, numbers/dates/currency codes
unaltered), XLSX generation (valid archive, `Transactions`/`Splits`/`Metadata`
sheets, static cells only, no formulas/macros/external links/executable parts,
exact `amount_exact` text cells, non-authoritative numeric convenience column,
unicode preserved, no user-identifying workbook metadata, frozen header and
autofilter), the versioned archive (`formatVersion: "1"`, `racio-export/`
entries with deterministic relative paths, valid JSON, exact money strings,
user-only data, no auth/session/provider secrets, no advisor conversations by
default, opt-in advisor export of user-visible content only), and the
transaction export semantics (all-user, filtered date range, account,
category, currency, saved-view resolution, confirmed transfers present in the
ledger with their status, parent-level splits with `has_splits`/`split_count`,
active splits only, archived split versions excluded, notes excluded by default
and opt-in, deterministic `booking_date/created_at/id` ordering, sync threshold
and stable error codes).

PostgreSQL integration is required for two-user ownership isolation (exporting
another user's account or saved view, downloading/deleting/inspecting another
user's export, cross-user ids returning not found), the async flow
(create → worker `export.generate` → ready with size/checksum → authenticated
download), retry idempotency (single referenced artifact, guarded finalization,
delete-while-running), worker failure recovery, stale-preparing cleanup,
expiry and `export.cleanup` (file removed, `EXPORT_EXPIRED` on download),
concurrency and row limits (`EXPORT_BUSY`, `EXPORT_TOO_MANY_ROWS`), and
storage-failure handling (`EXPORT_STORAGE_ERROR`). The chain now runs `0000`
through `0013`; verify a clean install from zero, an upgrade from the
Phase 11 schema, `drizzle-kit check`, and a no-op `db:generate`. Focused
browser checks cover exporting the current filtered transaction view as CSV,
XLSX export, full-archive generation, downloading a ready export, expired and
failed states, deletion, Arabic RTL, mobile, dark mode, and cross-user export
URL rejection.

## Phase 13 release gate

The Phase 13 gate runs the full release checklist (`docs/release-checklist.md`):
lint, typecheck, unit + integration tests against real PostgreSQL
(`RACIO_RUN_DB_INTEGRATION=1`, `RACIO_RUN_PARSER_INTEGRATION=1`), production
build, format and docs validation, parser ruff/mypy/pytest, Playwright
critical suites on Chromium (and Firefox locally), the production-mode
security suite (`test:e2e:prod`: security headers, CSP nonces, readiness,
test-fixture inertness), migration clean-install and upgrade verification
(`drizzle-kit check`, no-op `db:generate`), a backup/restore drill with
row-count parity and app smoke, and production container build/start with
in-network health probes. Browser E2E requires the guarded test-only session
fixture (`RACIO_E2E=1`, 404 in production) documented in
`docs/local-development.md`.
