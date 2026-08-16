import { listThreads } from '@racio/advisor';
import { requireSession } from '@racio/auth';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const session = await requireSession(await headers());
    const threads = await listThreads(database.db, session.user.id, 50);
    return Response.json(threads, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
