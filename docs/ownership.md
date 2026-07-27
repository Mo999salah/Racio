# Ownership conventions

Every protected page and route obtains the current session from Better Auth.
Use `requireSession`, `requireUser`, or `getCurrentUserId` from `@racio/auth`.
Repository functions take the derived owner ID as an internal argument and
scope every query by it. They must never use a `userId` supplied by the
browser.

The Phase 2 preferences repository and the Phase 3 institution/account service
implement this convention. A missing or mismatched owned record is treated as
not found. The database also checks that an account's `userId` matches its
institution's `userId`, preventing a cross-user relationship even if an
application query regresses.
