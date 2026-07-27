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
- Phases 5 and 6 own the transaction ledger, manual categories, secondary
  categories, tags, notes, reviewed state, deterministic classification rules,
  saved views, transaction splits, user-owned merchants and aliases, and
  explicitly confirmed internal transfers. Keep raw/imported financial fields
  immutable. Do not begin dashboards, budgets, alerts, AI, exports, exchange
  rates, advanced refunds, or later-phase features.
