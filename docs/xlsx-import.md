# XLSX statement import

Phase 7 adds standard Office Open XML `.xlsx` bank statements to the existing
review-first import pipeline. It does not add `.xls`, `.xlsb`, `.xlsm`, `.ods`,
PDF, OCR, image parsing, macros, external-link fetching, or multi-sheet
combination.

## Pipeline and contracts

An authenticated upload is stored under a random private key and creates a
`statement.inspect.xlsx` job. The isolated parser first returns a bounded
`WorkbookInspection`: sheet identity and visibility, estimated dimensions,
populated/formula/merged counts, short sample rows, and stable warnings. One
usable visible sheet is preselected; multiple visible sheets move the statement
to `needs_sheet_selection` and require an authenticated choice.

The selected sheet is parsed by `statement.parse.xlsx`. Deterministic header
scoring detects the header and first meaningful data row. Ambiguity moves the
shared statement to `needs_mapping`, where the existing logical fields are used:
booking date, value date, description, amount or debit/credit, currency,
balance, counterparty, and transaction identifier. XLSX mapping adds the sheet,
header row, first data row, optional last data row, column indexes/letters, cell
type hints, and number-format hints.

The parser returns the same neutral candidate fields as CSV. The existing raw
row persistence, corrections, duplicate detection, reconciliation, review,
atomic confirmation, classification rules, merchant aliases, transfer
suggestions, and cleanup services remain format-independent.

## Archive security

XLSX is an untrusted ZIP container. Before `openpyxl` opens it, the parser checks
the ZIP signature, safe relative entry names, duplicate names, encryption flags,
entry count, per-entry and total expanded size, compression ratio, required
OOXML parts and content types, relationship targets, and XML declarations.
DOCTYPE/entity declarations, external relationships, macro content, ActiveX,
embedded OLE/package objects, and malformed archives are rejected. Excel,
LibreOffice, shell conversion, formula evaluation, and network access are never
used.

Stable error codes are returned without ZIP entry names, XML details, storage
keys, tracebacks, formulas, descriptions, or financial values.

The development Compose profile also applies a 512 MiB parser memory ceiling, a
bounded process count, a read-only root filesystem, and a 64 MiB temporary
filesystem. Production runtimes must enforce equivalent process/container
limits in addition to the application-level archive and worksheet limits.

## Conservative defaults

Defaults are configurable and a breach rejects the complete workbook:

| Limit                             |           Default |
| --------------------------------- | ----------------: |
| Upload and compressed archive     |            20 MiB |
| Total uncompressed content        |           100 MiB |
| Compressed-to-uncompressed ratio  |             100:1 |
| ZIP entries                       |             2,048 |
| Worksheets                        |                32 |
| Rows in the selected worksheet    |           100,000 |
| Columns in the selected worksheet |               256 |
| Populated cells                   |           500,000 |
| Shared strings                    |           250,000 |
| Cell text                         | 20,000 characters |
| Formula cells                     |            10,000 |
| Merged ranges                     |             2,000 |
| Parser request                    |        30 seconds |

Samples are capped independently so a large valid worksheet is never rendered
in full in the browser. No limit is implemented by silent truncation.

## Formulas and raw cells

Formulas are never executed or evaluated. The adapter opens one workbook view
with formulas and a second `data_only` view. A formula can supply a mapped value
only when the file already contains a safe cached value. The raw row records the
cell coordinate, type, stored/displayed text, number format, bounded formula
text, and cache flag. A required formula without a cached value makes the row
invalid or review-required. Text beginning with `=`, `+`, `-`, or `@` remains
plain text.

Merged ranges are read without mutating the workbook. Title/header regions may
be skipped, but merged values are not copied into financial rows. Ambiguous
merged headers require mapping confirmation.

## Decimal precision

Money crosses Python and TypeScript boundaries only as decimal strings.
Worksheet XML numeric tokens are read as decimal text and converted with Python
`Decimal`; monetary arithmetic never uses Python `float` or JavaScript
`Number`. Genuine values with more than six fractional digits or more than
fourteen integer digits are rejected.

For a binary artefact such as `12.340000000000002`, normalisation is permitted
only when the cell's fixed decimal number format explicitly displays at most six
places and quantising to that displayed precision changes the value by no more
than `0.000000000001`. The row receives a precision-normalised warning. Any
uncertainty remains review-required; source text is preserved.

## Dates and locale

The workbook epoch is recorded as `1900` or `1904`. Numeric cells are treated as
dates only when their cell/column evidence is date-like. Serial 60 in the 1900
system is rejected because Excel's compatibility calendar represents a
nonexistent leap day. Date-times are reduced to date-only without a timezone
conversion. Text dates reuse deterministic Arabic/English/Turkish-compatible
formats; ambiguous text remains review-required.

Currency precedence remains explicit row currency, explicit statement mapping,
then the selected account currency when there is no conflict. Locale, workbook
language, number-format symbols, and institution country are not authoritative
currency sources.

## Retention, duplicates, and confirmation

The original workbook remains private. It is removed after successful
confirmation unless retention was explicitly chosen; abandoned temporary files
are claimed and removed by an hourly cleanup job after the configurable
retention window (24 hours by default). Raw workbook data, mappings, warnings,
corrections, and final values are separate.

Duplicate matching reuses the existing transaction fingerprint. Workbook
checksum, selected sheet, and source row remain adjacent source evidence rather
than changing the shared fingerprint contract. Duplicates are review candidates,
never deleted automatically. Reconciliation uses the same exact scale-6
arithmetic and original currency as CSV. Final transactions are inserted once
by the existing atomic confirmation service.

## Known limitations

Only one selected worksheet is imported per statement. Very-hidden sheets are
unavailable. Hidden sheets require advanced mode and explicit selection.
Password-protected workbooks, external links, macro-enabled content, embedded
objects, unsupported date systems, unsafe formula cells, and workbooks over a
configured limit are rejected. Cached formula values depend on what the
producing spreadsheet application saved in the file; Racio never computes them.
