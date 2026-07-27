# Authentication and session operations

## Boundary

Racio uses Better Auth 1.6.25 with `@better-auth/drizzle-adapter` and the
existing PostgreSQL connection. Better Auth owns the OAuth callback, account,
session, and cookie protocol. Racio owns provider availability, protected-page
redirects, preferences, session management UI, ownership helpers, and
non-sensitive security events.

The enabled sign-in methods are Google and Apple only. Passwords, magic links,
passkeys, MFA, organizations, roles, invitations, and admin flows are not
implemented in Phase 2.

## Local setup

1. Copy `.env.example` to `.env`.
2. Run PostgreSQL and apply `pnpm --filter @racio/database db:migrate`.
3. Leave providers empty to verify safe no-provider boot, or configure a real
   provider.
4. Start the web app with `pnpm --filter @racio/web dev`.

Google's local callback is:

```text
http://localhost:3000/api/auth/callback/google
```

Apple Sign In does not support ordinary localhost callbacks. Use an HTTPS
development origin and register `/api/auth/callback/apple`. The Apple private
key may be stored in `.env` with `\\n` escapes; the server converts those
escapes before generating a short-lived ES256 client secret. Never commit the
key or expose it through a public environment variable.

## Sessions

Sessions are database-backed and accessed through HttpOnly cookies. Production
cookies are Secure and SameSite=Lax. The default session lifetime is 30 days,
with daily refresh and a five-minute fresh-session window. The sessions page
supports revoking one session, all other sessions, or all sessions. The browser
receives opaque session IDs only; the server resolves the token after checking
the authenticated owner. Session tokens are never sent to localStorage and are
not included in application logs.

## Preferences and ownership

Preferences are keyed by the authenticated `userId` with one row per user.
Requests accept only the preference fields; ownership always comes from the
validated Better Auth session. The upsert primary key makes creation
idempotent and concurrent-safe. Locale, IANA timezone, interface mode,
appearance, and optional ISO 4217 base currency are validated with Zod.

## Troubleshooting

- A blank provider list means the provider configuration is incomplete. This
  is intentional; no fake credential is synthesized.
- A production boot failure mentioning `BETTER_AUTH_SECRET` means the secret
  is missing or shorter than 32 characters.
- A callback error normally means the provider callback URL, trusted origin,
  client ID, or client secret does not exactly match the provider dashboard.
- For multiple web instances, replace Better Auth's process-local rate-limit
  storage with shared storage before production rollout.
