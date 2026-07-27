# Racio product specification

## Purpose

Racio is a privacy-conscious web application that turns supported bank
statements into reviewable financial data. Users should be able to inspect
every extracted transaction, correct uncertainty, classify spending, compare
periods, manage budgets and savings goals, and optionally ask an AI assistant
questions grounded only in their own data.

The first release must work with AI disabled and must support hosted, local, and
self-hosted deployment from one codebase.

## Users

- **Ordinary personal user:** wants clear summaries and guided import/review
  flows without financial or technical jargon.
- **Advanced personal user:** wants raw source details, confidence, warnings,
  reconciliation, rules, and import diagnostics.
- **Maintainer/self-hoster:** needs reproducible local deployment, inspectable
  boundaries, and no mandatory cloud AI or vendor runtime lock-in.

## MVP scope

The MVP is a web application with Arabic, English, and Turkish interfaces, full
Arabic RTL support, light and dark appearance, easy and advanced modes, and
support for text-based PDF, CSV, and XLSX statement imports. Legacy `.xls` is
best-effort or explicitly unsupported.

The import experience is review-first: parsed candidates are visible and
correctable before any final transaction is persisted. Deterministic code owns
totals, balances, reconciliation, percentages, and currency conversion.

Major product areas are statement import and review, transaction classification
and merchant normalisation, spending analysis, monthly comparison, budgets,
savings goals, alerts, and an optional grounded financial assistant.

## Deferred scope

OCR, scanned PDFs, screenshots and image extraction, native mobile apps, full
in-app backup/restore, custom report builders, advanced bank-to-bank comparison,
multiple financial accounts under one bank, automated refund/reversal detection,
and real AI provider integrations are deferred. Authentication is also not part
of the current foundation run.

## Modes and languages

Easy mode is the default. It exposes clear summaries, simple wording, limited
controls, guided workflows, progressive disclosure, and warnings in plain
language. Advanced mode exposes raw and normalised descriptions, confidence,
reconciliation, parser warnings, rule sources, import diagnostics, conversion
details, and advanced filters. The modes share the same data and critical
warnings are never hidden.

The initial locales are `ar`, `en`, and `tr`. Arabic changes document direction,
mirrors layout where meaning permits, keeps numbers and code readable, and uses
RTL-aware date, form, table, and chart presentation. English is the fallback
development locale and Turkish is a first-release locale, not a later add-on.

## Money and multi-currency

All monetary values use decimal strings at service boundaries and PostgreSQL
`NUMERIC(20,6)` for stored values unless a documented requirement changes that
precision. Every amount carries an ISO 4217 currency code. Original amount and
currency are preserved; converted values are separate and require an explicit
rate, date, source, and target currency. See `docs/money-and-currencies.md`.

## AI boundary

AI is optional and disabled by default. A future provider abstraction may
support a user-provided OpenAI-compatible cloud key and local providers. AI may
explain or retrieve data through validated query plans, but it cannot execute
SQL, calculate authoritative totals, or mutate data without a server-generated
preview and explicit confirmation.

## Privacy principles

Uploaded statements are untrusted and private by default. Raw source data is
preserved for traceability but is not placed in logs. Ownership comes from the
authenticated session. The server processes
financial data, so Racio must not claim end-to-end encryption.

## High-level acceptance criteria

- The repository builds as one monorepo and can run outside Docker.
- PostgreSQL is the only database target in every environment.
- The parser is a separate Python service with no database connection.
- Parser results cross the boundary as typed, Zod-validated contracts with
  decimal-string amounts.
- The web foundation supports all three locales, Arabic RTL, light/dark
  appearance, and authenticated locale/timezone/mode/appearance/currency
  preferences.
- Authentication providers can be absent without breaking application boot;
  configured OAuth sessions and protected routes remain server-side.
- Documentation and tests protect the boundaries above.
