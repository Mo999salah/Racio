import { merchantAliasCreateSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { createMerchantAlias, listMerchantAliases } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession(await headers());
    return Response.json(
      await listMerchantAliases(database.db, session.user.id, (await params).id),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = merchantAliasCreateSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant alias.');
    return Response.json(
      await createMerchantAlias(database.db, session.user.id, (await params).id, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
