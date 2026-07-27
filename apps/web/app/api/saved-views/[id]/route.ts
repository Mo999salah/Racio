import { savedViewPatchSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { deleteSavedView, updateSavedView } from '@racio/transactions';
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
    const parsed = savedViewPatchSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid saved view.');
    return Response.json(
      await updateSavedView(database.db, session.user.id, (await params).id, parsed.data),
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    return Response.json(await deleteSavedView(database.db, session.user.id, (await params).id));
  } catch (error) {
    return apiError(error);
  }
}
