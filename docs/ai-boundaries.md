# AI boundaries

## Deterministic core

Import validation, ownership, duplicate detection, reconciliation, totals,
balances, percentages, currency conversion, persistence, and user-changing
actions are deterministic application code and database queries.

## Modes and providers

AI disabled mode is a supported first-class configuration. A future provider
abstraction may support a user-provided OpenAI-compatible cloud key or a local
model. The core does not require either provider and never assumes a network.

## Query-plan architecture

AI may translate a user question into a constrained intent and query plan. The
server validates the plan against an allow-list of fields, filters, grouping,
date ranges, and limits, then runs trusted code. Model-generated SQL is never
executed and model output never becomes a financial total.

Phase 11 implements this boundary: `packages/ai` owns the provider abstraction
and versioned prompts, and `packages/advisor` owns a deterministic planner, an
approved typed tool catalog, the advisor service, preview-and-confirm
proposals, and user-owned threads/messages/proposals persistence. See
`docs/ai-advisor.md` for the implementation contract.

## Data minimisation and prompt injection

Send only the minimum data needed for an approved task. Transaction text,
filenames, and imported descriptions are untrusted data and may contain prompt
injection. Keep them separated from system instructions, strip unnecessary
content, validate tool arguments server-side, and make external calls time
bounded.

## Mutations

An AI suggestion that would change data produces a preview with the exact
affected records and deterministic result. The user must explicitly confirm;
there is no silent mutation.
