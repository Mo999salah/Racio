# ChatGPT project context

This directory is a local mirror of the ChatGPT project “Racio”.

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.

## Project instructions

This project is the Racio monorepo. Before changing code, read `SPEC.md`,
`ARCHITECTURE.md`, `DESIGN.md`, and `SECURITY.md`.

## Racio engineering rules

- Treat the approved MVP in `SPEC.md` as a hard boundary. Never invent product
  features or silently expand the MVP.
- Never use JavaScript or Python floating-point arithmetic as financial truth.
  Money crossing a service boundary is a decimal string and carries an ISO 4217
  currency code.
- Never mix currencies implicitly. Preserve original amount and currency; keep
  converted values separate.
- Never trust a client-provided `userId`; ownership must come from the
  authenticated session and every owned entity must be checked server-side.
- Never execute model-generated SQL. AI is optional, cannot calculate
  authoritative totals, and any future mutation requires preview and explicit
  confirmation.
- Preserve raw financial source data. Add or update targeted tests whenever
  core financial logic changes.
- Keep the parser isolated from the database, AI secrets, OAuth secrets, and
  unrestricted network access.
- Respect easy and advanced modes, Arabic RTL, locale parity, and accessible
  interaction states.
- Document meaningful architectural changes and justify new dependencies and
  their licences. Avoid dependencies without a clear need.
- Keep implementation and output free of generic AI-slop UI patterns. Follow
  `DESIGN.md` as the visual contract and review UI against real user tasks.
- Phase 3 institutions and financial accounts are user-owned. Never accept a
  client `userId`; store only masked account/IBAN identifiers, keep account
  reads private and uncached, and use the database composite owner foreign key.
- Phase 4 is CSV-only and review-first. Preserve raw rows separately from
  corrections, use absolute decimal strings plus direction, never evaluate CSV
  formulas, and do not persist final transactions before explicit confirmation.
- Phase 7 adds only standard `.xlsx` through the existing Phase 4 pipeline.
  Inspect OOXML as an untrusted bounded ZIP before `openpyxl`, never evaluate
  formulas or load external links/macros, import one explicitly selected sheet,
  and reuse review, duplicates, reconciliation, confirmation, retention, and
  post-import jobs.
- Phase 8 adds only text-based `.pdf` through the existing Phase 4 pipeline.
  Inspect the PDF as an untrusted bounded container before `pdfplumber`, reject
  password-protected PDFs, embedded files, unsafe actions, and image-only PDFs,
  keep raw word text separate from parsed amounts, never execute PDF content,
  and reuse review, duplicates, reconciliation, confirmation, retention, and
  post-import jobs. No OCR or scanned-PDF support.
- Phases 5 and 6 own the transaction ledger, manual categories, secondary
  categories, tags, notes, reviewed state, deterministic classification rules,
  saved views, transaction splits, user-owned merchants and aliases, and
  explicitly confirmed internal transfers. Keep raw/imported financial fields
  immutable. Later-phase features (dashboards, budgets, alerts, AI, exchange
  rates, exports, advanced refunds) live in their own surfaces and services,
  never inside Phase 5/6 code paths.
- Phase 10 owns currency-specific budgets, savings goals, and deterministic
  in-app alerts. Budget spending must reuse the Phase 9 expense predicate
  (debit-only, confirmed-transfer excluded, split-aware) via the shared
  `getExpenseSpending` query; never create separate budget-spending semantics.
  Budgets and goals are currency-specific with exact decimal strings and no
  conversion. Goal account-balance progress uses only the deterministic latest
  `balance_after` and shows progress unavailable rather than inventing a
  balance. Alerts are deterministic, deduplicated by a database `(user_id,
dedupe_key)` unique constraint, evaluated idempotently by the
  `planning.evaluate.alerts` worker job, and delivered in-app only. Do not
  use Phase 10 surfaces for AI advisor, forecasting, exchange rates, exports,
  or any Phase 11+ feature.
- Phase 11 owns the optional AI advisor. It must be strictly optional: the
  app starts and works with `AI_ENABLED=false`, no provider is called, and
  startup never requires AI credentials when disabled. The model never
  connects to PostgreSQL, never generates or executes SQL, and never chooses
  tools or identifiers: the deterministic planner in `packages/advisor` maps
  questions to an approved typed tool catalog, tool arguments are
  Zod-validated, ownership is re-checked server-side, and tool results are
  bounded structured facts (decimal strings, per-currency, never converted).
  System prompts live versioned in `packages/ai`; transaction text, notes,
  merchant names, and statement text are untrusted data separated from
  instructions. Provider output is validated (schema, fact ids, placeholders)
  with one bounded repair retry. Proposals are server-stored with expiry,
  previewed deterministically, and executed only after explicit confirmation
  through existing domain mutation services; duplicate confirmation is
  idempotent. Threads/messages store only user-visible text; no
  chain-of-thought. Answers render exact amounts from validated fact ids.
  Do not begin exports, release hardening, OCR, exchange rates, or Phase 12+
  features.
- Phase 12 owns user-controlled exports. Exports are session-derived,
  ownership-validated (filters and saved views resolve server-side; cross-user
  references return not found), deterministic, exact, bounded, and private.
  Money is exported as canonical decimal strings with an explicit ISO 4217
  currency column, never converted and never transformed through floating
  point. CSV is UTF-8 with BOM and CRLF, uses stable English machine headers,
  and escapes spreadsheet formula-injection prefixes (`=`, `+`, `-`, `@`,
  `\t`, `\r`) only in the exported representation. XLSX contains only static
  cells (no formulas, macros, external links, charts, or executable parts),
  keeps `amount_exact` as a text cell, and marks any numeric convenience
  column as non-authoritative. Splits stay parent-level with `has_splits`/
  `split_count` plus an opt-in active-splits sheet/file; archived split
  versions are excluded. Confirmed internal transfers remain in the ledger
  export with their transfer status. Notes and advisor conversations are
  excluded by default and opt-in only. The archive is a versioned
  (`formatVersion: "1"`) ZIP under `racio-export/` and is not an
  import/restore format. Small exports generate synchronously; large exports
  and the archive use `export.generate`/`export.cleanup` with repeatable-read
  snapshots, keyset ordering, idempotent finalization, configurable retention
  (24 hours by default), and authenticated private downloads. Never export
  secrets, session data, raw import payloads, storage keys, or uploaded
  statement files. Do not begin Phase 13 (security, operations, release
  hardening).
