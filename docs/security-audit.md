# Racio security audit

Scope: the Racio MVP as implemented through Phase 12, hardened by Phase 13
(security, operations, release). This document is an internal assessment; it
does not claim external penetration testing.

## Threat model refresh

For every threat: existing mitigation → residual risk → release disposition.

### Authentication and sessions

- **Account takeover / session theft**
  → Better Auth sessions are opaque random tokens stored server-side in
  PostgreSQL; cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` in
  production; sessions expire after 30 days with sliding refresh; users can
  list and revoke sessions (single, others, all). Production enables Better
  Auth's in-process rate limiting and a stricter social sign-in rule.
  → Residual: cookie theft on a compromised client; in-process rate limiter
  is single-instance.
  → Disposition: acceptable for MVP; one web instance is the documented
  topology.

- **CSRF**
  → `SameSite=Lax` cookies + `assertSameOrigin` on every state-changing
  application route (including sessions and OAuth-adjacent endpoints); GET
  never mutates state.
  → Residual: none known under the documented topology.
  → Disposition: verified by code audit and request-security tests.

- **OAuth misconfiguration**
  → Providers require complete server-side configuration; callbacks are
  checked against trusted origins; Apple uses a server-generated client
  secret; production requires an https `BETTER_AUTH_URL`; Better Auth handles
  OAuth state/PKCE; account linking follows Better Auth's current behavior.
  → Residual: provider-specific flows follow the installed Better Auth
  version's semantics.
  → Disposition: documented; no custom OAuth code.

- **Open redirect via returnTo**
  → `safeReturnPath` accepts only same-origin relative paths and rejects
  protocol-relative URLs and backslashes (tested).
  → Residual: none.
  → Disposition: covered by unit tests.

### Authorization and data isolation

- **Cross-user IDOR**
  → Every owned entity query is scoped by the session-derived `userId`;
  composite owner foreign keys `(id, user_id)` make cross-user references
  structurally impossible at the database level; cross-user ids return not
  found. Real-PostgreSQL integration tests and Playwright cross-user tests
  cover accounts, imports, transactions, budgets, exports (including
  download).
  → Residual: none found.
  → Disposition: verified.

- **Privilege abuse via SQL**
  → No model-generated SQL; Drizzle tagged templates only; advisor has no SQL
  tool; runtime user is a normal database role; no stored procedures with
  elevated privileges.
  → Residual: standard DBA hygiene (least privilege) is the deployment's
  responsibility.
  → Disposition: documented in `docs/deployment.md`.

### Malicious documents and parsing

- **Malicious CSV/XLSX/PDF**
  → Bounded upload validation, content signatures, size limits; isolated
  parser with no database, secrets, shell, or outbound network; XLSX OOXML
  ZIP inspection before `openpyxl` (traversal, encryption, macros, external
  links, entities, expansion); PDF container/encryption/embedding/action
  checks before `pdfplumber`; strict timeouts; stable safe error codes;
  parser container read-only rootfs, memory/pids caps, internal network.
  → Residual: parser resource abuse bounded by container limits; new parser
  library CVEs require dependency upkeep.
  → Disposition: verified by malicious-fixture suites and E2E (scanned PDF
  rejection).

- **Formula injection**
  → CSV export escapes `=`, `+`, `-`, `@`, tab, CR prefixes in the exported
  representation only; XLSX uses static inline strings (immune by
  construction) plus the same sanitizer; formulas are never evaluated during
  import.
  → Residual: downstream consumers could still execute content; this is
  inherent to spreadsheet ecosystems.
  → Disposition: mitigated; tested.

- **XSS via imported/user text**
  → React text rendering only; no `dangerouslySetInnerHTML` anywhere; notes
  and descriptions are plain text; ECharts removed (unused); CSP
  `script-src 'self' 'nonce-…'` without `unsafe-eval` or wildcard sources.
  → Residual: none found.
  → Disposition: verified by audit and production CSP test.

### AI boundary

- **Prompt injection / AI compromise / provider unavailability**
  → Optional (disabled by default); provider has no database access, no SQL,
  no tool-selection authority; deterministic planner maps questions to an
  approved Zod-validated tool catalog; instructions/data separated; context
  minimized; provider output schema-validated with one repair retry; facts
  rendered from validated fact ids; proposals preview-and-confirm through
  existing domain services; provider failures map to stable errors and never
  affect the core app.
  → Residual: bounded provider-crafted text could still be misleading within
  the answer surface (never authoritative totals).
  → Disposition: mitigated; tested with mock providers; AI disabled mode
  verified by E2E.

### Export and storage

- **Export data exfiltration / download abuse**
  → Exports are session-derived, ownership-validated (including saved-view
  resolution server-side), bounded by row/file/concurrency limits, private
  storage with random keys, authenticated `no-store` downloads with
  `Content-Disposition: attachment`, 24 h expiry, cleanup job, and export
  deletion removes the file. Cross-user export downloads return not found.
  → Residual: a legitimate user can export their own data (by design).
  → Disposition: verified by integration and E2E tests.

- **Storage traversal / symlink abuse**
  → Storage keys are server-generated; `assertSafeStorageKey` rejects
  absolute paths, backslashes, NULs, and traversal; user content never
  becomes a filesystem path; deletion is scoped per key; local adapter uses
  random UUID keys and overwrite-safe writes.
  → Residual: local filesystem adapter only; S3 adapter reserved.
  → Disposition: tested (malicious key tests).

- **Storage keys exposed to clients**
  → Browser payloads carry opaque ids only; keys never appear in responses,
  logs, or URLs.
  → Residual: none.
  → Disposition: verified by audit.

### Operations

- **Worker replay / duplicate jobs**
  → All job types use pg-boss singleton keys per entity; import parsing,
  confirmation, alert evaluation, proposal confirmation, and export
  finalization are idempotent with guarded finalization; concurrency is
  bounded per queue.
  → Residual: a crash between export storage write and finalization can
  leave one unreferenced private object; the hourly reconciler deletes
  unreferenced objects older than a grace period.
  → Disposition: resolved in Phase 13; tested.

- **Secrets leakage**
  → No `NEXT_PUBLIC_*` secrets; server-only env access; structured logs
  exclude secrets, financial content, prompts, and storage paths; error
  serialization returns safe messages and codes.
  → Residual: operator error (mis-set env) remains possible.
  → Disposition: documented; startup validation rejects weak/default
  secrets.

- **Backup leakage**
  → Backups contain sensitive financial data; deployment must encrypt at
  rest, restrict access, and define retention.
  → Residual: deployment responsibility.
  → Disposition: documented; restore drill mandatory before release.

- **SSRF**
  → The only server-side fetches target the parser (`PARSER_URL`) and the
  AI provider (`AI_BASE_URL`), both from trusted server config; no
  user-controlled URLs are fetched server-side.
  → Residual: a compromised config could point these at internal hosts;
  deployment must keep config secrets protected.
  → Disposition: audited; none found.

- **Brute force / abuse**
  → Better Auth production rate limiting (per-process), upload rate limit,
  export concurrency limits, advisor in-process per-user rate window, bounded
  parser limits.
  → Residual: in-process limiters assume one web instance.
  → Disposition: documented topology constraint.

- **Dependency compromise**
  → Frozen lockfiles (pnpm and uv), pinned CI, no unpinned curl-to-shell
  installs in the build, dependency audits in CI.
  → Residual: registry compromise beyond lockfile integrity is out of scope
  for the MVP.
  → Disposition: audit performed; findings classified below.

## Findings and fixes

### Fixed in Phase 13 (with verification)

| Finding                                                                                                                                         | Severity                          | Fix                                                                                               | Verification                                                   |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A parse whose rows are all valid and non-duplicate never reached `ready`, so clean-import confirmation failed with `CONFLICT` on the happy path | High (functional release blocker) | `persistParserResult` computes `ready` when all rows are valid                                    | New CSV real-parser integration test; E2E import-confirm flows |
| The export UI always sent `includeSplits` on CSV requests, which the strict schema rejected (400); UI CSV export was broken                     | High (functional)                 | Payload built per format union variant                                                            | E2E CSV export + download                                      |
| Worker could not start in production without `BETTER_AUTH_SECRET` (which it never uses)                                                         | High (operational)                | `readAppEnv(…, { requireAuth: false })` for the worker                                            | Production container startup drill                             |
| Production Dockerfiles contained dev content (next dev instead of next start)                                                                   | High (operational)                | Rewrote `web.prod.Dockerfile`/`worker.prod.Dockerfile`; corepack pinned for non-root runtime      | Container build + in-network verification                      |
| Export crash-window orphan objects had no cleanup                                                                                               | High (deferred item)              | `storage.list(prefix)` + `reconcileOrphanExports` in the hourly cleanup                           | Storage unit tests; export-boss integration test               |
| No CSP/security headers                                                                                                                         | High                              | CSP with per-request nonces (Next 15.5 reads nonces from the request CSP header) + static headers | `test:e2e:prod` suite (headers, nonces, no violations)         |
| `next build` required `BETTER_AUTH_SECRET` and other env                                                                                        | Medium                            | Lazy auth/database/storage/AI/jobs singletons                                                     | Build with empty environment                                   |
| Production accepted known default `BETTER_AUTH_SECRET` and non-https `BETTER_AUTH_URL`                                                          | High                              | Config rejects known defaults and non-https base URL in production                                | Config unit tests                                              |
| No readiness endpoint; health was liveness-only                                                                                                 | Medium                            | `/api/health/live` + `/api/health/ready` (PostgreSQL + migration state) + version                 | Production suite; container drill                              |
| Worker entry-point guard broke on Windows (`file://` vs backslash paths)                                                                        | Medium (dev/E2E)                  | `pathToFileURL(process.argv[1])`                                                                  | Local worker runs; E2E                                         |
| E2E/dev connection exhaustion (`53300 too many clients`) from Next dev singletons + unbounded pools                                             | High (dev/CI reliability)         | Bounded pg-boss pools; dev compose raises `max_connections`                                       | Full E2E runs                                                  |
| ECharts dependency (unused) carried an XSS advisory                                                                                             | Medium                            | Dependency removed                                                                                | `pnpm audit`                                                   |
| pypdf/cryptography/pytest advisories                                                                                                            | High→Medium (runtime dep)         | pypdf ≥ 6.15, cryptography ≥ 50 override, pytest ≥ 9                                              | pip-audit: no known vulnerabilities                            |

### Accepted residual findings

| Finding                                          | Severity | Rationale / disposition                                                                         |
| ------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------- |
| In-process AI and Better Auth rate limiters      | Medium   | One web instance is the documented MVP topology; shared limiters required before multi-instance |
| `sharp` (via next) libvips advisory              | Low      | Racio never processes images; next bundles sharp as an optional dependency; no reachable path   |
| `postcss` (via next) advisories                  | Low      | Build-time only; no attacker-controlled CSS input at runtime                                    |
| `esbuild` (via drizzle-kit dev tooling) advisory | Low      | Development tooling only; not in production bundles                                             |
| Parser libraries' future CVEs                    | Low      | Dependency upkeep is ongoing; pip-audit is part of the release checklist                        |

## Tests run

- Full JS gate with real PostgreSQL integration (`RACIO_RUN_DB_INTEGRATION=1`,
  `RACIO_RUN_PARSER_INTEGRATION=1`): 30/30 task groups green.
- Playwright: 13/13 Chromium, 13/13 Firefox, 4/4 production-mode.
- Parser: ruff, ruff format, mypy strict, pytest (58).
- Migration: clean install, upgrade 0012→0013, `drizzle-kit check`, no-op
  generate.
- Backup/restore drill with row-count parity and app smoke.
- Production container build + startup with in-network health probes.
- `pnpm audit` (no reachable high/critical), pip-audit (no known
  vulnerabilities).

## Remaining risks (post-MVP)

See the "Remaining risks" section of the release report in the repository
history; the principal items are multi-instance rate limiting, deployment-side
TLS/backup hygiene, and dependency upkeep.

## Release disposition

No critical or unmitigated high findings remain. Release is conditional on
the documented one-web-instance topology and the deployment-side controls in
`docs/deployment.md` and `docs/release-checklist.md`.
