# Institutions and financial accounts

## Phase 3 boundary

Phase 3 introduces only the private account directory needed before statement
imports. It stores institutions and one logical financial account per
institution for each user. It does not store balances, statements,
transactions, imports, parser output, budgets, alerts, exports, or bank API
connections.

## Ownership choice

Institutions are user-owned rather than a global bank registry. This avoids
inventing shared provider data and keeps a user's naming and country context
private. Every institution row has `user_id`; every account query scopes by the
authenticated session owner. The account table also has a composite foreign key
to `(institutions.id, institutions.user_id)`, so the relationship itself is
database-enforced.

## Normalization

`normalizeInstitutionName` applies `trim`, Unicode `NFKC` normalization,
locale-independent lower-casing, and collapse of consecutive whitespace to one
space. It does not remove punctuation or transliterate names. The normalized
value is used only for the per-user unique constraint; the original display name
is preserved.

## Account identity and lifecycle

The MVP uniqueness rule is `(user_id, institution_id)`. Account types are
`checking`, `savings`, `credit`, `cash`, and `other`. Currency codes are
uppercase ISO 4217-style three-letter codes and are validated at the API and
database layers. Accounts start `active`; archive sets `archived_at`, hides the
row from the default list, and can be reversed with restore. There is no delete
route or delete UI.

Multi-account support is intentionally deferred. Its future migration must
first define a stable user-visible account identity or an explicit account key,
then replace the current unique constraint in a reviewed migration while
retaining the owner composite foreign key.

## Identifier privacy

Only masked account identifiers and masked IBANs are accepted. The domain and
Zod layers reject digit-only account values and full-looking IBAN patterns; the
PostgreSQL checks provide a second guard. Full identifiers must not be logged,
sent in analytics, placed in localStorage, or put in query strings. The UI only
renders the values the user entered as masked values.

## API surface

- `GET/POST /api/institutions`
- `GET/PATCH /api/institutions/:id`
- `GET/POST /api/accounts`
- `GET/PATCH/POST /api/accounts/:id`, where the POST action is `archive` or
  `restore`

All routes require a Better Auth session, return not-found for an ID outside the
current user's scope, validate JSON with Zod, and send private no-store
responses. Mutation routes check same-origin when the browser provides an
Origin header. Application mutations currently rely on bounded validation and
database constraints; a shared rate limiter is required before multi-instance
deployment.
