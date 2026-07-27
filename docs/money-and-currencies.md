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

## CSV import convention

CSV debit and credit values are stored as absolute decimal strings with a
separate `debit` or `credit` direction. A signed amount is converted to the same
convention deterministically: positive is `credit`, negative is `debit`, and
the stored amount is the absolute decimal string. No currency conversion is
performed during import. Decimal and thousands separators are detected from
column consistency; ambiguous values are rejected or sent to mapping/review.

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

## Phase 6 splits

Split amounts use the same decimal-string boundary, PostgreSQL
`NUMERIC(20,6)`, and exact scale-6 bigint helpers as parent transactions. A
saved split set must contain 1-50 positive amounts, all in the parent's
currency, and its exact sum must equal the parent's absolute amount. No split
rounding, truncation, or currency conversion is performed. The parent amount,
currency, and direction remain unchanged.
