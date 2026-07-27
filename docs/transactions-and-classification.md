# Transaction ledger and classification

Phase 5 treats confirmed transactions as the financial ledger. The original
statement, raw row, raw description, imported description, amount, currency,
direction, dates, account, and statement links are immutable after import
confirmation. User description, counterparty override, note, reviewed state,
categories, tags, and rule metadata are separate application-owned fields.

## Categories and defaults

Categories are user-owned and have one optional parent. Names are normalized
with Unicode NFKC, trim, whitespace collapse, and locale-independent lowercase;
the database enforces uniqueness per user and hierarchy level. Defaults are
seeded idempotently from stable template keys when a user first opens category
or transaction management. The initial display name is copied from the user's
locale (`en`, `ar`, or `tr`) into the editable user-owned `name` column. Later
locale changes do not rewrite user edits. Categories are archived, not
hard-deleted; archived categories remain visible on historical transactions and
cannot be newly assigned.

## Classification precedence

```text
manual user choice
> explicitly confirmed historical application
> rule assignment
> import/system assignment
```

Rules are enabled, ordered by ascending priority, then stable creation time and
ID. The first matching rule that can set a primary category wins. Later matching
rules may add secondary categories and tags. A manual primary assignment is
never replaced by an ordinary rule run. A manual removal or replacement changes
the assignment source to `manual` and remains traceable through classification
history.

## Rule contract and execution

Rules store versioned typed JSON conditions and actions. Conditions support
account, institution, direction, currency, description text, counterparty,
amount comparisons, booking day, existing tag, uncategorised-only, and statement
source type. Amount conditions require an explicit currency condition. Regex,
executable code, external calls, and AI are not supported.

Actions can assign a primary category, add a secondary category, add a tag, and
optionally mark a transaction reviewed. They cannot change financial fields or
delete/archive transactions. Preview and execution use the same domain matcher.
Future application runs after import confirmation as an isolated idempotent
classification step; a classification failure never rolls back financial
confirmation. Historical application is bounded, requires a fresh preview and
explicit confirmation, and records a classification event for every effect.

## Phase 5 management UI

The transaction workspace has two modes. Easy mode keeps common search, date,
reviewed, saved-view, and sort controls visible. Advanced mode exposes account,
institution, direction, currency, category, tag, amount, categorised, and
archived-state filters. Saved Views are server-owned: the picker applies a view,
current filters can create or update one, and management supports rename, delete,
default selection, and clearing the active view. The default view is applied on
open only when the URL does not contain explicit filters. Missing or archived
references are removed from the applied copy with a warning; the saved JSON is
preserved and is never stored in localStorage.

The Rule Builder edits the complete typed document: metadata, all/any matching,
all supported condition fields/operators, actions, priority, enable state, and
future-only or historical-and-future scope. Amount condition values remain
decimal strings and require a currency condition. Preview, date range, account
scope, actions, manual-protection count, bounded result sample, and preview hash
come from the same server matcher used for execution. Historical application is
available only for the historical scope, requires a fresh hash and explicit
confirmation, and never overwrites a manual classification. Rule history can be
reviewed and individual effects can be reverted with partial-revert reporting.

## Revert and saved views

Revert restores only the previous primary assignment and removes only secondary
categories/tags added by that rule event. Later manual edits are preserved and
make the affected effect non-reversible or partially reversible. Saved views
store versioned validated filter/sort/column JSON, never SQL, and are scoped to
the owner; one default view per user is enforced.

## Phase 6 transaction semantics

### Splits

The parent remains one visible banking event and preserves its imported amount,
currency, direction, raw description, imported description, and user-entered
description. Active splits are positive analytical allocations whose exact sum
equals the parent amount. Split-level primary categories, secondary categories,
and tags are ownership-scoped. After an explicit split save, split categories
drive allocation reporting and the parent primary category is informational; the
parent amount is never added to split amounts. Rules do not create, remove, or
change splits. Primary-category rule actions skip split transactions, while
safe parent-level metadata actions remain traceable.

### Merchants and aliases

Merchant normalisation applies Unicode NFKC, control-character removal,
whitespace/separator normalisation, and locale-independent case folding only.
Numbers, branch identifiers, locations, and company suffixes are preserved.
Raw/imported/user descriptions and source counterparty values are never
overwritten. Assignment precedence is manual, explicitly confirmed historical
alias application, enabled alias assignment, imported counterparty hint, then
unassigned. Aliases use bounded literal exact-normalized, contains,
starts-with, exact-counterparty, or counterparty-contains matching. Merges
archive the source after recording affected assignments; limited unmerge keeps
later manual changes and reports partial restoration.

### Internal transfers and reporting

Suggestions require same-user final transactions, different accounts, same
currency, opposite directions, equal absolute amounts, and booking dates within
three calendar days. Reasons are deterministic and explainable; generic transfer
words are weak evidence. Suggestions remain ordinary income/expense until
confirmed. A confirmed pair is still visible in the ledger and account cash
flow, but is excluded from income and expense totals. Rejected suggestions stay
ordinary income/expense and are suppressed from automatic re-suggestion. A
confirmed link can be explicitly unlinked. No transaction is created or
mutated by linking.
