import { requireSession } from '@racio/auth';
import { unreadAlertCount } from '@racio/planning';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await requireSession(await headers());
    const count = await unreadAlertCount(database.db, session.user.id);
    return Response.json({ count }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
