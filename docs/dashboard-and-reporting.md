# Dashboard and reporting

Phase 9 adds a read-only overview over the confirmed ledger; Phase 10 extends
it minimally with a planning summary. The dedicated planning surfaces remain the
primary views.

## Overview aggregation

The authenticated `/api/dashboard` route serves `getDashboardSummary`, which
computes per-currency cash flow, account position, top categories and merchants,
and attention counts using exact `NUMERIC(20,6)` sums. Currencies are never
collapsed into a single total and no balance is ever invented.

The shared "not part of a confirmed internal transfer" predicate excludes
confirmed transfers from income, expense, net cash flow, category, and merchant
analytics. Suggested and rejected transfer candidates remain ordinary
transactions. Account-level raw movement still includes confirmed transfers:
financial cash flow is deliberately distinct from raw account inflow/outflow.

Category analytics are split-aware: active split allocations replace the parent
category allocation, archived split versions are ignored, uncategorized
allocations fall into an uncategorized bucket, and the parent amount is never
counted alongside its splits. Merchant analytics stay parent-level.

Each account additionally reports a deterministic `balance` from the shared
`resolveAccountKnownBalance` resolver (latest transaction `balance_after`, then
latest confirmed statement `closing_balance`, else null), with its source and
as-of date. The same resolver feeds account-balance savings goals, so the
dashboard and a goal never disagree for the same account.

## Phase 10 planning summary

The dashboard page additionally loads `getPlanningSummary` from
`packages/planning`, which returns budget rows that are `approaching` or
`exceeded`, a count of savings goals needing attention (unavailable balance, or
a target date within 30 days that is not yet 100% complete), and the unread
alert count. Each row links to its dedicated surface (`/[locale]/budgets`,
`/[locale]/goals`, or `/[locale]/alerts`). The planning summary is intentionally
minimal and never reproduces the full budget/goal list on the dashboard.

See `docs/budgets-goals-alerts.md` for the budget, goal, and alert semantics
that feed this summary.
