# Phase 6: splits, merchants, and internal transfers

Phase 6 adds analytical structure without changing imported financial truth.
This document is the implementation contract for the three related features.

## Split invariant and representation

The confirmed transaction remains the single banking event. A transaction may
have 1-50 active splits. Each split stores a positive decimal-string amount in
the parent's currency, stable position, optional description/note, and
ownership-scoped category/tag assignments. Active split amounts must sum exactly
to the parent's absolute amount using scale-6 bigint arithmetic. A split set is
replaced atomically while the parent is locked; invalid partial sets never
persist. Removing all splits returns the transaction to unsplit semantics.

The parent amount, currency, direction, raw description, imported description,
user description, and source counterparty remain unchanged. Once splits are
saved, split categories drive allocation reporting. The parent category is kept
for traceability but is not counted alongside split categories. The parent is
never treated as an additional split.

Rules never create, delete, or change splits. Primary-category rule actions skip
split transactions; split skips are included in preview information. Parent-level
metadata actions remain subject to the existing manual-protection rules.

## Merchant model and aliases

Merchants are user-owned canonical records. Normalisation is deterministic and
explainable: Unicode NFKC, removal of control characters, whitespace collapse,
separator normalisation, and locale-independent case folding. It does not strip
numbers, store/branch identifiers, locations, or company suffixes. The source
descriptions and counterparty remain intact.

Aliases are user-owned literal patterns with one of exact normalized
description, normalized description contains, normalized description starts
with, exact counterparty, or counterparty contains. They have bounded previews,
priority, enabled/archive state, and no executable or arbitrary regex patterns.
Assignment precedence is manual, explicitly confirmed historical alias
application, enabled alias, imported counterparty hint, then unassigned. Alias
application is idempotent and never overwrites a manual assignment.

Merging requires explicit source/target confirmation and shows counts and
conflicts. Transactions and aliases move to the target, while the source is
marked merged rather than deleted. A merge event records affected IDs and
previous assignment state. Limited unmerge restores only assignments that still
point to the target and reports later manual changes as partial conflicts.

## Internal transfers

Suggestions link two existing same-user final transactions only. They must use
different accounts, the same currency, opposite directions, equal absolute
amounts, and booking dates no more than three calendar days apart. Confirmed or
incompatible transactions are excluded. Reasons are deterministic: exact
amount, same currency, opposite directions, different accounts, date distance,
and available account-name or transfer-identifier evidence. A score is only a
ranking aid, never financial truth.

Suggestions are `suggested`, `confirmed`, `rejected`, or `unlinked`. They are
generated idempotently and rejection history suppresses automatic repeats.
Confirmation and manual linking require explicit action and do not create or
modify transactions. Partial unique indexes prevent a transaction from joining
multiple confirmed pairs. Unlinking is explicit and keeps history.

Confirmed transfers remain visible in the ledger and account cash flow but are
excluded from income and expense reporting. Suggested or rejected transfers are
still ordinary income or expense. Split children are never paired as separate
transactions.

## Ownership, idempotency, and limits

Every entity is user-owned or has a composite owner foreign key to a user-owned
parent. Mutations authenticate, verify same origin, validate bounded payloads,
and perform ownership checks on the server. Split replacement, merchant merge,
alias application, and transfer confirmation are retry-safe and preserve
financial validity if a background operation fails. Responses are private and
not cached. Merchant and transfer data is not logged or sent to external
services.

Dashboards, budgets, exchange rates, exports, Excel/PDF/OCR, AI, web enrichment,
advanced refund detection, and Phase 7 are outside this document.
