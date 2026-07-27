import { merchantCreateSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createMerchant, listMerchants } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../lib/database';
import { apiError } from '../../../lib/api-errors';
import { assertSameOrigin } from '../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await requireSession(await headers());
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    return Response.json(await listMerchants(database.db, session.user.id, includeArchived), {
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
    const parsed = merchantCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant.');
    return Response.json(await createMerchant(database.db, session.user.id, parsed.data), {
      status: 201,
    });
  } catch (error) {
    return apiError(error);
  }
}
