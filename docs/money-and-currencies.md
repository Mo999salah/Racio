# Money and currencies

## Storage and transport

Financial truth uses decimal arithmetic only. JavaScript `number` and Python
`float` are not allowed for money. PostgreSQL values use `NUMERIC(20,6)` in the
MVP. Service boundaries transport amounts as strings, for example `"1234.50"`.
TypeScript arithmetic uses exact bigint scale-6 decimal operations and rejects
values with more than six fractional digits instead of rounding or truncating
them. Python uses `Decimal`.

Every amount has an ISO 4217 currency code. The original amount and original
currency remain immutable source facts even if a display conversion exists.

## CSV and XLSX import convention

CSV and XLSX debit and credit values are stored as absolute decimal strings with a
separate `debit` or `credit` direction. A signed amount is converted to the same
convention deterministically: positive is `credit`, negative is `debit`, and
the stored amount is the absolute decimal string. No currency conversion is
performed during import. Decimal and thousands separators are detected from
column consistency; ambiguous values are rejected or sent to mapping/review.

XLSX numeric money cells use the original decimal token from worksheet XML,
never a JavaScript or Python binary float. A likely display artifact may be
normalized only when a fixed number format explicitly displays no more than six
fractional digits and the exact difference is at most `1e-12`. The correction is
warned and the immutable raw token remains available. Values outside
`NUMERIC(20,6)` are rejected rather than silently rounded.

## Conversion

Conversion is explicit and never implicit. A converted value is stored or
returned as a separate amount with its own currency and a rate record containing
rate, date, source currency, target currency, and provider/source. A screen must
make it clear whether it displays original or converted values.

## Rounding

Keep calculation precision through the operation and round only at a documented
boundary, normally for display or a persisted business result. The import
storage boundary is scale 6 because PostgreSQL uses `NUMERIC(20,6)`; values
outside that representable range are rejected rather than rounded. Use the
currency minor-unit convention for display, but do not discard source
precision. Any rounding mode must be named in the domain function and covered
by tests.

## Aggregation and display

Never aggregate different currencies into one total without an explicit target
currency and conversion policy. Show the currency code when ambiguity exists,
use locale-aware formatting for presentation, and never infer currency from a
symbol alone. Percentages and balances are deterministic calculations, not AI
outputs.

Dashboard financial cash flow (income, expense, net), category, and merchant
analytics exclude transactions that belong to a confirmed internal-transfer
link; suggested, rejected, and unconfirmed transfer candidates remain ordinary
transactions. This financial view is deliberately distinct from raw account
movement: an account's inflow/outflow and transaction count still include
confirmed transfers, because moving money between one's own accounts is a
banking event even though it is not income or expense.

## Phase 6 splits

Split amounts use the same decimal-string boundary, PostgreSQL
`NUMERIC(20,6)`, and exact scale-6 bigint helpers as parent transactions. A
saved split set must contain 1-50 positive amounts, all in the parent's
currency, and its exact sum must equal the parent's absolute amount. No split
rounding, truncation, or currency conversion is performed. The parent amount,
currency, and direction remain unchanged.

## Phase 10 budgets and goals

Budgets and savings goals are currency-specific and use the same decimal-string
boundary, `NUMERIC(20,6)` storage, and exact scale-6 bigint helpers. There is
never a multi-currency budget total and never an implicit conversion. Budget
spending reuses the Phase 9 expense predicate (debit-only, confirmed-transfer
excluded, split-aware). Percentage used and percentage complete are presentation
metadata computed from scaled integers and are never used to mutate amounts.
Goal account-balance progress reads the deterministic latest `balance_after` for
the linked account and reports progress unavailable rather than fabricating a
balance when no such value exists.

## Phase 12 export precision

Exports are not computations: they move stored values to the user without
floating-point transformation, rounding, or conversion. Transaction CSV exports
the canonical decimal string in `amount_exact` (PostgreSQL `NUMERIC` text, scale
6, for example `5000.000000`) with an explicit `currency` column. XLSX keeps
`amount_exact` as a text cell because Excel stores IEEE-754 doubles; any
separate numeric convenience column is explicitly marked non-authoritative.
Every archive monetary field is a decimal string with its currency. No amount
is ever exported without a currency column, and no currency is converted during
export.
