import { importRowCorrectionSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { updateRawTransaction } from '@racio/imports';
import { headers } from 'next/headers';
import { database } from '../../../../../../lib/database';
import { apiError } from '../../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> },
) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = importRowCorrectionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid row correction.');
    const resolved = await params;
    return Response.json(
      await updateRawTransaction(
        database.db,
        session.user.id,
        resolved.id,
        resolved.rowId,
        parsed.data,
      ),
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return apiError(error);
  }
}
