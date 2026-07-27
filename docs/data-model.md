# Conceptual data model

The Phase 2 identity and preference rows, Phase 3 institution/account rows,
Phase 4 CSV import rows, Phase 5 ledger/classification rows, and Phase 6
split/merchant/transfer rows are production schema. Later financial entities
remain conceptual.

- **User:** Better Auth authenticated owner.
- **Session:** Better Auth database-backed session with token, expiry, user
  agent, and optional IP metadata.
- **Account:** Better Auth OAuth account linkage. Provider tokens remain server
  data and are never returned to the browser UI.
- **Verification:** Better Auth core verification table reserved for the
  adapter contract; password and magic-link flows are disabled in this phase.
- **UserPreferences:** one row per user keyed by `userId`, containing locale,
  IANA timezone, interface mode, appearance, optional base currency, and
  timestamps.
- **Institution:** a user-owned bank or statement issuer. `name` is displayed
  as entered and `normalizedName` is deterministic, Unicode-normalized,
  lower-cased, and whitespace-collapsed for the per-user uniqueness rule.
- **FinancialAccount:** a user-owned logical account with display name, one of
  `checking`, `savings`, `credit`, `cash`, or `other`, an uppercase ISO 4217
  currency code, optional masked identifiers, and `active`/`archived` state.
  The MVP enforces one account per user-owned institution. No balance or
  statement data is stored here.

The `financial_accounts` table has a composite foreign key on
`(institution_id, user_id)` to the matching pair on `institutions`. This makes
the ownership relationship database-enforced rather than relying only on
application query discipline. A future multi-account migration must replace
the unique `(user_id, institution_id)` rule only after a stable account identity
key is specified.

- **Statement:** user-owned CSV source metadata, checksum, private storage
  reference, processing/reconciliation state, retention choice, and period or
  balance metadata. Original files are deleted after successful import by
  default unless the user chooses private retention.
- **ImportJob:** user-owned idempotent `statement.parse.csv` lifecycle row with
  attempts, parser version, counts, warnings, and safe failure fields.
- **RawTransaction:** user-owned candidate preserving the original row payload,
  raw values, parsed values, confidence, warnings, correction history, review
  state, and exclusion choice.
- **Transaction:** the minimum confirmed final event, linked to its statement,
  account, and raw candidate. Amount is absolute and direction is separate.
  Raw description, imported description, and user description are separate;
  notes, counterparty overrides, and reviewed state are application metadata.
- **Category:** user-owned one-parent-level taxonomy node with an editable name,
  deterministic default template key, kind, and reversible archive state.
- **TransactionCategoryAssignment:** an ownership-scoped primary or secondary
  assignment with manual, rule, import, or system source. A partial unique
  index permits at most one primary assignment per transaction.
- **Tag:** user-owned flat label with reversible archive state and an
  ownership-scoped transaction-tag join table.
- **ClassificationRule:** user-owned versioned JSON conditions/actions document;
  it stores no executable code and is ordered by priority and stable ID.
- **ClassificationEvent:** traceable rule application with previous/resulting
  primary category, added secondary categories/tags, reason, and revert time.
- **SavedView:** user-owned versioned filter, sort, and column-preference JSON;
  it stores no SQL and has one optional default per user.
- **TransactionSplit:** user-owned active analytical allocation of one confirmed
  transaction. Its positive `NUMERIC(20,6)` amount and parent currency are
  immutable source-independent allocation facts, and active split totals must
  exactly equal the parent amount. It is not a second banking event.
- **TransactionSplitCategoryAssignment / TransactionSplitTag:** ownership-
  scoped split classifications that reuse the category/tag source vocabulary.
  Split categories drive allocation reporting; parent categories remain
  informational after an explicit split save.
- **Merchant:** canonical user-owned merchant identity with deterministic
  normalized name and reversible active/archived/merged state. Assignment is
  separate transaction metadata and never changes imported text.
- **MerchantAlias:** user-owned bounded literal pattern mapped to a merchant,
  with exact-normalized, contains, starts-with, or counterparty match type,
  priority, enabled state, and archive state.
- **MerchantMergeEvent:** traceable source-to-target merge snapshot containing
  affected transaction and alias assignments. Limited unmerge restores only
  unchanged assignments and reports later manual conflicts.
- **InternalTransferLink:** user-owned link between two existing transactions,
  with suggested/confirmed/rejected/unlinked status, deterministic reasons,
  source, and optional score. Partial unique indexes permit at most one
  confirmed outgoing and incoming link per transaction.
- **Budget:** period, category, target currency, and limit.
- **SavingsGoal:** target amount, currency, and target date.
- **SavingsContribution:** confirmed contribution linked to a goal.
- **Alert:** deterministic condition, delivery state, and acknowledgement.
- **Attachment:** private user file associated with a financial record.
- **AIProviderConfig:** encrypted future provider settings and disabled state.
- **AdvisorConversation:** user-owned optional AI conversation metadata.
- **AdvisorMessage:** minimised prompt/result data with safety metadata.
- **AuditLog:** security-sensitive event record without sensitive payloads.
