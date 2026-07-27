# CSV import pipeline

Phase 4 implements only ordinary text CSV imports. Excel, PDF, OCR, and images
remain outside the import pipeline. After confirmation, Phase 5/6 may run
deterministic classification, bounded merchant-alias assignment, and internal-
transfer suggestion work without changing the imported financial facts.

## State machine

```text
uploaded -> parsing -> needs_mapping -> parsing -> needs_review -> ready
                                                       |           |
                                                       v           v
                                                     failed      imported
```

`needs_mapping` is used for ambiguous headers, dates, or decimal conventions.
`needs_review` means candidates exist and the user must resolve required fields,
warnings, exclusions, and duplicate candidates. `ready` means the server has
validated the current review state. Final confirmation is idempotent and moves
the statement to `imported`; mismatch confirmation is recorded as unresolved.

## Upload and storage

The authenticated upload route verifies the selected account, request size,
`.csv` extension, MIME hint, null bytes, text decodability, line/field limits,
and maximum row count. It computes SHA-256, sanitizes only the display filename,
and stores bytes under a random private key. The default is to delete the
original after successful confirmation. Retention keeps the object privately;
failed or abandoned objects are cleaned by the bounded orphan-cleanup service.

The browser receives statement/job status and opaque record IDs only. It never
receives a filesystem path, storage key, public URL, or raw file URL.

## Jobs and parser

The web application creates a statement and `statement.parse.csv` job in one
database transaction, then enqueues pg-boss work. The worker retrieves the
private bytes and sends them to the isolated Python parser service. The parser
has no database access and returns only the versioned `racio.parser.v2` contract.
TypeScript validates the response, persists raw candidates idempotently, and
updates the statement. A parse retry replaces candidates for the same job under
an ownership-scoped transaction; it never creates final transactions.

## CSV detection and mapping

The parser detects UTF-8/BOM and safely supported legacy text encodings, comma,
semicolon, and tab delimiters, quoted fields, header rows, decimal conventions,
date formats, and candidate logical columns. Supported fields are booking date,
value date, description, amount, debit, credit, currency, balance,
counterparty, and transaction identifier.

Booking date, description, and either amount or debit/credit are required. A
currency column wins when consistent; otherwise the user may choose a
statement-level currency or the account currency. Currency is never inferred
from locale. Ambiguous mappings become `needs_mapping` and are saved as a
statement-local mapping snapshot.

## Raw, corrections, and review

The original row payload and raw cell text are immutable. Parsed values are
stored separately. Corrections append field, previous value, corrected value,
timestamp, and authenticated user metadata to `user_corrections`; they never
overwrite raw data. Rows are `valid`, `needs_review`, `invalid`, `excluded`, or
`duplicate_candidate`. Invalid rows block confirmation until excluded or fixed.

Easy mode shows essential values and plain status text. Advanced mode adds raw
payload, source row, encoding, delimiter, confidence, warnings, and mapping
metadata. CSV values are rendered as text; formula-like values remain untrusted
text and are never evaluated.

## Amounts, dates, and reconciliation

Amounts remain decimal strings and are persisted in `NUMERIC(20,6)` columns.
The parser supports decimal point/comma, thousands separators, signs, and
documented parentheses negatives, but rejects inconsistent or ambiguous rows.
Values above six fractional digits are rejected rather than rounded or
truncated. Stored amount is absolute and direction is separate. Dates are
parsed only when the column-wide convention is sufficiently clear; ambiguous
dates require mapping or review. Raw date text remains in the row payload.

After the final transaction insert commits, the application may run enabled
typed classification rules, enabled merchant aliases, and bounded internal-
transfer suggestion detection against the new transaction IDs. These are
isolated post-confirmation steps: a failure does not roll back the confirmed
financial ledger and sensitive rule, merchant, alias, transfer, or transaction
data is not exposed in logs. Alias assignment never overwrites a manual
merchant assignment, and suggestions are never confirmed automatically.

Reconciliation uses original statement currency only. It compares opening plus
credits minus debits with closing balance, or reliable row-balance continuity
when available. Results are `matched`, `mismatch`, or `unverifiable`, with a
decimal difference and safe reason. A mismatch requires explicit confirmation;
the imported statement remains marked unresolved.

## Duplicates and idempotency

File SHA-256 identifies exact prior uploads for the same user/account. The user
may reprocess a prior file, which creates a new statement/job without deleting
history. Transaction fingerprints use user, account, dates, absolute amount,
direction, currency, normalized description, balance, bank ID, and source
context. Exact and probable matches are review candidates, never automatic
deletions.

Upload idempotency keys prevent repeated statement creation. Parse retries use
the job/statement identity and replace raw candidates atomically. Confirmation
locks or rechecks the statement and uses a unique import confirmation marker;
retries return the existing imported result and concurrent confirmation creates
one transaction set.

## Confirmation and cleanup

The server re-fetches current candidates and ownership inside one transaction,
rejects unresolved invalid rows, applies the explicit mismatch decision, inserts
final transactions, updates statement/job state, records confirmation, and
cleans temporary storage. Any failure rolls back final persistence. A separate
cleanup service removes abandoned temporary objects after the documented window;
retained originals are not touched.

## Supported and unsupported formats

Supported: UTF-8/BOM, safely detected common legacy encodings, comma/semicolon/
tab delimiters, quoted fields, Arabic/English/Turkish text, decimal point/comma,
optional debit/credit, balance, currency, dates, IDs, extra columns, empty
trailing rows, and embedded delimiters in quoted descriptions.

Not universal: binary files, unsupported encodings, malformed CSV, extreme row or
field sizes, ambiguous dates/amounts without mapping, Excel, XLSX/XLS, PDF, OCR,
images, and bank-specific semantics that cannot be mapped safely.
