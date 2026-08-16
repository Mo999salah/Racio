# PDF statement import

Phase 8 adds text-based `.pdf` bank statements to the existing review-first
import pipeline. It does not add OCR, scanned-image parsing, `.xps`, encrypted
PDFs, embedded files, unsafe actions, or combining a PDF with other formats.

## Pipeline and contracts

An authenticated upload is stored under a random private key and creates a
`statement.inspect.pdf` job. The isolated parser first returns a bounded
`PdfInspection` (`racio.pdf-inspection.v1`): page count, encryption flag,
text usability, text character count, per-page dimensions and word/image
counts, short sample lines, and stable document warnings. A PDF with no usable text and only image content (image-only scan) is rejected before parsing.

Successful inspection creates `statement.parse.pdf`. The parser detects
structural headers, description bands, amount columns, balance bands, the
statement period, and direction markers. Mapping for PDF is automatic: it is
stored as a statement-local snapshot and never moves the statement to
`needs_mapping`. The statement goes straight from parsing to `needs_review` or
`ready`.

The parser returns the same neutral candidate fields as CSV and XLSX plus a
bounded page/band diagnostic (`sourcePage`, raw lines, bounding box, and parser
strategy). The existing raw row persistence, corrections, duplicate detection,
reconciliation, review, atomic confirmation, classification rules, merchant
aliases, transfer suggestions, and cleanup services remain
format-independent.

## Container and text security

A PDF is an untrusted structured document. Before `pdfplumber` extracts any
text, the parser validates the `%PDF-` header, the cross-reference and object
structure, encryption indicators, page count, page dimensions, text character
and word counts, and embedded-file/action indicators. Password-protected PDFs,
embedded files, and unsafe actions are rejected. PDF objects are never
executed, JavaScript/OpenAction content is never run, and the parser has no
network access.

Text is extracted as geometric words and lines. Amounts are kept as the raw
word text plus a parsed absolute decimal string and a separate direction;
malformed amounts are preserved raw and left for review. PDF formula-like or
computed content is never evaluated.

Stable error codes are returned without object indexes, raw PDF content,
storage keys, tracebacks, or financial values.

The development Compose profile also applies the same bounded memory, process,
read-only root, and temporary-filesystem limits used for the XLSX adapter.
Production runtimes must enforce equivalent process/container limits in
addition to the application-level PDF limits.

## Conservative defaults

Defaults are configurable and a breach rejects the complete PDF:

| Limit               |    Default |
| ------------------- | ---------: |
| Upload size         |     20 MiB |
| Pages               |        200 |
| Page dimension      |  14,400 pt |
| Characters per page |    200,000 |
| Total characters    |  2,000,000 |
| Words per page      |     40,000 |
| Parsed candidates   |     50,000 |
| Stream bytes        |     40 MiB |
| PDF objects         |    100,000 |
| Parser request      | 30 seconds |

Samples are capped independently so a large valid PDF is never rendered in full
in the browser. No limit is implemented by silent truncation.

## Layout detection and mapping

Headers are recognised geometrically (a run of short column-label lines) and
structurally (repeated header rows). Date formats are inferred from the layout;
if the statement omits a year, dates are resolved only when a bounded statement
period is detected. Yearless dates without a period, ambiguous dates, and
unresolved debit/credit direction become review warnings. Arabic text is
reordered back to logical order and normalised for search and merchant matching;
raw text is preserved.

Currency is not inferred from the PDF language or locale. The statement
metadata (opening/closing balance and period) is used for reconciliation when
present; otherwise reconciliation is `unverifiable`.

## Decimal precision and dates

Money crosses the parser boundary only as decimal strings and persists in
`NUMERIC(20,6)`. Parsing uses Python `Decimal`; monetary arithmetic never uses
Python `float` or JavaScript `Number`. Genuine values with more than six
fractional digits are rejected rather than rounded.

Dates are date-only without timezone conversion. A direction marker is
authoritative over sign heuristics. Ambiguous values remain review-required
with the raw word text preserved.

## Retention, duplicates, and confirmation

The original PDF remains private. It is removed after successful confirmation
unless retention was explicitly chosen; abandoned temporary files are claimed
and removed by the hourly cleanup job after the configurable retention window.
Raw PDF data, mappings, warnings, corrections, and final values are separate.

Duplicate matching reuses the existing transaction fingerprint. PDF checksum,
page, and source band remain adjacent source evidence rather than changing the
shared fingerprint contract. Duplicates are review candidates, never deleted
automatically. Reconciliation uses the same exact scale-6 arithmetic and
original currency as CSV and XLSX. Final transactions are inserted once by the
existing atomic confirmation service.

## Known limitations

Only text-based PDFs with a detected transaction table are supported.
Scanned/image-only PDFs, password-protected PDFs, PDFs with embedded files or
unsafe actions, malformed or extreme documents, and PDFs over a configured
limit are rejected. Bank-specific layouts that cannot be mapped safely, OCR,
and image parsing are out of scope.
