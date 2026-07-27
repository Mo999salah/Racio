import { savedViewCreateSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createSavedView, listSavedViews } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await requireSession(await headers());
    return Response.json(await listSavedViews(database.db, session.user.id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = savedViewCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid saved view.');
    return Response.json(await createSavedView(database.db, session.user.id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
