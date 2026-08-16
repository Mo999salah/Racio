import { transferActionSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { actionInternalTransfer } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../lib/database';
import { apiError } from '../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../lib/request-security';
import { enqueueAlertEvaluation } from '../../../../lib/jobs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = transferActionSchema.safeParse(await request.json());
    if (!parsed.success) throw new AuthBoundaryError('VALIDATION', 'Invalid transfer action.');
    const result = await actionInternalTransfer(
      database.db,
      session.user.id,
      (await params).id,
      parsed.data.action,
    );
    enqueueAlertEvaluation(session.user.id).catch(() => undefined);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
