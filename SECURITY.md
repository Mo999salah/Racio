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
