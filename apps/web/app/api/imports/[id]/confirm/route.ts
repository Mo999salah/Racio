import { importConfirmSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { confirmImport } from '@racio/imports';
import { headers } from 'next/headers';
import { database } from '../../../../../lib/database';
import { getPrivateStorage } from '../../../../../lib/storage';
import { apiError } from '../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = importConfirmSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid confirmation.');
    const result = await confirmImport(
      database.db,
      getPrivateStorage(),
      session.user.id,
      (await params).id,
      parsed.data.confirmMismatch,
      parsed.data.idempotencyKey,
    );
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return apiError(error);
  }
}
