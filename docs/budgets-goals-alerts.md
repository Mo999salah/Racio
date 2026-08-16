# Phase 10: budgets, savings goals, and alerts

Phase 10 adds deterministic planning and monitoring on top of the confirmed
ledger. It works fully with AI disabled and never invents money. All amounts
remain `NUMERIC(20,6)` decimal strings with an explicit ISO 4217 currency code;
budgets and goals are currency-specific and are never aggregated across
currencies.

## Budgets

A budget is a user-owned currency-specific spending limit over a deterministic
period with an optional scope. The stored fields are `name`, `currency`,
`amount` (limit), `period_type`, optional `category_id`, optional `account_id`,
custom `start`/`end` dates, an optional `warning_threshold` (integer 1..100,
default 80), `rollover_enabled`, `enabled`, and `archived_at`.

Budget spending reuses the Phase 9 dashboard predicate through the shared
`getExpenseSpending` query in `packages/transactions`:

- confirmed transactions only; archived transactions are excluded
- debit (expense) direction only
- confirmed internal transfers are excluded (suggested/rejected candidates
  remain ordinary spending)
- active split allocations replace the parent category allocation; archived
  split versions are ignored; the parent amount is never counted twice

The same shared query feeds both the budget UI and the budget alert evaluation,
so a worker can never disagree with the UI.

### Scopes

- no `category_id` and no `account_id`: all expenses in the currency
- `category_id` only: split-aware allocation to that category
- `account_id` only: all expenses in that account
- `category_id` + `account_id`: allocation to that category within that account

An uncategorized budget scope is intentionally not modelled.

### Periods

Period boundaries are calendar-based in the user's IANA timezone, and booking
dates are date-only strings that are never UTC-shifted. Only "today" is derived
from the user timezone; all period arithmetic is pure calendar math.

- **weekly:** Monday through Sunday (locale-independent Monday start)
- **monthly:** calendar month
- **yearly:** calendar year
- **custom:** explicit start and end dates (no previous-period comparison)

### Status

Each budget computes `limit`, `spent`, `remaining`, `percentageUsed`, period
start/end, `daysRemaining`, and a status. The status is presentation metadata,
never financial truth:

- `complete` — the period has ended
- `exceeded` — spent reaches 100% of the limit
- `approaching` — spent reaches the warning threshold (default 80%) but is below 100%
- `healthy` — otherwise

Percentage comparisons stay on scaled integers (`spent * 100 >= limit *
threshold`); no floating-point arithmetic is used.

### Rollover

Rollover is positive-unused only and must be enabled per budget. When enabled,
the effective limit for the current period is the base amount plus the sum of
positive unused amounts from completed prior periods, bounded to the 12 most
recent periods (and never before the budget's creation date). Negative
(debt-style) rollover is not implemented. Custom periods have no rollover.

### Comparisons

The previous equivalent period's spending is reported when the period has a
deterministic predecessor (weekly/monthly/yearly). No percentage-change is
shown when the previous value is zero, and Phase 10 performs no forecasting.

## Savings goals

A savings goal is a user-owned target with a currency, an optional target date,
and a tracking mode. Progress never invents a balance.

### Manual mode

The user records an explicit `manual_saved_amount` (authoritative user input,
default 0). The amount may exceed the target; progress can exceed 100%.

### Account-balance mode

Progress uses a single shared balance resolver (`resolveAccountKnownBalance` in
`packages/transactions`) consumed by both the dashboard account reporting and
account-balance goals. Deterministic precedence, with no transaction-sum
fallback:

1. the latest confirmed transaction `balance_after` for the linked account
   (ordered by booking date, then creation time, then id)
2. otherwise the latest confirmed statement `closing_balance` (ordered by period
   end, then confirmation time, then id)
3. otherwise the balance is unavailable

Confirmed/final data only, owned account only, and the account's currency. When
neither source exists, progress is reported as unavailable
(`balanceAvailable: false`) with a `null` current amount and the goal definition
is preserved. The linked account must be user-owned, active, and in the goal's
currency. Because the goal and the dashboard share the resolver, they always
agree for the same account.

Goal progress returns `targetAmount`, `currentAmount`, `remaining` (signed; a
user may exceed the goal), `percentageComplete`, the target date, and optional
`daysRemaining`. `remaining` is not silently capped at zero.

## Alerts

Alerts are deterministic in-app events. There are no email, SMS, or push
notifications.

### Rule types

Alert events carry one of six types. Two groups are derived deterministically
from trusted ledger state (no extra configuration), and three are user-configured
`alert_rules` rows with a typed, validated `config`:

Derived (automatic):

- `budget_approaching` — a budget reaches its warning threshold but is below 100%
- `budget_exceeded` — a budget reaches 100%
- `reconciliation_mismatch` — a confirmed statement has a mismatch reconciliation status

Configured (`alert_rules`, typed discriminated union):

- `uncategorized_transactions` — the count of uncategorized expense
  allocations exceeds a threshold
- `goal_milestone` — a goal reaches a configured milestone (e.g. 50/75/100)
- `goal_deadline` — a goal target date is within a configured number of days

### Event lifecycle and deduplication

Each event is stored once per `(user_id, dedupe_key)` with a database unique
constraint, so concurrent or repeated evaluation cannot duplicate a condition.
The dedupe key encodes the condition state:

```text
budget:{id}:{periodKey}:exceeded
budget:{id}:{periodKey}:approaching:{threshold}
reconciliation:{statementId}
uncategorized:threshold:{threshold}
goal:{goalId}:milestone:{milestone}
goal:{goalId}:deadline:{daysBefore}
```

Crossing 80% once creates one event; crossing 100% later creates a separate
event. A new budget period produces a new key and can trigger again. Events
support `read` and `dismiss` states and are not deleted on read, preserving
traceability.

### Evaluation

Evaluation runs as the idempotent, user-scoped pg-boss job
`planning.evaluate.alerts`. A periodic `planning.alerts.sweep` job (every 15
minutes) fans out one job per user with an enabled budget, goal, or rule, or a
mismatch statement. The web app additionally enqueues evaluation immediately
after import confirmation, transaction category changes (single and bulk),
split replacement, transfer confirm/reject/unlink, budget mutations, goal
mutations, and alert-rule mutations. Evaluation uses the shared budget/goal
status functions and the shared balance resolver.

## Timezone

All period-based evaluation uses the user's IANA timezone from preferences.
Alert event timestamps are real timestamps; budget transaction matching uses
date-only booking dates and never mixes UTC boundaries into date-only financial
values.

## Known limitations

- Budget spending is not shown as a historical series; only current and
  previous-period spending are reported.
- Rollover is bounded to 12 prior periods and is positive-only.
- Account-balance goal progress depends on balance provenance (transaction
  `balance_after`, then statement `closing_balance`); accounts with neither show
  progress as unavailable.
- Alert rules are configured only for the three non-derived types; budget and
  reconciliation alerts are derived automatically.
