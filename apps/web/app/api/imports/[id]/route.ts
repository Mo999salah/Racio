import { requireSession } from '@racio/auth';
import { getOwnedStatement } from '@racio/imports';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    return Response.json(await getOwnedStatement(database.db, session.user.id, (await params).id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}
