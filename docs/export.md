# Phase 12: export

Phase 12 adds safe, user-controlled export of Racio data. Exports are
user-owned, deterministic, exact, bounded, and private. This document is the
implementation contract.

## Formats

| Format      | Scope                         | Content                                                         |
| ----------- | ----------------------------- | --------------------------------------------------------------- |
| CSV         | filtered or full transactions | one row per banking transaction, stable English machine headers |
| XLSX        | filtered or full transactions | `Transactions`, optional `Splits`, and `Metadata` sheets        |
| ZIP archive | all user data                 | versioned JSON resources under `racio-export/`                  |

PDF export is not part of the MVP.

## Transaction representation

One row per banking transaction (the parent row). The final confirmed ledger
state is exported, including archived transactions only when the
`includeArchived` filter is set. Columns are stable English machine headers:

```text
booking_date, value_date, description, imported_description, amount_exact,
currency, direction, account, institution, merchant, primary_category,
secondary_categories, tags, reviewed, source_type, bank_transaction_id,
internal_transfer_status, has_splits, split_count [, note]
```

- `description` is the user-visible description (user description, then
  imported description, then raw description).
- Raw internal database identifiers are not exported by default. Internal
  identifiers remain only in the structured archive, which is explicitly a
  machine-readable format.
- `note` is exported only when the user explicitly opts in (`includeNotes`).
  Notes may contain sensitive personal text and are excluded by default.

## Splits

Splits never flatten into duplicate transaction rows. The parent row carries
`has_splits` and `split_count`; active split allocations are available as a
separate `Splits` sheet/file when the user opts in (`includeSplits`), one row
per active allocation with `transaction_export_key`, `split_position`,
`amount_exact`, `currency`, `description`, categories, and tags. Archived
split versions are excluded by default. Parent rows and split rows are never
additive without labeling: the `Metadata` sheet states the representation.

## Internal transfers

Confirmed internal transfers are ordinary ledger rows in every export; they
are never hidden or deleted from the raw ledger. Each row carries
`internal_transfer_status` (`none`, `suggested`, `confirmed`, `rejected`,
`unlinked`). Reporting summaries are not part of Phase 12, so no
transfer-excluded summary is exported; the Phase 9 financial semantics remain
unchanged in the application.

## Currencies and decimal precision

- Every monetary value has an explicit ISO 4217 currency column. No value is
  ever exported without currency context and no currency is converted.
- Amounts are absolute decimal strings (`NUMERIC(20,6)` text as stored).
  There is no JavaScript floating-point transformation and no silent
  rounding; up to six fractional digits are preserved (PostgreSQL returns
  scale-6 text such as `5000.000000`).
- CSV exports the canonical decimal string in `amount_exact`.
- XLSX writes `amount_exact` as a text cell (inline string), which Excel
  cannot reinterpret or round. A separate `amount_numeric_non_authoritative`
  convenience column exists for sorting/aggregating in Excel and is
  documented as non-authoritative (Excel stores IEEE-754 doubles).

## CSV security and locale policy

- UTF-8 with a BOM so Excel renders Arabic and Turkish correctly.
- CRLF line endings; RFC-4180-style quoting (fields containing comma, quote,
  CR, or LF are quoted, inner quotes doubled).
- Stable English machine headers; the financial encoding never changes with
  the UI locale. Dates are ISO (`YYYY-MM-DD`), the decimal separator is `.`,
  and the delimiter is a comma.
- Formula-injection defense: any text cell beginning with `=`, `+`, `-`,
  `@`, `\t`, or `\r` is escaped with a leading apostrophe in the exported
  file only. Authoritative stored data is never mutated. Numbers, ISO dates,
  and currency codes never begin with a dangerous prefix, so they are not
  altered (verified by tests).

## XLSX security

Generated workbooks contain only static cells: no formulas, no macros, no
external links, no charts, no shared strings, no executable parts. Text cells
are explicit inline strings (immune to formula interpretation by
construction) and are additionally sanitized with the CSV sanitizer.
Workbook properties carry only generic application metadata ("Racio"); no
user names or email addresses are written. The header row is frozen, an
autofilter is set, and column widths are bounded.

## Structured archive

The archive is a ZIP with deterministic relative paths under `racio-export/`:

```text
racio-export/
  manifest.json
  accounts.json
  institutions.json
  transactions.json
  splits.json
  categories.json
  tags.json
  merchants.json
  transfer-links.json
  budgets.json
  goals.json
  alerts.json
  preferences.json
  [advisor.json]        # only with explicit opt-in
```

The manifest carries `formatVersion: "1"`, `generatedAt`, `application`,
`includedResources`, `locale`, `timezone`, and per-resource `counts`. Each
resource file wraps its records under a `formatVersion` key. JSON timestamps
are ISO-8601 UTC and every list is deterministically ordered. The archive is
an export format, not an import/restore format; no import compatibility is
promised.

Resource contents:

- `accounts.json` / `institutions.json` — owned accounts and institutions
  with masked identifiers only (only masked values are ever stored).
- `transactions.json` — the full ledger (confirmed and archived) with
  classifications, merchant, account, institution, transfer status, split
  flags, and exact `amount_exact`/`currency`; `note` only on opt-in.
- `splits.json` — active split allocations only.
- `categories.json`, `tags.json`, `merchants.json` (with their aliases),
  `transfer-links.json` — all statuses, including archived/merged/confirmed.
- `budgets.json`, `goals.json` — exact decimal strings with explicit
  currency.
- `alerts.json` — alert rules and alert events with safe fields only (type,
  state timestamps, entity reference, bounded metadata). Raw internal error
  or provider data is never included.
- `preferences.json` — non-secret user preferences (locale, timezone, mode,
  appearance, base currency).
- `advisor.json` — only with the explicit `includeAdvisorConversations`
  opt-in, and only user-visible message content (role, content, timestamp).
  Excluded by default.

Never exported: password hashes, session tokens, OAuth/provider secrets,
API keys, storage keys, raw import payloads, original uploaded statement
files, or provider reasoning.

## Export request model

```ts
type ExportRequest =
  | { type: 'transactions_csv'; filters: TransactionFilters; includeNotes: boolean }
  | {
      type: 'transactions_xlsx';
      filters: TransactionFilters;
      includeNotes: boolean;
      includeSplits: boolean;
    }
  | { type: 'account_archive'; includeNotes?: boolean; includeAdvisorConversations?: boolean };
```

Strict discriminated unions are enforced by Zod. Filters reuse the validated
ledger filter schema plus an optional `savedViewId`; a saved view resolves
server-side to its current validated filters and the resolved snapshot is
stored with the request, so later view edits cannot silently change an
export's scope. All filter references (account, institution, category, tag,
saved view) are ownership-validated; cross-user references return not found.

## Sync vs async generation

- Transaction exports with at most `EXPORT_SYNC_MAX_ROWS` (default 10 000)
  rows generate synchronously during `POST /api/exports`.
- Larger transaction exports and every archive request go through the
  `export.generate` pg-boss job: the row stays `preparing`, the worker
  generates the private file, and the row becomes `ready` with size and
  checksum.

Consistency: generation reads inside one repeatable-read transaction, so
concurrent writes can neither duplicate nor skip rows. Ordering is
deterministic: `booking_date ASC, created_at ASC, id ASC`, using keyset
(cursor) pagination — no offset pagination.

## Export jobs

- `export.generate` — data `{ exportId }`, `singletonKey` per export,
  retry limit 3. Retry-safe and idempotent: an already-ready row is returned
  unchanged; each attempt writes a fresh random storage key that the row
  references on finalize, so retries never create duplicate referenced
  artifacts and the stored checksum always matches the stored bytes. A
  failed attempt leaves the row `preparing` for the next retry; a crash
  between write and finalize may leave one private, unreferenced object,
  bounded by `EXPORT_MAX_FILE_BYTES`.
- `export.cleanup` — hourly. Removes storage objects of expired exports
  (`storageKey` is nulled; metadata rows remain for audit with the file
  unavailable) and marks `preparing` rows older than two hours as `failed`
  with `EXPORT_FAILED` (pg-boss retries exhausted or job lost).

## Export persistence

The user-owned `exports` table stores `id`, `user_id`, `type`, `status`,
`request_json` (validated typed JSON, no secrets), `storage_key`, `size_bytes`,
`checksum`, `row_count`, `error_code`, `created_at`, `completed_at`,
`expires_at`, and `updated_at`. Composite ownership uses the
`exports_id_user_id_unique` `(id, user_id)` constraint. Migration `0013`
adds it; the chain runs `0000` through `0013`.

## Retention

Generated files expire after `EXPORT_RETENTION_HOURS` (default 24). After
expiry the download endpoint returns `EXPORT_EXPIRED` (HTTP 410) and the
cleanup job removes the storage object. There are no public or permanent
links; every download is an authenticated private endpoint.

## API

```text
POST /api/exports              create an export (sync or queued)
GET  /api/exports              list owned exports
GET  /api/exports/:id          export detail
GET  /api/exports/:id/download authenticated private download
DELETE /api/exports/:id        delete export and its private file
```

All routes are authenticated, same-origin-protected for mutations,
`private, no-store`, strictly schema-validated, and never accept a client
`userId`. Cross-user ids return not found. Downloads send
`Content-Disposition: attachment`, the correct MIME type, and
`Cache-Control: private, no-store`. Filenames are deterministic and contain
no account numbers, IBAN fragments, merchant names, user names, or emails:
`racio-transactions-YYYY-MM-DD.csv`, `racio-transactions-YYYY-MM-DD.xlsx`,
`racio-archive-YYYY-MM-DD.zip`.

Stable error codes: `EXPORT_INVALID_REQUEST`, `EXPORT_TOO_MANY_ROWS`,
`EXPORT_TOO_LARGE`, `EXPORT_BUSY`, `EXPORT_NOT_READY`, `EXPORT_EXPIRED`,
`EXPORT_FAILED`, `EXPORT_STORAGE_ERROR`, `EXPORT_FORMAT_UNSUPPORTED`, plus
`NOT_FOUND` for cross-user or missing ids. Filesystem/storage internals are
never leaked.

## Limits

- `EXPORT_SYNC_MAX_ROWS` (default 10 000, max 250 000) — sync threshold.
- `EXPORT_MAX_ROWS` (default 250 000, max 1 000 000) — per-export row cap.
- `EXPORT_MAX_FILE_BYTES` (default 50 MB, max 500 MB) — file size cap.
- `EXPORT_MAX_ARCHIVE_RECORDS` (default 100 000, max 500 000) — archive cap.
- `EXPORT_RETENTION_HOURS` (default 24, max 720) — retention.
- `EXPORT_MAX_CONCURRENT_PER_USER` (default 3, max 20) — concurrent
  `preparing` exports.

Exceeding a limit fails with a stable error code; nothing unbounded is ever
generated.

## Logging and privacy

Logs never contain exported row contents, notes, balances, descriptions,
filenames with sensitive data, or storage keys. Safe telemetry is limited to
export id, type, status, row count, size, and stable error codes.

## UI

`/[locale]/export` is a document/data-management surface: explicit scope
summary, compact format selector, opt-in toggles (notes, splits, advisor
conversations), estimated row count, an export history list with
textual states (preparing, ready, failed, expired), private downloads,
deletion, and a concise privacy note. The transactions page links to the
export page carrying the current filters ("export current view"). Machine
CSV/XLSX headers remain English by design; the UI is localized in en/ar/tr
with RTL support.

## Limitations

- The archive is not an import/restore format and no import is promised.
- Notes and advisor conversations are opt-in and excluded by default.
- Raw import provenance (raw row payloads, original uploaded files) is not
  exported in the MVP.
- XLSX convenience numeric cells are non-authoritative (IEEE-754).
- A crash between storage write and row finalize may leave one private,
  unreferenced object per crash, bounded by the file-size limit.
- The local storage adapter is overwrite-safe by design so export retries
  cannot create duplicate artifacts.
