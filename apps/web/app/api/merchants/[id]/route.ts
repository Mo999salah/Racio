import { merchantActionSchema, merchantPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { actionMerchant, updateMerchant } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = merchantPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant update.');
    return Response.json(
      await updateMerchant(database.db, session.user.id, (await params).id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = merchantActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid merchant action.');
    return Response.json(
      await actionMerchant(database.db, session.user.id, (await params).id, parsed.data.action),
    );
  } catch (error) {
    return apiError(error);
  }
}
