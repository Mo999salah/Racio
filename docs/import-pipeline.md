# Statement import pipeline

Phase 4 introduced ordinary text CSV imports. Phase 7 adds bounded Office Open
XML `.xlsx` workbooks through a format-specific inspection and parsing adapter.
Phase 8 adds text-based `.pdf` bank statements through the same pipeline, with
strict container inspection and text extraction before parsing. Legacy `.xls`,
macro-enabled `.xlsm`, OCR, and scanned-image PDFs remain outside the pipeline.
After confirmation, Phase 5/6 may run deterministic classification, bounded
merchant-alias assignment, and internal-transfer suggestion work without
changing imported financial facts.

## State machine

```text
CSV:  uploaded -> parsing -> needs_mapping -> parsing -> needs_review -> ready
XLSX: uploaded -> inspecting -> needs_sheet_selection -> parsing -> needs_mapping
                                                                    |
                                                                    v
                                                                needs_review -> ready
                                                                      |           |
                                                                      v           v
                                                                    failed      imported
PDF:  uploaded -> inspecting -> parsing -> needs_review -> ready
                                          |                |
                                          v                v
                                        failed           imported
```

An XLSX with exactly one visible populated worksheet skips sheet selection. A
workbook with multiple selectable sheets, or only hidden selectable sheets,
requires an explicit user choice. `veryHidden` sheets are never selectable.
`needs_mapping` represents ambiguous headers, dates, decimal conventions, or
row bounds. `needs_review` means candidates exist and the user must resolve
warnings, exclusions, and duplicate candidates. Final confirmation is
idempotent; reconciliation mismatches require explicit acknowledgement.
PDF inspection maps the statement automatically from detected headers and
structural bands, so it never enters `needs_sheet_selection` or `needs_mapping`.

## Upload and private storage

The authenticated upload route verifies the owned account, request size,
extension, and a bounded signature before private storage. CSV adds MIME,
null-byte, text-decoding, line/field, and row checks. XLSX requires the ZIP
signature and delegates archive/XML/workbook limits to the isolated parser.
PDF requires the `%PDF-` header and delegates page/text limits to the isolated
parser. The server computes SHA-256, sanitizes only the display filename, and
stores bytes under a random private key.

The browser receives opaque record IDs and safe status only. It never receives
a filesystem path, storage key, public URL, raw file URL, or parser endpoint.
The original is deleted after successful confirmation by default. Explicit
retention keeps it private; abandoned temporary objects use bounded cleanup.

## Jobs and parser isolation

The application creates a statement and initial job in one database
transaction, then enqueues pg-boss work. CSV starts with
`statement.parse.csv`. XLSX starts with `statement.inspect.xlsx` and later uses
`statement.parse.xlsx` after deterministic or user-confirmed sheet selection.
PDF starts with `statement.inspect.pdf` and continues with `statement.parse.pdf`
after successful inspection. The worker retrieves private bytes and calls the
isolated Python parser.

The parser has no database, OAuth, AI, or storage credentials. It returns only
the versioned `racio.parser.v2` neutral contract (and the `racio.pdf-inspection.v1`
inspection contract). TypeScript validates the response and persists raw
candidates idempotently. A retry replaces candidates for the same job under an
ownership-scoped transaction and never creates final transactions.

## CSV detection and mapping

CSV supports UTF-8/BOM and safely detected legacy text encodings, comma,
semicolon, and tab delimiters, quoted fields, header rows, decimal conventions,
date formats, and candidate logical columns. Required data is booking date,
description, and either amount or debit/credit. Optional data includes value
date, currency, balance, counterparty, and transaction identifier.

A consistent currency column wins; otherwise the user may select statement or
account currency. Currency is never inferred from locale. Ambiguous mappings
are saved as a statement-local snapshot.

## XLSX inspection and mapping

Before any workbook object model is loaded, the parser validates archive paths,
relationships, encryption indicators, entry counts, compressed/expanded sizes,
compression ratios, XML declarations, worksheet dimensions, populated cells,
formulas, merged ranges, shared strings, and per-cell text sizes. It rejects
macros, ActiveX, embedded files, external links, connections, query tables, and
unsupported binary formats. Exact limits and stable errors are documented in
[XLSX import](./xlsx-import.md).

Worksheet identity is persisted by relationship-resolved sheet name, index, and
part identifier. Mapping records selected sheet, one-based header/data row
bounds, zero-based source column indexes, Excel letters, observed cell types,
and number-format hints. Hidden sheets require advanced mode and explicit
choice; `veryHidden` and empty sheets are rejected.

## PDF inspection and parsing

Before any text is trusted, the parser validates the PDF container: header,
cross-reference, object structure, encryption, page count, page dimensions,
text character and word counts, and embedded files or unsafe actions. Limits,
encrypted/embedded/action rejections, and stable errors are documented in
[PDF import](./pdf-import.md).

The parser extracts text with geometric word/line layout and detects structural
headers, description bands, amount columns, balance bands, and the statement
period. Direction markers are authoritative; yearless dates are inferred only
from a detected period. Mapping for PDF is automatic and stored as a
statement-local snapshot; it is never left to ambiguous user mapping. The
inspection record stores page samples and document warnings for diagnostics.

## Raw values, corrections, and review

Original row payloads and raw cell text are immutable. Parsed values are
separate. Corrections append field, previous value, corrected value, timestamp,
and authenticated user metadata; they never overwrite raw data. Rows may be
`valid`, `needs_review`, `invalid`, `excluded`, or `duplicate_candidate`.
Unresolved invalid rows block confirmation.

Easy mode presents essential values and plain status. Advanced mode adds source
row, CSV encoding/delimiter or XLSX coordinate/type/number-format metadata or
PDF page/band diagnostics, confidence, warnings, and mapping details.
Formula-like CSV values remain untrusted text. XLSX formulas are never
evaluated: only an existing cached value may be imported. Formula text remains
private forensic metadata and is not rendered in ordinary review.

## Precision, dates, and reconciliation

Amounts cross boundaries as decimal strings and persist in `NUMERIC(20,6)`.
Debit/credit values are absolute with a separate direction. Values beyond six
fractional digits are rejected rather than rounded, except for the narrow XLSX
display-artifact rule documented below.

XLSX numeric cells use their raw worksheet XML token, not a binary float. A
likely display artifact may be normalized only when a fixed decimal format
proves at most six displayed fractional digits and the exact delta is at most
`1e-12`; the raw token and a warning remain. Excel 1900 and 1904 date systems
are supported. The fictitious 1900-02-29 serial is rejected. Ambiguous text
dates require mapping or review.

Reconciliation operates only in original statement currency. It checks opening
plus credits minus debits against closing balance, or reliable row-balance
continuity. Results are `matched`, `mismatch`, or `unverifiable`, with an exact
decimal difference and safe reason. A mismatch requires explicit confirmation
and remains marked unresolved.

## Duplicates, confirmation, and post-processing

SHA-256 identifies prior uploads for the same user/account. A user may reprocess
a prior file without deleting history. Transaction fingerprints include user,
account, dates, absolute amount, direction, currency, normalized description,
balance, bank ID, and source context. Exact and probable matches are review
candidates, never automatic deletions.

Upload idempotency keys prevent repeated statement creation. Inspection,
selection, mapping, and parse retries reuse statement/job identity. Confirmation
rechecks ownership and current candidates inside one transaction, rejects
unresolved rows, applies the explicit mismatch decision, inserts final
transactions, records one confirmation marker, and updates state atomically.
Concurrent confirmation creates one transaction set.

After commit, enabled typed classification rules, merchant aliases, and bounded
internal-transfer suggestions may run against new transaction IDs. These steps
cannot alter source facts or roll back the confirmed ledger. Logs exclude
financial content and sensitive rule, merchant, alias, and transfer data.

## Supported and unsupported formats

CSV supports bounded text statements with the documented encodings, delimiters,
quotes, Arabic/English/Turkish text, decimal conventions, optional fields, empty
trailing rows, and embedded delimiters in quoted descriptions.

XLSX supports non-encrypted, macro-free Office Open XML workbooks within the
documented limits, multiple visible/hidden sheets, 1900/1904 dates, cached
formula results, repeated headings, merged title rows, and the shared
review/confirmation pipeline.

PDF supports text-based, non-encrypted statements with a detected transaction
table, geometric layout extraction, Arabic/English/Turkish text, direction
markers, yearless dates within a detected period, and the shared
review/confirmation pipeline.

Not supported: binary `.xls`, `.xlsm`, encrypted/password-protected workbooks
or PDFs, external links or embedded content, malformed/extreme archives, XML,
or PDFs, uncached formula results, scanned/image-only PDFs with no usable text,
ambiguous values without mapping, OCR, images, and bank-specific semantics that
cannot be mapped safely.
