import { AuthBoundaryError } from './errors';
import { getAuth, type RacioAuth } from './auth';

export type AuthSession = NonNullable<Awaited<ReturnType<RacioAuth['api']['getSession']>>>;

export async function getSession(headers: Headers) {
  const auth = await getAuth();
  return auth.api.getSession({ headers });
}

export async function requireSession(headers: Headers): Promise<AuthSession> {
  const session = await getSession(headers);
  if (!session) throw new AuthBoundaryError('UNAUTHENTICATED', 'A valid session is required.');
  return session;
}

export async function requireUser(headers: Headers) {
  return (await requireSession(headers)).user;
}

export async function getCurrentUserId(headers: Headers) {
  return (await requireSession(headers)).user.id;
}

export function safeReturnPath(value: string | null | undefined, fallback = '/') {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
    return fallback;
  try {
    const parsed = new URL(value, 'http://racio.local');
    if (parsed.origin !== 'http://racio.local') return fallback;
  } catch {
    return fallback;
  }
  return value;
}
