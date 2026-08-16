# Racio security rules

These rules apply to the authentication, ownership, account, Phase 4 CSV
import foundation, and Phase 5 ledger/classification features and remain
non-negotiable when the product grows.

Phase 5 classification rules are validated typed JSON, never executable code;
manual metadata cannot alter immutable financial fields; previews and
historical applications are bounded and explicitly confirmed; and rule
failures cannot roll back a confirmed import.

## Ownership and trust

- Never trust a client-provided `userId`. Once sessions exist, derive ownership
  from the authenticated session and verify it on every owned entity.
- Uploaded files, filenames, transaction descriptions, spreadsheet cells, and
  parser text are untrusted data, never instructions.
- The parser has no direct database access, AI secrets, OAuth secrets, or
  unrestricted outbound internet access.

## Secrets and data handling

- File storage is private by default and access is authorised server-side.
- Sensitive financial data and secrets must not be written to logs.
- API keys must never be stored in plaintext. A future implementation must use
  encryption at rest with a separately managed key and redact values in logs.
- Do not store sensitive financial data in browser `localStorage`.
- Better Auth owns secure, HttpOnly, SameSite cookies. Production rejects a
  missing or weak `BETTER_AUTH_SECRET`.
- OAuth providers are enabled only when their complete server-side configuration
  exists. No provider secret is exposed through `NEXT_PUBLIC_*` variables.
- Callback URLs are checked against trusted origins and internal return paths
  reject absolute URLs, protocol-relative URLs, and backslashes.
- Session and preference endpoints derive the owner from the validated session;
  they do not accept a request-owned `userId`.
- Provider sign-in is rate-limited in production. The current in-memory Better
  Auth limiter is suitable for one process; a shared limiter is required before
  multi-instance deployment.
- Do not claim end-to-end encryption: the server must process statement data.

## Institutions and account identifiers

- Institutions and financial accounts are always queried with the owner from
  the Better Auth session; the browser never supplies an ownership field.
- The database enforces the account owner with a composite foreign key from
  `(financial_accounts.institution_id, financial_accounts.user_id)` to the
  matching institution pair, in addition to the per-user foreign key.
- Only masked account identifiers and masked IBANs may be stored. Zod/domain
  validation and PostgreSQL checks reject full-looking values. Full values must
  never be sent in logs, analytics, URLs, localStorage, or client-side error
  payloads.
- Account and institution reads are private and uncached. Mutations require an
  authenticated session and same-origin requests when an Origin header is
  present. Archive is reversible; there is no hard-delete endpoint or UI.
- Create/update routes currently rely on authenticated ownership, bounded
  payload validation, and the database uniqueness constraints. Before deploying
  multiple web instances, add a shared rate limiter for these mutations beside
  the existing Better Auth limiter; the current process-local limiter does not
  cover application account routes.

## CSV import security

- CSV uploads are untrusted private data. Validate size, extension, MIME hint,
  content, encoding, null bytes, line length, field length, and row count before
  enqueueing a job.
- Store files under random internal keys in private storage. Never expose the
  key or a filesystem path to the browser, parser response, logs, or analytics.
- The parser receives bytes only, has no PostgreSQL connection, and must not log
  filenames, row payloads, descriptions, or amounts. Parser output is validated
  again by TypeScript before persistence.
- Raw CSV values are rendered as text. Formula-like values remain data and are
  never evaluated or converted to HTML.
- Upload and confirmation routes are authenticated, same-origin checked when an
  Origin header is supplied, private/no-store, and rate-limited by the documented
  application strategy before multi-instance deployment.
- Temporary files are deleted after successful confirmation by default. Failed
  or abandoned imports are eligible for bounded cleanup; retained originals
  remain private metadata-backed objects.

## XLSX import security

- XLSX uploads use the same private ownership, storage, review, confirmation,
  retention, and no-store boundaries as CSV. `.xls`, `.xlsm`, password-protected
  workbooks, macros, external links, Power Query parts, embedded images, and
  executable/OLE objects are rejected.
- Before `openpyxl` opens a workbook, the isolated parser validates the ZIP
  signature, safe relative entry names, encryption flags, entry count, expanded
  size, compression ratio, required OOXML content types, internal relationships,
  XML declarations, shared strings, worksheet dimensions, populated cells,
  formulas, and merged ranges.
- Formula cells are never executed or evaluated. A mapped value may use only a
  cached value already stored in the workbook, and the row remains reviewable
  with its formula-cache source flag. Formula text and workbook values are not
  logged.
- Workbook inspection and raw-cell payloads are bounded. Browser responses do
  not contain storage keys, filesystem paths, raw OOXML, relationship targets,
  or parser tracebacks. Very-hidden sheets are unavailable; hidden sheets
  require an explicit advanced-mode choice.
- Parser requests have a strict timeout. Archive, row, column, cell, string,
  formula, and merged-range breaches reject the complete workbook with stable
  safe error codes; no workbook is silently truncated or partially imported.

## PDF import security

- PDF uploads use the same private ownership, storage, review, confirmation,
  retention, and no-store boundaries as CSV and XLSX. Password-protected PDFs,
  embedded files, unsafe actions, and image-only PDFs with no usable text are
  rejected.
- Before `pdfplumber` extracts text, the isolated parser validates the PDF
  header, object structure, encryption indicators, page count, page dimensions,
  text character and word counts, and embedded-file/action indicators against
  strict limits.
- PDF text is extracted as geometry (words and lines), never executed as code,
  and never rendered as HTML. Amounts are kept as the raw word text plus a
  parsed absolute decimal string and direction.
- Inspection and raw-candidate payloads are bounded. Browser responses do not
  contain storage keys, filesystem paths, raw PDF objects, or parser
  tracebacks.
- Parser requests have a strict timeout. Size, page, dimension, text-size, and
  candidate breaches reject the complete PDF with stable safe error codes; no
  PDF is silently truncated or partially imported.

## Ledger and classification security

- Transaction, category, tag, rule, saved-view, and history queries always
  include the authenticated owner and return cross-user records as not found.
- Notes and descriptions are plain text, length-bounded, never logged, and never
  rendered with HTML or Markdown execution.
- Bulk actions and rule previews/runs are bounded; every selected record is
  revalidated server-side inside the request transaction.
- Saved views store versioned validated filter JSON, never raw SQL or another
  user's entity identifiers.
- Rules cannot change amount, currency, direction, account, statement, raw
  fields, delete transactions, call external services, or execute code.
- Protected ledger responses use private/no-store caching and sensitive filter,
  note, description, and financial values are excluded from logs and telemetry.

## Phase 6 security

- Split, merchant, alias, and transfer routes derive the owner from the
  authenticated session and never accept a client `userId`.
- Split replacement is bounded, exact, currency-locked to the parent, and
  atomic. Split categories, tags, merchants, aliases, and transfer endpoints
  verify same-user composite ownership and return safe not-found responses.
- Alias matching uses bounded literal exact/contains/starts-with comparisons;
  arbitrary regular expressions, executable patterns, external enrichment, and
  AI are not supported.
- Merchant previews, alias applications, merge snapshots, and transfer candidate
  generation are bounded. Descriptions, notes, aliases, merchant data, and
  transfer details are not written to logs or telemetry.
- Transfer confirmation is explicit and does not mutate either transaction's
  amount, currency, direction, or source fields. Confirmed-pair partial unique
  indexes prevent one transaction from being linked twice.
- New ledger, merchant, alias, split, and transfer responses are private and
  uncached. Mutations require authentication and same-origin protection.

## Phase 10 security

- Budget, goal, alert-rule, and alert-event routes derive the owner from the
  authenticated session and never accept a client `userId`. Cross-user IDs
  return not found. Category and account references use owner-aligned composite
  foreign keys and are revalidated server-side.
- Budget and goal amounts are decimal strings with an explicit currency and are
  never JavaScript numbers. Percentages are presentation metadata; alert
  deduplication and threshold comparisons use scaled integers.
- Alert events store only bounded, non-financial metadata (thresholds,
  milestones, counts); budget amounts, goal balances, and account identifiers
  are never written to alert metadata or to logs.
- Alert evaluation is idempotent and user-scoped; the database unique dedupe
  key prevents duplicate or concurrent event creation.
- No external delivery is added: Phase 10 is in-app alerts only. No email, SMS,
  push, or web push.

## AI safety

- AI is optional and the core product must work when it is disabled.
- Never execute AI-generated SQL. AI may produce a constrained query plan that
  the server validates against an allow-list and executes with deterministic
  code.
- AI must not calculate authoritative totals, balances, reconciliation results,
  or percentages.
- Treat all financial text as data and defend against prompt injection by
  separating instructions from data, minimising context, and validating every
  tool call server-side.
- Any future user-changing AI action requires a server preview and explicit
  user confirmation.

## Phase 11 AI advisor security

- The advisor is disabled by default. With `AI_ENABLED=false` the app boots
  and works normally; the advisor UI reports the disabled state and no
  provider is ever contacted. Startup never requires AI credentials when AI is
  disabled.
- The model has no database access: no SQL tool, no schema-exploration tool,
  no raw query executor, and no run-code tool. Tool selection is deterministic
  and server-side; the model cannot call tools at all.
- All advisor tools and routes derive ownership from the authenticated session
  and re-check it server-side. Cross-user account, category, budget, goal,
  transaction, thread, and proposal references return not found. Tool
  arguments are Zod-validated and bounded; a client-supplied `userId` or
  hidden system prompt is rejected.
- Financial truth comes only from deterministic services. Monetary facts are
  decimal strings with explicit ISO 4217 currency codes, never combined across
  currencies, and rendered into answers by the server from validated fact ids.
  The model can only reference facts via `{{fact:<id>}}` placeholders; unknown
  placeholders or cited ids are rejected (one bounded repair retry, then a
  stable error).
- Prompt-injection defences: system instructions, the user question, and tool
  data are separate; transaction descriptions, merchant names, notes, and
  statement text are never concatenated into system instructions and never
  followed as instructions.
- Context sent to the provider is minimised: aggregate totals, bounded top-N
  breakdowns, selected samples only when the question needs them, and no raw
  uploaded file contents.
- Proposals are server-stored with an expiry. Confirmation sends only the
  proposal id; the server reloads and revalidates the stored payload,
  re-checks ownership and domain rules, rejects stale proposals
  (`AI_STALE_PROPOSAL`) and invalid payloads (`AI_UNSAFE_PROPOSAL`), and
  executes through the existing domain mutation services. Duplicate
  confirmation is idempotent. No mutation occurs without explicit user
  confirmation.
- Advisor threads and messages store only bounded user-visible text; tool
  results, provider reasoning, and chain-of-thought are never persisted.
- Logs and telemetry never contain full prompts, tool results, transaction
  descriptions, balances, account identifiers, or conversation contents.
- Provider calls always have a timeout; failures map to stable error codes and
  never crash or corrupt core flows, and never leave partial mutations or
  silently executed proposals.
- Bounded server-side limits protect against rapid repeated requests,
  tool-call loops, long prompts, and context growth: per-user in-process rate
  windows, max input length, max output tokens, max tool calls per request,
  max transaction samples, and max provider retries. A shared rate limiter is
  required before multi-instance deployment.

## Phase 12 export security

- Exports are user-owned and derived from the authenticated session; a
  client `userId` is never accepted. Filter references (account, institution,
  category, tag, saved view) and export rows are ownership-validated
  server-side; cross-user ids return not found.- Never export passwords, session tokens, OAuth/provider secrets, API keys,
  storage keys, raw import payloads, or uploaded statement files. Advisor
  conversations are excluded by default and export only user-visible content
  on explicit opt-in. Notes are excluded by default and are opt-in.
- CSV export defends against formula injection by escaping cells that begin
  with `=`, `+`, `-`, `@`, `\t`, or `\r`; only the exported representation is
  mutated, never authoritative stored data. Generated XLSX workbooks contain
  only static cells: no formulas, macros, external links, charts, or
  executable parts, and no user-identifying workbook metadata.
- Generated files are private in storage, referenced only by the user-owned
  `exports` row, expire after a configured retention (24 hours by default),
  and are removed by the `export.cleanup` worker. Downloads use
  authenticated private endpoints with `Content-Disposition: attachment`,
  correct MIME types, and `Cache-Control: private, no-store`; there are no
  public or permanent links and storage keys are never exposed.
- Export requests are strict-schema validated, bounded by row, file-size,
  record, and concurrency limits, and fail with stable error codes that never
  leak filesystem or storage internals. Logs never contain exported row
  contents, notes, balances, descriptions, sensitive filenames, or storage
  keys.

## Phase 13 security posture

- Production enforces security headers: CSP with per-request nonces (no
  unsafe-eval, no wildcard sources; style-src unsafe-inline is required for
  inline style attributes), nosniff, Referrer-Policy, Permissions-Policy,
  frame protection, HSTS, and cross-origin policy headers. Production
  startup rejects weak or known-default auth secrets and non-https base
  URLs. The web build requires no environment values (all runtime singletons
  are lazy).
- Health/readiness: /api/health/live and /api/health/ready (PostgreSQL
  connectivity + applied migration count); readiness never depends on AI or
  optional OAuth providers. The worker exposes a minimal health listener;
  the parser health endpoint never discloses environment details.
- Export crash-window orphan objects are reconciled hourly: unreferenced
  objects older than a grace period are deleted; referenced or live objects
  are never touched. Import and export retention and cleanup jobs are
  bounded and cannot delete active user data.
- Containers: production web/worker/parser images run non-root; the parser
  runs with a read-only root filesystem, bounded memory/processes, tmpfs, and
  no outbound network; the worker uses bounded pools and per-queue
  concurrency with graceful shutdown.
- The MVP deployment topology is exactly one web instance: the advisor and
  Better Auth rate limiters are in-process; a shared limiter is required
  before multi-instance deployment (see docs/deployment.md).
- The test-only session fixture (POST /api/test/session) requires RACIO_E2E=1
  and returns 404 in production; it is never an authentication bypass.
- Backups (custom-format pg_dump + private storage copy) contain sensitive
  financial data: store encrypted, restrict access, define retention, and
  test restore before release. See docs/operations.md and
  docs/disaster-recovery.md.

## File and export safety

Prepare limits for file size, page count, decompression ratio, row count,
memory, and execution time before enabling real parsing. Validate MIME type and
content signatures rather than trusting extensions alone. CSV export must defend
against formula injection by escaping values beginning with spreadsheet formula
characters.

## Resilience

External merchant lookup and AI failures must not break core financial flows.
Every boundary needs timeout, bounded retries where safe, observable non-
sensitive errors, and a deterministic fallback.
