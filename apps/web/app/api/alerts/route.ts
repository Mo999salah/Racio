import { alertListQuerySchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { listAlertEvents, unreadAlertCount } from '@racio/planning';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const parsed = alertListQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid alert query.');
    const [result, unread] = await Promise.all([
      listAlertEvents(database.db, session.user.id, parsed.data),
      unreadAlertCount(database.db, session.user.id),
    ]);
    return Response.json(
      { ...result, unreadCount: unread },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
