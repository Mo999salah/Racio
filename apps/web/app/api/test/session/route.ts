import { randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { readAppEnv } from '@racio/config';
import { schema } from '@racio/database';
import { database } from '../../../../lib/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * TEST-ONLY session fixture for browser tests.
 *
 * Guards (both required, so it can never be enabled accidentally in a real
 * deployment):
 *  1. `NODE_ENV` must not be `production`.
 *  2. `RACIO_E2E=1` must be set explicitly.
 *
 * In production the route always returns 404 even if RACIO_E2E were set.
 * The endpoint creates (or reuses) a user by email and issues a real Better
 * Auth database session; the browser gets the normal HttpOnly session cookie
 * (signed with the auth secret exactly like Better Auth signs it). It is NOT
 * an authentication bypass available outside the test harness.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' || process.env.RACIO_E2E !== '1') {
    return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { email?: unknown; name?: unknown };
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : 'E2E User';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(email)) {
    return Response.json({ error: { code: 'VALIDATION' } }, { status: 400 });
  }

  const now = new Date();
  const [existing] = await database.db
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));
  const user = existing ?? {
    id: randomUUID(),
    name,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };
  if (!existing) await database.db.insert(schema.user).values(user);

  const token = randomBytes(32).toString('hex');
  await database.db.insert(schema.session).values({
    id: randomUUID(),
    token,
    userId: user.id,
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
    createdAt: now,
    updatedAt: now,
    ipAddress: request.headers.get('x-forwarded-for') ?? null,
    userAgent: request.headers.get('user-agent'),
  });

  const secret = readAppEnv().betterAuthSecret;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(token));
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
  const signedValue = encodeURIComponent(`${token}.${signatureB64}`);

  // The guard above ensures NODE_ENV is never `production` here, so the
  // session cookie is never marked Secure (browser tests run over http).
  const cookie = [
    `better-auth.session_token=${signedValue}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ].join('; ');
  return Response.json(
    { ok: true, userId: user.id },
    { status: 200, headers: { 'Set-Cookie': cookie } },
  );
}
