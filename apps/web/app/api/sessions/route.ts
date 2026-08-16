import { getAuth, logAuthEvent, requireSession } from '@racio/auth';
import { sessionIdSchema } from '@racio/contracts';
import { schema } from '@racio/database';
import { and, eq } from 'drizzle-orm';
import { database } from '../../../lib/database';
import { headers } from 'next/headers';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const requestHeaders = await headers();
    await requireSession(requestHeaders);
    const auth = await getAuth();
    const sessions = await auth.api.listSessions({ headers: requestHeaders });
    return Response.json(
      sessions.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        expiresAt: item.expiresAt,
        ipAddress: item.ipAddress,
        userAgent: item.userAgent,
      })),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const requestHeaders = await headers();
    const session = await requireSession(requestHeaders);
    const body = (await request.json()) as { id?: unknown };
    const parsed = sessionIdSchema.safeParse(body.id);
    if (!parsed.success) {
      return Response.json(
        { error: { code: 'VALIDATION', message: 'Invalid session id.' } },
        { status: 400 },
      );
    }
    const ownedSession = await database.db.query.session.findFirst({
      where: and(eq(schema.session.id, parsed.data), eq(schema.session.userId, session.user.id)),
    });
    if (!ownedSession)
      return Response.json(
        { error: { code: 'NOT_FOUND', message: 'The requested session does not exist.' } },
        { status: 404 },
      );
    const auth = await getAuth();
    await auth.api.revokeSession({ headers: requestHeaders, body: { token: ownedSession.token } });
    logAuthEvent('session_revoked', { userId: session.user.id });
    return Response.json({ status: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const requestHeaders = await headers();
    const session = await requireSession(requestHeaders);
    const action = request.headers.get('x-racio-session-action');
    if (action === 'revoke-others') {
      const auth = await getAuth();
      await auth.api.revokeOtherSessions({ headers: requestHeaders });
      logAuthEvent('sessions_revoked_other', { userId: session.user.id });
      return Response.json({ status: true });
    }
    if (action === 'revoke-all') {
      const auth = await getAuth();
      await auth.api.revokeSessions({ headers: requestHeaders });
      logAuthEvent('sessions_revoked_all', { userId: session.user.id });
      return Response.json({ status: true });
    }
    return Response.json(
      { error: { code: 'VALIDATION', message: 'Unsupported session action.' } },
      { status: 400 },
    );
  } catch (error) {
    return apiError(error);
  }
}
