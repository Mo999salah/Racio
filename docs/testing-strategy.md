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
