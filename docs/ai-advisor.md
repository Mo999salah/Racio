# Phase 11: optional AI financial advisor

Phase 11 adds an optional, grounded financial advisor. It answers questions
about the user's own financial data using deterministic, server-approved data
tools. The advisor is strictly optional: Racio starts and works fully when AI
is disabled or the provider is unavailable. This document is the
implementation contract.

## Optional architecture

The advisor never sits on the data path. The deterministic core (import,
ownership, reconciliation, totals, balances, budgets, goals, alerts) runs
without AI and never calls a provider. The advisor is a thin layer on top:

```text
user question
→ authenticated advisor service
→ deterministic intent/query planning
→ approved typed tools
→ server-side domain/reporting/planning services
→ structured facts
→ AI explanation
```

The AI model explains verified facts; it does not create financial truth.

## Provider boundary

`packages/ai` owns the provider abstraction:

- `AiProvider.generateStructured(input)` is the only capability the advisor
  uses. Implementations never touch PostgreSQL, never execute SQL, never
  receive DB credentials, and never run model-produced code.
- `createAiRuntime(config)` builds a runtime from server config. With
  `AI_ENABLED=false` (the default) the runtime reports
  `availability: 'disabled'` and every advisor call fails with a stable
  `AI_DISABLED` error; no provider is ever contacted.
- One configurable provider implementation ships: an OpenAI-compatible
  chat-completions provider built on `fetch` (no vendor SDK). It applies a
  strict timeout and maps transport failures to stable error codes
  (`AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_PROVIDER_UNAVAILABLE`,
  `AI_PROVIDER_ERROR`, `AI_CONTEXT_LIMIT`).
- Provider configuration comes from environment/server config
  (`AI_ENABLED`, `AI_PROVIDER`, `AI_MODEL`, `AI_API_KEY`, `AI_BASE_URL`,
  `AI_TIMEOUT_MS`, `AI_MAX_INPUT_CHARS`, `AI_MAX_OUTPUT_TOKENS`,
  `AI_MAX_TOOL_CALLS`, `AI_MAX_TRANSACTION_SAMPLES`, `AI_MAX_RETRIES`,
  `AI_RATE_LIMIT_WINDOW_MS`, `AI_RATE_LIMIT_MAX`). Secrets are never exposed
  to the client and never written to logs. Startup validates configuration
  without requiring an API key when AI is disabled.

## Advisor service

`packages/advisor` is the application service:

- `planner.ts` — deterministic intent/query planning. Date phrases
  ("this month", "last month", "last 30 days", "this year", "year to date",
  "this week", "last week", "last 7/14/90 days", "last year") are resolved
  server-side in the user's IANA timezone for English, Arabic, and Turkish.
  Topic keywords map to one approved tool set. Currencies are only accepted
  when the user actually uses them; account names are matched against owned
  accounts only. The model never chooses tools and never supplies identifiers.
  Temporally ambiguous questions are flagged for clarification instead of
  inventing a period; unsupported questions return a localized response
  instead of running tools.
- `tools.ts` — the approved typed tool catalog. Every tool has a Zod schema,
  injects the authenticated user, re-checks ownership of referenced entities,
  and executes deterministic domain/reporting/planning services. Unknown tools
  and malformed arguments are rejected before execution. There is no SQL
  tool, no schema-exploration tool, no raw query executor, and no run-code
  tool.
- `service.ts` — orchestrates planning, bounded tool execution, fact
  building, provider calls, answer rendering, and thread persistence.
- `proposals.ts` — mutation proposals with server validation, deterministic
  preview, server-stored pending state, and explicit confirmation through
  existing domain mutation services.
- `facts.ts` — the fact model. Monetary facts stay decimal strings; the
  answer references them only through `{{fact:<id>}}` placeholders that the
  server renders with exact values, so the model cannot introduce a monetary
  figure of its own.
- `rate-limit.ts` — in-process bounded per-user rate limiter (single
  instance; a shared limiter is required before multi-instance deployment).
- `persistence.ts` — user-owned threads, messages, and pending proposals.

### Approved tool catalog

| Tool                            | Source service                                                         |
| ------------------------------- | ---------------------------------------------------------------------- |
| `get_period_summary`            | `getDashboardSummary` cash flow                                        |
| `get_category_breakdown`        | shared `getExpenseSpending` predicate (split-aware, transfer-excluded) |
| `get_merchant_breakdown`        | dashboard merchant analytics (parent-level)                            |
| `get_account_overview`          | dashboard accounts + `resolveAccountKnownBalance`                      |
| `get_budget_status`             | `getBudgetStatus` / `listBudgetsWithStatus`                            |
| `get_goal_progress`             | `getGoalProgress` / `listGoalsWithProgress`                            |
| `get_alert_summary`             | `listAlertEvents` / `unreadAlertCount`                                 |
| `get_uncategorized_allocations` | `getUncategorizedExpenseAllocations`                                   |
| `get_reconciliation_status`     | confirmed statement reconciliation fields                              |
| `search_transactions`           | bounded `listTransactions` (notes excluded)                            |
| `compare_periods`               | deterministic scale-6 deltas over two dashboard summaries              |

Tool results are bounded (top-N breakdowns, max transaction samples, max
budget/goal/alert rows) and never load the full financial history.

## Financial truth

- Authoritative totals, balances, percentages, and comparisons are computed
  by deterministic domain/application services with exact scale-6 bigint
  decimal arithmetic. The model receives structured facts only.
- Money fields are decimal strings with an ISO 4217 currency code at every
  service boundary. There is no JavaScript/Python floating-point money.
- Multi-currency is never combined: tools return per-currency groups and the
  answer renders each amount with its currency code. A question that needs
  one currency and none is specified returns grouped-by-currency results.
- `compare_periods` computes the exact absolute change and an optional
  percentage server-side; the previous value of zero yields no percentage.
- Transaction samples are bounded (`AI_MAX_TRANSACTION_SAMPLES`, default 20),
  user-visible descriptions only (no raw import payloads, no notes).

## Security and privacy

### Prompt injection

All financial text is untrusted data. System instructions, the user question,
and tool-result data are kept in separate sections; raw transaction text is
never concatenated into system instructions. The versioned system prompt
(`packages/ai/src/prompts.ts`) instructs the model to ignore instructions
embedded in data, never to write SQL or code, never to reveal other users'
data, and never to request chain-of-thought. Provider output is validated
against a strict schema, cited fact ids must exist, and placeholders must
reference real facts; invalid output is repaired once and then rejected.

### Context minimization

Only the minimum data required for the question is sent: aggregate totals,
bounded top-N breakdowns, selected transaction samples only when the question
is about transactions, masked account labels, and no raw statement contents.
Raw uploaded CSV/XLSX/PDF data is never sent.

### Ownership

Ownership always comes from the authenticated session (`requireSession`).
Context account ids, tool arguments, proposal entities, and thread ids are
re-checked server-side; cross-user references return not found. The database
keeps advisor threads, messages, and proposals user-owned.

### Logging and telemetry

Full prompts, raw tool results, transaction descriptions, balances, account
identifiers, and conversation contents are never logged. Safe telemetry is
limited to request duration, provider/model identifiers, tool names, counts,
and stable error codes.

### Rate and tool limits

- Per-user in-process rate window (`AI_RATE_LIMIT_WINDOW_MS` /
  `AI_RATE_LIMIT_MAX`, default 20 requests/minute).
- Max input length (`AI_MAX_INPUT_CHARS`, default 2 000).
- Max output tokens (`AI_MAX_OUTPUT_TOKENS`, default 500).
- Max tool calls per request (`AI_MAX_TOOL_CALLS`, default 4).
- Max provider retries (`AI_MAX_RETRIES`, default 1).
- Max transaction samples (`AI_MAX_TRANSACTION_SAMPLES`, default 20).
- Provider calls always have a timeout (`AI_TIMEOUT_MS`, default 30 s).

### Failure isolation

A provider failure never affects the core product: no partial mutations, no
silent proposal execution, and a stable localized error to the user
(`AI_PROVIDER_UNAVAILABLE`, `AI_PROVIDER_ERROR`, `AI_TIMEOUT`,
`AI_RATE_LIMITED`, `AI_CONTEXT_LIMIT`, `AI_RESPONSE_INVALID`, ...). The
advisor API maps these to safe HTTP responses; raw provider exceptions never
reach the client.

## Clarification for ambiguous date scope

Financial analysis never silently chooses a reporting period. The deterministic
planner resolves a date scope only from an explicit validated context range or
an explicit phrase in the message ("this month", "last month", "last 30 days",
"this year", "year to date", "this week", "last week", "last 7/14/90 days",
"last year", resolved server-side in the user's IANA timezone for English,
Arabic, and Turkish).

When the planned tools report over a period (`period_summary`,
`category_breakdown`, `merchant_breakdown`, `uncategorized_allocations`,
`search_transactions`) and no deterministic scope exists, the question is
temporally ambiguous and the service returns a structured clarification
instead of executing tools or calling the provider:

```text
{ status: "needs_clarification",
  reason: "date_range",
  message: <localized>,
  options: [ { id, label, dateRange: { from, to } }, ... ] }
```

The options (this month, previous month, last 30 days, year to date) are
computed deterministically in the user's timezone with fixed ids; the model
never invents the clarification scope. State questions (budgets, goals,
alerts, reconciliation, account balances) need no period and never clarify.
Spending questions scoped to an account ("how much did I spend from my
Checking account?") are routed to the period tool for that account and
clarify like any spending question. Selecting an option resubmits the same
question with the explicit validated `context.dateRange`. A question whose
scope has no data at all is answered deterministically with the localized
no-data response, without a provider call.

## Mutation proposals

The advisor may propose, never silently execute. One mutation flow ships
end-to-end: `create_budget` (categorization proposals share the same
validated pipeline).

```text
AI proposal draft
→ server validation (Zod, ownership, currency, precision, period)
→ deterministic preview
→ server-stored pending proposal with expiry
→ explicit user confirmation
→ existing domain mutation service (createBudget / bulkUpdateTransactions)
```

- Proposals are stored in `advisor_proposals`; confirmation sends only the
  proposal id, so a client can never resubmit altered AI JSON.
- On confirm the server reloads the stored payload, revalidates ownership and
  domain rules, rejects expired proposals (`AI_STALE_PROPOSAL`), rejects
  invalid stored payloads (`AI_UNSAFE_PROPOSAL`), and executes through the
  existing services.
- Duplicate confirmation is idempotent: an executed proposal returns the
  stored result without re-executing.
- The `create_budget` preview reports the deterministic current-period
  spending the budget would see (shared expense predicate), so the preview
  and the budget UI can never disagree.

## Conversation model and lifecycle

- `advisor_threads` and `advisor_messages` are user-owned; messages store
  only the user-visible question/answer text (bounded to 8 000 characters).
  Tool results, provider reasoning, and chain-of-thought are never persisted.
- Each question is answered self-contained; conversation history is not sent
  to the provider, which bounds context growth and minimizes sent data.
- Lifecycle operations (`GET /api/advisor/threads`,
  `GET /api/advisor/threads/:id/messages`,
  `POST /api/advisor/threads/:id/archive`,
  `POST /api/advisor/threads/:id/restore`,
  `DELETE /api/advisor/threads/:id`) are session-derived and
  same-origin-protected; cross-user thread ids return not found and a client
  `userId` is never accepted.
- Archive hides the thread (it stays readable); restore clears the archive
  timestamp; appending to an archived thread is rejected (`CONFLICT`) so
  archived conversations are read-only until restored.
- Delete is a hard delete: the thread and its messages are removed. This is
  safe because conversations store only bounded user-visible text with no
  audit dependency; nothing is retained while presented as deleted.
- Proposals are deliberately NOT linked to conversations. Deleting or
  archiving a conversation never confirms, expires, bypasses, or otherwise
  touches a pending or completed proposal. Pending proposals keep their
  30-minute expiry and can only be confirmed by their owner with explicit
  confirmation; completed proposal results remain readable and idempotent.

## Advisor API

```text
GET  /api/advisor/status                    -> enabled/provider/model/remote
POST /api/advisor/query                     -> answer | clarification | unsupported
POST /api/advisor/proposals                 -> validated proposal + preview
POST /api/advisor/proposals/:id/confirm     -> executed result (idempotent)
GET  /api/advisor/threads                   -> owned conversations
GET  /api/advisor/threads/:id/messages      -> owned conversation transcript
POST /api/advisor/threads/:id/archive       -> archive (read-only until restore)
POST /api/advisor/threads/:id/restore       -> restore archived conversation
DELETE /api/advisor/threads/:id             -> hard-delete conversation
```

All routes are authenticated, session-derived, same-origin-protected,
private/no-store, bounded-input, and structured-error. The client never sends
a `userId` or a hidden system prompt.

## UI

`/[locale]/advisor` is a document-style surface, not a chatbot: a compact
labeled question input, a small set of localized suggested questions, a
first-use privacy disclosure, a scope summary (period/currency/account), the
answer, a "Verified facts" list with typed drill-down links into the ledger,
budgets, goals, alerts, and imports, bounded transaction samples, an optional
budget proposal with preview/confirm/cancel, and a disclaimer. Ambiguous
questions render a compact "Choose a period" clarification block with
selectable, timezone-resolved options (not chat quick-reply bubbles); picking
one re-asks with the explicit scope. A "Conversations" section lists owned
threads with view (read-only transcript), archive/restore, and delete with an
inline two-step confirmation; easy mode stays simple and the page never turns
into a chat sidebar. Advanced mode adds scope details, tool names, and
provider/model; easy mode hides them.

## Known limitations

- The deterministic planner understands a bounded phrase set for topics,
  dates, and currencies (English, Arabic, Turkish). Anything else returns the
  localized "unsupported" response instead of guessing.
- Clarification covers date scope only; questions that are ambiguous in other
  dimensions (for example two possible categories) are not clarified.
- Merchant/category drill-downs from breakdown facts link to the filtered
  ledger; a merchant-name filter is not part of the ledger URL schema.
- Only `create_budget` has a UI flow; `categorize_transactions` proposals are
  supported and tested through the same validated pipeline but have no
  dedicated UI affordance.
- The rate limiter is in-process (single web instance); a shared limiter is
  required before multi-instance deployment.
- The OpenAI-compatible provider is the only implementation; other providers
  can be added behind the same `AiProvider` interface.
- No forecasting, projections, tax/legal/investment advice, web search, or
  exchange-rate conversion.
