import { ruleRevertSchema } from '@racio/contracts';
import { AuthBoundaryError, requireSession } from '@racio/auth';
import { revertRuleEvent } from '@racio/transactions';
import { headers } from 'next/headers';
import { database } from '../../../../../../lib/database';
import { apiError } from '../../../../../../lib/api-errors';
import { assertSameOrigin } from '../../../../../../lib/request-security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  try {
    assertSameOrigin(request);
    const session = await requireSession(await headers());
    const parsed = ruleRevertSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new AuthBoundaryError('VALIDATION', 'Explicit confirmation is required.');
    return Response.json(
      await revertRuleEvent(database.db, session.user.id, (await params).eventId),
    );
  } catch (error) {
    return apiError(error);
  }
}
