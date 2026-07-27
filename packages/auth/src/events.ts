export type AuthEventName =
  | 'sign_in_succeeded'
  | 'sign_in_failed'
  | 'sign_out'
  | 'session_revoked'
  | 'sessions_revoked_other'
  | 'sessions_revoked_all'
  | 'preferences_updated';

export function logAuthEvent(
  event: AuthEventName,
  details: { userId?: string; provider?: string; sessionCount?: number } = {},
) {
  // Keep this payload small. Never add tokens, cookies, secrets, provider
  // responses, or complete email addresses to this boundary.
  console.info(
    JSON.stringify({
      component: 'racio-auth',
      event,
      at: new Date().toISOString(),
      ...details,
    }),
  );
}
